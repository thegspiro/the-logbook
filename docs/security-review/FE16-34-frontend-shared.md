# Security Review — Feature 34: Frontend Shared (pass 16)

**Prefix:** `FE16` · **Iteration:** 34 · **Reviewed:** 2026-11-23 · **PR:** (recorded after open)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 14 `modules/*/services/api.ts` files
(re-enumerated: 14, unchanged from pass 15), the six second-per-module clients
(re-enumerated: `historicalImportApi.ts`, `historyImportApi.ts`,
`equipmentCheckApi.ts`, `evaluationsApi.ts`, `shiftSettingsApi.ts`,
`publicPortalApi.ts` — unchanged from pass 15), `components/ProtectedRoute.tsx`,
`stores/authStore.ts`, `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
`stores/practicalSkillsStore.ts`, plus a repo-wide sweep for new
`api.get(`/`api.get<`/`api.post(` etc. call sites, new `axios.create(`/
`createApiClient(` call sites, new top-level files under `stores/`,
`services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-15 baseline.
**Backend:** none reviewed as in-scope — every backend endpoint a new
frontend call site in this diff reaches belongs to a feature that already
owns review credit for this lap (Training for the new Course Links module,
Apparatus & NFC/Scheduling for apparatus-events, Users & organizations for
leave requests, a new, as-yet-uncredited `member_audience.py` module read
directly below since nothing else claims it).
**Migrations:** none written or reviewed as in-scope. 821 revisions, single
head `c4e7a9d2f1b8`, confirmed via `validate_migrations.py --strict` — no
Alembic fork at this pass's baseline (the 3-head fork SEC-00 pass 17 flagged
was already resolved before pass 15's own baseline).

**0 fixes, 0 new findings.**

---

## Method

1. **Step 0 (rotation-level):** a fresh `list_pull_requests` (state `open`)
   found 15 open PRs, none with a head branch starting
   `claude/security-review-`. PR #4580 (Feature 33, Core infrastructure, pass 15) had already merged (`c01ab8df1`) before this iteration's working tree
   was fast-forwarded to it, confirming row 33 as ✅ and row 34 (Frontend
   shared) as the next `⬜` row. This session's local clone was 957 commits
   behind `origin/main`, including that exact merge — fast-forwarded before
   anything else, per CLAUDE.md's "Hard Stop"-adjacent discipline: the first
   draft of this edit marked row 33 `🔄` from a stale read and was reverted
   once the fast-forward surfaced the real state.
2. **Established the baseline:** `f3030998` — the merge of PR #4259
   (`FE15-34-frontend-shared.md`, pass 15).
3. **Re-verified prior art before reading new code:** read `CHECKLIST.md` and
   `FE15-34-frontend-shared.md` in full. `FE5-34-1`'s recorded trade-off
   (broader cache exclusion for the inventory catalog, carried in
   `KNOWN_LIMITATIONS.md`) is unchanged; not re-litigated.
4. **Diffed every feature-owned file** against the baseline
   (`git diff f3030998..HEAD`). This window is unusually wide — 1592 commits
   (832 non-merge) over 12 days, 967 frontend files touched — because the
   rotation lap between SEC-00 pass 17 and this pass landed a full cycle of
   other features' own passes plus ordinary feature work. `createApiClient.ts`,
   `services/apiClient.ts`, `ProtectedRoute.tsx`, `stores/authStore.ts`,
   `utils/postLoginRedirect.ts`, `utils/purgeLocalMemberData.ts`, and 10 of the
   14 module `services/api.ts` files are byte-identical to pass 15 (confirmed
   by an empty `git diff` on each, not assumed from the file list). Real,
   additive deltas were read in full in: `apiCache.ts` (one entry removed —
   `/training/competency-matrix`, the endpoint it guarded was retired by owner
   decision 2026-11-21 and `test_competency_matrix_endpoint_retired.py` confirms
   the route is gone, not merely renamed — plus two new entries,
   `/apparatus-events/` and the `/staffing` substring, both added by the
   feature work that introduced those surfaces), `services/api.ts`
   (re-export additions for two new top-level services), `errorReporting.ts`
   (two new `sanitizePath` redactions for the preceptor shift-evaluation link
   token, mirroring the existing guest-QR/follow-up-form pattern),
   `errorHandling.ts` (two new user-facing message builders,
   `getLoadFailureMessage`/`getActionFailureMessage`, plus a field-name-to-label
   rendering for 422 validation messages — a UX change, not a data-exposure
   one: it only reformats text the server already sent), and
   `skillsTestingStore.ts` (an offline-sync version-conflict fix for the
   service-worker drain race, not security-relevant).
5. **Repo-wide sweep since the baseline** (`git diff f3030998..HEAD --
frontend/src`, 967 files / 832 non-merge commits):
   - **New `axios.create(`/`createApiClient(` call sites:** zero. The one new
     bare-`axios` call site (`publicShiftEvaluationService.ts`) is a new
     top-level file, reviewed below, not a new instance-construction pattern —
     it deliberately bypasses both `api` and `createApiClient()` the same way
     the applicant follow-up form does, because the token itself is the
     credential for an unauthenticated, no-session page.
   - **Module client count:** re-enumerated `modules/*/services/api.ts`
     fresh — 14, unchanged. **Second-per-module client count:** re-enumerated
     fresh (`grep -rl "createApiClient(" src/modules/`) — 6, unchanged (the 3
     found beyond pass 15's explicit list — `equipmentCheckApi.ts`,
     `evaluationsApi.ts`, `shiftSettingsApi.ts` — are confirmed pre-existing
     via `git merge-base --is-ancestor`, predating even the pass-15 baseline;
     `publicPortalApi.ts` likewise unchanged).
   - **New top-level files under `stores/`, `services/`, `utils/`,
     `contexts/`:** 12 non-test files
     (`services/apparatusEventServices.ts`, `services/leaveRequestService.ts`,
     `services/memberAudienceService.ts`, `services/publicShiftEvaluationService.ts`,
     `utils/attendanceWaiverWorkflows.ts`, `utils/complianceForecast.ts`,
     `utils/eventTemplates.ts`, `utils/lazyOptional.ts`, `utils/logoUrl.ts`,
     `utils/outreachRoles.ts`, `utils/popoverPlacement.ts`,
     `utils/requirementPace.ts`). All read; see Verified good. The four
     `utils/` files among them with no network/storage touch
     (`eventTemplates`, `lazyOptional`, `outreachRoles`, `popoverPlacement`,
     `requirementPace`, `complianceForecast`, `attendanceWaiverWorkflows`) were
     confirmed free of `localStorage`/`sessionStorage`/`eval(`/
     `dangerouslySetInnerHTML`/`innerHTML =`/`document.write(` by direct grep,
     not by name alone.
   - **New `localStorage.setItem`/`sessionStorage.setItem` call sites
     (production code):** one —
     `modules/history/pages/HistoryTimelinePage.tsx`'s `writeFilters`, which
     persists only the viewer's own filter toggles (`milestones`, `kinds`,
     `eventTypeId`) under `history.timeline.filters`, wrapped in `try/catch`
     with a comment stating it is a convenience only. No member data.
   - **Hardcoded secret/token literal sweep:** no real literal secret; every
     hit outside test fixtures is `apiKey:` meaning "the backend field name
     this form field maps to" (a form-builder config key, not a credential
     value), confirmed by reading the surrounding object literal in each case.
   - **XSS sink sweep** (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): zero new hits in production source since the
     pass-15 baseline.
   - **New endpoint surface vs. `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`:**
     extracted every new `api.get(`/`api.get<` call site's URL added since the
     baseline and checked each **programmatically** against the current
     prefix/substring lists, using the exact `startsWith`/`includes` semantics
     `isCacheable()` uses (`apiCache.ts:346,349`) — not by eye. See "A false
     lead, caught by Pitfall #37" below for a finding this method raised and
     then retracted once tested. All real new endpoints resolve to one of:
     an existing broad prefix (`/history` substring covers every new History
     module route — imports, media, documents, apparatus, events, timeline,
     people; `/evaluations` covers the new evaluations-export/reassignment
     routes; `/users` covers the new leave-request routes; `/scheduling/`
     covers the new shift-history routes; `/integrations`/`/scheduling/`
     cover the two historical-import undo routes; `/training/waivers`/
     `/meetings` cover the attendance/meeting waiver policy routes), this
     pass's own 2 additive entries (`/apparatus-events/`, the `/staffing`
     substring — both landed by the feature work itself, not by this review),
     or a response confirmed to carry no member PII
     (`/dashboard/community-engagement/events` — aggregate counts only, no
     member names; `/events/outreach-calendar` — counts only; `/member-audience/`
     — explicitly designed to return only a count, confirmed by reading the
     new backend endpoint directly, below; the bare `/training/course-links`
     list — course-name aggregates with no member field).
6. **Completion gate** run per Step 6 below.

## A false lead, caught by Pitfall #37

The by-eye pass over the new-endpoint sweep flagged
`/training/course-links/history` (`CourseLinkHistoryItem.linked_by_name`/
`undone_by_name` — the officer who linked or undid a course-name match) as an
apparent gap in `UNCACHEABLE_PREFIXES`, the same shape as the `/evaluations`
exclusion's own officer-name blind spot. A fix (`apiCache.ts` entry) and a
guard test (a `PINNED_EXCLUSIONS` entry in
`test_api_cache_pii_exclusions.py`, matching that file's own convention) were
written, then — per CLAUDE.md Pitfall #37 ("a test counts as evidence only
once it has been seen to fail without the change") — the fix was stashed and
the new guard test run against the unfixed tree to confirm it actually failed
red first.

It did not fail. `test_pinned_pii_routes_stay_excluded_from_the_frontend_cache`
passed even with the `apiCache.ts` entry removed, because
`/training/course-links/history` already contains the literal substring
`/history` (the deliberately broad `UNCACHEABLE_SUBSTRINGS` entry documented
at `apiCache.ts`'s own comment: "a history endpoint is a member-attributed
audit trail by construction, so a new one should have to opt _in_ to caching
rather than silently inherit it"). Confirmed with a standalone interpreter
check against the real `_is_excluded()` logic (`['/history' in url]` → `True`).
Both the `apiCache.ts` addition and the test addition were reverted — neither
fixes a real gap, and leaving them would have added a redundant,
un-exercised line to a file whose own docstring says a route that stops
flagging must be removed, not kept as decoration (`test_pinned_routes_all_still_exist`'s
sibling rule, `test_baseline_has_no_stale_entries`).

**0 fixed, 0 new findings — the one apparent lead this pass raised did not
survive being tested against the unfixed code.**

## Verified good ✅

- **`member_audience.py` (new backend module, no existing rotation row, read
  directly since nothing else claims it) returns only a count, never a
  member list, matching its own module docstring.** Both routes
  (`GET /options`, `POST /preview`) gate on
  `require_permission("events.manage", "apparatus_events.manage")`
  (checklist §2's OR-gate, both alternatives read — either permission is
  appropriate to the data, since neither route names a member), resolve the
  caller's own `organization_id` before calling the service (checklist §3),
  and `POST /preview`'s response model (`MemberAudiencePreview`) carries only
  `recipients: int` and `skipped_opted_out: int` — confirmed by reading the
  schema and the route handler in full, not merely the docstring's claim.
  `ValueError` is sanitized through `safe_error_detail()` before reaching the
  client.
- **`apparatusEventServices.ts` and `leaveRequestService.ts` (new top-level
  files) both route through the shared, interceptor-wired `api` client**
  (`import api from './apiClient'`), not a hand-rolled instance — confirmed
  by reading each file's imports. Both mount under prefixes already excluded
  from the response cache (`/apparatus-events/` added this pass by the owning
  feature; `/users` pre-existing, no trailing slash).
- **`publicShiftEvaluationService.ts` (new) correctly bypasses the
  authenticated client for an unauthenticated, token-is-the-credential page**,
  matching the established pattern the applicant follow-up form already uses
  — confirmed by reading the file's own header comment and verifying the
  backend route it calls (`app/api/public/shift_evaluations.py`) is mounted
  under `api/public/`, already credited to Feature 03 (Public surface &
  webhooks, ✅ this lap). `errorReporting.ts`'s two new `sanitizePath`
  redactions (`/shift-evaluation/`, `/public/v1/shift-evaluations/`) correctly
  strip the bearer token from this page's URL before any client-side error
  report is sent, mirroring the existing guest-QR/application-form/
  follow-up-form redactions in the same function.
- **`utils/logoUrl.ts`'s new `isValidLogoUrl()` is a net security
  improvement, not a new surface.** It rejects `javascript:` and
  `data:text/html` URIs and SVG data URIs (which can carry script even when
  rendered as `<img src>`) while accepting `http(s)`, same-origin paths and
  raster image data URIs; both of its two call sites
  (`AppLayout.tsx`, `CommunityEngagementPrintPage.tsx`) gate an org-configured
  logo URL through it before use. `logoUrl.test.ts` exercises the
  `javascript:`/`data:text/html`/`data:image/svg+xml` rejections directly.
- **The new `HistoryTimelinePage.tsx` filter-persistence (`writeFilters`/
  `readFilters`) carries no member data**, is wrapped in `try/catch` on both
  read and write (a private window or blocked storage degrades to the
  in-memory default rather than throwing), and is not wired into
  `purgeLocalMemberData()` — correctly so, since it names no member and so has
  nothing a shared-terminal sign-out needs to clear.
- **`errorHandling.ts`'s `getLoadFailureMessage`/`getActionFailureMessage`
  and the `fieldLabel`/`describeValidationError` rework reformat text the
  server already decided to send; they introduce no new value the client
  did not already have.** The 403 branch's "reason" text comes from the
  pre-existing `getErrorDetail()`, which reads `response.data.detail` —
  exactly what every other 403 handler in this codebase already surfaces, and
  what the backend already ran through `safe_error_detail()` before sending.
  `fieldLabel()`'s dynamic `RegExp` construction escapes every regex
  metacharacter in the field name before building the pattern
  (`field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`), so a field name containing
  a regex-special character cannot produce an unintended match or throw.
- **No new `axios.create`/`createApiClient` call outside the one reviewed,
  deliberately-bypassing public service**, no new token written to
  `localStorage`/`sessionStorage` in production code, no new hardcoded
  secret literal, no new XSS sink — all confirmed by the repo-wide sweeps in
  Method step 5.
- **`ProtectedRoute.tsx`, `authStore.ts`, `createApiClient.ts`,
  `postLoginRedirect.ts` and `purgeLocalMemberData.ts` are byte-identical to
  pass 15** (confirmed by empty `git diff` on each, not assumed): auth-before-
  permission-before-module-gate ordering, the per-account login lockout
  shape, the shared-factory CSRF/credentials wiring, the open-redirect
  guard's `isAppPath()`/`hasUnsafeChar()` checks, and the bounded,
  non-throwing IndexedDB purge on logout all carry forward unchanged.

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
regardless: 821 revisions, single head `c4e7a9d2f1b8`, confirmed clean.

## Guard tests added

None landed — the one guard test drafted for the `/training/course-links/history`
lead was reverted once Pitfall #37 showed the route was already covered (see
above). No other finding required a fix this pass.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                              | Result                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`, 3.13.18, CI's pin)                                                                                                                                                                                                                                                                                                          | ✅ 0 violations                              |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                               | ✅ clean, 3426 files unchanged               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                          | ✅ clean                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                  | ✅ 821 revisions, single head `c4e7a9d2f1b8` |
| Cross-cutting guard tests (`test_api_cache_pii_exclusions.py`, `test_like_escaping.py`, `test_csv_writer_sweep.py`, `test_database_schema.py`, `test_org_scoping_ratchet.py`, `test_capacity_locking.py`, `test_endpoint_auth_coverage.py`, `test_migration_create_all_tables.py`, `test_baseline_member_grants.py`, `test_alembic_migrations.py`, `test_account_status_gates.py`) | ✅ 253 passed                                |
| `cd frontend && npm run typecheck` (whole frontend)                                                                                                                                                                                                                                                                                                                                | ✅ 0 errors                                  |
| `cd frontend && npm run lint` (whole frontend, `--max-warnings 10`)                                                                                                                                                                                                                                                                                                                | ✅ 0 errors, 0 warnings                      |
| Scoped frontend suite (12 files: `apiCache`, `apiClient`, `authStore`, `ProtectedRoute`, `postLoginRedirect`, `purgeLocalMemberData`, `skillsTestOffline`, `skillsTestingStore`, `errorReporting`, `errorHandling`, `attendanceWaiverService`, `serverFieldErrors`)                                                                                                                | ✅ 423 passed                                |

No backend file in this feature's own scope was touched this pass (the one
drafted change was reverted); the backend gate was still run in full per
CLAUDE.md's completion-gate requirement and confirmed clean.

**Environment note**, consistent with every recent pass: `/usr/bin/python3`
(3.13.18, matching `requirements.txt`'s pins) is the interpreter with
`flake8`/`black`/`isort` installed at CI's pinned versions. Used explicitly
for every backend tool invocation.
