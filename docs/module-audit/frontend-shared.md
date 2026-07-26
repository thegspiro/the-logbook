# Module Audit — Frontend Shared

**Scope:** the React 19 + TypeScript shared layer — `stores/` (authStore),
`services/` (apiClient, apiCache, authService, errorTracking), `utils/`,
`hooks/`, `components/` + `components/ux/` (shared, non-module). The XSS-render
helpers, the auth/token/cache handling, and the privileged log viewers.
**Audited:** iteration 27 (final) — three parallel readers: (A) XSS surface, (B)
auth/token/cache, (C) hooks/utils.

## Verified good ✅
- **No XSS sinks.** There is **no `dangerouslySetInnerHTML` anywhere** in the
  frontend. `simpleMarkdown.ts` and `LinkifiedText.tsx` render via
  `React.createElement`/JSX children (React auto-escapes) and gate link hrefs
  through a scheme allowlist (`http/https/mailto`), so `javascript:`/`data:`
  downgrade to plain text; links get `rel="noopener noreferrer"`. DOMPurify
  (`ALLOWED_TAGS: []`) is used on the genuine user-input form-render paths.
- **The privileged log viewers are safe — this resolves the PP-5 / EL-6 flags
  from iterations #23/#26.** `ErrorMonitoringPage` (error-log fields) and
  `AccessLogsTab` (public access-log `user_agent`/`referer`/`ip`) render the
  unauthenticated-attacker-controlled fields as **escaped JSX text children**, so
  a stored `<script>`/`onerror` payload displays inert. No output-encoding fix
  needed.
- **No auth token in web storage.** authStore persists only
  `localStorage['has_session'] = '1'` and actively removes legacy
  `access_token`/`refresh_token`; the MFA token lives only in in-memory Zustand
  state; apiClient stores no token. CSRF double-submit is correct
  (`X-CSRF-Token` from the `csrf_token` cookie on state-changing methods,
  `withCredentials: true`); the refresh flow is race-safe (shared
  `refreshPromise`) and loop-safe (`_retry` + auth-endpoint exclusion + capped
  retries). `ProtectedRoute` keys off `has_session`, not a token.
- **The API cache is in-memory only** (module-scoped `Map`, cleared on reload),
  with an extensive PII/PHI `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`
  denylist, a short 90s stale window, and prefix-based mutation invalidation.
- **Hooks/utils are clean** — no open redirect, no `eval`/`new Function`, no
  hardcoded secrets, no unvalidated `postMessage`/storage listeners, no token in
  URLs (WS uses handshake cookies), `errorHandling` strips stack traces, no
  `console.*` PII leakage, ICS download uses an app-generated blob URL.

## Findings

### FE-1 — HIGH — Cross-user cached-PII leak on a shared tab (cache not cleared on logout/login) — ✅ FIXED
`clearCache()` only ran **inside** `authService.logout()` *after* the logout POST
succeeded; if that POST threw (network blip / already-expired session — the common
case on a shared terminal), `authStore.logout()` swallowed the error and its
`finally` cleared `has_session` but **not the cache**. Login/register/MFA didn't
clear it either. Because the cache key carries **no user/org identity** and the
`Map` is a module singleton, a second user logging in on the same tab (no reload)
would be served the first user's cached GET responses (dashboard, action items,
training records…).
**Fix:** `clearCache()` now runs **unconditionally** in `authStore.logout()`'s
`finally`, and at the start of a new session in `login` / `completeMfaLogin` /
`register` (defense-in-depth for a user switch after a crash/uncleaned logout).

### FE-2 — MEDIUM — Member training/compliance PHI endpoints were cacheable — ✅ FIXED
`UNCACHEABLE_PREFIXES` had fine-grained per-user training prefixes but omitted
several org-wide, member-identifying ones, so their responses were cached (30s
fresh / 90s stale): `/training/compliance-matrix`,
`/training/certifications/expiring` (+ the `/training/expiring-certifications`
twin), `/training/reports/compliance-forecast`, `/training/records`, and
`/training/skills-testing/tests` (the per-member skills-test scores + evaluator
notes confined in iteration #22).
**Fix:** added all of them to `UNCACHEABLE_PREFIXES`.

### FE-3 — MEDIUM — `/rsvp-history` slipped past the substring guard — ✅ FIXED
`UNCACHEABLE_SUBSTRINGS` blocked `/rsvps` (event roster PII) but a specific event's
`/rsvp-history` (per-member attendance/decline history) does not contain that
substring, so it was cacheable.
**Fix:** added `/rsvp-history` to `UNCACHEABLE_SUBSTRINGS`.

### FE-4 — MEDIUM/LOW — Notification/scheduled-email logs (recipient PII) cacheable — ✅ FIXED
`/notifications/logs` (delivery logs with recipient identities) and
`/email-templates/scheduled` (recipient PII) were not covered by the exclusion
list.
**Fix:** added both. (`/dashboard/action-items` — the caller's own items, low
sensitivity, high traffic, and now cleared on logout by FE-1 — was left cacheable;
noted.)

### FE-5 — LOW — Onboarding refresh-failure retained the cache — ✅ FIXED
On a refresh failure, the non-onboarding branch does a full `window.location`
redirect (which clears the in-memory cache), but the onboarding branch skips the
redirect and never called `clearCache()`.
**Fix:** `clearCache()` now runs unconditionally before the redirect branch.

### FE-6 — MEDIUM (flagged) — PII drafts / offline queue survive logout on a shared device
- `utils/shiftReportDrafts.ts` persists shift-report drafts (crew names, trainee
  evaluations, remarks — member PII) to `localStorage`, and the HIPAA idle-logout
  (`useIdleTimer.performLogout`) clears only `has_session` + `sessionStorage` — it
  never purges the `shift-report-draft-*` keys, so the next user on a shared
  station kiosk can read prior members' evaluations via DevTools.
- `utils/offlineQueue.ts` similarly leaves queued equipment-check payloads +
  photo blobs in IndexedDB across sessions.
Purging on logout would drop unsaved/unsynced work, so whether drafts should
survive a re-login is a product decision. **Status:** flagged (recommend purging
the draft/queue stores on idle-logout for the HIPAA shared-kiosk posture).

### FE-7 — LOW (flagged) — CSRF cookie decoding inconsistency + minor polish
`apiClient.getCookie` decodes the `csrf_token` with `decodeURIComponent` while
`authStore.getCsrfCookie` does not, so if the token ever contained
percent-encodable chars the double-submit compare could false-reject (aligning it
touches CSRF validation — verify against the backend compare first). Also: the
label-print iframe builds an HTML string from `container.innerHTML` (app-generated,
`sanitizeForCode128`-filtered barcode markup in an isolated frame — low risk;
optional DOMPurify hardening), and `useAppUpdate.dismiss` sets a sentinel build id
before its refetch resolves (functional tidy-up). **Status:** flagged.

## Notes
- Coverage caveat: `components/` (101 files) + `components/ux/` (28) were swept for
  raw-HTML sinks and the specific privileged-viewer render paths, not reviewed
  component-by-component. The XSS invariant (React child-escaping, no
  `dangerouslySetInnerHTML`) held everywhere examined.
- Verification: `tsc --noEmit` clean, ESLint clean, and 102 authStore + apiCache
  unit tests pass with these changes.
- **This is the final module (#27) — the 27-module rotation is complete.** See
  PROGRESS.md for the full run and CROSS-CUTTING.md / KNOWN_LIMITATIONS.md for the
  cross-cutting patterns and open owner-decision items.
