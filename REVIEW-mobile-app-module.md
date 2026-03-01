# Mobile App Module Review

**Date:** 2026-03-01
**Scope:** Frontend mobile module (`types/modules.ts` id: `mobile`), PWA infrastructure, mobile-related hooks and CSS

---

## Current State

The "Mobile App Access" module (`id: 'mobile'`) is a **feature-flag placeholder** — it exists as an entry in the module registry (`frontend/src/types/modules.ts:407-422`) and the backend module settings (`backend/app/schemas/organization.py`), but has no dedicated module directory, no routes, no pages, no service layer, and no backend endpoints. The toggle in Settings (`frontend/src/pages/SettingsPage.tsx:105`) turns the flag on/off, but enabling it does nothing.

The actual mobile experience is delivered through existing **PWA infrastructure** scattered across the codebase:

| Capability | File(s) | Status |
|---|---|---|
| PWA manifest + service worker | `vite.config.ts` | Working |
| App update detection | `hooks/useAppUpdate.ts`, `components/UpdateNotification.tsx` | Working |
| Pull-to-refresh gesture | `hooks/usePullToRefresh.ts` | **Defined but never used** (0 consumers) |
| Responsive CSS | `styles/index.css` (lines 463-625) | Working |
| Media query hook | `hooks/useMediaQuery.ts` | Working |
| Safe area insets (notch devices) | `styles/index.css` (lines 592-600) | Working |
| Push notifications | — | **Not implemented** (listed as a feature) |
| Offline access | — | **Not implemented** (listed as a feature) |

---

## Issues Found

### 1. `usePullToRefresh` is dead code

It's exported (`hooks/usePullToRefresh.ts:21`) but has zero consumers anywhere in the codebase. It was introduced in #68 but never wired into any page.

### 2. `usePullToRefresh` has a stale-closure bug

The `handleTouchEnd` callback reads `state.pullDistance` from the closure (line 65), but `state` may be stale because `handleTouchEnd` is memoized with `state.pullDistance` in its dependency array. Each time `pullDistance` changes, a new `handleTouchEnd` is created and re-registered on the document, which is wasteful. A ref-based approach for `pullDistance` would be more robust.

### 3. The module advertises features it doesn't deliver

The module definition in `types/modules.ts:417-421` lists three features:

- **"Mobile-optimized interface"** — partially true (responsive CSS exists but no mobile-specific UI)
- **"Push notifications"** — not implemented at all (no Web Push API integration, no VAPID keys, no backend push subscription endpoints)
- **"Offline access"** — not implemented (the service worker caches the app shell but all API calls use `NetworkOnly`, and there's no IndexedDB-based offline data layer)

### 4. No `/mobile` route exists

The module declares `route: '/mobile'` but no route is registered in `App.tsx` or any routes file. Navigating to `/mobile` would hit the fallback/404.

---

## Recommendations

### Phase 1 — Fix What Exists

1. **Wire up `usePullToRefresh`** on key pages (Dashboard, Scheduling, Members list) with a visual pull indicator. Currently the hook returns `pullDistance` and `refreshing` state but no component renders that feedback to the user.

2. **Fix the stale-closure bug** in `usePullToRefresh` — store `pullDistance` in a ref alongside the state to avoid recreating touch handlers on every distance change.

3. **Remove or downgrade the false feature claims** ("Push notifications", "Offline access") from the module definition until they're actually built. Alternatively, mark them with a "Coming soon" label.

### Phase 2 — Build a Proper Mobile Module

4. **Mobile settings page (`/mobile`)** — When the module is enabled, give admins a page to configure:
   - Push notification preferences (per-category: scheduling, emergencies, announcements)
   - Offline data sync preferences
   - Mobile display density (compact vs. comfortable)
   - Quick-action shortcuts for the mobile home screen

5. **Push notifications via the Web Push API**:
   - **Backend**: Add VAPID key generation, a `push_subscriptions` table, and `POST /api/v1/push/subscribe` / `DELETE /api/v1/push/unsubscribe` endpoints. Integrate with the existing notification service so that when an in-app notification is created, a web push is also dispatched.
   - **Frontend**: Add a `usePushNotifications` hook that requests `Notification.permission`, subscribes via `PushManager.subscribe()`, and sends the subscription to the backend. Gate this behind the `mobile` feature flag.
   - **Service worker**: Extend the existing Workbox SW with `push` and `notificationclick` event handlers.
   - **HIPAA consideration**: Push notification payloads must not contain PHI — use generic titles ("New notification") with a link back to the app.

6. **Offline data access (read-only cache)**:
   - Add an IndexedDB layer (via `idb` or similar) for caching critical read-only data: the user's schedule, upcoming events, member directory (name/phone only).
   - Implement a `useOfflineData` hook that returns cached data when `navigator.onLine` is false and fresh data otherwise.
   - Add a visual "Offline" banner (similar to `UpdateNotification`) so users know they're viewing cached data.
   - Respect HIPAA: only cache the minimum data needed, encrypt the IndexedDB store, and clear it on logout and idle timeout (extend `useIdleTimer`).

### Phase 3 — Mobile-First UX Enhancements

7. **Bottom navigation bar** — On mobile viewports (`< 640px`), replace or supplement the side navigation with a fixed bottom tab bar for the 4-5 most-used actions (Dashboard, Schedule, Members, Notifications, More). This is the standard mobile UX pattern that the current sidebar-based layout lacks.

8. **Mobile-optimized action sheets** — Replace dropdowns and context menus with bottom-sliding action sheets on touch devices using the `useMediaQuery` hook to switch behaviors.

9. **Swipe gestures** — Add swipe-to-navigate between tabs/views on mobile (e.g., swipe between schedule days), and swipe-to-archive/dismiss on notification items.

10. **Quick-action widget / shortcuts** — Expose PWA shortcuts in the manifest for common actions ("View My Schedule", "Check In", "Mark Available") so they appear in the device's long-press app menu.

11. **Biometric re-authentication** — Use the Web Authentication API (`navigator.credentials`) for quick biometric unlock on mobile after the session has been idle, rather than requiring full password re-entry.

12. **Mobile-specific dashboard** — Create a simplified, card-based dashboard layout for mobile that prioritizes "my upcoming shift", "my notifications", and "quick actions" over the full desktop widget grid.

### Phase 4 — Testing and Quality

13. **Mobile E2E tests** — The existing Playwright E2E suite (`e2e/dashboard.spec.ts`) only has one mobile viewport test. Add dedicated mobile test suites for:
    - Touch gesture interactions (pull-to-refresh, swipe)
    - Bottom navigation behavior
    - Offline mode transitions
    - Push notification permission flow
    - PWA install prompt handling

14. **Lighthouse CI** — Add a Lighthouse CI check to the build pipeline targeting a mobile viewport to track PWA score, performance, and accessibility regressions on mobile.

15. **Device testing matrix** — Document target devices (iOS Safari 16+, Chrome Android 100+) and add corresponding Playwright device emulation profiles.

---

## Summary

The mobile module is currently an empty shell with a few scattered PWA primitives. The most impactful near-term wins are:

1. **Fix and use `usePullToRefresh`** — quick win, improves perceived quality
2. **Implement Web Push notifications** — the #1 feature users expect from a "mobile app"
3. **Add a bottom navigation bar** — the single biggest mobile UX improvement

The offline data layer is the most complex piece but also the most differentiating — fire departments need schedule access even in areas with poor connectivity.
