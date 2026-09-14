# Security Review — Feature 34: Frontend Shared (pass 6)

**Prefix:** `FE6` · **Iteration:** 34 · **Reviewed:** 2026-09-14

**Frontend:** `utils/apiCache.ts` (+ `apiCache.test.ts`), `services/apiClient.ts`,
`utils/createApiClient.ts`, `utils/errorHandling.ts`, `services/errorTracking.ts`
(+ `services/errorReporting.ts`), `services/api.ts` (global barrel),
all 13 `modules/*/services/api.ts` files, the three second per-module clients
(`modules/inventory/services/equipmentCheckApi.ts`,
`modules/scheduling/services/shiftSettingsApi.ts`,
`modules/public-portal/services/publicPortalApi.ts` — the last two not named
in any prior pass's file list), `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ `purgeLocalMemberData.ts`, the three offline queues),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `components/ux/*`, plus a repo-wide sweep for
new `api.get(`/`api.get<` call sites, `localStorage.setItem`/
`sessionStorage.setItem` call sites, and hardcoded secret/token literals.
**Backend:** read-only cross-reference — `backend/app/api/v1/endpoints/inventory.py`'s
`list_item_colors` (FE5-34-1's permission fix), `backend/app/api/v1/endpoints/auth.py`'s
`logout` (FE3-34-2), and `backend/tests/test_api_cache_pii_exclusions.py` (the
ratchet guarding `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` from the
backend side).
**Migrations:** none.

**0 new findings.** Both previously-flagged HIGH items (FE3-34-2, FE3-34-5)
re-verified still open and unchanged — neither is this pass's to fix, per
their own dispositions. FE5-34-1's fix (cache exclusion + permission
tightening on `GET /inventory/items/colors`) re-verified present. No
regression found in any file this feature owns.

---

## Why this pass is mostly re-verification

Feature 34's core files (`apiClient.ts`, `createApiClient.ts`,
`errorHandling.ts`, `errorTracking.ts`, `ProtectedRoute.tsx`, `authStore.ts`,
the three offline queues, `purgeLocalMemberData.ts`, and 10 of the 13 module
`api.ts` files) are **byte-identical** to `f53258ee7` — the merge commit that
landed pass 5's PR (#2382) — confirmed by an empty `git diff f53258ee7..HEAD`
per file, not assumed from a prior pass's claim. 502 commits landed on `main`
between that merge and this pass's branch point, none of which touched this
feature's stable core.

## Method

