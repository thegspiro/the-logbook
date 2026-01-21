#!/bin/bash
# ============================================
# Build and Push Docker Images to ghcr.io
# ============================================
#
# This script builds both frontend and backend Docker images
# and pushes them to GitHub Container Registry.
#
# Usage:
#   ./scripts/build-and-push-images.sh
#
# Prerequisites:
#   - Docker installed
#   - Logged into ghcr.io (see DOCKER-BUILD-PUBLISH.md)
#
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
GITHUB_USERNAME="thegspiro"
REPO_NAME="the-logbook"
BACKEND_IMAGE="ghcr.io/${GITHUB_USERNAME}/${REPO_NAME}-backend"
FRONTEND_IMAGE="ghcr.io/${GITHUB_USERNAME}/${REPO_NAME}-frontend"

# Get version tag (optional)
VERSION_TAG="${1:-latest}"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Building and Publishing The Logbook Images${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "${YELLOW}GitHub Username:${NC} ${GITHUB_USERNAME}"
echo -e "${YELLOW}Repository:${NC} ${REPO_NAME}"
echo -e "${YELLOW}Version Tag:${NC} ${VERSION_TAG}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Docker is not running${NC}"
    echo "Please start Docker and try again"
    exit 1
fi

# Check if logged into GitHub Container Registry
if ! docker pull ghcr.io/hello-world > /dev/null 2>&1; then
    echo -e "${YELLOW}WARNING: You may not be logged into GitHub Container Registry${NC}"
    echo ""
    echo "To login, run:"
    echo "  echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u ${GITHUB_USERNAME} --password-stdin"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get project root (script is in scripts/ directory)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"

echo -e "${YELLOW}Project root:${NC} ${PROJECT_ROOT}"
echo ""

# ============================================
# Build Backend
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Step 1/4: Building Backend Image${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

cd "${PROJECT_ROOT}/backend"

echo -e "${YELLOW}Building: ${BACKEND_IMAGE}:${VERSION_TAG}${NC}"
docker build --target production -t "${BACKEND_IMAGE}:${VERSION_TAG}" .

# Also tag as latest if building a version tag
if [ "${VERSION_TAG}" != "latest" ]; then
    echo -e "${YELLOW}Tagging as latest${NC}"
    docker tag "${BACKEND_IMAGE}:${VERSION_TAG}" "${BACKEND_IMAGE}:latest"
fi

echo -e "${GREEN}✓ Backend image built successfully${NC}"
echo ""

# ============================================
# Build Frontend
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Step 2/4: Building Frontend Image${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

cd "${PROJECT_ROOT}/frontend"

echo -e "${YELLOW}Building: ${FRONTEND_IMAGE}:${VERSION_TAG}${NC}"
docker build --target production -t "${FRONTEND_IMAGE}:${VERSION_TAG}" .

# Also tag as latest if building a version tag
if [ "${VERSION_TAG}" != "latest" ]; then
    echo -e "${YELLOW}Tagging as latest${NC}"
    docker tag "${FRONTEND_IMAGE}:${VERSION_TAG}" "${FRONTEND_IMAGE}:latest"
fi

echo -e "${GREEN}✓ Frontend image built successfully${NC}"
echo ""

# ============================================
# Push Backend
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Step 3/4: Pushing Backend Image${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

echo -e "${YELLOW}Pushing: ${BACKEND_IMAGE}:${VERSION_TAG}${NC}"
docker push "${BACKEND_IMAGE}:${VERSION_TAG}"

if [ "${VERSION_TAG}" != "latest" ]; then
    echo -e "${YELLOW}Pushing: ${BACKEND_IMAGE}:latest${NC}"
    docker push "${BACKEND_IMAGE}:latest"
fi

echo -e "${GREEN}✓ Backend image pushed successfully${NC}"
echo ""

# ============================================
# Push Frontend
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Step 4/4: Pushing Frontend Image${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

echo -e "${YELLOW}Pushing: ${FRONTEND_IMAGE}:${VERSION_TAG}${NC}"
docker push "${FRONTEND_IMAGE}:${VERSION_TAG}"

if [ "${VERSION_TAG}" != "latest" ]; then
    echo -e "${YELLOW}Pushing: ${FRONTEND_IMAGE}:latest${NC}"
    docker push "${FRONTEND_IMAGE}:latest"
fi

echo -e "${GREEN}✓ Frontend image pushed successfully${NC}"
echo ""

# ============================================
# Summary
# ============================================

cd "${PROJECT_ROOT}"

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✓ All Images Built and Pushed Successfully${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${YELLOW}Images published:${NC}"
echo "  • ${BACKEND_IMAGE}:${VERSION_TAG}"
echo "  • ${FRONTEND_IMAGE}:${VERSION_TAG}"
if [ "${VERSION_TAG}" != "latest" ]; then
    echo "  • ${BACKEND_IMAGE}:latest"
    echo "  • ${FRONTEND_IMAGE}:latest"
fi
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Make images public on GitHub (if first time):"
echo "     - Go to: https://github.com/${GITHUB_USERNAME}?tab=packages"
echo "     - Set both packages to 'Public'"
echo ""
echo "  2. On Unraid, pull and start the containers:"
echo "     cd /mnt/user/appdata/the-logbook"
echo "     docker-compose pull"
echo "     docker-compose up -d"
echo ""
echo -e "${GREEN}Done!${NC}"
