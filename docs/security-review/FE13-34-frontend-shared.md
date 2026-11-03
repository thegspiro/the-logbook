# Security Review — Feature 34: Frontend Shared (pass 13)

**Prefix:** `FE13` · **Iteration:** 34 · **Reviewed:** 2026-10-30 · **PR:** #TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 13 `modules/*/services/api.ts` files,
the four second per-module clients, `components/ProtectedRoute.tsx`,
`stores/authStore.ts` (+ offline-queue/shared-device purge utilities),
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.get<`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-12 baseline.
**Backend:** read-only cross-reference only — the new permission-gated,
org-scoped follow-up-form-answers endpoint this pass's frontend diff calls
(`get_follow_up_form_answers`, `membership_pipeline.py:2690-2745`) belongs to
Feature 08 (Membership pipeline)'s own rotation slot, already `✅`; spot-checked
only to confirm the new frontend call site reaches a safe backend route, not
re-reviewed as this feature's own finding.
**Migrations:** none written or reviewed as in-scope (678 revisions, single
head `f90b1124e6f4`, confirmed via `validate_migrations.py --strict` —
unrelated to this feature).

**0 fixes, 0 new OPEN/FLAGGED findings.**

---

## Method

1. **Step 0 (rotation-level):** this is a watchdog pickup — the dedicated
   `/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
   is unreachable (confirmed via `ListAgents`: "No reachable agents"). PR
   #3867 (Feature 33, Core infrastructure, pass 12) was open at the start of
   this iteration; it was green on every CI check (`mergeable_state: clean`)
   with 0 fixes/0 findings, so this iteration's Step 0 merged it
   (`04bd78e6`) before continuing, per the "tend the open PR" path — merging
   a ready, zero-finding PR is the minimal action that path calls for.
   `list_pull_requests` then returned no `claude/security-review-*` head
   immediately afterward, confirming Feature 34 (Frontend shared) as the only
   `⬜` row.
2. **Established the baseline:** `579501ee` (the merge that landed
   `FE12-34-frontend-shared.md`, confirmed via
   `git log --diff-filter=A -- docs/security-review/FE12-34-frontend-shared.md`).
