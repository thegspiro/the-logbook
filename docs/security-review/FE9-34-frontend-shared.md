# Security Review — Feature 34: Frontend Shared (pass 9)

**Prefix:** `FE9` · **Iteration:** 9 · **Reviewed:** 2026-10-18 · **PR:** TBD

**Backend:** n/a (frontend-shared feature; backend routes reviewed only where a
new frontend call site reaches them)
**Frontend:** `frontend/src/utils/apiCache.ts`, `frontend/src/utils/createApiClient.ts`,
`frontend/src/services/apiClient.ts`, every `modules/*/services/*Api.ts` axios
instance, `frontend/src/components/ProtectedRoute.tsx`, `frontend/src/stores/`
**Migrations:** none (frontend-only feature; no model/migration touched)

---

## Scope

Watchdog pickup: `search_pull_requests` (`is:open head:claude/security-review-`)
returned zero results, and no other Claude session was reachable via
`ListAgents`. PR #3393 (Feature 33, Core infrastructure, pass 7) had already
merged clean. Feature 34 was the only `⬜` row (the rotation's last, per its
own preamble — this pass starts a fresh lap rather than wrapping to Feature
00, since Feature 00's own baseline doc is a separate whole-codebase sweep
not due again on this cadence).

Diffed every feature-owned file against pass 8's baseline (`3f429ede`, PR
#3093, merged 2026-10-11) rather than trusting pass 8's own byte-identical
list:

- **`utils/apiCache.ts`**: 3 lines added (2 new `UNCACHEABLE_PREFIXES`
  entries — `/integrations/google-workspace/`, already landed by regular
  engineering — plus 1 new `UNCACHEABLE_SUBSTRINGS` entry — `/ical-feed`,
  also already landed). Both re-verified against their consumers below.
- **`services/apiClient.ts`**: 21 lines — a new `isTransientServiceUnavailable`
  guard narrows the existing 503-retry-with-backoff logic to codes that mean
  "a dependency is briefly down" (`LB-SYS-002`, the generic fallback code);
  a 503 the server sends on purpose (e.g. `LB-UPLD-005`, which carries its
  own `Retry-After`) is surfaced immediately instead of retried. Read in
  full: the two 503-code set is a `ReadonlySet`, the type guard narrows
  `error.response?.data` safely (`typeof data === 'object' && data !== null`
  before indexing), and the condition's "no code at all" branch (a proxy
  error page, not a coded backend response) still retries — matching the
  comment's stated intent. No security-relevant change; retry semantics
  only.
- **`utils/createApiClient.ts`**, **`components/ProtectedRoute.tsx`**: byte-identical
  to the `3f429ede` baseline, re-read in full regardless. No bypass found.
- **Global stores** (`frontend/src/stores/`): one new file,
  `practicalSkillsStore.ts` (93 lines) + its test. Read in full — see
  "Verified good" below.
