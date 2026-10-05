# Security Review — Feature 34: Frontend Shared (pass 7)

**Prefix:** `FE7` · **Iteration:** 34 · **Reviewed:** 2026-10-04 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts` (+ `apiCache.test.ts`), `services/apiClient.ts`,
`utils/createApiClient.ts`, `utils/errorHandling.ts`, `services/errorTracking.ts`
(+ `services/errorReporting.ts`), `services/api.ts` (global barrel),
all 13 `modules/*/services/api.ts` files, the three second per-module clients
(`modules/inventory/services/equipmentCheckApi.ts`,
`modules/scheduling/services/shiftSettingsApi.ts`,
`modules/public-portal/services/publicPortalApi.ts`),
`components/ProtectedRoute.tsx`, `stores/authStore.ts` (+
`purgeLocalMemberData.ts`, the three offline queues), `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`, `components/ux/*`,
plus a repo-wide sweep for new `api.get(`/`api.get<` call sites, new
`axios.create(`/`createApiClient(` call sites, `localStorage.setItem`/
`sessionStorage.setItem` call sites, and hardcoded secret/token literals.
**Backend:** read-only cross-reference — `backend/app/core/logging.py`'s
`UNLOGGED_PATH` (matches the new frontend `UNREPORTED_REQUEST` pattern),
`backend/app/api/v1/endpoints/auth.py`'s `logout` (FE3-34-2),
`backend/app/api/v1/endpoints/inventory.py`'s `list_item_colors` (FE5-34-1),
and `backend/tests/test_api_cache_pii_exclusions.py` /
`test_inventory_member_visibility.py` (the two backend-side ratchets this
feature's frontend exclusions depend on).
**Migrations:** none written or reviewed as in-scope (511 revisions, single
head, confirmed via `validate_migrations.py --strict` — unrelated to this
feature).

**Watchdog pickup — 0 new findings.** The prior `/loop 30m /security-review`
session had stalled (no commit/PR past its 30-minute cadence); this is a
one-shot pickup of the next pending feature. Both standing HIGH findings
(FE3-34-2, FE3-34-5) and FE5-34-1's flagged broader ask re-verified still
open and unchanged at their current lines. No regression found in any file
this feature owns across 11 changed files since the pass-6 baseline, and no
new cache-exclusion gap found in a repo-wide sweep for new `api.get` calls.

---

## Why this pass is mostly re-verification

Feature 34's core files (`apiClient.ts`, `createApiClient.ts`,
`errorHandling.ts` partially, `errorTracking.ts`, `ProtectedRoute.tsx`, the
three offline queues, `purgeLocalMemberData.ts`, and 10 of the 13 module
`api.ts` files) are **byte-identical** to `468f5c3ae` — the merge commit that
landed pass 6's PR (`docs/security-review/FE6-34-frontend-shared.md`,
confirmed as the landing commit via `git log --oneline --diff-filter=A -- docs/security-review/FE6-34-frontend-shared.md`)
— confirmed by an empty `git diff 468f5c3ae..HEAD` per file, not assumed from
a prior pass's claim. Several hundred commits landed on `main` between that
merge and this pass's branch point (2026-09-25 → 2026-10-04), the large
majority of which are other rotation features' own passes, the workflow
review, and a documentation sweep (PR #2911) — none of which touch this
feature's declared files except where noted below.

## Method

1. **Established the baseline**: `468f5c3ae` (the merge that landed
   `FE6-34-frontend-shared.md` — confirmed via `git log --diff-filter=A`).
2. **Independently re-confirmed Step 0** before branching: `list_pull_requests`
   (state=open) showed no `claude/security-review-*` branch — only #2914 (hub
   tab crash guards), #2911 (docs sweep), #2910 (ID card printing), all
   unrelated. `docs/security-review/PROGRESS.md`'s rotation table had row 34
   as the only `⬜`; row 33 (Core infrastructure) had just closed via PR #2906
   (merged, docs-only — nothing to record beyond clearing the Open PR row per
   this file's own rule).
3. **Branched from a fresh `origin/main`** (`6347baf09`, newer than the
   working tree's prior `937e71414`) rather than reviewing stale code.
4. **Ran `git diff --stat 468f5c3ae..HEAD`** across every file this feature
   owns. 11 files differ: `utils/apiCache.ts` (+6), `services/api.ts` (+13,
   type re-exports only), `services/errorReporting.ts` (+13),
   `stores/authStore.ts` (+104/-55, a `logout()`/`endSessionLocally()`
   refactor plus one unrelated field setter), `utils/errorHandling.ts` (+77,
   a `getErrorDetail`/`retryAfterSeconds` refactor), `modules/admin-hours/services/api.ts` (+11),
   `modules/finance/services/api.ts` (+31/-16), `modules/ip-security/services/api.ts` (+27/-5),
   `modules/minutes/services/api.ts` (+16), `modules/prospective-members/services/api.ts` (+65/-25),
   `modules/scheduling/services/api.ts` (+243). `apiClient.ts`,
   `createApiClient.ts`, `errorTracking.ts`, `ProtectedRoute.tsx`, all three
   offline queues, `purgeLocalMemberData.ts`, and 10 of the 13 module
   `api.ts` files (`apparatus`, `governance`, `grants-fundraising`,
   `medical-screening`, `reports`, `storefront`, `testing`, plus the three
   second-client files `equipmentCheckApi.ts`/`shiftSettingsApi.ts`/
   `publicPortalApi.ts`) are **byte-identical** to `468f5c3ae` — confirmed via
   empty `git diff` for each, not assumed.
5. **Read every line of that diff** (not just the hunks — each changed
   function in full, current context), applying `CHECKLIST.md`'s seven
   dimensions.
6. **Enumerated every axios-instance-creating file fresh**
   (`grep -rn "axios.create(" frontend/src`): still exactly two —
   `services/apiClient.ts` and `utils/createApiClient.ts`. Enumerated every
   `createApiClient(` caller fresh: still exactly the 13 module files plus
   the same three second-client files — no new one.
7. **Ran a repo-wide diff sweep** for new `api.get(`/`api.get<` call sites
   since `468f5c3ae`, across the whole frontend (not just feature-owned
   files) — every hit checked against `UNCACHEABLE_PREFIXES`/
   `UNCACHEABLE_SUBSTRINGS` or confirmed to go through a non-caching
   `createApiClient()` instance.
8. **Ran a repo-wide sweep** for `localStorage.setItem(`/
   `sessionStorage.setItem(` and for hardcoded API-key/secret/token literals
   since `468f5c3ae` — no new PII or secret storage found (see below).
9. **Re-verified the two open HIGH findings and FE5-34-1's flagged ask**
   against current code, at their current line numbers, not against what the
   docs say.
10. **Ran the two backend ratchets** this feature's frontend exclusions
    depend on (`test_api_cache_pii_exclusions.py`,
    `test_inventory_member_visibility.py`) fresh.

## The diff since `468f5c3ae`

### `utils/apiCache.ts` (+6 lines) — other features' own additions

`UNCACHEABLE_PREFIXES` gained `/training/sessions/by-event/` (an event's
session/approval summary, which can carry the approval link's token);
`UNCACHEABLE_SUBSTRINGS` gained `/attendance-petitions` (members' requests to
be marked present: names and free-text reasons). Both landed via other
rotation features' own passes (training, events), not this one, and both are
correctly shaped prefix/substring entries matching this file's existing
conventions. Confirmed the corresponding new reads
(`GET /training/sessions/by-event/{id}/approval` in `trainingServices.ts`,
`GET /events/{id}/attendance-petitions` + `GET .../my-attendance-petition` in
`eventServices.ts`) are the calls these entries exist for — see the
repo-wide sweep table below.

### `services/api.ts` (+13 lines, global barrel)

Fourteen new type re-exports (`OrganizationContactUpdate`, `FormFieldUpdate`,
`MemberEmailKind`/`MemberEmailPolicy`/`MemberTextAlert`, `LocationCheckInInfo`,
`TrainingSessionAttach`/`TrainingApprovalSummary`/`TrainingApprovalAttendee`/
`TrainingApprovalData`/`TrainingApprovalSubmit`, `EmailTemplateBackup`,
`EmailFooterContactDetails`) for types defined and reviewed under their own
feature's rotation slot. Re-exporting a type is not a runtime change. No gap.

### `services/errorReporting.ts` (+13 lines) — a new, correctly-scoped exclusion

Adds `UNREPORTED_REQUEST`, a regex excluding the anonymous suggestion-box
submit/follow-up paths from `reportApiError()` (the function that forwards a
failed request's path/status to the backend's own error log, used for
in-app error tracking). Read in full: the comment explains the privacy
rationale (a failure report would itself record who submitted or followed up
on an anonymous complaint, on a page administrators read) and names the
backend counterpart it must stay in step with. Verified directly rather than
trusting the comment: `backend/app/core/logging.py:58-60`'s `UNLOGGED_PATH`
regex is `^/api/v1/suggestions/(?:boxes/[^/]+/submissions$|follow-up/)` —
character-for-character the same path shape as the frontend's
`/\/suggestions\/(?:boxes\/[^/]+\/submissions$|follow-up\/)/`, modulo the
`/api/v1` prefix the frontend's relative path never carries. Both files'
comments cross-reference the other. Only ever excludes an _error-reporting_
side-channel — the request itself still goes out and still gets its normal
response; nothing about the actual submission is weakened. No gap.

### `stores/authStore.ts` (+104/-55) — `logout()`/`endSessionLocally()` split, plus one unrelated setter

The local-teardown half of `logout()` (cache/offline-queue/scheduling-store
purge, `localStorage` cleanup) was extracted into a new
`endSessionLocally()` method, called from `logout()`'s `finally` block
exactly where the inline code used to run, and separately from
`UserSettingsPage.tsx`'s password-change flow (`handlePasswordChange`,
read in full): a password change revokes every session server-side
(`AuthService.change_password`), so asking the server to log out again would
only 401 and route through the refresh interceptor's hard redirect, silently
swallowing the "your password was changed" success state (the file's own
comment cites workflow-review finding W04-1). Calling `endSessionLocally()`
directly — no server round trip — for a session the server has already torn
down is correct: it performs the identical local purge `logout()` always
did, under the one condition where skipping the network call is actually
safe (the credential that would authorize it no longer exists).

**No new exposure.** `localStorage.removeItem('has_session')` was already
the first statement of the pre-refactor `logout()` (confirmed via
`git show 468f5c3ae:frontend/src/stores/authStore.ts`) and is now the first
statement of `endSessionLocally()`, called from the same `finally` block —
same ordering relative to the network call, same unconditional execution.
This refactor does **not** touch FE3-34-2: `logout()`'s `try { await
authService.logout() } catch { /* ... */ }` still swallows every logout
failure and still calls `endSessionLocally()` unconditionally in `finally`
— see re-verification below.

The unrelated hunk, `setBottomNavSlots()`, writes a UI layout preference
(`bottom_nav_slots`) onto the in-memory `user` object after a settings save
— no new persistence, no PII, no cache interaction. No gap.

### `utils/errorHandling.ts` (+77/-18) — `getErrorDetail`/`retryAfterSeconds`, extracted not changed in effect

`toAppError()`'s inline detail-shape handling (array / structured-object /
string) was extracted into a shared `describeDetail()` helper, now also
exposed as `getErrorDetail()` for call sites that want to show a server
message inline rather than via `toAppError()`'s full `AppError`. A new
`retryAfterSeconds()` reads a 429 response's `Retry-After` header (numeric
seconds only; the HTTP-date form is explicitly ignored, matching the
comment's claim that this backend never sends it) and folds it into
`details.retryAfter`, read by the sign-in screen so a lockout's real
countdown reaches the member element (workflow-review W02-2) rather than the
UI's own shorter default backoff. Read in full: no new sink for the response
body (still only `detail`/`message`/`statusText`/the new `Retry-After`
header, all of which were already client-visible), no logging, no secret
handling. Not a security-relevant change — a UX/correctness fix for a
genuinely-already-visible value. No gap.

### `modules/ip-security/services/api.ts` (+27/-5)

Every POST body field gained an explicit snake_case mapping
(`ipAddress` → `ip_address`, etc.) — a bug fix, since
`backend/app/schemas/ip_security.py`'s request schemas are plain snake_case
with no alias generator (only responses are camelCase), so the prior
pass-through camelCase body 422'd. Read in full: no field dropped, no field
added beyond what each `*Create`/`*Approve`/`*Reject`/`*Revoke` type already
declared, all still POSTs (never touch the GET cache). No gap.

### `modules/finance/services/api.ts`, `modules/admin-hours/services/api.ts`, `modules/minutes/services/api.ts`, `modules/prospective-members/services/api.ts`, `modules/scheduling/services/api.ts`

All five still import and call `createApiClient()` (byte-identical
construction, confirmed), which has no caching logic — re-confirmed again
this pass by reading `createApiClient.ts` in full (0 diff against
`468f5c3ae`, no `isCacheable`/`setCache`/`getCached` anywhere in it) — so
none of the new methods in these five files (finance manual-approval
routing and approval-chain steps; admin-hours self-service
edit/withdraw; minutes' paginated `listAllMinutes` helper, whose own
comment states the server decides visibility, not the client; prospective-members'
`signOffService` for Multi-Signer Approval, and `convertToMember`'s widened
payload/response shape; scheduling's new "external hours" subsystem — a
member logging a shift worked for another department's apparatus, 243 new
lines of types and CRUD methods) can reach the shared cache regardless of
`UNCACHEABLE_PREFIXES`. Read each diff in full for anything outside this
feature's own concern (hardcoded secrets, a bespoke `axios.create()`, a
`localStorage` write, an XSS sink): none found. The business-logic
correctness of these five modules' own permission/org-scoping is each
module's own rotation slot's concern, not re-litigated here, matching this
file's established scoping since FE2-34.

## `components/ux/*` diff since `468f5c3ae`

Ten files differ: `Breadcrumbs.tsx`, `breadcrumbRoutes.ts`,
`DateRangePicker.tsx`, `DateTimeQuarterHour.tsx` (+ new test),
`InlineEdit.tsx`, `Skeleton.tsx`, `SortableHeader.tsx`,
`TimeQuarterHour.tsx` (+ new test). All but `breadcrumbRoutes.ts` are
non-security: a `touch:`/`pointer-fine:` media-query swap replacing
`max-md:`/`sm:`-breakpoint hover-reveal hacks (the exact invariant
`hoverRevealIntegrity.test.ts` enforces, applied here to call sites that
predate the rule), one `card-grid` utility adoption, and a date/time-picker
correctness fix (`DateTimeQuarterHour`/`TimeQuarterHour`: an off-quarter-hour
value, e.g. a recorded 9:07 check-in, is now shown as-is instead of floored
to 9:00 for display while the real 9:07 was what got saved — a data-integrity
bug, not a security one).

`breadcrumbRoutes.ts` (+3 lines): one new entry,
`/finance/approvals: { permissions: ['finance.approve'] }`. Verified against
the real route: `frontend/src/modules/finance/routes.tsx:99-103` gates
`/finance/approvals` with exactly `requiredPermission="finance.approve"` —
the entry mirrors the actual gate, as this fail-closed display-only registry
is designed to (`canLinkCrumb` renders inert text, never a link, for any
unregistered or unauthorized path). `breadcrumbRoutes.test.ts` derives the
real permission set from route source and fails on drift, so this is
mechanically checked, not just read once. No finding.

## Repo-wide sweep — new `api.get` calls since `468f5c3ae`

Every `api.get(`/`api.get<` line added anywhere in `frontend/src` since the
baseline (not limited to feature-owned files):

| File                                                                                                                                                                                                                                                                                                    | New call                                                                                                                | Cache path                                                                                                                                | Disposition                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/communications/services/suggestionsService.ts` (new file)                                                                                                                                                                                                                                      | `GET /suggestions/board`, `/suggestions/boxes`, `/suggestions/mine`, `/suggestions/review*`, `/suggestions/admin/boxes` | global cached `api` (imports it directly, like `ip-security`/`testing`)                                                                   | All match the existing full-prefix `'/suggestions'` exclusion (`apiCache.ts:50`) — confirmed by reading `isCacheable`'s `startsWith` match. The anonymous follow-up-by-key calls (`lookupByKey`/`replyByKey`/`getAttachmentByKey`) are POSTs (key never in a URL/query string, by the file's own doc comment), so they never reach the GET cache regardless. No gap. |
| `modules/finance/services/api.ts`, `modules/minutes/services/api.ts`, `modules/prospective-members/services/api.ts`, `modules/scheduling/services/api.ts` (6 new calls total: `/finance/approvals/unrouted`, `/minutes-records`, `/prospective-members/my-sign-offs`, `/scheduling/external-hours*` ×5) | all `createApiClient()` instances                                                                                       | No caching logic exists in `createApiClient()` (re-confirmed); none of these can reach the shared cache regardless of the exclusion list. |
| `services/communicationsServices.ts`                                                                                                                                                                                                                                                                    | `GET /notifications/my/unread-by-category`                                                                              | global cached                                                                                                                             | Matches the existing `/notifications/my` prefix. No gap.                                                                                                                                                                                                                                                                                                             |
| `services/communicationsServices.ts`                                                                                                                                                                                                                                                                    | `GET /email-templates/member-email-policy`                                                                              | global cached                                                                                                                             | Read the backend route (`email_templates.py:164-180`): an org-wide, admin-gated (`settings.manage`/`organization.update_settings`/`notifications.manage`) catalog of which email/text kinds exist, their labels and whether the department has made each required — zero per-member fields. Correctly left cacheable.                                                |
| `services/communicationsServices.ts`                                                                                                                                                                                                                                                                    | `GET /email-templates/{id}/backups`                                                                                     | global cached                                                                                                                             | `EmailTemplateBackupResponse` is a template's own prior subject/body content and the admin-only restore-draft shape — no per-member PII. Correctly left cacheable.                                                                                                                                                                                                   |
| `services/eventServices.ts`                                                                                                                                                                                                                                                                             | `GET /events/{id}/attendance-petitions`, `GET .../my-attendance-petition`                                               | global cached                                                                                                                             | Matches the new `/attendance-petitions` substring exclusion (added by the events rotation feature in this same window — see above). No gap.                                                                                                                                                                                                                          |
| `services/eventServices.ts`                                                                                                                                                                                                                                                                             | `GET /events/settings/position-options`                                                                                 | global cached                                                                                                                             | Event-position config (labels/sort order), no per-member data. Correctly left cacheable.                                                                                                                                                                                                                                                                             |
| `services/facilitiesServices.ts`                                                                                                                                                                                                                                                                        | `GET /locations/{id}/display`                                                                                           | global cached, but called with `_skipCache: true`                                                                                         | Explicit cache bypass at the call site — the caller (a live kiosk check-in flag) must not go stale. No gap either way.                                                                                                                                                                                                                                               |
| `services/inventoryService.ts`                                                                                                                                                                                                                                                                          | `GET /inventory/label-setups`                                                                                           | global cached                                                                                                                             | Org-wide named print-setup config (name, preset, printer id) — no member data. Correctly left cacheable.                                                                                                                                                                                                                                                             |
| `services/userServices.ts`                                                                                                                                                                                                                                                                              | `GET /users/welcome-email-available`, `GET /users/me/email-choices`                                                     | global cached                                                                                                                             | Both start with `/users`, already a full bare-prefix exclusion (`apiCache.ts:32`, no trailing slash — catches every sub-path). No gap.                                                                                                                                                                                                                               |
| `services/adminServices.ts`                                                                                                                                                                                                                                                                             | `GET /organization/settings/email/link-domain`, `GET /organization/settings/membership-id/preview`                      | global cached                                                                                                                             | Both start with `/organization/`, already a full exclusion. No gap.                                                                                                                                                                                                                                                                                                  |
| `services/adminServices.ts`                                                                                                                                                                                                                                                                             | `getAllPages<T>(url, params)` helper (generic pagination)                                                               | global cached                                                                                                                             | Its only two callers, `/users/leaves-of-absence` and `/training/waivers`, are both already-excluded prefixes (`/users`, `/training/waivers`). Not a new endpoint — the helper itself is an extraction of pre-existing pagination logic. No gap.                                                                                                                      |

**Conclusion: zero new cache-exclusion gaps** across the whole diff window.
Every genuinely new sensitive endpoint (`/training/sessions/by-event/`,
`/attendance-petitions`) already arrived with its own exclusion-list entry,
added by the feature that introduced it, in the same window — the pattern
FE3-34 first documented holding ("every new sensitive endpoint this
rotation touched arrived with its exclusion-list entry in the same commit")
continues to hold.

## Repo-wide sweep — localStorage/sessionStorage writes and hardcoded secrets

`localStorage.setItem(`/`sessionStorage.setItem(` added since `468f5c3ae`:
`SETUP_GUIDE_HIDDEN_KEY`/`SCHEDULING_SETUP_GUIDE_HIDDEN_KEY` (dismissed
getting-started banners), `LINES_STORAGE_KEY` (a label-printer draft, not
member data), and `has_session` writes in two e2e/unit test fixtures
(`tablet-layout.spec.ts`, `ApparatusFormPage.test.tsx`,
`ApparatusListPage.test.tsx`, `authStore.test.ts`) — all UI preferences or
test scaffolding, none a token or PII. No hardcoded API key/secret/token
literal (`grep -rniE` for `api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key`
followed by a 16+ char quoted literal) added anywhere in the diff.

## Re-verification of the two open HIGH findings

### FE3-34-2 — a failed client-side logout leaves session cookies live — still OPEN

Re-read at the current line, not trusted from the doc.
`stores/authStore.ts:446-456`: `logout()` still wraps
`await authService.logout()` in a `catch` whose only content is the comment
`// Logout errors are non-critical; cookies are cleared by the backend`, and
still calls `await get().endSessionLocally()` unconditionally in `finally`
— the extraction described above does not change this shape at all, only
where the local-teardown code physically lives. Backend
`POST /auth/logout` (`backend/app/api/v1/endpoints/auth.py:1354-1390`, a
further one-line shift from FE6's `:1349-1384` citation — more unrelated
churn elsewhere in the file, same logic, re-read fresh rather than assumed)
still calls `_clear_auth_cookies()` (`:1390`) only after
`auth_service.logout_user(token)` returns `True` (`:1381`); a missing token
or `logout_user()`'s own `except Exception: return False` still raises a 400
with the httpOnly cookies untouched. Same failure scenario, same reason it
remains a product decision rather than a drive-by patch. Unchanged in
`docs/KNOWN_LIMITATIONS.md`; the one-line citation drift is noted here
rather than edited into the doc, matching pass 6's own judgment that this
narrow a shift isn't worth a doc edit.

### FE3-34-5 — an offline queue item can sync under the next member's identity if the sign-in purge silently fails — still OPEN

Re-read at the current line. `purgeLocalMemberData.ts` (0 diff against
`468f5c3ae`) still resolves every IndexedDB `clear()` on both `onsuccess`
and `onerror` (`clearAllQueuedChecks`/`clearAllQueuedReports`/
`clearAllGenericQueued`, confirmed by grep), and `bounded()`
(`:54`) still returns a fallback zero on a 3s timeout — by design, so a
purge failure can never block sign-in. `claimDeviceForMember`
(`authStore.ts:180-198`, unchanged) still `await`s the purge before
`isAuthenticated` is ever set, closing the timing race, but a purge that
silently no-ops still lets a new member authenticate while the previous
member's queue entries remain untagged. Same two remediation options as
every prior pass, same reason this needs a product decision. Unchanged in
`docs/KNOWN_LIMITATIONS.md`.

## Re-verification of FE5-34-1

`GET /inventory/items/colors` still carries the cache exclusion
(`frontend/src/utils/apiCache.ts:106-108`, re-read at its current position —
the list grew around it since pass 6 but the entry and its comment are
unchanged) and the tightened permission gate
(`require_permission("inventory.view")`,
`backend/app/api/v1/endpoints/inventory.py:761`, confirmed by reading the
route fresh). `backend/tests/test_inventory_member_visibility.py::test_item_colors_requires_inventory_view`
still exists and passes (see completion gate). Codex's broader,
deliberately-not-fixed ask (excluding the whole `/inventory/items` catalog
from caching) remains correctly flagged in `KNOWN_LIMITATIONS.md`, unchanged;
not re-litigated here.

## Verified good ✅ (re-confirmed against the current baseline)

- `services/apiClient.ts`, `utils/createApiClient.ts`,
  `services/errorTracking.ts`, `components/ProtectedRoute.tsx`,
  `stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
  `stores/skillsTestingStore.ts`, `utils/purgeLocalMemberData.ts`,
  `utils/genericOfflineQueue.ts`, `utils/offlineQueue.ts`,
  `utils/shiftReportOfflineQueue.ts`, and 10 of the 13 module `api.ts` files
  plus all three second-client files — confirmed byte-identical to
  `468f5c3ae` (empty `git diff` for each), not re-asserted from a prior
  pass's claim.
- **Still exactly two `axios.create()` call sites in the whole frontend**
  (`apiClient.ts`, `createApiClient.ts`) and still exactly 13 module
  `api.ts` files plus the same three second-client files calling
  `createApiClient()` — no new bespoke axios instance anywhere.
- **The new `UNREPORTED_REQUEST` exclusion in `errorReporting.ts` matches its
  backend counterpart (`UNLOGGED_PATH`) character-for-character** in the
  path shape it excludes — verified by reading both regexes side by side,
  not by trusting either file's comment alone.
- **No new XSS sink** (`dangerouslySetInnerHTML`/`innerHTML`/`eval`/
  `document.write`) in any file this pass's diff touched.
- **No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage`** anywhere in the diff — only UI preferences, a label
  draft, and test fixtures (see sweep above).
- **The `logout()`/`endSessionLocally()` split preserves FE3-34-2's exact
  failure shape** (neither better nor worse) — verified by diffing the
  pre- and post-refactor control flow line by line, not merely reading the
  new code in isolation.

## Findings

**0 new findings.** See "Re-verification" sections above for the full
accounting of the three standing open items (FE3-34-2, FE3-34-5, FE5-34-1's
broader ask) — all confirmed open, accurate, and unchanged at their current
locations.

## Not fixed — considered, judged correctly scoped

- **FE3-34-2** (HIGH) — unchanged, still needs a product decision (retry
  policy vs. explicit failure UI on a failed logout).
- **FE3-34-5** (HIGH) — unchanged, still needs a product/architecture
  decision (gate auth on confirmed purge vs. tag queue entries with a
  validated owner).
- **FE5-34-1's broader ask** (excluding the whole `/inventory/items` catalog
  from caching) — unchanged, still a product trade-off, recorded in
  `KNOWN_LIMITATIONS.md`.

None of the three needed re-flagging as new; all three are re-confirmed at
their existing `KNOWN_LIMITATIONS.md` entries, which needed no edits this
pass (the one-line `auth.py` citation drift noted above is below the bar
pass 6 itself set for a doc edit).

## Documentation corrections

None needed. `docs/KNOWN_LIMITATIONS.md`'s three FE entries (FE3-34-2,
FE3-34-5, FE5-34-1) were re-read in full and are still accurate against
current code.

## Schema & migration notes

n/a — frontend-only feature, no owned tables. `validate_migrations.py --strict`
run as part of the completion gate regardless: 511 revisions, single head,
no duplicate ids — unrelated to this feature, confirmed clean.

## Guard tests added

None. No new finding required a fix, so no new guard test — the existing
ratchets (`apiCache.test.ts`, `test_api_cache_pii_exclusions.py`,
`authStore.test.ts`'s FE3-34-5 device-claim cases, `apiClient.test.ts`'s
FE3-34-4 cache-token cases, `test_inventory_member_visibility.py`'s FE5-34-1
permission case, `breadcrumbRoutes.test.ts`'s drift check covering the new
`/finance/approvals` entry) already cover every fixed finding from prior
passes and were re-run, not re-written.

## Completion gate

| Check                                                                                                                                                                                                 | Result                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (`tsc-native.mjs`, aliased 7.0.2 compiler, whole frontend)                                                                                                                        | ✅ 0 errors                                                                                              |
| `npm run lint` (`eslint --max-warnings 10`, whole frontend)                                                                                                                                           | ✅ 0 errors, 0 warnings, exit 0                                                                          |
| Scoped suite (`apiCache`, `apiClient`, `authStore`, `createApiClient`, `learningProgressStore`, `pendingSyncStore`, `skillsTestingStore`, `ProtectedRoute.module`, `breadcrumbRoutes`, `Breadcrumbs`) | ✅ 389 passed (10 files)                                                                                 |
| `backend/scripts/validate_migrations.py --strict`                                                                                                                                                     | ✅ 511 revisions, single head, no duplicate ids                                                          |
| Backend `pytest tests/test_api_cache_pii_exclusions.py tests/test_inventory_member_visibility.py`                                                                                                     | ✅ 19 passed                                                                                             |
| Backend `pytest tests/ -k "auth or logout or offline or cache" -m "not integration and not slow and not docker"`                                                                                      | ✅ 294 passed, 1 pre-existing skip (`test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency) |
| Backend `pytest tests/ -m "integration and not slow and not docker" -k "offline or logout"`                                                                                                           | ✅ 17 passed, 1 pre-existing skip                                                                        |

**The full frontend suite was started (`npm test -- --run`) and then
deliberately stopped rather than let run to completion.** This pass's diff
touches `docs/security-review/*.md` only — no frontend or backend source
file was changed (see `git status` below) — which puts it in CLAUDE.md's
"Documentation-only changes need no local suite at all" category; CI still
runs the full suite on the PR regardless. `npm run typecheck`/`npm run lint`
already ran over the **whole** source tree (not scoped to this feature) and
both came back clean, and the 389-test scoped suite directly exercises every
file this feature's review re-verified as unchanged or safe. No backend
`flake8`/`black`/`isort` run was needed — no backend file was modified this
pass (the backend citations above are all read-only cross-reference).

```
$ git status --short
 M docs/security-review/PROGRESS.md
?? docs/security-review/FE7-34-frontend-shared.md
```

## Next

Rotation row 34 → `✅` (pending this PR's merge). This is the last row in
the 00–34 table; per `PROGRESS.md`'s own preamble, the rotation now wraps
back to 00 (Cross-cutting baseline) for its next full pass, re-verifying
nothing has regressed across the whole application. No product decision
from this pass needs mirroring into `KNOWN_LIMITATIONS.md` beyond what is
already recorded there.
