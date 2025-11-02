import ApiClient from './ApiClient.js';
import { getLogger } from '../utils/logger.js';

/**
 * Project selector for auto-selecting high-quality Apache projects
 * Features:
 * - Fetches all Apache projects
 * - Filters by minimum issue count
 * - Sorts by activity and quality
 * - Prefers known high-quality projects
 */
class ProjectSelector {
  /**
   * @param {ApiClient} apiClient - Configured API client
   * @param {Object} config - Configuration object
   */
  constructor(apiClient, config) {
    this.apiClient = apiClient;
    this.config = config;
    this.logger = getLogger().child('ProjectSelector');
  }

  /**
   * Auto-select top 3 projects based on criteria
   * @returns {Promise<Array<string>>} Array of project keys
   */
  async selectProjects() {
    const { mode, manual_selection, min_issues, preferred_projects } = this.config;

    // Use manual selection if provided
    if (mode === 'manual' || (manual_selection && manual_selection.length > 0)) {
      this.logger.info(`Using manual project selection: ${manual_selection.join(', ')}`);
      return manual_selection;
    }

    this.logger.info('Auto-selecting projects...');

    try {
      // Fetch all projects
      const projects = await this.fetchAllProjects();
      
      // Filter and score projects
      const scoredProjects = await this.scoreProjects(projects, min_issues, preferred_projects);
      
      // Select top 3
      const selected = scoredProjects.slice(0, 3).map((p) => p.key);
      
      this.logger.info(`Selected projects: ${selected.join(', ')}`);
      
      return selected;
    } catch (error) {
      this.logger.error('Failed to auto-select projects, falling back to defaults', error);
      
      // Fallback to preferred projects
      return preferred_projects.slice(0, 3);
    }
  }

  /**
   * Fetch all Apache Jira projects
   * @returns {Promise<Array<Object>>} Array of project objects
   */
  async fetchAllProjects() {
    this.logger.info('Fetching all Apache projects...');

    try {
      const projects = await this.apiClient.get('/project');
      
      this.logger.info(`Found ${projects.length} projects`);
      
      return projects;
    } catch (error) {
      this.logger.error('Failed to fetch projects', error);
      throw error;
    }
  }

  /**
   * Fetch issue count for a project
   * @param {string} projectKey - Project key
   * @returns {Promise<number>} Number of issues
   */
  async getIssueCount(projectKey) {
    try {
      const result = await this.apiClient.get('/search', {
        jql: `project=${projectKey}`,
        maxResults: 0, // We only want the total count
      });

      return result.total || 0;
    } catch (error) {
      this.logger.warn(`Failed to get issue count for ${projectKey}`, error);
      return 0;
    }
  }

  /**
   * Fetch recent activity for a project (issues updated in last 6 months)
   * @param {string} projectKey - Project key
   * @returns {Promise<number>} Number of recently updated issues
   */
  async getRecentActivity(projectKey) {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const dateStr = sixMonthsAgo.toISOString().split('T')[0];

      const result = await this.apiClient.get('/search', {
        jql: `project=${projectKey} AND updated >= "${dateStr}"`,
        maxResults: 0,
      });

      return result.total || 0;
    } catch (error) {
      this.logger.warn(`Failed to get recent activity for ${projectKey}`, error);
      return 0;
    }
  }

  /**
   * Score and rank projects based on multiple criteria
   * @param {Array<Object>} projects - Array of project objects
   * @param {number} minIssues - Minimum issue count threshold
   * @param {Array<string>} preferredProjects - Preferred project keys
   * @returns {Promise<Array<Object>>} Scored and sorted projects
   */
  async scoreProjects(projects, minIssues, preferredProjects) {
    this.logger.info(`Scoring ${projects.length} projects...`);
    
    const scoredProjects = [];

    // Process projects in batches to avoid overwhelming API
    const batchSize = 5;
    for (let i = 0; i < projects.length; i += batchSize) {
      const batch = projects.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (project) => {
        try {
          const issueCount = await this.getIssueCount(project.key);
          
          // Skip projects below minimum threshold
          if (issueCount < minIssues) {
            return null;
          }

          const recentActivity = await this.getRecentActivity(project.key);
          
          // Calculate score
          let score = issueCount; // Base score is issue count
          
          // Bonus for recent activity (weight: 0.5)
          score += recentActivity * 0.5;
          
          // Bonus for being in preferred list (weight: 5000)
          if (preferredProjects.includes(project.key)) {
            score += 5000;
          }

          this.logger.info(
            `${project.key}: ${issueCount} issues, ${recentActivity} recent, score: ${Math.round(score)}`
          );

          return {
            key: project.key,
            name: project.name,
            issueCount,
            recentActivity,
            score,
          };
        } catch (error) {
          this.logger.warn(`Failed to score project ${project.key}`, error);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      scoredProjects.push(...batchResults.filter((p) => p !== null));
    }

    // Sort by score descending
    scoredProjects.sort((a, b) => b.score - a.score);

    this.logger.info(`Scored ${scoredProjects.length} qualifying projects`);

    return scoredProjects;
  }

  /**
   * Validate selected projects (check if they exist and are accessible)
   * @param {Array<string>} projectKeys - Array of project keys
   * @returns {Promise<Array<string>>} Valid project keys
   */
  async validateProjects(projectKeys) {
    this.logger.info(`Validating projects: ${projectKeys.join(', ')}`);
    
    const validProjects = [];

    for (const projectKey of projectKeys) {
      try {
        const result = await this.apiClient.get('/search', {
          jql: `project=${projectKey}`,
          maxResults: 1,
        });

        if (result.total > 0) {
          validProjects.push(projectKey);
          this.logger.info(`✓ ${projectKey} is valid (${result.total} issues)`);
        } else {
          this.logger.warn(`✗ ${projectKey} has no issues`);
        }
      } catch (error) {
        this.logger.warn(`✗ ${projectKey} is not accessible`, error);
      }
    }

    return validProjects;
  }
}

export default ProjectSelector;