- **Every `axios.create()` / `createApiClient()` call site, enumerated
  fresh**: still exactly 2 `axios.create()` sites (`services/apiClient.ts`,
  `utils/createApiClient.ts` — CLAUDE.md Pitfall #7 holds by construction)
  and the same module files as pass 8, with no new bespoke instance.
- **Repo-wide sweep for every new `api.get`/`api.post` call site touching
  the global cached client since the baseline** (not limited to
  feature-owned files — the same method pass 8 used), covering
  `adminServices.ts`, `documentsService.ts`, `electionService.ts`,
  `inventoryService.ts`, `medicalSuppliesService.ts`,
  `securityAlertsService.ts`, `trainingServices.ts`, and every
  `modules/*/services/*.ts` module client. Full results below.

Not read line-for-line: the business logic of new endpoints added to
module-scoped clients (`modules/finance/services/api.ts`,
`modules/minutes/services/api.ts`, etc.) — those clients carry no caching
logic at all (confirmed unchanged from pass 8), so their new calls cannot
create a cache-exposure finding, and their permission/org-scoping correctness
belongs to Finance's (Feature 05) and Meetings & Minutes's (Feature 24) own
rotations, both already ✅.

## Route inventory

n/a for this pass — "Frontend shared" owns no backend routes of its own. The
route surface relevant here is every GET URL reachable through the two
global `axios.create()` instances, enumerated in the sweep below rather than
as a method/path/permission table.

## Verified good ✅

- **`practicalSkillsStore.ts`** (new): a Zustand store caching which
  practical-skills method (`SKILLS_TESTING` vs `SHIFT_SIGNOFFS`) the signed-in
  member's department runs, read once per organization and shared across
  every surface that mounts it. Explicitly documented as **not** an access
  control — "the server enforces nothing on it beyond what a shift report
  records" — and the code matches the claim: `setMethod` only updates local
  state for the settings screen to reflect a save the server already
  accepted, `load()` degrades a failed fetch to `method: null` (both systems
  stay visible) rather than assuming a system is off, and nothing is
  persisted to `localStorage`/`sessionStorage`. No PII, no token, no
  cross-member data. In-flight de-duplication (`inflight`) is keyed by
  `organizationId` and cleared in a `finally`, so it cannot wedge a stale
  promise across an org switch.
- **`services/apiClient.ts`'s new 503 handling**: fails closed in the
  direction that matters — an unrecognized or explicitly-coded 503 (the
  server deliberately refusing, e.g. a malware-scanner outage) is surfaced
  at once rather than retried into a 60+90+135s silent hang, while a
  dependency-restart 503 still gets the existing backoff. Consistent with
  CLAUDE.md's Attack Protection fail-open/fail-closed table in spirit (this
  isn't one of its four listed controls, but the same "know which gap you're
  covering" discipline applies and the change doesn't collapse any of them).
- **`utils/apiCache.ts`'s two organic additions since baseline** are both
  correctly scoped: `/integrations/google-workspace/` is doubly covered (also
  matches the pre-existing `/integrations` prefix) for
  `GET /integrations/google-workspace/attention`, which resolves
  `member_name` + `primary_email` per attention item; `/ical-feed` covers
  `GET /integrations/{id}/ical-feed` (also doubly matched by `/integrations`),
  whose response embeds a bearer token in the feed path.
- **`/users/{userId}/status-change`** (new `memberStatusService.getStatusChange`)
  and **`/users/{userId}/status-change-reason`** are both covered by the
  existing bare `/users` prefix (no trailing slash, so it matches any
  `/users/...` sub-path) — a status-change record carries the reason a
  member's status changed, which is exactly the class `/users` already
  excludes.
- **`/elections/{id}/ballot-send-jobs/{jobId}`** (new
  `electionService.getBallotSendJob`) is covered by the existing bare
  `/elections` prefix.
- **`/documents/folders/role-options`** and **`/documents/folders/admin-only`**
  (new `documentsService` calls) are covered by the existing bare
  `/documents` prefix.
- **`/dashboard/pulse-layout`** (+ `/default`) — read/write/reset for a
  member's (and, `/default`, the department's) dashboard card order —
  correctly left cacheable: Feature 29 pass 9's own review (`RPT6-29-reports-
