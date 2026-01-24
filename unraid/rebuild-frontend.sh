#!/bin/bash
# ==================================================
# Rebuild Frontend Container (Unraid)
# ==================================================
# This script ensures the frontend is built with the
# correct VITE_API_URL and nginx configuration
# ==================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Logbook Frontend Rebuild Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo -e "${YELLOW}Step 1: Stopping containers...${NC}"
docker-compose -f unraid/docker-compose-unraid.yml down
echo -e "${GREEN}✓ Containers stopped${NC}"
echo ""

echo -e "${YELLOW}Step 2: Removing old frontend image...${NC}"
if docker images | grep -q "the-logbook-frontend"; then
    docker rmi the-logbook-frontend:local || true
    echo -e "${GREEN}✓ Old image removed${NC}"
else
    echo -e "${GREEN}✓ No old image to remove${NC}"
fi
echo ""

echo -e "${YELLOW}Step 3: Verifying build configuration...${NC}"
echo -e "  Checking docker-compose build args..."
VITE_URL=$(grep -A3 "args:" unraid/docker-compose-unraid.yml | grep VITE_API_URL | awk '{print $2}')
if [ "$VITE_URL" = "/api/v1" ]; then
    echo -e "${GREEN}✓ VITE_API_URL is correct: /api/v1${NC}"
else
    echo -e "${RED}✗ WARNING: VITE_API_URL is set to: $VITE_URL${NC}"
    echo -e "${RED}  Expected: /api/v1${NC}"
    echo -e "${YELLOW}  Continuing anyway...${NC}"
fi
echo ""

echo -e "${YELLOW}Step 4: Building frontend with correct settings...${NC}"
echo -e "  This will take 2-3 minutes..."
echo -e "  Build args:"
echo -e "    VITE_API_URL=/api/v1 ${GREEN}(relative URL for nginx proxy)${NC}"
echo ""
docker-compose -f unraid/docker-compose-unraid.yml build --no-cache --progress=plain frontend 2>&1 | grep -E "VITE_API_URL|Building|Successfully" || docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend
echo -e "${GREEN}✓ Frontend built successfully${NC}"
echo ""

echo -e "${YELLOW}Step 5: Starting all containers...${NC}"
docker-compose -f unraid/docker-compose-unraid.yml up -d
echo -e "${GREEN}✓ Containers started${NC}"
echo ""

echo -e "${YELLOW}Step 6: Waiting for containers to be healthy...${NC}"
sleep 5
echo -e "${GREEN}✓ Ready${NC}"
echo ""

echo -e "${YELLOW}Step 7: Checking container status...${NC}"
docker ps --filter "name=logbook" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Frontend rebuild complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Run validation script:"
echo -e "     ${BLUE}./unraid/validate-deployment.sh http://YOUR-UNRAID-IP:7880 http://YOUR-UNRAID-IP:7881${NC}"
echo ""
echo -e "  2. Clear your browser cache (Ctrl+Shift+Delete)"
echo ""
echo -e "  3. Access The Logbook:"
echo -e "     ${BLUE}http://YOUR-UNRAID-IP:7880${NC}"
echo ""
echo -e "  4. Check browser console (F12) for errors"
echo ""
echo -e "${GREEN}If you see any errors, run:${NC}"
echo -e "  docker logs logbook-frontend --tail 50"
echo -e "  docker logs logbook-backend --tail 50"
echo ""