3. **Re-verified prior art before reading new code:** read `CHECKLIST.md`,
   relevant `SEC-00-cross-cutting-baseline.md` sections, and every standing
   item across `FE2`–`FE12`. `FE3-34-2`/`FE3-34-5` (the two pass-7 HIGH
   findings) remain confirmed fixed since pass 8, re-confirmed unchanged by
   every pass through 12. `FE5-34-1` (the broader "exclude the whole
   inventory catalog from caching" ask) remains a recorded product trade-off
   in `KNOWN_LIMITATIONS.md`, not re-litigated.
4. **Diffed every feature-owned file** against the baseline
   (`git diff --stat 579501ee..HEAD -- <each file>`). None of the core
   shared-infrastructure files changed: `apiCache.ts`, `apiClient.ts`,
   `createApiClient.ts`, `errorHandling.ts`, `errorTracking.ts`/
   `errorReporting.ts`, the global `services/api.ts` barrel,
   `ProtectedRoute.tsx`, and `authStore.ts` itself are all byte-identical to
   pass 12. Of the 13 module `services/api.ts` files (enumerated fresh by
   directory listing, unchanged count from pass 12), only two changed:
   `modules/prospective-members/services/api.ts` and
   `modules/scheduling/services/api.ts` — both additive (new typed methods
   calling the module's existing, already-audited client; no new
   `axios.create`/`createApiClient` call anywhere in the diff).
5. **Repo-wide sweep since the baseline** (`git diff 579501ee..HEAD --
frontend/src`, 300 files/10,952 insertions, the bulk of it unrelated
   feature work):
   - New top-level files under `stores/`, `services/`, `utils/`,
     `contexts/`: `utils/chunkLoadError.ts`, `utils/cohortShift.ts`,
     `utils/electionDefaults.ts` (plus their `.test.ts` files) — none touch
     auth, caching, or storage; read and confirmed out of scope.
   - New `axios.create(`/`createApiClient(` call sites: **zero**.
   - New `localStorage.setItem`/`sessionStorage.setItem` call sites: all
     hits are inside `.test.ts`/`.test.tsx`/`e2e/*.spec.ts` fixtures
     **except** three in `modules/storefront/utils/savedCart.ts` — read in
     full below, the one genuine new production surface this pass.
   - Hardcoded secret/token literal sweep: all hits are the word
     "secretary" in prose/comments/test fixture strings, or test-only
     placeholder tokens (`'a'.repeat(43)`); zero real literals.
   - XSS sink sweep (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): zero new hits.
6. **Read the one real new surface in full:** `modules/storefront/utils/
savedCart.ts` (new file, 97 lines) and its wiring into
   `modules/storefront/store/storefrontStore.ts` and
   `utils/purgeLocalMemberData.ts` — see Verified good.
7. **Completion gate** run per Step 6 below.

## Verified good ✅

- **The new per-member saved-cart store closes exactly the shared-device
  class of risk `FE3-34-1`/`FE3-34-5` found elsewhere, and does so
  correctly on every axis checked.** `savedCart.ts`'s `keyFor(memberId,
windowId)` (`modules/storefront/utils/savedCart.ts:26`) scopes every
  localStorage key to the signed-in member and the order window, so one
  member's cart is never read back for another. `saveCart`/`loadSavedCart`
  persist only `productId`/`variantId`/`personalizationText`/`quantity` —
  no name, price, or other PII beyond what the member typed as a
  personalization request, matching the file's own docstring. `isSavedLine`
  validates every field's shape before trusting parsed JSON, so a corrupted
  or hand-edited localStorage entry degrades to an empty cart rather than
  being rendered or crashing (`loadSavedCart` and `pruneSavedCarts`/
  `saveCart` all wrap in `try/catch` and fail silently to an in-memory-only
  cart, per the file's own comment).
- **The restore path cannot resurrect a stale price.** `restoreLines`
  (`storefrontStore.ts:72-93`, new) rebuilds `unitPrice`, `productName` and
  `variantLabel` from the _current_ catalog on every restore via the new
  shared `unitPriceFor` helper, and drops a line outright if its product,
  variant, or personalization is no longer offered — a saved cart can only
  ever show today's price, confirming the module's own docstring claim.
- **`clearAllSavedCarts()` is wired into the existing shared-device purge,
  not a parallel cleanup path.** `purgeLocalMemberData.ts:38` imports it
  from `savedCart.ts` and calls it unconditionally
  (`purgeLocalMemberData.ts:131`) alongside the other shared-device stores
  it already purges. `purgeLocalMemberData()` itself is unchanged and is
  still called from all three of its pre-existing call sites —
  `authStore.ts:188` (explicit logout), `authStore.ts:547`/`:613` (loadUser
  failure / sign-in-as-someone-else), and `apiClient.ts:210` (refresh
  failure → forced logout) — confirmed by grep, none of which this pass's
  diff touched, so the purge's trigger surface is exactly what passes 2–12
  already verified.
- **Every cart mutation persists, and a placed/cleared cart is removed
  rather than left as a stale empty-array entry.** `addToCart`,
  `updateCartQuantity`, `removeFromCart`, `clearCart`, and the success path
  of `placeOrder` all call the new `persistCart` helper
  (`storefrontStore.ts:103-106`), and `saveCart` removes the localStorage
  key outright when the cart is empty (`savedCart.ts:47-50`) rather than
  writing `{"lines":[]}` — so a completed or emptied cart leaves no
  recoverable trace for the next person at that terminal, consistent with
  the module's own "cleared ... at sign-out, because station computers are
  shared" docstring claim.
- **The cross-window prune cannot delete a cart that is still orderable.**
  `pruneSavedCarts` (`storefrontStore.ts:134-144`, called from
  `loadStorefront`) is only invoked when the response's `otherOpenWindows`
  list is present and is an array (`Array.isArray(otherWindows)` guard,
  `storefrontStore.ts:137`) — a response shape that predates this field
  (or an error response) skips the prune entirely rather than treating
  "list absent" as "no windows open", which would otherwise delete every
  saved cart on a stale/defensive response, per the inline comment
  explaining exactly this.
- **The two changed module clients added only typed wrappers through their
  existing, already-audited `api`/`axios` instances** —
  `prospective-members/services/api.ts`'s new `followUpFormService`
  (authenticated, via the shared `api` client) and
  `publicFollowUpFormService` (unauthenticated, via bare `axios` — the
  file's own comment states the token is the credential, the same pattern
  already verified for this module's other public, token-scoped services)
  and `scheduling/services/api.ts`'s new `getTraineeReportRequirement` and
  two new `finalizeShift` body fields. No new `axios.create`/
  `createApiClient` call, confirmed by the repo-wide sweep above.
- **The new authenticated follow-up-form-answers call is covered by an
  existing cache exclusion, not a gap.** `followUpFormService.getAnswers`
  calls `GET /prospective-members/prospects/{id}/follow-up-forms/{id}/
