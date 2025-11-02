#!/usr/bin/env node

import fs from 'fs/promises';
import yaml from 'yaml';
import JiraScraper from './JiraScraper.js';
import ProjectSelector from './ProjectSelector.js';
import ApiClient from './ApiClient.js';
import { initLogger } from '../utils/logger.js';

/**
 * Main entry point for Jira scraper
 * Loads configuration, selects projects, and starts scraping
 */
async function main() {
  try {
    console.log('🚀 Jira LLM Pipeline - Scraper\n');

    // Load configuration
    const configPath = 'config/config.yaml';
    const configFile = await fs.readFile(configPath, 'utf-8');
    const config = yaml.parse(configFile);

    // Initialize logger
    const logger = initLogger(config.logging);
    logger.info('Configuration loaded successfully');

    // Create API client for project selection
    const apiClient = new ApiClient(config.jira.base_url, config.jira.timeout);

    // Select projects
    logger.info('Selecting projects...');
    const projectSelector = new ProjectSelector(apiClient, config.projects);
    let projectKeys = await projectSelector.selectProjects();

    // Validate projects
    projectKeys = await projectSelector.validateProjects(projectKeys);

    if (projectKeys.length === 0) {
      logger.error('No valid projects found to scrape');
      process.exit(1);
    }

    logger.info(`Selected ${projectKeys.length} projects: ${projectKeys.join(', ')}\n`);

    // Save selected projects to config
    try {
      const projectsConfig = {
        metadata: {
          last_updated: new Date().toISOString(),
          description: 'Apache Jira project metadata for automatic selection',
        },
        selected_projects: projectKeys,
      };
      await fs.writeFile(
        'config/projects.json',
        JSON.stringify(projectsConfig, null, 2),
        'utf-8'
      );
    } catch (error) {
      logger.warn('Failed to save project selection', error);
    }

    // Create scraper and start scraping
    const scraper = new JiraScraper(config);
    await scraper.scrapeAllProjects(projectKeys);

    logger.info('\n✅ Scraping completed successfully!');
    logger.info('Output: data/raw/');

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user. Progress has been saved to checkpoints.');
  console.log('Run the script again to resume from where you left off.');
  process.exit(0);
});

// Run main function
main();
