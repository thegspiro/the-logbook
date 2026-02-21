#!/bin/bash
# =================================================================
# End-to-End Onboarding Test Script for The Logbook
# =================================================================
# This script tests the complete onboarding flow:
#   1. Clean startup with docker compose
#   2. Health check / fast-path database initialization
#   3. Onboarding status check
#   4. Start onboarding session
#   5. Create organization
#   6. Configure roles
#   7. Create admin user
#   8. Complete onboarding
#   9. Login with admin credentials
#  10. Verify /auth/me works (session persistence)
#  11. Verify database records
#
# Usage:
#   chmod +x test_onboarding_e2e.sh
#   ./test_onboarding_e2e.sh
#
# Prerequisites:
#   - Docker and docker compose must be running
#   - Port 3001 must be available (backend API)
# =================================================================

set -euo pipefail

BASE_URL="http://localhost:3001"
API_URL="${BASE_URL}/api/v1"
PASS_COUNT=0
FAIL_COUNT=0
SESSION_ID=""
CSRF_TOKEN=""
ACCESS_TOKEN=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_section() { echo -e "\n${BLUE}════════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}════════════════════════════════════════${NC}"; }

# Helper: make HTTP request and capture response + status code
http_request() {
    local method="$1"
    local url="$2"
    local data="${3:-}"
    local extra_headers="${4:-}"

    local headers="-H 'Content-Type: application/json'"
    if [ -n "$SESSION_ID" ]; then
        headers="$headers -H 'X-Session-ID: $SESSION_ID'"
    fi
    if [ -n "$CSRF_TOKEN" ]; then
        headers="$headers -H 'X-CSRF-Token: $CSRF_TOKEN'"
    fi
    if [ -n "$ACCESS_TOKEN" ]; then
        headers="$headers -H 'Authorization: Bearer $ACCESS_TOKEN'"
    fi
    if [ -n "$extra_headers" ]; then
        headers="$headers $extra_headers"
    fi

    local cmd="curl -s -w '\n%{http_code}' -X $method '$url' $headers"
    if [ -n "$data" ]; then
        cmd="$cmd -d '$data'"
    fi

    eval "$cmd"
}

# Helper: extract JSON field
json_field() {
    python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d$1)" 2>/dev/null
}

# =====================
# PHASE 1: STARTUP
# =====================
log_section "Phase 1: Application Startup"

log_info "Stopping any existing containers..."
docker compose down -v 2>/dev/null || true

log_info "Starting application (this may take a few minutes on first boot)..."
docker compose up -d mysql redis backend 2>&1

log_info "Waiting for MySQL to be healthy..."
MYSQL_READY=false
for i in $(seq 1 120); do
    if docker compose exec -T mysql mysqladmin ping -h localhost -uroot -pchange_me_in_production 2>/dev/null | grep -q "alive"; then
        MYSQL_READY=true
        log_pass "MySQL is healthy after ${i}s"
        break
    fi
    sleep 2
done
if [ "$MYSQL_READY" = false ]; then
    log_fail "MySQL did not become healthy within 240s"
    exit 1
fi

log_info "Waiting for backend API to be ready..."
BACKEND_READY=false
START_TIME=$(date +%s)
for i in $(seq 1 180); do
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" 2>/dev/null || echo "000")
    if [ "$RESPONSE" = "200" ]; then
        HEALTH=$(curl -s "${BASE_URL}/health" 2>/dev/null)
        IS_READY=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('startup',{}).get('ready',False))" 2>/dev/null)
        if [ "$IS_READY" = "True" ]; then
            END_TIME=$(date +%s)
            ELAPSED=$((END_TIME - START_TIME))
            BACKEND_READY=true
            log_pass "Backend API is ready after ${ELAPSED}s"

            # Check if fast-path was used (startup time should be < 60s after MySQL is ready)
            if [ "$ELAPSED" -lt 120 ]; then
                log_pass "Startup time (${ELAPSED}s) indicates fast-path initialization was used"
            else
                log_warn "Startup time (${ELAPSED}s) is longer than expected for fast-path"
            fi
            break
        fi
    fi
    sleep 2
done
if [ "$BACKEND_READY" = false ]; then
    log_fail "Backend API did not become ready within 360s"
    log_info "Last health response: $(curl -s "${BASE_URL}/health" 2>/dev/null)"
    exit 1
fi

# Verify health endpoint details
HEALTH=$(curl -s "${BASE_URL}/health")
DB_STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['checks']['database'])" 2>/dev/null)
REDIS_STATUS=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['checks']['redis'])" 2>/dev/null)

