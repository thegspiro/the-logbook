#!/bin/bash
# ==================================================
# The Logbook - Deployment Validation Script
# ==================================================
# Validates that the Logbook deployment is working correctly
# Run this after starting containers to verify everything is set up
#
# Usage: ./validate-deployment.sh [FRONTEND_URL] [BACKEND_URL]
# Example: ./validate-deployment.sh http://192.168.1.10:7880 http://192.168.1.10:7881
# ==================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
