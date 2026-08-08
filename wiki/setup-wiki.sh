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

# Every page in this directory is published, discovered rather than listed.
#
# This used to be a hand-maintained array of eleven filenames. Nobody updated it
# when a page was added, so by 2026-08 there were 41 pages here and 11 being
# published — and _Sidebar.md, which IS published, linked to 28 of the missing
# ones. Every one of those sidebar entries was a dead link on the live wiki, and
# editing a page like Module-Training.md changed nothing a reader could see.
#
# That is the same failure the generated Troubleshooting page below was
# introduced to stop, one level up: a second place that has to be updated by
# hand will eventually disagree with the first. A glob cannot fall behind.
#
# Two deliberate exclusions:
#   README.md          — maintainer instructions for this directory, not a page.
#                        GitHub Wikis have no index page, so a published README
#                        would appear as a stray "README" entry.
#   Troubleshooting.md — generated below from docs/TROUBLESHOOTING.md. It should
#                        not exist here; the guard catches it if someone
#                        re-creates one by hand.
WIKI_EXCLUDE=("README.md" "Troubleshooting.md")

if [ -f "Troubleshooting.md" ]; then
    echo -e "${RED}✗${NC} wiki/Troubleshooting.md exists but is generated from"
    echo -e "  docs/TROUBLESHOOTING.md at publish time. Delete it and add any"
    echo -e "  new entries to docs/TROUBLESHOOTING.md instead."
    exit 1
fi

WIKI_FILES=()
for file in *.md; do
    skip=""
    for excluded in "${WIKI_EXCLUDE[@]}"; do
        [ "$file" = "$excluded" ] && skip=1 && break
    done
    [ -n "$skip" ] && continue
    WIKI_FILES+=("$file")
done

if [ ${#WIKI_FILES[@]} -eq 0 ]; then
    echo -e "${RED}Error: no wiki pages found to publish${NC}"
    exit 1
fi

# Copy each file
for file in "${WIKI_FILES[@]}"; do
    cp "$file" "$WIKI_DIR/"
    echo -e "${GREEN}✓${NC} Copied $file"
done

echo -e "${GREEN}✓${NC} ${#WIKI_FILES[@]} pages staged for publication"

# Troubleshooting is GENERATED, not maintained here.
#
# There used to be three troubleshooting documents — docs/TROUBLESHOOTING.md,
# docs/troubleshooting/README.md and a hand-edited wiki/Troubleshooting.md.
# wiki/README.md told maintainers to refresh the wiki copy with `cp`, nobody
# did, and all three drifted apart for five months. Generating the wiki page
# from the single source at publish time is what stops that recurring: there is
# no second file anyone can edit.
TROUBLESHOOTING_SRC="../docs/TROUBLESHOOTING.md"
if [ -f "$TROUBLESHOOTING_SRC" ]; then
    {
        echo "<!-- GENERATED FILE — DO NOT EDIT."
        echo "     Source: docs/TROUBLESHOOTING.md in the main repository."
        echo "     Regenerate by running wiki/setup-wiki.sh. -->"
        echo ""
        cat "$TROUBLESHOOTING_SRC"
    } > "$WIKI_DIR/Troubleshooting.md"
    echo -e "${GREEN}✓${NC} Generated Troubleshooting.md from docs/TROUBLESHOOTING.md"
else
    echo -e "${RED}✗${NC} $TROUBLESHOOTING_SRC not found — wiki Troubleshooting page not generated"
    exit 1
fi

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
