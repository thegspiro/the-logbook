# Security Review — Feature 34: Frontend Shared (pass 10)

**Prefix:** `FE10` · **Iteration:** 34 · **Reviewed:** 2026-10-22 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 13 `modules/*/services/api.ts` files,
the four second per-module clients, `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ offline-queue ownership/quarantine utilities),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.get<` call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `localStorage.setItem`/`sessionStorage.
setItem` call sites, hardcoded secret/token literals, and XSS sinks
(`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since the
pass-9 baseline.
**Backend:** read-only cross-reference for one new shared control —
`backend/app/api/dependencies.py:206` and `backend/app/services/auth_service.py`
`get_user_from_token`'s `touch_activity` parameter — the server half of the
new `BACKGROUND_REQUEST_CONFIG` frontend utility.
**Migrations:** none written or reviewed as in-scope (639 revisions, single
head, confirmed via `validate_migrations.py --strict` — unrelated to this
feature; this run also incidentally re-confirms PR #3547's Alembic
merge-heads fix landed and the chain has a single head again).

**0 fixes, 0 new OPEN/FLAGGED findings.**

---

## Method

1. **Step 0 (rotation-level):** `search_pull_requests`
   (`is:pr is:open head:claude/security-review-`) returned 0 results. PR #3547
   (Feature 33, Core infrastructure, pass 8) had merged 2026-10-22T00:47:05Z —
   not docs-only, so it got its own `PROGRESS.md` Log entry rather than a
   silent clear. This iteration is a watchdog pickup — `ListAgents` found no
   other reachable session.
2. **Established the baseline**: `ea6752c2` (the merge of PR #3394, which
   landed `FE9-34-frontend-shared.md` — confirmed via `git log --diff-filter=A
-- docs/security-review/FE9-34-frontend-shared.md`, then verifying that
   commit's ancestry includes the merge commit).
3. **Diffed every feature-owned file** against the baseline (`git diff
--stat ea6752c2..origin/main -- <each file>`). Two files changed
   (`utils/errorHandling.ts`: +20/-0, new `getSaveFailureMessage()` helper;
   `stores/practicalSkillsStore.ts`: +5/-4, a docstring correction only).
   Five module `services/api.ts` files changed (admin-hours, finance,
   minutes, prospective-members, scheduling) — all business-logic additions
   or type-narrowing in their own feature's code, not shared-client changes.
   Everything else named in FE9's scope line — `apiCache.ts`, `apiClient.ts`,
   `createApiClient.ts`, `errorTracking.ts`/`errorReporting.ts` (no, see
   below), `services/api.ts`, `ProtectedRoute.tsx`, `authStore.ts`, the four
   offline queues, the other 8 module `api.ts` files, and all four
   second-client files — is byte-identical to the baseline (confirmed by the
   same diff-stat producing no entry for each).
4. **Read every line of the diff** for all seven changed files, applying
   `CHECKLIST.md`'s seven dimensions.
5. **Enumerated every axios-instance-creating file fresh**
   (`git grep -l "createApiClient(" <baseline> -- frontend/src/**/*.ts` vs.
   the same grep against the working tree): both return the same 16 files
   (15 callers + the definition) — no new axios instance anywhere, and the
   two module `api.ts` files that deliberately import the global
   `services/apiClient` directly instead (`ip-security`, `testing`, both
   documented in their own file header as an intentional reuse of the
   already-configured shared client) are unchanged.
6. **Ran a repo-wide diff sweep** for new `api.get(`/`api.get<` call sites
   since the baseline, across the whole frontend (not just feature-owned
   files). Found 10 new/changed call sites; traced each to its client and,
   for the ones on the global cached client, checked against
   `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` — see findings below.
7. **Ran a repo-wide sweep** for new top-level files under `stores/`,
   `services/`, and `utils/` since the baseline. Found two new shared
   utilities: `utils/deleteOutcome.ts` (reads the `X-Delete-Outcome` response
   header to report deactivate-vs-delete; no data handling beyond that) and
   `utils/backgroundRequest.ts` (a new cross-cutting auth/session control,
   audited in full below — not treated as routine given it is both new and
   touches session-activity tracking).
8. **Ran a repo-wide sweep** for `localStorage.setItem(`/`sessionStorage.
setItem(`, hardcoded API-key/secret/token literals, and new XSS sinks
   since the baseline — one hit (`localStorage.setItem('has_session', '1')`
   in a Vitest `beforeEach`, test-only, matches the documented pattern).
9. **Ran the full backend+frontend completion gate** (below).

## Findings

None. Every change since the pass-9 baseline is either out of this feature's
scope (business-logic additions inside a module's own `services/api.ts`, with
no change to the shared client, auth, cache, or XSS controls those files
wrap) or was checked against all seven dimensions and found correct.

## Verified good ✅

- **The shared-client surface is unchanged**: `apiClient.ts`,
  `createApiClient.ts`, `apiCache.ts`, `services/api.ts` (barrel),
  `ProtectedRoute.tsx`, `authStore.ts`, and all four offline queues are
  byte-identical to the `ea6752c2` baseline (0-line diff-stat for each) —
  `withCredentials: true`, the CSRF double-submit header, and 401 →
  `performSharedRefresh()` → retry still wire every instance the same way.
  Still exactly two `axios.create()` call sites in the whole frontend
  (`services/apiClient.ts`, `utils/createApiClient.ts`).
- **No new call site reaches an endpoint that should be in
  `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` but isn't**:
  - `GET /training/certifications/alert-settings` (new, `trainingServices.ts`)
    returns `CertAlertSettings` — three org-level booleans
    (`enabled`/`cc_chief_on_escalation`/`include_personal_email_on_final`),
    no member data. Cacheable by design, not a gap.
  - `GET /elections/{id}/stats` (new call site, `electionService.ts`)
    returns `ElectionStats` — aggregate counts and a `votes_by_position` map,
    no voter identity or ballot content (elections are secret-ballot by
    design). Cacheable by design, not a gap.
  - `GET /medical-supplies/lots/search` (new, `medicalSuppliesService.ts`)
    is equipment/supply-lot data (not member PHI — medical _supplies_, not
    `medical-screening`), and the call site itself already passes
    `readConfig({ bypassCache: true })` → `_skipCache: true`, which
    `apiClient.ts`'s request interceptor (line 77) honors. Re-verified the
    wiring end-to-end rather than trusting the comment.
  - `GET /notifications/my/unread-count` (new call site,
    `communicationsServices.ts`) is already covered by the existing bare
    `/notifications/my` prefix entry ("list too, not just sub-paths").
  - `GET /events`, `/scheduling/calendar/{month,week}`,
    `/finance/export/chart-of-accounts`, `/minutes-records/...` — all either
    pre-existing cacheable endpoints with an added optional `config` passthrough
    parameter (no new data exposed), or go through a module-local
    `createApiClient()` instance, which has no cache interceptor at all and so
    isn't subject to this control in the first place.
- **New shared control, audited end-to-end:
  `utils/backgroundRequest.ts`'s `BACKGROUND_REQUEST_CONFIG`.** A timer-driven
  poll (notification-count badge, every 60s; live election turnout refresh)
  attaches `X-Background-Request: 1` so the request doesn't reset the
  server's idle-session timer. Verified:
  - The backend reads it (`dependencies.py:206`,
    `request.headers.get("x-background-request") != "1"`) and passes the
    negation as `touch_activity` into `AuthService.get_user_from_token`.
  - `touch_activity` gates **only** `session.last_activity = datetime.now(...)`
    (`auth_service.py`, read in full) — JWT decode, the session-exists check,
    session-expiry/absolute-lifetime check (`session_end_reason`), and the
    active-user lookup all run unconditionally before that gate, so forging
    or omitting the header cannot bypass authentication or extend a session;
    it can only make the caller's **own** idle timer tick down for real while
    a poll silently happens to be in flight. One-directional by construction,
    matching the comment in both files.
  - Both call sites (`useNotificationCount.ts`, `LiveTurnoutPanel.tsx`) are
    genuine timer-driven polls (`setInterval`/effect-scheduled refresh), not
    a user-initiated action with the header attached by mistake — confirmed
    by reading each call site, not assumed from the name.
- **`utils/deleteOutcome.ts`** (new) only reads a response header to label an
  already-completed delete/deactivate as one or the other; it has no branch
  that could mis-authorize or mis-scope a delete — the delete itself already
  happened server-side by the time this runs. Defaults to `'deleted'` when the
  header is absent (a mocked response, or an older backend), which is the
  pre-existing behavior for every such endpoint before deactivation existed —
  not a fail-open on anything security-relevant.
- **No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage`** anywhere in the diff since the baseline — the sole new
  `.setItem('has_session', ...)` hit is Vitest test setup, matching the
  documented `has_session`-flag pattern (never a token).
- **No hardcoded secret/token literal added**, and **no new
  `dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`** anywhere
  in the diff since the baseline — the rich-text XSS surface FE9 audited in
  full is unchanged (`RichText.tsx`, `richText.ts`, `RichTextEditor.tsx` all
  byte-identical to baseline).
- **`errorHandling.ts`'s new `getSaveFailureMessage()`** only reformats
  information `getErrorMessage()`/`toAppError()` already exposed (the HTTP
  status and an optional server-issued error code) into a friendlier string
  for 5xx failures; it adds no new data collection or disclosure.
- **`practicalSkillsStore.ts`'s diff is a docstring correction only**
  (describing enforcement more precisely) — 0 lines of runtime code changed.
- **Module `services/api.ts` diffs in admin-hours, finance, minutes,
  prospective-members, and scheduling** all stay within each module's own
  business logic (new endpoints, a `config?: AxiosRequestConfig` passthrough
  parameter, type-narrowing an inline response shape to a named type, dropping
  a dead backend-404 method) and do not touch auth, CSRF, caching, or the
  shared client factory. Those modules' own endpoint/permission correctness is
  that feature's rotation slot (Finance #05, Meetings & minutes #24,
  Membership pipeline #08, Scheduling #15), not this one's — consistent with
  FE9's and earlier passes' scoping.

## Not fixed — considered, judged correctly scoped

- **FE5-34-1's broader ask** (excluding the whole `/inventory/items` catalog
  from caching) — unchanged, still a product trade-off, already recorded in
  `KNOWN_LIMITATIONS.md`. Not re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — there is nothing to fix or flag this pass.

## Documentation corrections

None needed.

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict` run as part of the completion gate
regardless: 639 revisions, single head (`e5f9bb066e07`) — unrelated to this
feature, confirmed clean.

## Guard tests added

None — no finding required a fix this pass. The existing guard tests covering
this feature's prior fixes (`apiCache.test.ts`'s `isCacheable` suite,
`apiClient.test.ts`, the rich-text sanitizer tests, etc.) were not touched and
continue to assert the same invariants.

## Completion gate

| Check                                                | Result                          |
| ---------------------------------------------------- | ------------------------------- |
| `flake8 app/ tests/ alembic/`                        | ✅ 0 violations                 |
| `black --check app/ tests/ alembic/`                 | ✅ clean, 2,552 files unchanged |
| `isort --check-only app/ tests/ alembic/`            | ✅ clean                        |
| `validate_migrations.py --strict`                    | ✅ 639 revisions, single head   |
| `npm run typecheck` (whole frontend)                 | ✅ 0 errors                     |
| `npm run lint` (whole frontend, `--max-warnings 10`) | ✅ 0 errors, 0 warnings         |

No backend file was touched this pass; the backend gate was still run in full
per CLAUDE.md's completion-gate requirement and confirmed clean. No frontend
file was touched by this pass itself either — the diff for this PR is this
findings file plus the `PROGRESS.md` bookkeeping (Step 0's PR #3547 record and
this feature's row/log update), so the frontend suite was not re-run beyond
`typecheck`/`lint`, which cover the whole tree regardless of what changed.

Diff scope for this pass: 7 feature-owned files changed since the `ea6752c2`
baseline (none requiring a fix), reviewed against all seven checklist
dimensions, plus this findings file and `PROGRESS.md`.
