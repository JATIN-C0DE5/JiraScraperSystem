# Apache Jira LLM Training Data Pipeline

> A production-grade, fault-tolerant pipeline for scraping Apache Jira issues and transforming them into high-quality training data for Large Language Models using Google Gemini 2.0 Flash Experimental API.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Output Format](#output-format)
- [Checkpoint System](#checkpoint-system)
- [Incremental Updates](#incremental-updates)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [Contributing](#contributing)

---

## 🎯 Overview

This pipeline automates the process of:
1. **Scraping** complete issue data from multiple Apache Jira projects (KAFKA, HADOOP, SPARK, etc.)
2. **Extracting** issue descriptions, comments, metadata, and relationships
3. **Transforming** raw data into structured training examples using Gemini 2.0 Flash Experimental
4. **Generating** JSONL files optimized for LLM fine-tuning

### What Makes This Special?

- **Fault-Tolerant**: Automatic checkpointing every 25 issues - resume from exact point after interruption
- **Production-Ready**: Exponential backoff retry, rate limiting, comprehensive error handling
- **Scalable**: Handles 60,000+ issues with streaming processing
- **Smart**: Auto-selects high-quality Apache projects based on activity and size
- **Comprehensive**: Generates 8 diverse training tasks per issue (summarization, classification, Q&A)

---

## ✨ Features

### Scraper (JavaScript/Node.js)
- ✅ Scrapes **ALL** issues from multiple projects concurrently
- ✅ Fetches complete issue data including **all comments**
- ✅ **Checkpoint-based resume** - never lose progress
- ✅ **Incremental updates** - fetch only changed issues on reruns
- ✅ Exponential backoff retry (5 attempts: 2s → 4s → 8s → 16s → 32s)
- ✅ Rate limiting with token bucket algorithm
- ✅ Real-time progress bars with ETA
- ✅ Comprehensive logging (console + rotating file logs)

### Processor (Python)
- ✅ Transforms raw issues into **8 training examples each**:
  - 1 × Summarization task (2-3 sentence technical summary)
  - 2 × Classification tasks (type + priority)
  - 5 × Question-Answer pairs
- ✅ Uses **Gemini 2.0 Flash Experimental** (unlimited budget support)
- ✅ Streaming JSONL output (memory-efficient)
- ✅ Data quality validation and reporting
- ✅ Automatic batching for API efficiency

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    JIRA LLM PIPELINE                            │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│ Apache Jira  │
│   REST API   │  https://issues.apache.org/jira/rest/api/2
└──────┬───────┘
       │
       │ HTTP Requests
       │ (with retry & rate limiting)
       ▼
┌──────────────────────────────────────────────────────────┐
│               JAVASCRIPT SCRAPER LAYER                   │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ ApiClient  │──│RateLimiter  │──│CheckpointMgr    │  │
│  └────────────┘  └─────────────┘  └─────────────────┘  │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │JiraScraper │──│ProjectSelect│──│IncrementalUpdate│  │
│  └────────────┘  └─────────────┘  └─────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         │ Save RAW JSON
                         ▼
                   ┌─────────────┐
                   │ data/raw/   │ KAFKA_issues.json
                   │             │ HADOOP_issues.json
                   │             │ SPARK_issues.json
                   └──────┬──────┘
                          │
                          │ Read JSON
                          ▼
┌──────────────────────────────────────────────────────────┐
│               PYTHON PROCESSOR LAYER                     │
│  ┌────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │GeminiClient│──│TaskGenerator│──│DataTransformer  │  │
│  └────────────┘  └─────────────┘  └─────────────────┘  │
│  ┌────────────┐                                         │
│  │ Validator  │                                         │
│  └────────────┘                                         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         │ Generate JSONL
                         ▼
┌─────────────────────────────────────────────────────────┐
│              GEMINI 2.0 FLASH EXPERIMENTAL              │
│                  (Google AI API)                        │
└────────────────────────┬────────────────────────────────┘
                         │
                         │ Transformed data
                         ▼
                   ┌─────────────┐
                   │data/final/  │ KAFKA_training.jsonl
                   │             │ HADOOP_training.jsonl
                   │             │ SPARK_training.jsonl
                   │             │ combined_training.jsonl
                   └─────────────┘
                         │
                         │ Ready for LLM Fine-tuning!
                         ▼
              ┌─────────────────────┐
              │   Your LLM Model    │
              │   (GPT, Claude,     │
              │    Llama, etc.)     │
              └─────────────────────┘
```

### Data Flow

1. **Scraping Phase** (Node.js)
   - Auto-select 3 high-quality Apache projects
   - Fetch all issues via paginated API calls
   - Fetch comments for each issue in parallel (p-limit)
   - Save checkpoints every 25 issues
   - Output: `data/raw/{PROJECT}_issues.json`

2. **Processing Phase** (Python)
   - Load scraped JSON files
   - For each issue, generate 8 training tasks via Gemini API
   - Validate and format as JSONL
   - Output: `data/final/{PROJECT}_training.jsonl`

3. **Merging Phase** (Python)
   - Combine all project files into `combined_training.jsonl`
   - Generate statistics and quality reports

---

## 📦 Prerequisites

### Required Software
- **Node.js** 18.0.0 or higher ([Install](https://nodejs.org/))
- **Python** 3.10 or higher ([Install](https://www.python.org/))
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)

### API Keys
- **Google Gemini API Key** ([Get yours](https://makersuite.google.com/app/apikey))
  - Free tier available
  - Pro account recommended for high volume

### System Requirements
- **OS**: Ubuntu Linux (tested on 20.04+)
- **RAM**: Minimum 4GB, recommended 8GB
- **Disk**: ~5GB free space (for 60,000 issues)
- **Network**: Stable internet connection

---

## 🚀 Installation

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd jira-llm-pipeline
```

### Step 2: Run Setup Script

```bash
./scripts/setup.sh
```

This will:
- ✅ Verify Node.js and Python versions
- ✅ Install Node.js dependencies
- ✅ Create Python virtual environment
- ✅ Install Python packages
- ✅ Create directory structure
- ✅ Make scripts executable

### Step 3: Set API Key

```bash
export GEMINI_API_KEY='your-api-key-here'
```

**Permanent Setup (recommended):**

```bash
echo "export GEMINI_API_KEY='your-api-key-here'" >> ~/.bashrc
source ~/.bashrc
```

### Step 4: Verify Installation

```bash
node --version  # Should be 18+
python3 --version  # Should be 3.10+
echo $GEMINI_API_KEY  # Should print your key
```

---

## ⚙️ Configuration

Configuration is stored in `config/config.yaml`:

### Key Settings

```yaml
# Jira API Settings
jira:
  base_url: "https://issues.apache.org/jira/rest/api/2"
  timeout: 15000  # 15 seconds
  max_retries: 5

# Project Selection
projects:
  mode: "auto"  # Auto-select top 3 projects
  manual_selection: []  # Override with ["KAFKA", "HADOOP", "SPARK"]
  min_issues: 10000  # Only projects with 10k+ issues

# Scraping Behavior
scraping:
  page_size: 50  # Issues per API call
  max_concurrent_requests: 10  # Parallel comment fetching
  fetch_comments: true
  incremental_update: true  # Only fetch updated issues on reruns
  rate_limit_delay: 100  # ms between requests

# Checkpoint System
checkpoint:
  enabled: true
  save_interval: 25  # Save every 25 issues

# Gemini API
gemini:
  model: "gemini-2.0-flash-exp"
  temperature: 0.3  # Lower = more consistent
  max_retries: 5

# Task Generation
tasks:
  summarization:
    enabled: true
  classification:
    enabled: true
    types: 2  # Type + Priority
  qna:
    enabled: true
    pairs_per_issue: 5

# Output
output:
  format: "jsonl"
  file_per_project: true  # Separate file per project
  combined_file: true  # Also create combined file
```

### Manual Project Selection

To scrape specific projects, edit `config/config.yaml`:

```yaml
projects:
  mode: "manual"
  manual_selection: ["KAFKA", "HADOOP", "SPARK"]
```

---

## 🎮 Usage

### Option 1: Run Complete Pipeline (Recommended)

```bash
./scripts/run_pipeline.sh
```

This runs all three steps automatically:
1. Scraping
2. LLM Processing
3. Statistics Generation

**Estimated Time**: 12-18 hours for 60,000 issues

### Option 2: Run Steps Individually

#### Step 1: Scrape Jira Issues

```bash
npm run scrape
# OR
./scripts/run_scraper.sh
```

**Output**: `data/raw/{PROJECT}_issues.json`

**Time**: 4-6 hours for 60,000 issues

#### Step 2: Process with Gemini

```bash
./scripts/run_processor.sh
```

**Output**: `data/final/{PROJECT}_training.jsonl`

**Time**: 8-12 hours for 60,000 issues

### Interrupting and Resuming

**Can I stop the pipeline?**

✅ **YES!** Press `Ctrl+C` at any time.

- Progress is automatically saved every 25 issues
- Simply run the same command again to resume
- Checkpoint files are stored in `data/checkpoints/`

**Example:**
```bash
./scripts/run_scraper.sh
# ... scraping ...
# Press Ctrl+C
^C
⚠️  Interrupted by user. Progress has been saved to checkpoints.

# Resume later
./scripts/run_scraper.sh
# Continues from where you left off!
```

---

## 📄 Output Format

### JSONL Structure

Each line in the output JSONL file is a complete training example:

#### Summarization Task

```json
{
  "task_type": "summarization",
  "instruction": "Summarize the following software issue in 2-3 sentences.",
  "input": "Issue: KAFKA-19703\nTitle: Remove unsupported upgrade from versions\n\nDescription: With AK 4.0.0 release, we should clean up some backward compatibility code in Kafka Streams...",
  "output": "This issue addresses the need to clean up backward compatibility code in Kafka Streams after dropping support for direct upgrades from versions 2.3 and older. The task involves updating UpgradeFromValues.java to remove obsolete version references. This is part of maintaining code quality after the 4.0.0 release.",
  "metadata": {
    "issue_key": "KAFKA-19703",
    "project": "KAFKA",
    "issue_type": "Improvement",
    "priority": "Minor",
    "created": "2025-09-12T01:28:26.000+0000",
    "model": "gemini-2.0-flash-exp",
    "generated_at": "2025-11-02T15:30:00Z"
  }
}
```

#### Classification Task

```json
{
  "task_type": "classification",
  "instruction": "Classify the type of this software issue.",
  "input": "Issue: KAFKA-19703\n...",
  "output": "improvement",
  "metadata": {
    "issue_key": "KAFKA-19703",
    "project": "KAFKA",
    "classification_type": "issue_type",
    "reasoning": "This is a code cleanup task to remove deprecated code"
  }
}
```

#### Q&A Task

```json
{
  "task_type": "qna",
  "instruction": "Answer the following question based on the software issue context.",
  "input": {
    "context": "Issue: KAFKA-19703\n...",
    "question": "Which component needs to be updated?"
  },
  "output": "The UpgradeFromValues.java file in the Kafka Streams module needs to be updated to remove references to unsupported versions 2.3 and older.",
  "metadata": {
    "issue_key": "KAFKA-19703",
    "project": "KAFKA"
  }
}
```

### Output Files

```
data/final/
├── KAFKA_training.jsonl      # ~150,000 examples (18k issues × 8)
├── HADOOP_training.jsonl     # ~200,000 examples (25k issues × 8)
├── SPARK_training.jsonl      # ~130,000 examples (16k issues × 8)
└── combined_training.jsonl   # ~480,000 total examples
```

---

## 💾 Checkpoint System

### How It Works

The checkpoint system ensures you never lose progress:

1. **Automatic Saves**: Every 25 issues processed
2. **Atomic Writes**: Uses temp file + rename for safety
3. **Project-Specific**: Each project has its own checkpoint
4. **Resume Logic**: Automatically detects and resumes from last checkpoint

### Checkpoint File Format

`data/checkpoints/KAFKA.json`:

```json
{
  "project": "KAFKA",
  "lastStartAt": 2500,
  "lastProcessedIssue": "KAFKA-15432",
  "totalIssues": 18584,
  "scrapedCount": 2543,
  "lastSuccessfulFetch": "2025-11-02T14:23:45Z",
  "lastUpdateCheck": "2025-11-02T00:00:00Z",
  "status": "in_progress",
  "metadata": {
    "version": "1.0.0",
    "savedAt": "2025-11-02T14:23:45Z"
  }
}
```

### Manual Checkpoint Operations

**View Checkpoint Status:**

```bash
cat data/checkpoints/KAFKA.json | jq '.scrapedCount, .totalIssues'
```

**Start Fresh (Delete Checkpoints):**

```bash
rm data/checkpoints/*.json
```

**Resume from Specific Point (Advanced):**

Edit checkpoint file manually, then re-run scraper.

---

## 🔄 Incremental Updates

### Fetch Only New/Updated Issues

After the initial scrape, subsequent runs will only fetch issues that have been created or updated since the last run.

### How to Use

1. **Initial Scrape** (full)
   ```bash
   ./scripts/run_scraper.sh
   # Scrapes all 60,000 issues
   ```

2. **Wait** (days/weeks pass, new issues are created)

3. **Incremental Update**
   ```bash
   ./scripts/run_scraper.sh
   # Only fetches new/updated issues!
   ```

### Under the Hood

- Checkpoint stores `lastUpdateCheck` timestamp
- Uses JQL query: `project=KAFKA AND updated >= "2025-11-01 14:00"`
- Merges new data with existing `data/raw/{PROJECT}_issues.json`
- Re-processes only changed issues through Gemini

### Forcing Full Rescrape

```bash
rm data/checkpoints/*.json
rm data/raw/*.json
./scripts/run_scraper.sh
```

---

## ⚡ Performance

### Expected Runtime (60,000 issues)

| Phase | Duration | Rate |
|-------|----------|------|
| Scraping | 4-6 hours | ~200 issues/min |
| LLM Processing | 8-12 hours | ~80 issues/min |
| **Total** | **12-18 hours** | - |

### Factors Affecting Performance

**Scraping Speed:**
- Jira API response time
- Network latency
- Rate limiting (respectful delays)
- Number of comments per issue

**LLM Processing Speed:**
- Gemini API rate limits (even with pro)
- Token usage per issue
- Retry attempts on errors

### Optimization Tips

1. **Increase Concurrency** (if your network can handle it):
   ```yaml
   scraping:
     max_concurrent_requests: 15  # Default: 10
   ```

2. **Reduce Q&A Pairs** (if speed > diversity):
   ```yaml
   tasks:
     qna:
       pairs_per_issue: 3  # Default: 5
   ```

3. **Disable Comments** (faster scraping, less context):
   ```yaml
   scraping:
     fetch_comments: false
   ```

### Memory Usage

- **Scraper**: ~200-300 MB (streaming processing)
- **Processor**: ~500-800 MB (batch processing with streaming JSONL)
- **Peak**: ~1 GB total

Large issue descriptions are automatically truncated to prevent memory issues.

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "GEMINI_API_KEY not set"

**Problem**: API key environment variable is missing.

**Solution**:
```bash
export GEMINI_API_KEY='your-key-here'
```

To make permanent:
```bash
echo "export GEMINI_API_KEY='your-key-here'" >> ~/.bashrc
source ~/.bashrc
```

#### 2. "Rate limit hit"

**Problem**: Making too many requests to Jira/Gemini API.

**Solution**: The system automatically handles this with exponential backoff. Just wait - it will retry.

**Manual adjustment**:
```yaml
scraping:
  rate_limit_delay: 200  # Increase from 100ms
```

#### 3. "Failed to fetch comments"

**Problem**: Some issues may have restricted access or deleted comments.

**Solution**: Non-fatal error - scraper logs warning and continues. Check `logs/` for details.

#### 4. "Out of memory"

**Problem**: Processing very large issues.

**Solution**: Already handled - descriptions auto-truncate at 3000 chars. If still occurring, reduce concurrency:

```yaml
scraping:
  max_concurrent_requests: 5  # Reduce from 10
```

#### 5. "Empty response from Gemini API"

**Problem**: API returned no content (rare).

**Solution**: Automatically retries up to 5 times. If persistent:
- Check API key validity
- Check Gemini API status
- Check network connection

#### 6. "Checkpoint corrupted"

**Problem**: Checkpoint JSON file is malformed.

**Solution**:
```bash
# Delete corrupt checkpoint
rm data/checkpoints/KAFKA.json

# Scraper will start fresh for that project
./scripts/run_scraper.sh
```

### Logs

**Location**: `logs/`

- `combined-{DATE}.log` - All logs (JSON format)
- `error-{DATE}.log` - Errors only

**View logs**:
```bash
# Tail combined log
tail -f logs/combined-$(date +%Y-%m-%d).log

# Search for errors
grep "ERROR" logs/combined-*.log

# Pretty-print JSON logs
cat logs/combined-*.log | jq '.'
```

### Getting Help

1. **Check logs** in `logs/` directory
2. **Review configuration** in `config/config.yaml`
3. **Verify checkpoints** in `data/checkpoints/`
4. **Test API connection** manually:
   ```bash
   curl "https://issues.apache.org/jira/rest/api/2/project"
   ```

---

## 📁 Project Structure

```
jira-llm-pipeline/
├── config/
│   ├── config.yaml           # Main configuration
│   └── projects.json         # Auto-selected projects metadata
├── src/
│   ├── scraper/              # JavaScript scraping layer
│   │   ├── JiraScraper.js   # Main scraper orchestrator
│   │   ├── ApiClient.js     # HTTP client with retry
│   │   ├── CheckpointManager.js  # Resume functionality
│   │   ├── RateLimiter.js   # Rate limiting logic
│   │   ├── ProjectSelector.js    # Auto-select projects
│   │   ├── IncrementalUpdater.js # Incremental updates
│   │   └── index.js         # Entry point
│   ├── processor/            # Python LLM processing layer
│   │   ├── gemini_client.py # Gemini API wrapper
│   │   ├── task_generator.py     # Generate training tasks
│   │   ├── data_transformer.py   # JSONL output
│   │   └── main.py          # Entry point
│   └── utils/
│       ├── logger.js         # Winston logger
│       └── validator.py      # Data validation
├── data/
│   ├── raw/                  # Scraped JSON (gitignored)
│   ├── checkpoints/          # Resume points (gitignored)
│   ├── processed/            # Intermediate (gitignored)
│   └── final/                # Training JSONL (gitignored)
├── logs/                     # Log files (gitignored)
├── docs/
│   ├── ARCHITECTURE.md       # Detailed system design
│   └── EDGE_CASES.md        # All handled edge cases
├── scripts/
│   ├── setup.sh              # Environment setup
│   ├── run_scraper.sh       # Run scraping phase
│   ├── run_processor.sh     # Run LLM processing
│   └── run_pipeline.sh      # Full end-to-end
├── .gitignore
├── package.json              # Node.js dependencies
├── requirements.txt          # Python dependencies
└── README.md                 # This file
```

---

## 🔒 Security & Privacy

- ✅ No API keys are stored in code or config files
- ✅ All sensitive data read from environment variables
- ✅ Logs do not contain API keys
- ✅ Data is public (Apache Jira is public)
- ✅ JSONL output contains no personally identifiable information

---

## 📊 Data Statistics

### Expected Output (for 60,000 issues)

| Metric | Value |
|--------|-------|
| Total Issues | ~60,000 |
| Training Examples | ~480,000 (8 per issue) |
| Summarization Tasks | ~60,000 |
| Classification Tasks | ~120,000 |
| Q&A Pairs | ~300,000 |
| Total JSONL Size | ~5-8 GB |

### Quality Metrics

- **Average Summary Length**: 100-150 words
- **Average Input Context**: 800-1500 characters
- **Average Output Length**: 50-200 characters
- **Task Distribution**: 12.5% summary, 25% classification, 62.5% Q&A

---

## 🤝 Contributing

Contributions are welcome! Areas for improvement:

- [ ] Add support for more Jira instances (beyond Apache)
- [ ] Support other LLM providers (OpenAI, Anthropic, etc.)
- [ ] Add unit tests
- [ ] Docker containerization
- [ ] Web UI for monitoring progress
- [ ] Advanced filtering (by date range, labels, etc.)

---

## 📝 License

MIT License - see LICENSE file for details.

---

## 🙏 Acknowledgments

- **Apache Software Foundation** for public Jira data
- **Google** for Gemini API
- **Open Source Community** for amazing libraries

---

## 📞 Support

**Issues?** Check:
1. This README (especially Troubleshooting section)
2. `docs/ARCHITECTURE.md` for design details
3. `docs/EDGE_CASES.md` for known issues
4. Logs in `logs/` directory

---

**Built with ❤️ for the LLM community**

*Last Updated: November 2, 2025*