answers` through the global cached client; `apiCache.ts:98`'s
  `/prospective-members/` entry in `UNCACHEABLE_PREFIXES` is a prefix match
  on the full path, so this new endpoint is excluded from caching without
  needing its own entry. Spot-checked the backend route it calls
  (`membership_pipeline.py:2690-2745`, Feature 08's own scope): permission-gated
  (`require_permission("prospective_members.view", "prospective_members.manage")`),
  resolves `prospect_id`/`request_id` through `current_user.organization_id`
  (Pitfall #14a shape, not a bare by-id query), and withholds sensitive
  answers from a viewer lacking `sensitive_answers.view` with an audit log
  on each reveal — confirming the frontend call reaches a safe endpoint,
  though the endpoint's own review credit belongs to Feature 08.
- **No new axios instance, no token written to `localStorage`/
  `sessionStorage`, no hardcoded secret, no new XSS sink** anywhere in the
  diff since the baseline — all sweeps (Method step 5) returned zero hits
  in frontend production source.

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
regardless: 678 revisions, single head (`f90b1124e6f4`), confirmed clean.

## Guard tests added

None — no finding required a fix this pass. `savedCart.test.ts` and the
`storefrontStore.test.ts` cart-persistence cases were written by the feature
work itself, not by this review, and were read and judged adequate above
rather than authored here.

## Completion gate

| Check                                                | Result                          |
| ---------------------------------------------------- | ------------------------------- |
| `flake8 app/ tests/ alembic/`                        | ✅ 0 violations                 |
| `black --check app/ tests/ alembic/`                 | ✅ clean, 2,744 files unchanged |
| `isort --check-only app/ tests/ alembic/`            | ✅ clean                        |
| `validate_migrations.py --strict`                    | ✅ 678 revisions, single head   |
| `npm run typecheck` (whole frontend)                 | ✅ 0 errors                     |
| `npm run lint` (whole frontend, `--max-warnings 10`) | ✅ 0 errors, 0 warnings         |
| Scoped frontend suite (8 files, the reviewed delta)  | ✅ 244 passed                   |

No backend file in this feature's own scope was touched this pass; the
backend gate was still run in full per CLAUDE.md's completion-gate
requirement and confirmed clean. The scoped frontend suite above —
`savedCart.test.ts`, `storefrontStore.test.ts`, `purgeLocalMemberData.test.ts`,
`apiCache.test.ts`, `apiClient.test.ts`, `createApiClient.test.ts`,
`authStore.test.ts`, `ProtectedRoute.module.test.tsx` — covers the reviewed
delta plus the feature's core shared-infrastructure files, run to confirm
the current tree (not merely the diff) still passes on all of them.

Diff scope for this pass: 300 files changed since the `579501ee` baseline
(10,952 insertions, 1,387 deletions) repo-wide, of which 1 new file + 2
modified files fall inside this feature's declared scope or the repo-wide
sweep's net (`savedCart.ts`, `storefrontStore.ts`,
`purgeLocalMemberData.ts`'s one new import/call, the two module
`services/api.ts` files) — reviewed in full against all seven checklist
dimensions, plus this findings file and `PROGRESS.md`.
