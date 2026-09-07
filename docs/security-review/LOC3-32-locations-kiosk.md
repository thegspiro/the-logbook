# Security Review — Feature 32: Locations & Kiosk (pass 3)

**Prefix:** `LOC3` · **Iteration:** 32 · **Reviewed:** 2026-09-07 · **PR:** (opening)

**Backend:** `app/api/v1/endpoints/locations.py` (364 L, 8 routes, byte-identical
to pass 2), `app/services/location_service.py` (382 L, byte-identical),
`app/api/public/display.py` (418 L, byte-identical), `app/api/v1/endpoints/
admin_hub.py` (112 L, byte-identical), `app/services/admin_hub_service.py`
(2,531 L — **+690 lines since pass 2**, two new admin-hub modules), `app/
services/guest_check_in_service.py` (byte-identical), `app/schemas/
admin_hub.py`, `app/schemas/location.py` (byte-identical), `app/models/
admin_hub.py`, `app/models/location.py` (byte-identical).
**Frontend:** `components/admin/AdminHubFrame.tsx` (breadcrumb + optional-
summary props, shared by every admin hub including Locations/kiosk's own),
`pages/scheduling/admin/SchedulingAdminHub.tsx` (new — reviewed for the
backend contract it consumes, not as this feature's own scope; the route/card
permission gating is Feature 15's), `types/adminHub.ts`. Locations/kiosk's
own frontend surface (`LocationKioskPage.tsx`, `GuestCheckInPage.tsx`,
`RoomQRCodesPage.tsx`, `LocationsPage.tsx`) was not touched since pass 2
(confirmed by `git diff`) and was not re-read this pass; pass 2's review of it
stands.
**Migrations:** none new for this feature's tables. 39 migrations landed
repo-wide since pass 2's baseline; grepped for any touching `locations`,
`admin_hub_metric_preferences`, or `display_code` — none found.
`20260901_1100_c3d0e5f7a924_issuance_lot_allocations.py` (named in this
iteration's brief) is Inventory's (`item_issuances.lot_allocations`), not
this feature's; read it to confirm the mismatch and set it aside.
`20260823_1000_c3e91a7f4d28_add_admin_hub_metric_preferences.py`,
`20260120_0013_add_locations_table.py`, and `20260218_0800_unify_locations_
facilities_bridge.py` all predate pass 2 and are unchanged.

---

## Delta method

Pass 2's baseline is commit `5e382921` (PR #2098, 2026-08-31). `git diff
--stat 5e382921 origin/main` scoped to every file in this feature's surface
found exactly one file changed: `admin_hub_service.py`, +690/−0 lines (a pure
addition — no line inside the file pass 2 reviewed was touched). Every other
backend file above is byte-identical to what pass 2 signed off, so pass 2's
per-file verification carries forward unchanged rather than being re-derived.

The +690 lines are two new administration-hub modules, `scheduling` and
`storefront`, registered in `MODULE_REGISTRY` — added by the Scheduling
Administration project (commits `f3552302`..`f0645c0a`) moving Scheduling's
and the department store's own settings/metrics pages to live inside the
shared Administration frame this feature owns. Given full scrutiny per the
brief's "grown substantially since pass 2" instruction, below.

## Route inventory

Unchanged from pass 2 — re-confirmed by re-reading `locations.py`,
`admin_hub.py`, and `public/display.py` directly rather than assuming the
table still matches (all three are byte-identical, so the table below is
carried forward with that verification, not re-typed blind).

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                            | Notes                                                                                 |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                                   | `display_code` included only if `can_view_kiosk_display_codes`                        |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                                   |                                                                                       |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                                   |                                                                                       |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                   |                                                                                       |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                                   |                                                                                       |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                   | audit-logged                                                                          |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                                   | dead code, zero callers — LOC-3, still open                                           |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` + `Organization.active` (LOC-32-2) | rate-limited 60/min/IP                                                                |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org                 | rate-limited 60/min/IP                                                                |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org                 | rate-limited 10/min/IP + 300/day/event, reserved after all rejection gates (LOC-32-4) |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                                   | 404s an unknown/forbidden module identically                                          |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                   |                                                                                       |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                   | audit-logged                                                                          |

`MODULE_REGISTRY` now carries 6 modules, not 4 — `scheduling`
(`scheduling.manage`) and `storefront` (`storefront.manage`) added since
pass 2 — but the three routes above are keyed on the _registry entry's own_
`permission`, so the endpoint surface and its gating mechanism are unchanged;
only the set of valid `module_key` values grew.

## Verified good ✅

- **LOC-32-1 through LOC-32-5 (pass 2) all still fixed, verified directly
  against current code, not assumed from the zero-diff finding alone:**
  `get_location_by_display_code` still joins `Organization` and filters
  `Organization.active == True` (`location_service.py:368`);
  `_link_prospect`'s insert is still wrapped in `begin_nested()` with the
  `.with_for_update()` recheck (`guest_check_in_service.py:269,306`);
  `update_location`'s duplicate check still reads `model_fields_set`
  (`location_service.py:132`); `guest_check_in`'s window/finalization
  rejections still run before `daily_cap_exceeded`
  (`display.py:325-361`, comment intact); `LocationUpdate` still carries the
  `model_validator` rejecting an explicit `null` for `name`/`is_active`
  (`schemas/location.py:79`).
- **LOC-1/2/4 (pre-pass-1) still hold** — canonical check-in window, kiosk
  timezone, 24h prefilter bound. Unchanged files, re-confirmed by direct read.
- **LOC-3 still open, unchanged** — `GET /locations/{id}/display` still has
  zero frontend callers (re-grepped `frontend/src` for any caller of this
  path outside `api/public/v1/display/`: none), still emits
  `event_description=event.description` at `locations.py:336`. No new gap
  found this pass beyond the three `docs/KNOWN_LIMITATIONS.md` already
  records. Not fixed, same reasoning as passes 1/2: deleting or wiring up a
  dead endpoint is an API-surface decision.
- **The two new admin-hub modules (`scheduling`, `storefront`) are correctly
  org-scoped throughout.** Every query added in the +690-line diff filters
  `organization_id` — directly (`Shift.organization_id ==
ctx.organization_id`, `StoreOrder.organization_id ==
ctx.organization_id`, etc.) or via a shared criteria tuple
  (`_store_pending_verification_criteria`, `_store_open_orders_criteria`,
  `closeout_backlog_halves` from `scheduling_service.py`) that is never
  called without the org filter. Confirmed by reading every one of the 13 new
  resolver functions (`_scheduling_*` ×6, `_store_*` ×6,
  `_storefront_attention` ×1) end to end, not by pattern-grepping for the
  filter's presence. Both new modules ship their own dedicated,
  pre-existing test files —
  `tests/test_admin_hub_scheduling.py` (36 tests) and
  `tests/test_admin_hub_storefront.py` (17 tests) — each with an explicit
  cross-org-isolation test per resolver family
  (`test_ignores_another_departments_shift`,
  `test_ignores_another_departments_attendance`,
  `test_does_not_report_another_departments_schedule`,
  `test_does_not_report_another_departments_store`); all pass.
- **No injection surface added.** No raw SQL and no `.like()`/`.ilike()` in
  the new code (confirmed by grep over the diff hunk specifically, not just
  the whole file).
- **No PII/PHI in the new modules' text.** Every new `AdminMetric`/
  `AdminAttentionItem` value is an aggregate count, a dollar total, or a
  generic phrase ("2 shifts short of minimum staffing", "member says they
  paid") — no member or guest name surfaced on a card, consistent with the
  file's established pattern for the four pre-existing modules.
- **Permission sensitivity matches the data.** `scheduling.manage` and
  `storefront.manage` are the same grants those modules' own endpoints
  already gate on (`scheduling.py`, `storefront.py`) — the admin-hub cards
  are not a lower bar than the underlying data's own module already
  enforces, so this is not an XC-2 pattern (a `.view`-level gate on
  `.manage`-level data).
- **The existing permission/module-gate machinery (`_sanitize`'s
  `_permitted()`, `_render_metric`'s redacted-value branch,
  `get_settings`'s protected-metric filtering) applies to the two new
  modules with no special-casing needed** — neither module's `MetricSpec`
  list sets a per-metric `permission` narrower than the module's own, so the
  LOC2-32-2 padding-loop gap (fixed pass 2) has nothing to bite on here; the
  registry-level `permission` gate at the endpoint (`admin_hub.py:37-46`,
  unchanged) is what actually decides who can reach either module.
- **Bounded, not N+1.** `_short_staffed_shifts` scans at most a 7-day (or
  48-hour, for the attention queue) window with one query for shifts, one
  for assignments (`ShiftAssignment.shift_id.in_(shift_ids)`), one for
  apparatus minimums — matching `SchedulingService.get_open_shifts`'s own
  established shape, no per-shift query in a loop. The store resolvers are
  each one or two aggregate `count()`/`sum()` queries, no per-row loop.
- **`AdminHubFrame.tsx`'s two changes (an optional `summary` fetch-skip prop,
  and `?? []` on `summary.attention`) are defensive UI robustness, not an
  access-control change** — the underlying `/admin-hub/{module}/summary`
  permission gate (`admin_hub.py`'s `_require_module_access`) is untouched;
  `summary={canManage}` in the new `SchedulingAdminHub.tsx` merely avoids a
  guaranteed-404 request for a viewer the frame's own docstring says was
  never entitled to that data, which the server already refuses today
  regardless of this flag.

## Findings

**None new this pass.** Zero fixes, zero flagged. The one substantial piece
of new code in this feature's surface since pass 2 — the `scheduling` and
`storefront` admin-hub modules — was read in full and found to follow the
same org-scoping, permission-gating, and PII-avoidance patterns already
established and tested for this file's four pre-existing modules, with its
own dedicated cross-org-isolation test coverage already in place (54 tests
across the two new test files, none of which needed a fix). No regression
found in any of pass 1/2's five prior findings.

## Schema & migration notes

No new columns or tables for this feature. `AdminHubMetricPreference` and
`Location.display_code` are unchanged from pass 2.
`scripts/validate_migrations.py --strict`: 432 revisions, single head
(`ee7390dcdf47`).

## Guard tests added

None — no fix in this pass to guard. The 54 pre-existing tests in
`tests/test_admin_hub_scheduling.py` / `tests/test_admin_hub_storefront.py`
already cover the new modules' org-scoping and business rules; re-run clean
as part of the scoped and full suites below.

## Completion gate

| Check                                                    | Result                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                            | ✅ 0 violations                                                                                                 |
| `black --check app/ tests/ alembic/`                     | ✅ clean, 1513 files unchanged                                                                                  |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.1) | ✅ clean                                                                                                        |
| `python3 scripts/validate_migrations.py --strict`        | ✅ 432 revisions, single head                                                                                   |
| Scoped tests (`-k "location or kiosk or admin_hub"`)     | ✅ 345 passed, 1 skipped (pywebpush, pre-existing)                                                              |
| Full backend suite (`pytest tests/`)                     | ✅ 11,645 passed, 21 skipped (pre-existing), 0 failed                                                           |
| `npm run typecheck` (aliased `tsc-native`)               | ✅ 0 errors                                                                                                     |
| `npm run lint`                                           | ✅ 0 errors, 2 pre-existing warnings (unrelated file, `CallTypeChips.tsx`, under the max-warnings-10 threshold) |
