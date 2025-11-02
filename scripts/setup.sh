#!/bin/bash
# Setup environment and install dependencies

set -e

echo "🚀 Setting up Jira LLM Pipeline..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher (found: $(node --version))"
    exit 1
fi

echo "✓ Node.js $(node --version) found"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Please install Python 3.10+"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "✓ Python $PYTHON_VERSION found"

# Install Node.js dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
npm install
echo "✓ Node.js dependencies installed"

# Create Python virtual environment
echo ""
echo "🐍 Setting up Python virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists, skipping creation"
else
    python3 -m venv venv
    echo "✓ Virtual environment created"
fi

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
echo ""
echo "📦 Upgrading pip..."
pip install --upgrade pip --quiet

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt --quiet
echo "✓ Python dependencies installed"

# Create directory structure
echo ""
echo "📁 Creating directory structure..."
mkdir -p data/{raw,checkpoints,processed,final}
mkdir -p logs
mkdir -p config
echo "✓ Directories created"

# Make scripts executable
echo ""
echo "🔧 Making scripts executable..."
chmod +x scripts/*.sh
echo "✓ Scripts are executable"

# Check for API key
echo ""
if [ -z "$GEMINI_API_KEY" ]; then
    echo "⚠️  GEMINI_API_KEY not set in environment"
    echo ""
    echo "To set your API key, run:"
    echo "  export GEMINI_API_KEY='your-key-here'"
    echo ""
    echo "Or add it to your ~/.bashrc or ~/.zshrc:"
    echo "  echo \"export GEMINI_API_KEY='your-key-here'\" >> ~/.bashrc"
else
    echo "✓ GEMINI_API_KEY is set"
fi

echo ""
echo "=" * 60
echo "✅ Setup complete!"
echo "=" * 60
echo ""
echo "Next steps:"
echo "1. Set your Gemini API key (if not already set):"
echo "     export GEMINI_API_KEY='your-key-here'"
echo ""
echo "2. Run the scraper:"
echo "     npm run scrape"
echo "   Or:"
echo "     ./scripts/run_scraper.sh"
echo ""
echo "3. Process data with Gemini:"
echo "     ./scripts/run_processor.sh"
echo ""
echo "4. Or run the complete pipeline:"
echo "     ./scripts/run_pipeline.sh"
echo ""
