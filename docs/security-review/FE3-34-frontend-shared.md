# Security Review — Feature 34: Frontend Shared (pass 3)

**Prefix:** `FE3` · **Iteration:** 34 · **Reviewed:** 2026-08-31 · **PR:** #2112 (round 1, merged), #2118 (round 2, Codex-caught fixes)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/errorHandling.ts`,
`services/errorTracking.ts`, `utils/createApiClient.ts`, all 13 module axios
instances (`modules/*/services/api.ts` — up from 12 last pass; the new
`modules/testing/services/api.ts` reviewed for the first time), plus one
same-module second client the `modules/*/services/api.ts` glob doesn't catch
(`modules/inventory/services/equipmentCheckApi.ts`, new this rotation),
`components/ProtectedRoute.tsx`, `stores/authStore.ts`,
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, and — read in full for the first time this
rotation — `components/ux/*` (30 non-test files, 3,514 L).
**Backend:** none — read-only cross-reference, as in prior passes.
**Migrations:** none.

---

## Route inventory

n/a — this feature owns no backend routes (frontend shared infrastructure:
cache, axios clients, auth store, shared UI). Dimensions 1-3 below are
evaluated at the frontend-consumption level (does a client correctly respect
the backend's auth/authz/tenant gates) rather than against a route table,
since there is no route table for a frontend-only feature to enumerate.

## Checklist dimensions

| #   | Dimension                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authentication coverage      | Checked. `ProtectedRoute.tsx` re-verified: gates strictly pre-render, no flash of unauthorized content — see Verified good. **FE3-34-3 (FIXED):** the global client's 401→refresh interceptor mistook `/auth/mfa/login`'s intentional 401 (wrong/expired code) for an expired session. **FE3-34-2 (FLAGGED):** `authStore.logout()` presents an unauthenticated UI even when the server-side logout call fails, while the httpOnly session cookies remain live. |
| 2   | Authorization & role fit     | n/a — no owned backend routes.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Tenant isolation             | n/a — this layer carries no by-id backend queries to scope.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Injection & untrusted output | Checked. `components/ux/*` swept for XSS sinks (none); `LinkifiedText.tsx` verified safe by construction (see below).                                                                                                                                                                                                                                                                                                                                           |
| 5   | Data exposure                | Checked — this feature's central concern. Diff-based cache-exclusion sweep (below) plus all 9 FE2-34 exposure findings re-verified intact. **FE3-34-1 (FIXED):** `loadUser()` purged local offline drafts on _any_ profile-fetch failure, not only a confirmed 401/403. **FE3-34-4 (FLAGGED):** a stale in-flight cacheable GET can still write into the shared cache after a session-boundary `clearCache()`.                                                  |
| 6   | Abuse resistance             | Checked. Cache bounded at 200 entries/FIFO eviction (Verified good); no new unbounded tracking introduced this pass.                                                                                                                                                                                                                                                                                                                                            |
| 7   | Schema & migration integrity | n/a — see Schema & migration notes below.                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Scope

This pass re-verifies FE2-34 (2026-08-27, PR #1918) rather than re-reading the
whole surface line-by-line a third time. Since FE2-34, `main` picked up 103
non-test frontend files changed (+20,407/-4,266) across ~30 other rotation
iterations, so the re-verification method was:

1. **Diff-based sweep for new cache risk**, the dominant finding class in both
   prior passes: `git diff 507937f7..HEAD` (the FE2-34 commit) restricted to
   added lines matching `api.get(`/`api.get<`, across the **entire** frontend
   (not just this feature's file list) — every page, hook, component and
   service, not only the files FE2-34 scoped in. This is strictly broader than
   a re-read of the same file list would catch, since a new gap could just as
   easily be introduced in a page component calling `api.get` directly.
   _(The sweep's first run predated merging `main`'s equipment-checklists
   move into this branch and missed the 19 calls that move added in
   `modules/inventory/services/equipmentCheckApi.ts` — Codex caught the gap;
   re-run against the post-merge tree below.)_
2. **Re-verified all 9 FE2-34 findings** against current code (not just that
   the doc says "fixed" — read the actual current line).
3. **Read `components/ux/*` in full**, the one shared-UI directory no prior
   frontend-shared pass (module-audit, 4 app-review passes, or FE2-34) had
   scoped in explicitly.
4. **Confirmed no new store** was added under `stores/` (still exactly the 4
   FE2-34 covered) and accounted for the one new module axios file
   (`modules/testing/services/api.ts`).

**Not re-read line-by-line this pass:** the ~150 non-module `services/*.ts`
files and the ~200 pages/components/hooks that call the global `api` instance
directly — per FE2-34's scoping rationale, these are business logic owned by
their respective feature's own rotation slot; only their **cache-exclusion
correctness** is this feature's concern, and that was covered by the diff
sweep in (1), not by re-reading each file's unrelated logic.

## Diff-based cache-risk sweep — results

Every `api.get(`/`api.get<` call added or modified since FE2-34, across the
whole frontend, filtered to non-test files:

| File                                              | New/changed call                                                                             | `isCacheable`? | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modules/admin-hours/services/api.ts`             | `GET /admin-hours/entries/export`                                                            | n/a            | Uses `createApiClient()` (own instance) — confirmed zero caching logic in that factory (FE2-34-5), so this never touches the cache regardless of the exclusion list.                                                                                                                                                                                                                                                                                                                                               |
| `modules/inventory/services/equipmentCheckApi.ts` | 19 `api.get(...)` calls (checklist templates, compartments, items, logs, compliance reports) | n/a            | New file: PR #2110 moved equipment checklists from Scheduling to Inventory. `const api = createApiClient();` (its own instance) — same zero-caching factory as admin-hours above, confirmed again by reading the import; none of these 19 calls can reach the shared cache. `modules/scheduling/services/api.ts` re-exports this same service rather than defining a second client, so there is exactly one axios instance behind both modules' checklist calls.                                                   |
| `modules/testing/services/api.ts`                 | `GET /testing-checklist`                                                                     | Excluded       | New module (`e74c2115`, "Make the testing checklist a module"). Imports the **global** `apiClient` directly (like `ip-security`), so it _does_ go through the cache. `'/testing-checklist'` was added to `UNCACHEABLE_PREFIXES` in the same commit family that introduced the endpoint — verified present and correctly matches the bare `GET /testing-checklist` (own-marks default and `include_all_testers=true` admin view alike; response carries `userName`/`testedAs` per entry, a real per-tester roster). |
| `services/inventoryService.ts`                    | `GET /inventory/checkout/active`, `GET /inventory/checkout/overdue`                          | Excluded       | Both start with `'/inventory/checkout/'`, already in the list ("who currently holds equipment (PII)"). No gap.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `utils/createApiClient.test.ts`                   | `api.get('/things', ...)`                                                                    | test fixture   | Not a real endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Also swept for any other module-level file importing the global client outside
the `modules/*/services/api.ts` glob (the gap that missed
`equipmentCheckApi.ts` initially): `modules/membership/services/nfcCardService.ts`
does, but it pre-dates FE2-34 and has zero `.get()` calls (write-only card
issuance) — not a cache consumer at all, no gap.

**Read `modules/testing/services/api.ts` in full** (not just the grep hit),
since it is the only genuinely new global-cache consumer this pass: one GET
(`/testing-checklist`, excluded), one POST (`startRun`), one PUT
(`saveEntry`), one DELETE (`clearRun`) — none of the writes touch the cache
read path, and `invalidateByPrefix` is not called here at all (the module
doesn't need it; nothing else caches derived `/testing-checklist` data).
No finding.

**Conclusion: zero new cache-exclusion gaps** since FE2-34, despite 103 files
of churn. The exclusion list's discipline (every new sensitive endpoint this
rotation touched — `/testing-checklist`, `/training/competency-matrix`,
`/training/dashboard-summary`, `/training/sessions/approve/`,
`/training/effectiveness/evaluations`, `/dashboard/action-items` — arrived
with its exclusion-list entry in the same commit) held across every other
feature's own review, not just this one's.

## Re-verification of FE2-34's 9 findings

All 9 confirmed intact in current code — none regressed:

- **FE2-34-1/2/3** (`/training/cohorts/`, `/training/programs/programs/`,
  `/training/external/providers/`) — all three present verbatim in
  `UNCACHEABLE_PREFIXES` (`apiCache.ts:69-71`).
- **FE2-34-4/5** (`/forms`, `/grants` trailing-slash fix) — both present with
  no trailing slash (`apiCache.ts:84,97`).
- **FE2-34-6** (`/analytics/export`) — present (`apiCache.ts:104`).
- **FE2-34-7** (CSRF cookie `decodeURIComponent`) — `authStore.ts:52` still
  calls `decodeURIComponent(match[1])`, matching `apiClient.ts`'s reader.
- **FE2-34-8** (`getMyAttendance` 404-only swallow) — `modules/scheduling/
services/api.ts:728-736` still catches only `AxiosError` with
  `status === 404` and rethrows everything else.
- **FE2-34-9** (purge-on-logout) — `authStore.ts` still imports and calls
  `purgeLocalMemberData()` on both the explicit-logout path (`:366`) and the
  session-expired catch branch (`:420`); `useIdleTimer.ts`'s `performLogout`
  still routes through the same `authStore.logout()`.

## `components/ux/*` — first full read this rotation

30 non-test files (3,514 L: `AutoSaveIndicator`, `Avatar`, `Breadcrumbs`,
`Collapsible`, `CommandPalette`, `ConfirmDialog`, `DateRangePicker`,
`DateTimeQuarterHour`, `DialogPanel`, `EmptyState`, `FileDropzone`,
`FlashlightToggle`, `FloatingActionButton`, `InlineEdit`, `LinkifiedText`,
`MobileCheckoutCard`, `MobileItemCard`, `PageTransition`, `Pagination`,
`ProgressSteps`, `PromptDialog`, `ScanSuccessFlash`, `Skeleton`,
`SortableHeader`, `SuccessAnimation`, `TimeQuarterHour`, `Tooltip`,
`TopProgressBar`, `WhatsNew`, `index.ts`).
_(Corrected from an initial miscount of 20 files/~3,466 L that omitted
`AutoSaveIndicator.tsx` and `index.ts` from the enumerated list — both were
still inside the recursive `grep -rn` sweep below, which ran over the whole
directory rather than this list, so the security coverage was complete; only
the written inventory undercounted. Re-checked both individually against the
same patterns: clean.)_

- **No XSS sinks**: grepped and confirmed no `dangerouslySetInnerHTML`,
  `innerHTML` assignment, `eval`, or `document.write` in the directory.
- **No blocking-dialog violations** (Pitfall #16): the only `window.confirm`/
  `window.prompt` mentions are in `PromptDialog.tsx`'s and `ConfirmDialog`'s
  own doc comments describing what they replace — neither component calls the
  native API.
- **`LinkifiedText.tsx`** (renders message-body URLs as clickable links) is
  safe by construction: `URL_RE` requires an `https?://` prefix at the match
  start, so a `javascript:` URI can never be matched and turned into an
  `href`; text is emitted as React children (auto-escaped), never via
  `dangerouslySetInnerHTML`; links carry `rel="noopener noreferrer nofollow"`
  and `target="_blank"`.
- **`WhatsNew.tsx`**'s only `localStorage` use is a version-string
  last-seen marker (`STORAGE_KEY`) — no PII, and not part of the purge scope
  in FE2-34-9 for that reason.

No findings in this directory.

## Verified good ✅

All of FE2-34's "Verified good" claims re-checked and still true (cache
bound at 200 entries/FIFO eviction, shared `performSharedRefresh()` singleton
across global + all `createApiClient()` instances, one-shot 401 `_retry`
guard excluding auth endpoints, `ProtectedRoute` pre-render gating, no
`persist` middleware on `skillsTestingStore`). Adding this pass:

- **13 module axios files, not 12** — `modules/testing/services/api.ts` is
  new; confirmed above it correctly uses the global client with its one
  sensitive endpoint excluded.
- **`createApiClient.ts`'s new blob-error-decoding branch** (added in the
  admin-hours round-2 pass, `fc0aaafc`) only activates when
  `error.response.data instanceof Blob && type.includes('json')`, wraps the
  `.text()`/`JSON.parse` in try/catch, and leaves the Blob untouched on a
  non-JSON body (e.g. an HTML proxy error page) rather than throwing —
  correctly scoped, doesn't affect the 401-refresh branch below it in the
  same interceptor.

## Findings

Zero regressions and zero new gaps from the diff-based sweep or the first
full read of `components/ux/*`. Codex's review of this pass's first commit
found four real defects in the auth/cache core that the initial pass's
methodology (diff-sweep + re-verification of prior findings) wasn't shaped to
catch — none is a cache-exclusion or XSS issue, the classes the sweep and the
`components/ux/*` read targeted. Two fixed, two flagged.

### FE3-34-1 — MEDIUM — `loadUser()` purged local member data on any profile-fetch failure, not only a confirmed session failure — ✅ FIXED

**What:** `authStore.ts`'s `loadUser()` catch block called
`await purgeLocalMemberData()` unconditionally for every rejection from
`authService.getCurrentUser()` — a confirmed 401/403 and an offline browser,
a request timeout, or a backend 5xx were treated identically.
**Where:** `frontend/src/stores/authStore.ts` (catch block in `loadUser`).
**Failure scenario:** a member with unsynced shift-report drafts or queued
equipment-check submissions reloads the page while offline, or the profile
endpoint briefly 500s. `getCurrentUser()` rejects, `loadUser()` purges every
local draft and IndexedDB queue, and the result is discarded — no loss
notice, matching the mechanism `authStore.logout()` already has
(`lastLogoutPurge`) but `loadUser()` never surfaces.
**Impact:** silent, permanent loss of a member's not-yet-synced work on a
transient failure that had nothing to do with their session actually being
invalid.
**Fix:** classify the error first (`appError.status === 401 || 403`) and
purge only on a confirmed auth failure; every other error still reports
unauthenticated for this load (unchanged) but leaves local data intact so it
can sync once connectivity/the backend recovers.

### FE3-34-2 — HIGH — `authStore.logout()` presents an unauthenticated UI even when the server-side logout call fails — OPEN, FLAGGED

**What:** `logout()` wraps `authService.logout()` in
`try { ... } catch { /* Logout errors are non-critical; cookies are cleared
by the backend */ }` and unconditionally proceeds to clear local state and
set `isAuthenticated: false`. The comment's premise is false on the failure
path: the backend's `POST /auth/logout` (`backend/app/api/v1/endpoints/
auth.py:1197-1235`) only calls `_clear_auth_cookies()` on its 200 response,
after `AuthService.logout_user()` has deleted the `UserSession` row; on any
failure (network drop, 5xx, or the endpoint's own pre-cookie-clear 400 when
`logout_user()` returns `False`) the httpOnly access/refresh cookies are
left exactly as they were.
**Where:** `frontend/src/stores/authStore.ts` (`logout`); backend
counterpart `backend/app/api/v1/endpoints/auth.py:1197-1235`,
`backend/app/services/auth_service.py:554-580`.
**Failure scenario:** a member on a shared station computer clicks Sign Out;
the logout POST fails (a transient network blip, or the DB delete inside
`logout_user()` hitting the same `except Exception: return False` that
already logs "Logout failed"). The UI shows the login screen. The next
person at that workstation is shown as logged out too, but the previous
member's session cookies are still valid — if anything on that browser tab
or a bookmark hits an authenticated endpoint before the tokens naturally
expire, it succeeds as the previous member.
**Impact:** on the app's own stated shared-workstation threat model (the
same one `purgeLocalMemberData()` on this exact `logout()` path exists to
defend, per its own comment two lines below), a failed logout silently
leaves the session live while telling everyone it ended.
**Why flagged, not fixed:** closing this safely needs a product decision on
what a failed logout should do client-side — retry automatically (how many
times, with what backoff, before giving up?), block the UI with an explicit
"couldn't confirm sign-out, please close your browser" message (matching
the backend's own 400 copy), or something else — and touches the one flow
this rotation's own precedent (Pitfall #16, the shared-device purge) treats
as highest-stakes to get right on the first try rather than patch
speculatively in the same pass as three other fixes. Mirrored into
`KNOWN_LIMITATIONS.md`.

### FE3-34-3 — MEDIUM-HIGH — a wrong/expired MFA code was treated as an expired session, purging local data and hard-redirecting instead of showing "invalid code" — ✅ FIXED

**What:** the global client's response interceptor treats any 401 as an
expired session and attempts a refresh, unless the request URL matches
`isAuthEndpoint`'s list. `/auth/mfa/login` was not in that list, even though
the backend endpoint (`backend/app/api/v1/endpoints/auth.py:769-800`)
intentionally returns 401 (`CodedHTTPException`,
`AUTH_MFA_CHALLENGE_EXPIRED`) for a wrong TOTP code, an expired
`mfa_token`, or a locked account — a routine, expected outcome mid-challenge,
not a session expiry.
**Where:** `frontend/src/services/apiClient.ts` (`isAuthEndpoint` list).
**Failure scenario:** a member with MFA enabled mistypes their 6-digit code.
`POST /auth/mfa/login` correctly 401s. The interceptor, not recognizing the
endpoint, calls `performSharedRefresh()` — which also fails, since login
hasn't completed and there is no session to refresh — and hands off to
`handleExpiredSession()`: purges local member data, clears the cache, and
(outside `/onboarding`) hard-redirects to `/login` via
`window.location.href`. The member never sees "invalid code, try again" —
the MFA form and its `mfaToken` state are gone, and any offline drafts on
that device were just purged for an entirely unrelated reason.
**Impact:** a routine typo in the MFA step becomes a full page reload that
silently discards local data and forces the member to restart login from
scratch.
**Fix:** added `/auth/mfa/login` to `isAuthEndpoint`, so its 401 is reported
and rejected directly (matching every other genuine auth-flow 401) instead
of entering the refresh/purge/redirect path. Guard test added in
`apiClient.test.ts`, verified to fail against the pre-fix list.

### FE3-34-4 — MEDIUM — a stale in-flight cacheable GET can write into the shared cache after a session-boundary `clearCache()` — OPEN, FLAGGED

**What:** `clearCache()` (called on login and logout) empties the
in-memory `Map`, and `clearInFlight()` only clears the _de-duplication_
bookkeeping in `utils/inFlight.ts` — by its own doc comment, "never let the
old request remove that one," i.e. it deliberately does not cancel the
underlying request. Neither function cancels an axios request already in
flight. The response interceptor's `setCache(key, response.data)` (and the
background stale-revalidation `.then((res) => setCache(...))` path) writes
unconditionally whenever that request eventually settles — including after
a session boundary.
**Where:** `frontend/src/services/apiClient.ts` (response interceptor,
lines ~210-218 and the background-revalidation branch in the request
interceptor); `frontend/src/utils/apiCache.ts` (`setCache`, keyed only by
URL + params — no session/user binding).
**Failure scenario:** on a shared kiosk, member A's slow cacheable request
(e.g. `/analytics/metrics`) is still in flight when they log out and member
B logs in (`clearCache()` fires on both transitions). A's response arrives
afterward and is written into the now-shared cache under a key with no
identity attached. B's next request for the same URL+params, within the
30-90s fresh/stale window, is served A's cached data as a synthetic
response — skipping the network entirely, so it never re-checks B's own
authorization for that data.
**Impact:** a narrow race-window cross-session data leak on the shared-kiosk
threat model this feature otherwise defends carefully (FE-6/FE-7, this
pass's FE3-34-1). Requires an in-flight request straddling exactly a
login/logout boundary, so it is not trivially reproducible, but the
mechanism is real and unconditional once that timing lines up.
**Why flagged, not fixed:** a correct fix needs either a session-generation
counter threaded through every cache write (`setCache` would need to know
the generation the request was issued under, and every caller — the
response interceptor and the background-revalidation branch — would need to
carry it) or cancelling in-flight requests via `AbortController` at the
session boundary, either of which changes the cache module's public API and
risks subtly breaking the existing stale-while-revalidate contract
(`apiCache.test.ts`'s own suite locks in today's `setCache`/`getCached`
signatures). That is a design change to make deliberately, not as a
same-pass patch alongside three other fixes. Mirrored into
`KNOWN_LIMITATIONS.md`.

## Schema & migration notes

n/a — frontend-only feature, no owned tables.

## Guard tests added

- **`services/apiClient.test.ts` (new file — this axios singleton had no
  direct unit test before)**: asserts a 401 from `/auth/mfa/login` does
  _not_ attempt a refresh, does not purge local data, and does not touch
  `window.location.href` (FE3-34-3); a companion case asserts a 401 from a
  genuine protected endpoint still does refresh-and-retry, and a third
  asserts a failed refresh on a protected endpoint still purges and
  redirects — pinning the surrounding behavior so the MFA fix doesn't
  overcorrect into never refreshing. All three verified to fail against the
  pre-fix `isAuthEndpoint` list (the MFA case) respectively pass unchanged
  (the other two, proving the fix is additive).
- **`stores/authStore.test.ts`**: four new `loadUser` cases — purges on a
  confirmed 401 and on a confirmed 403, does _not_ purge on a plain network
  error or a 500 (FE3-34-1). The two "does NOT purge" cases verified to fail
  against the pre-fix code (both called the purge unconditionally).
- No test added for FE3-34-2/FE3-34-4 (flagged, not fixed) — a guard test
  would either lock in the current unsafe behavior or need the
  not-yet-decided remediation shape.

Existing guard tests from FE2-34 (`apiCache.test.ts`'s trailing-slash and
new-exclusion cases) continue to pass unchanged.

## Completion gate

| Check                                                                              | Result                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck` (`tsc-native.mjs`)                                             | ✅ 0 errors                                                                                 |
| `npm run lint`                                                                     | ✅ 0 errors, 9 warnings (pre-existing, unrelated files, within max-warnings 10)             |
| Scoped tests (`apiCache`, `authStore`, `createApiClient`, new `apiClient.test.ts`) | ✅ 154 passed                                                                               |
| Backend                                                                            | n/a — no backend files changed (FE3-34-2's backend citations are read-only cross-reference) |

## Next

Feature 34 is now closed for this pass. Every row (00-34) is ✅ — the
rotation wraps to 00 (cross-cutting baseline) for the next full pass over
whatever has landed since 2026-08-25.
