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

**Symptom:** `React.memo` is undefined at runtime, or `useLayoutEffect` error at startup.

**Status:** Fixed in March 2026. The Vite manual chunk configuration was updated to eliminate circular dependencies between vendor chunk groups that caused runtime errors.

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

## Dynamic Import / Chunk Load Errors (2026-02-28)

### Problem: "Loading chunk failed" or blank page after deployment

**Cause:** After a deployment, Vite generates new JS/CSS files with different content hashes. Users with cached `index.html` still reference old filenames that no longer exist.

**Status (Fixed):** All lazy-loaded route pages now use `lazyWithRetry()` (in `utils/lazyWithRetry.ts`) which retries chunk loads up to 3 times with cache-busting query parameters. If retries fail, it forces a page reload.

**User workaround:** Hard refresh (`Ctrl+Shift+R`) or clear browser cache.

---

## Skills Testing Display Updates (2026-02-28)

### Non-critical criteria showing "FAIL"

**Status (Fixed):** Non-critical criteria that are unchecked now display "Not Completed" instead of "FAIL" to avoid confusion.

### Completed test times show UTC

**Status (Fixed):** All test timestamps now display in the user's local timezone using standard date formatting utilities.

---

## Mobile Responsiveness Improvements (2026-02-28)

Mobile responsiveness has been improved across 17+ pages and components:

- Pagination collapses to prev/next on small screens
- Settings page uses responsive grid
- Apparatus list toggles card/table layout
- Member profile sections stack vertically
- Dashboard cards reflow for small viewports
- Inventory tables scroll horizontally
- Pipeline views adapt to screen width
- Global CSS adds `scrollbar-gutter: stable`

If layout appears broken, clear cache and hard refresh.

---

## Navigation Module Enablement (2026-02-28)

### Problem: Disabled modules visible in navigation

**Status (Fixed):** SideNavigation and TopNavigation now dynamically check org module enablement settings. Menu items for disabled modules are hidden.

### Problem: TopNavigation out of sync with SideNavigation

**Status (Fixed):** Both navigations now render the same page set based on permissions and module enablement.

---

## Frontend Cache Refresh Detection (2026-02-28)

### Problem: Users see stale app version after deployment

**Status (Improved):** A proactive version detection system has been added:
- `useAppUpdate` hook checks for new versions via build timestamp in HTML `<meta>` tag
- `UpdateNotification` component shows a refresh prompt when a new version is detected
- Nginx sends `X-App-Version` header
- Vite build plugin injects `BUILD_TIMESTAMP` at build time

If the notification doesn't appear, hard refresh with `Ctrl+Shift+R`.

---

## Brute-Force Rate Limiting on Login (2026-02-28)

### Problem: Login page shows "Too many attempts" countdown

**Cause:** Client-side rate limiting prevents rapid-fire login attempts. After 5 rapid submissions, a 30-second cooldown activates.

**Fix:** Wait for the countdown to expire. The backend also enforces IP-based and per-user rate limiting with a 30-minute lockout.

---

## Scheduling Module Refactor (2026-02-28)

### Problem: Scheduling imports broken after update

**Cause:** The scheduling API service moved from `services/api.ts` to `modules/scheduling/services/api.ts`.

**Fix:** Update imports:
```typescript
import { schedulingService } from '@/modules/scheduling/services/api';
```

### Problem: Scheduling component state not updating

**Cause:** State moved from local component state to a dedicated Zustand store (`schedulingStore`).

**Fix:** Use `useSchedulingStore()` and ensure store actions are called on component mount.

---

## Accessibility & Theme Fixes (2026-02-28)

### Contrast issues in dark mode

**Status (Fixed):** Comprehensive audit fixed color contrast across:
- QR code pages (event QR, self-check-in)
- Onboarding pages
- Form field renderer
- Error boundary
- Pipeline pages
- Skill test active page

### New `useMediaQuery` hook

A new `useMediaQuery` hook replaces inline `window.matchMedia` calls for responsive behavior in components.

---

## CSS Inline Style Migration (2026-03-01)

