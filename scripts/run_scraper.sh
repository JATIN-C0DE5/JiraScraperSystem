#!/bin/bash
# Run Jira scraper

set -e

echo "📥 Starting Jira Scraper..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "❌ Dependencies not installed. Please run:"
    echo "   ./scripts/setup.sh"
    exit 1
fi

# Run scraper
echo "Scraping Jira issues from Apache projects..."
echo "This may take several hours depending on the number of issues."
echo ""
echo "💡 Tip: You can stop the scraper at any time (Ctrl+C)."
echo "         Progress is automatically saved and can be resumed."
echo ""

node src/scraper/index.js

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Scraping completed successfully!"
    echo "Output: data/raw/"
else
    echo ""
    echo "⚠️  Scraping stopped with errors"
    echo "Check logs/ for details"
    echo "Progress has been saved - you can resume by running this script again"
    exit $EXIT_CODE
fi