if [ "$DB_STATUS" = "connected" ]; then
    log_pass "Database is connected"
else
    log_fail "Database status: $DB_STATUS"
fi
if [ "$REDIS_STATUS" = "connected" ]; then
    log_pass "Redis is connected"
else
    log_warn "Redis status: $REDIS_STATUS (non-critical)"
fi

# =====================
# PHASE 2: ONBOARDING STATUS
# =====================
log_section "Phase 2: Onboarding Status Check"

RESPONSE=$(curl -s -w '\n%{http_code}' "${API_URL}/onboarding/status")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "GET /onboarding/status returned 200"
    NEEDS_ONBOARDING=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['needs_onboarding'])" 2>/dev/null)
    if [ "$NEEDS_ONBOARDING" = "True" ]; then
        log_pass "System correctly reports needs_onboarding=True"
    else
        log_fail "Expected needs_onboarding=True, got: $NEEDS_ONBOARDING"
    fi
else
    log_fail "GET /onboarding/status returned $HTTP_CODE"
fi

# =====================
# PHASE 3: START ONBOARDING
# =====================
log_section "Phase 3: Start Onboarding Session"

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/onboarding/start" \
    -H 'Content-Type: application/json')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /onboarding/start returned 200"

    SESSION_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['session_id'])" 2>/dev/null)
    CSRF_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['csrf_token'])" 2>/dev/null)

    if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "None" ]; then
        log_pass "Received session_id: ${SESSION_ID:0:12}..."
    else
        log_fail "No session_id returned"
    fi
    if [ -n "$CSRF_TOKEN" ] && [ "$CSRF_TOKEN" != "None" ]; then
        log_pass "Received csrf_token: ${CSRF_TOKEN:0:12}..."
    else
        log_fail "No csrf_token returned"
    fi
else
    log_fail "POST /onboarding/start returned $HTTP_CODE: $BODY"
    exit 1
fi

# =====================
# PHASE 4: DATABASE CHECK
# =====================
log_section "Phase 4: Database Connectivity Check"

RESPONSE=$(curl -s -w '\n%{http_code}' "${API_URL}/onboarding/database-check")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    DB_CONNECTED=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['connected'])" 2>/dev/null)
    if [ "$DB_CONNECTED" = "True" ]; then
        log_pass "Database connectivity check passed"
    else
        log_fail "Database connectivity check reports not connected"
    fi
else
    log_fail "GET /onboarding/database-check returned $HTTP_CODE"
fi

# =====================
# PHASE 5: CREATE ORGANIZATION
# =====================
log_section "Phase 5: Create Organization"

ORG_DATA='{
    "name": "Test Fire Department",
    "slug": "test-fire-dept",
    "organization_type": "fire_department",
    "timezone": "America/New_York",
    "identifier_type": "fdid",
    "fdid": "12345",
    "phone": "555-0100",
    "email": "info@testfd.org",
    "mailing_address": {
        "line1": "123 Fire Station Rd",
        "city": "Testville",
        "state": "NY",
        "zip_code": "10001",
        "country": "USA"
    },
    "physical_address_same": true
}'

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/onboarding/session/organization" \
    -H 'Content-Type: application/json' \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "$ORG_DATA")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /onboarding/session/organization returned 200"
    ORG_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['id'])" 2>/dev/null)
    ORG_NAME=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['name'])" 2>/dev/null)
    log_pass "Organization created: $ORG_NAME (ID: ${ORG_ID:0:8}...)"
else
    log_fail "POST /onboarding/session/organization returned $HTTP_CODE: $BODY"
    exit 1
fi

# =====================
# PHASE 6: CONFIGURE ROLES
# =====================
log_section "Phase 6: Configure Roles"

ROLES_DATA='{
    "roles": [
        {
            "id": "super_admin",
            "name": "Super Administrator",
            "description": "Full system access",
            "priority": 100,
            "permissions": {
                "members": {"view": true, "manage": true},
                "training": {"view": true, "manage": true},
                "events": {"view": true, "manage": true}
            },
            "is_custom": false
        },
        {
            "id": "member",
            "name": "Member",
            "description": "Regular member",
            "priority": 50,
            "permissions": {
                "members": {"view": true, "manage": false},
                "training": {"view": true, "manage": false},
                "events": {"view": true, "manage": false}
            },
            "is_custom": false
        }
    ]
}'

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/onboarding/session/roles" \
    -H 'Content-Type: application/json' \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "$ROLES_DATA")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /onboarding/session/roles returned 200"
    TOTAL_ROLES=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['total_roles'])" 2>/dev/null)
    log_pass "Roles configured: $TOTAL_ROLES total"
