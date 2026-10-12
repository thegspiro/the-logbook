# Security Review — Feature 34: Frontend Shared (pass 8)

**Prefix:** `FE8` · **Iteration:** 34 · **Reviewed:** 2026-10-11 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts` (+ `apiCache.test.ts`), `services/apiClient.ts`,
`utils/createApiClient.ts`, `utils/errorHandling.ts`, `services/errorTracking.ts`
(+ `services/errorReporting.ts`), `services/api.ts` (global barrel),
all 13 `modules/*/services/api.ts` files, the four second per-module clients
(`modules/inventory/services/equipmentCheckApi.ts`,
`modules/scheduling/services/shiftSettingsApi.ts`,
`modules/public-portal/services/publicPortalApi.ts`, and the new
`modules/scheduling/services/historyImportApi.ts`),
`components/ProtectedRoute.tsx`, `stores/authStore.ts` (+
`utils/purgeLocalMemberData.ts`, `utils/offlineQueueOwner.ts` (new),
`utils/offlineQueueQuarantine.ts` (new), the four offline queues — the three
pre-existing plus the new `utils/skillsTestOffline.ts`),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `components/SignOutUnconfirmedNotice.tsx` (new),
`components/HeldOfflineItemsNotice.tsx` (new), plus a repo-wide sweep for new
`api.get(`/`api.get<` call sites, new `axios.create(`/`createApiClient(` call
sites, `localStorage.setItem`/`sessionStorage.setItem` call sites, hardcoded
secret/token literals, and XSS sinks.
**Backend:** read-only cross-reference — `backend/app/api/v1/endpoints/auth.py`'s
`refresh_token` (new `RefreshTokenSuperseded`/409 handling, cross-checked
against the frontend's `isRefreshSuperseded`), `backend/app/api/v1/endpoints/
skill_evaluations.py` (new cache-exclusion finding, below),
`backend/app/api/v1/endpoints/mcp_oauth.py` (new cache-exclusion finding,
below), `backend/app/api/v1/endpoints/inventory.py`'s `list_item_colors`
(FE5-34-1), `backend/tests/test_api_cache_pii_exclusions.py` /
`test_inventory_member_visibility.py` (the two backend-side ratchets this
feature's frontend exclusions depend on).
**Migrations:** none written or reviewed as in-scope (571 revisions, single
head, confirmed via `validate_migrations.py --strict` — unrelated to this
feature).

**2 fixes, 0 new OPEN/FLAGGED findings.** Both of pass 7's standing HIGH
findings (FE3-34-2, FE3-34-5) were independently re-verified and are **now
fixed on `main`** — by other, non-security-review work that landed between
pass 7 and this pass, not by this pass itself. This pass's own two fixes are
two new cache-exclusion gaps found by a fresh repo-wide sweep.

---

## Method

1. **Established the baseline**: `532340e3` (the merge that landed
   `FE7-34-frontend-shared.md`, confirmed via `git log --diff-filter=A`).
2. **Independently re-confirmed Step 0** before starting: `search_pull_requests`
   (open, `head:claude/security-review-`) returned zero results. The last
   security-review PR, #3084 (Feature 33, Core infrastructure, pass 6), had
   already merged — confirmed via `pull_request_read` (`merged: true`,
   2 files changed, docs-only) — so there was nothing to record beyond
   clearing the `PROGRESS.md` Open PR row, per that row's own rule.
3. **Diffed every feature-owned file** against the baseline
   (`git diff --stat 532340e3..HEAD -- <each file>`), rather than assuming
   pass 7's "byte-identical" list still held. It did not: a substantial,
   already-landed fix (commit `b574c324`, 2026-10-05, titled
   "fix(offline): send queued items only under the member who queued them,"
   explicitly "Closes FE3-34-5") touched `authStore.ts`, `pendingSyncStore.ts`,
   `genericOfflineQueue.ts`, `offlineQueue.ts`, `shiftReportOfflineQueue.ts`,
   and added `offlineQueueOwner.ts` / `offlineQueueQuarantine.ts` /
   `HeldOfflineItemsNotice.tsx`. A second, separately-dated change (code
   inspection places it after `b574c324`; its own commit message is lost to
   the same grafted/squashed-commit history artifact `CI6-33-core-infra.md`
   documented for a different file) added the `confirmServerSignOut` /
   `SignOutUnconfirmedNotice` mechanism that closes FE3-34-2. Neither fix's
   commit is attributable through `git log` with confidence — the repository
   has a known history-graft problem — so this file cites the code's current
   state, re-derived directly, rather than trusting a commit message.
4. **Read every line of the diff** for all 25 changed feature-owned files
   (2,133 insertions / 110 deletions total — see the completion-gate section's
   file list), applying `CHECKLIST.md`'s seven dimensions.
5. **Enumerated every axios-instance-creating file fresh**
   (`grep -rn "axios.create(" frontend/src`): still exactly two —
   `services/apiClient.ts` and `utils/createApiClient.ts`. Enumerated every
   `createApiClient(` caller fresh: the same 13 module files, plus **four**
   second-client files now (the new `historyImportApi.ts` joins the three from
   pass 7) — no bespoke axios instance anywhere.
6. **Ran a repo-wide diff sweep** for new `api.get(`/`api.get<` call sites
   since `532340e3`, across the whole frontend (not just feature-owned files)
   — every hit checked against `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`
   or confirmed to go through a non-caching `createApiClient()` instance. This
   is where FE8-34-1 and FE8-34-2 (below) were found.
7. **Ran a repo-wide sweep** for `localStorage.setItem(`/`sessionStorage.
setItem(`, for hardcoded API-key/secret/token literals, and for new XSS
   sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`)
   since `532340e3` — no new PII, secret storage, or sink found (see below).
8. **Re-verified FE3-34-2, FE3-34-5, and FE5-34-1's flagged ask** against
   current code, at current line numbers.
9. **Ran the two backend ratchets** this feature's frontend exclusions depend
   on (`test_api_cache_pii_exclusions.py`, `test_inventory_member_visibility.py`)
   fresh, plus the scoped frontend and backend suites covering every file this
   pass touched or re-verified.

## Re-verification of pass 7's two standing HIGH findings

### FE3-34-2 — a failed client-side logout leaves session cookies live — ✅ now FIXED on `main`

**Not fixed by this pass.** Re-verified against current code.
`stores/authStore.ts:491-505`'s `logout()` no longer silently swallows a
failed `POST /auth/logout` and tears the session down locally regardless.
It now calls `confirmServerSignOut()` (`:284-294`), which retries up to twice
with backoff (`SIGN_OUT_RETRY_DELAYS_MS = [500, 1500]`, `:273`) and treats a
401 as confirmation (the server already holds no session for these cookies —
exactly the end state sign-out wants). If the server still cannot confirm
after retrying, `logout()` sets `signOutUnconfirmed: true` and persists it to
`localStorage` (`SIGN_OUT_UNCONFIRMED_KEY`, `:266-270`) so a reload does not
lose it. `components/SignOutUnconfirmedNotice.tsx` is mounted at the app root
(`App.tsx:111`, above the router), renders a full-screen, non-dismissible
`alertdialog` the moment that flag is set, tells the member their session may
still be live and to close every window on a shared computer, and offers
**only** a retry button (`retrySignOut()`) — no way to dismiss it while the
flag is still true. `endSessionLocally()` (the local teardown — cache, offline
queues, `localStorage`) still runs unconditionally in all cases, same as
before; what changed is that the member is now told, and blocked, rather than
being shown a login screen over a session that never actually ended.
**Disposition: re-verified FIXED.** No `KNOWN_LIMITATIONS.md` entry exists for
this any more (confirmed by grep — none found), consistent with the fix.

### FE3-34-5 — an offline queue item can sync under the next member's identity — ✅ now FIXED on `main`

**Not fixed by this pass.** Re-verified against current code, which matches
the "tag queue entries with a validated owner" option every prior pass left as
the undecided alternative. `utils/offlineQueueOwner.ts` (new) is the single
authority: `requireQueueOwner()` throws rather than letting a write proceed
with nobody signed in, and `isOwnedByCurrentMember()` gates every drain. All
**four** offline queues — the three pre-existing
(`offlineQueue.ts`/`genericOfflineQueue.ts`/`shiftReportOfflineQueue.ts`) and
the new `skillsTestOffline.ts` — stamp `ownerId` on every write
(`requireQueueOwner()` at write time, confirmed in each file), filter every
list/count by `isOwnedByCurrentMember` (`listOwnPendingChecks`,
`listGenericPending().filter(isOwnedByCurrentMember)`,
`listOwnSkillsPending`, etc.), and re-check ownership **per entry at drain
time**, not just at listing time (`genericOfflineQueue.ts:241`'s `flushOne`;
`skillsTestOffline.ts:392`'s `flushEntry`, both read in full — a member who
changes between listing and sending is caught because the request would
otherwise go out "with whoever's cookies are live," per the latter's own
comment). An entry written before this change carries no `ownerId` and is
never auto-sent; it is surfaced instead by the new
`offlineQueueQuarantine.ts` / `HeldOfflineItemsNotice.tsx`, which let the
signed-in member explicitly claim it as theirs (`claimUntaggedCheck`/
`claimUntaggedReport`/`claimUntaggedGeneric`, each refusing to reassign an
entry that already has an owner) or discard it — never silently sent.
`purgeLocalMemberData`'s own never-throw contract (the reason this class of
bug exists at all — a purge that cannot be allowed to strand a member unable
to sign in) is unchanged; the fix does not touch it, it makes the cheaper
failure (an untagged entry held for review) the worst case instead of the
original one (a cross-identity send). **Disposition: re-verified FIXED.** No
`KNOWN_LIMITATIONS.md` entry exists for this any more (a related,
**different**, still-open limitation about Sign Out blocking on unsynced
skills evaluations is present and correctly scoped — see "Verified good"
below).

## Findings

### FE8-34-1 — MEDIUM — `GET /training/skill-evaluations` resolves and caches evaluator names — ✅ FIXED

**What:** the skill-evaluation list and detail endpoints resolve a
`specific_users` evaluator rule's member ids to `{id, name}` pairs
(`evaluator_members` on `SkillEvaluationResponse`) and were not in
`UNCACHEABLE_PREFIXES`, so a resolved name list could be served from the
in-memory cache for up to 90 seconds after the underlying rule changed.
**Where:** `backend/app/api/v1/endpoints/skill_evaluations.py:164-186`
(`_responses` resolving `names[str(u.id)] = u.display_name` and attaching
`evaluator_members`) and `:197-224`/`:280-296` (the list/detail routes that
call it); `frontend/src/utils/apiCache.ts` (the exclusion list, before this
fix).
**Failure scenario:** an officer with `training.manage` opens Skills Testing
→ a skill's evaluator list reads "Named: J. Smith, R. Alvarez." A dispatcher
removes R. Alvarez as an allowed evaluator and reassigns the rule to someone
else at the same org; a second officer who loaded the same skill within the
prior 90 seconds still sees the old name list. Not a cross-tenant leak (the
route is already org- and permission-scoped) and the data is admin-visible by
design — the defect is staleness of a security-relevant evaluator-authorization
list, the same class of problem `/roles/admin-access` is already excluded for.
**Impact:** LOW-to-MEDIUM. Admin-only surface, same-org, no PII disclosed to
anyone not already permitted to see it — but it is exactly the kind of "member
name resolved from an id" entry every other training endpoint in this file is
excluded for, and the file's own stated policy (HIPAA §164.312, no in-memory
caching of anything carrying a resolved member name) makes this a real,
if narrow, gap rather than a style nit.
**Fix:** added `/training/skill-evaluations` to `UNCACHEABLE_PREFIXES`
(`frontend/src/utils/apiCache.ts`), no trailing slash so both the bare list
and `/training/skill-evaluations/{id}` are covered, matching the file's
established convention for this shape (e.g. `/users`, `/messages`,
`/elections`). Guard test added (see below).

### FE8-34-2 — LOW — `GET /mcp-oauth/connections` and `/mcp-oauth/requests/{id}` are not cache-excluded — ✅ FIXED

**What:** `/mcp-oauth/*` is a distinct top-level prefix from
`/integrations/claude-mcp/oauth/*` (the latter is already covered by the
broad `/integrations` exclusion; the former is not registered under
`/integrations` at all — see `backend/app/api/v1/api.py:462-469`, where
`mcp_oauth.router` is mounted at `prefix="/mcp-oauth"`, sibling to, not
nested under, `/integrations`). `GET /mcp-oauth/connections` lists the
signed-in member's own live Claude (MCP) authorization grants; `GET
/mcp-oauth/requests/{request_id}` shows a pending consent request's client
name, redirect host, and requested scopes. Neither was in
`UNCACHEABLE_PREFIXES`.
**Where:** `backend/app/api/v1/endpoints/mcp_oauth.py:97-150` (`GET
/requests/{request_id}`) and `:208-220` (`GET /connections`);
`frontend/src/utils/apiCache.ts` (before this fix).
**Failure scenario:** a member revokes a Claude connection
(`DELETE /mcp-oauth/connections/{grant_id}`, which does invalidate the cache
by prefix on mutation — but only if the GET itself was ever excluded would a
_subsequent revalidation_ be forced promptly; the narrower, real scenario is
simpler) — within the 90-second stale window, a background revalidation
could still be in flight from before the revoke, or the page could re-render
from the fresh-window cache and show a connection as live for up to 30
seconds after the member just ended it. Self-scoped (not a cross-member
leak), but an authorization-state read, which this codebase's convention
(e.g. `/roles/admin-access`: "admin-status probe — must not go stale") treats
as a caching exclusion regardless of who the data belongs to.
**Impact:** LOW. No PII disclosed to anyone not already entitled to it (every
route requires `get_current_user` and returns only the caller's own data);
the exposure is a member briefly seeing their own already-revoked connection
as still active, not a cross-tenant or cross-member issue.
**Fix:** added `/mcp-oauth/` to `UNCACHEABLE_PREFIXES`. Guard test added (see
below).

## Verified good ✅ (re-confirmed against the current baseline)

- **Every one of the 13 `modules/*/services/api.ts` files, plus all four
  second-client files, calls `createApiClient()`** — confirmed by a fresh
  `grep -rn "createApiClient(" frontend/src`, not re-asserted from a prior
  pass's count. `createApiClient.ts` itself is byte-identical to `532340e3`
  (0 diff) and still wires `withCredentials: true`, the CSRF double-submit
  header on every state-changing method, and 401 → `performSharedRefresh()`
  → retry on every instance it creates — CLAUDE.md Pitfall #7 is satisfied by
  construction, not by each module file individually, and there is still
  exactly one shared implementation to check.
- **Still exactly two `axios.create()` call sites in the whole frontend**
  (`apiClient.ts`, `createApiClient.ts`) — no bespoke axios instance anywhere,
  including in the four new/changed files this pass reviewed in full
  (`historyImportApi.ts`, `skillsTestOffline.ts`, `offlineQueueOwner.ts`,
  `offlineQueueQuarantine.ts`).
- **`ProtectedRoute.tsx` is byte-identical to `532340e3`** (0 diff) —
  re-read in full regardless. Auth check is fail-closed (redirects to
  `/login` unless `isAuthenticated`), the permission check is correct
  AND/OR logic (`requiredPermission` is AND-equivalent to a single-item
  `requiredAnyPermission`; `lacksSingle || lacksAny` denies on either), forced
  password-change and forced-MFA-enrollment redirects run before the
  permission check (so a flagged account cannot route around them by hitting
  a page it otherwise has permission for), and `ModuleGate`'s own comment
  correctly states it is a UX gate, not a security boundary, mounted _after_
  the real checks pass. No bypass found.
- **No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage`** anywhere in the diff since `532340e3` — only
  `has_session`/`sign_out_unconfirmed` flags (booleans, not credentials), the
  `device_member` id (used only for the sign-in purge decision, not a
  secret), lockout counters, per-user learning-progress checkmarks, and test
  fixtures. Confirmed by reading every `.setItem(` call added since baseline.
