#!/bin/bash
#
# Onboarding Test Runner
#
# This script runs the onboarding tests and provides clear feedback.
# It's designed to be run in the Docker container or locally.
#
# Usage:
#   ./run_onboarding_tests.sh              # Run all onboarding tests
#   ./run_onboarding_tests.sh -v           # Run with verbose output
#   ./run_onboarding_tests.sh --integration # Run only integration tests
#   ./run_onboarding_tests.sh --unit       # Run only unit tests

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Onboarding Test Suite Runner${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo -e "${RED}❌ pytest is not installed${NC}"
    echo "Installing pytest..."
    pip install pytest pytest-asyncio
fi

# Default test path
TEST_PATH="tests/test_onboarding_integration.py"
PYTEST_ARGS="-v"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--verbose)
            PYTEST_ARGS="-vv -s"
            shift
            ;;
        --integration)
            TEST_PATH="tests/test_onboarding_integration.py"
            shift
            ;;
        --unit)
            TEST_PATH="tests/test_onboarding_service.py"
            shift
            ;;
        --all)
            TEST_PATH="tests/test_onboarding*.py"
            shift
            ;;
        *)
            echo -e "${YELLOW}Unknown option: $1${NC}"
            shift
            ;;
    esac
done

echo -e "${BLUE}Running tests: ${TEST_PATH}${NC}"
echo ""

# Run the tests
if pytest $TEST_PATH $PYTEST_ARGS; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  ✅ All tests passed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  ❌ Tests failed${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi
