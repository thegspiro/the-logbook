#!/usr/bin/env bash
# ============================================
# Docker Build Verification Script
# ============================================
# Validates that The Logbook can be built and composed in Docker.
# Checks Docker Compose config, Dockerfile syntax, TypeScript compilation,
# and image builds without requiring a running database.
#
# Usage:
#   ./scripts/verify-docker-build.sh           # Run all checks
#   ./scripts/verify-docker-build.sh --quick   # Skip image builds (faster)
#   ./scripts/verify-docker-build.sh --build   # Include full image builds
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
# ============================================

set -uo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0
WARNINGS=0
ERRORS=()

# Parse arguments
SKIP_BUILD=false
FULL_BUILD=false
for arg in "$@"; do
    case $arg in
        --quick) SKIP_BUILD=true ;;
        --build) FULL_BUILD=true ;;
        --help|-h)
            echo "Usage: $0 [--quick|--build]"
            echo "  --quick  Skip Docker image builds (faster)"
            echo "  --build  Include full image builds (slower but thorough)"
            echo "  (default) Validates config, Dockerfiles, and TypeScript"
            exit 0
            ;;
    esac
done

# Find project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  The Logbook - Docker Build Verification${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "Project root: ${PROJECT_ROOT}"
echo -e "Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Helper functions
pass() {
    echo -e "  ${GREEN}PASS${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "  ${RED}FAIL${NC} $1"
    ((FAILED++))
    ERRORS+=("$1")
}

warn() {
    echo -e "  ${YELLOW}WARN${NC} $1"
    ((WARNINGS++))
}

section() {
    echo ""
    echo -e "${BLUE}--- $1 ---${NC}"
}

# ============================================
# 1. Check Prerequisites
# ============================================
section "1. Prerequisites"

if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version 2>/dev/null || echo "unknown")
    pass "Docker installed: ${DOCKER_VERSION}"
else
    fail "Docker is not installed"
fi

if command -v docker compose &> /dev/null || command -v docker-compose &> /dev/null; then
    if command -v docker compose &> /dev/null; then
        COMPOSE_VERSION=$(docker compose version 2>/dev/null || echo "unknown")
        pass "Docker Compose installed: ${COMPOSE_VERSION}"
    else
        COMPOSE_VERSION=$(docker-compose --version 2>/dev/null || echo "unknown")
        pass "Docker Compose installed: ${COMPOSE_VERSION}"
    fi
else
    fail "Docker Compose is not installed"
fi

# ============================================
# 2. Verify Required Files Exist
# ============================================
section "2. Required Files"

REQUIRED_FILES=(
    "docker-compose.yml"
    "backend/Dockerfile"
    "frontend/Dockerfile"
    ".env.example"
    "backend/requirements.txt"
    "frontend/package.json"
    "frontend/tsconfig.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$PROJECT_ROOT/$file" ]]; then
        pass "$file exists"
    else
        fail "$file is missing"
    fi
done

# Check optional compose overrides
OPTIONAL_FILES=(
    "docker-compose.arm.yml"
    "docker-compose.minimal.yml"
    "unraid/docker-compose-unraid.yml"
    "unraid/docker-compose-build-from-source.yml"
)

for file in "${OPTIONAL_FILES[@]}"; do
    if [[ -f "$PROJECT_ROOT/$file" ]]; then
        pass "$file exists (optional override)"
    else
        warn "$file not found (optional)"
    fi
done

# ============================================
# 3. Validate Docker Compose Configuration
# ============================================
section "3. Docker Compose Configuration"

# Main compose file
if docker compose -f docker-compose.yml config --quiet 2>/dev/null; then
    pass "docker-compose.yml is valid"
else
    fail "docker-compose.yml has configuration errors"
fi

# Compose with minimal override
if [[ -f "docker-compose.minimal.yml" ]]; then
    if docker compose -f docker-compose.yml -f docker-compose.minimal.yml config --quiet 2>/dev/null; then
        pass "docker-compose.yml + minimal override is valid"
    else
        fail "Minimal override has configuration errors"
    fi
fi

# Compose with ARM override
if [[ -f "docker-compose.arm.yml" ]]; then
    if docker compose -f docker-compose.yml -f docker-compose.arm.yml config --quiet 2>/dev/null; then
        pass "docker-compose.yml + ARM override is valid"
    else
        fail "ARM override has configuration errors"
    fi
fi

