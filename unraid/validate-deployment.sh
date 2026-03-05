#!/bin/bash
# ==================================================
# The Logbook - Deployment Validation Script
# ==================================================
# Validates that the Logbook deployment is working correctly
# Run this after starting containers to verify everything is set up
#
# Usage:
#   ./validate-deployment.sh [FRONTEND_URL] [BACKEND_URL]
#   ./validate-deployment.sh --diagnose-frontend
#   ./validate-deployment.sh --rebuild-frontend
#
# Examples:
#   ./validate-deployment.sh http://192.168.1.10:7880 http://192.168.1.10:7881
#   ./validate-deployment.sh --diagnose-frontend
#   ./validate-deployment.sh --rebuild-frontend
# ==================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ==================================================
# Frontend Diagnostics Mode
# ==================================================
diagnose_frontend() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Frontend Build Configuration Check${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    if ! docker ps | grep -q "logbook-frontend"; then
        echo -e "${RED}ERROR: logbook-frontend container is not running${NC}"
        echo ""
        echo "Start it with:"
        echo "  docker-compose up -d logbook-frontend"
        exit 1
    fi

    echo "1. Checking built index.html..."
    echo "---"
    docker exec logbook-frontend cat /usr/share/nginx/html/index.html | head -20
    echo ""

    echo "2. Searching for VITE_API_URL in built JavaScript..."
    echo "---"
    docker exec logbook-frontend sh -c "grep -o 'VITE_API_URL[^\"]*' /usr/share/nginx/html/assets/*.js 2>/dev/null || echo 'Not found in plaintext'"
    echo ""

    echo "3. Checking for hardcoded URLs in bundle..."
    echo "---"
    docker exec logbook-frontend sh -c "grep -o 'http[s]*://[^\"]*' /usr/share/nginx/html/assets/*.js | head -10 || echo 'None found'"
    echo ""

    echo "4. Checking nginx configuration..."
    echo "---"
    docker exec logbook-frontend cat /etc/nginx/conf.d/default.conf | grep -A3 "location /api"
    echo ""

    echo "5. Testing API proxy..."
    echo "---"
    docker exec logbook-frontend sh -c "wget -qO- http://localhost:80/api/v1/onboarding/status 2>&1 || echo 'Proxy failed'"
    echo ""

    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Diagnosis Complete${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "If you see malformed URLs above, rebuild the frontend:"
    echo "  $0 --rebuild-frontend"
    echo ""
    exit 0
}

# ==================================================
# Frontend Rebuild Mode
# ==================================================
rebuild_frontend() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Logbook Frontend Rebuild${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    cd "$PROJECT_ROOT"

    echo -e "${YELLOW}Step 1: Stopping containers...${NC}"
    docker-compose -f unraid/docker-compose-unraid.yml down
    echo -e "${GREEN}Done${NC}"
    echo ""

    echo -e "${YELLOW}Step 2: Removing old frontend image...${NC}"
    if docker images | grep -q "the-logbook-frontend"; then
        docker rmi the-logbook-frontend:local || true
        echo -e "${GREEN}Old image removed${NC}"
    else
        echo -e "${GREEN}No old image to remove${NC}"
    fi
    echo ""

    echo -e "${YELLOW}Step 3: Verifying build configuration...${NC}"
    echo -e "  Checking docker-compose build args..."
    VITE_URL=$(grep -A3 "args:" unraid/docker-compose-unraid.yml | grep VITE_API_URL | awk '{print $2}')
    if [ "$VITE_URL" = "/api/v1" ]; then
        echo -e "${GREEN}VITE_API_URL is correct: /api/v1${NC}"
    else
        echo -e "${RED}WARNING: VITE_API_URL is set to: $VITE_URL${NC}"
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
    echo -e "${GREEN}Frontend built successfully${NC}"
    echo ""

    echo -e "${YELLOW}Step 5: Starting all containers...${NC}"
    docker-compose -f unraid/docker-compose-unraid.yml up -d
    echo -e "${GREEN}Containers started${NC}"
    echo ""

    echo -e "${YELLOW}Step 6: Waiting for containers to be healthy...${NC}"
    sleep 5
    echo -e "${GREEN}Ready${NC}"
    echo ""

    echo -e "${YELLOW}Step 7: Checking container status...${NC}"
    docker ps --filter "name=logbook" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""

    echo -e "${BLUE}========================================${NC}"
    echo -e "${GREEN}Frontend rebuild complete!${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "  1. Run validation: $0 http://YOUR-UNRAID-IP:7880 http://YOUR-UNRAID-IP:7881"
    echo -e "  2. Clear your browser cache (Ctrl+Shift+Delete)"
    echo -e "  3. Access The Logbook: http://YOUR-UNRAID-IP:7880"
    echo -e "  4. Check browser console (F12) for errors"
    echo ""
    echo -e "If you see any errors, run:"
    echo -e "  docker logs logbook-frontend --tail 50"
    echo -e "  docker logs logbook-backend --tail 50"
    echo ""
    exit 0
}

# ==================================================
# Handle subcommand flags
# ==================================================
case "${1:-}" in
    --diagnose-frontend)
        diagnose_frontend
        ;;
    --rebuild-frontend)
        rebuild_frontend
        ;;
esac

# Default URLs (can be overridden)
FRONTEND_URL="${1:-http://localhost:7880}"
BACKEND_URL="${2:-http://localhost:7881}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}The Logbook - Deployment Validation${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Frontend URL: ${YELLOW}$FRONTEND_URL${NC}"
echo -e "Backend URL:  ${YELLOW}$BACKEND_URL${NC}"
echo ""

# Counter for passed/failed tests
PASSED=0
FAILED=0
WARNINGS=0

