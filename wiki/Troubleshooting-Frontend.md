# Troubleshooting: Frontend

Solutions for frontend rendering, build, and UI issues in The Logbook.

---

## Blank Page (React Won't Load)

### Symptoms
- HTML loads but React doesn't render
- White screen with no content
- 200/304 responses in nginx logs but nothing visible

### Most Common Cause
Missing or incorrect `VITE_API_URL` in `frontend/.env`. Vite bakes environment variables at **build time**.

### Fix

1. Create/update `frontend/.env`:
```bash
VITE_API_URL=/api/v1
VITE_ENV=production
VITE_ENABLE_PWA=true
```

2. Rebuild frontend:
```bash
docker-compose stop frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

---

## Malformed API URLs

**Symptom:** URLs show `http//` instead of `http://`

**Cause:** Frontend built with wrong `VITE_API_URL`.

**Fix:** Use relative URLs (`/api/v1`) and rebuild. For Unraid, use the Unraid-specific docker-compose file:
```bash
docker-compose -f unraid/docker-compose-unraid.yml build --no-cache frontend
```

---

## CORS Errors

**Symptom:** Browser console shows `Access-Control-Allow-Origin` errors

**Fix:** Update `ALLOWED_ORIGINS` in root `.env`:
```bash
ALLOWED_ORIGINS=["http://YOUR-IP:3000"]
```
Then restart backend: `docker-compose restart backend`

---

## Dark Mode Issues

**Symptom:** Modals or dialogs have wrong background color in dark mode

**Status:** Fixed in February 2026. All modals now use `bg-theme-surface-modal` for proper dark mode contrast.

**If issues persist:** Clear browser cache and reload.

---

## TypeScript Build Errors

**Status:** All TypeScript build errors resolved as of February 2026.

If you encounter build errors after pulling:
```bash
cd frontend
rm -rf node_modules
npm install
npm run typecheck
npm run build
```

---

## Browser Console Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Failed to load module script` | Stale build | Rebuild frontend |
| `NetworkError` / `Failed to fetch` | Wrong VITE_API_URL | Check frontend/.env |
| `CORS policy` blocking | Missing CORS origin | Update ALLOWED_ORIGINS |
| `TypeError: Cannot read property of undefined` | API response mismatch | Clear cache, check backend logs |
| `ChunkLoadError` | Outdated cached chunks | Hard refresh (Ctrl+Shift+R) |

---

## PWA / Service Worker Issues

**Symptom:** Old version of the app persists after update

**Fix:**
1. Clear browser cache
2. Unregister service worker: Browser DevTools > Application > Service Workers > Unregister
3. Hard refresh (Ctrl+Shift+R)

---

## Mobile / Responsive Issues

**Symptom:** Layout breaks on mobile devices

The application is designed as a Progressive Web App with responsive layouts. If issues occur:
1. Check browser zoom is at 100%
2. Try landscape orientation for complex tables
3. Clear browser cache

---

## Debugging Frontend

```bash
# Check frontend logs
docker-compose logs frontend

# Check nginx config
docker exec logbook-frontend cat /etc/nginx/conf.d/default.conf

# Check what's built into the bundle
docker exec logbook-frontend ls -la /usr/share/nginx/html/assets/

# Verify API URL in bundle
docker exec logbook-frontend sh -c "cat /usr/share/nginx/html/assets/index-*.js" | grep -o "http[^\"']*" | head -5
```

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Backend Issues](Troubleshooting-Backend)