### Problem: Component styles look different after update

**Cause:** 873 hard-coded inline styles were migrated to shared CSS component classes. In rare cases, CSS specificity differences can cause visual changes.

**Fix:** Clear browser cache and hard refresh (`Ctrl+Shift+R`). If a specific component still looks wrong, check for custom CSS conflicting with the new shared classes.

### Problem: Focus ring colors inconsistent

**Status (Fixed 2026-03-01):** All focus ring colors now use a CSS theme variable (`--focus-ring`), standardized across 39 frontend files.

### Problem: Status badge or severity indicator colors wrong

**Status (Fixed 2026-03-01):** PR #491 applied a blanket color replacement that damaged semantic colors. Semantic color usage has been restored.

---

## Platform Analytics Crash (2026-03-01)

### Problem: PlatformAnalyticsPage crashes with "Cannot read properties of undefined"

**Cause:** `module.recordCount` was `undefined` for some modules.

**Status (Fixed 2026-03-01):** Defensive null checks added. Modules with no record count display zero.

---

## Elections Module Visual Fixes (2026-03-01)

### Problem: ElectionDetailPage has inconsistent colors and CSS issues

**Status (Fixed 2026-03-01):** Fixed inconsistent indigo focus ring colors, unused variable lint errors, and remaining CSS issues in election pages.

---

## Module Enablement Defaults (2026-03-01)

### Problem: Standard modules missing from navigation after fresh install

**Cause:** Standard modules were not defaulting to enabled.

**Status (Fixed 2026-03-01):** Standard modules now default to enabled. Settings UI redesigned with module cards.

---

## API Service Split (2026-03-02)

### Problem: Import errors referencing `services/api`

**Cause:** The monolithic `services/api.ts` (5,330 lines) was split into 13 domain-specific service files.

**Fix:** Update imports to the new files:
```typescript
// Old
import { eventService } from '@/services/api';
// New
import { eventService } from '@/services/eventServices';
```

The legacy `services/api.ts` re-exports for backward compatibility, but direct imports are preferred.

---

## exactOptionalPropertyTypes (2026-03-02)

### Problem: TypeScript errors about `undefined` not assignable to optional properties

**Cause:** `exactOptionalPropertyTypes` was enabled in `tsconfig.json`.

**Fix:** Omit the property instead of assigning `undefined`:
```typescript
const x: { bar?: string } = {}; // ✅ OK (omitted)
const x: { bar?: string } = { bar: undefined }; // ❌ Error
```

---

## Route Module Extraction (2026-03-02)

### Problem: Custom routes missing after update

**Cause:** Inline routes were extracted from `App.tsx` into module `routes.tsx` files.

**Fix:** Check `frontend/src/modules/<module>/routes.tsx` for your routes. New modules: `action-items`, `admin`, `documents`, `forms`, `integrations`, `notifications`, `settings`.

---

## Module Component Decomposition (2026-03-02)

### Problem: Component not rendering or missing content after update

**Cause:** Large page components were decomposed into focused sub-components:
- `AdminHoursManagePage` → 5 tab components (`ActiveSessionsTab`, `AllEntriesTab`, `CategoriesTab`, `PendingReviewTab`, `SummaryTab`)
- `ApparatusDetailPage` → 7 components (`ApparatusDetailHeader`, `ApparatusOverviewTab`, `DocumentsTab`, `EquipmentTab`, `FuelLogsTab`, `MaintenanceTab`, `OperatorsTab`)
- `ShiftSettingsPanel` → 6 card components

**Fix:** Clear browser cache. The UI behavior is unchanged — only the internal component structure was refactored.

---

## Mobile Member ID Scanner (2026-03-02)

### Problem: Scan Member ID button not visible on mobile

**Status (Fixed):** Mobile toolbar layout updated so the button is accessible. Clear browser cache and reload.

### Problem: Camera not activating for member ID scan

**Fix:** Grant camera permissions in your browser settings. Use Chrome or Safari for best BarcodeDetector support.

---

## ARIA Accessibility (2026-03-02)

