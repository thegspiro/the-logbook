#!/bin/bash
# ============================================
# THE LOGBOOK - GITHUB WIKI SETUP SCRIPT
# ============================================
# This script automates the deployment of wiki pages to GitHub Wiki
#
# Usage:
#   ./setup-wiki.sh
#
# What it does:
#   1. Clones the GitHub Wiki repository
#   2. Copies all wiki pages
#   3. Commits and pushes to GitHub
# ============================================

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
REPO_OWNER="thegspiro"
REPO_NAME="the-logbook"
WIKI_REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.wiki.git"
WIKI_DIR="../../the-logbook.wiki"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}THE LOGBOOK - GitHub Wiki Setup${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check if we're in the wiki directory
if [ ! -f "Home.md" ]; then
    echo -e "${RED}Error: Please run this script from the wiki/ directory${NC}"
    exit 1
fi

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed${NC}"
    exit 1
fi

# Step 1: Clone Wiki Repository
echo -e "${BLUE}Step 1: Cloning GitHub Wiki repository...${NC}"

if [ -d "$WIKI_DIR" ]; then
    echo -e "${YELLOW}Wiki directory already exists. Updating...${NC}"
    cd "$WIKI_DIR"
    git pull
    cd - > /dev/null
else
    echo "Cloning $WIKI_REPO_URL"
    git clone "$WIKI_REPO_URL" "$WIKI_DIR"
fi

echo -e "${GREEN}✓ Wiki repository ready${NC}"
echo ""

# Step 2: Copy Wiki Files
echo -e "${BLUE}Step 2: Copying wiki pages...${NC}"

# List of wiki files to copy
WIKI_FILES=(
    "Home.md"
    "_Sidebar.md"
    "Installation.md"
    "Unraid-Quick-Start.md"
    "Quick-Reference.md"
    "Troubleshooting.md"
    "Development-Backend.md"
    "Deployment-Unraid.md"
    "Contributing.md"
    "Security-Overview.md"
    "Onboarding.md"
    "Role-System.md"
)

# Copy each file
for file in "${WIKI_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$WIKI_DIR/"
        echo -e "${GREEN}✓${NC} Copied $file"
    else
        echo -e "${YELLOW}⚠${NC} Skipped $file (not found)"
    fi
done

echo -e "${GREEN}✓ All wiki pages copied${NC}"
echo ""

# Step 3: Commit and Push
echo -e "${BLUE}Step 3: Committing changes to GitHub Wiki...${NC}"

cd "$WIKI_DIR"

# Configure git if needed
git config user.name "Wiki Bot" 2>/dev/null || true
git config user.email "wiki@the-logbook.io" 2>/dev/null || true

# Add all changes
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo -e "${YELLOW}No changes to commit${NC}"
else
    # Commit changes
    git commit -m "Update wiki pages - $(date '+%Y-%m-%d %H:%M:%S')"

    # Push to GitHub
    echo ""
    echo -e "${BLUE}Pushing to GitHub...${NC}"
    git push origin master

    echo -e "${GREEN}✓ Wiki updated successfully!${NC}"
fi

cd - > /dev/null

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "Your wiki is now available at:"
echo -e "${GREEN}https://github.com/${REPO_OWNER}/${REPO_NAME}/wiki${NC}"
echo ""
echo -e "Wiki pages deployed:"
for file in "${WIKI_FILES[@]}"; do
    if [ -f "$file" ]; then
        page_name="${file%.md}"
        echo -e "  • ${GREEN}$page_name${NC}"
    fi
done
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Visit your wiki to verify pages"
echo "  2. Customize pages as needed"
echo "  3. Enable wiki in repository settings if not already enabled"
echo ""
