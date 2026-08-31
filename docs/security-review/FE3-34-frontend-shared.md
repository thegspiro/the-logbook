# Security Review — Feature 34: Frontend Shared (pass 3)

**Prefix:** `FE3` · **Iteration:** 34 · **Reviewed:** 2026-08-31 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/errorHandling.ts`,
`services/errorTracking.ts`, `utils/createApiClient.ts`, all 13 module axios
instances (`modules/*/services/api.ts` — up from 12 last pass; the new
`modules/testing/services/api.ts` reviewed for the first time),
`components/ProtectedRoute.tsx`, `stores/authStore.ts`,
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, and — read in full for the first time this
rotation — `components/ux/*` (20 non-test files, ~3,466 L).
**Backend:** none — read-only cross-reference, as in prior passes.
**Migrations:** none.

---

## Scope

This pass re-verifies FE2-34 (2026-08-27, PR #1918) rather than re-reading the
whole surface line-by-line a third time. Since FE2-34, `main` picked up 103
non-test frontend files changed (+20,407/-4,266) across ~30 other rotation
iterations, so the re-verification method was:

1. **Diff-based sweep for new cache risk**, the dominant finding class in both
   prior passes: `git diff 507937f7..HEAD` (the FE2-34 commit) restricted to
   added lines matching `api.get(`/`api.get<`, across the **entire** frontend
   (not just this feature's file list) — every page, hook, component and
   service, not only the files FE2-34 scoped in. This is strictly broader than
   a re-read of the same file list would catch, since a new gap could just as
   easily be introduced in a page component calling `api.get` directly.
2. **Re-verified all 9 FE2-34 findings** against current code (not just that
   the doc says "fixed" — read the actual current line).
3. **Read `components/ux/*` in full**, the one shared-UI directory no prior
   frontend-shared pass (module-audit, 4 app-review passes, or FE2-34) had
   scoped in explicitly.
4. **Confirmed no new store** was added under `stores/` (still exactly the 4
   FE2-34 covered) and accounted for the one new module axios file
   (`modules/testing/services/api.ts`).

**Not re-read line-by-line this pass:** the ~150 non-module `services/*.ts`
files and the ~200 pages/components/hooks that call the global `api` instance
directly — per FE2-34's scoping rationale, these are business logic owned by
their respective feature's own rotation slot; only their **cache-exclusion
correctness** is this feature's concern, and that was covered by the diff
sweep in (1), not by re-reading each file's unrelated logic.

## Diff-based cache-risk sweep — results

Every `api.get(`/`api.get<` call added or modified since FE2-34, across the
whole frontend, filtered to non-test files:

| File                                  | New/changed call                                                    | `isCacheable`? | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modules/admin-hours/services/api.ts` | `GET /admin-hours/entries/export`                                   | n/a            | Uses `createApiClient()` (own instance) — confirmed zero caching logic in that factory (FE2-34-5), so this never touches the cache regardless of the exclusion list.                                                                                                                                                                                                                                                                                                                                               |
| `modules/testing/services/api.ts`     | `GET /testing-checklist`                                            | Excluded       | New module (`e74c2115`, "Make the testing checklist a module"). Imports the **global** `apiClient` directly (like `ip-security`), so it _does_ go through the cache. `'/testing-checklist'` was added to `UNCACHEABLE_PREFIXES` in the same commit family that introduced the endpoint — verified present and correctly matches the bare `GET /testing-checklist` (own-marks default and `include_all_testers=true` admin view alike; response carries `userName`/`testedAs` per entry, a real per-tester roster). |
| `services/inventoryService.ts`        | `GET /inventory/checkout/active`, `GET /inventory/checkout/overdue` | Excluded       | Both start with `'/inventory/checkout/'`, already in the list ("who currently holds equipment (PII)"). No gap.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `utils/createApiClient.test.ts`       | `api.get('/things', ...)`                                           | test fixture   | Not a real endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Read `modules/testing/services/api.ts` in full** (not just the grep hit),
since it is the only genuinely new global-cache consumer this pass: one GET
(`/testing-checklist`, excluded), one POST (`startRun`), one PUT
(`saveEntry`), one DELETE (`clearRun`) — none of the writes touch the cache
read path, and `invalidateByPrefix` is not called here at all (the module
doesn't need it; nothing else caches derived `/testing-checklist` data).
No finding.

**Conclusion: zero new cache-exclusion gaps** since FE2-34, despite 103 files
of churn. The exclusion list's discipline (every new sensitive endpoint this
rotation touched — `/testing-checklist`, `/training/competency-matrix`,
`/training/dashboard-summary`, `/training/sessions/approve/`,
`/training/effectiveness/evaluations`, `/dashboard/action-items` — arrived
with its exclusion-list entry in the same commit) held across every other
feature's own review, not just this one's.

## Re-verification of FE2-34's 9 findings

All 9 confirmed intact in current code — none regressed:

- **FE2-34-1/2/3** (`/training/cohorts/`, `/training/programs/programs/`,
  `/training/external/providers/`) — all three present verbatim in
  `UNCACHEABLE_PREFIXES` (`apiCache.ts:69-71`).
- **FE2-34-4/5** (`/forms`, `/grants` trailing-slash fix) — both present with
  no trailing slash (`apiCache.ts:84,97`).
- **FE2-34-6** (`/analytics/export`) — present (`apiCache.ts:104`).
- **FE2-34-7** (CSRF cookie `decodeURIComponent`) — `authStore.ts:52` still
  calls `decodeURIComponent(match[1])`, matching `apiClient.ts`'s reader.
- **FE2-34-8** (`getMyAttendance` 404-only swallow) — `modules/scheduling/
services/api.ts:728-736` still catches only `AxiosError` with
  `status === 404` and rethrows everything else.
- **FE2-34-9** (purge-on-logout) — `authStore.ts` still imports and calls
  `purgeLocalMemberData()` on both the explicit-logout path (`:366`) and the
  session-expired catch branch (`:420`); `useIdleTimer.ts`'s `performLogout`
  still routes through the same `authStore.logout()`.

## `components/ux/*` — first full read this rotation

20 non-test files (~3,466 L: `Avatar`, `Breadcrumbs`, `Collapsible`,
`CommandPalette`, `ConfirmDialog`, `DateRangePicker`, `DateTimeQuarterHour`,
`DialogPanel`, `EmptyState`, `FileDropzone`, `FlashlightToggle`,
`FloatingActionButton`, `InlineEdit`, `LinkifiedText`, `MobileCheckoutCard`,
`MobileItemCard`, `PageTransition`, `Pagination`, `ProgressSteps`,
`PromptDialog`, `ScanSuccessFlash`, `Skeleton`, `SortableHeader`,
`SuccessAnimation`, `TimeQuarterHour`, `Tooltip`, `TopProgressBar`,
`WhatsNew`).

- **No XSS sinks**: grepped and confirmed no `dangerouslySetInnerHTML`,
  `innerHTML` assignment, `eval`, or `document.write` in the directory.
- **No blocking-dialog violations** (Pitfall #16): the only `window.confirm`/
  `window.prompt` mentions are in `PromptDialog.tsx`'s and `ConfirmDialog`'s
  own doc comments describing what they replace — neither component calls the
  native API.
- **`LinkifiedText.tsx`** (renders message-body URLs as clickable links) is
  safe by construction: `URL_RE` requires an `https?://` prefix at the match
  start, so a `javascript:` URI can never be matched and turned into an
  `href`; text is emitted as React children (auto-escaped), never via
  `dangerouslySetInnerHTML`; links carry `rel="noopener noreferrer nofollow"`
  and `target="_blank"`.
- **`WhatsNew.tsx`**'s only `localStorage` use is a version-string
  last-seen marker (`STORAGE_KEY`) — no PII, and not part of the purge scope
  in FE2-34-9 for that reason.

No findings in this directory.

## Verified good ✅

All of FE2-34's "Verified good" claims re-checked and still true (cache
bound at 200 entries/FIFO eviction, shared `performSharedRefresh()` singleton
across global + all `createApiClient()` instances, one-shot 401 `_retry`
guard excluding auth endpoints, `ProtectedRoute` pre-render gating, no
`persist` middleware on `skillsTestingStore`). Adding this pass:

- **13 module axios files, not 12** — `modules/testing/services/api.ts` is
  new; confirmed above it correctly uses the global client with its one
  sensitive endpoint excluded.
- **`createApiClient.ts`'s new blob-error-decoding branch** (added in the
  admin-hours round-2 pass, `fc0aaafc`) only activates when
  `error.response.data instanceof Blob && type.includes('json')`, wraps the
  `.text()`/`JSON.parse` in try/catch, and leaves the Blob untouched on a
  non-JSON body (e.g. an HTML proxy error page) rather than throwing —
  correctly scoped, doesn't affect the 401-refresh branch below it in the
  same interceptor.

## Findings

None this pass. Zero regressions, zero new gaps found by the diff-based sweep
or the first full read of `components/ux/*`.

## Schema & migration notes

n/a — frontend-only feature, no owned tables.

## Guard tests added

None — no new finding to guard. Existing guard tests from FE2-34
(`apiCache.test.ts`'s trailing-slash and new-exclusion cases) continue to
pass unchanged (147/147 in the scoped run below, which also finally exercises
`createApiClient.test.ts`'s blob-decoding cases).

## Completion gate

| Check                                                                             | Result                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck` (`tsc-native.mjs`)                                            | ✅ 0 errors                                                                     |
| `npm run lint`                                                                    | ✅ 0 errors, 8 warnings (pre-existing, unrelated files, within max-warnings 10) |
| Scoped tests (`apiCache.test.ts`, `authStore.test.ts`, `createApiClient.test.ts`) | ✅ 147 passed                                                                   |
| Backend                                                                           | n/a — no backend files in scope, none changed                                   |

## Next

Feature 34 is now closed for this pass. Every row (00-34) is ✅ — the
rotation wraps to 00 (cross-cutting baseline) for the next full pass over
whatever has landed since 2026-08-25.
