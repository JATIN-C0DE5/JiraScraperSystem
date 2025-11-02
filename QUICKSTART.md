# Quick Start Guide

Get the Jira LLM Pipeline running in 5 minutes!

## Prerequisites Check

```bash
node --version    # Should be 18+
python3 --version # Should be 3.10+
```

## Installation (2 minutes)

```bash
# 1. Navigate to project
cd jira-llm-pipeline

# 2. Run setup
./scripts/setup.sh

# 3. Set API key
export GEMINI_API_KEY='your-api-key-here'
```

## Run Complete Pipeline (12-18 hours)

```bash
./scripts/run_pipeline.sh
```

That's it! The pipeline will:
- ✅ Auto-select 3 high-quality Apache projects
- ✅ Scrape all issues (~60,000 total)
- ✅ Generate 8 training tasks per issue
- ✅ Output ~480,000 training examples to `data/final/`

## Interrupt & Resume

Press `Ctrl+C` anytime. Progress is auto-saved every 25 issues.

Run the same command again to resume from where you left off!

## Check Progress

```bash
# View checkpoint status
cat data/checkpoints/KAFKA.json | jq '.scrapedCount, .totalIssues'

# Monitor logs (in another terminal)
tail -f logs/combined-$(date +%Y-%m-%d).log
```

## Output

After completion, you'll find:

```
data/final/
├── KAFKA_training.jsonl       # ~150,000 examples
├── HADOOP_training.jsonl      # ~200,000 examples  
├── SPARK_training.jsonl       # ~130,000 examples
└── combined_training.jsonl    # ~480,000 total examples
```

## Next Steps

Use these JSONL files to fine-tune your LLM model!

**Need help?** See the full [README.md](README.md)
