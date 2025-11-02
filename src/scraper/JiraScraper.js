import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import cliProgress from 'cli-progress';
import ApiClient from './ApiClient.js';
import RateLimiter from './RateLimiter.js';
import CheckpointManager from './CheckpointManager.js';
import IncrementalUpdater from './IncrementalUpdater.js';
import { getLogger } from '../utils/logger.js';

/**
 * Main Jira scraper with fault-tolerant resume capability
 * Features:
 * - Scrapes all issues from multiple projects
 * - Fetches complete issue data including comments
 * - Checkpoint-based resume from interruptions
 * - Rate limiting and retry logic
 * - Progress tracking with visual indicators
 * - Incremental update support
 */
class JiraScraper {
  /**
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.config = config;
    this.logger = getLogger().child('JiraScraper');

    // Initialize API client
    this.apiClient = new ApiClient(
      config.jira.base_url,
      config.jira.timeout,
      config.jira.max_retries
    );

    // Initialize rate limiter
    this.rateLimiter = new RateLimiter(
      config.scraping.rate_limit_delay,
      config.scraping.max_concurrent_requests
    );

    // Initialize checkpoint manager
    this.checkpointManager = new CheckpointManager(
      config.checkpoint.directory,
      config.checkpoint.save_interval
    );

    // Initialize incremental updater
    this.incrementalUpdater = new IncrementalUpdater(
      this.apiClient,
      'data/raw'
    );

    // Concurrency limiter
    this.limit = pLimit(config.scraping.max_concurrent_requests);

    // Progress bars
    this.multibar = null;
    this.progressBars = {};

    // Statistics
    this.stats = {
      totalIssues: 0,
      totalComments: 0,
      apiErrors: 0,
      startTime: null,
    };
  }

  /**
   * Main orchestrator - scrape all projects
   * @param {Array<string>} projectKeys - Array of project keys to scrape
   * @returns {Promise<void>}
   */
  async scrapeAllProjects(projectKeys) {
    this.stats.startTime = Date.now();
    this.logger.info(`Starting scrape for ${projectKeys.length} projects: ${projectKeys.join(', ')}`);

    // Initialize progress bars
    this.initProgressBars(projectKeys);

    try {
      for (const projectKey of projectKeys) {
        this.logger.info(`\n${'='.repeat(60)}`);
        this.logger.info(`Starting scrape for project: ${projectKey}`);
        this.logger.info('='.repeat(60));

        await this.scrapeProject(projectKey);

        this.logger.info(`✓ Completed scraping ${projectKey}`);
      }

      // Stop progress bars
      if (this.multibar) {
        this.multibar.stop();
      }

      // Print final statistics
      this.printStatistics();
    } catch (error) {
      this.logger.error('Fatal error during scraping', error);
      
      if (this.multibar) {
        this.multibar.stop();
      }
      
      throw error;
    }
  }