# Function to test endpoint
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_code="${3:-200}"

    echo -n "Testing $name... "

    response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>&1 || echo "000")

    if [ "$response" = "$expected_code" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $response)"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Expected HTTP $expected_code, got $response)"
        ((FAILED++))
        return 1
    fi
}

# Function to test JSON response
test_json_endpoint() {
    local name="$1"
    local url="$2"
    local key="$3"

    echo -n "Testing $name... "

    response=$(curl -s "$url" 2>&1)
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>&1 || echo "000")

    if [ "$http_code" != "200" ]; then
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code)"
        ((FAILED++))
        return 1
    fi

    if echo "$response" | grep -q "\"$key\""; then
        echo -e "${GREEN}✓ PASS${NC} (Contains \"$key\")"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Missing \"$key\" in response)"
        echo -e "${YELLOW}Response: $response${NC}"
        ((FAILED++))
        return 1
    fi
}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}1. Container Health Checks${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if containers are running
echo -n "Checking Docker containers... "
CONTAINERS=$(docker ps --filter "name=logbook" --format "{{.Names}}" | wc -l)
if [ "$CONTAINERS" -ge 3 ]; then
    echo -e "${GREEN}✓ PASS${NC} ($CONTAINERS containers running)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Expected 4 containers: frontend, backend, db, redis. Found $CONTAINERS)"
    ((FAILED++))
fi

# Check individual container status
for container in logbook-frontend logbook-backend logbook-db logbook-redis; do
    echo -n "Checking $container... "
    if docker ps --filter "name=$container" --filter "status=running" | grep -q "$container"; then
        health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-healthcheck")
        if [ "$health" = "healthy" ] || [ "$health" = "no-healthcheck" ]; then
            echo -e "${GREEN}✓ PASS${NC} (running, $health)"
            ((PASSED++))
        else
            echo -e "${YELLOW}⚠ WARNING${NC} (running, but health: $health)"
            ((WARNINGS++))
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (not running)"
        ((FAILED++))
    fi
done

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}2. Backend API Tests${NC}"
echo -e "${BLUE}========================================${NC}"

# Test backend endpoints
test_json_endpoint "Backend Health Check" "$BACKEND_URL/health" "status"
test_json_endpoint "Backend API Docs" "$BACKEND_URL/docs" "openapi"
test_endpoint "Backend Onboarding Status" "$BACKEND_URL/api/v1/onboarding/status" "200"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}3. Frontend Tests${NC}"
echo -e "${BLUE}========================================${NC}"

# Test frontend
test_endpoint "Frontend Root" "$FRONTEND_URL/" "200"
test_endpoint "Frontend Onboarding" "$FRONTEND_URL/onboarding" "200"

# Check if frontend can reach backend through proxy
echo -n "Testing Frontend → Backend Proxy... "
PROXY_TEST=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/api/v1/onboarding/status" 2>&1 || echo "000")
if [ "$PROXY_TEST" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Nginx proxy working)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Nginx proxy not working - got HTTP $PROXY_TEST)"
    echo -e "${YELLOW}This is the CRITICAL issue! Frontend cannot reach backend.${NC}"
    ((FAILED++))
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}4. Network Connectivity${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if containers can talk to each other
echo -n "Testing Backend → Database... "
DB_TEST=$(docker exec logbook-backend python -c "import requests; r=requests.get('http://localhost:3001/health'); print(r.json().get('database', 'error'))" 2>/dev/null || echo "error")
if [ "$DB_TEST" = "connected" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Database connected)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Database: $DB_TEST)"
    ((FAILED++))
fi

echo -n "Testing Backend → Redis... "
REDIS_TEST=$(docker exec logbook-backend python -c "import requests; r=requests.get('http://localhost:3001/health'); print(r.json().get('redis', 'error'))" 2>/dev/null || echo "error")
if [ "$REDIS_TEST" = "connected" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Redis connected)"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (Redis: $REDIS_TEST)"
    ((FAILED++))
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}5. Configuration Checks${NC}"
echo -e "${BLUE}========================================${NC}"

# Check environment variables
echo -n "Checking VITE_API_URL in frontend... "
API_URL=$(docker exec logbook-frontend cat /usr/share/nginx/html/index.html | grep -o 'VITE_API_URL[^"]*' | head -1 || echo "not-found")
if echo "$API_URL" | grep -q "/api/v1"; then
    echo -e "${GREEN}✓ PASS${NC} (Using relative URL /api/v1)"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ WARNING${NC} ($API_URL - should be /api/v1 for proxy to work)"
    ((WARNINGS++))
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Validation Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Tests Passed:    ${GREEN}$PASSED${NC}"
echo -e "Tests Failed:    ${RED}$FAILED${NC}"
echo -e "Warnings:        ${YELLOW}$WARNINGS${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}✓ ALL TESTS PASSED!${NC}"
    echo -e "${GREEN}Your Logbook instance is ready to use at: $FRONTEND_URL${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ VALIDATION FAILED${NC}"
    echo -e "${YELLOW}Please fix the issues above before using The Logbook.${NC}"
    echo ""
    echo -e "${BLUE}Common Fixes:${NC}"
    echo "1. If frontend cannot reach backend:"
    echo "   - Check docker-compose.yml frontend port mapping (should be :80 not :3000)"
    echo "   - Rebuild frontend: docker-compose build --no-cache frontend"
    echo "   - Restart: docker-compose down && docker-compose up -d"
    echo ""
    echo "2. If database/redis connection fails:"
    echo "   - Check .env file has correct passwords"
    echo "   - Verify containers are on the same network: docker network ls"
    echo ""
    echo "3. For detailed logs:"
    echo "   - Backend: docker logs logbook-backend"
    echo "   - Frontend: docker logs logbook-frontend"
    echo ""
    exit 1
fi
