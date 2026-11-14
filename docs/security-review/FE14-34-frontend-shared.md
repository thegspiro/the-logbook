# Security Review — Feature 34: Frontend Shared (pass 14)

**Prefix:** `FE14` · **Iteration:** 34 · **Reviewed:** 2026-11-04 · **PR:** #TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 14 `modules/*/services/api.ts` files
(re-enumerated: 13 at pass 13, now 14 — `modules/history/services/api.ts` is
new), the four second per-module clients, `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ offline-queue/shared-device purge utilities),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.get<`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-13 baseline.
**Backend:** none reviewed as in-scope — every new call site this pass's
diff adds reaches an endpoint whose own feature already owns review credit
(Grants & fundraising for `/grants/zeffy/*`, Scheduling for the time-off/
attendance additions, Finance for the approval resend-email route, Training
for shift evaluations, Membership pipeline for assignments/my-access). Not
re-reviewed here.
**Migrations:** none written or reviewed as in-scope (712 revisions, single
head `b5e906ebdd7d`, confirmed via `validate_migrations.py --strict` —
unrelated to this feature).

**0 fixes, 0 new findings.**

---

## Method

1. **Step 0 (rotation-level):** watchdog pickup — the dedicated
   `/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
   remains unreachable (confirmed via `ListAgents`, "No reachable agents").
   PR #4017 (Feature 33, Core infrastructure, pass 13) had just merged
   (`f67f4525`); a GitHub listing of open PRs returned nothing whose head
   branch starts with `claude/security-review-`, confirming Feature 34
   (Frontend shared) as the next `⬜` row on a freshly-fetched `main`.
2. **Established the baseline:** `baf80bf78` (the merge that landed
   `FE13-34-frontend-shared.md`, PR #3868).
3. **Re-verified prior art before reading new code:** read `CHECKLIST.md`
   and every standing item across FE2–FE13. `FE3-34-2`/`FE3-34-5` (fixed
   since pass 8) and `FE5-34-1` (recorded trade-off in `KNOWN_LIMITATIONS.md`)
   remain unchanged; not re-litigated.
4. **Diffed every feature-owned file** against the baseline. All of
   `apiCache.ts`'s existing lines, `apiClient.ts`, `createApiClient.ts`,
   `errorHandling.ts`, `errorTracking.ts`, the global `services/api.ts`
   barrel's existing exports, `ProtectedRoute.tsx`, `learningProgressStore.ts`,
   `pendingSyncStore.ts`, and `skillsTestingStore.ts` are byte-identical to
   pass 13. `apiCache.ts` gained 5 new `UNCACHEABLE_PREFIXES` lines (additive
   only — no line removed or narrowed); `authStore.ts`, `errorReporting.ts`,
   `practicalSkillsStore.ts`, `services/api.ts` (2 new re-exports) and six of
   the 14 module `services/api.ts` files carry real, additive deltas, all
   read in full below. One new module client, `modules/history/services/api.ts`
   (203 lines), appeared since pass 13 — re-enumerated the module directory
   fresh (14, up from 13) rather than trusting the prior count.
5. **Repo-wide sweep since the baseline** (`git diff baf80bf78..HEAD --
frontend/src`):
   - New `axios.create(`/`createApiClient(` call sites: exactly two, both in
     new module-service files (`modules/history/services/api.ts`,
     `modules/reports/services/evaluationsApi.ts`) — both use the shared
     factory, neither hand-rolls an axios instance.
   - New top-level files under `stores/`, `services/`, `utils/`, `contexts/`:
     14 files, the bulk of them a new offline-queue/background-sync layer
     (`genericOfflineStore.ts`, `equipmentCheckOfflineStore.ts`/
     `equipmentCheckFlush.ts`, `shiftReportOfflineStore.ts`/
     `shiftReportSync.ts`, `skillsTestOfflineStore.ts`/`skillsTestFlush.ts`,
     `backgroundSyncRegistration.ts`, `devicePushSubscription.ts`) plus
     smaller formatting/type-guard helpers (`fileTypeLabel.ts`, `requestId.ts`,
     `waiverStatus.ts`, `shiftEvaluationTemplates.ts`, `shiftEvaluations.ts`).
     All read; see Verified good.
   - New `localStorage.setItem`/`sessionStorage.setItem` call sites: all hits
     are inside `.test.ts`/`.test.tsx` fixtures or a device-identity/printer-
     preference key unrelated to a member's own data (`inventory:labelPreset`,
     `labels:printerDpi`) — no new per-member PII written to either storage
     in production code.
   - Hardcoded secret/token literal sweep: all hits are either prose naming
     an _environment variable_ (`GOOGLE_CLIENT_SECRET`, `AZURE_AD_CLIENT_SECRET`),
     a form `<label>`/`id` for an admin-typed credential field, or React state
     holding an admin's own typed input before it is POSTed to the backend for
     encryption (`zeffyApiKey`, `zeffyWebhookSecret` — the same established
     "never echoed back" pattern this feature's prior passes already verified
     for other integrations). Zero real literal secrets.
   - XSS sink sweep (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): two hits in production source (a third is
     inside a `.test.tsx` mock of a third-party barcode library, drawing a
     fixed SVG string, not production code) — both read in full, see
     Verified good.
6. **Completion gate** run per Step 6 below.

## Verified good ✅

- **The one new module axios instance uses the shared factory, same as every
  other module client this feature tracks.** `modules/history/services/api.ts`
  (`const api = createApiClient();`) — its own docstring states "cookies, CSRF
  header and the shared 401 refresh". No hand-rolled `axios.create()`
  anywhere in the diff; `createApiClient.ts` itself is byte-identical to pass
  13, so the inherited interceptor stack (CSRF, auth refresh) is unchanged.
  Same confirmed for the second new file, `modules/reports/services/evaluationsApi.ts`.
- **The three new offline queues (equipment checks, shift reports, skills
  tests) all extend FE3-34-5's ownership-stamping invariant correctly, not a
  parallel unowned path.** Each store file (`equipmentCheckOfflineStore.ts`,
  `shiftReportOfflineStore.ts`, `skillsTestOfflineStore.ts`) is a pure
  IndexedDB layer importing `OwnedQueueEntry`, split out (per
  `genericOfflineStore.ts`'s own docstring) so the service worker's
  background sync can share it without pulling in the auth store. The
  write path that actually stamps `ownerId` lives one layer up, in each
  queue's existing wrapper (`offlineQueue.ts`, `shiftReportOfflineQueue.ts`,
  `skillsTestOffline.ts` — all call `requireQueueOwner()`), and every send
  path filters by it before flushing: `EquipmentCheckForm.tsx:507`
  (`isOwnedByCurrentMember`) and `backgroundSync.ts:167`/`:149`/`:130`
  (`ownerId !== member`) for the background-sync path, `shiftReportSync.ts:62`
  and `skillsTestOffline.ts` (multiple call sites) for the other two. No
  queue sends an entry that does not belong to the signed-in member.
- **The new device push-subscription release/resync is deliberately kept out
  of `purgeLocalMemberData` and is non-throwing.** `devicePushSubscription.ts`'s
  own docstring states why: a push subscription belongs to the browser
  profile, not the member, so releasing it on a shared-device member switch
  (not on the signing-out member's own logout) is correct; both functions
  wrap their body in `try/catch` so a browser refusal or missing service
  worker cannot block sign-in. `authStore.ts`'s new call site
  (`claimDeviceForMember`) only releases when the device's stamped owner
  changes, matching the existing shared-device purge trigger it rides
  alongside.
- **The two new XSS-sink hits in production source are both safe.**
  `modules/history/components/ArchiveHtml.tsx`'s `dangerouslySetInnerHTML`
  renders only `sanitizeArchiveHtml(html)`'s output; that function
  (`modules/history/utils/historyFormat.ts:90-91`) is a thin wrapper over
  DOMPurify's `sanitize()` with an explicit `ALLOWED_TAGS`/`ALLOWED_ATTR`/
  `ALLOWED_URI_REGEXP` allowlist, confirmed by reading the call. The second
  `innerHTML =` hit is inside a `.test.tsx` file (a mock of the `JsBarcode`
  library drawing a fixed SVG string for a unit test), not production code.
- **The additive `UNCACHEABLE_PREFIXES` entries only widen the exclusion
  list, never narrow it** — `git diff` shows five new lines, zero removed or
  reworded, each with a PII/PHI rationale comment matching this file's
  existing convention. The new endpoints these additions cover
  (`/grants/zeffy/`, `/training/shift-evaluations/`,
  `/training/module-config/members/`, `/reports/saved`,
  `/public-portal/access-logs`) are each excluded.
- **Every genuinely new endpoint this pass's module-client diffs call is
  either already covered by an existing prefix-match exclusion, or reached
  only through a non-caching module client.** The new
  `prospective-members`/`history`/`reports`/`grants-fundraising` call sites
  either go through the module's own `createApiClient()` instance (never
  cached — confirmed `createApiClient.ts` wires no cache logic, unchanged
  from pass 13) or sit under `/prospective-members/` and `/grants/zeffy/`,
  both already-excluded prefixes on the global cached client.
- **The `errorReporting.ts` path-sanitizer addition only widens redaction.**
  Two new regex replacements (`/application-form/`, `/follow-up-forms/`)
  redact a follow-up form's personal link token before an error report is
  sent, extending the same pattern already verified for `/display/` and
  `/event-guest/`. No narrowing of any existing redaction.
- **No new `axios.create`/`createApiClient` call outside the two reviewed
  module clients**, no token written to `localStorage`/`sessionStorage` in
  production code, no hardcoded secret literal — all confirmed by the
  repo-wide sweeps in Method step 5.

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
regardless: 712 revisions, single head `b5e906ebdd7d`, confirmed clean.

## Guard tests added

None — no finding required a fix this pass. The offline-queue ownership
tests, the `ArchiveHtml`/`sanitizeArchiveHtml` tests, and the module-client
tests were all written by the feature work itself, not by this review, and
were read and judged adequate above rather than authored here.

## Completion gate

| Check                                                  | Result                         |
| ------------------------------------------------------ | ------------------------------ |
| `flake8 app/ tests/ alembic/` (via `/usr/bin/python3`) | ✅ 0 violations                |
| `black --check app/ tests/ alembic/`                   | ✅ clean, 2881 files unchanged |
| `isort --check-only app/ tests/ alembic/`              | ✅ clean                       |
| `python3 scripts/validate_migrations.py --strict`      | ✅ 712 revisions, single head  |
| `npm run typecheck` (whole frontend)                   | ✅ 0 errors                    |
| `npm run lint` (whole frontend, `--max-warnings 10`)   | ✅ 0 errors, 0 warnings        |
| Scoped frontend suite (29 files, the reviewed delta)   | ✅ 473 passed                  |

No backend file in this feature's own scope was touched this pass; the
backend gate was still run in full per CLAUDE.md's completion-gate
requirement and confirmed clean. The scoped frontend suite covers the new
`history` module, the new `evaluationsApi.ts`, the new offline-queue/
push-subscription files and their flush/sync companions, `apiCache`/
`apiClient`/`createApiClient`/`authStore`/`practicalSkillsStore`/
`ProtectedRoute`, `errorReporting`, and all six changed module `services/api.ts`
files' own test suites — run to confirm the current tree (not merely the
diff) still passes on all of them.

Diff scope for this pass: path-scoped diff against the declared file list
plus the repo-wide sweep's net found real deltas in 11 files (`apiCache.ts`,
`authStore.ts`, `errorReporting.ts`, `practicalSkillsStore.ts`,
`services/api.ts`, and six module `services/api.ts` files) plus 14 new
top-level files and one new module-service file and one new reports-service
file — all reviewed in full against all seven checklist dimensions, plus
this findings file and `PROGRESS.md`.
