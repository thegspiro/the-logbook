# Security Review — Feature 34: Frontend Shared

**Prefix:** `FE2` · **Iteration:** 34 · **Reviewed:** 2026-08-27 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts` (247 L), `services/apiClient.ts` (323 L),
`utils/errorHandling.ts` (237 L), `services/errorTracking.ts` (170 L),
`utils/createApiClient.ts` (105 L), all 12 module axios instances
(`modules/*/services/api.ts`, ~5,133 L combined), `components/ProtectedRoute.tsx`
(227 L), `stores/authStore.ts` (464 L), `stores/learningProgressStore.ts` (128 L),
`stores/pendingSyncStore.ts` (43 L), `stores/skillsTestingStore.ts` (537 L).
**Backend:** none — read-only cross-reference of the schemas backing the
cache-exclusion findings below.
**Migrations:** none.

This layer carries four prior app-review passes (2026-08-06 through 2026-08-09)
and one module-audit pass (iteration 27), all of which explicitly noted the
module axios instances and most of the shared core were checked "for
invariants, not line-by-line." Three parallel background agents did that
line-by-line read for the first time across the full scope (shared
API/cache/error core; all 12 module axios instances + the factory; ProtectedRoute

- all four stores), plus independently re-verified two specific items left open
  by the module audit (FE-6, FE-7) rather than trusting the doc.

9 findings: 3 HIGH, 2 MEDIUM, 4 LOW — all fixed. One prior LOW finding (FE-6)
confirmed already resolved by an intervening change; one stale prior finding
(the `createApiClient.ts` 401-handler note) corrected in `app-review/frontend-shared.md`.

---

## Scope

**Read in full, by 3 parallel agents:**

- Agent A: `apiClient.ts`, `apiCache.ts`, `errorHandling.ts`, `errorTracking.ts`
- Agent B: `createApiClient.ts` + all 12 `modules/*/services/api.ts` files
- Agent C: `ProtectedRoute.tsx`, `authStore.ts`, `learningProgressStore.ts`,
  `pendingSyncStore.ts`, `skillsTestingStore.ts`

**Not touched this pass:** `components/ux/*`, module-specific stores outside the
four named above, and the ~150 non-module service files under `services/*.ts`
that call the global `api` instance — Agent A's cache-exclusion audit covered
the endpoints those files call (that's how findings 1-4 were found), but did
not read every one of those files line-by-line for unrelated issues.

## Verified good ✅

- **No XSS sinks** in any of the reviewed files — no `dangerouslySetInnerHTML`,
  `eval`, or `innerHTML` assignment.
- **Auth/CSRF invariants hold**: httpOnly cookie auth only, no token in
  `localStorage`/`Authorization` header anywhere; CSRF double-submit correct on
  both the global client and the module factory; a single shared
  `performSharedRefresh()` promise is reused by the global client **and** every
  `createApiClient()` module instance, preventing a concurrent-refresh
  replay-detection race across instances; 401 handling is one-shot
  (`_retry` guard) and excludes auth endpoints, so it cannot loop.
- **`clearCache()` (FE-1/FE-5, module-audit) still holds** — called
  unconditionally inside `handleExpiredSession()`, which runs on every refresh
  failure regardless of the onboarding branch.
- **Cache size is bounded** (`MAX_CACHE_ENTRIES = 200`, FIFO eviction) —
  no Pitfall #9 unbounded-growth issue.
- **`toAppError` (FE-1, app-review)** still correctly handles string/array/object
  `detail` shapes; `errorHandling.ts` deliberately omits `Error.stack` to avoid
  leaking file paths/PHI.
- **All 11 modules using `createApiClient()` do so correctly** — right base
  path, no bypass, no hand-rolled `Authorization` header, no hardcoded secrets.
  The one module not using the factory (`ip-security`) imports the **global**
  `api` instance directly instead — not a gap, it gets the fuller global client
  (503 retry, post-login grace period) that the lighter factory doesn't have.
- **`ProtectedRoute.tsx`** gates strictly pre-render (no flash of unauthorized
  content), correctly distinguishes "not authenticated" (→ `/login`) from
  "authenticated but lacks permission" (→ in-place Access Denied page), and
  handles the loading/pending-session state without a false-negative redirect.
- **`skillsTestingStore.ts`** (PHI-adjacent scores/evaluator notes) has no
  `persist` middleware, no direct storage writes, and no `console.*` logging —
  purely in-memory Zustand state, correctly excluded from the API cache via the
  existing `/training/skills-testing/tests` prefix.
- **`learningProgressStore.ts`** namespaces its localStorage key per user
  (`storageKey(userId)`) and deliberately does not migrate the old unnamespaced
  key, to avoid cross-user attribution — correct by design.
- **FE-6 (module-audit, MEDIUM, previously flagged) is resolved**, not just
  flagged — see Finding 9 below for the verification detail.

## Findings

### FE2-34-1 — HIGH — `/training/cohorts/{id}` roster (name + email) was cacheable — ✅ FIXED

`trainingServices.ts` calls `GET /training/cohorts/{id}` on the global cached
`api` instance. The backend response (`CourseCohortDetailResponse`) embeds
`members: List[CourseCohortMemberResponse]`, and each member row resolves
`full_name` + `email` (plus `status`/`notes`/`withdrawn_at`) — a real roster
with names, not UUIDs. `UNCACHEABLE_PREFIXES` had no `/training/cohorts` entry
at all, so this sat in the in-memory SWR cache for up to 90s on every
training-coordinator page load — the same HIPAA §164.312 exclusion-list gap
class already fixed twice before (module-audit FE-2/FE-3, app-review FE-2).

**Fix:** added `'/training/cohorts/'` (trailing slash) to
`UNCACHEABLE_PREFIXES`. Verified the bare list (`GET /training/cohorts`,
`CourseCohortResponse`) and `/training/cohorts/mine` (also
`CourseCohortResponse`) carry no `members` field, so only the trailing slash is
needed — the roster-free list stays cacheable.

### FE2-34-2 — HIGH — `/training/programs/programs/{id}/eligibility` full roster + reason was cacheable — ✅ FIXED

Same shape as #1. The backend endpoint (`training.manage`-gated) explicitly
documents itself as listing "every member with whether they can be enrolled" —
`MemberEligibilityResponse` returns `first_name`/`last_name`/
`membership_number`/`eligible`/`status`/`reason` per member. Functionally
identical in sensitivity to `/training/compliance-matrix` and
`/training/requirements/progress/`, both already excluded — this one was not.
Checked for `/eligibility` substring collisions first: the only other
occurrences (`/elections/{id}/eligibility`,
`/elections/{id}/eligibility-roster`, `/scheduling/eligibility/*`) are either
already covered by their own prefix (`/elections`) or never reach the cache at
all (the scheduling module uses its own `createApiClient()` instance, which has
no caching logic whatsoever).

**Fix:** added `'/training/programs/programs/'` (trailing slash) to
`UNCACHEABLE_PREFIXES`. The bare catalog list (`GET /training/programs/programs`)
carries no member data and stays cacheable.

### FE2-34-3 — MEDIUM-HIGH — `/training/external/providers/{id}/user-mappings` internal name + email was cacheable — ✅ FIXED

Same shape again. `ExternalUserMappingResponse` includes `internal_user_name`
and `internal_user_email` per mapped member; no `/training/external/` entry
existed in either exclusion list.

**Fix:** added `'/training/external/providers/'` (trailing slash) to
`UNCACHEABLE_PREFIXES`. The bare provider-config list stays cacheable.

### FE2-34-4 — MEDIUM — `/forms` bare list escaped the cache exclusion (trailing-slash prefix bug, live recurrence of FE-2) — ✅ FIXED

`formsServices.ts` calls `GET /forms` (bare, no trailing slash) on the global
cached instance. `UNCACHEABLE_PREFIXES` had `'/forms/'` **with** a trailing
slash, so `'/forms'.startsWith('/forms/')` is `false` — the exact bug class
fixed for six other endpoints in the 2026-08-08 pass (FE-2), missed here. The
backend list response (`FormDef[]`) includes `notification_emails` (admin
recipient addresses) and `created_by`. Lower sensitivity than findings 1-3, but
a live, confirmed instance of a documented recurring bug pattern.

**Fix:** dropped the trailing slash (`'/forms'`), matching the six precedent
entries' comment style. Checked for collisions (`/forms/summary`,
`/forms/member-lookup`) — both still correctly excluded, no accidental miss.

### FE2-34-5 — LOW / defense-in-depth — `/grants` had the same trailing-slash shape (currently inert) — ✅ FIXED

Same trailing-slash bug as #4, but not currently exploitable: the
grants-fundraising module calls `GET /grants` through its own
`createApiClient()` instance, which has no caching logic at all — confirmed by
reading `createApiClient.ts` in full (no `isCacheable`/`setCache`/`getCached`
calls anywhere in it). Fixed anyway as defense-in-depth, since a future
"simplification" that switches this module to the global cached instance
(exactly how findings 1-4 came to exist) would silently reintroduce a live
donor-PII leak with no exclusion-list signal.

**Fix:** dropped the trailing slash (`'/grants'`). Checked all `/grants/*`
call sites in the module — no collision with an unrelated feature.

### FE2-34-6 — LOW / defense-in-depth — `/analytics/export` (raw per-user events) had no exclusion — ✅ FIXED

`adminServices.ts` calls `GET /analytics/export` on the global cached instance.
The backend endpoint returns up to 1,000 raw analytics events, each carrying a
`user_id` UUID, `device_type`, and free-form `metadata`. Lower confidence than
findings 1-3 (UUID rather than a resolved name), but the free-form `metadata`
field's contents aren't bounded by a fixed schema, and this app's established
posture (`/errors` is excluded for the same "may contain user context"
reasoning) treats that kind of uncertainty as excludable by default.

**Fix:** added `'/analytics/export'` to `UNCACHEABLE_PREFIXES`.
`/analytics/metrics` (aggregate, no per-user rows) is unaffected and stays
cacheable.

### FE2-34-7 — LOW — CSRF cookie decoding inconsistency between `authStore.ts` and `apiClient.ts` (FE-7, module-audit) — ✅ FIXED

`authStore.getCsrfCookie` read the `csrf_token` cookie without
`decodeURIComponent`, while `apiClient.getCookie` does decode it — flagged as a
LOW risk in the original module audit and left unfixed across four subsequent
app-review passes. Re-verified: still present, and traced all three call sites
of `authStore`'s version (internal before/after comparisons in
`waitForLoginCookies`, never used to build the `X-CSRF-Token` header — only
`apiClient.ts`'s decoded version feeds that). Currently inert: the backend
generates the cookie via `secrets.token_urlsafe(32)`, whose alphabet contains
no percent-encodable characters. Still a real latent risk for a future token
format change or a future consumer of this function.

**Fix:** aligned `authStore.getCsrfCookie` to `apiClient.getCookie`'s
implementation (`decodeURIComponent` on the captured group).
`decodeURIComponent` is idempotent on already-plain input, so this changes
nothing for the current token alphabet. Not independently unit-tested (the
function is module-private and the gap is currently inert); the existing
`authStore.test.ts` CSRF-cookie tests continue to pass unchanged, confirming no
regression.

### FE2-34-8 — LOW — `scheduling/services/api.ts`'s `getMyAttendance` silently swallowed all errors, not just "not found" — ✅ FIXED

```ts
async getMyAttendance(shiftId: string): Promise<ShiftAttendanceRecord | null> {
  try {
    const response = await api.get<ShiftAttendanceRecord>(...);
    return response.data;
  } catch {
    return null; // any error — network failure, 500, 403 — becomes "not checked in"
  }
},
```

A transient 500, a network failure, or a permission error was silently
converted to the same `null` result as "not checked in yet," masking an
operational/backend failure as a normal empty state. The sibling
`prospective-members/services/api.ts`'s `getElectionPackage` already handles
this correctly (catches, checks `AxiosError` + `status === 404` specifically,
re-throws everything else).

**Fix:** mirrored that pattern — only swallow a confirmed 404, rethrow
anything else. Also removed a dead, duplicate `declare module 'axios' {
InternalAxiosRequestConfig._retry }` block in the same file (the real one lives
in `createApiClient.ts`; this file has no `_retry` reference of its own —
confirmed via grep before removing).

### FE2-34-9 — Re-verification — FE-6 (module-audit MEDIUM): PII drafts/offline queue surviving logout — CONFIRMED ALREADY RESOLVED

The module audit flagged `shiftReportDrafts.ts` (localStorage) and
`offlineQueue.ts` (IndexedDB, incl. photo blobs) as not purged on idle-logout,
leaving prior members' evaluations readable via DevTools on a shared kiosk.
Traced the current code: `authStore.logout()` now calls
`purgeLocalMemberData()` (`utils/purgeLocalMemberData.ts`), which purges both
the draft localStorage keys and all three IndexedDB queues
(`offlineQueue.ts`/`shiftReportOfflineQueue.ts`/`genericOfflineQueue.ts`), each
bounded by a 3s timeout so a pathological IndexedDB can't stall logout.
`useIdleTimer.ts`'s `performLogout` calls the same `authStore.logout()`, so the
idle-timeout path — the one FE-6 specifically named — goes through the same
purge today. `authStore.loadUser()`'s session-expired catch branch also calls
it, covering "session died without an explicit logout" too. The purge reports
an `unsyncedDiscarded` count back to `authStore.lastLogoutPurge` so the login
screen can surface that member work was dropped, rather than silently losing
it. No code change needed; documented here so this doesn't get re-flagged as
open in a future pass.

## Not fixed — considered, judged correctly scoped

- **`/training/skills-testing/candidates`** (member-name picker) is cacheable
  and not in the exclusion list. The backend schema
  (`SkillTestCandidateResponse`) is explicitly documented as "deliberately just
  an id and a display name... carries none of the contact information," and
  every member can already call the endpoint regardless of caching. This is a
  documented, intentional low-sensitivity design on the backend side, not an
  oversight — left as-is rather than over-excluded.

## Documentation corrections

- `docs/app-review/frontend-shared.md` pass-2 note claiming the
  `createApiClient.ts` 401 handler lacks the global handler's `/onboarding`
  guard and `clearCache()` does not describe the current code —
  `createApiClient.ts` imports and calls the exact same `handleExpiredSession`
  function `apiClient.ts` uses. Corrected in place with a dated note rather
  than silently deleted, per this rotation's convention for stale prior
  findings.

## Guard tests added

- `apiCache.test.ts`: extended the existing FE-2 bare-list-escape regression
  test with `/forms`/`/grants` (findings 4, 5); added
  `TestTrainingCohortProgramProviderPaths`-equivalent case covering the three
  new training exclusions and their still-cacheable parent lists (findings
  1-3); added a case for `/analytics/export` vs. `/analytics/metrics`
  (finding 6).
- No new test for finding 7 (module-private function, currently-inert gap;
  existing CSRF-cookie tests re-confirmed passing).
- No new test for finding 8: this module's `services/api.ts` has no existing
  direct unit-test file (true of all 12 module axios files in this codebase —
  confirmed during Agent B's review), and the one file that does exercise
  `getMyAttendance` indirectly (`ShiftDetailPanel.test.tsx`) mocks the whole
  service module, so it exercises call-site behavior, not this fix — re-ran it
  to confirm no regression.

## Completion gate

| Check                                                  | Result                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run typecheck` (`tsc-native.mjs`)                 | ✅ 0 errors                                                                              |
| `npm run lint`                                         | ✅ 0 errors, 10 warnings (pre-existing, unrelated files, within the max-warnings budget) |
| `npm run build`                                        | ✅ succeeds (pre-existing chunk-size/dynamic-import notices, unrelated)                  |
| Scoped tests (`apiCache.test.ts`, `authStore.test.ts`) | ✅ 116 passed                                                                            |
| `modules/scheduling` + `ShiftDetailPanel.test.tsx`     | ✅ 218 passed (18 files)                                                                 |
| Full frontend suite (`vitest run`)                     | ✅ 5242 passed (397 files), 0 failed                                                     |
| Backend                                                | n/a — no backend files changed this iteration                                            |
