# Application Review — Frontend Shared (Tier B)

**Prefix:** `FE` · **Iteration:** B27 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2) · **(final Tier B item)**

**Frontend:** the shared layer — `services/` (global `api.ts`, `apiClient.ts`,
`errorTracking.ts`), `utils/` (`apiCache.ts`, `errorHandling.ts`, `createApiClient.ts`,
`simpleMarkdown.ts`, date/currency formatting, offline queues), `stores/`
(`authStore.ts`), `hooks/`, and shared `components/ux/`.
**Prior audit:** none — this layer was explicitly deferred from the module audits to
this iteration. So this is a first pass, security-first.

---

## Pass 2 (2026-08-08) — frontend six-lens sweep

Re-verified pass-1: no `dangerouslySetInnerHTML` anywhere in `src/`; the shared
render helpers text-render (`simpleMarkdown` + `LinkifiedText` scheme-allowlist
hrefs); the global (`apiClient.ts`) and factory (`createApiClient.ts`) axios
instances both set `withCredentials` + CSRF double-submit and share one
`refreshPromise`; only `has_session` in `localStorage`; FE-1 object-`detail`
handling holds; no banned date APIs in the shared layer. The **HIPAA cache-exclusion
lens** then surfaced a real, systemic leak.

### FE-2 — HIGH — Bare PII list endpoints escaped the cache exclusion (trailing-slash prefix bug) — ✅ FIXED

`isCacheable(url)` tests `url.startsWith(prefix)` against `UNCACHEABLE_PREFIXES`, so
a prefix written **with a trailing slash** (`/users/`) matches `/users/123` but
**not the bare list endpoint** `/users` — which is exactly the URL the roster
service hits (`api.get('/users')` on the cached global instance). The list response
(names, emails, phones, emergency contacts) was therefore cached in the in-memory
SWR store for up to 90s — a HIPAA §164.312 cache-exclusion violation. The list
already knew this trap: `/elections`, `/officers`, and `/audit-logs` deliberately
omit the trailing slash "so the list endpoint is covered too" — six sensitive
entries simply missed it. **Six confirmed live** (each verified on the cached global
`api` instance hitting the bare path): `/users` (roster PII, **HIGH**), `/messages`
(private member-to-member messages, **HIGH**), `/integrations` (configs with API
keys/webhook secrets, **MED-HIGH**), `/documents`, `/errors` (user context +
tracebacks), `/notifications/my`. **Fix:** drop the trailing slash on all six (now
`startsWith` covers list *and* sub-paths; no cacheable endpoint is lost since every
`/x/…` sub-path was already excluded). Verified no collision — e.g. `/messages`
does not catch `/message-history` (its own exclusion), `/events` list stays
cacheable. **2 hardening additions** in the same edit: `/meetings` (attendee PII +
notes/motions in the list/detail) and `/event-requests` (external contact PII) were
cacheable with no exclusion at all — added, matching the `/minutes-records` and
`/rsvps` precedent. Regression test pins all eight bare-list exclusions plus the
non-collision (`apiCache.test.ts`, 71 pass).

**Flagged (LOW, unchanged):** the module-factory (`createApiClient.ts`) 401 handler
redirects to `/login` without the global handler's `/onboarding` guard or
`clearCache()` — not a live bug (module instances aren't used pre-session today),
recorded for a future consistency pass. Lenses 1/2/4/5/6 clean.

---

## Scope

A broad security-first survey of the shared frontend infrastructure (XSS surfaces,
the HIPAA cache-exclusion list, auth/CSRF plumbing, error handling), plus the
review's correctness/dead-code lenses. The layer is well-tested (co-located
`.test.ts` throughout) and in good shape; one concrete correctness bug was fixed.

## Findings

### FE-1 — LOW/MED — `toAppError` rendered a structured object `detail` as "[object Object]" — ✅ FIXED

`toAppError` (the shared unknown→`AppError` converter used by every store and async
handler) handled a **string** `detail` and a **422 array** `detail`, but for an
**object** `detail` it did `message = data.detail || …` — so a dict detail (e.g. a
409 `{ message, warning_type }`, which several endpoints raise) became the object
itself, surfacing as literal `[object Object]` in the toast. **Fix:** added an
object-detail branch that extracts `detail.message` (falling back to `data.message`
/ `statusText`), and widened the response type to include a `Record`. Now any
endpoint returning a structured detail shows a real message. **2 regression tests
added** (object detail with a message; object detail without one falls through).
This also generalizes the one-off repair made for the membership-pipeline 409
(MP-7) — the shared handler now covers the whole class.

## Verified good ✅ (security survey)

- **No stored-XSS in the shared render helpers.** `simpleMarkdown.ts` builds output
  with `React.createElement` (never `innerHTML`) and restricts link schemes to
  `http/https/mailto`; `LinkifiedText.tsx` emits React text nodes + `<a href>` where
  the href regex only matches `https?://…` (no `javascript:`), with
  `rel="noopener noreferrer nofollow"`. The only two `dangerouslySetInnerHTML`
  grep hits are the comments in those files stating they *don't* use it.
- **The HIPAA cache-exclusion list is thorough and well-maintained.**
  `apiCache.ts` `UNCACHEABLE_PREFIXES` (57 entries) + `UNCACHEABLE_SUBSTRINGS` cover
  auth, users, security, medical-screening, the full training-PHI surface,
  prospective-members, finance, inventory-per-member, elections, documents,
  compliance, integrations, storefront, and the event-roster sub-resources — each
  with a rationale comment. Mutations auto-invalidate by URL prefix.
- **Auth plumbing matches the documented model** — `services/api.ts` uses
  `withCredentials` + the CSRF double-submit interceptor + the shared-`refreshPromise`
  401 refresh; `authStore` keeps only the `has_session` flag in `localStorage`, never
  tokens. `createApiClient` centralizes the module-axios auth config (Pitfall #7).

## Dead code / duplication

- `check_field_whitelisted` (backend portal.py) is intentionally retained (a test
  asserts it) — noted in B26, not here.
- No shared-layer dead code found worth removing this pass; the offline-queue
  utilities (`genericOfflineQueue`, `offlineQueue`, `shiftReportOfflineQueue`) share
  a pattern but are feature-specific, not true duplication.

## Documentation

The shared utilities are unusually well-commented (rationale on the cache list,
XSS-safety notes on the render helpers). No doc inaccuracies found.

## Future development

1. **`toAppError`** — consider surfacing `detail.warning_type` as `AppError.code`
   for structured 409s (would let callers branch without the `extractPhaseGateWarning`
   special case). Not done — out of scope for the bug fix.
2. **Cache-exclusion lint** — a unit test that fails when a new `/api/v1` route
   returning member PII isn't in `UNCACHEABLE_PREFIXES` would make the list
   self-policing (today it relies on reviewer diligence).

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `eslint` (changed files) | ✅ 0 errors |
| frontend tests | ✅ `errorHandling.test.ts` **34 passed** (+2 new). |
