# Frontend Not Rendering - Troubleshooting Guide

## Problem
The frontend HTML loads at http://localhost:7880 but the React application doesn't render (blank page). Nginx logs show 200/304 responses, indicating static files are being served.

## Most Likely Cause
The frontend `.env` file is missing or has incorrect configuration. Vite needs environment variables at **BUILD TIME** to inject them into the JavaScript bundle.

---

## Solution 1: Verify and Fix Frontend .env File (Most Common)

### Step 1: Check if frontend .env exists
```bash
cd /mnt/user/appdata/the-logbook/frontend
ls -la .env
```

If the file doesn't exist or is empty, proceed to Step 2.

### Step 2: Create/Update frontend .env file
```bash
cd /mnt/user/appdata/the-logbook/frontend
cat > .env << 'EOF'
# API Configuration - UNRAID DEPLOYMENT
VITE_API_URL=http://YOUR-UNRAID-IP:7881

# WebSocket Configuration
VITE_WS_URL=ws://YOUR-UNRAID-IP:7881

# Environment
VITE_ENV=production

# Security - Session Encryption Key (CHANGE THIS!)
VITE_SESSION_KEY=change-this-to-a-random-32-character-string-in-production

# Feature Flags
VITE_ENABLE_PWA=true
VITE_ENABLE_ANALYTICS=false
EOF
```

**IMPORTANT**: Replace `YOUR-UNRAID-IP` with your actual Unraid server IP address (e.g., `192.168.1.100`).

To find your Unraid IP:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

### Step 3: Rebuild frontend container
```bash
cd /mnt/user/appdata/the-logbook
docker-compose stop frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

### Step 4: Verify
Wait 30 seconds, then visit: `http://YOUR-UNRAID-IP:7880`

---

## Solution 2: Check Browser Console for JavaScript Errors

### Open Browser Developer Tools
1. Visit `http://YOUR-UNRAID-IP:7880`
2. Press `F12` or Right-click → Inspect → Console tab
3. Look for red error messages

### Common Errors and Fixes