- **No new XSS sink** (`dangerouslySetInnerHTML`/`innerHTML =`/`document.
write`/`eval(`) anywhere in the diff.
- **No hardcoded secret/token literal** added anywhere in the diff (the one
  `grep` hit, `'pk_live_secret'`, is a mock value inside a `.test.tsx` file).
- **The new 409 `AUTH_REFRESH_SUPERSEDED` handling in `apiClient.ts` is
  narrowly scoped and matches its backend counterpart exactly** — verified
  by reading both sides: `backend/app/api/v1/endpoints/auth.py:1636-1648`
  raises exactly `status_code=409` with `error_code=ErrorCode.
AUTH_REFRESH_SUPERSEDED` ("`LB-AUTH-012`") only when
  `AuthService.refresh_access_token` raises `RefreshTokenSuperseded` — i.e.
  only when a concurrent refresh from another tab already rotated the token
  and the cookie jar (shared across tabs) already holds the result.
  `isRefreshSuperseded()` checks both the exact status code and the exact
  string literal before swallowing the error; anything else (a genuine
  expiry, a network failure, a 5xx) still propagates and still triggers
  `handleExpiredSession()`. This is a correctness fix for a cross-tab race,
  not a new trust boundary.
- **`apiCache.ts`'s two organic additions since baseline** (`/member-badges`,
  `/training/knowledge-tests`) were both added by their own feature's
  rotation slot in the same commit that introduced the corresponding reads,
  matching the pattern every prior FE-34 pass has documented holding. No gap
  found in either.