ARIA attributes have been added across the UI. If automated accessibility testing shows new warnings about duplicate IDs or conflicting ARIA roles, check that custom components don't add redundant ARIA attributes that conflict with the built-in ones.

---

## Tailwind CSS v4 Migration (2026-03-03)

### Problem: Styles broken or different after update

**Cause:** Tailwind CSS upgraded from v3.4 to v4.2. The `tailwind.config.js` file was removed — Tailwind v4 uses CSS-first configuration via `@theme` directives in `frontend/src/styles/index.css`. Over 200 component files were updated with v3→v4 class name changes.

**Fix:** Clear browser cache and hard refresh (`Ctrl+Shift+R`). If you have custom Tailwind configuration in `tailwind.config.js`, migrate it to `@theme` blocks in CSS:
```css
@theme {
  --color-custom: #123456;
}
```

### Problem: PostCSS plugin errors

**Cause:** Tailwind v4 handles imports natively. The `postcss-import` plugin was removed from `postcss.config.js`.

**Fix:** Remove `postcss-import` from your PostCSS config if you have a custom one.

---

## React 19 Upgrade (2026-03-03)

### Problem: `forwardRef` deprecation warnings

**Cause:** React upgraded from 18.3 to 19. In React 19, `ref` is a regular prop and `forwardRef` is deprecated (though still functional).

**Fix:** No immediate action required — `forwardRef` still works. To remove warnings, convert components to accept `ref` as a regular prop.

### Problem: Test failures after React 19 upgrade

**Cause:** React 19 changes `act()` behavior and cleanup timing.

**Fix:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm test
```

---

## ESLint v9 Flat Config Migration (2026-03-03)

### Problem: ESLint not finding configuration

**Cause:** ESLint was upgraded from v8 to v9. Configuration migrated from `.eslintrc.json` to `eslint.config.js` (flat config format).

**Fix:** Update your IDE ESLint extension to the latest version that supports flat config. The old `.eslintrc.json` has been removed.

### Problem: New lint errors after ESLint v9 upgrade

**Fix:** Run `npx eslint --fix frontend/src/` to auto-fix. For persistent errors, check `frontend/eslint.config.js`.

---

## Vitest 4 & Zod 4 Upgrade (2026-03-03)

### Problem: Test import errors or schema validation changes

**Cause:** Vitest upgraded from v3 to v4 and Zod from v3 to v4, both with breaking changes.

**Fix:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm test
```

---

## Form Builder Issues (2026-03-02)

### Problem: Form builder drag-and-drop not working

**Cause:** Form builder upgraded to use `@dnd-kit` for drag-and-drop reordering. If dependencies are missing, drag-and-drop silently fails.

**Fix:** `cd frontend && npm install` — verify `@dnd-kit/core` and `@dnd-kit/sortable` are installed.

### Problem: Public form no longer shows name/email section

**Cause:** The forced name/email section was removed from public forms. Contact info is now optional per form.

**Fix:** Add explicit text/email fields in the form builder to collect contact information on public forms.

### Problem: Forms page not accessible to non-admin users

**Status (Fixed 2026-03-02):** Forms page now uses `forms.view` permission instead of `settings.manage`. Users with the `forms.view` permission can now see the Forms page.

---

## Form Editor Theme Issues (2026-03-02)

### Problem: Form editor background or tab text invisible in light/dark theme

**Status (Fixed 2026-03-02):** Fixed form editor background and tab text colors to be compatible with both light and dark themes.

---

## Facility Address Blank Fields (2026-03-04)

### Problem: Facility addresses show as blank/undefined

**Status (Fixed):** Frontend types updated from snake_case to camelCase to match API (`addressLine1`, `zipCode`, `facilityNumber`). `FacilityListItem` backend schema also updated.

**Edge Case:** Custom code reading facility API data must use camelCase property names.

---

## Admin Hours Category Summary Undefined (2026-03-04)

### Problem: Admin hours summary shows "undefined" for categories

**Status (Fixed):** `AdminHoursSummary.byCategory` type + SummaryTab, AdminHoursPage, MemberProfilePage updated to camelCase (`categoryId`, `categoryName`, `totalHours`).

