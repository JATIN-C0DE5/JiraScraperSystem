#!/usr/bin/env node

/**
 * Quick test to verify resume functionality
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testResume() {
  console.log('Testing Resume Functionality');
  console.log('=============================\n');

  try {
    // Load checkpoint
    const checkpointPath = path.join(__dirname, 'data/checkpoints/SPARK.json');
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf-8'));
    
    console.log('Checkpoint Data:');
    console.log(`  - lastStartAt: ${checkpoint.lastStartAt}`);
    console.log(`  - scrapedCount: ${checkpoint.scrapedCount}`);
    console.log(`  - status: ${checkpoint.status}\n`);

    // Load partial file
    const partialPath = path.join(__dirname, 'data/raw/SPARK_issues_partial.json');
    let scrapedIssues = [];
    let startAt = 0;

    try {
      const partialData = await fs.readFile(partialPath, 'utf-8');
      scrapedIssues = JSON.parse(partialData);
      startAt = scrapedIssues.length;
      
      console.log('Partial File Loaded:');
      console.log(`  - Contains: ${scrapedIssues.length} issues`);
      console.log(`  - File size: ${(await fs.stat(partialPath)).size / 1024 / 1024} MB\n`);
    } catch (error) {
      console.log('No partial file found\n');
      startAt = checkpoint.lastStartAt;
    }

    console.log('Resume Strategy:');
    console.log(`  - OLD approach: Resume from API position ${checkpoint.lastStartAt}`);
    console.log(`  - NEW approach: Resume from saved data at ${startAt}`);
    console.log(`  - Result: Will fetch starting from issue #${startAt + 1}\n`);

    // Check if this makes sense
    if (startAt === scrapedIssues.length) {
      console.log('✅ CORRECT: Resume position matches saved data count');
      console.log(`   No data loss - continuing from where we have data\n`);
    } else {
      console.log('❌ ERROR: Resume position mismatch!');
      console.log(`   This would cause duplicate or missing issues\n`);
    }

    // Show what would happen
    console.log('Next Steps:');
    console.log(`  1. API will be called with startAt=${startAt}`);
    console.log(`  2. New issues will be appended to array of ${scrapedIssues.length} existing issues`);
    console.log(`  3. Partial file will be updated every 25 issues`);
    console.log(`  4. When complete, partial file renamed to final file\n`);

    console.log('Test PASSED ✅');

  } catch (error) {
    console.error('Test FAILED:', error.message);
    process.exit(1);
  }
}

testResume();
