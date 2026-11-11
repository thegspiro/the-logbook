# Security Review — Feature 34: Frontend Shared (pass 15)

**Prefix:** `FE15` · **Iteration:** 34 · **Reviewed:** 2026-11-11 · **PR:** #TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 14 `modules/*/services/api.ts` files
(re-enumerated: 14, unchanged from pass 14), the now-six second per-module
clients (two new since pass 14: `modules/integrations/services/historicalImportApi.ts`,
`modules/scheduling/services/historyImportApi.ts`), `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ offline-queue/shared-device purge utilities),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.get<`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-14 baseline.
**Backend:** none reviewed as in-scope — every backend endpoint a new frontend
call site in this diff reaches belongs to a feature that already owns review
credit (Finance for `/finance/*`, Scheduling for `/scheduling/*` and the
history-import module, Training for `/training/*`, Integrations for the
historical-import module, Grants & fundraising for `/grants/donations/{id}`).
Not re-reviewed here.
**Migrations:** none written or reviewed as in-scope. 760 revisions, single
head `ccd374a66f82`, confirmed via `validate_migrations.py --strict` — the
Alembic fork flagged as pre-existing/out-of-scope in PR #4256
(`CI14-33-core-infra.md`) has since been resolved by PR #4255, confirmed clean
on this pass's own baseline.

**0 fixes, 0 new findings.**

---

## Method

1. **Step 0 (rotation-level):** PR #4256 (Feature 33, Core infrastructure,
   pass 14) had just merged (`a649ff685`). A fresh `list_pull_requests`
   (state `open`) returned six open PRs, none with a head branch starting
   `claude/security-review-`, confirming Feature 34 (Frontend shared) as the
   next `⬜` row on a freshly fetched, fast-forwarded `main`.
2. **Established the baseline:** `88fcfcd4a` — the merge of PR #4018
   (`FE14-34-frontend-shared.md`, pass 14).
3. **Re-verified prior art before reading new code:** read `CHECKLIST.md` and
   `FE14-34-frontend-shared.md` in full. `FE5-34-1`'s recorded trade-off
   (broader cache exclusion for the inventory catalog, carried in
   `KNOWN_LIMITATIONS.md`) is unchanged; not re-litigated.
4. **Diffed every feature-owned file** against the baseline
   (`git diff 88fcfcd4a..HEAD`). `createApiClient.ts`, `errorHandling.ts`,
   `errorTracking.ts`, `ProtectedRoute.tsx`, `learningProgressStore.ts`,
   `pendingSyncStore.ts`, `skillsTestingStore.ts`, `practicalSkillsStore.ts`
   and 8 of the 14 module `services/api.ts` files are byte-identical to pass 14. Real, additive deltas were read in full in: `apiCache.ts` (+3
   `UNCACHEABLE_PREFIXES`/`SUBSTRINGS` lines, net of the `/evaluations` entry
   that landed between passes for the new evaluations module — all additive,
   none removed or narrowed), `apiClient.ts` (one new import,
   `loginPathReturningTo`, for the expired-session full-page redirect),
   `services/api.ts` (re-export additions only), `authStore.ts` (per-account
   login lockout, held-skills-evaluation release on claim), `errorReporting.ts`
   (an unhandled-rejection fix in the keepalive flush path, no behavioural
   change to what is reported or where), and 6 module `services/api.ts` files
   (`finance`, `grants-fundraising`, `prospective-members`, `scheduling` — all
   new endpoints only, no instance or interceptor change).