# Compose with both minimal and ARM
if [[ -f "docker-compose.minimal.yml" ]] && [[ -f "docker-compose.arm.yml" ]]; then
    if docker compose -f docker-compose.yml -f docker-compose.minimal.yml -f docker-compose.arm.yml config --quiet 2>/dev/null; then
        pass "docker-compose.yml + minimal + ARM override is valid"
    else
        fail "Minimal + ARM override combination has configuration errors"
    fi
fi

# Unraid compose file (standalone)
if [[ -f "unraid/docker-compose-unraid.yml" ]]; then
    if docker compose -f unraid/docker-compose-unraid.yml config --quiet 2>/dev/null; then
        pass "unraid/docker-compose-unraid.yml is valid"
    else
        fail "Unraid compose file has configuration errors"
    fi
fi

# ============================================
# 4. Validate Database Configuration Consistency
# ============================================
section "4. Database Configuration Consistency"

# Check main compose uses MySQL
if grep -q "image: mysql:8.0" docker-compose.yml 2>/dev/null; then
    pass "Main compose uses MySQL 8.0"
else
    fail "Main compose should use mysql:8.0 image"
fi

# Check ARM override uses MariaDB (expected for ARM)
if [[ -f "docker-compose.arm.yml" ]]; then
    if grep -q "image: mariadb:" docker-compose.arm.yml 2>/dev/null; then
        pass "ARM override uses MariaDB (correct for ARM/RPi)"
    else
        warn "ARM override does not use MariaDB"
    fi
fi

# Check Unraid compose uses MySQL (NOT MariaDB)
if [[ -f "unraid/docker-compose-unraid.yml" ]]; then
    if grep -q "image: mysql:8.0" unraid/docker-compose-unraid.yml 2>/dev/null; then
        pass "Unraid compose uses MySQL 8.0"
    else
        fail "Unraid compose should use mysql:8.0 (not MariaDB)"
    fi
fi

# Check build-from-source compose uses MySQL
if [[ -f "unraid/docker-compose-build-from-source.yml" ]]; then
    if grep -q "image: mysql:8.0" unraid/docker-compose-build-from-source.yml 2>/dev/null; then
        pass "Build-from-source compose uses MySQL 8.0"
    else
        fail "Build-from-source compose should use mysql:8.0"
    fi
fi

# ============================================
# 5. Validate Dockerfiles
# ============================================
section "5. Dockerfile Validation"

# Backend Dockerfile
if [[ -f "backend/Dockerfile" ]]; then
    # Check for multi-stage build targets
    BACKEND_STAGES=$(grep -c "^FROM" backend/Dockerfile || true)
    if [[ $BACKEND_STAGES -ge 2 ]]; then
        pass "Backend Dockerfile has multi-stage build ($BACKEND_STAGES stages)"
    else
        warn "Backend Dockerfile has only $BACKEND_STAGES stage(s)"
    fi

    # Check for production target
    if grep -q "AS production" backend/Dockerfile 2>/dev/null || grep -q "as production" backend/Dockerfile 2>/dev/null; then
        pass "Backend Dockerfile has production target"
    else
        warn "Backend Dockerfile missing production target"
    fi

    # Check for healthcheck
    if grep -q "HEALTHCHECK" backend/Dockerfile 2>/dev/null; then
        pass "Backend Dockerfile has HEALTHCHECK"
    else
        warn "Backend Dockerfile missing HEALTHCHECK"
    fi
fi

# Frontend Dockerfile
if [[ -f "frontend/Dockerfile" ]]; then
    FRONTEND_STAGES=$(grep -c "^FROM" frontend/Dockerfile || true)
    if [[ $FRONTEND_STAGES -ge 2 ]]; then
        pass "Frontend Dockerfile has multi-stage build ($FRONTEND_STAGES stages)"
    else
        warn "Frontend Dockerfile has only $FRONTEND_STAGES stage(s)"
    fi

    # Check for production target
    if grep -q "AS production" frontend/Dockerfile 2>/dev/null || grep -q "as production" frontend/Dockerfile 2>/dev/null; then
        pass "Frontend Dockerfile has production target"
    else
        warn "Frontend Dockerfile missing production target"
    fi

    # Check it uses TypeScript compilation (via tsc or vite build)
    if grep -q "tsc\|vite build\|npm run build" frontend/Dockerfile 2>/dev/null; then
        pass "Frontend Dockerfile includes build step"
    else
        warn "Frontend Dockerfile may not include a build step"
    fi
fi