1. **Established the baseline**: `f53258ee7` (PR #2382's merge — `git log
--oneline --all --grep="2382"` confirms it, and `git show --stat` on it
   matches `FE5-34-frontend-shared.md`'s own described diff exactly).
2. **Confirmed a security-review PR was not already open** for this feature
   (`docs/security-review/PROGRESS.md`'s Open PR row said "None", row 34 was
   `⬜`) before branching, per the rotation's "one PR at a time" rule.
3. **Re-ran `git diff --stat f53258ee7..HEAD`** across every file this feature
   owns. 11 files differ — far fewer than pass 5's 8-plus-6, and all of it
   either (a) other features' own rotation passes touching the shared
   `apiCache.ts`/`apiCache.test.ts` (apparatus/inventory PII exclusions,
   training multi-agency/external-providers exclusions — see below), or
   (b) unrelated, already-reviewed-elsewhere feature work with no security
   dimension (accessibility contrast fixes in `components/ux/*`, a defensive
   array-validation fix in `scheduling/services/api.ts`, a new
   `assignStage` method in `prospective-members/services/api.ts`, a dead
   export removed from `reports/services/api.ts`).
4. **Enumerated every axios-instance-creating file** fresh
   (`grep -rn "axios.create(" frontend/src`), not merely the file list a
   prior pass recorded: only two call sites exist in the whole frontend —
   `services/apiClient.ts` (the global instance) and
   `utils/createApiClient.ts` (the shared module factory). Confirmed every
   one of the 13 `modules/*/services/api.ts` files, plus the three
   "second client" files, imports one of the two — none rolls its own
   `axios.create()`. Two module files (`ip-security`, `testing`) import the
   _global_ instance directly (`import api from '../../../services/apiClient'`)
   rather than `createApiClient()`; both documented as deliberate in their
   own file headers, and both inherit the global instance's `withCredentials`
   - CSRF + refresh setup by construction.
5. **Newly identified and read in full**: `modules/scheduling/services/shiftSettingsApi.ts`
   and `modules/public-portal/services/publicPortalApi.ts` — two "second
   per-module client" files (like `equipmentCheckApi.ts`, which pass 3
   first called out) that no prior FE pass's file list named. Both predate
   `f53258ee7` unchanged (confirmed via empty diff and `git log
--diff-filter=A`), so they were in scope for earlier passes' "whole
   frontend" sweeps even though not individually listed; read fresh here
   regardless. Both call `createApiClient()` correctly
   (`shiftSettingsApi.ts:24`, `publicPortalApi.ts:22` — the latter with a
   custom base URL, `'/api/v1/public-portal'`, which `createApiClient`
   supports directly). `publicPortalApi.ts` manages API-key
   creation/revocation and access-log/whitelist reads for the public-facing
   portal integration; no caching (goes through `createApiClient`, which has
   none), no secret ever written to browser storage, no XSS sink.
6. **Repo-wide sweep, not scoped to this feature's files**, for:
   - `localStorage.setItem(` / `sessionStorage.setItem(` — every hit is a UI
     preference (theme, nav layout, dismissed banners, draft autosave,
     client-side login lockout counters) or the documented `has_session`
     flag / `device_member_id` device-claim marker. The onboarding module's
     `sessionStorage`-scoped session id + CSRF token
     (`modules/onboarding/services/api-client.ts`) is a distinct,
     already-reviewed system (Feature 30, Onboarding — a pre-account bearer
     identifier for the unauthenticated setup wizard, not the authenticated
     app session), out of this feature's scope. No JWT, access token, or
     refresh token found in either storage anywhere in the frontend.
   - Hardcoded API keys/secrets/tokens (`grep -rniE` for
     `api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key` followed
     by a quoted 16+ char literal) — one hit, `e2e/auth.spec.ts`'s
     `'mock-access-token-for-testing'`, a Playwright test fixture. No
     production secret.
   - New `api.get(`/`api.get<` call sites since `f53258ee7` across the whole
     frontend (not just feature-owned files) — two found, both benign (see
     below).
7. **Re-verified both open HIGH findings** against current code rather than
   trusting their last-recorded line numbers (see below).
8. **Ran the backend PII-cache ratchet** (`test_api_cache_pii_exclusions.py`)
   fresh — ratchets `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` from the
   backend side by resolving every GET route's response schema; it is the
   guard the entries below rely on, so its own pass/fail is part of this
   pass's verification rather than assumed from pass 5's writeup.

## The diff other features left in `apiCache.ts` / `apiCache.test.ts`

`UNCACHEABLE_PREFIXES` gained `/apparatus/operators`,
`/apparatus/driver-exceptions`, `/apparatus/evoc-check/`,
`/inventory/reorder-requests`, `/operational-ranks/validate`,
`/training/instructors/validate/`, `/inventory/allowances/check/`,
`/inventory/clearances`, `/inventory/requests`, `/inventory/return-requests`,
`/inventory/write-offs`; `/training/external/providers` lost its trailing
slash (now also excludes the bare list, which can carry an integration auth
token in `config.additional_headers`); `/training/multi-agency` was added.
`UNCACHEABLE_SUBSTRINGS` gained `/issuances`, `/exposures`, `/users`,
`/history`. All of this landed via `ae423afa3` ("Fix two data-leakage
findings: separation reports, response cache", 2026-09-07) — an ad hoc
second-pass review distinct from this rotation, not a prior iteration of
Feature 34 itself — plus the training-extended rotation's own TRX4 pass
(`/training/multi-agency`, `/training/external/providers` widening, both
covered by `apiCache.test.ex` cases added in the same commits).

**Not left untested.** My first pass over this diff found no
`apiCache.test.ts` case for the apparatus/inventory/operational-ranks
entries and read that as a gap — it is not. `ae423afa3`'s own commit message
names the actual guard: `backend/tests/test_api_cache_pii_exclusions.py`, an
AST-based ratchet that resolves every GET route's Pydantic response schema
to its transitive field set and fails on a new member-PII field that isn't
excluded (`PII_FIELDS`), plus a `PINNED_EXCLUSIONS` map for the routes a
schema scan structurally cannot see (no `response_model`, or a field name
the scan's narrow marker set doesn't recognize). It is a backend test
verifying a frontend TypeScript constant array by parsing the file directly
(`_ts_list()`), which is why a frontend-side `apiCache.test.ts` case for
each entry would be redundant rather than missing. Ran it fresh:

```
$ cd backend && python3 -m pytest tests/test_api_cache_pii_exclusions.py -q
....
4 passed in 4.56s
```

All four tests pass: no new cached PII route, no stale baseline entry, all
nine pinned exclusions (including `/apparatus/evoc-check/{apparatus_id}/{user_id}`
and `/inventory/clearances`, both added in the diff above) still excluded,
and every pinned route still exists under some v1 router. This is a real,
mechanical guard against exactly the regression class this feature exists to
prevent — confirmed by reading the test file in full, not merely trusting
its docstring.

## New `api.get` call sites since `f53258ee7` (repo-wide, not just feature-owned files)

| File                             | New call                                                                                              | Disposition                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/facilitiesServices.ts` | `GET /operational-ranks` (new `getRankLadder`, alongside the pre-existing `getRanks` at the same URL) | Same shape as the already-cacheable, already-reviewed `getRanks` — rank definitions (code, name, sort order, eligible positions), no per-member data. `/operational-ranks` bare prefix is not in `UNCACHEABLE_PREFIXES` (only `/operational-ranks/validate` is, correctly — that sub-route resolves `member_name` per rank being validated). No gap: a second accessor for an already-safe URL. |
| `services/adminServices.ts`      | `GET /organization` branding response widened with an optional `navigation_layout` field              | Not a new URL — `/organization/` is already a full `UNCACHEABLE_PREFIXES` entry ("org settings including auth config, API keys"). A field-shape widening on an already-excluded route. No gap.                                                                                                                                                                                                  |

No other new `api.get` call site appeared in the diff window. (Module-scoped
new calls — `assignStage` in `prospective-members/services/api.ts`,
`getMyHoursHistory`/`getShiftsNeedingCloseout`/etc. from pass 5's own
sweep — go through `createApiClient()`, which never caches regardless of the
exclusion list, so they are not repeated here; pass 5 already covers the
mechanism.)

## Re-verification of the two open HIGH findings

### FE3-34-2 — a failed client-side logout leaves session cookies live — still OPEN

Unchanged since pass 4. `authStore.ts:433-479`'s `logout()` still wraps
`await authService.logout()` in a `catch` that only comments "cookies are
cleared by the backend" and proceeds unconditionally
(`stores/authStore.ts:440`, confirmed at the current line). Backend
`POST /auth/logout` (`backend/app/api/v1/endpoints/auth.py:1349-1384`, one
line off from FE4's `:1334-1372` citation — churn elsewhere in the file, same
logic) still calls `_clear_auth_cookies()` (`:1386`) only after
`auth_service.logout_user(token)` returns `True` (`:1377`); a missing token
or `logout_user()`'s own `except Exception: return False` still raises a 400
with the httpOnly cookies untouched. Same failure scenario, same reason it
remains a product decision rather than a drive-by patch (automatic retry
policy, or an explicit failure UI, needs an owner call). Unchanged in
`docs/KNOWN_LIMITATIONS.md`; not re-fixed here.

### FE3-34-5 — an offline queue item can sync under the next member's identity if the sign-in purge silently fails — still OPEN

Unchanged since pass 4. `purgeLocalMemberData.ts` (0 diff lines against
`f53258ee7`) still resolves every IndexedDB `clear()` on both `onsuccess`
and `onerror`, and `bounded()` still returns a fallback zero on a timeout —
by design, so a purge failure can never block sign-in. `claimDeviceForMember`
(`authStore.ts:180-198`, unchanged) still `await`s the purge before
`isAuthenticated` is set, closing the _timing_ race, but a purge that
silently no-ops still lets a new member authenticate while the previous
member's queue entries remain untagged. Same remediation options as pass 4
(gate authentication on confirmed deletion — reintroduces the "stuck signed
in" risk the purge was built to avoid — or tag queue entries with a
validated owner checked at sync time), same reason this needs a product
decision. Unchanged in `docs/KNOWN_LIMITATIONS.md`; not re-fixed here.

## Re-verification of FE5-34-1

`GET /inventory/items/colors` still carries the cache exclusion
(`frontend/src/utils/apiCache.ts:102-104`) and the tightened permission gate
(`require_permission("inventory.view")`, `backend/app/api/v1/endpoints/inventory.py:745`,
confirmed by reading the route fresh, not diffed — this pass's baseline
already includes it). `backend/tests/test_inventory_member_visibility.py`'s
`test_item_colors_requires_inventory_view` still exists and — as part of the
full inventory-scoped backend suite below — still passes. Codex's broader,
deliberately-not-fixed ask (excluding `GET /inventory/items` list/detail from
caching entirely) remains correctly flagged in `KNOWN_LIMITATIONS.md`,
unchanged; not re-litigated here.

## `components/ux/*` diff since `f53258ee7`

`Collapsible.tsx`, `ConfirmDialog.tsx`, `EmptyState.tsx`, `ProgressSteps.tsx`,
`PromptDialog.tsx`, `breadcrumbRoutes.ts` differ. All accessibility/contrast
work (an ARIA landmark label, a configurable heading level for screen-reader
outline correctness, three AAA-contrast button-color bumps) with no security
dimension, **except** `breadcrumbRoutes.ts`, read in full:

- Six routes (`/medical-supplies`, `/members/admin/settings` and four of its
  children) switched from hardcoded permission-string literals to imported
  constants (`MEDICAL_VIEW_PERMISSIONS`, `MEMBERS_SETTINGS_*_GATE`) sourced
  from the same modules that define the actual route guards
  (`modules/medical-supplies/routes.ts`, `modules/membership/routes.ts`).
  This is a strict improvement, not a new risk: a hardcoded literal here can
  silently drift from the real `<ProtectedRoute requiredPermission=...>` gate
  it is supposed to mirror (the exact failure mode `breadcrumbRoutes.test.ts`
  exists to catch), while an imported constant cannot drift without a
  compile error if the source constant is renamed or removed.
- `breadcrumbRoutes.ts` is documented (and confirmed by its own code) as a
  fail-closed _display_ mirror, not an access-control boundary of its own —
  `canLinkCrumb` renders inert text via a `DENY_ALL` fallback whenever
  `checkPermission` is unavailable or the path/permission pair doesn't match.
  The actual gate is still each route's own `<ProtectedRoute>` /
  `require_permission` pair. No finding.

## Verified good ✅ (re-confirmed against the correct current baseline)

- `services/apiClient.ts`, `utils/createApiClient.ts`, `utils/errorHandling.ts`,
  `services/errorTracking.ts`, `components/ProtectedRoute.tsx`,
  `stores/authStore.ts`, `stores/learningProgressStore.ts`,
  `stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
  `utils/purgeLocalMemberData.ts`, `utils/genericOfflineQueue.ts`,
  `utils/offlineQueue.ts`, `utils/shiftReportOfflineQueue.ts`,
  `modules/inventory/services/equipmentCheckApi.ts`, and 10 of the 13 module
  `api.ts` files — confirmed byte-identical to `f53258ee7` (empty `git diff`
  for each), not re-asserted from a prior pass's claim.
- **Every axios-instance-creating file in the frontend** (verified by
  grepping for `axios.create(` repo-wide, not sampling) either sets
  `withCredentials: true` with the CSRF/refresh interceptor pair directly
  (`apiClient.ts`, `createApiClient.ts`) or imports one of those two — no
  module has ever rolled its own bare `axios.create()`. Pitfall #7 holds
  across all 16 client-creating files (13 module `services/api.ts` +
  `equipmentCheckApi.ts` + `shiftSettingsApi.ts` + `publicPortalApi.ts`).
- **The shared `refreshPromise`** (`apiClient.ts:168`, module-level, used by
  both the global instance and every `createApiClient()` instance via
  `performSharedRefresh`) still prevents concurrent refreshes: two 401s
  arriving together both await the same in-flight promise rather than each
  issuing its own `/auth/refresh`, and the promise resets in a `.finally()`
  so a subsequent expiry can still trigger a fresh refresh. No request path
  is left permanently unretried — every caller either gets the shared
  refresh's result or, on its rejection, is routed through
  `handleExpiredSession()`.
- **CSRF header/cookie naming is identical** across both axios factories:
  `X-CSRF-Token` read from the `csrf_token` cookie, in both
  `apiClient.ts:145-147` and `createApiClient.ts:53-56`.
- **`ProtectedRoute.tsx`'s guard order** (read fresh, not merely diffed):
  every early return — loading spinner, stored-token-but-not-yet-loaded
  spinner, unauthenticated redirect, forced password-change redirect, forced
  MFA-enrollment redirect, permission/role denial — precedes the final
  `return <>{children}</>`, so there is no code path that renders protected
  content before every gate has resolved. `ModuleGate` (the module-enablement
  check) is explicitly documented as a usability gate layered _after_ the
  real permission checks, not a substitute for them.
- No new `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` in any
  file this pass read.
- No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage` anywhere in the frontend; the only persisted auth-adjacent
  values are the documented `has_session` flag, the `device_member_id`
  device-claim marker, and (out of this feature's scope) the onboarding
  module's own pre-account session/CSRF pair.
- No hardcoded production secret, API key, or token literal anywhere in
  frontend source.

## Not fixed — considered, judged correctly scoped

- **FE3-34-2** (HIGH) — unchanged, still needs a product decision (retry
  policy vs. explicit failure UI on a failed logout).
- **FE3-34-5** (HIGH) — unchanged, still needs a product/architecture
  decision (gate auth on confirmed purge vs. tag queue entries with a
  validated owner).
- **FE5-34-1's broader ask** (excluding the whole `/inventory/items` catalog
  from caching) — unchanged, still a product trade-off per Codex's original
  review, recorded in `KNOWN_LIMITATIONS.md`.

None of the three needed re-flagging as new; all three are re-confirmed at
their existing `KNOWN_LIMITATIONS.md` entries, which needed no edits this
pass.

## Documentation corrections

None needed. `docs/KNOWN_LIMITATIONS.md`'s three FE entries (FE3-34-2,
FE3-34-5, FE5-34-1) were re-read in full and are still accurate against
current code — no line-number drift beyond FE3-34-2's one-line auth.py shift
(noted above, not worth a doc edit given how narrow it is and that the doc
already states the location "moved... otherwise unchanged" pattern from
pass 4 forward).

## Completion gate

| Check                                                                                                                                                                                                 | Result                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `npm run typecheck` (`tsc-native.mjs`, aliased 7.0.2 compiler)                                                                                                                                        | ✅ 0 errors                           |
| `npm run lint` (`eslint --max-warnings 10`, whole frontend)                                                                                                                                           | ✅ 0 errors, 0 warnings, exit 0       |
| Scoped suite (`apiCache`, `apiClient`, `authStore`, `createApiClient`, `learningProgressStore`, `pendingSyncStore`, `skillsTestingStore`, `ProtectedRoute.module`, `breadcrumbRoutes`, `Breadcrumbs`) | ✅ 372 passed (10 files)              |
| Full frontend suite (`npm test -- --run`)                                                                                                                                                             | ✅ 7,576 passed (532 files, 0 failed) |
| Backend `pytest tests/test_api_cache_pii_exclusions.py`                                                                                                                                               | ✅ 4 passed                           |
| Backend `pytest tests/test_inventory_member_visibility.py`                                                                                                                                            | ✅ 15 passed                          |

No code changes were made this pass (0 findings requiring a fix), so no
backend `flake8`/`black`/`isort` run was needed — no backend file was
modified.

## Guard tests added

None. No new finding required a fix, so no new guard test — the existing
ratchets (`apiCache.test.ts`, `test_api_cache_pii_exclusions.py`,
`authStore.test.ts`'s FE3-34-5 device-claim cases,
`apiClient.test.ts`'s FE3-34-4 cache-token cases,
`test_inventory_member_visibility.py`'s FE5-34-1 permission case) already
cover every fixed finding from prior passes and were re-run, not
re-written.

## Next

Rotation row 34 → `✅` (pending this PR's merge). This is the last row in
the 00–34 table; per `PROGRESS.md`'s own preamble, the rotation now wraps
back to 00 for its next full pass, re-verifying nothing has regressed across
the whole application. No product decision from this pass needs mirroring
into `KNOWN_LIMITATIONS.md` beyond what is already recorded there.
