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
8. [Network & Connectivity](#network--connectivity)
9. [Security Issues](#security-issues)
10. [Accessibility Issues](#accessibility-issues)

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
