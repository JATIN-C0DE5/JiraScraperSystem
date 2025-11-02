#!/bin/bash
# Verify installation and readiness

echo "🔍 Verifying Jira LLM Pipeline Installation"
echo "=============================================="
echo ""

EXIT_CODE=0

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js: $NODE_VERSION"
else
    echo "❌ Node.js not found"
    EXIT_CODE=1
fi

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✅ Python: $PYTHON_VERSION"
else
    echo "❌ Python3 not found"
    EXIT_CODE=1
fi

# Check npm packages
if [ -d "node_modules" ]; then
    echo "✅ Node.js dependencies installed"
else
    echo "⚠️  Node.js dependencies not installed (run ./scripts/setup.sh)"
    EXIT_CODE=1
fi

# Check Python virtual environment
if [ -d "venv" ]; then
    echo "✅ Python virtual environment exists"
else
    echo "⚠️  Python virtual environment not found (run ./scripts/setup.sh)"
    EXIT_CODE=1
fi

# Check API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠️  GEMINI_API_KEY not set"
    EXIT_CODE=1
else
    echo "✅ GEMINI_API_KEY is set"
fi

# Check directory structure
REQUIRED_DIRS=("data/raw" "data/checkpoints" "data/processed" "data/final" "logs" "config" "src/scraper" "src/processor" "scripts" "docs")
MISSING_DIRS=0

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        : # Directory exists, do nothing
    else
        echo "⚠️  Missing directory: $dir"
        MISSING_DIRS=$((MISSING_DIRS + 1))
        EXIT_CODE=1
    fi
done

if [ $MISSING_DIRS -eq 0 ]; then
    echo "✅ All required directories exist"
fi

# Check configuration files
if [ -f "config/config.yaml" ]; then
    echo "✅ Configuration file exists"
else
    echo "❌ config/config.yaml not found"
    EXIT_CODE=1
fi

# Check scripts are executable
SCRIPTS=("scripts/setup.sh" "scripts/run_scraper.sh" "scripts/run_processor.sh" "scripts/run_pipeline.sh")
NON_EXECUTABLE=0

for script in "${SCRIPTS[@]}"; do
    if [ -x "$script" ]; then
        : # Script is executable
    else
        echo "⚠️  Script not executable: $script"
        NON_EXECUTABLE=$((NON_EXECUTABLE + 1))
        EXIT_CODE=1
    fi
done

if [ $NON_EXECUTABLE -eq 0 ]; then
    echo "✅ All scripts are executable"
fi

# Summary
echo ""
echo "=============================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Installation verified successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Ensure GEMINI_API_KEY is set (if not already):"
    echo "     export GEMINI_API_KEY='your-key-here'"
    echo ""
    echo "  2. Run the pipeline:"
    echo "     ./scripts/run_pipeline.sh"
else
    echo "⚠️  Installation incomplete"
    echo ""
    echo "Please run: ./scripts/setup.sh"
fi
echo ""

exit $EXIT_CODE
