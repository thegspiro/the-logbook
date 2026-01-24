#!/bin/bash
# ==================================================
# Check Built Frontend Configuration
# ==================================================
# This script inspects the built frontend bundle to see
# what VITE_API_URL was baked in during build time
# ==================================================

set -e

echo "============================================"
echo "Frontend Build Configuration Check"
echo "============================================"
echo ""

# Check if container is running
if ! docker ps | grep -q "logbook-frontend"; then
    echo "❌ ERROR: logbook-frontend container is not running"
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
# Search for API URL patterns in the built JS
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

echo "============================================"
echo "Diagnosis Complete"
echo "============================================"
echo ""
echo "If you see malformed URLs above, you need to REBUILD the frontend:"
echo ""
echo "  docker-compose down"
echo "  docker rmi the-logbook-frontend:local"
echo "  docker-compose build --no-cache frontend"
echo "  docker-compose up -d"
echo ""