**Error: "Failed to load module script" or "404 Not Found" for /assets/*.js**
- **Cause**: Build artifacts missing or not generated
- **Fix**: Run Solution 1 Step 3 (rebuild frontend)

**Error: "NetworkError" or "Failed to fetch" when calling API**
- **Cause**: VITE_API_URL is wrong or backend not running
- **Fix**:
  1. Verify backend is running: `docker ps | grep backend`
  2. Test backend directly: `curl http://YOUR-UNRAID-IP:7881/docs`
  3. Update frontend .env with correct VITE_API_URL

**Error: "CORS policy" blocking requests**
- **Cause**: Backend CORS not configured for frontend URL
- **Fix**: See Solution 3 below

---

## Solution 3: Verify Backend CORS Configuration

### Check backend .env file
```bash
cd /mnt/user/appdata/the-logbook
cat .env | grep ALLOWED_ORIGINS
```

It should contain:
```env
ALLOWED_ORIGINS=["http://YOUR-UNRAID-IP:7880"]
```

If not, update it:
```bash
# Edit .env file
nano .env

# Add or update this line:
ALLOWED_ORIGINS=["http://YOUR-UNRAID-IP:7880"]
```

Then restart backend:
```bash
docker-compose restart backend
```

---

## Solution 4: Verify Backend is Running and Accessible

### Check backend container status
```bash
docker-compose ps backend
```

Should show "Up" status.

### Check backend logs
```bash
docker-compose logs backend --tail=50
```

Look for startup messages like:
```
INFO:     Uvicorn running on http://0.0.0.0:3001
INFO:     Application startup complete
```

### Test backend API directly
```bash
# From Unraid terminal
curl http://localhost:7881/docs

# From your browser
http://YOUR-UNRAID-IP:7881/docs
```

Should return the FastAPI documentation page.

---

## Solution 5: Check Docker Compose Configuration

### Verify docker-compose.yml has correct ports
```bash
cd /mnt/user/appdata/the-logbook
cat docker-compose.yml | grep -A5 "frontend:"
```

Should show:
```yaml
frontend:
  ports:
    - "${FRONTEND_PORT:-7880}:80"
```

### Verify root .env has correct ports
```bash
cat .env | grep -E "FRONTEND_PORT|BACKEND_PORT"
```

Should show:
```env
FRONTEND_PORT=7880
BACKEND_PORT=7881
```

---

## Solution 6: Complete Fresh Rebuild (Nuclear Option)

If all else fails, rebuild everything from scratch:

```bash
cd /mnt/user/appdata/the-logbook

# Stop and remove all containers
docker-compose down

# Remove old builds (optional but recommended)
docker-compose rm -f
docker system prune -f

# Ensure frontend .env is correct (use Solution 1 Step 2)
cat frontend/.env

# Rebuild and start
docker-compose build --no-cache
docker-compose up -d

# Watch logs
docker-compose logs -f
```

---

## Diagnostic Commands

### Check all container statuses
```bash
docker-compose ps
```

### Check frontend container logs in real-time
```bash
docker-compose logs -f frontend
```

### Check backend container logs in real-time
```bash
docker-compose logs -f backend
```

### Verify network connectivity between containers
```bash
docker-compose exec frontend ping -c 3 backend
docker-compose exec backend ping -c 3 frontend
```

### Check what files exist in frontend container
```bash
docker-compose exec frontend ls -la /usr/share/nginx/html/
docker-compose exec frontend ls -la /usr/share/nginx/html/assets/
```

---

## Expected Successful State

### Frontend container logs should show:
```
/docker-entrypoint.sh: Configuration complete; ready for start up
```

### Backend container logs should show:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:3001
```

### Browser should show:
- The Logbook welcome page with animated logo
- No errors in browser console (F12)
- After 10 seconds, auto-redirect to onboarding check page

### API should be accessible:
- `http://YOUR-UNRAID-IP:7881/docs` - FastAPI documentation
- `curl http://YOUR-UNRAID-IP:7881/health` - Should return health status

---

## Still Not Working?

If the issue persists after trying all solutions:

1. **Capture browser console errors**:
   - Open browser dev tools (F12)
   - Go to Console tab
   - Take screenshot of any red errors
   - Go to Network tab
   - Reload page
   - Look for failed requests (red status codes)

2. **Check frontend build artifacts**:
   ```bash
   docker-compose exec frontend ls -la /usr/share/nginx/html/assets/
   ```
   Should show .js and .css files.

3. **Verify environment variables are in built JavaScript**:
   ```bash
   docker-compose exec frontend cat /usr/share/nginx/html/assets/*.js | grep -o "VITE_API_URL" | head -1
   ```
   Should return "VITE_API_URL" if variables were injected during build.

4. **Check if you can access frontend from Unraid server itself**:
   ```bash
   curl http://localhost:7880
   ```
   Should return HTML content.

---

## Quick Fix Checklist

- [ ] Frontend .env file exists with correct VITE_API_URL
- [ ] VITE_API_URL points to `http://YOUR-UNRAID-IP:7881` (not localhost)
- [ ] Backend .env has ALLOWED_ORIGINS with frontend URL
- [ ] Root .env has FRONTEND_PORT=7880 and BACKEND_PORT=7881
- [ ] Frontend rebuilt after changing .env: `docker-compose build --no-cache frontend`
- [ ] Both containers running: `docker-compose ps` shows "Up"
- [ ] Backend accessible: `curl http://YOUR-UNRAID-IP:7881/docs` works
- [ ] Browser console has no JavaScript errors (F12)

---

**Most Common Solution**: 99% of the time this issue is fixed by:
1. Creating/updating `frontend/.env` with correct `VITE_API_URL`
2. Running `docker-compose build --no-cache frontend`
3. Running `docker-compose up -d`

Try Solution 1 first!
