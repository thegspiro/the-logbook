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
13. [API Debugging Guide](#api-debugging-guide)
14. [Common Error Codes Reference](#common-error-codes-reference)
15. [Development Environment Issues](#development-environment-issues)
16. [Performance Issues](#performance-issues)
17. [Security & SSL Issues](#security--ssl-issues)
18. [Backup & Recovery](#backup--recovery)
19. [File Upload Issues](#file-upload-issues)
20. [Email & Notification Issues](#email--notification-issues)
21. [Quick Commands Cheatsheet](#quick-commands-cheatsheet)

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

| Code | Meaning | Common Causes | Solution |
|------|---------|---------------|----------|
| 400 | Bad Request | Malformed JSON, invalid parameters | Check request body format |
| 401 | Unauthorized | Missing/expired token | Re-login to get new token |
| 403 | Forbidden | Valid token but insufficient permissions | Check user roles |
| 404 | Not Found | Resource doesn't exist, wrong URL | Verify endpoint path |
| 409 | Conflict | Duplicate entry, constraint violation | Check for existing records |
| 422 | Validation Error | Schema mismatch, invalid field values | Check API docs for required fields |
| 429 | Too Many Requests | Rate limit exceeded | Wait and retry later |
| 500 | Server Error | Backend exception | Check backend logs |
| 502 | Bad Gateway | Backend not running | Restart backend container |
| 503 | Service Unavailable | Database/Redis down | Check dependency containers |

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

**Most Common Fix:** 90% of issues are resolved by:
1. Updating `frontend/.env` with correct `VITE_API_URL`
2. Running `docker-compose build --no-cache frontend`
3. Running `docker-compose up -d`
