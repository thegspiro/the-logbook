# Troubleshooting Guide

This guide covers common issues and their solutions for The Logbook deployment.

## Table of Contents

1. [Onboarding Failures](#onboarding-failures)
2. [Redis Container Unhealthy](#redis-container-unhealthy)
3. [Frontend Not Rendering](#frontend-not-rendering)
4. [Malformed API URLs](#malformed-api-urls)
5. [Database Issues](#database-issues)
6. [Onboarding Module Issues](#onboarding-module-issues)
7. [Build Errors](#build-errors)
8. [Docker Issues](#docker-issues)
9. [Network & Connectivity](#network--connectivity)
10. [Authentication & Login Issues](#authentication--login-issues)
11. [Session Management Issues](#session-management-issues)
12. [Role & Permission Issues](#role--permission-issues)
13. [Training Module Issues](#training-module-issues)
14. [API Debugging Guide](#api-debugging-guide)
15. [Common Error Codes Reference](#common-error-codes-reference)
16. [Development Environment Issues](#development-environment-issues)
17. [Performance Issues](#performance-issues)
18. [Security & SSL Issues](#security--ssl-issues)
19. [Backup & Recovery](#backup--recovery)
20. [File Upload Issues](#file-upload-issues)
21. [Email & Notification Issues](#email--notification-issues)
22. [Security Configuration Issues](#security-configuration-issues)
23. [Quick Commands Cheatsheet](#quick-commands-cheatsheet)
24. [Prospective Members Module Issues](#prospective-members-module-issues)
25. [TypeScript Build Issues](#typescript-build-issues)
26. [Inventory Module Issues](#inventory-module-issues)
27. [Events Module Issues](#events-module-issues)
28. [Notification Issues](#notification-issues)
29. [Admin Hours Module Issues](#admin-hours-module-issues)
30. [Scheduling Shift Pattern Issues](#scheduling-shift-pattern-issues)
31. [Elections Module Issues (2026-02-27)](#elections-module-issues-2026-02-27)
32. [Backend Logging & Observability](#backend-logging--observability)
33. [Organization Settings Issues](#organization-settings-issues)

---

## Onboarding Failures

### Problem: Onboarding fails at first step
**Error:** `Failed to load resource: net::ERR_NAME_NOT_RESOLVED`
**URL:** `http//10.187.9.2:7880:7881/onboarding/status`

### Root Cause
Incorrect port mapping in docker-compose.yml - frontend container port mapped to wrong internal port.

### Solution

**1. Fix Port Mapping**

Edit `docker-compose.yml` (or `unraid/docker-compose-unraid.yml` for Unraid):

```yaml
frontend:
  ports:
    - "${FRONTEND_PORT:-7880}:80"  # NOT :3000
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:80/"]
```

**Why:** Nginx listens on port 80, not 3000. The mapping `7880:3000` creates a mismatch.

**2. Rebuild Frontend**

```bash
cd /mnt/user/appdata/the-logbook  # Adjust path as needed
docker-compose down
docker rmi the-logbook-frontend:local
docker-compose build --no-cache frontend
docker-compose up -d
```

**3. Verify**

```bash
# Check container health
docker ps | grep logbook

# Test frontend
curl -I http://YOUR-IP:7880

# Test backend API
curl http://YOUR-IP:7881/health

# Test nginx proxy (CRITICAL)
curl http://YOUR-IP:7880/api/v1/onboarding/status
```

---

## Redis Container Unhealthy

### Problem: Redis container marked as unhealthy, blocking other containers
**Error:** `dependency failed to start: container intranet-redis is unhealthy`

**Redis Logs Show:**
```
WARNING Memory overcommit must be enabled!
Redis is starting...
Ready to accept connections tcp
```

### Root Cause
The Redis health check command outputs a warning message when using password authentication with the `-a` flag. This warning interferes with the `grep PONG` command, causing Docker to mark the container as unhealthy even though Redis is actually running fine.

### Solution

**1. Update docker-compose.yml Health Check**

The health check should include `--no-auth-warning` to suppress the warning:

```yaml
redis:
  healthcheck:
    test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD:-change_me_in_production} --no-auth-warning ping | grep PONG"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

**2. Apply the Fix**

```bash
cd /mnt/user/appdata/the-logbook
git pull
docker-compose down
docker-compose up -d
```

**3. Verify Redis is Healthy**

```bash
docker ps | grep redis
# Should show (healthy) status

# Test Redis manually
docker exec intranet-redis redis-cli -a YOUR_PASSWORD --no-auth-warning ping
# Should return: PONG
```

### Note on Memory Overcommit Warning
The warning about `vm.overcommit_memory` is informational and doesn't prevent Redis from working. To resolve it (optional):

```bash
# On the host system (not in container)
echo 'vm.overcommit_memory = 1' | sudo tee -a /etc/sysctl.conf
sudo sysctl vm.overcommit_memory=1
```

---

## Frontend Not Rendering

### Problem: Blank page, React app doesn't load
**Symptoms:** HTML loads but React doesn't render, 200/304 responses in nginx logs

### Root Cause
Missing or incorrect frontend `.env` file. Vite needs environment variables at **BUILD TIME**.

### Solution

**1. Create/Update frontend/.env (if needed)**

For Docker deployments with nginx proxy (recommended), use relative URLs:

```bash
cd frontend
cat > .env << 'EOF'
# API Configuration - Use relative URL with nginx proxy
VITE_API_URL=/api/v1

# Environment
VITE_ENV=production

# Security - Change in production!
VITE_SESSION_KEY=change-this-to-a-random-32-character-string

# Feature Flags
VITE_ENABLE_PWA=true
VITE_ENABLE_ANALYTICS=false
EOF
```

**Important:**
- Use `VITE_API_URL=/api/v1` (relative URL) for Docker deployments
- The nginx proxy in the frontend container routes `/api` requests to the backend
- **Do NOT use** `http://localhost:3001` - this causes redirect issues
- Make sure there are **no leading spaces** before `VITE_API_URL`

**2. Rebuild Frontend**

```bash
cd ..  # Back to project root
docker-compose stop frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

**3. Check Browser Console**

Press F12 in browser and look for:
- ❌ "Failed to load module script" → Rebuild needed
- ❌ "NetworkError" or "Failed to fetch" → Check VITE_API_URL
- ❌ "CORS policy" blocking → Check backend CORS config

**4. Verify Backend CORS**

Check root `.env` file:
```bash
cat .env | grep ALLOWED_ORIGINS
```

Should contain:
```env
ALLOWED_ORIGINS=["http://YOUR-IP:7880"]
```

If not, update and restart backend:
```bash
docker-compose restart backend
```

---

## Malformed API URLs

### Problem: URLs show `http//` instead of `http://`
**Error:** `http//10.187.9.2:7880:7881/onboarding/status`

### Root Cause
Frontend was built with wrong `VITE_API_URL`. Vite bakes environment variables into JavaScript at build time - they **cannot** be changed at runtime.

### Solution

**1. Use Correct Docker Compose File**

For Unraid deployments:
```bash
# ✅ CORRECT
docker-compose -f unraid/docker-compose-unraid.yml up -d

# ❌ WRONG - Don't use root docker-compose.yml on Unraid
docker-compose up -d
```

The Unraid compose file uses build args correctly:
```yaml
args:
  VITE_API_URL: /api/v1  # Build-time argument for relative URLs
```

**2. Remove Old Image**

```bash
docker rmi the-logbook-frontend:local
docker images | grep logbook  # Verify removal
```

**3. Rebuild with No Cache**

```bash
docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend
docker-compose -f unraid/docker-compose-unraid.yml up -d
```

**4. Verify Build Args**

Check what's actually built into the container:
```bash
docker exec logbook-frontend sh -c "cat /usr/share/nginx/html/assets/index-*.js" | grep -o "http[^\"']*" | head -5
```

Should show **relative URLs** only (`/api/v1/...`), not absolute URLs.

### Understanding Vite Environment Variables

**Critical:** Vite replaces `import.meta.env.VITE_*` with literal values at build time:

```typescript
// Source code:
const url = import.meta.env.VITE_API_URL;

// After build with VITE_API_URL=/api/v1:
const url = "/api/v1";  // ✅ Hardcoded into bundle

// Runtime env vars have NO effect!
```

**Docker ARG vs ENV:**
- `ARG`: Used during `docker build` → ✅ Works with Vite
- `ENV`: Used during `docker run` → ❌ Ignored by Vite

---

## Database Issues

### Problem: "Table doesn't exist" errors
**Error:** `Table 'the_logbook.onboarding_status' doesn't exist`

### Root Cause
Database tables haven't been created yet. This happens on fresh installations.

### Solution

**Automatic (Recommended):** The backend now runs Alembic migrations automatically on startup. Simply restart the backend:

```bash
docker compose restart backend
```

**Manual:** If automatic migrations fail, run them manually:

```bash
docker exec intranet-backend alembic upgrade head
```

**Fresh Start:** If the database is corrupted, reset it completely:

```bash
docker compose down
docker volume rm the-logbook_mysql_data
docker compose up -d
```

The MySQL container will automatically run the initial schema from `database/schemas/001_initial_schema.sql` on first start.

---

### Problem: MySQL healthcheck fails on first start
**Error:** `container intranet-mysql is unhealthy`

### Root Cause
MySQL first-time initialization takes longer than the healthcheck timeout, especially when running schema files.

### Solution

The healthcheck has been configured with:
- `start_period: 60s` - Allows MySQL time to initialize
- `retries: 12` - Total ~3 minute timeout

If MySQL still fails, check its logs:

```bash
docker compose logs mysql --tail 50
```

Wait for MySQL to fully initialize, then restart other services:

```bash
docker compose up -d
```

---

### Problem: SQLAlchemy relationship error
**Error:** `Could not determine join condition between parent/child tables on relationship User.roles`

### Root Cause
The `user_roles` table has two foreign keys to the `users` table (`user_id` and `assigned_by`), causing SQLAlchemy to be unable to determine which to use for the relationship.

### Solution
This has been fixed in the codebase. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

---

### Problem: Greenlet library missing
**Error:** `the greenlet library is required to use this function. No module named 'greenlet'`

### Root Cause
SQLAlchemy's async operations require the `greenlet` library, which was missing from dependencies.

### Solution
This has been fixed in the codebase. Pull and rebuild:

```bash
git pull origin main
docker compose build backend --no-cache
docker compose up -d
```

---

### Problem: "Duplicate key name" error on startup
**Error:** `(1061, "Duplicate key name 'ix_locations_organization_id'")` or `"Duplicate key name 'ix_voting_tokens_token'"`

**Symptom:** Backend crashes immediately with `Application startup failed. Exiting.`

### Root Cause
SQLAlchemy models had a column with `index=True` AND an explicit `Index()` with the same auto-generated name (`ix_<tablename>_<columnname>`) in `__table_args__`. MySQL rejects the duplicate index name during `create_all()`.

### Solution
This has been fixed in the codebase. Pull the latest changes:

```bash
git pull origin main
docker compose down
docker volume rm the-logbook_mysql_data  # Recommended for clean start
docker compose up -d
```

**If developing new models**, use only one indexing method per column:
```python
# Option A: index=True on column (simple)
col = Column(String(36), index=True)

# Option B: Explicit Index in __table_args__ (preferred for clarity)
col = Column(String(36))
__table_args__ = (Index("ix_table_col", "col"),)

# NEVER both — causes duplicate key crash on MySQL
```

---

### Problem: MySQL deprecation warnings in logs
**Warnings:**
- `'default_authentication_plugin' is deprecated`
- `'mysql_native_password' is deprecated`
- `innodb_log_file_size and/or innodb_log_files_in_group have been used`
- `'--skip-host-cache' is deprecated`

### Root Cause
MySQL 8.0.34+ deprecated several configuration options that were commonly used.

### Solution
This has been fixed in the codebase. The docker-compose.yml now uses:
- `--innodb_redo_log_capacity` instead of `--innodb_log_file_size`
- `--host-cache-size=0` instead of `--skip-host-cache`
- `caching_sha2_password` as the default authentication (MySQL 8.0 native)

Pull the latest changes:

```bash
git pull origin main
docker compose down
docker volume rm the-logbook_mysql_data  # Required for auth change
docker compose up -d
```

**Note:** If you have existing data, you may need to recreate the database volume for the authentication change to take effect. Back up your data first if needed.

---

## Onboarding Module Issues

### Problem: "Invalid modules" error during onboarding
**Error:** `Invalid modules: members, events, documents`

### Root Cause
The backend's module validation list was outdated and didn't include all the module IDs used by the frontend.

### Solution
This has been fixed in the codebase. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

The valid module IDs now include:
- **Essential:** `members`, `events`, `documents`
- **Operations:** `training`, `inventory`, `scheduling`
- **Governance:** `elections`, `minutes`, `reports`
- **Communication:** `notifications`, `mobile`
- **Advanced:** `forms`, `integrations`
- **Legacy:** `compliance`, `meetings`, `fundraising`, `incidents`, `equipment`, `vehicles`, `budget`

---

### Problem: Organization setup fails at Step 1
**Error:** `Invalid ZIP/postal code format` or `Organization name contains invalid characters`

### Root Cause
The new comprehensive organization setup has strict validation:
- ZIP codes must be 5 digits (12345) or 9 digits with dash (12345-6789)
- Organization names cannot contain special characters like `<`, `>`, `;`, `--`

### Solution
Ensure you're entering valid data:
- Use proper US ZIP code format
- Avoid SQL injection-like characters in organization name
- All required fields (name, mailing address) must be filled

---

### Problem: Database migration conflicts
**Error:** `Target database is not up to date` or `Can't locate revision`

### Root Cause
Multiple migration files may have conflicting revision IDs or missing parent revisions.

### Solution
1. Check migration chain:
```bash
cd backend/alembic/versions
grep -E "^(revision|down_revision)" *.py
```

2. Verify single linear chain (no duplicate revision IDs)

3. If conflicts exist, contact support or check for duplicate migration files

4. Run migrations:
```bash
docker exec intranet-backend alembic upgrade head
```

---

### Problem: Organization type or identifier type enum errors
**Error:** `Invalid enum value` for organization_type or identifier_type

### Root Cause
The database enum types don't match the API values.

### Solution
Valid values are:
- **organization_type:** `fire_department`, `ems_only`, `fire_ems_combined`
- **identifier_type:** `fdid`, `state_id`, `department_id`

If database was created before enum migration, run:
```bash
docker exec intranet-backend alembic upgrade head
```

---

### Problem: Module selections not persisting when navigating back
**Symptom:** After selecting modules and clicking Continue, going back shows default selections again.

### Root Cause
The frontend was using local React state instead of the persistent Zustand store.

### Solution
This has been fixed in the codebase. Module configurations now persist in localStorage via the Zustand store. Pull the latest changes:

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: IT Team information not persisting when navigating back (Step 7)
**Symptom:** IT team members, backup email, and phone information disappear when going back.

### Root Cause
Same issue - using local state instead of persistent store.

### Solution
Fixed in the codebase. Pull the latest changes:

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: Need to reset onboarding and start over
**Symptom:** Want to clear all onboarding progress and start fresh.

### Solution
A "Reset Progress" button is now available on all onboarding pages (top right, opposite the Back button). Clicking it will:

1. Show a confirmation dialog warning about data deletion
2. Clear all onboarding database records
3. Clear local storage
4. Redirect to the start page

**Manual Reset (if button not available):**

```bash
# Clear onboarding data from database
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> DELETE FROM onboarding_sessions;
> DELETE FROM onboarding_status;
> DELETE FROM organizations;  -- Removes org created during onboarding
> EXIT;

# Clear browser localStorage
# In browser console (F12): localStorage.clear()
```

---

### Problem: Admin user creation "Create Admin" button stays disabled
**Symptom:** All required fields are filled in, password meets all requirements, but the "Create Admin & Complete Setup" button remains grayed out and disabled.

### Root Cause
The form validation was checking that **all** fields (including the optional Badge Number) had non-empty values using `Object.values(formData).every(...)`. Since Badge Number is optional, leaving it empty caused the form to appear invalid.

### Solution
This has been fixed in the codebase. The validation now checks only the 6 required fields: username, email, firstName, lastName, password, confirmPassword. Pull the latest changes:

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: Organization setup "Continue" button shows no loading indicator
**Symptom:** After clicking "Continue" on the Organization Setup page, the button doesn't change appearance or show a spinner during the save operation.

### Root Cause
The loading state (`isSaving`) was wired to the `useApiRequest` hook, but the actual API call used `useOnboardingSession.saveOrganization()` which tracks its loading state separately. The button checked the wrong variable.

### Solution
This has been fixed in the codebase. Pull the latest changes:

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: Security check passes even with default/insecure keys
**Symptom:** Onboarding security verification shows all checks passed, but you never changed the default `SECRET_KEY` or `ENCRYPTION_KEY` in your `.env` file.

### Root Cause
The onboarding security check was comparing keys against stale default strings (`"change_me_to_random_64_character_string"`) that didn't match the actual defaults in `config.py` (`"INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION"`). This caused the check to silently pass.

### Solution
This has been fixed in the codebase. The security check now uses substring matching for `"INSECURE_DEFAULT"`, consistent with `config.py`. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

To verify your security configuration after the fix:
```bash
curl http://YOUR-IP:7881/api/v1/onboarding/security-check | jq
```

---

### Problem: Welcome page shows blank screen for several seconds
**Symptom:** On first visit, the Welcome page (`/`) displays a completely dark/blank screen before any text appears.

### Root Cause
The title animation had a 3-second delay before appearing, with the body content following at 4 seconds.

### Solution
This has been fixed in the codebase. The title now appears after 300ms and the body after 800ms — still animated but without the blank-screen wait. Pull the latest changes:

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: Onboarding returns 403 "Access denied from your location"
**Symptom:** All onboarding API calls fail with a 403 status code and the message "Access denied from your location" / error code `GEO_BLOCKED`.

### Root Cause
The GeoIP middleware (`IPBlockingMiddleware`) was blocking ALL API requests from countries in the `BLOCKED_COUNTRIES` list — including onboarding endpoints. Since onboarding runs before any configuration exists, there's no way for a blocked user to allowlist their IP or disable geo-blocking.

### Solution
This has been fixed in the codebase. Onboarding endpoints (`/api/v1/onboarding/*`) are now exempt from GeoIP blocking. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

**If you need to disable GeoIP blocking entirely:**
```bash
# In your .env file:
GEOIP_ENABLED=false
```

**If you want to customize blocked countries:**
```bash
# In your .env file (comma-separated ISO 3166-1 alpha-2 codes):
BLOCKED_COUNTRIES=KP,IR,SY,CU
```

---

### Problem: Email configuration test hangs indefinitely
**Symptom:** Clicking "Test Connection" on the email configuration page causes the UI to spin forever with no response. The browser may eventually show a timeout or the request stays pending.

### Root Cause
The email test endpoint (`POST /api/v1/onboarding/test/email`) runs SMTP connection tests in a thread pool without a timeout. If the mail server is unreachable, firewalled, or slow, the connection attempt can hang for minutes (limited only by OS TCP timeout).

### Solution
This has been fixed in the codebase. Email tests now have a 30-second timeout. If the server doesn't respond within 30 seconds, the user gets a clear timeout message. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

**If you see timeouts consistently:** Your network may be blocking outbound SMTP traffic (ports 25, 465, 587). Check with your network administrator or cloud provider.

---

### Problem: Onboarding reset endpoint accessible without authentication
**Symptom:** Security concern — the `POST /api/v1/onboarding/reset` endpoint could be called by anyone, even without a valid session, potentially wiping all data.

### Root Cause
The reset endpoint was catching and ignoring session validation errors to handle the case where a session expired during a failed onboarding attempt. However, this also allowed unauthenticated callers to trigger a full data wipe.

### Solution
This has been fixed in the codebase. The reset endpoint now:
1. Checks if onboarding has been completed — if so, reset is blocked entirely
2. Only allows reset without a session if onboarding is still in progress (needs_onboarding returns True)
3. After onboarding is complete, system data can only be managed through the admin panel

Pull the latest changes:
```bash
git pull origin main
docker compose restart backend
```

---

## Build Errors

### Problem: TypeScript errors during Docker build

### Solution 1: Pull Latest Changes

```bash
cd /mnt/user/appdata/the-logbook
git pull origin YOUR-BRANCH-NAME
docker-compose build --no-cache
docker-compose up -d
```

### Solution 2: Handle Local Changes

If git pull fails due to local changes:

```bash
# Option 1: Stash changes
git stash
git pull
git stash pop

# Option 2: Reset to remote (loses local changes)
git fetch origin
git reset --hard origin/YOUR-BRANCH-NAME
```

### Solution 3: Clean Docker Cache

```bash
docker-compose down
docker system prune -a
docker-compose build --no-cache
docker-compose up -d
```

---

## Docker Issues

### Issue: MySQL image missing
**Error:** `No such image: mysql:8.0`

**Fix:**
```bash
docker pull mysql:8.0
```

### Issue: npm not found in container
**Error:** `exec: "npm": executable file not found in $PATH`

**Cause:** Wrong container being used for npm command, or Node.js not installed.

**Fix:** Ensure you're running npm commands in the frontend build stage, not the runtime container.

### Issue: Frontend image pull denied
**Error:** `pull access denied for the-logbook-frontend`

**Cause:** Docker trying to pull from Docker Hub instead of building locally.

**Fix:** Check docker-compose.yml - should have `build:` section, not `image:` for frontend service.

---

## Network & Connectivity

### Verify Container Network

```bash
# Check containers are on same network
docker network inspect logbook-internal

# Test connectivity between containers
docker-compose exec frontend ping -c 3 backend
docker-compose exec backend ping -c 3 frontend

# Test from frontend to backend
docker exec logbook-frontend wget -qO- http://backend:3001/health
```

### Check Container Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f frontend
docker-compose logs -f backend

# Last 50 lines
docker logs logbook-frontend --tail 50
```

### Verify Build Artifacts

```bash
# Check frontend files exist
docker-compose exec frontend ls -la /usr/share/nginx/html/
docker-compose exec frontend ls -la /usr/share/nginx/html/assets/

# Check nginx config
docker exec logbook-frontend cat /etc/nginx/conf.d/default.conf
```

---

## Complete Fresh Rebuild (Nuclear Option)

If all else fails, rebuild everything from scratch:

```bash
cd /mnt/user/appdata/the-logbook

# Stop and remove all containers
docker-compose down

# Remove containers and cleanup
docker-compose rm -f
docker system prune -f

# Verify .env files are correct
cat .env
cat frontend/.env

# Rebuild and start
docker-compose build --no-cache
docker-compose up -d

# Watch logs for errors
docker-compose logs -f
```

---

## Expected Successful State

### Frontend Logs
```
/docker-entrypoint.sh: Configuration complete; ready for start up
```

### Backend Logs
```
INFO:     Started server process
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:3001
```

### Browser
- Welcome page with animated logo loads
- No errors in console (F12)
- Click "Begin Setup" to start onboarding

### API
- `http://YOUR-IP:7881/docs` → FastAPI documentation
- `http://YOUR-IP:7881/health` → Health status JSON

---

## Security Configuration Issues

### Problem: Backend fails to start with "SECURITY FAILURE" error
**Error:** `SECURITY FAILURE: Cannot start with insecure default configuration`

### Root Cause
The backend validates security configuration on startup in production mode. If critical security variables are missing or use default values, the application will refuse to start when `SECURITY_BLOCK_INSECURE_DEFAULTS=true` (the default).

### Required Security Variables

| Variable | Purpose | How to Generate |
|----------|---------|-----------------|
| `SECRET_KEY` | JWT signing key (min 32 chars) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | AES encryption key (32 bytes hex) | `openssl rand -hex 32` |
| `ENCRYPTION_SALT` | Key derivation salt (unique per installation) | `openssl rand -hex 16` |
| `DB_PASSWORD` | Database password (not `change_me_in_production`) | `openssl rand -base64 32` |
| `REDIS_PASSWORD` | Redis password (required in production) | `openssl rand -base64 32` |

### Solution

**1. Generate all required secrets:**
```bash
# Generate and display all secrets at once
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_SALT=$(openssl rand -hex 16)"
echo "DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
```

**2. Add to your `.env` file:**
```bash
# Security Keys (REQUIRED - Generate unique values!)
SECRET_KEY=your_generated_64_char_hex_string
ENCRYPTION_KEY=your_generated_64_char_hex_string
ENCRYPTION_SALT=your_generated_32_char_hex_string

# Database & Redis Passwords
DB_PASSWORD=your_generated_secure_password
REDIS_PASSWORD=your_generated_secure_password
```

**3. Restart the backend:**
```bash
docker-compose restart backend
```

### Verifying Security Configuration

Check the backend health endpoint for security status:
```bash
curl http://YOUR-IP:7881/health | jq '.checks.security'
```

Expected response for a properly configured system:
```json
{
  "status": "ok"
}
```

If security issues exist:
```json
{
  "status": "issues_detected",
  "critical_issues": 2,
  "warnings": 1
}
```

### Development Mode Override

For local development only, you can disable the security block:
```bash
# In .env (NEVER use in production!)
ENVIRONMENT=development
SECURITY_BLOCK_INSECURE_DEFAULTS=false
```

**WARNING:** Never disable security checks in production. The application will still log warnings about insecure configuration.

---

### Problem: "ENCRYPTION_SALT not set" warning in logs
**Warning:** `SECURITY WARNING: ENCRYPTION_SALT not set. Using derived salt (less secure).`

### Root Cause
The `ENCRYPTION_SALT` environment variable is missing. While the application will start and derive a salt from other values, this is less secure and not recommended for production.

### Why ENCRYPTION_SALT Matters
- Used for secure key derivation (PBKDF2) when encrypting sensitive data
- Each installation should have a unique salt
- Without it, the derived salt depends on other configuration values which may be predictable

### Solution
Add `ENCRYPTION_SALT` to your `.env` file:

```bash
# Generate a 16-byte hex salt (32 characters)
openssl rand -hex 16

# Add to .env
ENCRYPTION_SALT=your_generated_32_char_hex_string
```

For Docker Compose, ensure it's passed to the backend:
```yaml
# In docker-compose.yml
backend:
  environment:
    ENCRYPTION_SALT: ${ENCRYPTION_SALT:-change_me_in_production}
```

---

### Problem: Configuration validation shows critical issues but app still runs
**Symptom:** Health check shows `critical_issues: X` but application is running

### Root Cause
`SECURITY_BLOCK_INSECURE_DEFAULTS` may be set to `false`, or the environment is set to `development`.

### Solution
1. Set `ENVIRONMENT=production` in `.env`
2. Ensure `SECURITY_BLOCK_INSECURE_DEFAULTS=true` (or remove it, as true is the default)
3. Fix all critical security issues listed above
4. Restart the backend

---

### Problem: 500 error responses show internal exception details
**Symptom:** API 500 errors return raw Python exception messages like `"detail": "Failed to create organization: IntegrityError(...)"`, which reveals database schema, table names, or query structure.

### Root Cause
Some error handlers were passing `str(e)` directly into the HTTPException `detail` field, leaking internal error information to clients.

### Solution
This has been fixed in the codebase. Error handlers now log full details internally (via `logger.error()`) and return generic messages to clients: `"Failed to create organization. Please check the server logs for details."` Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

**If you need to debug a 500 error:** Check the backend container logs instead of the API response:
```bash
docker compose logs backend --tail=50
```

---

### Problem: Temporary passwords visible in application logs
**Symptom:** When creating a new user with `send_welcome_email: true`, the temporary password was previously written to the application log in plaintext.

### Root Cause
A development-only logging statement (`logger.info(f"Temporary password for {username}: {temp_password}")`) was left in the user creation endpoint.

### Solution
This has been fixed in the codebase. Temporary passwords are no longer logged. The email service should be used to deliver temporary passwords or password reset links. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

---

### Problem: Health endpoint reveals database/Redis connection error details
**Symptom:** The `/health` endpoint returns raw exception messages like `"database": "error: (2003, \"Can't connect to MySQL server...\")"`, revealing internal infrastructure details.

### Root Cause
Exception strings were included directly in the health check response, potentially exposing database hostnames, ports, or connection configuration.

### Solution
This has been fixed in the codebase. The health endpoint now returns only the status (`"error"`, `"connected"`, `"disconnected"`) without raw exception details. Full errors are logged internally. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

---

### Problem: Authentication failure logs reveal whether username exists
**Symptom:** Backend logs show different messages for different failure modes: `"user not found"` vs `"invalid password"` vs `"no password set"`. An attacker with log access could enumerate valid usernames.

### Root Cause
Authentication failure logging used distinct messages for each failure type, which is an information disclosure vulnerability.

### Solution
This has been fixed in the codebase. All authentication failures now log a uniform message: `"Authentication failed for login attempt"` (pre-login) or `"Authentication failed: invalid credentials"` (wrong password). Account lockout events still log the username for security incident response. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

---

### Problem: `.env` file accidentally committed to git
**Symptom:** Secrets (database passwords, encryption keys, API keys) are visible in the git repository history.

### Root Cause
The `.gitignore` file did not include `.env` entries, so `.env` files could be accidentally committed.

### Solution
`.env` files are now excluded via `.gitignore`. Pull the latest changes:

```bash
git pull origin main
```

If a `.env` file was already committed, remove it from tracking:
```bash
git rm --cached .env
git commit -m "Remove .env from tracking"
git push
```

**IMPORTANT:** If secrets were committed, consider them compromised. Rotate all affected secrets immediately:
```bash
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_SALT=$(openssl rand -hex 16)"
echo "DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
```

---

## Quick Diagnostic Checklist

### Security Configuration
- [ ] `SECRET_KEY` is set (min 32 characters, does not contain `INSECURE_DEFAULT`)
- [ ] `ENCRYPTION_KEY` is set (64 hex characters, does not contain `INSECURE_DEFAULT`)
- [ ] `ENCRYPTION_SALT` is set (32 hex characters, unique per installation)
- [ ] `DB_PASSWORD` is not `change_me_in_production`
- [ ] `REDIS_PASSWORD` is set (required in production)

> **Note**: The onboarding security check uses substring matching — any key containing `"INSECURE_DEFAULT"` is flagged as critical. The factory defaults (`INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION` for SECRET_KEY, `INSECURE_DEFAULT_KEY_CHANGE_ME` for ENCRYPTION_KEY) will both be caught. This matches the validation in `backend/app/core/config.py`.

### Secret Handling
- [ ] `.env` files are in `.gitignore` (never committed to version control)
- [ ] No passwords logged in application output (temporary passwords are never logged)
- [ ] Health endpoint does not expose raw error strings (shows only "error" status)
- [ ] API error responses do not leak internal exception details
- [ ] Frontend console logging restricted in production mode
- [ ] Authentication failure logs do not reveal whether username exists or password was wrong

### Application Configuration
- [ ] Frontend `.env` exists with correct `VITE_API_URL`
- [ ] Backend `.env` has `ALLOWED_ORIGINS` with frontend URL
- [ ] Root `.env` has correct `FRONTEND_PORT` and `BACKEND_PORT`
- [ ] Using correct docker-compose file (Unraid vs dev)
- [ ] Frontend rebuilt after env changes
- [ ] All containers running: `docker-compose ps`
- [ ] Backend accessible: `curl http://YOUR-IP:7881/health`
- [ ] Frontend accessible: `curl -I http://YOUR-IP:7880`
- [ ] No JavaScript errors in browser console
- [ ] Port mapping correct (`:80` not `:3000` for frontend)

---

## Authentication & Login Issues

### Problem: "Invalid credentials" when logging in
**Error:** `Authentication failed: Invalid credentials`

### Root Cause
The password or email entered doesn't match the database records, or the user account doesn't exist.

### Solution
1. **Verify user exists:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT id, email, active FROM users WHERE email = 'user@example.com';
```

2. **Check if account is active:**
```sql
> SELECT active, failed_login_attempts, locked_until FROM users WHERE email = 'user@example.com';
```

3. **Reset password (if needed):**
```bash
# Generate a new password hash in Python
docker exec -it intranet-backend python -c "from passlib.context import CryptContext; pwd = CryptContext(schemes=['bcrypt']); print(pwd.hash('newpassword'))"

# Update in database
> UPDATE users SET password_hash = 'generated_hash_here', failed_login_attempts = 0, locked_until = NULL WHERE email = 'user@example.com';
```

---

### Problem: Account locked after failed login attempts
**Error:** `Account locked. Try again later.`

### Root Cause
Too many failed login attempts triggered the account lockout security feature.

### Solution
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = 'user@example.com';
```

---

### Problem: JWT token errors
**Error:** `Token expired` or `Invalid token signature`

### Root Cause
- Token has expired (default: 24 hours)
- JWT secret key changed between token issuance and validation
- Token was tampered with

### Solution
1. **Clear browser storage and re-login:**
   - Open browser DevTools (F12)
   - Go to Application → Local Storage
   - Delete all entries for your site
   - Refresh and login again

2. **Verify JWT secret consistency:**
```bash
# Check backend .env
cat .env | grep JWT_SECRET

# Ensure it's the same across all backend instances
```

3. **Check token expiration setting:**
```bash
cat .env | grep ACCESS_TOKEN_EXPIRE
# Default: ACCESS_TOKEN_EXPIRE_MINUTES=1440 (24 hours)
```

---

## Session Management Issues

### Problem: Session lost after page refresh
**Symptom:** User gets logged out after refreshing the page

### Root Cause
- LocalStorage or cookies being cleared
- Frontend not persisting session token correctly
- Backend session validation failing

### Solution
1. **Check browser storage:**
   - DevTools (F12) → Application → Local Storage
   - Look for `auth-token` or similar keys
   - Verify token exists after login

2. **Verify session in backend:**
```bash
# Check active sessions
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT * FROM user_sessions WHERE user_id = YOUR_USER_ID ORDER BY created_at DESC LIMIT 5;
```

3. **Check for CORS issues:**
```bash
# Verify credentials are being sent
curl -v -X OPTIONS http://YOUR-IP:7881/api/v1/auth/me \
  -H "Origin: http://YOUR-IP:7880" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization"
```

---

### Problem: "Session expired" popup appears unexpectedly
**Symptom:** User gets session expired message while actively using the app

### Root Cause
- Backend token refresh not working
- Network issues causing failed token validation
- Clock skew between frontend and backend

### Solution
1. **Check backend logs for token errors:**
```bash
docker logs intranet-backend 2>&1 | grep -i "token\|session\|auth"
```

2. **Verify system time sync:**
```bash
# On host
date
# In backend container
docker exec intranet-backend date
```

3. **Check for network timeouts:**
```bash
# Increase timeout in frontend if needed
# Check network tab in DevTools for slow API responses
```

---

## Role & Permission Issues

### Problem: "Permission denied" when accessing a feature
**Error:** `You don't have permission to access this resource`

### Root Cause
User's role doesn't have the required permission for the requested action.

### Solution
1. **Check user's current roles:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT r.name, r.slug, ur.assigned_at
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = YOUR_USER_ID;
```

2. **Check role permissions:**
```sql
> SELECT rp.permission, rp.access_level
  FROM role_permissions rp
  JOIN roles r ON rp.role_id = r.id
  WHERE r.slug = 'user_role_slug';
```

3. **Verify permission naming:**
Valid permission format: `module.action` (e.g., `members.view`, `events.manage`)

Access levels:
- `view` - Read-only access
- `manage` - Full CRUD operations

4. **Add missing permission to role:**
```sql
> INSERT INTO role_permissions (role_id, permission, access_level)
  SELECT id, 'members.view', 'view' FROM roles WHERE slug = 'member';
```

---

### Problem: Role changes not taking effect
**Symptom:** After changing a user's role, they still have old permissions

### Root Cause
- Cached permissions in frontend
- User token contains old role claims

### Solution
1. **User should log out and log back in** to get a new token with updated roles

2. **Clear frontend cache:**
```javascript
// In browser console
localStorage.clear();
sessionStorage.clear();
location.reload();
```

3. **Verify role assignment in database:**
```sql
> SELECT * FROM user_roles WHERE user_id = YOUR_USER_ID;
```

---

### Problem: Custom role not appearing in role list
**Symptom:** A newly created role doesn't show up in the UI

### Root Cause
- Role not marked as active
- Role not associated with the current organization

### Solution
```sql
> SELECT id, name, slug, active, organization_id FROM roles WHERE name LIKE '%role_name%';

# If inactive, activate it:
> UPDATE roles SET active = 1 WHERE slug = 'your_role_slug';

# If wrong organization:
> UPDATE roles SET organization_id = CORRECT_ORG_ID WHERE slug = 'your_role_slug';
```

---

## Training Module Issues

### Problem: Training categories not loading
**Symptom:** Category dropdown is empty or shows error

### Root Cause
- Categories not created for the organization
- API endpoint returning error
- Categories marked as inactive

### Solution
1. **Check if categories exist:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT id, name, code, active FROM training_categories WHERE organization_id = 'YOUR_ORG_ID';
```

2. **Create initial categories if none exist:**
```sql
> INSERT INTO training_categories (id, organization_id, name, code, active, created_at)
  VALUES (UUID(), 'YOUR_ORG_ID', 'Firefighting', 'FF', 1, NOW());
```

3. **Check API response:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://YOUR-IP:7881/api/v1/training/categories
```

4. **Verify user has training permissions:**
```sql
> SELECT rp.permission FROM role_permissions rp
  JOIN user_roles ur ON ur.role_id = rp.role_id
  WHERE ur.user_id = 'YOUR_USER_ID' AND rp.permission LIKE 'training%';
```

---

### Problem: Training requirement due date calculation incorrect
**Symptom:** Due dates show wrong values or don't update after completion

### Root Cause
- Incorrect `due_date_type` configuration
- Missing `rolling_period_months` for rolling requirements
- Incorrect `period_start_month`/`period_start_day` for calendar period

### Solution
1. **Check requirement configuration:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT name, due_date_type, rolling_period_months, period_start_month, period_start_day
  FROM training_requirements WHERE id = 'REQUIREMENT_ID';
```

2. **Verify due date type values:**
Valid values are:
- `calendar_period` (default) - Due by end of calendar period
- `rolling` - Due X months from last completion
- `certification_period` - Due when certification expires
- `fixed_date` - Due by specific date

3. **For calendar period issues:**
```sql
-- Example: Annual requirement due Dec 31
> UPDATE training_requirements
  SET due_date_type = 'calendar_period',
      period_start_month = 1,
      period_start_day = 1
  WHERE id = 'REQUIREMENT_ID';
```

4. **For rolling period issues:**
```sql
-- Example: CPR every 2 years (24 months)
> UPDATE training_requirements
  SET due_date_type = 'rolling',
      rolling_period_months = 24
  WHERE id = 'REQUIREMENT_ID';
```

---

### Problem: Training records not counting toward category-based requirement
**Symptom:** Completed training not showing progress on requirement

### Root Cause
- Course not assigned to required category
- Requirement's `category_ids` not configured
- Training record status not "completed"

### Solution
1. **Check requirement's category configuration:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SELECT name, category_ids FROM training_requirements WHERE id = 'REQUIREMENT_ID';
```

2. **Check course's category assignment:**
```sql
> SELECT name, category_ids FROM training_courses WHERE id = 'COURSE_ID';
```

3. **Verify categories match:**
The course's `category_ids` must include at least one category from the requirement's `category_ids`.

4. **Update course categories if needed:**
```sql
> UPDATE training_courses
  SET category_ids = '["category-uuid-1", "category-uuid-2"]'
  WHERE id = 'COURSE_ID';
```

5. **Verify training record is completed:**
```sql
> SELECT status, completion_date FROM training_records
  WHERE user_id = 'USER_ID' AND course_id = 'COURSE_ID';
```

---

### Problem: Training officer dashboard not showing data
**Symptom:** Dashboard widgets empty or showing loading forever

### Root Cause
- API endpoints not responding
- User lacks training officer permissions
- No training data exists yet

### Solution
1. **Check API health:**
```bash
curl http://YOUR-IP:7881/api/v1/training/requirements
curl http://YOUR-IP:7881/api/v1/training/records
```

2. **Verify training officer role:**
```sql
> SELECT r.name, r.slug FROM roles r
  JOIN user_roles ur ON ur.role_id = r.id
  WHERE ur.user_id = 'YOUR_USER_ID';
-- Should include 'training_officer' or similar role
```

3. **Check for required permissions:**
```sql
> SELECT permission, access_level FROM role_permissions
  WHERE role_id IN (SELECT role_id FROM user_roles WHERE user_id = 'YOUR_USER_ID')
  AND permission LIKE 'training%';
```

4. **Verify backend logs for errors:**
```bash
docker logs intranet-backend 2>&1 | grep -i "training\|error"
```

---

### Problem: Cannot create training category - validation error
**Error:** `Invalid color format` or `Parent category not found`

### Solution
1. **Color validation:**
   - Color must be a valid hex code: `#RRGGBB`
   - Example: `#FF5733` (valid), `FF5733` (invalid - missing #)

2. **Parent category:**
   - If specifying `parent_category_id`, it must be an existing, active category
   - Parent must belong to the same organization

3. **Code uniqueness:**
   - Category `code` must be unique within the organization
   - Check existing codes:
   ```sql
   > SELECT code FROM training_categories WHERE organization_id = 'YOUR_ORG_ID';
   ```

---

### Problem: Training requirement deletion fails
**Error:** `Cannot delete requirement with active enrollments`

### Root Cause
The requirement is linked to active program enrollments or has progress records.

### Solution
1. **Check for linked enrollments:**
```sql
> SELECT pe.id, pe.status, u.email
  FROM program_enrollments pe
  JOIN requirement_progress rp ON rp.enrollment_id = pe.id
  JOIN users u ON u.id = pe.user_id
  WHERE rp.requirement_id = 'REQUIREMENT_ID' AND pe.status = 'active';
```

2. **Option A: Soft delete (recommended):**
Instead of deleting, deactivate the requirement:
```sql
> UPDATE training_requirements SET active = 0 WHERE id = 'REQUIREMENT_ID';
```

3. **Option B: Complete or withdraw enrollments first:**
```sql
-- Mark enrollments as completed or withdrawn before deleting
> UPDATE program_enrollments SET status = 'withdrawn'
  WHERE id IN (
    SELECT DISTINCT pe.id FROM program_enrollments pe
    JOIN requirement_progress rp ON rp.enrollment_id = pe.id
    WHERE rp.requirement_id = 'REQUIREMENT_ID'
  );
```

---

### Problem: Alembic migration fails for training tables
**Error:** `Can't locate revision` or `Table already exists`

### Solution
1. **Check current migration state:**
```bash
docker exec intranet-backend alembic current
docker exec intranet-backend alembic history
```

2. **If training_categories table missing:**
```bash
docker exec intranet-backend alembic upgrade head
```

3. **If migration conflicts:**
```bash
# Check for the specific training migration
docker exec intranet-backend alembic history | grep training

# Stamp to specific revision if needed
docker exec intranet-backend alembic stamp 20260205_0100
```

4. **Manual table creation (emergency only):**
```sql
-- Only use if migration system is broken
CREATE TABLE training_categories (
  id VARCHAR(36) PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  description TEXT,
  color VARCHAR(7),
  parent_category_id VARCHAR(36),
  sort_order INT DEFAULT 0,
  icon VARCHAR(50),
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by VARCHAR(36),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_category_id) REFERENCES training_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_category_org_code ON training_categories(organization_id, code);
CREATE INDEX idx_category_parent ON training_categories(parent_category_id);
```

---

### Problem: Training hours not accumulating correctly
**Symptom:** Total hours in dashboard don't match expected values

### Root Cause
- Training records missing `hours_completed` field
- Records with wrong status (not "completed")
- Date filtering excluding relevant records

### Solution
1. **Check training records:**
```sql
> SELECT id, course_name, hours_completed, status, completion_date
  FROM training_records
  WHERE user_id = 'USER_ID'
  ORDER BY completion_date DESC;
```

2. **Verify hours are set:**
```sql
-- Records without hours
> SELECT id, course_name FROM training_records
  WHERE user_id = 'USER_ID' AND (hours_completed IS NULL OR hours_completed = 0);
```

3. **Check status values:**
```sql
-- Should be 'completed' to count
> SELECT status, COUNT(*) FROM training_records
  WHERE user_id = 'USER_ID' GROUP BY status;
```

4. **Verify date range:**
For period-based requirements, ensure records fall within the current period.

---

## API Debugging Guide

### Testing API Endpoints

**Health Check:**
```bash
curl http://YOUR-IP:7881/health
# Expected: {"status":"healthy","database":"connected",...}
```

**Authentication Test:**
```bash
# Login and get token
curl -X POST http://YOUR-IP:7881/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}'

# Use token for authenticated requests
curl http://YOUR-IP:7881/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Onboarding Status:**
```bash
curl http://YOUR-IP:7881/api/v1/onboarding/status
```

---

### Problem: API returns 500 Internal Server Error
**Symptom:** API calls fail with generic 500 error

### Solution
1. **Check backend logs for detailed error:**
```bash
docker logs intranet-backend --tail 100 2>&1 | grep -A 5 "ERROR\|Exception\|Traceback"
```

2. **Enable debug mode (development only):**
```bash
# In backend .env
DEBUG=true
LOG_LEVEL=DEBUG

docker compose restart backend
```

3. **Test database connectivity:**
```bash
docker exec intranet-backend python -c "
from app.database import get_db
import asyncio
async def test():
    async for db in get_db():
        result = await db.execute('SELECT 1')
        print('Database OK:', result.scalar())
asyncio.run(test())
"
```

---

### Problem: API returns 422 Unprocessable Entity
**Symptom:** POST/PUT requests fail with validation errors

### Root Cause
Request body doesn't match expected Pydantic schema.

### Solution
1. **Check API documentation:**
```bash
# Open in browser
http://YOUR-IP:7881/docs  # Swagger UI
http://YOUR-IP:7881/redoc # ReDoc
```

2. **Verify request format:**
```bash
# Example with verbose output
curl -v -X POST http://YOUR-IP:7881/api/v1/endpoint \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

3. **Check for required fields in error response:**
The 422 response includes details about which fields failed validation.

---

### Problem: CORS errors blocking API requests
**Error:** `Access to fetch has been blocked by CORS policy`

### Solution
1. **Verify ALLOWED_ORIGINS in backend .env:**
```bash
cat .env | grep ALLOWED_ORIGINS
# Should include your frontend URL: ["http://YOUR-IP:7880"]
```

2. **Test CORS preflight:**
```bash
curl -v -X OPTIONS http://YOUR-IP:7881/api/v1/auth/login \
  -H "Origin: http://YOUR-IP:7880" \
  -H "Access-Control-Request-Method: POST"
```

3. **Check response headers:**
Should include:
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`

---

## Common Error Codes Reference

| Code | Meaning | Common Causes | Frontend Error Message | Solution |
|------|---------|---------------|----------------------|----------|
| 400 | Bad Request | Malformed JSON, invalid parameters | Server detail or "An unexpected error occurred" | Check request body format |
| 401 | Unauthorized | Missing/expired token | Server detail or "An unexpected error occurred" | Re-login to get new token |
| 403 | Forbidden | CSRF validation failed, insufficient permissions | "Security validation failed. Please refresh the page and try again." | Refresh page to get new CSRF token |
| 404 | Not Found | Resource doesn't exist, wrong URL | Server detail or "An unexpected error occurred" | Verify endpoint path |
| 409 | Conflict | Duplicate entry, constraint violation | Server detail or "This record already exists. Please check for duplicates." | Check for existing records |
| 422 | Validation Error | Schema mismatch, invalid field values | Server detail or "Invalid data submitted. Please check your input and try again." | Check API docs for required fields |
| 429 | Too Many Requests | Rate limit exceeded | "Too many requests. Please wait a moment before trying again." | Wait and retry later |
| 500 | Server Error | Backend exception | "A server error occurred. Please try again or check the server logs." | Check backend logs |
| 502 | Bad Gateway | Backend not running | "An unexpected error occurred" | Restart backend container |
| 503 | Service Unavailable | Database/Redis down, still starting up | "The server is temporarily unavailable. It may still be starting up — please try again shortly." | Check dependency containers |
| 0 | Network Error | Backend unreachable, DNS failure | "Unable to reach the server. Please verify the backend is running and check your network connection." | Check Docker containers and network |
| 403 (GEO_BLOCKED) | Geo-Blocked | Request from blocked country | "Access denied from your location" | Onboarding endpoints bypass geo-blocking; for other endpoints, add IP to allowlist or set GEOIP_ENABLED=false |
| N/A | Email Test Timeout | SMTP server unreachable or firewalled | "Email connection test timed out after 30 seconds." | Check outbound SMTP ports (25, 465, 587) are not blocked |

---

## Development Environment Issues

### Problem: Hot reload not working in development
**Symptom:** Code changes not reflected without manual restart

### Solution
1. **For backend (Uvicorn):**
```bash
# Ensure running with --reload flag
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

2. **For frontend (Vite):**
```bash
# Ensure running in dev mode
cd frontend
npm run dev
```

3. **Docker volume mounting:**
```yaml
# In docker-compose.yml for development
volumes:
  - ./backend:/app
  - ./frontend:/app
```

---

### Problem: TypeScript errors not showing in IDE
**Symptom:** IDE doesn't show type errors that appear during build

### Solution
1. **Ensure TypeScript server is running:**
   - VSCode: Cmd/Ctrl + Shift + P → "TypeScript: Restart TS Server"

2. **Check tsconfig.json paths:**
```bash
cd frontend
cat tsconfig.json | grep -A 10 "paths"
```

3. **Regenerate node_modules:**
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### Problem: Local database different from production schema
**Symptom:** Code works locally but fails in production

### Solution
1. **Sync migrations:**
```bash
# Check current migration state
docker exec intranet-backend alembic current
docker exec intranet-backend alembic history

# Apply all migrations
docker exec intranet-backend alembic upgrade head
```

2. **Compare schemas:**
```bash
# Export local schema
mysqldump -u root -p --no-data the_logbook > local_schema.sql

# Compare with production (if accessible)
diff local_schema.sql production_schema.sql
```

---

### Problem: npm install fails with permission errors
**Error:** `EACCES: permission denied`

### Solution
```bash
# Fix npm cache permissions
sudo chown -R $(whoami) ~/.npm

# Or use npm with sudo (not recommended for development)
sudo npm install

# Better: Use nvm for Node.js management
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
nvm use --lts
```

---

## Performance Issues

### Problem: Slow API responses
**Symptom:** API calls take several seconds to complete

### Solution
1. **Check database query performance:**
```bash
docker exec -it intranet-mysql mysql -u root -p
> USE the_logbook;
> SHOW PROCESSLIST;
> SHOW STATUS LIKE 'Slow_queries';
```

2. **Enable slow query log:**
```sql
> SET GLOBAL slow_query_log = 'ON';
> SET GLOBAL long_query_time = 1;
> SHOW VARIABLES LIKE 'slow_query_log_file';
```

3. **Check Redis performance:**
```bash
docker exec intranet-redis redis-cli -a YOUR_PASSWORD --no-auth-warning info stats
```

4. **Monitor container resources:**
```bash
docker stats intranet-backend intranet-mysql intranet-redis
```

---

### Problem: Frontend loads slowly
**Symptom:** Initial page load takes a long time

### Solution
1. **Check bundle size:**
```bash
cd frontend
npm run build -- --report
# Check dist/report.html for bundle analysis
```

2. **Enable gzip compression in nginx:**
```nginx
# In nginx.conf
gzip on;
gzip_types text/plain application/json application/javascript text/css;
```

3. **Check for unnecessary re-renders:**
   - Use React DevTools Profiler
   - Look for components rendering multiple times

---

## Security & SSL Issues

### Problem: HTTPS not working or certificate errors
**Error:** `ERR_CERT_AUTHORITY_INVALID` or `NET::ERR_CERT_COMMON_NAME_INVALID`

### Root Cause
- Self-signed certificate not trusted by browser
- Certificate doesn't match domain name
- Certificate expired

### Solution

**For development (self-signed):**
```bash
# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /path/to/ssl/private.key \
  -out /path/to/ssl/certificate.crt \
  -subj "/CN=your-domain.local"
```

**For production (Let's Encrypt):**
```bash
# Install certbot
apt-get install certbot

# Generate certificate
certbot certonly --standalone -d your-domain.com

# Certificates are stored in /etc/letsencrypt/live/your-domain.com/
```

**Update nginx configuration:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # ... rest of config
}
```

---

### Problem: Mixed content warnings
**Error:** `Mixed Content: The page was loaded over HTTPS, but requested an insecure resource`

### Root Cause
Frontend loaded via HTTPS but making HTTP API requests.

### Solution
1. **Update frontend .env:**
```bash
VITE_API_URL=https://your-domain.com/api/v1
```

2. **Rebuild frontend:**
```bash
docker-compose build --no-cache frontend
docker-compose up -d
```

3. **Ensure backend CORS allows HTTPS origin:**
```bash
# In .env
ALLOWED_ORIGINS=["https://your-domain.com"]
```

---

### Problem: Security headers missing
**Symptom:** Security scan reports missing headers (CSP, X-Frame-Options, etc.)

### Solution
Add security headers to nginx configuration:

```nginx
# In nginx.conf or site config
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
```

---

## Backup & Recovery

### Creating Database Backups

**Manual backup:**
```bash
# Full database backup
docker exec intranet-mysql mysqldump -u root -p the_logbook > backup_$(date +%Y%m%d_%H%M%S).sql

# Specific tables only
docker exec intranet-mysql mysqldump -u root -p the_logbook users organizations roles > critical_tables_backup.sql

# Compressed backup
docker exec intranet-mysql mysqldump -u root -p the_logbook | gzip > backup_$(date +%Y%m%d).sql.gz
```

**Automated backup script:**
```bash
#!/bin/bash
# Save as /opt/scripts/backup-logbook.sh
BACKUP_DIR="/path/to/backups"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# Create backup
docker exec intranet-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} the_logbook | gzip > "${BACKUP_DIR}/backup_${DATE}.sql.gz"

# Remove old backups
find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "Backup completed: backup_${DATE}.sql.gz"
```

**Schedule with cron:**
```bash
# Run daily at 2 AM
0 2 * * * /opt/scripts/backup-logbook.sh >> /var/log/logbook-backup.log 2>&1
```

---

### Restoring from Backup

**Restore full database:**
```bash
# Stop the application first
docker-compose stop backend

# Restore from SQL file
docker exec -i intranet-mysql mysql -u root -p the_logbook < backup_20260201.sql

# Restore from compressed backup
gunzip < backup_20260201.sql.gz | docker exec -i intranet-mysql mysql -u root -p the_logbook

# Restart application
docker-compose start backend
```

**Restore specific tables:**
```bash
# Extract specific table from backup (if you have a full backup)
grep -A 9999 "CREATE TABLE \`users\`" full_backup.sql | grep -B 9999 -m 1 "^--" > users_only.sql

# Or restore entire backup to a test database first
docker exec -i intranet-mysql mysql -u root -p -e "CREATE DATABASE test_restore"
docker exec -i intranet-mysql mysql -u root -p test_restore < backup.sql
```

---

### Problem: Backup fails with "Access denied"
**Error:** `mysqldump: Got error: 1045: Access denied for user`

### Solution
```bash
# Check MySQL credentials
docker exec intranet-mysql mysql -u root -p -e "SELECT 1"

# Use credentials from .env
source .env
docker exec intranet-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} the_logbook > backup.sql
```

---

## File Upload Issues

### Problem: Logo upload fails
**Error:** `File too large` or `Upload failed`

### Root Cause
- File exceeds size limit
- Nginx request body size limit
- Storage directory permissions

### Solution

1. **Check nginx client_max_body_size:**
```nginx
# In nginx.conf
client_max_body_size 10M;  # Adjust as needed
```

2. **Check backend upload settings:**
```bash
# In backend .env
MAX_UPLOAD_SIZE=10485760  # 10MB in bytes
```

3. **Verify storage directory permissions:**
```bash
docker exec intranet-backend ls -la /app/uploads
# Should be writable by the application user

# Fix permissions if needed
docker exec intranet-backend chmod 755 /app/uploads
```

---

### Problem: Uploaded files not displaying
**Symptom:** Files upload successfully but don't appear in the UI

### Root Cause
- Static file serving not configured
- Volume not mounted correctly
- Wrong URL path

### Solution

1. **Check volume mounting:**
```yaml
# In docker-compose.yml
backend:
  volumes:
    - ./uploads:/app/uploads
```

2. **Verify nginx serves static files:**
```nginx
location /uploads/ {
    alias /app/uploads/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

3. **Check file exists:**
```bash
docker exec intranet-backend ls -la /app/uploads/
```

---

### Problem: "Disk quota exceeded" on file upload
**Error:** `OSError: [Errno 28] No space left on device`

### Solution
```bash
# Check disk space
df -h

# Check Docker disk usage
docker system df

# Clean up Docker resources
docker system prune -a --volumes

# Check specific volume size
du -sh /var/lib/docker/volumes/the-logbook_uploads/
```

---

## Email & Notification Issues

### Problem: Emails not being sent
**Symptom:** Password reset emails, notifications not arriving

### Root Cause
- SMTP not configured
- SMTP credentials incorrect
- Email blocked by spam filter

### Solution

1. **Check SMTP configuration in .env:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@yourdomain.com
SMTP_TLS=true
```

2. **Test SMTP connection:**
```bash
docker exec intranet-backend python -c "
import smtplib
import os

smtp = smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ['SMTP_PORT']))
smtp.starttls()
smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
print('SMTP connection successful!')
smtp.quit()
"
```

3. **For Gmail, use App Passwords:**
   - Go to Google Account → Security → 2-Step Verification
   - Generate an App Password for "Mail"
   - Use this instead of your regular password

---

### Problem: Emails going to spam
**Symptom:** Emails arrive but go to spam folder

### Solution
1. **Set up SPF record** for your domain:
```
v=spf1 include:_spf.google.com ~all
```

2. **Set up DKIM** (varies by email provider)

3. **Set up DMARC record:**
```
v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
```

4. **Use a reputable SMTP service:**
   - SendGrid
   - Mailgun
   - Amazon SES

---

### Problem: Email queue building up
**Symptom:** Emails delayed or not sent, queue growing

### Solution
```bash
# Check Redis queue (if using Redis for job queue)
docker exec intranet-redis redis-cli -a YOUR_PASSWORD --no-auth-warning LLEN email_queue

# Check backend logs for email errors
docker logs intranet-backend 2>&1 | grep -i "email\|smtp\|mail"

# Restart email worker if applicable
docker-compose restart worker
```

---

## Quick Commands Cheatsheet

### Container Management
```bash
# View all containers
docker-compose ps

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart backend

# View logs (follow mode)
docker-compose logs -f

# View logs for specific service
docker-compose logs -f backend --tail 100

# Enter container shell
docker exec -it intranet-backend /bin/bash
docker exec -it intranet-mysql /bin/bash
```

### Database Commands
```bash
# Connect to MySQL
docker exec -it intranet-mysql mysql -u root -p the_logbook

# Run Alembic migrations
docker exec intranet-backend alembic upgrade head

# Check migration status
docker exec intranet-backend alembic current

# View migration history
docker exec intranet-backend alembic history
```

### Health Checks
```bash
# Backend health
curl http://localhost:7881/health

# Frontend health
curl -I http://localhost:7880

# Redis health
docker exec intranet-redis redis-cli -a PASSWORD --no-auth-warning ping

# MySQL health
docker exec intranet-mysql mysqladmin -u root -p ping
```

### Debugging
```bash
# Check container resource usage
docker stats

# View container details
docker inspect intranet-backend

# Check network connectivity
docker network inspect logbook-internal

# Test internal connectivity
docker exec intranet-backend ping -c 3 mysql
docker exec intranet-frontend wget -qO- http://backend:3001/health
```

### Cleanup Commands
```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove unused volumes (CAUTION: may delete data)
docker volume prune

# Full cleanup (CAUTION)
docker system prune -a
```

### Log Analysis
```bash
# Search for errors in backend logs
docker logs intranet-backend 2>&1 | grep -i "error\|exception"

# Search for specific user activity
docker logs intranet-backend 2>&1 | grep "user@example.com"

# Export logs to file
docker logs intranet-backend > backend_logs_$(date +%Y%m%d).txt 2>&1

# Monitor logs in real-time with filtering
docker logs -f intranet-backend 2>&1 | grep --line-buffered "ERROR"
```

---

## Getting Help

If issues persist after trying these solutions:

1. **Capture browser console errors** (F12 → Console tab)
2. **Check container logs:** `docker-compose logs`
3. **Run validation script** (if available): `./unraid/validate-deployment.sh`
4. **Create GitHub issue** with:
   - Error messages
   - Docker logs
   - Browser console output
   - Steps to reproduce

---

## Prospective Members Module Issues

### Problem: Pipeline stages not saving
**Symptom:** Creating or reordering pipeline stages doesn't persist after page refresh.

### Root Cause
The pipeline builder sends updates to the backend API. If the API call fails silently, changes won't persist.

### Solution
1. **Check backend logs for errors:**
```bash
docker logs intranet-backend 2>&1 | grep -i "pipeline\|stage"
```

2. **Verify user permissions:**
```sql
SELECT rp.permission FROM role_permissions rp
  JOIN user_roles ur ON ur.role_id = rp.role_id
  WHERE ur.user_id = 'YOUR_USER_ID' AND rp.permission LIKE 'prospective_members%';
```

User needs `prospective_members.manage` permission to modify pipeline stages.

3. **Check API response:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://YOUR-IP:7881/api/v1/prospective-members/pipelines
```

---

### Problem: Inactivity timeout not deactivating applicants
**Symptom:** Applicants remain active despite exceeding the configured inactivity period.

### Root Cause
- Timeout preset set to "never"
- Per-stage timeout override extending beyond the pipeline default
- `last_activity_at` being updated by background processes

### Solution
1. **Check pipeline inactivity settings:**
   - Navigate to Pipeline Settings page
   - Verify timeout preset is not "never"
   - Check custom timeout value if using "custom" preset

2. **Check per-stage overrides:**
   - Each stage can override the pipeline default
   - Open stage configuration to verify per-stage timeout
   - Background check stages may have intentionally longer timeouts

3. **Verify applicant activity timestamps:**
```bash
# Check backend logs for activity updates
docker logs intranet-backend 2>&1 | grep -i "activity\|inactiv"
```

---

### Problem: Cannot reactivate inactive applicant
**Symptom:** Reactivate button grayed out or returns error.

### Root Cause
- Missing `prospective_members.manage` permission
- Applicant has been permanently purged
- API error during reactivation

### Solution
1. **Check permissions:** User needs `prospective_members.manage` to reactivate.

2. **Check if applicant was purged:** Purged applicants are permanently deleted. The individual must resubmit an interest form to create a new application.

3. **Check backend logs:**
```bash
docker logs intranet-backend 2>&1 | grep -i "reactivat"
```

---

### Problem: Bulk purge deleting wrong applicants
**Symptom:** Purge operation affected applicants that shouldn't have been included.

### Root Cause
Purge operates on all inactive applicants matching the criteria, or the selected set in bulk mode.

### Solution
**Prevention (before purging):**
- Always review the inactive applicants list before purging
- Use the checkbox selection to select specific applicants for purge
- Read the confirmation modal carefully — it shows the count of applicants to be purged
- Purge is **permanent and irreversible**

**Recovery:**
- Purged data cannot be recovered from the application
- If database backups exist, contact your administrator for point-in-time recovery:
```bash
# Restore from backup (see Backup & Recovery section)
docker exec -i intranet-mysql mysql -u root -p the_logbook < backup.sql
```

---

### Problem: Applicant conversion fails
**Symptom:** Converting an applicant to member (administrative or probationary) returns an error.

### Root Cause
- Target membership type not configured
- Backend membership module not available
- Applicant data incomplete for conversion

### Solution
1. **Verify membership module is enabled:**
   - Check that the membership module was selected during onboarding
   - API endpoint requires membership module to be active

2. **Check required applicant data:**
   - First name, last name, and email are required for conversion
   - The conversion modal shows which membership type to assign

3. **Check backend logs:**
```bash
docker logs intranet-backend 2>&1 | grep -i "convert\|conversion"
```

---

### Problem: Pipeline statistics show unexpected values
**Symptom:** Stats bar shows counts that don't match visible applicants.

### Root Cause
Statistics are calculated based on specific inclusion rules.

### Solution
**Understand what's included:**
- **Total Active**: Only applicants with `status = 'active'`
- **Converted**: Applicants successfully converted to members
- **Avg Days to Convert**: Average across all converted applicants (excludes active/inactive)
- **Conversion Rate**: Converted / (Total - Active - On Hold) — excludes applicants still in progress
- **Approaching Timeout**: Active applicants in warning or critical inactivity state
- **Inactive**: Applicants deactivated due to inactivity timeout

The stats annotation at the bottom of the stats bar explains: "Statistics include active applicants only. Inactive, rejected, and withdrawn applicants are excluded from conversion rate and averages."

---

## TypeScript Build Issues

### Problem: `rank` property not found on User type
**Symptom:** Docker build fails with `Property 'rank' does not exist on type 'User'` in `CreateTrainingSessionPage.tsx`

### Root Cause
The `User` interface in `types/user.ts` was missing the `rank` field even though the backend model and API schemas include it.

### Solution
Ensure `rank?: string` is defined in the `User` interface in `frontend/src/types/user.ts`. Pull latest changes and rebuild:
```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: `BookOpen` not found in MinutesPage
**Symptom:** Docker build fails with `Cannot find name 'BookOpen'` in `MinutesPage.tsx`

### Root Cause
The `BookOpen` icon was used in the template but not imported from `lucide-react`.

### Solution
Ensure `BookOpen` is included in the lucide-react import at the top of `MinutesPage.tsx`. Pull latest changes and rebuild.

---

### Problem: My Training "Requirements" box shows N/A
**Symptom:** The Requirements stat card on the My Training page shows "N/A" even though training requirements have been created.

### Root Cause
The backend query for the My Training summary was filtering requirements to `frequency = 'annual'` only. Requirements with other frequencies (biannual, quarterly, monthly, one_time) were excluded from the compliance calculation, resulting in zero applicable requirements and an N/A display.

### Solution
Pull latest changes which fix the query to include all active requirements regardless of frequency:
```bash
git pull origin main
docker compose build --no-cache backend
docker compose up -d
```

---

### Problem: Rank, station, or membership number can be changed by any member
**Symptom:** Members can change their own rank, station, or membership number through profile editing

### Root Cause
The profile update endpoint did not restrict these fields — any authenticated user could modify them via self-profile update.

### Solution
Pull latest changes. Rank, station, and membership number updates are now restricted to users with `members.manage` permission (leadership, secretary, membership coordinator). Unauthorized attempts return a 403 error, and the corresponding fields are disabled in the UI for regular members.

---

## Inventory Module Issues

### Problem: "Duplicate entry" error when creating an item with barcode or asset tag
**Error:** `IntegrityError: Duplicate entry for key 'uq_item_org_barcode'`

### Root Cause
Another item in the same organization already has that barcode or asset tag. Barcodes and asset tags must be unique within each organization (but different organizations can reuse the same codes).

### Solution
1. Search for the existing item with the same barcode/asset tag.
2. Either change the new item's code or update the existing item.
3. If this error appears after upgrading, run the migration:
```bash
docker exec intranet-backend alembic upgrade head
```

---

### Problem: Inventory checkout/return race condition
**Symptom:** Two users simultaneously checking out or returning the same item causes inconsistent state (e.g., item shows "available" but still has an active checkout).

### Root Cause
Prior to the latest update, inventory operations did not use row-level locking, allowing concurrent modifications to create inconsistent state.

### Solution
This has been fixed in the codebase. All inventory mutation operations (`update_item`, `unassign_item`, `return_to_pool`, `checkin_item`) now use `SELECT FOR UPDATE` row-level locking. Pull the latest changes:

```bash
git pull origin main
docker compose restart backend
```

---

### Problem: Batch return fails with "Item is not assigned to the expected user"
**Symptom:** A batch return operation reports this error for one or more items.

### Root Cause
Between the time the batch return was initiated and when it was processed, the item was concurrently reassigned to a different user. The system now validates the expected assignee to prevent accidental unassignment.

### Solution
Refresh the page and retry. If the item is now assigned to a different user, that user should return it. This error is a safety feature preventing stale-read races.

---

### Problem: Overdue checkouts not showing up
**Symptom:** Items past their expected return date don't appear in the overdue list.

### Root Cause
The overdue checkout query now computes overdue status at read time using `expected_return_at < now`. It no longer performs a bulk UPDATE on each call.

### Solution
Items with `expected_return_at` in the past and `is_returned = false` will appear in the overdue list automatically. If you need to bulk-update the `is_overdue` flag (for external reporting or scheduled tasks), use the `mark_overdue_checkouts` method via a scheduled task.

---

### Problem: Departure clearance line item returns error "not found"
**Symptom:** Resolving a line item in a departure clearance fails with a "not found" error.

### Root Cause
The `clearance_id` validation ensures line items can only be resolved within the correct clearance. If the line item belongs to a different clearance, it will not be found.

### Solution
Verify you are resolving items within the correct clearance record. Navigate to the departure clearance detail page and resolve items from there.

---

## Events Module Issues

### Problem: Past events still showing on the main events page
**Symptom:** Events that have already occurred are cluttering the events page.

### Root Cause
This was the old default behavior. Past events are now hidden from the main events view.

### Solution
Pull the latest changes. Past events are now hidden by default. Officers and managers see a **Past Events** tab for browsing historical events.

```bash
git pull origin main
docker compose build --no-cache frontend
docker compose up -d
```

---

### Problem: Event reminders not being sent
**Symptom:** Members don't receive reminders before events even though reminders are configured.

### Root Cause
- The event must have a `reminder_schedule` configured (array of minutes-before values).
- The notification scheduled task must be running.
- Members must have RSVP'd "Going" or "Maybe".

### Solution
1. Edit the event and verify reminder times are set.
2. Check that the notification scheduled task is enabled in **Administration > Scheduled Tasks**.
3. Verify the member has RSVP'd to the event.

---

## Notification Issues

### Problem: Notifications not appearing in the inbox
**Symptom:** Expected notifications are not visible in the user's notification center.

### Root Cause
- Notifications may have expired (past their `expires_at` date).
- The notification may have been cancelled by a netting event (e.g., an assign followed by unassign cancels the original notification).

### Solution
1. Check the notification logs via the admin panel.
2. Expired notifications are automatically hidden. This is by design.
3. Notification netting is intentional — offsetting actions cancel pending notifications to prevent duplicate alerts.

---

## Admin Hours Module Issues

### Problem: QR code clock-in shows "Category not found"
**Fix:** The QR code URL references a deleted or wrong-org category. Regenerate from **Administration > Admin Hours > QR Codes** and reprint.

### Problem: Clock-out button not appearing
**Fix:** Verify an active session exists on your **My Hours** page. Sessions older than 24 hours may be auto-closed; submit a manual entry instead.

### Problem: Hours stuck in "pending" with no reviewer
**Fix:** Ensure at least one role has `admin_hours.manage` permission. Check the category's auto-approve threshold.

### Problem: Manual entry rejected with "Overlapping session"
**Fix:** The time range overlaps with an existing entry on that date. Adjust times to avoid overlap.

---

## Scheduling Shift Pattern Issues

### Problem: Weekly pattern generates shifts on wrong days
**Status (Fixed 2026-02-27):** JS weekday convention (0=Sunday) vs Python convention (0=Monday) mismatch. Backend now converts correctly.

### Problem: Multiple shifts per day blocked
**Status (Fixed 2026-02-27):** Duplicate guard now checks date + start_time, allowing multiple shift types on the same day.

### Problem: Dashboard "Upcoming Shifts" is empty
**Status (Fixed 2026-02-27):** Dashboard now uses `getShifts()` to show all org shifts instead of only user-assigned ones.

### Problem: Shift times show "Invalid Date"
**Status (Fixed 2026-02-27):** `formatTime()` now handles bare time strings from backend.

---

## Elections Module Issues (2026-02-27)

### Problem: Election detail page hangs on loading
**Status (Fixed):** Route param mismatch caused `fetchElection()` to never fire. Pull latest.

### Problem: Cannot open ballot-item-only elections
**Status (Fixed):** `open_election` now supports elections with only ballot items (no candidates required).

### Problem: Closing election shows "Election not found"
**Status (Fixed):** Returns descriptive errors for wrong-status elections.

---

## Backend Logging & Observability

### Request Correlation IDs (2026-02-27)
All log entries include a UUID4 correlation ID for tracing requests:
```bash
docker-compose logs backend | grep "req_id=<UUID>"
```

### Sentry Not Receiving Errors
Verify `SENTRY_ENABLED=true` and `SENTRY_DSN` is set. Test:
```bash
docker-compose exec backend python -c "import sentry_sdk; print(sentry_sdk.is_initialized())"
```

---

## Organization Settings Issues

### Problem: Cannot edit email/storage/auth settings after onboarding
**Status (Fixed 2026-02-27):** These are now in **Administration > Organization Settings** under Email, Storage, and Authentication tabs.

### Problem: SMTP changes not taking effect
**Fix:** Restart backend after saving: `docker-compose restart backend`.

---

**Most Common Fix:** 90% of issues are resolved by:
1. Updating `frontend/.env` with correct `VITE_API_URL`
2. Running `docker-compose build --no-cache frontend`
3. Running `docker-compose up -d`