5. **Repo-wide sweep since the baseline** (`git diff 88fcfcd4a..HEAD --
frontend/src`, 904 files / 471 commits — the frontend's share of everything
   that landed on `main` across this pass's whole review window):
   - **New `axios.create(`/`createApiClient(` call sites:** exactly one new
     literal (`const api = createApiClient();`), appearing in the two new
     second-per-module clients (`modules/integrations/services/historicalImportApi.ts`,
     `modules/scheduling/services/historyImportApi.ts`). Both use the shared
     factory; no hand-rolled `axios.create()` anywhere in the diff.
   - **Module client count:** re-enumerated the `modules/*/services/api.ts`
     directory fresh — 14, unchanged from pass 14 (no new primary module
     client this pass).
   - **New top-level files under `stores/`, `services/`, `utils/`,
     `contexts/`:** 12 non-test files (`contexts/confirmRequest.ts`,
     `services/attendanceWaiverService.ts`, `utils/attendanceRequirementOverlap.ts`,
     `utils/attendanceRequirements.ts`, `utils/attendanceWaivers.ts`,
     `utils/locationLabel.ts`, `utils/milestoneSummary.ts`,
     `utils/programWizardDraft.ts`, `utils/requirementUnits.ts`,
     `utils/saveExceptRefused.ts`, `utils/serverFieldErrors.ts`,
     `utils/sessionDrafts.ts`). All read; see Verified good. None reach the
     network, `localStorage` or `sessionStorage` except the four noted below,
     which are reviewed in full.
   - **New `localStorage.setItem`/`sessionStorage.setItem` call sites
     (production code, not test fixtures):** `utils/sessionDrafts.ts` (new —
     per-member-id-namespaced form drafts, PHI explicitly excluded by the
     file's own docstring and the one adopting form checked), `utils/programWizardDraft.ts`
     (new — per-member-id-namespaced wizard draft), and the rewritten
     `authStore.ts` lockout storage (now keyed per account, not per tab, still
     capped at `MAX_LOCKOUT_ACCOUNTS = 20` with oldest-eviction). No new
     per-member PII written to browser storage outside the existing,
     already-reviewed purge-on-logout contract.
   - **Hardcoded secret/token literal sweep:** no real literal secret; the
     one hit outside test fixtures/env-var-name prose is a test mock token
     string (`'pending-token'`).
   - **XSS sink sweep** (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): zero new hits in production source since the
     pass-14 baseline.
   - **New endpoint surface vs. `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`:**
     extracted every new `api.get(`/`api.get<` call site's URL added since the
     baseline (25 across both plain-string and template-literal forms,
     excluding two that are test-fixture-only literals —
     `/locations/room-7/display` and a `sessionStorage.setItem('unrelated', …)`
     line — confirmed by reading their containing files, both inside
     `apiClient.test.ts`) and checked each against the current prefix/
     substring lists programmatically (`startsWith`/`includes`, matching
     `apiCache.ts`'s own `isCacheable` logic at `apiCache.ts:346,349`). All 25
     real endpoints are covered, 22 by an existing broad module prefix
     (`/finance/`, `/scheduling/`, `/training/…`, `/documents`, `/grants`,
     `/users`, `/evaluations`, `/overrides`) and 3 by this pass's own new,
     additive entries (`/email-templates/member-email-opt-outs`,
     `/training/programs/milestone-options`, the `/overrides` substring).
     See Verified good for detail.
6. **Completion gate** run per Step 6 below.

## Verified good ✅

- **The two new second-per-module clients both use the shared factory, and
  both document why a module client never caches.** `historicalImportApi.ts`
  and `historyImportApi.ts` each open with `createApiClient()` and a header
  comment stating "cookie credentials, CSRF, refresh" and that module clients
  never pass through the global response cache — confirmed by reading
  `createApiClient.ts` (byte-identical to pass 14: wires no cache logic) and
  both files in full. Neither hand-rolls `axios.create()`.
- **Every new endpoint this pass's diff calls is covered by
  `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`, confirmed programmatically,
  not by inspection alone.** Extracted the 25 real new GET URLs from the diff
  and ran them against the current lists with the same `startsWith`/
  `includes` semantics `isCacheable()` uses (`apiCache.ts:346,349`): all 25
  match. The 10 new finance endpoints (`/finance/my-dues`,
  `/finance/quickbooks/connection`, `/finance/quickbooks/postings`,
  `/finance/advances/holders`, `/finance/budget-amendments/pending`,
  `/finance/dues-schedules/membership-type-options`,
  `/finance/reports/dues-delinquency`, `/finance/reports/expense-summary-by-member`,
  `/finance/reports/purchases-by-vendor`, `/finance/settings/budget-request-reminders`)
  all fall under the single, already-existing blanket `/finance/` prefix.
  `/scheduling/dashboard/widget-preferences` falls under `/scheduling/`.
  `/users/me/crew` falls under the no-trailing-slash `/users` prefix (members'
  names). `/training/requirements/{id}/overrides` is caught twice — by the
  `/overrides` substring this pass adds, and (separately) by nothing else,
  confirming the substring is load-bearing rather than redundant. The 4
  `/evaluations/*` endpoints fall under the `/evaluations` entry that landed
  between passes for the new evaluations module (added for the same reason
  this pass's own 3 additions were: a PII field name the backend ratchet test
  `test_api_cache_pii_exclusions.py` cannot see, per the file's own comment).
  Two matches were confirmed to be test-fixture literals rather than real
  endpoints (`/locations/room-7/display` in `apiClient.test.ts`), not counted
  against the 25.
- **This pass's own 3 additive `UNCACHEABLE_PREFIXES`/`SUBSTRINGS` entries
  only widen the exclusion list — `git diff` shows zero lines removed or
  reworded.** `/email-templates/member-email-opt-outs` (which named members
  turned off which emails — per-member preference, PII),
  `/training/programs/milestone-options` (member names and membership numbers
  for the milestone recipient picker, PII), and the `/overrides` substring (a
  Chief's requirement overrides — member names and reasons that may be
  medical, PHI) each carry a rationale comment matching the file's existing
  convention.
- **The per-account login lockout rewrite in `authStore.ts` is a strict
  narrowing of what gets locked, not a new exposure.** Keyed on
  `loginAccountKey()` (the trimmed, lowercased username — the same folding the
  server does), capped at `MAX_LOCKOUT_ACCOUNTS = 20` accounts per tab with
  oldest-first eviction (`withLockout()`), and the persisted shape
  (`sessionStorage`, cleared on tab close) stores only `{attempts,
lockedUntil}` per account key — no password, no server token. This is
  client-side defense-in-depth only (the comment says so); the server's own
  `rate_limit_login` is the real control and is unaffected by this change.
  Read `loadLockoutState()`/`saveLockoutState()`/`withLockout()` in full: a
  legacy pre-rewrite shape (`{loginAttempts, lockedUntil}`, no `accounts` key)
  is recognized and dropped rather than misread.
- **`releaseHeldWorkFor`/`claimDeviceForMember` correctly scope the held
  skills-evaluation exception to the examiner who held it, never to a
  different member who signs in next.** Read `skillsTestOfflineStore.ts` in
  full: `purgeSkillsStores(discardFor)` keeps a pending entry only when it is
  stamped with an `ownerId` that both exists and differs from `discardFor`,
  and marks it `heldAt` (bounding it at `HELD_EVALUATION_RETENTION_MS`, 7
  days) rather than leaving it open-ended; `releaseHeldSkillsEntries(member)`
  only clears the `heldAt` flag — handing the entry back — for rows whose
  `ownerId === member`, and separately sweeps anything past retention
  regardless of owner. `skillsTestOffline.ts`'s read paths
  (`listOwnSkillsPending`, `getOwnSkillsPending`) both filter through
  `isOwnedByCurrentMember()` before returning anything, so a held entry
  belonging to a different (absent) examiner is never surfaced to whoever is
  currently signed in, even though the row still physically exists in
  IndexedDB. `authStore.ts`'s new `logout({ automatic })` parameter correctly
  passes `discardSkillsFor: null` on every automatic path (idle timeout,
  session cap) and the signed-in member's own id only on an interactive Sign
  Out, matching the one-decision-one-consequence shape the owner decision of
  2026-11-01 calls for.
- **`purgeLocalMemberData`'s new `releaseHeldWorkFor` call and all of its
  existing per-store purges remain non-throwing and bounded.** Every IndexedDB
  call is wrapped in `try/catch` and raced against the existing 3s
  `STORE_PURGE_TIMEOUT_MS` ceiling (`bounded()`), so a browser IndexedDB
  pathology still cannot stall or block logout — unchanged invariant,
  re-verified against the new call site.
- **The two new per-member-namespaced browser-storage utilities
  (`sessionDrafts.ts`, `programWizardDraft.ts`) are both purged by the
  existing logout path and both document, and in the one adopting form
  (`ManualShiftReportPage.tsx`) actually keep out, PHI.** `sessionDrafts.ts`
  keys every entry `logbook:draft:<userId>:<form>[:<recordId>]`, so one
  member's draft is never read back for another, and its docstring states the
  no-PHI rule explicitly; `ManualShiftReportPage.tsx`'s `ShiftReportDraft`
  interface and its own comment confirm no medical/emergency-contact field is
  drafted. Both `clearAllSessionDrafts()` and `clearAllProgramWizardDrafts()`
  are wired into `purgeLocalMemberData()` (confirmed by reading the import
  list and call sites in `purgeLocalMemberData.ts`), so a shared station
  computer's sign-out clears both regardless of which forms were used.
- **`postLoginRedirect.ts`/`loginPathReturningTo()` (new since pass 14, wired
  into `apiClient.ts`'s `handleExpiredSession`) cannot be turned into an open
  redirect.** `isAppPath()` requires a leading single `/`, rejects `//host`
  and rejects any control character or literal backslash
  (`hasUnsafeChar()` — a backslash is read as `/` by a browser, which is how
  `/\host` style tricks reach another origin). The `?from=` query form is
  additionally re-parsed against a throwaway origin
  (`new URL(raw, 'https://app.invalid')`) and accepted only if the parsed
  `origin` is unchanged, closing the gap a bare prefix check alone would
  leave. Exercised in `postLoginRedirect.test.ts` against `//evil.example/x`,
  `https://evil.example/x`, `/\evil.example/x`, `/\t/evil.example/x`,
  `javascript:alert(1)`, a bare hostname, and an empty string — all fall back
  to `DEFAULT_POST_LOGIN_PATH`. `loginPathReturningTo()` only ever encodes the
  _current_ `window.location`, which is always same-origin by construction, so
  this call site cannot itself inject an attacker-controlled target; the
  hardening is for the read-back half (`postLoginRedirect()`), which a crafted
  `?from=` on a shared/bookmarked link could reach.
- **No new `axios.create`/`createApiClient` call outside the two reviewed
  module clients**, no token written to `localStorage`/`sessionStorage` in
  production code, no hardcoded secret literal, no new XSS sink — all
  confirmed by the repo-wide sweeps in Method step 5.
- **`ProtectedRoute.tsx` is byte-identical to pass 14** (confirmed by empty
  `git diff`): auth check before permission check before module gate,
  `has_session` read only as a lightweight non-token flag from `localStorage`
  (the comment states the real token lives only in the httpOnly cookie),
  redirect-to-`/login` fail path on `!isAuthenticated`. Re-verified rather
  than assumed.

## Not fixed — considered, judged correctly scoped

- **`FE5-34-1`'s broader ask** (excluding the whole `/inventory/items`
  catalog from caching) — unchanged, still a recorded product trade-off in
  `KNOWN_LIMITATIONS.md`. Not re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — nothing to fix or flag this pass.

## Documentation corrections

None needed.

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict` run as part of the completion gate
regardless: 760 revisions, single head `ccd374a66f82`, confirmed clean. (The
two-head fork noted as pre-existing/out-of-scope in PR #4256's findings file
has since been resolved, outside this feature's own review, by PR #4255.)

## Guard tests added

None — no finding required a fix this pass. The per-account lockout, held-
skills-evaluation release, session-draft and program-wizard-draft tests were
all written by the feature work itself, not by this review, and were read and
judged adequate above rather than authored here.

## Completion gate

| Check                                                | Result                         |
| ---------------------------------------------------- | ------------------------------ |
| `flake8 app/ tests/ alembic/`                        | ✅ 0 violations                |
| `black --check app/ tests/ alembic/`                 | ✅ clean, 3132 files unchanged |
| `isort --check-only app/ tests/ alembic/`            | ✅ clean                       |
| `python3 scripts/validate_migrations.py --strict`    | ✅ 760 revisions, single head  |
| `npm run typecheck` (whole frontend)                 | ✅ 0 errors                    |
| `npm run lint` (whole frontend, `--max-warnings 10`) | ✅ 0 errors, 0 warnings        |
| Scoped frontend suite (16 files, the reviewed delta) | ✅ 374 passed                  |

No backend file in this feature's own scope was touched this pass; the
backend gate was still run in full per CLAUDE.md's completion-gate
requirement and confirmed clean. The scoped frontend suite covers
`apiCache`, `apiClient`, `authStore`, `ProtectedRoute`, `postLoginRedirect`,
`purgeLocalMemberData`, `skillsTestOffline`, `useSessionDraft`,
`programWizardDraft`, `errorReporting`, `attendanceWaiverService`,
`saveExceptRefused`, `serverFieldErrors`, and the `finance`/
`prospective-members`/`historyImportApi` module clients' own test suites —
run to confirm the current tree (not merely the diff) still passes on all of
them.

Diff scope for this pass: path-scoped diff against the declared file list
plus the repo-wide sweep's net found real deltas in `apiCache.ts`,
`apiClient.ts`, `services/api.ts`, `authStore.ts`, `errorReporting.ts`, and 6
of the 14 module `services/api.ts` files, plus 12 new top-level
`stores`/`services`/`utils`/`contexts` files and 2 new second-per-module
client files — all reviewed in full against all seven checklist dimensions,
plus this findings file and `PROGRESS.md`.
