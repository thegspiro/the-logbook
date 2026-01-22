#!/bin/bash

# ============================================
# The Logbook - Master Setup Script
# ============================================
# This script sets up both frontend and backend components
# of The Logbook application.

set -e  # Exit on any error

echo "============================================"
echo "The Logbook - Master Setup Script"
echo "============================================"
echo ""
echo "This script will set up both frontend and backend components."
echo ""

# Check if running from project root
if [ ! -f "README.md" ] || [ ! -d "frontend" ] || [ ! -d "backend" ]; then
    echo "❌ Error: This script must be run from the project root directory"
    echo "Expected structure:"
    echo "  - README.md"
    echo "  - frontend/"
    echo "  - backend/"
    exit 1
fi

PROJECT_ROOT="$(pwd)"
echo "📁 Project root: $PROJECT_ROOT"
echo ""

# Parse arguments
CLEAN_INSTALL=false
SKIP_DB_CHECK=false
RUN_MIGRATIONS=false
FRONTEND_ONLY=false
BACKEND_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean|-c)
            CLEAN_INSTALL=true
            shift
            ;;
        --skip-db-check)
            SKIP_DB_CHECK=true
            shift
            ;;
        --run-migrations)
            RUN_MIGRATIONS=true
            shift
            ;;
        --frontend-only)
            FRONTEND_ONLY=true
            shift
            ;;
        --backend-only)
            BACKEND_ONLY=true
            shift
            ;;
        --help|-h)
            echo "Usage: ./setup.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --clean, -c          Clean install (removes node_modules and venv)"
            echo "  --skip-db-check      Skip database connection check"
            echo "  --run-migrations     Run database migrations after setup"
            echo "  --frontend-only      Only setup frontend"
            echo "  --backend-only       Only setup backend"
            echo "  --help, -h           Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help to see available options"
            exit 1
            ;;
    esac
done

# Setup Frontend
if [ "$BACKEND_ONLY" = false ]; then
    echo "============================================"
    echo "1. Frontend Setup"
    echo "============================================"
    echo ""

    cd "$PROJECT_ROOT/frontend"

    if [ "$CLEAN_INSTALL" = true ]; then
        ./setup.sh --clean
    else
        ./setup.sh
    fi

    if [ $? -ne 0 ]; then
        echo "❌ Frontend setup failed"
        exit 1
    fi

    echo ""
fi

# Setup Backend
if [ "$FRONTEND_ONLY" = false ]; then
    echo "============================================"
    echo "2. Backend Setup"
    echo "============================================"
    echo ""

    cd "$PROJECT_ROOT/backend"

    BACKEND_ARGS=""
    if [ "$SKIP_DB_CHECK" = true ]; then
        BACKEND_ARGS="$BACKEND_ARGS --skip-db-check"
    fi
    if [ "$RUN_MIGRATIONS" = true ]; then
        BACKEND_ARGS="$BACKEND_ARGS --run-migrations"
    fi

    ./setup.sh $BACKEND_ARGS

    if [ $? -ne 0 ]; then
        echo "❌ Backend setup failed"
        exit 1
    fi

    echo ""
fi

# Return to project root
cd "$PROJECT_ROOT"

# Final summary
echo "============================================"
echo "🎉 Complete Setup Finished!"
echo "============================================"
echo ""
echo "Both frontend and backend have been set up successfully!"
echo ""
echo "📋 Quick Start Guide:"
echo ""
echo "1. Start Backend (Terminal 1):"
echo "   cd backend"
echo "   source venv/bin/activate"
echo "   uvicorn main:app --reload --port 3001"
echo ""
echo "2. Start Frontend (Terminal 2):"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "3. Access the application:"
echo "   Frontend: http://localhost:5173"
echo "   Backend API Docs: http://localhost:3001/docs"
echo ""
echo "📚 Documentation:"
echo "   - README.md - Project overview"
echo "   - QUICK_START_GITHUB.md - Quick start guide"
echo "   - docs/DEPLOYMENT.md - Deployment instructions"
echo "   - docs/TRAINING_PROGRAMS.md - Training module docs"
echo ""
echo "🐳 Docker (Alternative):"
echo "   docker-compose up -d"
echo ""
echo "Happy coding! 🚀"
echo ""