analytics.md`) already verified this is order/visibility preference only,
  carries no member data, and does not itself gate which cards populate
  (`GET /dashboard/widgets` remains the sole content gate). Re-confirmed by
  reading the new type (`DashboardPulseLayout`/`DashboardPulseResponse` in
  `communicationsServices.ts`): card ids + boolean visibility + order only.
- **`/security/weekly-report`** (new `securityAlertsService` call) is covered
  by the existing bare `/security/` prefix.
- **`/medical-supplies/*`** new reads (`storage-options`, `placements`,
  `expiring-stock`, `items/export`, `lots/export`, `items/import-template`)
  are correctly left cacheable, matching Feature 23's own finding
  (`MSUP-23-medical-supplies.md`, "Frontend module, read for the first time
  at this depth"): this module's data is department stock (item names, lot
  numbers, quantities), not PHI, unlike the similarly-named
  `/medical-screening/` endpoints — which stay excluded, unchanged.
- **`/training/submissions/crew/context`** and **`/training/submissions/crew/shifts`**
  (new `trainingServices` calls, crew-recording support) are covered by the
  existing bare `/training/submissions/` prefix.
- **`/inventory/items/colors`**, **`/documents`**, **`/finance/`**,
  **`/grants`** prefix matches, and every other new module-client call found
  in the sweep (new reads under `modules/finance`, `modules/minutes`,
  `modules/grants-fundraising`, `modules/inventory/equipmentCheckApi`,
  `modules/governance`, `modules/prospective-members`) go through a module's
  own `createApiClient()` instance, which carries no caching logic at all —
  confirmed unchanged from pass 8's enumeration, so these cannot create a
  cache-exposure finding regardless of the data they return.
- No bespoke `axios.create()`, no token/secret in a diff, no new
  `localStorage`/`sessionStorage`/`dangerouslySetInnerHTML`/`eval`/
  `window.location` assignment across the entire diff window (grep sweep over
  every changed file in the feature's scope — module clients, global
  services, stores, `apiCache.ts`, `apiClient.ts`).

## Findings

### FE9-34-1 — MEDIUM — `GET /inventory/items/{id}/maintenance` resolves a member's name and is not cache-excluded — ✅ FIXED

**What:** a new frontend call site (`inventoryService.getOpenMaintenanceRecords`,
and the pre-existing full-history call it sits beside) reads
`/inventory/items/{item_id}/maintenance` through the shared, cached global
`api` instance. The backend handler
(`backend/app/api/v1/endpoints/inventory.py::get_item_maintenance_history`,
gated on `inventory.view`) resolves `payload.performed_by_name =
record.technician.display_name` onto every returned `MaintenanceRecordResponse`
(`backend/app/schemas/inventory.py:1267`), alongside that schema's free-text
`description`, `condition_before`/`condition_after`, and `vendor_name` fields.
Neither `UNCACHEABLE_PREFIXES` nor `UNCACHEABLE_SUBSTRINGS` in
`frontend/src/utils/apiCache.ts` matched `/maintenance` before this fix.
**Where:** `frontend/src/utils/apiCache.ts` (missing exclusion);
`frontend/src/services/inventoryService.ts:547` (new call site);
`backend/app/api/v1/endpoints/inventory.py:2926` (the resolution).
**Failure scenario:** two inventory managers share a station terminal/tab. The
first views an item's maintenance history (now stamped with the technician's
display name); the second, within 90 seconds, sees the first's cached
response even after the first signs out of that tab's awareness (the cache is
cleared on logout, but not on an intra-session navigation) — the same class
`/issuances` and `/history` were already excluded for.
**Impact:** a 30-90s member-name + free-text-notes disclosure through an
in-memory, same-tab cache. Same severity class as the standing `/issuances`/
`/history`/`/nfc-scans` exclusions it sits beside — MEDIUM, not HIGH, because
it requires a shared, already-authenticated (`inventory.view`) session within
the TTL window, matching this file's existing severity convention for this
exact shape of finding.
**Fix:** added `/maintenance` to `UNCACHEABLE_SUBSTRINGS` in
`frontend/src/utils/apiCache.ts`, with a comment naming the exact disclosure
and its sibling precedent. Also added `performed_by_name` to `PII_FIELDS` in
`backend/tests/test_api_cache_pii_exclusions.py` (previously absent — the
schema-scan ratchet could not have caught this on its own, since it only
flags field names already in that set) so the backend ratchet can catch a
future regression on this specific field independently of the frontend fix.

## Schema & migration notes

n/a — no model, schema, or migration touched this pass.

## Guard tests added

- `frontend/src/utils/apiCache.test.ts`: `isCacheable('/inventory/items/123/maintenance')`
  must be `false` (FE9-34-1). Fails if the `/maintenance` substring is removed
  from `UNCACHEABLE_SUBSTRINGS`.
- `backend/tests/test_api_cache_pii_exclusions.py`: `PII_FIELDS` now includes
  `performed_by_name`, strengthening
  `test_new_pii_route_is_excluded_from_the_frontend_cache` to flag any route
  whose response schema carries that field and is not excluded — independent
  of the frontend-side fix above.

## Completion gate

| Check                                                                             | Result                                                                                                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                     | clean                                                                                                                                       |
| `black --check app/ tests/ alembic/`                                              | clean (2426 files unchanged)                                                                                                                |
| `isort --check-only app/ tests/ alembic/`                                         | clean                                                                                                                                       |
| `python3 scripts/validate_migrations.py --strict`                                 | 618 revisions, single head `1117b642643b`                                                                                                   |
| `backend/scripts/generate_schema_docs.py` (drift check)                           | `DATABASE_SCHEMA.md` up to date                                                                                                             |
| `pytest tests/ -q -k "maintenance or inventory_service or api_cache"`             | 187 passed, 1 pre-existing skip (`pywebpush`)                                                                                               |
| `npm run typecheck` (frontend)                                                    | clean (after `npm ci` from repo root populated `frontend/node_modules`, which this sandbox hadn't done — no `package.json`/lockfile change) |
| `npm run lint` (frontend)                                                         | clean                                                                                                                                       |
| `npx vitest run src/utils/apiCache.test.ts src/services/inventoryService.test.ts` | 175 passed (2 files)                                                                                                                        |

Rotation row 34 → ✅ (pending this PR's merge). Next: Feature 35 would be the
rotation's wraparound — but per the table's own preamble, 34 is the **last**
row (00–34, 35 iterations per pass), so the next iteration wraps to Feature
00 (Cross-cutting baseline) for a fresh pass over the whole application.
