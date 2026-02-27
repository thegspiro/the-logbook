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

## Dependency Conflicts (2026-02-24)

### npm install Fails with ERESOLVE

Multiple peer dependency conflicts were resolved in February 2026:

| Package | Issue | Fix |
|---------|-------|-----|
| `@vitest/coverage-v8`, `@vitest/ui` | Pinned at 3.0.0 vs vitest 3.2.4 | Updated to 3.2.4 |
| `@typescript-eslint/*` | 8.21.0 required TypeScript <5.8.0 | Updated to 8.56.1 |
| `esbuild` override | 0.25.x vs Vite 7.3.1 needing ^0.27.0 | Updated to 0.27.0 |
| `postcss` | 8.5.0 vs Vite needing ^8.5.6 | Updated to 8.5.6 |
| `react-hook-form` | Dual instances (7.54.2 / 7.71.1) | Updated to 7.71.1 |

If you encounter ERESOLVE errors, pull latest changes and run:
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

---

## Stale Assets After Deployment

**Symptom:** 404 errors for JS/CSS files after deploying a new version.

**Status:** Fixed in February 2026. Nginx now sends `Cache-Control: no-cache` for `index.html` so browsers always fetch fresh asset references.

**Workaround:** Hard refresh (Ctrl+Shift+R) or clear browser cache.

---

## Circular Chunk Dependency

**Symptom:** `React.memo` is undefined at runtime, causing crashes.

**Status:** Fixed in February 2026. The Vite manual chunk splitting was reordered to eliminate circular dependencies between vendor chunk groups.

---

## QR Code & Clipboard Issues (2026-02-27)

### QR Codes Not Displaying on Locations & Rooms Page

**Status (Fixed):** Room cards now render toggleable QR codes for their kiosk display URL using `qrcode.react` QRCodeSVG. Pull latest to get the fix.

### "Failed to copy" Error When Copying Links

**Status (Fixed):** A clipboard fallback using `document.execCommand('copy')` has been added for contexts where `navigator.clipboard` is unavailable (e.g., non-HTTPS, older browsers, embedded webviews).

### QR Code Refresh Errors on Event QR Code Page

**Status (Fixed):** A stale closure bug in `EventQRCodePage` caused the refresh interval to capture an outdated `fetchQRData` callback. The callback reference is now stable.

---

## ESLint & Code Quality (2026-02-27)

### ESLint Shows 0 Errors, 0 Warnings

As of February 27, 2026, the entire frontend codebase has **zero ESLint errors and zero warnings**. Key cleanups:
- 565 floating/misused promise warnings fixed (added `void` operator, wrapped async handlers)
- 94 axios calls typed with generic parameters to eliminate `no-unsafe-return`
- Non-null assertions replaced with nullish coalescing and optional chaining
- `any` types replaced with `unknown` or proper types

If ESLint reports new warnings after adding code, fix them before committing. The CI enforces `--max-warnings 0`.

---

## Auth Token Persistence (2026-02-27)

### Problem: User logged out on page refresh

**Status (Fixed):** Auth tokens are now correctly persisted in `localStorage`. A race condition that could clear tokens during page refresh has been resolved. If users still experience this, clear browser storage and re-login.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Backend Issues](Troubleshooting-Backend)
