# Security Review — Feature 34: Frontend Shared (pass 16)

**Prefix:** `FE16` · **Iteration:** 34 · **Reviewed:** 2026-11-23 · **PR:** TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 14 `modules/*/services/api.ts` files
(re-enumerated: 14, unchanged from pass 15), the six second-per-module clients
(re-enumerated: 6, unchanged from pass 15 — `historicalImportApi.ts`,
`historyImportApi.ts`, `equipmentCheckApi.ts`, `publicPortalApi.ts`,
`evaluationsApi.ts`, `shiftSettingsApi.ts`), `components/ProtectedRoute.tsx`,
`stores/authStore.ts`, `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
`stores/practicalSkillsStore.ts`, plus a repo-wide sweep for new
`api.get(`/`api.get<`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-15 baseline.
**Backend:** none reviewed as in-scope — every backend endpoint a new frontend
call site in this diff reaches belongs to a feature that already owns review
credit (Training for `/training/course-links*`, Events for
`/events/outreach-calendar`, Dashboard/Reports for
`/dashboard/community-engagement/events`, Elections for `/elections/*/attendance`,
Inventory for `/inventory/*`, Scheduling, Reports/Evaluations and Users/Leave
for their own module clients). Not re-reviewed here except where this
feature's own control (the response cache's PII denylist) applies to them.
**Migrations:** none written or reviewed as in-scope. 821 revisions, single
head `c4e7a9d2f1b8`, confirmed via `validate_migrations.py --strict`.

**0 fixes, 0 new findings** — one candidate finding traced to full resolution
by an existing control (see "Considered, not a finding" below).

---

## Method

1. **Step 0 (rotation-level):** PR #4580 (Feature 33, Core infrastructure,
   pass 15) had just merged (`c01ab8df1`). A fresh `list_pull_requests`
   (state `open`, head filter `claude/security-review-`) returned zero
   results, confirming Feature 34 (Frontend shared) as the next and only
   remaining `⬜` row on a freshly fetched, unshallowed `main` (`git
rev-parse --is-shallow-repository` was `true`; unshallowed per the
   standing Pitfall #24 risk note before trusting any commit count).
2. **Established the baseline:** `f30309984` — the merge of PR #4259
   (`FE15-34-frontend-shared.md`, pass 15), found by searching the
   unshallowed history for the merge commit message (`git log --grep
"Frontend shared"`), since the shallow clone's default depth did not
   reach it.
3. **Re-verified prior art before reading new code:** read `CHECKLIST.md`,
   `FE15-34-frontend-shared.md`, `docs/module-audit/frontend-shared.md`, and
   `docs/app-review/frontend-shared.md` in full. `FE5-34-1`'s recorded
   trade-off (broader cache exclusion for the inventory catalog, carried in
   `KNOWN_LIMITATIONS.md`) is unchanged; not re-litigated.
4. **Diffed every feature-owned file against the baseline**
   (`git diff f30309984..HEAD`). 1609 commits separate the baseline from
   this pass's `HEAD`. Byte-identical: `createApiClient.ts`, `apiClient.ts`,
   `ProtectedRoute.tsx`, `learningProgressStore.ts`, `pendingSyncStore.ts`,
   `practicalSkillsStore.ts`, all 14 module `services/api.ts` files (none
   touched), and 4 of the 6 second-per-module clients. Real, additive deltas
   read in full: `services/api.ts` (two new barrel re-exports, one removed
   type re-export — `TrainingSessionCreate`, dropped because the type itself
   was retired alongside the removed `CompetencyMatrixService`, confirmed by
   `git log` on the type's own file), `errorReporting.ts` (two new
   `sanitizePath` redaction patterns for preceptor-link tokens — additive
   only, no pattern removed), `apiCache.ts` (one stale entry removed —
   `/training/competency-matrix`, whose backend route was retired in the
   same window per commit `530d6cf1`, confirmed the route no longer exists
   under any v1 router — plus two new additive entries), `errorHandling.ts`
   (two new exported message-formatting helpers,
   `getLoadFailureMessage`/`getActionFailureMessage`, mirroring the existing
   `getSaveFailureMessage` pattern; no behavior change to any existing
   function's signature or return value), and `skillsTestingStore.ts` (an
   offline-sync version-conflict fix for a save racing a drain — read in
   full, see Verified good).
5. **Repo-wide sweep since the baseline** (`git diff f30309984..HEAD --
frontend/src`, 614 non-test `.ts(x)` files changed):
   - **New `axios.create(`/`createApiClient(` call sites:** zero. The
     6 second-per-module clients are unchanged in count and identity from
     pass 15 (confirmed by re-listing `grep -rl "createApiClient(" modules/*/
services/*.ts` and diffing the set).
   - **New top-level files under `stores/`, `services/`, `utils/`,
     `contexts/`:** 12 non-test files
     (`services/apparatusEventServices.ts`, `services/leaveRequestService.ts`,
     `services/memberAudienceService.ts`,
     `services/publicShiftEvaluationService.ts`,
     `utils/attendanceWaiverWorkflows.ts`, `utils/complianceForecast.ts`,
     `utils/eventTemplates.ts`, `utils/lazyOptional.ts`, `utils/logoUrl.ts`,
     `utils/outreachRoles.ts`, `utils/popoverPlacement.ts`,
     `utils/requirementPace.ts`). All read; see Verified good. 8 of the 12
     utils files touch neither the network nor browser storage at all.
   - **New `localStorage.setItem`/`sessionStorage.setItem` call sites:**
     swept the full diff; every hit is either a non-member-identifying UI
     preference (`theme-preference`, `navigationLayout`, `departmentName`,
     `logoData`, `preHighContrastTheme`, dismissal/preset keys) or a line in
     an already-reviewed, already-purged file (`shiftReportDrafts.ts` gained
     one new optional field, `memberCalls`, on its existing `ShiftReportDraft`
     shape — the whole record is cleared on logout by the existing
     `clearAllDrafts()` wiring into `purgeLocalMemberData.ts`, confirmed by
     reading the import, so a new field on an already-purged record needs no
     separate fix).
   - **Hardcoded secret/token literal sweep:** zero hits.
   - **XSS sink sweep** (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): zero new hits in production source since the
     pass-15 baseline.
   - **New endpoint surface vs. `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`:**
     extracted every new `api.get(`/`api.get<` call site added since the
     baseline across the whole frontend (71 raw diff lines), resolved each
     to its real URL and the axios instance it runs on, and discarded the
     ones that reach a per-module `createApiClient()` instance — those never
     pass through the shared response cache regardless of the denylist
     (confirmed `createApiClient.ts` wires no cache interceptor, unchanged
     since pass 15). That left 24 real new GET call sites on the cached
     global client, all traced individually: see Verified good.
6. **Completion gate** run per Step 6 below.

## Verified good ✅

- **The stale `/training/competency-matrix` removal from
  `UNCACHEABLE_PREFIXES` is correct, not a regression.** The backend route
  it named was retired in the same review window (`GET
/training/competency-matrix`, commit `530d6cf1`, "Retire GET
  /training/competency-matrix and CompetencyMatrixService") — confirmed by
  grepping `backend/app/api/v1/endpoints/training.py` for the path and
  finding no route. A denylist entry for a route that no longer exists is
  dead weight, not a safety margin; removing it does not reopen anything
  because nothing can reach that URL.
- **Every one of the 24 new GET call sites reaching the cached global
  client is covered or correctly left cacheable, traced individually rather
  than pattern-matched:**
  - `/elections/{id}/attendance` and
    `/elections/{id}/attendance/{userId}/meetings` (`electionService.ts`,
    per-member meeting attendance) — covered by the existing `/elections`
    prefix (no trailing slash, confirmed present at `apiCache.ts:106`).
  - `/inventory/members/{userId}/size-preferences` and
    `/inventory/my/size-preferences` (`inventoryService.ts`, body
    measurements) — covered by the existing `/inventory/members/` and
    `/inventory/my/` prefixes (`apiCache.ts:119-120`).
  - `/inventory/maintenance/never-inspected` (`inventoryService.ts`) —
    read the response type (`InventoryItem[]`, the item's own fields); no
    member-identifying field. Correctly left cacheable.
  - `/dashboard/community-engagement/events` (`adminServices.ts`) — read
    `CommunityEventReach` (`backend/app/api/v1/endpoints/dashboard.py:665`):
    aggregate counts (`signed_in`, `headcount`, `crew`, `member_hours`,
    `people_reached`) and an `outcome_note` free-text field describing the
    event, not a member. No member name field. Correctly left cacheable.
    Gated by `events.manage` on the backend.
  - `/events/outreach-calendar` (`eventServices.ts`) — read
    `OutreachCalendarItem` (`frontend/src/types/event.ts:1193`): event
    metadata, `request_organization` (an external org's name, a business
    contact, not member data), `volunteers_filled` (a count). No member
    name field. Correctly left cacheable.
  - `/events/{id}/staffing` (`eventServices.ts`) — covered by the `/staffing`
    substring this pass's own baseline diff shows added to
    `UNCACHEABLE_SUBSTRINGS` by other feature work (an outreach signup
    sheet's volunteers by name); confirmed present and that it is this
    route's only guard (no prefix also covers it).
  - `/training/reports/compliance-forecast` (`trainingServices.ts`,
    `getComplianceForecast`) — already covered by the existing
    `/training/reports/compliance-forecast` prefix (`apiCache.ts:83`).
  - `/training/shift-evaluations/preceptor-links/{entryId}`
    (`trainingServices.ts`, `getPreceptorLink`) — a one-time preceptor-link
    token, covered by the existing `/training/shift-evaluations/` prefix
    (`apiCache.ts:62`); freshness here also matters for a reason caching
    would defeat (a revoked/re-sent link must not read as still valid for up
    to 90s), consistent with the file's existing rationale for that prefix.
  - `/training/course-links` and `/training/course-links/history`
    (`trainingServices.ts`) — **read the backend handler and both response
    schemas** (`backend/app/api/v1/endpoints/training.py:584-699`,
    `CourseLinksView`/`CourseLinkName`/`CourseLinkHistory`/
    `CourseLinkHistoryItem` in `frontend/src/types/training.ts`). The live
    list (`CourseLinksView` → `CourseLinkName`) carries a course-name
    spelling and a bare member _count_ (`members: number`), never a member
    name — correctly left cacheable, gated by `training.manage`. The
    history (`CourseLinkHistory` → `CourseLinkHistoryItem`) carries
    `linked_by_name`/`undone_by_name` — the officer who made or undid a
    link — and **is** excluded, but not by a route-specific entry: the
    existing generic `/history` substring (`apiCache.ts:208`, "who did what
    to this, and why") already matches `/training/course-links/history`.
    Verified with `isCacheable()` directly (both before and after adding the
    pinned regression test below) rather than assumed from reading the
    list — this is exactly the class of route the generic substring exists
    to catch without needing its own entry, and is recorded here as a
    verified claim rather than left to future re-derivation.
  - `/scheduling/my-shift-history`, the leave-overlap check, and the three
    `evaluationsApi.ts` reassignment/candidate endpoints
    (`{candidates}`/`ReassignmentHolder[]`/`ReassignmentPlan`) — all reach a
    per-module `createApiClient()` instance (`modules/scheduling/services/
api.ts`, `modules/reports/services/evaluationsApi.ts`), confirmed by
    reading each file's own import line; never passes through the cached
    global client regardless of the denylist.
  - `/member-audience/options` and `/member-audience/preview`
    (`memberAudienceService.ts`, new file) — read the backend schema
    (`backend/app/schemas/member_audience.py`): `MemberAudienceOptions` is
    position/status _option_ metadata, `MemberAudiencePreview` is a bare
    recipient count. Neither names a member. The file's own header comment
    states this and is correct; `preview` is a `POST` regardless, so the
    response cache (GET-only) was never in play for it.
  - `/users/leaves-of-absence/settings`, `/users/leave-requests/*`
    (`leaveRequestService.ts`, new file) — covered by the existing
    `/users` prefix (no trailing slash, `apiCache.ts:33`), confirmed present
    and unchanged.
  - `/apparatus-events/*` (`apparatusEventServices.ts`, new file,
    templates/nights/calendar/members/crew-board/driver-candidates) —
    covered by the `/apparatus-events/` prefix this pass's own baseline diff
    shows added by other feature work; the new file's own header comment
    states the same rationale (crew boards name members) independently, and
    both agree.
  - `/api/public/v1/shift-evaluations/{token}` and its `/submit`
    (`publicShiftEvaluationService.ts`, new file) — deliberately bypasses
    the shared client (bare `axios`, not `./apiClient`'s cached instance),
    matching the existing unauthenticated-token-flow pattern (the applicant
    follow-up form). No cookies sent (`withCredentials` is not set on bare
    `axios`), consistent with a credential-by-token design; never reaches
    the response cache either way.
- **The per-account login lockout, held-skills-evaluation release, CSRF/
  auth plumbing, and `postLoginRedirect`/`loginPathReturningTo` open-redirect
  hardening are all unchanged since pass 15** (`authStore.ts`,
  `apiClient.ts` both byte-identical in the relevant sections; the only
  `authStore.ts`-adjacent change this pass is in `skillsTestingStore.ts`,
  below). Re-confirmed via empty `git diff` on `apiClient.ts`,
  `createApiClient.ts` and `ProtectedRoute.tsx` rather than assumed.
- **`skillsTestingStore.ts`'s version-conflict fix cannot let one examiner's
  save overwrite a different examiner's held work.** Read `saveTest`'s new
  `drainedVersionFor` branch and `applyPending`'s new `Math.max` guard in
  full: `drainedVersionFor` only ever returns a version produced by _this
  device's own_ queued write (the function's own comment and
  `recordDrainedVersion`'s call site confirm it is written only when this
  device's offline queue drains, never when a load observes another
  examiner's version), and the version is only ever raised
  (`Math.max(current.version, test.version)`), never lowered — so a save
  made after a drain, against the version the drain produced, can still
  land even if its own confirmation arrives out of order, but a version
  update can never regress what is displayed. Not a security finding (no
  cross-member data exposure — this is a same-examiner, same-device
  ordering fix), read in full because it is a net-new code path in a
  reviewed store.
- **The 8 new pure-utility files** (`attendanceWaiverWorkflows.ts`,
  `complianceForecast.ts`, `eventTemplates.ts`, `lazyOptional.ts`,
  `logoUrl.ts`, `outreachRoles.ts`, `popoverPlacement.ts`,
  `requirementPace.ts`) **touch neither the network nor browser storage**,
  confirmed by grep for `localStorage`/`sessionStorage`/
  `dangerouslySetInnerHTML`/`innerHTML`/`document.write`/`eval(`/`api\.` —
  zero hits in any of the eight.
- **No new `axios.create`/`createApiClient` call outside the unchanged six
  second-per-module clients**, no token written to `localStorage`/
  `sessionStorage` in production code, no hardcoded secret literal, no new
  XSS sink — all confirmed by the repo-wide sweeps in Method step 5.

## Considered, not a finding

- **`/training/course-links/history` names a staff member
  (`linked_by_name`/`undone_by_name`) and has no route-specific entry in
  `UNCACHEABLE_PREFIXES`.** Flagged as a candidate finding on first reading
  the schema, then traced to the generic `/history` substring already in
  place (`apiCache.ts:208`) and confirmed excluded by direct test — see
  Verified good above and the guard test below. Not a defect; recorded here
  rather than silently dropped, since the review's first pass through this
  route did treat it as a likely gap before verification.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — nothing to fix or flag this pass. `FE5-34-1`'s
recorded trade-off (inventory catalog caching) is unchanged, not
re-litigated.

## Documentation corrections

None needed.

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict` run as part of the completion gate
regardless: 821 revisions, single head `c4e7a9d2f1b8`, confirmed clean.

## Guard tests added

- `frontend/src/utils/apiCache.test.ts` — one new case pinning that
  `/training/course-links/history` is excluded (via the generic `/history`
  substring) while the live `/training/course-links` list stays cacheable.
  This documents a verified-good claim from this pass's own review, not a
  fix: the route was already correctly excluded before this test existed.

## Completion gate

| Check                                                             | Result                         |
| ----------------------------------------------------------------- | ------------------------------ |
| `flake8 app/ tests/ alembic/`                                     | ✅ 0 violations                |
| `black --check app/ tests/ alembic/`                              | ✅ clean, 3426 files unchanged |
| `isort --check-only app/ tests/ alembic/`                         | ✅ clean                       |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 821 revisions, single head  |
| `npm run typecheck` (whole frontend)                              | ✅ 0 errors                    |
| `npm run lint` (whole frontend, `--max-warnings 10`)              | ✅ 0 errors, 0 warnings        |
| Scoped frontend suite (14 files, the reviewed delta + guard test) | ✅ 448 passed                  |

No backend file in this feature's own scope was touched this pass; the
backend gate was still run in full per CLAUDE.md's completion-gate
requirement and confirmed clean (CI-pinned linter versions installed fresh
in this sandbox: `flake8==7.4.1`, `black==26.10.1`, `isort==9.0.2`,
`flake8-pytest-style==2.2.0`, matching `.github/workflows/ci.yml`). The
scoped frontend suite covers `apiCache` (96 tests, including the new guard
test), `apiClient`, `authStore`, the three `skillsTestingStore` suites,
`ProtectedRoute`, and the component/page tests exercising the four new
service files (`ApparatusEventsTab`, `LeaveRequestsPage`,
`LeaveRequestConversation`, `MemberAudiencePicker`) — run to confirm the
current tree (not merely the diff) still passes on all of them.

Diff scope for this pass: path-scoped diff against the declared file list
plus the repo-wide sweep's net found real deltas in `services/api.ts`,
`errorReporting.ts`, `apiCache.ts`, `errorHandling.ts`, and
`skillsTestingStore.ts`, plus 12 new top-level `services`/`utils` files —
all reviewed in full against all seven checklist dimensions, plus this
findings file and `PROGRESS.md`.
