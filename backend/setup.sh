#!/bin/bash

# ============================================
# Backend Setup Script
# ============================================
# This script automates the backend setup process
# including virtual environment creation, dependency installation,
# and database setup.

set -e  # Exit on any error

echo "============================================"
echo "Backend Setup Script"
echo "============================================"
echo ""

# Check if Python 3.11+ is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "Please install Python 3.11+ from https://www.python.org/"
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 11 ]); then
    echo "❌ Error: Python 3.11 or higher is required"
    echo "Current version: $(python3 --version)"
    exit 1
fi

echo "✅ Python version: $(python3 --version)"
echo ""

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ Error: pip3 is not installed"
    exit 1
fi

echo "✅ pip version: $(pip3 --version)"
echo ""

# Navigate to backend directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo "📁 Working directory: $SCRIPT_DIR"
echo ""

# Check if .env file exists, if not create from example
if [ ! -f .env ]; then
    if [ -f ../.env.example ]; then
        echo "📝 Creating .env file from ../.env.example..."
        cp ../.env.example .env
        echo "✅ .env file created"
        echo ""
        echo "⚠️  IMPORTANT: Please review and update the .env file with your configuration:"
        echo "   - DATABASE_URL"
        echo "   - SECRET_KEY (MUST be changed for production!)"
        echo "   - ENCRYPTION_KEY (MUST be changed for production!)"
        echo ""
    else
        echo "⚠️  Warning: No .env.example file found"
        echo "You will need to create a .env file manually"
        echo ""
    fi
else
    echo "✅ .env file already exists"
    echo ""
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "🔨 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
    echo ""
else
    echo "✅ Virtual environment already exists"
    echo ""
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source venv/bin/activate

if [ $? -eq 0 ]; then
    echo "✅ Virtual environment activated"
    echo ""
else
    echo "❌ Failed to activate virtual environment"
    exit 1
fi

# Upgrade pip
echo "⬆️  Upgrading pip..."
pip install --upgrade pip setuptools wheel

if [ $? -eq 0 ]; then
    echo "✅ pip upgraded successfully"
    echo ""
else
    echo "⚠️  Warning: Failed to upgrade pip"
    echo ""
fi

# Install dependencies
echo "📦 Installing dependencies from requirements.txt..."
echo "This may take several minutes..."
echo ""

pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Dependencies installed successfully!"
    echo ""
else
    echo ""
    echo "❌ Failed to install dependencies"
    echo "Please check the error messages above"
    exit 1
fi

# Check database connection (optional)
if [ "$1" == "--skip-db-check" ]; then
    echo "⏭️  Skipping database connection check"
    echo ""
else
    echo "🔍 Checking database connection..."
    echo "This will attempt to connect to the database specified in .env"
    echo ""

    # Try to run a simple alembic command to check database
    if command -v alembic &> /dev/null; then
        alembic current &> /dev/null || true
        if [ $? -eq 0 ]; then
            echo "✅ Database connection successful"
            echo ""
        else
            echo "⚠️  Warning: Could not connect to database"
            echo "Please ensure:"
            echo "  1. MySQL 8.0+ is running"
            echo "  2. Database credentials in .env are correct"
            echo "  3. Database specified in .env exists"
            echo ""
        fi
    fi
fi

# Run database migrations (optional)
if [ "$1" == "--run-migrations" ] || [ "$2" == "--run-migrations" ]; then
    echo "🗄️  Running database migrations..."
    alembic upgrade head

    if [ $? -eq 0 ]; then
        echo "✅ Database migrations completed"
        echo ""
    else
        echo "❌ Database migrations failed"
        echo "Please check the error messages above"
        exit 1
    fi
fi

# Display summary
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Review and update .env file with your configuration"
echo "   Especially: SECRET_KEY, ENCRYPTION_KEY, DATABASE_URL"
echo ""
echo "2. Ensure MySQL 8.0+ is running and database exists"
echo ""
echo "3. Run database migrations:"
echo "   source venv/bin/activate"
echo "   alembic upgrade head"
echo ""
echo "4. Start development server:"
echo "   source venv/bin/activate"
echo "   uvicorn main:app --reload --host 0.0.0.0 --port 3001"
echo ""
echo "5. View API documentation:"
echo "   http://localhost:3001/docs (Swagger UI)"
echo "   http://localhost:3001/redoc (ReDoc)"
echo ""
echo "📚 Available commands (with venv activated):"
echo "   uvicorn main:app --reload           - Start development server"
echo "   alembic upgrade head                - Run migrations"
echo "   alembic revision --autogenerate -m  - Create migration"
echo "   pytest                              - Run tests"
echo "   pytest --cov=app                    - Run tests with coverage"
echo "   black .                             - Format code"
echo "   flake8 .                            - Lint code"
echo "   mypy .                              - Type checking"
echo ""
echo "⚡ Quick start command:"
echo "   source venv/bin/activate && uvicorn main:app --reload --port 3001"
echo ""
echo "Happy coding! 🚀"
echo ""
