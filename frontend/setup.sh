#!/bin/bash

# ============================================
# Frontend Setup Script
# ============================================
# This script automates the frontend setup process
# including dependency installation and environment configuration.

set -e  # Exit on any error

echo "============================================"
echo "Frontend Setup Script"
echo "============================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js version 18 or higher is required"
    echo "Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed"
    exit 1
fi

echo "✅ npm version: $(npm --version)"
echo ""

# Navigate to frontend directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "📁 Working directory: $SCRIPT_DIR"
echo ""

# Check if .env file exists, if not create from example
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "📝 Creating .env file from .env.example..."
        cp .env.example .env
        echo "✅ .env file created"
        echo ""
        echo "⚠️  IMPORTANT: Please review and update the .env file with your configuration:"
        echo "   - VITE_API_URL (default: http://localhost:3001)"
        echo "   - VITE_SESSION_KEY (MUST be changed for production!)"
        echo ""
    else
        echo "⚠️  Warning: No .env.example file found"
        echo "Creating basic .env file..."
        cat > .env << 'EOF'
# API Configuration
VITE_API_URL=http://localhost:3001

# WebSocket Configuration
VITE_WS_URL=ws://localhost:3001

# Environment
VITE_ENV=development

# Security - Session Encryption Key (CHANGE THIS IN PRODUCTION!)
VITE_SESSION_KEY=change-this-to-a-random-32-character-string-in-production

# Feature Flags
VITE_ENABLE_PWA=true
VITE_ENABLE_ANALYTICS=false
EOF
        echo "✅ Basic .env file created"
        echo ""
    fi
else
    echo "✅ .env file already exists"
    echo ""
fi

# Clean install if requested
if [ "$1" == "--clean" ] || [ "$1" == "-c" ]; then
    echo "🧹 Cleaning previous installation..."
    rm -rf node_modules
    rm -f package-lock.json
    echo "✅ Clean completed"
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
echo "This may take a few minutes..."
echo ""

npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dependencies installed successfully!"
    echo ""
else
    echo ""
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Run TypeScript type checking
echo "🔍 Running TypeScript type checking..."
npm run typecheck

if [ $? -eq 0 ]; then
    echo "✅ TypeScript type checking passed!"
    echo ""
else
    echo "⚠️  TypeScript type checking found issues"
    echo "Please review and fix the errors above"
    echo ""
fi

# Display summary
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Review and update .env file with your configuration"
echo "   Especially: VITE_SESSION_KEY for production!"
echo ""
echo "2. Start development server:"
echo "   npm run dev"
echo ""
echo "3. Build for production:"
echo "   npm run build"
echo ""
echo "4. Run tests:"
echo "   npm test"
echo ""
echo "📚 Available commands:"
echo "   npm run dev        - Start development server"
echo "   npm run build      - Build for production"
echo "   npm run preview    - Preview production build"
echo "   npm test           - Run tests"
echo "   npm run typecheck  - Type checking"
echo "   npm run lint       - Run linter"
echo "   npm run format     - Format code"
echo ""
echo "Happy coding! 🚀"
echo ""
