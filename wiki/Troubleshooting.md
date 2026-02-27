# Troubleshooting Guide

This guide covers common issues and their solutions for The Logbook deployment.

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Onboarding Failures](#onboarding-failures)
3. [Redis Container Unhealthy](#redis-container-unhealthy)
4. [Frontend Not Rendering](#frontend-not-rendering)
5. [Malformed API URLs](#malformed-api-urls)
6. [Build Errors](#build-errors)
7. [Docker Issues](#docker-issues)
8. [Docker Compose Profile Issues](#docker-compose-profile-issues)
9. [Network & Connectivity](#network--connectivity)
10. [Security Issues](#security-issues)
11. [Accessibility Issues](#accessibility-issues)
12. [Events Module Issues](#events-module-issues)
13. [Scheduling Module Issues](#scheduling-module-issues)
14. [TypeScript Quality Issues](#typescript-quality-issues)
15. [Frontend Dependency Issues](#frontend-dependency-issues)
16. [Inventory Module Issues](#inventory-module-issues)
17. [Notification Issues](#notification-issues)
18. [Training & Compliance Issues](#training--compliance-issues)
19. [Migration Issues on Unraid](#migration-issues-on-unraid)
20. [Membership Admin Issues](#membership-admin-issues)
21. [Public Outreach Request Pipeline Issues](#public-outreach-request-pipeline-issues)
22. [Admin Hours Module Issues](#admin-hours-module-issues)
23. [Elections Detail & Voting Issues](#elections-detail--voting-issues)
24. [Shift Pattern & Calendar Issues](#shift-pattern--calendar-issues)
25. [Organization Settings Issues](#organization-settings-issues)

---

## Installation Issues

### Problem: Universal installer fails to detect OS

**Error:** `Could not detect operating system`

### Root Cause
The installer couldn't identify your Linux distribution from `/etc/os-release`.

### Solution

**1. Check your OS release file:**
```bash
cat /etc/os-release
```

**2. Run with explicit flags:**
```bash
# For Debian/Ubuntu-based
curl -sSL .../universal-install.sh | bash -s -- --profile standard

# For Raspberry Pi
curl -sSL .../universal-install.sh | bash -s -- --profile minimal --arm
```

---

### Problem: Installation fails on ARM device (Raspberry Pi)

**Error:** `Image not found for platform linux/arm64`

### Root Cause
Default Docker images may not support ARM architecture.

### Solution

**1. Use the ARM-specific compose file:**
```bash
docker compose -f docker-compose.yml -f docker-compose.arm.yml up -d
```

**2. For Raspberry Pi with low memory (1-2GB), use minimal profile:**
```bash
docker compose -f docker-compose.yml -f docker-compose.minimal.yml -f docker-compose.arm.yml up -d
```

**3. Or use the universal installer with flags:**
```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile minimal --arm
```

---

### Problem: Out of memory during installation

**Error:** `Cannot allocate memory` or containers crash/restart repeatedly

### Root Cause
System doesn't have enough RAM for the default configuration.

### Solution

**1. Use minimal profile for low-memory systems (1-2GB RAM):**
```bash
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d
```

**2. Profile recommendations:**

| RAM | Profile | Command |
|-----|---------|---------|
| 1-2GB | minimal | `--profile minimal` |
| 4GB | standard | (default) |
| 8GB+ | full | `--profile full` |

**3. Reduce memory further if needed:**
```yaml
# In docker-compose.override.yml
services:
  mysql:
    deploy:
      resources:
        limits:
          memory: 128M
  backend:
    command: uvicorn main:app --host 0.0.0.0 --port 3001 --workers 1
```

---

### Problem: Docker not installed

**Error:** `docker: command not found`

### Solution

**1. Use the universal installer (auto-installs Docker):**
```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

**2. Or install Docker manually:**

```bash
# Debian/Ubuntu
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

# macOS
brew install --cask docker

# Then start Docker Desktop
```

---

### Problem: Permission denied running Docker commands

**Error:** `permission denied while trying to connect to the Docker daemon`

### Solution

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply changes (logout/login or run):
newgrp docker

# Verify
docker ps
```

---

### Problem: Database migrations fail with version error

**Error:** `Can't locate revision identified by '0001'` or `alembic.util.exc.CommandError`

### Root Cause
Alembic version tracking mismatch. The database has an old or invalid version ID in the `alembic_version` table.

### Solution

**1. Check current Alembic version:**
```bash
docker compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD intranet_db -e "SELECT * FROM alembic_version;"
```

**2. Update to correct version if needed:**
```bash
# The correct first migration ID is '20260118_0001'
docker compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD intranet_db -e "UPDATE alembic_version SET version_num='20260118_0001';"
```

**3. Restart backend to run migrations:**
```bash
docker compose restart backend
```

---

### Problem: Migration fails with "Multiple heads detected"

**Error:** `alembic.util.exc.CommandError: Multiple heads detected` or migration chain breaks

### Root Cause
Multiple migrations have the same revision ID or point to the same down_revision, creating a branch in the migration tree.

### Solution

**1. Check migration chain:**
```bash
docker compose exec backend alembic heads
docker compose exec backend alembic history --verbose
```

**2. If multiple heads exist, identify the conflict:**
```bash
# Look for duplicate revision IDs
grep -h "^revision = " backend/alembic/versions/*.py | sort | uniq -d
```

**3. Fix by editing the migration files:**
- Each migration must have a unique `revision` ID
- The `down_revision` should form a single chain (no branches)
- Rename conflicting files and update their revision IDs

---

### Problem: Backend can't connect to database

**Error:** `Can't connect to MySQL server on 'db'` or `Name or service not known`

### Root Cause
The `DB_HOST` in your `.env` file doesn't match the Docker service name. The MySQL service is named `mysql` in docker-compose.yml, not `db`.

### Solution

**1. Check your .env file:**
```bash
grep DB_HOST .env
```

**2. Correct value should be:**
```env
DB_HOST=mysql
```

**3. If using an old .env.example:**
```bash
# Update your .env
sed -i 's/DB_HOST=db/DB_HOST=mysql/' .env

# Restart backend
docker compose restart backend
```

---

### Problem: Backend crashes with "Database not initialized"

**Error:** `RuntimeError: Database not initialized. Call database_manager.connect() first.`

### Root Cause
The backend tried to use the database before it was connected, typically during startup checks or middleware initialization.

### Solution

**1. Ensure MySQL is healthy before backend starts:**
```bash
docker compose ps
# MySQL should show "healthy" status
```

**2. Check MySQL logs for errors:**
```bash
docker compose logs mysql
```

**3. Restart services in correct order:**
```bash
docker compose down
docker compose up -d mysql
# Wait for MySQL to be healthy
docker compose up -d backend frontend
```

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

**1. Create/Update frontend/.env**

```bash
cd frontend
cat > .env << 'EOF'
# API Configuration
VITE_API_URL=http://YOUR-IP:7881

# WebSocket Configuration
VITE_WS_URL=ws://YOUR-IP:7881

# Environment
VITE_ENV=production

# Security - Change in production!
VITE_SESSION_KEY=change-this-to-a-random-32-character-string

# Feature Flags
VITE_ENABLE_PWA=true
VITE_ENABLE_ANALYTICS=false
EOF
```

**Important:** Replace `YOUR-IP` with your actual server IP address.

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

## Build Errors

### Problem: TypeScript errors during Docker build

**Common errors:**
- `Property 'X' does not exist on type 'Y'`
- `Cannot find name 'X'`
- `'X' is declared but its value is never read`

### Root Cause
TypeScript strict mode catches type mismatches, missing imports, or unused variables at build time.

### Solution

**1. Check for recent fixes:**
```bash
git pull origin main
docker compose build --no-cache frontend
```

**2. Common TypeScript fixes:**

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| Property doesn't exist | Wrong property name | Check interface definition |
| Cannot find name | Missing import | Add import statement |
| Declared but never read | Unused variable | Remove or use the variable |
| Implicitly has 'any' type | Missing type annotation | Add explicit type |

**3. Check the type definition:**
```bash
# Find where a type is defined
grep -r "interface YourType" frontend/src/
```

---

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

---

## Security Issues

### Problem: Backend fails to start with "SECURITY FAILURE" error
**Error:** `SECURITY FAILURE: Cannot start with insecure default configuration`

### Root Cause
The backend validates security configuration on startup in production mode. If critical security variables are missing or use default values, the application will refuse to start.

### Solution

**1. Generate required secrets:**

```bash
# Generate all secrets at once
echo "SECRET_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "ENCRYPTION_SALT=$(openssl rand -hex 16)"
echo "DB_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
echo "REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
```

**2. Add to your `.env` file:**

```bash
SECRET_KEY=your_generated_64_char_hex_string
ENCRYPTION_KEY=your_generated_64_char_hex_string
ENCRYPTION_SALT=your_generated_32_char_hex_string
DB_PASSWORD=your_generated_secure_password
REDIS_PASSWORD=your_generated_secure_password
```

**3. Restart backend:**

```bash
docker-compose restart backend
```

---

### Problem: Security alerts being generated frequently

### Common Causes

1. **Brute force detection triggered**: Multiple failed login attempts
2. **Rate limiting exceeded**: Too many API requests
3. **Session anomalies**: IP changes during session

### Solution

**Check security status:**
```bash
curl http://YOUR-IP:7881/api/v1/security/status
```

**View recent alerts:**
```bash
curl http://YOUR-IP:7881/api/v1/security/alerts
```

**Acknowledge false positives:**
```bash
curl -X POST http://YOUR-IP:7881/api/v1/security/alerts/{alert_id}/acknowledge
```

---

### Problem: Audit log integrity check fails

**Error:** `AUDIT LOG INTEGRITY FAILURE: X issues detected`

### Root Cause
The audit log hash chain has been broken, indicating potential tampering or data corruption.

### Solution

**1. Check the integrity report:**
```bash
curl http://YOUR-IP:7881/api/v1/security/audit-log/integrity
```

**2. Review the errors:**
The response will show which log entries have issues:
- "Hash mismatch" = Entry data was modified
- "Chain broken" = Entry was deleted or reordered

**3. Investigation steps:**
- Check database backup for original data
- Review server access logs for unauthorized access
- Check for disk corruption issues
- Contact security team if tampering suspected

**4. For data corruption (not tampering):**
```bash
# Restore from backup if available
# DO NOT modify audit logs manually - this will compound the issue
```

---

### Problem: Session hijacking alerts

**Alert:** `Potential session hijacking: IP changed from X to Y`

### Root Cause
A user's IP address changed during an active session, which may indicate:
- Session token theft
- User switching networks (legitimate)
- VPN connection changes

### Solution

**1. Review the alert details:**
```bash
curl http://YOUR-IP:7881/api/v1/security/alerts?alert_type=session_hijack
```

**2. If legitimate (user switched networks):**
```bash
# Acknowledge the alert
curl -X POST http://YOUR-IP:7881/api/v1/security/alerts/{id}/resolve
```

**3. If suspicious:**
- Force logout the affected session
- Reset user password
- Review audit logs for suspicious activity
- Notify the user

---

### Problem: Data exfiltration alerts

**Alert:** `Large data export: X MB` or `Data transfer to external destination`

### Root Cause
A user is exporting large amounts of data or sending data to external endpoints.

### Solution

**1. Review the alert:**
```bash
curl http://YOUR-IP:7881/api/v1/security/data-exfiltration/status
```

**2. Check the user's activity:**
- Which user triggered the alert?
- What data was being accessed?
- Is this a legitimate business need?

**3. If legitimate:**
- Document the business justification
- Acknowledge the alert

**4. If suspicious:**
- Disable the user account
- Review all recent activity
- Check for data on external endpoints
- Initiate incident response

---

### Security Configuration Checklist

- [ ] `SECRET_KEY` is set (min 32 characters, not default)
- [ ] `ENCRYPTION_KEY` is set (64 hex characters, not default)
- [ ] `ENCRYPTION_SALT` is set (32 hex characters, unique per installation)
- [ ] `DB_PASSWORD` is not `change_me_in_production`
- [ ] `REDIS_PASSWORD` is set (required in production)
- [ ] HTTPS enabled for production
- [ ] CORS configured properly
- [ ] Rate limiting enabled
- [ ] Audit logging verified working

---

### Security Monitoring Commands

```bash
# Check overall security status
curl http://YOUR-IP:7881/api/v1/security/status

# View recent security alerts
curl http://YOUR-IP:7881/api/v1/security/alerts

# Verify audit log integrity
curl http://YOUR-IP:7881/api/v1/security/audit-log/integrity

# Check intrusion detection status
curl http://YOUR-IP:7881/api/v1/security/intrusion-detection/status

# Check data exfiltration monitoring
curl http://YOUR-IP:7881/api/v1/security/data-exfiltration/status

# Trigger manual security check
curl -X POST http://YOUR-IP:7881/api/v1/security/manual-check
```

---

## Accessibility Issues

### Problem: Screen reader not announcing navigation items correctly

### Root Cause
Missing ARIA labels or incorrect semantic structure.

### Solution

The application uses proper ARIA attributes throughout. If issues persist:

**1. Ensure browser and screen reader are up to date:**
- NVDA 2023+ recommended
- JAWS 2023+ recommended
- VoiceOver (latest macOS/iOS)

**2. Verify navigation landmarks are detected:**
- Press `D` in NVDA to cycle through landmarks
- Use VoiceOver rotor (VO+U) to view landmarks

**3. Check that JavaScript is enabled:**
ARIA attributes are applied dynamically and require JavaScript.

---

### Problem: Cannot navigate using keyboard only

### Root Cause
Missing focus management or skip links not working.

### Solution

**1. Use skip links:**
- Press Tab immediately after page load
- "Skip to main content" and "Skip to navigation" links should appear
- Press Enter to activate

**2. Keyboard navigation shortcuts:**
- `Tab`: Move forward through interactive elements
- `Shift+Tab`: Move backward
- `Enter/Space`: Activate buttons and links
- `Escape`: Close modals and dropdowns
- `Arrow keys`: Navigate within menus

**3. If focus is lost after actions:**
Clear browser cache and reload. Focus management should return to appropriate elements after modal closes or form submissions.

---

### Problem: Color contrast issues or hard to read text

### Root Cause
System or browser settings may override application styles.

### Solution

**1. The application meets WCAG 2.1 AA contrast requirements:**
- Body text: minimum 4.5:1 contrast ratio
- Large text (18pt+): minimum 3:1 contrast ratio
- Interactive elements: visible focus indicators

**2. Enable high contrast mode:**
- Windows: Settings → Accessibility → High contrast themes
- macOS: System Preferences → Accessibility → Display → Increase contrast
- The application respects system high contrast preferences

**3. Use browser zoom:**
- The application supports zoom up to 200% without horizontal scrolling
- Press `Ctrl/Cmd + +` to zoom in

---

### Problem: Form errors not announced by screen reader

### Root Cause
Form validation messages need proper ARIA attributes.

### Solution

Form inputs include:
- `aria-invalid="true"` when validation fails
- `aria-describedby` pointing to error message element
- Error messages have `role="alert"` for immediate announcement

**If not working:**
1. Check that JavaScript is enabled
2. Try a different screen reader
3. Ensure browser accessibility settings aren't blocking announcements

---

### Problem: Modal dialogs not trapping focus

### Root Cause
Keyboard focus escaping modal to background elements.

### Solution

**1. Modals should trap focus:**
- Tab should cycle only through modal elements
- Escape should close the modal
- Focus should return to trigger element after close

**2. If focus escapes:**
Clear browser cache and reload. This typically indicates JavaScript hasn't fully loaded.

---

### Accessibility Testing Checklist

Use this checklist to verify accessibility:

- [ ] All pages have proper heading hierarchy (h1, h2, h3...)
- [ ] All images have alt text
- [ ] All form inputs have visible labels
- [ ] Color is not the only way to convey information
- [ ] All interactive elements are keyboard accessible
- [ ] Focus indicator is visible on all interactive elements
- [ ] Skip links work on each page
- [ ] Screen reader announces page content correctly
- [ ] Zoom to 200% works without horizontal scroll
- [ ] No content flashes more than 3 times per second

---

### Accessibility Testing Tools

**Browser Extensions:**
- axe DevTools (Chrome/Firefox)
- WAVE Evaluation Tool
- Lighthouse (Chrome DevTools)

**Screen Readers:**
- NVDA (Windows, free)
- JAWS (Windows, commercial)
- VoiceOver (macOS/iOS, built-in)
- TalkBack (Android, built-in)

**Manual Testing:**
```bash
# Run Lighthouse accessibility audit from command line
npx lighthouse http://localhost:3000 --only-categories=accessibility
```

---

## Events Module Issues

### Problem: Event creation fails with booking conflict

**Error:** `Location is already booked for this time slot`

### Root Cause
The booking prevention system detects overlapping events at the same location.

### Solution
1. Choose a different location or adjust the event time
2. Admins can use RSVP override to bypass booking restrictions if needed
3. Check the calendar view to see what's already booked

---

### Problem: Event attachments won't upload

**Error:** Upload returns 400 or 500 error

### Root Cause
File may exceed size limits or the event ID may be invalid.

### Solution
1. Check file size against server limits
2. Verify the event exists and you have `events.manage` permission
3. Check backend logs for specific error details:
```bash
docker logs the-logbook-backend-1 | grep "attachment"
```

---

### Problem: Recurring events not showing in calendar

### Root Cause
Recurrence patterns may be misconfigured or end dates may be in the past.

### Solution
1. Verify recurrence settings: frequency, interval, end date
2. Check that the recurrence end date is in the future
3. Refresh the calendar view (recurrence expansion happens on-demand)

---

## Scheduling Module Issues

### Problem: Shift signup returns 404

**Error:** `POST /api/v1/scheduling/shifts/{id}/signup` returns 404

### Root Cause
The shift ID is invalid, the shift doesn't exist, or the scheduling endpoints aren't registered.

### Solution

**1. Verify the shift exists:**
```bash
curl http://YOUR-IP:7881/api/v1/scheduling/shifts
```

**2. Ensure the backend is up to date with the latest scheduling endpoints:**
```bash
docker compose restart backend
docker compose logs backend | grep "scheduling"
```

**3. Check the shift hasn't already passed** — only upcoming shifts allow signup.

---

### Problem: "Position already filled" when signing up for a shift

**Error:** `400 Bad Request` with message about position availability

### Root Cause
Another member has already signed up for the same position on that shift, or you're already assigned to this shift.

### Solution

1. Choose a different position from the position selector dropdown
2. Check the shift detail panel to see which positions are still open
3. If you need to change positions, withdraw first then sign up again

---

### Problem: Apparatus not showing in shift creation dropdown

### Root Cause
No basic apparatus have been created, or the Apparatus Basic page hasn't been set up.

### Solution

**1. If your department has the Apparatus module enabled:**
Apparatus are managed through the full Apparatus module at `/apparatus`.

**2. If the Apparatus module is disabled (lightweight mode):**
Navigate to `/apparatus-basic` and create your vehicles:
- Add unit numbers, names, and types (engine, ladder, rescue, ambulance, etc.)
- Define crew positions for each vehicle
- These will appear in the shift creation dropdown

**3. Verify basic apparatus exist via API:**
```bash
curl http://YOUR-IP:7881/api/v1/scheduling/apparatus
```

---

### Problem: Shift templates or patterns not generating shifts

**Error:** "Generate Shifts" button produces 0 shifts or returns an error

### Root Cause
The date range may be invalid, the pattern configuration may be incomplete, or the template referenced by the pattern doesn't exist.

### Solution

**1. Verify the pattern has a valid template linked:**
- Go to Scheduling > Templates tab
- Ensure at least one template exists
- Check the pattern references a valid template ID

**2. Ensure the date range is valid:**
- Start date must be before end date
- Dates should be in the future
- Range shouldn't exceed reasonable limits (e.g., 365 days)

**3. For platoon patterns, verify rotation settings:**
- `days_on` and `days_off` must both be set
- `rotation_days` should equal `days_on + days_off`

---

### Problem: Swap or time-off request stuck in "pending"

### Root Cause
No admin has reviewed the request. Swap and time-off requests require approval from a user with `scheduling.manage` permission.

### Solution

**1. Check who has scheduling management permissions:**
- Navigate to Settings > Roles
- Verify the `scheduling.manage` permission is assigned to appropriate roles

**2. Admins can review requests from:**
- The Scheduling page > Requests tab
- Filter by "Pending" status
- Click the review button to approve or deny

**3. Users can cancel their own pending requests** by clicking the cancel button.

---

### Problem: Basic Apparatus page shows "No apparatus yet" but data exists

### Root Cause
You may be on the wrong page. The Basic Apparatus page (`/apparatus-basic`) is only for departments without the full Apparatus module. If Apparatus is enabled, use `/apparatus` instead.

### Solution

**1. Check which page you should be using:**
- If the Apparatus module is **enabled** in Settings > Modules: use `/apparatus`
- If the Apparatus module is **disabled**: use `/apparatus-basic`

**2. The side navigation automatically shows the correct link:**
- "Apparatus" links to the full module when enabled
- "Apparatus" links to the lightweight page when disabled

---

### Problem: Database migration fails for basic_apparatus table

**Error:** `Table 'basic_apparatus' already exists` or migration version mismatch

### Root Cause
The migration `20260218_0200` may have partially run, or there's a version conflict.

### Solution

**1. Check current migration version:**
```bash
docker compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD intranet_db -e "SELECT * FROM alembic_version;"
```

**2. If the table already exists but migration wasn't tracked:**
```bash
docker compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD intranet_db -e "UPDATE alembic_version SET version_num='20260218_0200';"
docker compose restart backend
```

**3. If the table doesn't exist, run migration manually:**
```bash
docker compose exec backend alembic upgrade head
```

---

## TypeScript Quality Issues

### Problem: TypeScript build fails after git pull (Fixed 2026-02-14)

**Status:** All TypeScript build errors have been resolved as of commit `e97be90`.

If you encounter build errors after pulling:
```bash
git pull origin main
cd frontend
rm -rf node_modules
npm install
npm run typecheck
```

### Problem: `as any` type assertions in codebase

**Status:** All 17 `as any` assertions have been removed as of commit `ef938f7`.

If you find new `as any` assertions, replace them with proper types. See `docs/TYPESCRIPT_SAFEGUARDS.md` for patterns and examples.

### Problem: Broken JSX after merge conflict (Fixed 2026-02-14)

**Status:** Fixed in commit `1ac8d46`.

**Symptoms:** `DocumentsPage` or `MinutesPage` render blank or show React errors.

**Root Cause:** Git merge duplicated JSX blocks within components.

**Solution:** Pull latest changes. If the issue recurs after a merge, check for duplicate return statements or JSX blocks in the affected component.

---

## Inventory Module Issues

### Problem: "Duplicate entry" error when creating an item with barcode or asset tag
**Error:** `IntegrityError: Duplicate entry for key 'uq_item_org_barcode'`

**Root Cause:** Another item in the same organization already has that barcode or asset tag. Barcodes and asset tags must be unique within each organization.

**Solution:** Search for the existing item with the same code. Either change the new item's code or update the existing one. Run `alembic upgrade head` after upgrading.

---

### Problem: Batch return fails with "Item is not assigned to the expected user"

**Root Cause:** The item was concurrently reassigned to a different user between the time the batch was initiated and processed.

**Solution:** Refresh the page and retry. This validation prevents accidental unassignment of items that were reassigned during the operation.

---

### Problem: Departure clearance line item returns "not found"

**Root Cause:** The `clearance_id` validation ensures line items can only be resolved within the correct clearance. The line item may belong to a different clearance.

**Solution:** Verify you are resolving items within the correct clearance record by navigating to the departure clearance detail page.

---

### Problem: Overdue checkouts not showing up

**Root Cause:** Overdue status is now computed at read time. Items with `expected_return_at` in the past and `is_returned = false` appear automatically.

**Solution:** No action needed — the query is now read-only and always reflects current state. For scheduled reporting, use the `mark_overdue_checkouts` scheduled task.

---

## Notification Issues

### Problem: Notifications not appearing in the inbox

**Root Cause:** Notifications may have expired (past `expires_at`) or been cancelled by notification netting (offsetting actions like assign→unassign cancel each other).

**Solution:** Expired notifications are hidden by design. Notification netting prevents duplicate alerts. Check notification logs via the admin panel for details.

---

## Training & Compliance Issues

### Problem: LOA created but training requirements not adjusted

**Root Cause:** The leave has `exempt_from_training_waiver` set to true, or the auto-linked training waiver was not created.

**Solution:**
1. Check the leave record — if `exempt_from_training_waiver` is true, update the leave or create a standalone training waiver from **Members > Admin > Waivers**
2. A month is only waived if the leave covers ≥15 days of that month
3. Only hours, shifts, and calls requirements are adjusted — certifications and courses are not

### Problem: Compliance card shows wrong color

**Root Cause:** The compliance summary uses this logic:
- **Red**: Expired certs OR <50% requirements met
- **Yellow**: Expiring certs (within 90 days) OR <100% requirements met
- **Green**: All requirements met, no cert issues

**Solution:** Refresh the page. Check individual requirement progress. Verify waiver adjustments in Training Admin > Training Waivers.

### Problem: Certification alert not received

**Root Cause:** Each alert tier (90/60/30/7 days) is sent only once per certification.

**Solution:** Check the record's `alert_*_sent_at` timestamps. If already set, that tier was sent. Run `POST /training/certifications/process-alerts/all-orgs` for manual processing.

### Problem: Duplicate training record warning during bulk upload

**Root Cause:** A record with the same member + course name (case-insensitive) + completion date (±1 day) exists.

**Solution:** Review the warning. Set `skip_duplicates: true` in the bulk request to skip known duplicates.

---

## Membership Admin Issues

### Problem: Cannot find the member edit page

**Solution:** Navigate to **Members > Admin**, click a member, then click **Edit** to go to `/members/admin/edit/:userId`.

### Problem: Rank validation shows unexpected results

**Root Cause:** The member's rank does not exactly match any configured operational rank (case-sensitive).

**Solution:** Edit the member's rank to match a configured rank, or add the rank to the organization's operational ranks in Settings.

### Problem: Member audit history is empty

**Root Cause:** Audit entries are only created for changes made after the audit history feature was deployed.

**Solution:** Changes made before the feature was added will not appear. Future changes will be tracked automatically.

---

## Docker Compose Profile Issues

### Problem: MinIO required variable error blocks startup

**Error:** `required variable MINIO_ROOT_PASSWORD is missing a value`

**Root Cause:** The MinIO service used `:?` (required variable) syntax in `docker-compose.yml`. Docker Compose validates all `:?` variables at parse time, even for services in inactive profiles like `with-s3`.

**Solution:** This has been fixed. MinIO now uses `:-` (default value) syntax. Pull latest changes:
```bash
git pull origin main
docker-compose up -d
```

MinIO only starts when you explicitly activate the `with-s3` profile.

---

## Frontend Dependency Issues

### Problem: npm install fails with ERESOLVE (vitest peer dependency)

**Error:** `ERESOLVE unable to resolve dependency tree` referencing `@vitest/coverage-v8` or `@vitest/ui`

**Root Cause:** `@vitest/coverage-v8` and `@vitest/ui` were pinned at 3.0.0 while `vitest` was at 3.2.4.

**Solution:** Updated to 3.2.4. Pull latest and run `npm install`.

### Problem: npm install fails with ERESOLVE (@typescript-eslint)

**Error:** `ERESOLVE` referencing `@typescript-eslint/*` and TypeScript version

**Root Cause:** `@typescript-eslint/*` 8.21.0 required `typescript <5.8.0`, conflicting with TypeScript 5.9.3.

**Solution:** Updated to 8.56.1 (supports `<6.0.0`). Pull latest and run `npm install`.

### Problem: esbuild override causes Vite build issues

**Root Cause:** esbuild override pinned to 0.25.x, but Vite 7.3.1 requires `^0.27.0`.

**Solution:** Updated esbuild override to 0.27.0. Pull latest and run `rm -rf node_modules package-lock.json && npm install`.

---

## Migration Issues on Unraid

### Problem: Backend crashes with KeyError on Alembic revision

**Error:** `KeyError: '20260223_0200'` or `Revision X is not present`

**Root Cause:** Unraid's union filesystem (shfs) can make Docker bind-mounted migration files transiently invisible. Stale `__pycache__` from different Python versions also confuse module loading.

**Solution:** Multiple resilience improvements have been added:
- `__pycache__` cleanup before Alembic loads
- Retry with backoff (up to 3 attempts)
- SQL-based stamp fallback when graph resolution fails
- Model-based `create_all` fallback when upgrade fails

Pull latest and rebuild:
```bash
git pull origin main
docker-compose build --no-cache backend
docker-compose up -d
```

### Problem: Stale assets return 404 after deployment

**Symptom:** After deploying, browsers show 404 errors for JS/CSS files.

**Root Cause:** Cached `index.html` references old asset filenames with different Vite content hashes.

**Solution:** Fixed with `Cache-Control: no-cache` on `index.html`. Pull latest and rebuild frontend. Users can also hard-refresh (Ctrl+Shift+R).

---

## Public Outreach Request Pipeline Issues

### Problem: Public event request form not appearing

**Symptoms:** Public form URL returns 404 or blank page.

**Fix:**
1. Go to **Forms > [Your Form]** and ensure **Public Access** is toggled on with a `public_slug` set
2. Verify the form has an `EVENT_REQUEST` integration under **Forms > Integrations**
3. Check that outreach types are configured in **Events > Settings > Outreach Types**

### Problem: Submitted requests not visible to coordinator

**Fix:** The coordinator needs the `events.manage` permission. Check **Administration > Roles & Permissions**. Also check the status filter — new requests arrive as `submitted`.

### Problem: Default coordinator not auto-assigned

**Fix:** Go to **Events > Settings > Request Pipeline** and select a **Default Coordinator**. Ensure the selected member is still an active user.

### Problem: Room double-booking error when scheduling

**Fix:** Another event is already booked at that location and time. View the room's calendar to find the conflict, then choose a different time slot or room. If the location dropdown is empty, add rooms in **Administration > Locations**.

### Problem: Email notifications not sending

**Fix:**
1. Verify SMTP is configured in **Administration > Email Settings**
2. Check **Events > Settings > Email Triggers** — each status change trigger must be toggled on
3. Verify `notify_requester` and/or `notify_assignee` sub-toggles are enabled for the relevant trigger

### Problem: Template variables showing as literal text

**Fix:** Use double curly braces with no spaces: `{{contact_name}}`, not `{ { contact_name } }`. Supported variables: `{{contact_name}}`, `{{organization_name}}`, `{{outreach_type}}`, `{{event_date}}`, `{{status}}`, `{{status_link}}`.

### Problem: Public status page shows "Request Not Found"

**Fix:** Check that the status link includes the full token. Use the **Copy Status Link** button in the admin tab. If the request was hard-deleted from the database, the token lookup will fail.

### Problem: Pipeline tasks not visible on public status page

**Fix:** Public progress visibility is **off by default**. Go to **Events > Settings > Request Pipeline** and toggle **Public Progress Visibility** on. This is intentional — many departments prefer to keep planning details internal.

### Problem: Cannot cancel or postpone a request

**Fix:** Only requests in active states (`submitted`, `in_progress`, `scheduled`, `postponed`) can be modified. Terminal states (`declined`, `cancelled`, `completed`) cannot be changed. Postponed requests can be resumed via "Resume Work" which transitions back to `in_progress`.

---

## Admin Hours Module Issues

### Problem: QR code clock-in shows "Category not found"

**Fix:** The QR code URL references a deleted or wrong-org category. Regenerate the QR code from **Administration > Admin Hours > QR Codes** and reprint.

### Problem: Clock-out button not appearing

**Fix:** Verify an active (unclosed) session exists on your **My Hours** page. Sessions older than 24 hours may be auto-closed. If so, submit a manual entry instead.

### Problem: Hours stuck in "pending" with no reviewer

**Fix:** Ensure at least one role has the `admin_hours.manage` permission. Also check the category's auto-approve threshold — entries below the threshold are auto-approved.

### Problem: Manual entry rejected with "Overlapping session"

**Fix:** The time range overlaps with an existing entry. Check **My Hours** for entries on that date and adjust times to avoid overlap.

---

## Elections Detail & Voting Issues

### Problem: Election detail page hangs on loading

**Status (Fixed 2026-02-27):** Route param mismatch (`:id` vs `electionId`) caused the page to never fetch data. Pull latest to fix.

### Problem: Cannot open election with only ballot items

**Status (Fixed 2026-02-27):** `open_election` now supports ballot-item-only elections (approval votes, resolutions) without requiring candidates.

### Problem: Close election shows "Election not found"

**Status (Fixed 2026-02-27):** Returns descriptive error messages for wrong-status elections instead of misleading "not found".

### Problem: Voter overrides page crashes

**Status (Fixed 2026-02-27):** Frontend now correctly handles `{ overrides: [...] }` response shape from the API.

---

## Shift Pattern & Calendar Issues

### Problem: Weekly shift pattern generates on wrong days

**Status (Fixed 2026-02-27):** Weekday convention mismatch between JS (0=Sunday) and Python (0=Monday) caused shifts to land on wrong days. Backend now converts correctly.

### Problem: Multiple shifts per day blocked by duplicate guard

**Status (Fixed 2026-02-27):** Overlap check now uses date + start_time, allowing different shift types on the same day.

### Problem: Shift times show "Invalid Date"

**Status (Fixed 2026-02-27):** `formatTime()` now handles bare time strings (e.g., `"08:00:00"`) from the backend.

### Problem: Dashboard "Upcoming Shifts" widget is empty

**Status (Fixed 2026-02-27):** Dashboard now shows all organization shifts, not just user-assigned ones.

### Problem: Open shifts endpoint returns 422

**Status (Fixed 2026-02-27):** Route ordering fixed — `/shifts/open` now defined before `/shifts/{shift_id}`.

---

## Organization Settings Issues

### Problem: Cannot change email/storage/auth settings after onboarding

**Status (Fixed 2026-02-27):** These settings are now accessible in **Administration > Organization Settings** under the Email, Storage, and Authentication tabs.

### Problem: SMTP changes not taking effect

**Fix:** After saving new SMTP settings, restart the backend: `docker-compose restart backend`. The email client needs to reinitialize with new credentials.

### Problem: Switching storage provider loses files

**Important:** Provider switches do not auto-migrate files. Back up existing files before switching, then re-upload to the new provider.