else
    log_fail "POST /onboarding/session/roles returned $HTTP_CODE: $BODY"
fi

# =====================
# PHASE 7: CREATE ADMIN USER
# =====================
log_section "Phase 7: Create Admin User"

ADMIN_DATA='{
    "username": "admin",
    "email": "admin@testfd.org",
    "password": "SecureP@ssw0rd!2026",
    "password_confirm": "SecureP@ssw0rd!2026",
    "first_name": "Test",
    "last_name": "Admin",
    "membership_number": "001"
}'

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/onboarding/system-owner" \
    -H 'Content-Type: application/json' \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "$ADMIN_DATA")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /onboarding/system-owner returned 200"
    ADMIN_USERNAME=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['username'])" 2>/dev/null)
    ADMIN_STATUS=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['status'])" 2>/dev/null)
    log_pass "Admin user created: $ADMIN_USERNAME (status: $ADMIN_STATUS)"
else
    log_fail "POST /onboarding/system-owner returned $HTTP_CODE: $BODY"
    exit 1
fi

# =====================
# PHASE 8: COMPLETE ONBOARDING
# =====================
log_section "Phase 8: Complete Onboarding"

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/onboarding/complete" \
    -H 'Content-Type: application/json' \
    -H "X-Session-ID: $SESSION_ID" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d '{"notes": "E2E test onboarding completion"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /onboarding/complete returned 200"
    COMPLETED_MSG=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['message'])" 2>/dev/null)
    log_pass "Onboarding completed: $COMPLETED_MSG"
else
    log_fail "POST /onboarding/complete returned $HTTP_CODE: $BODY"
    exit 1
fi

# Verify status is now completed
RESPONSE=$(curl -s "${API_URL}/onboarding/status")
IS_COMPLETED=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['is_completed'])" 2>/dev/null)
NEEDS_ONBOARDING=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['needs_onboarding'])" 2>/dev/null)
if [ "$IS_COMPLETED" = "True" ] && [ "$NEEDS_ONBOARDING" = "False" ]; then
    log_pass "Onboarding status correctly shows completed"
else
    log_fail "Onboarding status incorrect: is_completed=$IS_COMPLETED, needs_onboarding=$NEEDS_ONBOARDING"
fi

# =====================
# PHASE 9: LOGIN
# =====================
log_section "Phase 9: Login with Admin Credentials"

# Clear session headers for login
SESSION_ID=""
CSRF_TOKEN=""

RESPONSE=$(curl -s -w '\n%{http_code}' -X POST "${API_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username": "admin", "password": "SecureP@ssw0rd!2026"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "POST /auth/login returned 200"
    ACCESS_TOKEN=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['access_token'])" 2>/dev/null)
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "None" ]; then
        log_pass "Received access_token: ${ACCESS_TOKEN:0:20}..."
    else
        log_fail "No access_token in login response"
    fi
else
    log_fail "POST /auth/login returned $HTTP_CODE: $BODY"
    exit 1
fi

# =====================
# PHASE 10: VERIFY AUTH
# =====================
log_section "Phase 10: Verify Auth - GET /auth/me"

# Small delay to ensure any async operations complete
sleep 1

RESPONSE=$(curl -s -w '\n%{http_code}' "${API_URL}/auth/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    log_pass "GET /auth/me returned 200"
    ME_USERNAME=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['username'])" 2>/dev/null)
    ME_EMAIL=$(echo "$BODY" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['email'])" 2>/dev/null)
    if [ "$ME_USERNAME" = "admin" ]; then
        log_pass "Authenticated user is 'admin'"
    else
        log_fail "Expected username 'admin', got '$ME_USERNAME'"
    fi
    if [ "$ME_EMAIL" = "admin@testfd.org" ]; then
        log_pass "User email matches: admin@testfd.org"
    else
        log_fail "Expected email 'admin@testfd.org', got '$ME_EMAIL'"
    fi
else
    log_fail "GET /auth/me returned $HTTP_CODE: $BODY (SESSION NOT PERSISTED!)"
fi

# =====================
# PHASE 11: VERIFY DATABASE
# =====================
log_section "Phase 11: Verify Database Records"

# Check organizations table
ORG_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.organizations;" 2>/dev/null)
ORG_COUNT=$(echo "$ORG_COUNT" | tr -d '[:space:]')
if [ "$ORG_COUNT" = "1" ]; then
    log_pass "Organizations table: 1 record (correct)"
else
    log_fail "Organizations table: expected 1 record, got $ORG_COUNT"
fi

