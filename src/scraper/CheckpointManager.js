import fs from 'fs/promises';
import path from 'path';
import { getLogger } from '../utils/logger.js';

/**
 * Checkpoint manager for save/load/resume functionality
 * Features:
 * - Atomic checkpoint saves (write to temp, then rename)
 * - Project-specific checkpoints
 * - Resume from exact position
 * - Incremental update support
 */
class CheckpointManager {
  /**
   * @param {string} checkpointDir - Directory to store checkpoints
   * @param {number} saveInterval - Save checkpoint every N issues
   */
  constructor(checkpointDir = 'data/checkpoints', saveInterval = 25) {
    this.checkpointDir = checkpointDir;
    this.saveInterval = saveInterval;
    this.logger = getLogger().child('CheckpointManager');
    this.issuesSinceLastSave = 0;
  }

  /**
   * Load checkpoint for a project
   * @param {string} projectKey - Jira project key
   * @returns {Promise<Object|null>} Checkpoint data or null if not found
   */
  async loadCheckpoint(projectKey) {
    const checkpointPath = this.getCheckpointPath(projectKey);

    try {
      const data = await fs.readFile(checkpointPath, 'utf-8');
      const checkpoint = JSON.parse(data);
      
      this.logger.info(`Loaded checkpoint for ${projectKey}: ${checkpoint.scrapedCount}/${checkpoint.totalIssues} issues`);
      
      return checkpoint;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.info(`No checkpoint found for ${projectKey}, starting fresh`);
        return null;
      }
      
      this.logger.error(`Failed to load checkpoint for ${projectKey}`, error);
      throw error;
    }
  }

  /**
   * Save checkpoint for a project
   * Uses atomic write (write to temp file, then rename)
   * @param {string} projectKey - Jira project key
   * @param {Object} state - Current scraping state
   * @returns {Promise<void>}
   */
  async saveCheckpoint(projectKey, state) {
    const checkpointPath = this.getCheckpointPath(projectKey);
    const tempPath = `${checkpointPath}.tmp`;

    try {
      // Ensure directory exists
      await fs.mkdir(this.checkpointDir, { recursive: true });

      // Prepare checkpoint data
      const checkpoint = {
        project: projectKey,
        lastStartAt: state.lastStartAt || 0,
        lastProcessedIssue: state.lastProcessedIssue || null,
        totalIssues: state.totalIssues || 0,
        scrapedCount: state.scrapedCount || 0,
        lastSuccessfulFetch: new Date().toISOString(),
        lastUpdateCheck: state.lastUpdateCheck || new Date().toISOString(),
        partialBatch: state.partialBatch || [],
        status: state.status || 'in_progress',
        metadata: {
          version: '1.0.0',
          savedAt: new Date().toISOString(),
        },
      };

      // Write to temp file
      await fs.writeFile(tempPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

      // Atomic rename
      await fs.rename(tempPath, checkpointPath);

      this.logger.info(
        `Checkpoint saved: ${projectKey} at issue ${state.scrapedCount}/${state.totalIssues}`
      );
    } catch (error) {
      this.logger.error(`Failed to save checkpoint for ${projectKey}`, error);
      
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  /**
   * Check if checkpoint should be saved
   * @param {number} issuesProcessed - Number of issues processed since last save
   * @returns {boolean} True if should save
   */
  shouldSave(issuesProcessed = 1) {
    this.issuesSinceLastSave += issuesProcessed;
    
    if (this.issuesSinceLastSave >= this.saveInterval) {
      this.issuesSinceLastSave = 0;
      return true;
    }
    
    return false;
  }

  /**
   * Force checkpoint save (used at end of scraping)
   * @param {string} projectKey - Jira project key
   * @param {Object} state - Current scraping state
   * @returns {Promise<void>}
   */
  async forceSave(projectKey, state) {
    this.issuesSinceLastSave = 0;
    await this.saveCheckpoint(projectKey, state);
  }

  /**
   * Mark project as completed
   * @param {string} projectKey - Jira project key
   * @param {Object} finalState - Final scraping state
   * @returns {Promise<void>}
   */
  async markCompleted(projectKey, finalState) {
    finalState.status = 'completed';
    finalState.completedAt = new Date().toISOString();
    
    await this.saveCheckpoint(projectKey, finalState);
    this.logger.info(`Project ${projectKey} marked as completed`);
  }

  /**
   * Check if project scraping is completed
   * @param {string} projectKey - Jira project key
   * @returns {Promise<boolean>} True if completed
   */
  async isCompleted(projectKey) {
    try {
      const checkpoint = await this.loadCheckpoint(projectKey);
      return checkpoint && checkpoint.status === 'completed';
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete checkpoint (for fresh start)
   * @param {string} projectKey - Jira project key
   * @returns {Promise<void>}
   */
  async deleteCheckpoint(projectKey) {
    const checkpointPath = this.getCheckpointPath(projectKey);

    try {
      await fs.unlink(checkpointPath);
      this.logger.info(`Deleted checkpoint for ${projectKey}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`Failed to delete checkpoint for ${projectKey}`, error);
      }
    }
  }

  /**
   * List all checkpoints
   * @returns {Promise<Array<string>>} Array of project keys
   */
  async listCheckpoints() {
    try {
      const files = await fs.readdir(this.checkpointDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get checkpoint file path for a project
   * @param {string} projectKey - Jira project key
   * @returns {string} Full checkpoint file path
   */
  getCheckpointPath(projectKey) {
    return path.join(this.checkpointDir, `${projectKey}.json`);
  }

  /**
   * Reset issue counter (call after successful save)
   */
  resetCounter() {
    this.issuesSinceLastSave = 0;
  }

  /**
   * Get checkpoint statistics
   * @returns {Promise<Object>} Statistics about all checkpoints
   */
  async getStatistics() {
    const projectKeys = await this.listCheckpoints();
    const stats = {
      totalProjects: projectKeys.length,
      completed: 0,
      inProgress: 0,
      totalIssuesScraped: 0,
      projects: {},
    };

    for (const projectKey of projectKeys) {
      try {
        const checkpoint = await this.loadCheckpoint(projectKey);
        if (checkpoint) {
          stats.projects[projectKey] = {
            scrapedCount: checkpoint.scrapedCount,
            totalIssues: checkpoint.totalIssues,
            status: checkpoint.status,
            lastUpdate: checkpoint.lastSuccessfulFetch,
          };

          if (checkpoint.status === 'completed') {
            stats.completed++;
          } else {
            stats.inProgress++;
          }

          stats.totalIssuesScraped += checkpoint.scrapedCount;
        }
      } catch (error) {
        this.logger.error(`Failed to load checkpoint stats for ${projectKey}`, error);
      }
    }

    return stats;
  }
}

export default CheckpointManager;
