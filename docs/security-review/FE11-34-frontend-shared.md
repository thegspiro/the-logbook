# Security Review — Feature 34: Frontend Shared (pass 11)

**Prefix:** `FE11` · **Iteration:** 34 · **Reviewed:** 2026-10-25 · **PR:** #3682

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 13 `modules/*/services/api.ts` files,
the four second per-module clients, `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ offline-queue ownership/quarantine utilities),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.get<`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-10 baseline.
**Backend:** read-only cross-reference only — the server half of the new
step-up re-verification control (`POST /auth/step-up`, `require_stepup`,
`STEPUP_WINDOW_MINUTES`) was already reviewed under Feature 33 (Core
infrastructure, pass 9, `CI9-33-core-infra.md`); no backend file was read or
changed by this pass beyond confirming that prior review covers it.
**Migrations:** none written or reviewed as in-scope (651 revisions, single
head `3d67883cd461`, confirmed via `validate_migrations.py --strict` —
unrelated to this feature).

**0 fixes, 0 new OPEN/FLAGGED findings.**

---

## Method

1. **Step 0 (rotation-level):** `search_pull_requests`
   (`is:pr is:open head:claude/security-review-`) returned 0 results, both at
   the start of this pass and re-checked immediately before branching/pushing.
   PR #3681 (Feature 33, Core infrastructure, pass 9) had merged
   (`8ae42b51`), leaving Feature 34 as the only `⬜` row — confirmed against
   the feature table in `PROGRESS.md` after pulling `origin/main` fresh (the
   working tree started 7 commits behind `main` on an unrelated branch; synced
   before reading anything).
2. **Established the baseline**: `1b1c27d4` (the merge that landed
   `FE10-34-frontend-shared.md`, confirmed via `git log --diff-filter=A --
docs/security-review/FE10-34-frontend-shared.md`).
3. **Re-verified prior art before reading new code**: read `CHECKLIST.md`,
   `SEC-00-cross-cutting-baseline.md`'s relevant sections, and every standing
   item across `FE2`–`FE10`. As of `FE10`, 0 items were OPEN — `FE3-34-2` and
   `FE3-34-5` (the two pass-7 HIGH findings) were confirmed fixed on `main` by
   pass 8 and re-confirmed unchanged by passes 9 and 10; `FE5-34-1` (the
   broader "exclude the whole inventory catalog from caching" ask) remains a
   recorded product trade-off in `KNOWN_LIMITATIONS.md`, not re-litigated.