---

## Custom Event Categories (2026-03-04)

### Problem: Custom categories not appearing in event form

**Fix:** Configure in Events Settings → Custom Event Categories section. Toggle visibility separately in Event Type & Category Visibility section.

### Problem: TS2345 type error on category color (dev only)

**Status (Fixed):** `CategoryColor` union type widens `useState` generic for all color options.

---

## Theme Compliance — Hardcoded Colors (2026-03-04)

### Problem: EventRequestStatusPage and ApparatusListPage show wrong colors in light/high-contrast mode

**Status (Fixed):** Replaced hardcoded colors with theme-aware CSS variables (`bg-theme-surface`, gradient theme vars, etc.).

**Edge Case — Custom themes:** Ensure `:root` and `.dark` selectors define all `--theme-*` CSS variables.

---

## Modal Click-Through (2026-03-04)

### Problem: Modal dialog buttons unresponsive

**Status (Fixed):** Backdrop overlay no longer intercepts clicks intended for dialog children. Fixes delete confirmations, pipeline actions, etc.

---

## Events Settings Redesign (2026-03-04)

### Sidebar + Content Panel Layout

Events Settings tab now uses sidebar + content panel layout (matching Organization Settings) instead of collapsible sections. Desktop: sidebar navigation with section descriptions. Mobile: horizontal scrollable tabs.

---

## Inventory Empty String Clearing (2026-03-05)

### Problem: Clearing form fields doesn't reset to defaults

**Status (Fixed):** `??` (nullish coalescing) was used where `||` (logical OR) was needed. `??` only catches `null`/`undefined`, not `""`. Fixed across all inventory pages.

### Problem: Hardcoded condition dropdown options

**Status (Fixed):** Replaced with `ItemCondition` enum for consistency with backend.

---

## Clipboard Copy Fallback (2026-03-05)

### Problem: "Copy error details to clipboard" does nothing

**Status (Fixed):** `navigator.clipboard` requires HTTPS. Added `document.execCommand('copy')` fallback. On failure, selects text for manual copy.

---

## Barcode Label Printing (2026-03-05)

### Problem: Labels print blank or don't render barcodes

**Checklist:** Use Chrome/Edge. Verify paper size matches printer (Dymo 2.25×1.25″, Rollo 4×6″). Check CSP allows inline SVG. Batch ≤30 labels.

**Edge Case:** Organization logo loaded from profile URL — 404/CORS causes silent omission.

---

## Mobile Card Views & FAB (2026-03-05)

Inventory pages now use responsive card layouts on mobile with a floating action button (FAB). If layout issues occur on specific screen sizes, check that the viewport meta tag is set correctly in `index.html`.

---

## Grants Module TypeScript Issues (2026-03-05)

### Problem: `|| undefined` patterns cause TS errors with exactOptionalPropertyTypes

**Status (Fixed):** Replaced with conditional spreads (`...(val ? { key: val } : {})`) across 69 files. If you see similar errors in custom code, avoid `|| undefined` and use proper type narrowing.

---

## Post-Login 401 Cascade (2026-03-06)

### Problem: Login succeeds but dashboard shows errors and redirects to login

**Status (Fixed):** Dashboard fires ~15 parallel API calls immediately after login. If cookies aren't processed yet, all return 401, triggering a refresh cascade. Fixed with: (1) Bearer token bridge using access token from login response body, (2) cookie settle polling before dashboard navigation, (3) post-login grace period with exponential backoff in 401 interceptor.

**Edge Cases:** Module-specific axios instances (scheduling, admin-hours, createApiClient) each need independent Bearer token bridges — all now included. Refresh token stored in memory for environments where cookies are never stored.

---

## Elections Ballot Preview Missing Candidates (2026-03-06)

### Problem: Candidates don't appear in ballot preview or voting page

**Status (Fixed):** Template-created ballot items lacked `position` field for candidate matching. Fixed with position-based matching and title-based fallback.