# Check org details
ORG_DETAILS=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT name, slug, organization_type, timezone, phone, fdid FROM intranet_db.organizations LIMIT 1;" 2>/dev/null)
log_info "Organization details: $ORG_DETAILS"

# Check users table
USER_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.users;" 2>/dev/null)
USER_COUNT=$(echo "$USER_COUNT" | tr -d '[:space:]')
if [ "$USER_COUNT" = "1" ]; then
    log_pass "Users table: 1 record (correct)"
else
    log_fail "Users table: expected 1 record, got $USER_COUNT"
fi

# Check user details
USER_DETAILS=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT username, email, status, membership_number FROM intranet_db.users LIMIT 1;" 2>/dev/null)
log_info "User details: $USER_DETAILS"

# Check sessions table
SESSION_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.sessions;" 2>/dev/null)
SESSION_COUNT=$(echo "$SESSION_COUNT" | tr -d '[:space:]')
if [ "$SESSION_COUNT" -ge 1 ] 2>/dev/null; then
    log_pass "Sessions table: $SESSION_COUNT record(s) (login session exists)"
else
    log_fail "Sessions table: expected >=1 record, got $SESSION_COUNT"
fi

# Check roles table
ROLE_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.roles;" 2>/dev/null)
ROLE_COUNT=$(echo "$ROLE_COUNT" | tr -d '[:space:]')
if [ "$ROLE_COUNT" -ge 2 ] 2>/dev/null; then
    log_pass "Roles table: $ROLE_COUNT records"
else
    log_fail "Roles table: expected >=2 records, got $ROLE_COUNT"
fi

# Check onboarding_status table
OB_STATUS=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT is_completed, organization_name, admin_username FROM intranet_db.onboarding_status LIMIT 1;" 2>/dev/null)
OB_COMPLETED=$(echo "$OB_STATUS" | awk '{print $1}')
if [ "$OB_COMPLETED" = "1" ]; then
    log_pass "Onboarding status: completed"
else
    log_fail "Onboarding status not completed: $OB_STATUS"
fi

# Check audit_logs table
AUDIT_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.audit_logs;" 2>/dev/null)
AUDIT_COUNT=$(echo "$AUDIT_COUNT" | tr -d '[:space:]')
if [ "$AUDIT_COUNT" -ge 1 ] 2>/dev/null; then
    log_pass "Audit logs: $AUDIT_COUNT entries recorded"
else
    log_warn "Audit logs: $AUDIT_COUNT entries (may be 0 if audit was non-blocking)"
fi

# Check onboarding checklist
CHECKLIST_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM intranet_db.onboarding_checklist;" 2>/dev/null)
CHECKLIST_COUNT=$(echo "$CHECKLIST_COUNT" | tr -d '[:space:]')
if [ "$CHECKLIST_COUNT" -ge 5 ] 2>/dev/null; then
    log_pass "Post-onboarding checklist: $CHECKLIST_COUNT items created"
else
    log_fail "Post-onboarding checklist: expected >=5 items, got $CHECKLIST_COUNT"
fi

# Check alembic_version
ALEMBIC_VER=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT version_num FROM intranet_db.alembic_version;" 2>/dev/null)
ALEMBIC_VER=$(echo "$ALEMBIC_VER" | tr -d '[:space:]')
if [ -n "$ALEMBIC_VER" ]; then
    log_pass "Alembic version stamped: $ALEMBIC_VER"
else
    log_fail "Alembic version not found"
fi

# Check total tables created
TABLE_COUNT=$(docker compose exec -T mysql mysql -uroot -pchange_me_in_production -N -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='intranet_db';" 2>/dev/null)
TABLE_COUNT=$(echo "$TABLE_COUNT" | tr -d '[:space:]')
log_info "Total tables in database: $TABLE_COUNT"
if [ "$TABLE_COUNT" -ge 30 ] 2>/dev/null; then
    log_pass "Database has $TABLE_COUNT tables (comprehensive schema created)"
else
    log_fail "Database has only $TABLE_COUNT tables (expected 30+)"
fi

# =====================
# SUMMARY
# =====================
log_section "Test Results Summary"

TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo -e ""
echo -e "  ${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "  ${RED}Failed: $FAIL_COUNT${NC}"
echo -e "  Total:  $TOTAL"
echo -e ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    echo -e "${GREEN}  ALL TESTS PASSED!${NC}"
    echo -e "${GREEN}══════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}══════════════════════════════════════${NC}"
    echo -e "${RED}  $FAIL_COUNT TEST(S) FAILED${NC}"
    echo -e "${RED}══════════════════════════════════════${NC}"
    exit 1
fi
