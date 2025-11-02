import fs from 'fs/promises';
import path from 'path';
import { getLogger } from '../utils/logger.js';

/**
 * Incremental updater for fetching only changed issues
 * Features:
 * - Fetch only issues updated since last run
 * - Merge with existing data
 * - Identify changed issues for re-processing
 */
class IncrementalUpdater {
  /**
   * @param {ApiClient} apiClient - Configured API client
   * @param {string} dataDir - Directory containing scraped data
   */
  constructor(apiClient, dataDir = 'data/raw') {
    this.apiClient = apiClient;
    this.dataDir = dataDir;
    this.logger = getLogger().child('IncrementalUpdater');
  }

  /**
   * Fetch issues updated since a specific timestamp
   * @param {string} projectKey - Jira project key
   * @param {string} since - ISO timestamp (e.g., "2025-11-01T14:00:00Z")
   * @param {number} pageSize - Issues per page
   * @returns {Promise<Array<Object>>} Array of updated issues
   */
  async fetchUpdatedIssues(projectKey, since, pageSize = 50) {
    this.logger.info(`Fetching issues updated since ${since} for ${projectKey}`);

    const allIssues = [];
    let startAt = 0;
    let hasMore = true;

    // Convert timestamp to JQL-compatible format
    const sinceDate = new Date(since).toISOString().replace('T', ' ').split('.')[0];

    while (hasMore) {
      try {
        const result = await this.apiClient.get('/search', {
          jql: `project=${projectKey} AND updated >= "${sinceDate}" ORDER BY updated ASC`,
          startAt,
          maxResults: pageSize,
          fields: 'summary,description,created,updated,status,priority,assignee,reporter,issuetype,components,labels',
        });

        allIssues.push(...result.issues);

        this.logger.info(
          `Fetched ${result.issues.length} updated issues (${allIssues.length}/${result.total})`
        );

        startAt += result.issues.length;
        hasMore = startAt < result.total;
      } catch (error) {
        this.logger.error(`Failed to fetch updated issues at startAt=${startAt}`, error);
        throw error;
      }
    }

    this.logger.info(`Total updated issues fetched: ${allIssues.length}`);

    return allIssues;
  }

  /**
   * Merge new issues with existing data
   * Replaces duplicates, appends new issues
   * @param {Array<Object>} newIssues - Newly fetched issues
   * @param {string} existingFile - Path to existing data file
   * @returns {Promise<Array<Object>>} Merged issues
   */
  async mergeWithExisting(newIssues, existingFile) {
    this.logger.info(`Merging ${newIssues.length} new issues with existing data`);

    try {
      // Load existing data
      const existingData = await this.loadExistingData(existingFile);
      
      // Create a map of existing issues by key
      const issueMap = new Map();
      for (const issue of existingData) {
        issueMap.set(issue.key, issue);
      }

      // Update or add new issues
      let updatedCount = 0;
      let addedCount = 0;

      for (const issue of newIssues) {
        if (issueMap.has(issue.key)) {
          updatedCount++;
        } else {
          addedCount++;
        }
        issueMap.set(issue.key, issue);
      }

      const mergedIssues = Array.from(issueMap.values());

      this.logger.info(
        `Merge complete: ${updatedCount} updated, ${addedCount} new, ${mergedIssues.length} total`
      );

      return mergedIssues;
    } catch (error) {
      this.logger.error('Failed to merge with existing data', error);
      
      // If existing file doesn't exist, just return new issues
      if (error.code === 'ENOENT') {
        this.logger.info('No existing data found, using new issues only');
        return newIssues;
      }
      
      throw error;
    }
  }

  /**
   * Load existing scraped data from file
   * @param {string} filePath - Path to data file
   * @returns {Promise<Array<Object>>} Existing issues
   */
  async loadExistingData(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(`Existing data file not found: ${filePath}`);
        return [];
      }
      throw error;
    }
  }

  /**
   * Identify which issues have changed
   * Compares 'updated' timestamps
   * @param {Array<Object>} oldData - Old issue data
   * @param {Array<Object>} newData - New issue data
   * @returns {Array<string>} Array of changed issue keys
   */
  async identifyChangedIssues(oldData, newData) {
    const changedIssues = [];

    // Create map of old data by key
    const oldMap = new Map();
    for (const issue of oldData) {
      oldMap.set(issue.key, issue.fields.updated);
    }

    // Compare timestamps
    for (const issue of newData) {
      const oldTimestamp = oldMap.get(issue.key);
      
      if (!oldTimestamp || oldTimestamp !== issue.fields.updated) {
        changedIssues.push(issue.key);
      }
    }

    this.logger.info(`Identified ${changedIssues.length} changed issues`);

    return changedIssues;
  }

  /**
   * Save merged data to file
   * @param {Array<Object>} issues - Issues to save
   * @param {string} outputFile - Output file path
   * @returns {Promise<void>}
   */
  async saveMergedData(issues, outputFile) {
    try {
      // Ensure directory exists
      const dir = path.dirname(outputFile);
      await fs.mkdir(dir, { recursive: true });

      // Write data
      await fs.writeFile(outputFile, JSON.stringify(issues, null, 2), 'utf-8');

      this.logger.info(`Saved ${issues.length} issues to ${outputFile}`);
    } catch (error) {
      this.logger.error(`Failed to save merged data to ${outputFile}`, error);
      throw error;
    }
  }

  /**
   * Get the path to existing data file for a project
   * @param {string} projectKey - Project key
   * @returns {string} File path
   */
  getDataFilePath(projectKey) {
    return path.join(this.dataDir, `${projectKey}_issues.json`);
  }

  /**
   * Check if incremental update is available for a project
   * @param {string} projectKey - Project key
   * @returns {Promise<boolean>} True if existing data is available
   */
  async canDoIncrementalUpdate(projectKey) {
    const filePath = this.getDataFilePath(projectKey);
    
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default IncrementalUpdater;