**Related:** BallotBuilder redesigned with drag-and-drop card UI, one ballot item per position enforcement, write-in candidate auto-fill, position dropdown from org ranks.

---

## Events Page UX (2026-03-06)

### New Features
- Search bar filtering events by title and location
- Upcoming/Past toggle for all users (past events previously admin-only)
- Pagination on events list
- User RSVP status badge on event cards
- Manager action buttons reorganized into primary + "More" dropdown

---

## Onboarding Error Messages (2026-03-06)

### Problem: Error messages show "[object Object]" or empty red alert box

**Status (Fixed):** `toAppError()` now detects array-style 422 validation errors and formats as "field: reason". `ErrorAlert` returns null for empty/whitespace messages.

### Problem: Organization creation 422 from empty form fields

**Status (Fixed):** `??` passes empty strings to backend. Changed to `|| undefined`. ZIP validation strengthened.

---

## Facilities Type Safety (2026-03-06)

### Improvement: `Record<string, unknown>` replaced with typed interfaces

All `Record<string, unknown>` types in `facilitiesService` replaced with proper TypeScript interfaces matching backend Pydantic schemas. All `as unknown as` type casts removed from consuming components. New `FacilityRoomPicker` component for cross-module room selection.

---

## TypeScript Build Errors — 94 Error Batch Fix (2026-03-12)

### Problem: Frontend build fails with 94+ TypeScript errors

**Status (Fixed):** Batch fix resolved wrong import paths in admin-hours module (`ActiveSessionsTab`, `AllEntriesTab`, `PendingReviewTab`), duplicate CSS class properties, unused variables, and `noUncheckedIndexedAccess` violations across 18 files.

### Problem: ESLint reports many errors and warnings

**Status (Fixed):** All ESLint errors and warnings resolved across 59 files — 0 errors, 0 warnings. Fixes include proper typing on test mocks, correct `@testing-library` assertions, and removed unused variables.

---

## Form Value `??` to `||` Migration (2026-03-12)

### Problem: Optional form fields cause 422 errors across multiple modules

**Status (Fixed):** React form fields initialize as `""`. Using `??` passes empty strings through to the API. Changed to `||` in 14+ files across events, scheduling, inventory, onboarding, prospective members, training, and member profile modules.

**Rule:** Always use `||` (not `??`) to coerce optional form values. See CLAUDE.md Pitfall #1.

---

## QR Check-In Timezone Display (2026-03-12)

### Problem: QR check-in window shows "N/A"

**Status (Fixed):** Backend returned bare date/time strings instead of ISO 8601. Fixed to construct `{date}T{time}` format. Added `organizationTimezone` for correct local time display.

**Edge Case:** Falls back to browser timezone if org timezone is missing.

---

## Timezone Standardization (2026-03-12)

### Improvement: 34 files updated with timezone-aware formatting

All `new Date().toLocaleString()` / `toLocaleDateString()` calls replaced with `formatDate()` / `formatDateTime()` / `formatTime()` utilities that accept an IANA timezone parameter. Affected modules: admin-hours, grants-fundraising, inventory, onboarding, scheduling, compliance, events, member profile, platform analytics, skills testing, elections.

**Edge Case:** Users may notice time "shifts" after update since pages now show org-local times instead of UTC.

---

## Events Settings Refactor (2026-03-12)

### Improvement: EventsSettingsTab extracted into 6 section components

Monolithic `EventsSettingsTab` (~1160 lines) refactored into `CategoriesSection`, `EmailSection`, `FormSection`, `OutreachSection`, `PipelineSection`, and `VisibilitySection` with shared types and deduplicated save logic.

### Problem: Form generation stays on settings page

**Status (Fixed):** After generating an event request form, user is now redirected to the Forms page with the new form pre-selected.

---

## RecurringEventCreate Type Error (2026-03-12)

### Problem: TypeScript error on RecurringEventCreate with exactOptionalPropertyTypes

**Status (Fixed):** Optional fields needed explicit `| undefined` union types to satisfy `exactOptionalPropertyTypes`. Updated all 21 optional fields in the type definition.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Backend Issues](Troubleshooting-Backend)
