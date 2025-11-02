#!/bin/bash
# Run LLM processor

set -e

echo "🤖 Starting LLM Processor..."
echo ""

# Check for virtual environment
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run:"
    echo "   ./scripts/setup.sh"
    exit 1
fi

# Activate virtual environment
source venv/bin/activate

# Check for API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ GEMINI_API_KEY not set in environment"
    echo ""
    echo "Please set your API key:"
    echo "  export GEMINI_API_KEY='your-key-here'"
    exit 1
fi

# Check if scraped data exists
if [ ! -d "data/raw" ] || [ -z "$(ls -A data/raw/*.json 2>/dev/null)" ]; then
    echo "❌ No scraped data found in data/raw/"
    echo "Please run the scraper first:"
    echo "  ./scripts/run_scraper.sh"
    exit 1
fi

# Run processor
echo "Processing scraped data with Gemini API..."
echo "This may take several hours depending on the number of issues."
echo ""

python3 src/processor/main.py

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Processing completed successfully!"
    echo "Output: data/final/"
else
    echo ""
    echo "⚠️  Processing stopped with errors"
    echo "Check output above for details"
    exit $EXIT_CODE
fi
