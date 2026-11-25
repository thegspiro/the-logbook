# Security Review — Feature 34: Frontend Shared (pass 17)

**Prefix:** `FE17` · **Iteration:** 34 · **Reviewed:** 2026-11-25 · **PR:** TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`/`services/errorReporting.ts`,
`services/api.ts` (global barrel), all 14 `modules/*/services/api.ts` files
(re-enumerated: 14, unchanged in count from pass 16), the six second-per-module
clients (re-enumerated: 6, unchanged in count from pass 16 —
`historicalImportApi.ts`, `historyImportApi.ts`, `equipmentCheckApi.ts`,
`publicPortalApi.ts`, `evaluationsApi.ts`, `shiftSettingsApi.ts`),
`components/ProtectedRoute.tsx`, `stores/authStore.ts`,
`stores/learningProgressStore.ts`, `stores/pendingSyncStore.ts`,
`stores/skillsTestingStore.ts`, `stores/practicalSkillsStore.ts`, plus a
repo-wide sweep for new `api.get(`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the real pass-16 baseline (see "Baseline correction" below).
**Backend:** none reviewed as in-scope, same convention as pass 16 — every
backend endpoint a new frontend call site in this diff reaches belongs to a
feature that already owns review credit (Feature 29, Reports & analytics, for
`crr.py`/`outreach_goals.py` — confirmed via `PROGRESS.md` row 29's own scope
note and PR #4706; Feature 16, Events & requests, for
`/event-requests/*/feedback` and `/events/settings/feedback-forms`; Training
for `/training/double-credit`). Not re-reviewed here except where this
feature's own control (the response cache's PII denylist) applies to them,
and the one backend file (`main.py`'s unhandled-exception handler) that the
new `errorHandling.ts` `reference` field reads from, traced to confirm the
value it surfaces is a safe opaque id.
**Migrations:** none written or reviewed as in-scope. 844 revisions, single
head `e9cf8ab7e4e4`, confirmed via `validate_migrations.py --strict`.

**0 fixes, 0 new findings.**

---

## Baseline correction (read this before the diff numbers below)

This pass's own briefing named `f30309984` (PR #4259, pass 15) as the
baseline, on the premise that pass 16 did not yet exist beyond an abandoned
draft. That premise was wrong, and it was caught before any diff was taken
against the stale baseline:

- **PR #4589** ("Frontend shared, pass 16", branch
  `claude/security-review-frontend-shared`) merged cleanly as `0238cf27f`
  during the rotation's previous lap, closing that lap at every row 00–34 ✅,
  and wrote the real `docs/security-review/FE16-34-frontend-shared.md`
  (present on `main` today — read in full as this pass's prior art). The next
  iteration (Feature 00, pass 18, PR #4616) then reset all 35 rows to ⬜ for
  the new lap per the rotation's own lap-boundary rule, which is why row 34
  showed ⬜ again at this pass's start despite FE16 having already run and
  merged.
- **PR #4590** ("Frontend shared, pass 16", branch
  `claude/security-review-frontend-shared-p16`) was a _second_, concurrent
  watchdog session picking up the same feature at the same time — the exact
  collision risk this rotation's own briefing warns about. It was opened
  against the same pre-#4589 base (`c01ab8df1`), closed as a draft without
  merging (`merged: false`, closed 2026-11-23T04:48:34Z), and nothing in it
  reached `main`. Confirmed directly via `pull_request_read` before trusting
  either claim.
- A stray `docs/security-review/FE16-34-frontend-shared.md` from #4590's
  branch was **not** present in this session's working tree (the branch was
  never merged, so its content never landed) — there was nothing to compare
  against or discard.

**Correct baseline for this pass: `0238cf27f`** (PR #4589's merge, the real
pass-16 write-up), not `f30309984`. This findings file is numbered `FE17` to
continue the real sequence after the real `FE16`. All diff figures in this
document are against `0238cf27f`.

## Method

1. **Step 0/1 (rotation-level):** `git fetch origin` + `git log origin/main -1`
   confirmed `main`'s HEAD (`ce354045b`, merge of PR #4710, Feature 33 pass 16) and a fresh `list_pull_requests` (state=open) returned 0 results —
   re-verified directly rather than trusted from the briefing. Row 33 ✅, row
   34 (Frontend shared) the next and only `⬜` row, confirmed by reading
   `PROGRESS.md`'s rotation table directly off a freshly pulled `main`.
   `git ls-remote origin 'claude/security-review-frontend-shared*'` found the
   stale `-p16` branch (abandoned #4590) and an older `-pass14` branch still
   on the remote; neither is an open PR, so neither blocks this pass. Used
   `-p16b` for this pass's own branch name per the briefing's collision
   guidance (a plain `-p16` reuse would be ambiguous with the closed #4590).
2. **Established the real baseline** — see "Baseline correction" above.
3. **Re-verified prior art:** read `CHECKLIST.md`, `SEC-00-cross-cutting-
baseline.md` (notes `SEC16-2`, a since-FIXED apiCache PII gap in an
   unrelated module, not reopened here), and all of `FE16-34-frontend-
