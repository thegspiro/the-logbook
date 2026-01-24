# Fix: Malformed API URL (http// instead of http://)

## Problem

Frontend shows error:
```
http//10.187.9.2:7880:7881/onboarding/status
Failed to load resource: net::ERR_NAME_NOT_RESOLVED
```

### Root Cause

The frontend was **built with the wrong `VITE_API_URL`**:
- ❌ Vite environment variables are **baked in at BUILD time**
- ❌ You're using an OLD image with wrong VITE_API_URL
- ❌ The container needs to be REBUILT, not just restarted

## Critical Information

**Vite Environment Variables:**
- Set during `npm run build`
- Hardcoded into JavaScript bundle
- **CANNOT be changed at runtime**
- **Must rebuild container to change them**

## Solution: Rebuild Frontend Container

### Step 1: Verify You're Using Correct Docker Compose

**For Unraid, use:**
```bash
cd /mnt/user/appdata/the-logbook
# Use the UNRAID docker-compose
docker-compose -f unraid/docker-compose-unraid.yml down
```

**DO NOT use** the root `docker-compose.yml` - it has wrong settings!

### Step 2: Remove Old Image

```bash
# Remove the old image completely
docker rmi the-logbook-frontend:local

# Verify it's gone
docker images | grep logbook
```

### Step 3: Rebuild with Correct Settings

The correct docker-compose already has the right settings:
```yaml
# unraid/docker-compose-unraid.yml (line 194-196)
args:
  VITE_API_URL: /api/v1  # ✅ CORRECT - relative URL
```

Rebuild:
```bash
cd /mnt/user/appdata/the-logbook

# Build with NO cache (forces fresh build)
docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend

# Start containers
docker-compose -f unraid/docker-compose-unraid.yml up -d

# Check logs
docker logs logbook-frontend --tail 50
```

### Step 4: Verify the Fix

```bash
# Run diagnostic script
chmod +x unraid/check-frontend-config.sh
./unraid/check-frontend-config.sh
```

### Step 5: Test in Browser

1. **Clear browser cache**: Ctrl+Shift+Delete (Chrome/Edge)
2. Open `http://YOUR-UNRAID-IP:7880`
3. Open DevTools (F12)
4. Go to Network tab
5. Refresh page
6. Check that API calls go to `/api/v1/onboarding/status` (relative URL)

## How to Verify Build Args

Before building, check what will be used:
```bash
# Check docker-compose file
grep -A3 "VITE_API_URL" unraid/docker-compose-unraid.yml

# Should show:
# args:
#   VITE_API_URL: /api/v1
```

## Common Mistakes

### ❌ WRONG: Using root docker-compose.yml
```bash
docker-compose up -d  # Uses wrong file!
```

The root `docker-compose.yml` has:
```yaml
environment:
  VITE_API_URL: ${VITE_API_URL:-http://localhost:3001}  # WRONG!
```

This sets it as a **runtime environment variable**, but Vite ignores runtime env vars!

### ✅ CORRECT: Using Unraid docker-compose
```bash
docker-compose -f unraid/docker-compose-unraid.yml up -d
```

This has:
```yaml
args:
  VITE_API_URL: /api/v1  # BUILD-TIME argument
```

## Why This Happens

1. **Vite Static Compilation:**
   - Vite replaces `import.meta.env.VITE_*` with literal values at build time
   - The value is **hardcoded** into the JavaScript bundle
   - Changing env vars after build has NO effect

2. **Docker Build Args vs Environment Variables:**
   - **ARG**: Used during `docker build` (✅ for Vite)
   - **ENV**: Used during `docker run` (❌ for Vite)

3. **Image Caching:**
   - Docker caches build layers
   - Old image may have wrong VITE_API_URL baked in
   - Must remove image and rebuild

## Diagnostic: Check What's Built Into Your Container

```bash
# Check the actual JavaScript bundle
docker exec logbook-frontend sh -c "cat /usr/share/nginx/html/assets/index-*.js" | grep -o "http[^\"']*" | head -5

# Should show RELATIVE URLs only:
# /api/v1/onboarding/status
# /api/v1/...

# Should NOT show ABSOLUTE URLs:
# http://10.187.9.2:7881/...  ❌ WRONG!
```

## Prevention

### Create a Build Wrapper Script

Save this as `build-frontend.sh`:
```bash
#!/bin/bash
cd /mnt/user/appdata/the-logbook
docker-compose -f unraid/docker-compose-unraid.yml down
docker rmi the-logbook-frontend:local
docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend
docker-compose -f unraid/docker-compose-unraid.yml up -d
./unraid/validate-deployment.sh
```

Then:
```bash
chmod +x build-frontend.sh
./build-frontend.sh
```

## Still Having Issues?

### 1. Check Nginx Proxy

```bash
# From inside frontend container
docker exec logbook-frontend wget -qO- http://backend:3001/health

# Should return JSON with "status": "healthy"
```

### 2. Check Network

```bash
# Verify containers are on same network
docker network inspect logbook-internal

# Should show both logbook-frontend and logbook-backend
```

### 3. Check Build Logs

```bash
# Rebuild with verbose output
docker-compose -f unraid/docker-compose-unraid.yml build --progress=plain frontend 2>&1 | grep VITE_API_URL

# Should show:
# VITE_API_URL=/api/v1
```

## Technical Details

### Vite's Environment Variable Resolution

At build time, Vite:
1. Reads `import.meta.env.VITE_API_URL`
2. Replaces it with the **literal string value**
3. Bundles it into the JavaScript

Example:
```typescript
// Source code:
const url = import.meta.env.VITE_API_URL;

// After build with VITE_API_URL=/api/v1:
const url = "/api/v1";

// After build with VITE_API_URL=http://localhost:3001:
const url = "http://localhost:3001";  // ❌ WRONG for production!
```

### Nginx Proxy Requirement

For `/api/v1` (relative URL) to work:
1. Browser requests: `http://10.187.9.2:7880/api/v1/onboarding/status`
2. Nginx receives request on port 80 (inside container)
3. Nginx proxy_pass forwards to: `http://backend:3001/api/v1/onboarding/status`
4. Backend responds
5. Nginx returns response to browser

This is why:
- Port must be `:80` not `:3000` (✅ FIXED)
- VITE_API_URL must be `/api/v1` not `http://...`

## Summary

**The Fix:**
1. ✅ Use `unraid/docker-compose-unraid.yml`
2. ✅ Remove old image: `docker rmi the-logbook-frontend:local`
3. ✅ Rebuild: `docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend`
4. ✅ Restart: `docker-compose -f unraid/docker-compose-unraid.yml up -d`
5. ✅ Validate: `./unraid/validate-deployment.sh`

**Root Cause:**
- Old container built with wrong VITE_API_URL
- Vite bakes env vars at build time, not runtime
- Must rebuild to fix

**Prevention:**
- Always use correct docker-compose file
- Always rebuild after pulling code changes
- Use validation script after deployment
