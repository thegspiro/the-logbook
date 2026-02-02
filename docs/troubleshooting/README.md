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

### Issue: MariaDB image missing
**Error:** `No such image: mariadb:10.11`

**Fix:**
```bash
docker pull mariadb:10.11
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
- Auto-redirect to onboarding after 10 seconds

### API
- `http://YOUR-IP:7881/docs` → FastAPI documentation
- `http://YOUR-IP:7881/health` → Health status JSON

---

## Quick Diagnostic Checklist

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

**Most Common Fix:** 90% of issues are resolved by:
1. Updating `frontend/.env` with correct `VITE_API_URL`
2. Running `docker-compose build --no-cache frontend`
3. Running `docker-compose up -d`