  /**
   * Scrape single project with resume capability
   * @param {string} projectKey - Jira project key
   * @returns {Promise<void>}
   */
  async scrapeProject(projectKey) {
    try {
      // Check if already completed
      const isCompleted = await this.checkpointManager.isCompleted(projectKey);
      if (isCompleted && !this.config.scraping.incremental_update) {
        this.logger.info(`Project ${projectKey} already completed, skipping`);
        return;
      }

      // Load checkpoint if exists
      let checkpoint = await this.checkpointManager.loadCheckpoint(projectKey);
      let startAt = 0;
      let scrapedIssues = [];

      // Check for incremental update
      if (this.config.scraping.incremental_update && checkpoint) {
        const canIncremental = await this.incrementalUpdater.canDoIncrementalUpdate(projectKey);
        
        if (canIncremental) {
          this.logger.info('Performing incremental update...');
          await this.performIncrementalUpdate(projectKey, checkpoint);
          return;
        }
      }

      // Resume from checkpoint
      if (checkpoint && checkpoint.status === 'in_progress') {
        startAt = checkpoint.lastStartAt;
        scrapedIssues = checkpoint.partialBatch || [];
        this.logger.info(`Resuming from checkpoint: startAt=${startAt}`);
      }

      // Fetch total issue count
      const totalIssues = await this.getTotalIssueCount(projectKey);
      this.logger.info(`Total issues in ${projectKey}: ${totalIssues}`);

      if (totalIssues === 0) {
        this.logger.warn(`No issues found in project ${projectKey}`);
        return;
      }

      // Update progress bar
      if (this.progressBars[projectKey]) {
        this.progressBars[projectKey].setTotal(totalIssues);
        this.progressBars[projectKey].update(scrapedIssues.length);
      }

      // Scraping state
      const state = {
        project: projectKey,
        lastStartAt: startAt,
        totalIssues,
        scrapedCount: scrapedIssues.length,
        lastProcessedIssue: null,
        partialBatch: [],
        status: 'in_progress',
      };

      // Fetch all issues page by page
      const pageSize = this.config.scraping.page_size;
      let hasMore = true;

      while (hasMore) {
        try {
          // Rate limiting
          await this.rateLimiter.wait();

          // Fetch page
          const pageResult = await this.fetchIssuesPage(projectKey, startAt, pageSize);
          
          if (!pageResult || !pageResult.issues || pageResult.issues.length === 0) {
            hasMore = false;
            break;
          }

          // Fetch comments for all issues in this page
          if (this.config.scraping.fetch_comments) {
            await this.fetchCommentsForIssues(pageResult.issues);
          }

          // Add to scraped issues
          scrapedIssues.push(...pageResult.issues);

          // Update state
          state.lastStartAt = startAt + pageResult.issues.length;
          state.scrapedCount = scrapedIssues.length;
          state.lastProcessedIssue = pageResult.issues[pageResult.issues.length - 1].key;

          // Update progress
          if (this.progressBars[projectKey]) {
            this.progressBars[projectKey].update(state.scrapedCount);
          }

          // Save checkpoint periodically
          if (this.checkpointManager.shouldSave(pageResult.issues.length)) {
            await this.checkpointManager.saveCheckpoint(projectKey, state);
          }

          // Move to next page
          startAt += pageResult.issues.length;
          hasMore = startAt < pageResult.total;
        } catch (error) {
          this.stats.apiErrors++;
          this.logger.error(`Error fetching page at startAt=${startAt}`, error);

          // Save checkpoint before stopping
          await this.checkpointManager.forceSave(projectKey, state);
          
          throw error;
        }
      }

      // Save final data
      await this.saveProjectData(projectKey, scrapedIssues);

      // Mark as completed
      state.status = 'completed';
      await this.checkpointManager.markCompleted(projectKey, state);

      // Update statistics
      this.stats.totalIssues += scrapedIssues.length;

      this.logger.info(`✓ Successfully scraped ${scrapedIssues.length} issues from ${projectKey}`);
    } catch (error) {
      this.logger.error(`Failed to scrape project ${projectKey}`, error);
      throw error;
    }
  }