# ============================================
# 6. TypeScript Compilation Check
# ============================================
section "6. TypeScript Compilation"

if [[ -f "frontend/package.json" ]] && [[ -f "frontend/tsconfig.json" ]]; then
    if [[ -d "frontend/node_modules" ]]; then
        echo "  Running tsc --noEmit..."
        if (cd frontend && npx tsc --noEmit 2>&1); then
            pass "TypeScript compilation succeeded (no errors)"
        else
            fail "TypeScript compilation failed"
        fi
    else
        warn "frontend/node_modules not found - skipping TypeScript check (run 'npm install' first)"
    fi
else
    warn "TypeScript config not found - skipping"
fi

# ============================================
# 7. Backend Python Syntax Check
# ============================================
section "7. Backend Python Syntax"

if command -v python3 &> /dev/null; then
    PYTHON_ERRORS=0
    # Check critical backend files for syntax errors
    while IFS= read -r pyfile; do
        if ! python3 -c "import py_compile; py_compile.compile('$pyfile', doraise=True)" 2>/dev/null; then
            fail "Python syntax error in: $pyfile"
            ((PYTHON_ERRORS++))
        fi
    done < <(find backend/app -name "*.py" -not -path "*/migrations/*" -not -path "*/__pycache__/*" 2>/dev/null | head -50)

    if [[ $PYTHON_ERRORS -eq 0 ]]; then
        pass "Backend Python files have valid syntax"
    fi
else
    warn "Python3 not available - skipping syntax check"
fi

# ============================================
# 8. Environment File Check
# ============================================
section "8. Environment Configuration"

if [[ -f ".env.example" ]]; then
    # Check for required variables in .env.example
    REQUIRED_VARS=("DB_HOST" "DB_NAME" "DB_USER" "DB_PASSWORD" "SECRET_KEY" "ENCRYPTION_KEY" "REDIS_PASSWORD")
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -q "^${var}=" .env.example 2>/dev/null || grep -q "^# *${var}=" .env.example 2>/dev/null; then
            pass ".env.example defines $var"
        else
            warn ".env.example missing $var"
        fi
    done
fi

# Check Unraid .env.example
if [[ -f "unraid/.env.example" ]]; then
    pass "Unraid .env.example exists"
else
    warn "unraid/.env.example not found"
fi

# ============================================
# 9. Docker Image Build (optional)
# ============================================
if [[ "$SKIP_BUILD" == "false" ]] && [[ "$FULL_BUILD" == "true" ]]; then
    section "9. Docker Image Build"
    echo "  Building Docker images (this may take several minutes)..."

    # Build backend
    echo "  Building backend..."
    if docker compose build backend 2>&1 | tail -5; then
        pass "Backend image built successfully"
    else
        fail "Backend image build failed"
    fi

    # Build frontend
    echo "  Building frontend..."
    if docker compose build frontend 2>&1 | tail -5; then
        pass "Frontend image built successfully"
    else
        fail "Frontend image build failed"
    fi
else
    section "9. Docker Image Build (skipped)"
    if [[ "$SKIP_BUILD" == "true" ]]; then
        echo "  Skipped (--quick mode)"
    else
        echo "  Skipped (use --build to include image builds)"
    fi
fi

# ============================================
# 10. Service Naming Consistency
# ============================================
section "10. Service Naming Consistency"

# Check that all compose files use consistent service names
if docker compose -f docker-compose.yml config --services 2>/dev/null | grep -q "mysql"; then
    pass "Main compose uses 'mysql' service name"
fi

if [[ -f "docker-compose.arm.yml" ]]; then
    if docker compose -f docker-compose.yml -f docker-compose.arm.yml config --services 2>/dev/null | grep -q "mysql"; then
        pass "ARM override maintains 'mysql' service name"
    fi
fi

# ============================================
# Results Summary
# ============================================
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Results Summary${NC}"
echo -e "${BLUE}============================================${NC}"
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}VERIFICATION FAILED${NC} - $FAILED check(s) failed:"
    for err in "${ERRORS[@]}"; do
        echo -e "  ${RED}-${NC} $err"
    done
    echo ""
    echo "Fix the issues above before deploying."
    exit 1
else
    echo -e "${GREEN}ALL CHECKS PASSED${NC}"
    if [[ $WARNINGS -gt 0 ]]; then
        echo -e "${YELLOW}($WARNINGS warning(s) - review above)${NC}"
    fi
    echo ""
    echo "The application is ready for Docker deployment."
    exit 0
fi