shared.md` in full, including its "Verified good" and "Considered, not a
   finding" sections — nothing there is reopened by this pass's diff.
   `docs/KNOWN_LIMITATIONS.md`'s `FE5-34-1` (inventory catalog cache
   trade-off) re-confirmed unchanged, not re-litigated.
4. **Diffed every declared scope file against `0238cf27f`.** Unchanged
   (byte-identical): `services/errorTracking.ts`, `services/errorReporting.ts`,
   `services/api.ts` (global barrel), `components/ProtectedRoute.tsx`,
   `stores/authStore.ts`, `stores/learningProgressStore.ts`,
   `stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`,
   `stores/practicalSkillsStore.ts`, 12 of 14 module `services/api.ts` files,
   5 of 6 second-per-module clients (only `evaluationsApi.ts` changed — one
   additive GET, `/evaluations/{id}/history`, read below). Real, additive
   deltas read in full: `utils/apiCache.ts` (two new `UNCACHEABLE_PREFIXES`
   entries, no removal), `services/apiClient.ts` (invalidation call-site
   refactor, same behavior), `utils/createApiClient.ts` (new cache-
   invalidation bridge for module clients — see Verified good), and
   `utils/errorHandling.ts` (a new `reference` field threaded through every
   support-suffix helper).
5. **Repo-wide sweep since `0238cf27f`** (380 files changed under
   `frontend/src`, 237 non-test):
   - **New `axios.create(`/`createApiClient(` call sites:** zero in
     production code — the only two new matches are `createApiClient()` calls
     inside test helpers (`withAdapter(createApiClient(), …)`), not new real
     instances.
   - **New top-level files under `stores/`, `services/`, `utils/`,
     `contexts/`:** 6 non-test files — `services/crrServices.ts`,
     `services/outreachFeedbackServices.ts`, `services/outreachGoalServices.ts`,
     `utils/certificationState.ts`, `utils/eventSeriesChanges.ts`,
     `utils/fileRemoval.ts`. All read in full; see Verified good.
   - **New `localStorage.setItem`/`sessionStorage.setItem` call sites:** zero
     hits in the diff.
   - **Hardcoded secret/token literal sweep:** zero hits.
   - **XSS sink sweep** (`dangerouslySetInnerHTML`/`innerHTML =`/
     `document.write`/`eval(`): zero new hits in production source.
   - **New GET call sites vs. `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`,
     checked programmatically, not by eye:** extracted the real string
     literals from both arrays with a line-anchored parser (the naive
     quote-pair scan this file's own guard test warns about silently
     mis-parses an entry whose _comment_ contains an apostrophe — hit this
     exact trap on the first attempt, confirmed by cross-checking against
     `tests/test_api_cache_pii_exclusions.py`'s own `_ts_list` before trusting
     the result) and ran the extracted `UNCACHEABLE_PREFIXES`/
     `UNCACHEABLE_SUBSTRINGS` lists against every new GET URL found in the
     diff (10 real new call sites on clients that might reach the cache; see
     Verified good for the per-route trace). **Also ran the feature's own
     backend guard test directly**, which checks this invariant across the
     _entire_ application (not just this pass's diff) by statically
     resolving every GET route's `response_model` schema against a PII
     field-name ratchet: `test_api_cache_pii_exclusions.py`'s four tests all
     passed (`test_new_pii_route_is_excluded_from_the_frontend_cache`,
     `test_baseline_has_no_stale_entries`,
     `test_pinned_pii_routes_stay_excluded_from_the_frontend_cache`,
     `test_pinned_routes_all_still_exist`).
6. **Completion gate** run per Step 6 below.

## Verified good ✅

- **`utils/createApiClient.ts`'s new cache-invalidation bridge is a
  correctness fix, not a new read/write surface for the cache.** Read the
  whole diff: a module client's own GETs still never read or populate the
  shared cache (confirmed unchanged: no response-cache read path was added,
  only a response interceptor that calls the newly-exported
  `invalidateAfterMutation` on a successful POST/PUT/PATCH/DELETE). The only
  new behavior is that a mutation made through a _module_ client (e.g. a
  scheduling signup) now also invalidates the _shared_ cache's entries for
  the resource it affects, fixing a real staleness bug the code comment
  documents (a volunteer signup via `modules/scheduling`'s client left
  `/events/{id}` answering from the global client's stale cache for up to
  90s). `toCachePath()` only ever computes a key inside the cache's existing
  `/api/v1`-rooted key space from the request's own configured `baseURL` and
  `url` — neither is attacker-influenceable beyond values the calling code
  already constructs — and a wrong or unmatched path degrades to "no
  invalidation happens" (stale-but-correct data for up to 90s), never to
  reading or exposing another resource's cached response. Not a security
  finding.
  `apiClient.ts`'s own refactor (`invalidateByPrefix(getResourcePrefix(url))`
  → `invalidateAfterMutation(url)`) is behavior-preserving: `apiCache.ts`'s
  `invalidateAfterMutation` does the same `getResourcePrefix` +
  `invalidateByPrefix` call internally, plus the new `RELATED_PREFIXES`
  cross-invalidation (`/scheduling` → also invalidates `/events`,
  `/dashboard`; `/event-requests` → also invalidates `/events`,
  `/dashboard`) — an intentional, additive widening of what gets refreshed
  after a mutation, not a narrowing. Confirmed by reading `getResourcePrefix`
  itself: unchanged.
- **The two new `UNCACHEABLE_PREFIXES` entries are correct and already a
  stated decision, not something this pass needed to add.** `/crr/` —
  confirmed by reading the backend schema the new `crrServices.ts` calls
  against (`CrrActivity`/`CrrFormOptions` carry resident address/contact
  fields per the backend module's own docstring) — and `/training/
double-credit` — confirmed by reading `training.py`'s
  `_double_credit_view`, whose `DoubleCreditPair.member_name` field is a
  named member, matching the comment exactly. Both landed as part of other
  features' own work in this window, already correct; nothing to fix here.
- **Every one of the 10 real new GET call sites on a client that could reach
  the shared cache is covered or correctly left cacheable, traced
  individually:**
  - `/crr/catalogue`, `/crr/form-options`, `/crr/activities`,
    `/crr/zip-lookup/{zip}` (`crrServices.ts`, new file, uses the global
    `./apiClient`) — all covered by the new `/crr/` prefix. `zip-lookup`
    itself returns no PII (city/state/county for a ZIP) but is excluded
    anyway by the same broad prefix; conservative, not a gap.
  - `/event-requests/status/{token}/feedback`,
    `/event-requests/{requestId}/feedback` (`outreachFeedbackServices.ts`,
    new file, uses the global client) — both covered by the existing
    `/event-requests` prefix (no trailing slash, confirmed present,
    unchanged). The first is a no-auth, token-is-the-credential public
    route (`event_requests.py:578`) that happens to be called through the
    _credentialed_ global client rather than bare `axios`: read the backend
    handler and confirmed it is rate-limited per IP
    (`_rate_limit_status_link`), sets `Cache-Control: no-store, private`,
    and requires nothing from any cookie the browser may attach — sending
    cookies alongside the token is inert, not a CSRF or session exposure, and
    the route's own compensating controls (rate limit + unguessable token)
    are unchanged from how every other token-scoped status-link route in
    this app already works. Not a finding; noted because it is a deliberate
    client choice different from `publicShiftEvaluationService.ts`'s bare-
    `axios` pattern that FE16 recorded, worth a future consistency pass but
    not a security defect.
  - `/events/settings/feedback-forms` (`outreachFeedbackServices.ts`) — read
    the backend handler (`events.py:1316`): returns form id/name and rating
    _field labels_ only, gated `events.manage`. No member field. Correctly
    left cacheable.
  - `/outreach-goals` (`outreachGoalServices.ts`, new file, global client) —
    read the backend handler (`outreach_goals.py:71`) and
    `OutreachGoalsResponse`: year/target/actual/pace aggregates and metric
    labels, gated `events.manage`. No member field. Correctly left cacheable.
  - `/events/{eventId}/staffing/seats` (`eventServices.ts`,
    `getVolunteerSeats`) — contains the `/staffing` substring (this is the
    same guard FE16 confirmed covers `/events/{id}/staffing`;
    `/events/{id}/staffing/seats` also contains that substring and is
    excluded the same way). Verified with the actual extracted
    `UNCACHEABLE_SUBSTRINGS` list, not assumed from the sibling route.
  - `/evaluations/{id}/history` (`evaluationsApi.ts`) — this client is one of
    the six built with `createApiClient()`, which (per Verified good above)
    never reads or writes the shared cache regardless of the denylist;
    confirmed by re-reading the file's own top-of-file import, unchanged
    from pass 16.
- **The 6 new pure files touch neither the network nor browser storage, or
  only the already-reviewed global client:** `certificationState.ts` and
  `eventSeriesChanges.ts` touch neither (grepped for
  `localStorage`/`sessionStorage`/`dangerouslySetInnerHTML`/`innerHTML`/
  `document.write`/`eval(`/`api\.` — zero hits in either); `fileRemoval.ts`
  only formats a date string, no network/storage. The three new `services/*`
  files all import the already-reviewed global `./apiClient`, not a new
  `axios.create`.
- **`utils/errorHandling.ts`'s new `reference` field surfaces a safe,
  non-identifying correlation id, not a new information leak.** Traced the
  value to its source: `main.py`'s `unhandled_exception_handler` sets
  `content["reference"] = request_id_ctx.get()` only on an unhandled 5xx, and
  that id is `uuid.uuid4().hex[:16]` (`app/core/logging.py:
generate_request_id`) — a random token with no user, path, or stack-trace
  material in it, already written to every JSON log line for the request and
  to the Error Monitoring page before this pass. The HTTP-exception handler
  (any 4xx, or an explicit `HTTPException`) does **not** set `reference` —
  only `detail` (already `safe_error_detail()`-sanitized where it matters)
  and `code` — so the field is 500-only, matching the frontend's own doc
  comment ("sent only with a server fault"). `supportSuffix()` only appends
  it when `appError.code` is already present and only ever formats it as
  plain text in a UI string. Not a security finding.
- **The per-account login lockout, CSRF/auth plumbing, and
  `ProtectedRoute`/`authStore` logic are all unchanged since pass 16**
  (byte-identical diffs, not assumed).

## Considered, not a finding

- **`event-requests/status/{token}/feedback` is read through the
  credentialed global client rather than a bare, cookie-free `axios`
  instance**, unlike the comparable `publicShiftEvaluationService.ts`
  pattern FE16 recorded. Traced in full under Verified good above: the
  backend route requires only the token, is rate-limited, and sends
  `Cache-Control: no-store, private`, so no cookie or CSRF state is actually
  consulted — there is no exploitable gap today. Recorded here as a
  consistency note for whoever next touches this file, not as a defect.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md`. `FE5-34-1` (inventory catalog caching trade-off)
re-confirmed unchanged, not re-litigated.

## Documentation corrections

None needed in this feature's own docs. (This file itself corrects the
baseline the task briefing supplied — see "Baseline correction" above —
rather than correcting a previously-published document.)

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict`: 844 revisions, single head
`e9cf8ab7e4e4`, confirmed clean as part of the completion gate.

## Guard tests added

None. Every invariant this pass touched is already covered by an existing
guard: `test_api_cache_pii_exclusions.py`'s four tests (ran directly, all
pass — see Method step 5) for the cache-exclusion claims, and the existing
`apiCache.test.ts`/`createApiClient.test.ts`/`errorHandling.test.ts` suites
(ran directly, all pass — see Completion gate) for the behavior changes in
this pass's diff. Per CLAUDE.md Pitfall #37, no fix was drafted this pass
that needed disproving against the unfixed tree — the additive denylist
entries and the cache-invalidation bridge were already correct in the tree
this pass started from.

## Completion gate

| Check                                                                                                                                                                                                                                | Result                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `flake8 app/ tests/ alembic/` (3.13.18, CI's pin `flake8==7.4.1`)                                                                                                                                                                    | ✅ 0 violations                              |
| `black --check app/ tests/ alembic/` (`black==26.10.1`)                                                                                                                                                                              | ✅ clean, 3541 files unchanged               |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`)                                                                                                                                                                           | ✅ clean                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                    | ✅ 844 revisions, single head `e9cf8ab7e4e4` |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                    | ✅ 344 routes checked, 0 errors, 0 warnings  |
| Cross-cutting guard tests (api-cache-PII ×4, LIKE escaping, CSV writer, DB schema, org-scoping ratchet, capacity locking, endpoint auth coverage, migration create-all, baseline member grants, Alembic chain, account-status gates) | ✅ 255 passed                                |
| `cd frontend && npm run typecheck` (whole frontend)                                                                                                                                                                                  | ✅ 0 errors                                  |
| `cd frontend && npm run lint` (whole frontend, `--max-warnings 10`)                                                                                                                                                                  | ✅ 0 errors, 0 warnings (exit 0)             |
| Scoped frontend suite — apiCache/apiClient/createApiClient/errorHandling/authStore/ProtectedRoute + the new files' own test files (9 files)                                                                                          | ✅ 304 passed                                |
| Component/page tests exercising the 3 new service files (CRR, outreach feedback, outreach goals — 12 files)                                                                                                                          | ✅ 71 passed                                 |

Diff scope for this pass: path-scoped diff against the declared file list
plus the repo-wide sweep's net found real deltas in `apiCache.ts`,
`apiClient.ts`, `createApiClient.ts`, `errorHandling.ts`, and
`evaluationsApi.ts`, plus 6 new top-level `services`/`utils` files — all
reviewed in full against all seven checklist dimensions, plus this findings
file and `PROGRESS.md`.