- **Repo-wide sweep of every new `api.get(`/`api.get<` call site since
  `532340e3`** (summarized in the table below) found zero gaps beyond
  FE8-34-1 and FE8-34-2.
- **FE5-34-1's exclusion and permission gate are both unchanged and still
  correct**: `/inventory/items/colors` is still in `UNCACHEABLE_PREFIXES`
  (`apiCache.ts:112-115`) and `GET /inventory/items/colors` is still gated by
  `require_permission("inventory.view")`
  (`backend/app/api/v1/endpoints/inventory.py:768-770`). The broader ask
  (excluding the whole `/inventory/items` catalog) remains an accepted
  product trade-off in `KNOWN_LIMITATIONS.md`, unchanged, not re-litigated.

## Repo-wide sweep — new `api.get` call sites since `532340e3`

Every genuinely new (not merely reformatted/moved) `api.get(`/`api.get<` line
added anywhere in `frontend/src` since the baseline, grouped by disposition:

| New endpoint(s)                                                                                                                                         | Client                                                                                             | Disposition                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/training/skill-evaluations`, `/training/skill-evaluations/{id}`                                                                                       | global cached                                                                                      | **Gap — fixed as FE8-34-1.**                                                                                                                                                  |
| `/mcp-oauth/connections`, `/mcp-oauth/requests/{id}`                                                                                                    | global cached                                                                                      | **Gap — fixed as FE8-34-2.**                                                                                                                                                  |
| `/member-badges/{id}`, `/member-badges/settings`                                                                                                        | global cached                                                                                      | Already excluded by the pass-7-era `/member-badges` prefix entry. No gap.                                                                                                     |
| `/training/knowledge-tests`, `/training/knowledge-tests/{id}`, `/.../attempts`, `/.../attempts/{id}`                                                    | global cached                                                                                      | Already excluded by the `/training/knowledge-tests` prefix entry. No gap.                                                                                                     |
| `/training/competency/department`                                                                                                                       | global cached                                                                                      | Already excluded by the `/training/competency/` prefix. No gap.                                                                                                               |
| `/events/{id}/eligible-members`, `/events/{id}/external-attendees`                                                                                      | global cached                                                                                      | Already excluded by the `/eligible-members`/`/external-attendees` substring entries. No gap.                                                                                  |
| `/events/{id}/attendance-petitions` (read via `eventServices.ts`)                                                                                       | global cached                                                                                      | Already excluded by the `/attendance-petitions` substring entry. No gap.                                                                                                      |
| `/integrations/{id}`, `/integrations/claude-mcp/oauth/status`, `/clients`, `/grants`, `/integrations/.../sync-runs`                                     | global cached                                                                                      | Already excluded by the full `/integrations` prefix. No gap.                                                                                                                  |
| `/security/alerts`, `/security/download-activity`                                                                                                       | global cached                                                                                      | Already excluded by the `/security/` prefix. No gap.                                                                                                                          |
| `/users/directory`, `/users/{id}/undo-drop`, `/users/{id}/qualifications`                                                                               | global cached                                                                                      | Already excluded by the bare `/users` prefix. No gap.                                                                                                                         |
| `/elections/{id}/ballot`, `/.../ballot/proxies`, `/.../proxy-authorizations`                                                                            | global cached                                                                                      | Already excluded by the bare `/elections` prefix. No gap.                                                                                                                     |
| `/inventory/clearances/{id}`                                                                                                                            | global cached                                                                                      | Already excluded by the `/inventory/clearances` prefix. No gap.                                                                                                               |
| `/documents/folders/role-options`                                                                                                                       | global cached                                                                                      | Already excluded by the `/documents` prefix (and carries no PII regardless — a role-slug list). No gap either way.                                                            |
| `/forms/{id}/publish-warnings`                                                                                                                          | global cached                                                                                      | Already excluded by the `/forms` prefix. No gap.                                                                                                                              |
| `/meetings/attendance/dashboard`                                                                                                                        | global cached                                                                                      | Already excluded by the bare `/meetings` prefix. No gap.                                                                                                                      |
| `/member-id-cards/layout`                                                                                                                               | global cached                                                                                      | Org-wide admin-configured template (field positions, no member data), `require_permission`-gated. Correctly left cacheable.                                                   |
| `/training/skills-testing/tests` (new read, via `skillsTestOffline.ts`'s completion-retry path)                                                         | global cached (`api` from `services/apiClient`)                                                    | Already excluded by the `/training/skills-testing/tests` prefix. No gap.                                                                                                      |
| `/scheduling/*` (history import, pre-shift work, exchange candidates, swap requests)                                                                    | all via `createApiClient()` (module instances, `historyImportApi.ts`/`scheduling/services/api.ts`) | No caching logic exists in `createApiClient()` — confirmed by re-reading it in full (0 diff, no `isCacheable`/`setCache` anywhere). Cannot reach the shared cache regardless. |
| `/finance/*` (budgets, budget-requests, dues payments, export logs/mappings/readiness, fiscal years, approval-chain coverage, position/station options) | `createApiClient()` (`modules/finance/services/api.ts`)                                            | Same as above — no gap possible.                                                                                                                                              |
| `/apparatus/nfpa-settings`, `/apparatus/{id}/nfpa-summary`                                                                                              | `createApiClient()` (`modules/apparatus/services/api.ts`)                                          | Same.                                                                                                                                                                         |
| `/admin-hours/settings`, `/grants-fundraising`/`medical-screening` reads, `/minutes-records/action-item-assignees`, `/prospective-members/...`          | `createApiClient()` (respective module clients)                                                    | Same.                                                                                                                                                                         |
| `/system-notices`, `/system-notices/encryption-key-custody`                                                                                             | global cached                                                                                      | Org-wide system notices (new-version banners, key-custody status for admins) — no per-member data. Correctly left cacheable.                                                  |

**Conclusion: two new cache-exclusion gaps found and fixed (FE8-34-1,
FE8-34-2); zero others** across the whole diff window.

## Not fixed — considered, judged correctly scoped

- **FE5-34-1's broader ask** (excluding the whole `/inventory/items` catalog
  from caching) — unchanged, still a product trade-off, recorded in
  `KNOWN_LIMITATIONS.md`. Not re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — both fixes applied (FE8-34-1, FE8-34-2) are
mechanical, low-risk cache-exclusion additions matching an established
pattern, not behavior changes requiring an owner's call.

## Documentation corrections

`docs/KNOWN_LIMITATIONS.md` already has no entries for FE3-34-2 or FE3-34-5
(confirmed by grep — neither string appears), consistent with both being
fixed on `main` already. No correction needed there. `CLAUDE.md`'s
description of this feature's principal code and Pitfall #7 both remain
accurate; no correction needed.

## Schema & migration notes

n/a — frontend-only feature, no owned tables. `validate_migrations.py
--strict` run as part of the completion gate regardless: 571 revisions,
single head, no duplicate ids — unrelated to this feature, confirmed clean.

## Guard tests added

- `frontend/src/utils/apiCache.test.ts` — two new `it()` blocks under
  `describe('isCacheable')`: one asserting `/training/skill-evaluations`
  (list and detail) is excluded (FE8-34-1), one asserting
  `/mcp-oauth/connections` and `/mcp-oauth/requests/{id}` are excluded
  (FE8-34-2). Both fail if the corresponding `UNCACHEABLE_PREFIXES` entry is
  ever removed.
- No other new finding required a fix, so no other new guard test. The
  existing ratchets (`authStore.test.ts`'s `confirmServerSignOut`/
  `SignOutUnconfirmedNotice` coverage, `offlineQueueOwnership.test.ts`'s
  ownership/claim/quarantine cases across all four queues,
  `skillsTestOffline.test.ts`, `HeldOfflineItemsNotice.test.tsx`,
  `SignOutUnconfirmedNotice.test.tsx`) already cover both re-verified fixes
  (FE3-34-2, FE3-34-5) and were re-run as part of this pass's completion
  gate, not re-written.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                                              | Result                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                                                    | ✅ 0 violations                                                                                          |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                                                                                                                                                                                                                                                                                                      | ✅ clean, 2,175 files unchanged                                                                          |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                                                                                                                                                                                                                                                                                                                                                  | ✅ clean                                                                                                 |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                                                  | ✅ 571 revisions, single head                                                                            |
| Backend `pytest tests/test_api_cache_pii_exclusions.py tests/test_inventory_member_visibility.py`                                                                                                                                                                                                                                                                                                  | ✅ 19 passed                                                                                             |
| Backend `pytest tests/ -k "auth or logout or offline or cache" -m "not integration and not slow and not docker"`                                                                                                                                                                                                                                                                                   | ✅ 343 passed, 1 pre-existing skip (`test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency) |
| `npm run typecheck` (`tsc-native.mjs`, aliased 7.0.2 compiler, whole frontend)                                                                                                                                                                                                                                                                                                                     | ✅ 0 errors                                                                                              |
| `npm run lint` (`eslint --max-warnings 10`, whole frontend)                                                                                                                                                                                                                                                                                                                                        | ✅ 0 errors, 0 warnings                                                                                  |
| Scoped frontend suite (`apiCache`, `apiClient`, `authStore`, `createApiClient`, `learningProgressStore`, `pendingSyncStore`, `skillsTestingStore` ×3, `offlineQueueOwnership`, `offlineQueue`, `genericOfflineQueue`, `shiftReportOfflineQueue`, `skillsTestOffline`, `HeldOfflineItemsNotice`, `SignOutUnconfirmedNotice`, `ProtectedRoute.module`, `breadcrumbRoutes`, `Breadcrumbs` — 18 files) | ✅ 494 passed (324 + 170)                                                                                |

Diff scope for this pass: 25 feature-owned files, 2,133 insertions / 110
deletions since the `532340e3` baseline (frontend), plus the two files this
pass itself edits (`apiCache.ts`: +6/-0; `apiCache.test.ts`: +13/-0) and this
findings file / `PROGRESS.md`.