  /**
   * Fetch paginated issues
   * @param {string} projectKey - Project key
   * @param {number} startAt - Pagination offset
   * @param {number} maxResults - Issues per page
   * @returns {Promise<Object>} Page result with issues
   */
  async fetchIssuesPage(projectKey, startAt, maxResults = 50) {
    try {
      const result = await this.apiClient.get('/search', {
        jql: `project=${projectKey} ORDER BY created ASC`,
        startAt,
        maxResults,
        fields: 'summary,description,created,updated,status,priority,assignee,reporter,issuetype,components,labels',
      });

      this.logger.debug(
        `Fetched page: ${result.issues.length} issues (${startAt + result.issues.length}/${result.total})`
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to fetch issues page at startAt=${startAt}`, error);
      throw error;
    }
  }

  /**
   * Fetch comments for multiple issues in parallel
   * @param {Array<Object>} issues - Array of issue objects
   * @returns {Promise<void>}
   */
  async fetchCommentsForIssues(issues) {
    const tasks = issues.map((issue) =>
      this.limit(async () => {
        try {
          await this.rateLimiter.wait();
          const comments = await this.fetchComments(issue.key);
          issue.comments = comments;
          
          this.stats.totalComments += comments.length;
        } catch (error) {
          this.logger.warn(`Failed to fetch comments for ${issue.key}, continuing...`, error);
          issue.comments = [];
        }
      })
    );

    await Promise.all(tasks);
  }

  /**
   * Fetch comments for a single issue
   * @param {string} issueKey - Issue key
   * @returns {Promise<Array<Object>>} Array of comments
   */
  async fetchComments(issueKey) {
    try {
      const result = await this.apiClient.get(`/issue/${issueKey}/comment`);
      
      return result.comments || [];
    } catch (error) {
      // Log warning but don't fail - missing comments shouldn't stop scraping
      this.logger.warn(`Could not fetch comments for ${issueKey}`, error);
      return [];
    }
  }

  /**
   * Get total issue count for a project
   * @param {string} projectKey - Project key
   * @returns {Promise<number>} Total issue count
   */
  async getTotalIssueCount(projectKey) {
    try {
      const result = await this.apiClient.get('/search', {
        jql: `project=${projectKey}`,
        maxResults: 0,
      });

      return result.total || 0;
    } catch (error) {
      this.logger.error(`Failed to get issue count for ${projectKey}`, error);
      throw error;
    }
  }

  /**
   * Perform incremental update (fetch only changed issues)
   * @param {string} projectKey - Project key
   * @param {Object} checkpoint - Existing checkpoint
   * @returns {Promise<void>}
   */
  async performIncrementalUpdate(projectKey, checkpoint) {
    this.logger.info(`Performing incremental update for ${projectKey}`);

    try {
      // Fetch updated issues
      const updatedIssues = await this.incrementalUpdater.fetchUpdatedIssues(
        projectKey,
        checkpoint.lastUpdateCheck
      );

      if (updatedIssues.length === 0) {
        this.logger.info('No updates found');
        return;
      }

      // Fetch comments for updated issues
      if (this.config.scraping.fetch_comments) {
        await this.fetchCommentsForIssues(updatedIssues);
      }

      // Merge with existing data
      const existingFile = this.incrementalUpdater.getDataFilePath(projectKey);
      const mergedIssues = await this.incrementalUpdater.mergeWithExisting(
        updatedIssues,
        existingFile
      );

      // Save merged data
      await this.saveProjectData(projectKey, mergedIssues);

      // Update checkpoint
      checkpoint.lastUpdateCheck = new Date().toISOString();
      checkpoint.scrapedCount = mergedIssues.length;
      await this.checkpointManager.saveCheckpoint(projectKey, checkpoint);

      this.logger.info(`Incremental update complete: ${updatedIssues.length} issues updated`);
    } catch (error) {
      this.logger.error('Incremental update failed', error);
      throw error;
    }
  }

  /**
   * Save project data to file
   * @param {string} projectKey - Project key
   * @param {Array<Object>} issues - Issues to save
   * @returns {Promise<void>}
   */
  async saveProjectData(projectKey, issues) {
    const outputPath = path.join('data/raw', `${projectKey}_issues.json`);

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Write data
      await fs.writeFile(outputPath, JSON.stringify(issues, null, 2), 'utf-8');

      this.logger.info(`Saved ${issues.length} issues to ${outputPath}`);
    } catch (error) {
      this.logger.error(`Failed to save data for ${projectKey}`, error);
      throw error;
    }
  }

  /**
   * Initialize progress bars
   * @param {Array<string>} projectKeys - Project keys
   */
  initProgressBars(projectKeys) {
    this.multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: '{name} | {bar} | {percentage}% | {value}/{total} issues | ETA: {eta}s',
      },
      cliProgress.Presets.shades_classic
    );

    // Create progress bar for each project
    for (const projectKey of projectKeys) {
      this.progressBars[projectKey] = this.multibar.create(100, 0, {
        name: projectKey.padEnd(10),
      });
    }
  }

  /**
   * Print final statistics
   */
  printStatistics() {
    const duration = ((Date.now() - this.stats.startTime) / 1000 / 60).toFixed(2);
    
    this.logger.info('\n' + '='.repeat(60));
    this.logger.info('SCRAPING STATISTICS');
    this.logger.info('='.repeat(60));
    this.logger.info(`Total Issues Scraped: ${this.stats.totalIssues.toLocaleString()}`);
    this.logger.info(`Total Comments Fetched: ${this.stats.totalComments.toLocaleString()}`);
    this.logger.info(`API Errors: ${this.stats.apiErrors}`);
    this.logger.info(`Duration: ${duration} minutes`);
    this.logger.info(`Average Speed: ${(this.stats.totalIssues / duration).toFixed(2)} issues/min`);
    this.logger.info('='.repeat(60));
  }
}

export default JiraScraper;