4. **Diffed every feature-owned file** against the baseline (`git diff --stat
1b1c27d4..HEAD -- <each file>`). Enumerated the current file set fresh
   first (13 module `services/api.ts` files, 4 second-client files,
   unchanged from pass 10's count) rather than trusting the prior pass's list.
   Seven files changed:
   - `services/apiClient.ts`, `utils/createApiClient.ts`,
     `utils/apiCache.ts` — a new cross-cutting control (step-up
     re-verification) plus three new `UNCACHEABLE_PREFIXES`/`_SUBSTRINGS`
     entries. Read and audited in full below.
   - `stores/practicalSkillsStore.ts` — a defensive type-narrow on a
     cross-store selector read (test-double hardening), no security content.
   - `modules/finance/services/api.ts` — five new methods
     (`routePreview`, `claimReimbursement`, `updateLineItem`,
     `deleteLineItem`, `cancel` ×2, `payByCheck`), all through the module's
     existing `createApiClient()` instance (unchanged factory call); business
     logic inside Finance's own rotation slot (#05), not this one's.
   - `modules/inventory/services/equipmentCheckApi.ts` — one new response
     field (`isOverdue: boolean`) on an existing type; no new call site.
   - `services/nfcActivityService.ts` — new file (see below).
     Everything else named in the scope line above is byte-identical to the
     baseline (0-line diff-stat for each): `apiCache.ts`'s pre-existing content,
     `services/api.ts` (barrel), `ProtectedRoute.tsx`, `authStore.ts`, the
     offline queues, the other 12 module `api.ts` files, and all four other
     second-client files.
5. **Enumerated every axios-instance-creating file fresh**
   (`git grep -l "createApiClient(\|axios.create("` at the baseline commit vs.
   `HEAD`): both return the identical 19-file set (2 factory definitions + 2
   factory-call test files + 13 module `api.ts` files + 4 second-client
   files, minus the definitions' own files counted once) — no new axios
   instance anywhere in the frontend.
6. **Ran a repo-wide diff sweep** for new/changed `api.<verb>(`/`api.<verb><`
   call sites since the baseline, across the whole frontend tree (not just
   feature-owned files). Found ~35 hits across 6 non-feature files
   (`authService.ts`, `inventoryService.ts`, `medicalSuppliesService.ts`,
   `nfcActivityService.ts` (new), `trainingServices.ts`,
   `finance/services/api.ts`). For each, traced which axios instance it uses
   and, for ones on the global cached client, checked the URL against
   `UNCACHEABLE_PREFIXES`/`_SUBSTRINGS` by applying the actual `startsWith`/
   `includes` matching `isCacheable()` uses, not by inspection alone — see
   findings below.
7. **Ran a repo-wide sweep** for new top-level files under `stores/`,
   `services/`, `utils/`, and `contexts/` since the baseline. Found four:
   `contexts/StepUpContext.tsx` (part of the step-up control, audited below),
   `services/nfcActivityService.ts` (new service, audited below),
   `utils/stepUp.ts` (part of the step-up control, audited below), and
   `utils/positions.ts` (a UI filter helper over an already-resolved
   `mirrors_rank` boolean — no auth, no data fetch, no security content).
8. **Ran a repo-wide sweep** for `localStorage.setItem(`/`sessionStorage.
setItem(`, hardcoded API-key/secret/token literals, and new XSS sinks
   (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
   the baseline — zero hits in all four categories.
9. **Ran the full backend+frontend completion gate** (below).

## Findings

None. Every change since the pass-10 baseline is either out of this feature's
scope (Finance's own new endpoints through its existing, already-audited
module client) or was checked against all seven `CHECKLIST.md` dimensions and
found correct.

## Verified good ✅

- **The shared-client surface's only behavioral change is the new step-up
  control, and it is server-enforced, not client-trusted.** `services/
apiClient.ts` and `utils/createApiClient.ts` each gained an identical
  response-interceptor branch: on a 403 whose body carries
  `code: 'LB-AUTH-013'` (`utils/stepUp.ts`'s `isStepUpRequired()`, checked via
  `axios.isAxiosError` + an `unknown`-typed body narrow — no unsafe cast), the
  client calls `requestStepUp()` once (guarded by a per-request
  `_stepUpTried` flag mirroring the existing `_retry` pattern) and retries the
  original request only if it resolves `true`; a declined or unavailable
  prompt rejects with the original error. Read `backend/app/api/dependencies.py`
  and `backend/app/services/auth_service.py` (read-only cross-reference,
  already reviewed in full under `CI9-33-core-infra.md`) to confirm the 403
  is the server's own decision (`require_stepup` / `_stepup_is_fresh()`
  reading `stepup_verified_at` off the session row) — a client that never
  calls `requestStepUp()`, or a forged/omitted response, cannot grant access
  to a `require_stepup`-gated route; the client only improves the UX around a
  decision the server already made, the same shape CLAUDE.md's onboarding-gate
  precedent describes.
- **`requestStepUp()` dedupes concurrent callers** (`utils/stepUp.ts:39-45`):
  a module-level `inFlight` promise, set on first call and cleared in
  `.finally()`, means three requests failing at once with 403 show the member
  one dialog, not three — the same shared-promise shape `performSharedRefresh()`
  already uses for token refresh, applied to the new control for the same
  reason (concurrent prompts would be confusing and, for the password path,
  would hand three independent attempts to a lockout counter).
- **`StepUpProvider` is mounted once, at the app root, above the router**
  (`App.tsx:110`, inside `ConfirmProvider` and outside `AppLayout` — same
  placement rationale as the existing `ConfirmProvider`/Pitfall #16: a public
  route gets the same provider as an authenticated one, and nothing can call
  `requestStepUp()` before a prompt exists to answer it). The proof field
  (`StepUpContext.tsx:108-123`) uses `type="password"` /
  `autoComplete="current-password"` for the password path and
  `inputMode="numeric"` / `autoComplete="one-time-code"` / `maxLength={6}`
  for the MFA path — matching the existing MFA-code input conventions
  elsewhere in the app, not re-typed.
- **No new call site reaches an endpoint that should be in
  `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` but isn't.** Traced every
  new/changed GET on the global cached client (`services/apiClient.ts`) by
  applying the real matching rule (`url.startsWith(prefix)` /
  `url.includes(pattern)`), not by inspection:
  - `GET /inventory/nfc-tags*` (`export`, bare list, `/move-targets`) —
    covered by the existing `/inventory/nfc` prefix (`apiCache.ts:118`,
    explicitly documented as also covering `/inventory/nfc-tags/`).
  - `GET /nfc-tags/taps(/export)`, `/nfc-tags/coverage`, `/nfc-tags/settings`
    — covered by the existing `/nfc-tags` prefix (`apiCache.ts:45`).
  - `GET /nfc-activity/readers`, `/nfc-activity/readers/{id}/taps`,
    `/nfc-activity/event-taps` (all in the new `nfcActivityService.ts`) —
    covered by the `/nfc-activity` prefix this pass's baseline diff shows was
    already added (`apiCache.ts:46`) before this pass started; re-verified the
    three call sites against it directly rather than trusting the file's own
    header comment.
  - `GET /auth/session-settings` — covered by the existing `/auth/` prefix.
  - `GET /training/sessions/by-event/{id}` and `.../approval` — covered by
    the existing `/training/sessions/by-event/` prefix (exact match, no
    typo).
  - `GET /inventory/kits/{id}/issue-plan` — covered by the `/issue-plan`
    substring (`apiCache.ts:165`, added in this baseline window) and has its
    own regression test (`apiCache.test.ts:685`).
  - `GET /inventory/kits/product-options` — read `KitProductOption`
    (`eventServices.ts:1513-1520`): catalog metadata (name, category,
    per-variant stock counts) with no member identity. Correctly left
    cacheable.
  - `GET /medical-supplies/recalls` — read `MedicalLotRecall`
    (`medicalSuppliesService.ts:94-107`): lot/unit/reason fields describing
    recalled _supplies_, no `user_id` or member name anywhere in the shape —
    distinct from `medical-screening` (PHI, already excluded). Correctly
    left cacheable.
  - `GET /organization/settings/file-storage/status` — the exact string is
    already a dedicated `UNCACHEABLE_PREFIXES` entry (`apiCache.ts:53`,
    added in this baseline window); re-verified the one call site in
    `useFileStorageAdapterStatus`-style code matches the entry exactly
    (no trailing-slash or query-string mismatch).
  - `GET /finance/approval-chains/route-preview` and every other new Finance
    GET — go through `modules/finance/services/api.ts`'s own
    `createApiClient()` instance, which carries **no** cache interceptor at
    all (confirmed by reading `utils/createApiClient.ts` in full: no
    `getCached`/`setCacheIfCurrent` import or call anywhere in the file) —
    not subject to this control in the first place, same conclusion FE9/FE10
    reached for this module.
- **`services/nfcActivityService.ts` (new file) copies the shared client
  correctly and documents why**: `import api from './apiClient'` (the global,
  already-audited instance — `withCredentials`, CSRF header, and 401/403
  handling all come for free), and its own file header states the
  `/nfc-activity` cache exclusion and cites Pitfall #7 by name. All three
  methods pass `filters.x || undefined` for optional query params (not `??`),
  consistent with Pitfall #1's empty-value convention for values a picker can
  leave blank.
- **Still exactly two `axios.create()` call sites in the whole frontend**
  (`services/apiClient.ts`, `utils/createApiClient.ts`) and the same 13 + 4
  callers of `createApiClient()` — enumerated fresh, not carried over from
  pass 10's count.
- **No token (access, refresh, or bearer) written to `localStorage` or
  `sessionStorage`**, **no hardcoded secret/token literal**, and **no new
  `dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`** anywhere
  in the diff since the baseline — all four sweeps in Method step 8 returned
  zero hits.
- **`ProtectedRoute.tsx`, `authStore.ts` (including `logout()`'s
  `confirmServerSignOut()` retry/quarantine fix), `pendingSyncStore.ts`, the
  offline-queue ownership/quarantine utilities, and the other 12 module
  `api.ts` files are byte-identical to the `1b1c27d4` baseline** (0-line
  diff-stat for each) — the mechanism for every "still fixed"/"still correct"
  claim above and for the two standing HIGH findings' continued-fixed status
  (`FE3-34-2`, `FE3-34-5`): the exact code `FE8`–`FE10` read and confirmed
  fixed has not changed a single byte since.
- **`modules/finance/services/api.ts`'s five new methods** and
  **`equipmentCheckApi.ts`'s one new field** stay within each module's own
  business logic (new endpoints behind the module's existing, already-audited
  client; a new boolean field on an existing response type) and touch no
  auth, CSRF, caching, or shared-client code — Finance's own endpoint/
  permission correctness is that feature's rotation slot (#05), not this
  one's, consistent with every prior pass's scoping.

## Not fixed — considered, judged correctly scoped

- **`FE5-34-1`'s broader ask** (excluding the whole `/inventory/items`
  catalog from caching for its unconstrained `color` field) — unchanged,
  still a recorded product trade-off in `KNOWN_LIMITATIONS.md`. Not
  re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — there is nothing to fix or flag this pass.

## Documentation corrections

None needed.

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict` run as part of the completion gate
regardless: 651 revisions, single head (`3d67883cd461`) — unrelated to this
feature, confirmed clean.

## Guard tests added

None — no finding required a fix this pass. The existing guard tests covering
this feature's prior fixes and controls (`apiCache.test.ts`'s `isCacheable`
suite including the `/issue-plan` regression test, `apiClient.test.ts`,
`createApiClient.test.ts`, `stepUp.test.ts`, `StepUpContext.test.tsx`, the
rich-text sanitizer tests, etc.) were not touched by this pass and continue to
assert the same invariants.

## Completion gate

| Check                                                | Result                             |
| ---------------------------------------------------- | ---------------------------------- |
| `flake8 app/ tests/ alembic/`                        | ✅ 0 violations                    |
| `black --check app/ tests/ alembic/`                 | ✅ clean, 2,637 files unchanged    |
| `isort --check-only app/ tests/ alembic/`            | ✅ clean                           |
| `validate_migrations.py --strict`                    | ✅ 651 revisions, single head      |
| `npm run typecheck` (whole frontend)                 | ✅ 0 errors                        |
| `npm run lint` (whole frontend, `--max-warnings 10`) | ✅ 0 errors, 0 warnings (see note) |

No backend file was touched this pass; the backend gate was still run in full
per CLAUDE.md's completion-gate requirement and confirmed clean. No frontend
_source_ file was touched by this pass either — the diff for this PR is this
findings file plus `PROGRESS.md` bookkeeping (the Step 0 record and this
feature's row/log update) — so the frontend suite was not re-run beyond
`typecheck`/`lint`, which cover the whole tree regardless of what changed, per
the same precedent FE10 recorded.

Diff scope for this pass: 5 feature-owned files changed since the `1b1c27d4`
baseline (none requiring a fix), reviewed against all seven checklist
dimensions, plus this findings file and `PROGRESS.md`.
