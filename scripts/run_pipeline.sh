#!/bin/bash
# Run complete pipeline: scrape → process → output

set -e

echo "🚀 Starting Jira LLM Pipeline"
echo "=============================="
echo ""

# Check setup
if [ ! -d "node_modules" ] || [ ! -d "venv" ]; then
    echo "❌ Project not set up. Running setup first..."
    ./scripts/setup.sh
    echo ""
fi

# Check for API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ GEMINI_API_KEY not set in environment"
    echo ""
    echo "Please set your API key:"
    echo "  export GEMINI_API_KEY='your-key-here'"
    echo ""
    echo "Then run this script again."
    exit 1
fi

# Record start time
START_TIME=$(date +%s)

# Step 1: Scrape Jira data
echo ""
echo "📥 STEP 1/3: Scraping Jira issues..."
echo "------------------------------------"
./scripts/run_scraper.sh

if [ $? -ne 0 ]; then
    echo "❌ Scraping failed. Stopping pipeline."
    exit 1
fi

# Step 2: Process with Gemini
echo ""
echo "🤖 STEP 2/3: Generating LLM training tasks..."
echo "---------------------------------------------"
./scripts/run_processor.sh

if [ $? -ne 0 ]; then
    echo "❌ Processing failed. Stopping pipeline."
    exit 1
fi

# Step 3: Generate report
echo ""
echo "📊 STEP 3/3: Generating statistics..."
echo "-------------------------------------"

source venv/bin/activate

python3 << 'EOF'
import json
from pathlib import Path

print("\nFinal Statistics:")
print("=" * 60)

total = 0
projects_stats = {}

# Count examples per project
for file in Path('data/final').glob('*_training.jsonl'):
    count = sum(1 for _ in open(file))
    project = file.stem.replace('_training', '')
    projects_stats[project] = count
    total += count
    print(f"  {project}: {count:,} examples")

print(f"\nTotal: {total:,} training examples")
print("=" * 60)

# Calculate expected vs actual
expected_per_issue = 8  # 1 summary + 2 classification + 5 Q&A
print(f"\nExpected: ~{expected_per_issue} training examples per issue")

if total > 0:
    estimated_issues = total // expected_per_issue
    print(f"Estimated issues processed: ~{estimated_issues:,}")

EOF

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
HOURS=$((DURATION / 3600))
MINUTES=$(((DURATION % 3600) / 60))

echo ""
echo "=" * 60
echo "✅ Pipeline complete!"
echo "=" * 60
echo ""
echo "Total Duration: ${HOURS}h ${MINUTES}m"
echo "Output Directory: data/final/"
echo ""
echo "Generated Files:"
ls -lh data/final/*.jsonl 2>/dev/null | awk '{print "  " $9, "(" $5 ")"}'
echo ""
echo "Next Steps:"
echo "  - Review output in data/final/"
echo "  - Use JSONL files for LLM fine-tuning"
echo "  - Check logs/ for detailed execution logs"
echo ""
