# Security Review — Feature 32: Locations & Kiosk (pass 8)

**Prefix:** `LOC8` · **Iteration:** 32 · **Reviewed:** 2026-10-21 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/api/public/display.py` (4 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`. Also read: `app/services/facilities_service.py` (`delete_room`, the one other caller of the new `remove_location`) and its route in `endpoints/facilities.py`.
**Frontend:** `pages/LocationsPage.tsx` (delete handlers), `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`.
**Migrations:** `1eb43da769b2` (drops a redundant index on `admin_hub_metric_preferences`). No other revision touches this feature's tables.

---

## Scope

Pass 7's baseline is `48382eeeb` (2026-10-18). Three commits since then touch this feature, all dated 2026-10-20:

| Commit      | What it did here                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `925051877` | Deleting a location now deactivates it when any of five columns still references it, instead of failing or stripping the references. |
| `8a57d0699` | Admin-hub member metrics count probationary members (`ACTIVE_ACCOUNT_STATUSES`) instead of only `ACTIVE`.                            |
| `08fff8048` | Drops a redundant single-column `organization_id` index on `admin_hub_metric_preferences` (model and migration `1eb43da769b2`).      |

**Read in full:** every changed hunk in `location_service.py` (+96), `endpoints/locations.py` (+21), `models/location.py`, `admin_hub_service.py` (+31), `models/admin_hub.py`, the `LocationsPage.tsx` diff, migration `1eb43da769b2`, and `facilities_service.delete_room` with its route.

**Not re-read, byte-identical to the baseline** (`git diff` against `48382eeeb` is empty), which pass 7 read in full: `api/public/display.py`, `endpoints/admin_hub.py`, `schemas/admin_hub.py`, `schemas/location.py`, `utils/org_locks.py`, `LocationKioskPage.tsx`, `AdminHubFrame.tsx`, `RoomQRCodesPage.tsx`. Their verdicts rest on pass 7 plus that empty diff; the two admin-hub gates and the route table below were re-checked directly because they are the claims most worth not inheriting.

## Route inventory

Enumerated from the live FastAPI app (1,938 routes), filtered to this feature's prefixes: 15 routes, identical to pass 7's table.

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                       |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------------ |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                              |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                              |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                              |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                              |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                              |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                              |
| PUT    | `/locations/{id}/badge-check-in`                           | `get_current_user`        | `locations.manage_nfc_tags`           | yes                                              |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                              |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code`; `_rate_limit_display`        |
| POST   | `/api/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                   | via `display_code`; `_rate_limit_badge_tap_ip`   |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | via `display_code`; `_rate_limit_display`        |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | via `display_code`; `_rate_limit_guest_check_in` |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (inline, see below) | yes                                              |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission` (inline)            | yes                                              |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission` (inline)            | yes                                              |

## Verified good ✅

- **All 15 routes are authenticated or deliberately public with a rate-limit dependency.** Mechanism: the dependency tree of every route in the loaded app, read from the framework's own route table, not from a grep of the source. The 4 public routes each carry a `_rate_limit_*` dependency; the other 11 carry `get_current_user` or `get_current_active_user`.
- **The admin-hub routes are gated per module, inline.** `_require_module_access` resolves `MODULE_REGISTRY[module_key]` and requires `user_has_permission(user, spec.permission)`; an unknown module and a forbidden one both answer 404, so a caller cannot learn which modules a department runs. `save_settings` filters on `ctx.organization_id` and checks each metric's own permission before writing, so the department-wide write (`applies_to_everyone`) needs the module's manage permission and nothing wider.
- **`DELETE /locations/{id}` is org-scoped before it acts.** `delete_location` resolves the row through `get_location(location_id, organization_id)` first; a foreign location is a 404 before any count or delete runs.
- **`location_reference_count` is deliberately not org-filtered, and that cannot disclose anything.** Its result is only compared with zero to choose delete or deactivate; it is never returned. The foreign key does not care which organization a referencing row belongs to, so filtering would send a referenced location down the hard-delete path into the constraint.
- **`remove_location`'s callers resolve the location in-org first.** `delete_location` does (above). `facilities_service.delete_room` loads the room with `get_room(room_id, organization_id)` and the linked location with `Location.organization_id == organization_id` before calling it.
- **The new 409 leaks nothing.** `LocationInUseError` carries one static message and both routes pass it through `safe_error_detail`.
- **`_RESTRICTING_LOCATION_REFERENCES` matches the schema exactly today.** Computed from `Base.metadata`: 13 foreign keys point at `locations.id`; the 5 that block a delete (`events.location_id`, `event_templates.default_location_id`, `apparatus.primary_station_id`, `apparatus.current_location_id`, `apparatus_location_history.location_id`) are all listed and the 8 `SET NULL` ones are not. This was a comment-only invariant; LOC8-1 pins it.
- **The dropped `organization_id` index is covered.** `uq_admin_hub_metric_pref_scope (organization_id, module_key, scope_key)` and `idx_admin_hub_metric_pref_org_module (organization_id, module_key)` both lead with `organization_id`, and `1eb43da769b2` checks the table and index before dropping or recreating, in both directions.
- **The admin-hub metric rename widened what counts as a member, not which organization is read.** Every query that uses `_current_member_criteria()` still filters `User.organization_id == ctx.organization_id`.
- **The `LocationsPage.tsx` change adds no sink.** The new toast text comes from `getErrorMessage`, which reads the already-sanitised server detail, and React renders both the toast and the confirm-dialog message (which interpolates `station.name` / `room.name`) as text.
- **All prior-pass findings remain fixed**; none of their code is in the changed hunks.

## Findings

### LOC8-1 — LOW — the delete-or-deactivate rule depended on a hand-kept list with no guard — ✅ FIXED

**What:** `LocationService` chooses between deleting and deactivating a location by counting rows in `_RESTRICTING_LOCATION_REFERENCES`. The list copies a fact the schema already states, and its only protection was a comment ("a new RESTRICT reference to `locations` belongs here").
**Where:** `backend/app/services/location_service.py:29-35`.
**Failure scenario:** a later change adds a table with `ForeignKey("locations.id", ondelete="RESTRICT")` and forgets the list. The count says zero for a location only that table references, the service takes the hard-delete path, MySQL refuses, and the caller gets a 409 telling them to "try again to deactivate it instead". Retrying hits the same refusal every time, so the location can never be removed.
**Impact:** no current defect, the list is exact today. The cost is a delete that fails permanently with a message that implies it will not.
**Fix:** `tests/test_location_restrict_references.py` derives the blocking set from the model metadata and fails if a blocking reference is missing from the list or a non-blocking column is listed. Run against simulated drift of both kinds, it names the offending column in each case.

### LOC8-2 — LOW — hard-deleting a location nulls its location on eight kinds of records — 🚩 FLAGGED

**What:** a location nothing blocking references is hard-deleted, and eight other foreign keys to `locations.id` are `ON DELETE SET NULL`: `training_records`, `meetings`, `inventory_items`, `storage_areas`, `event_requests`, `course_classes`, `course_cohorts`, `course_cohort_classes`. Deleting such a location silently clears where those records happened or live.
**Where:** the models' `ondelete="SET NULL"` columns; the decision point is `LocationService.remove_location` (`location_service.py:285`).
**Failure scenario:** an officer deletes an unused room that a past training record cites. The record keeps everything except its location, and nothing warns them or the record's owner.
**Impact:** integrity of historical records, not access. Commit `925051877` made the five blocking references deactivate instead; these eight were left as `SET NULL`, which may be intentional for some (a storage area or inventory item with no location is a normal state) and not for others (a past training record's location).
**Fix:** not applied. Whether to deactivate for some or all of these, or to warn first, is a product decision. Options: add the training-record and course columns to the deactivate list (a one-line change plus the LOC8-1 guard test updated to match); or leave as is and say so. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Schema & migration notes

- `models/location.py`: `Location.events` gains `passive_deletes="all"`, an ORM-only option with no schema change. It stops the ORM nulling events' `location_id` before the delete, so the `RESTRICT` constraint can fire and be reported as a conflict.
- `models/admin_hub.py`: `index=True` removed from `organization_id`; covered by two composites (see Verified good) and handled by migration `1eb43da769b2`, which is idempotent both ways.
- `ondelete="SET NULL"` columns pointing at `locations.id` are all `nullable=True` (Pitfall #2): checked directly against the model metadata, 8 of 8.
- Alembic head is single (`2794794bda6e`).

## Guard tests added

`backend/tests/test_location_restrict_references.py` (3 tests, `unit`, no database):

- every foreign key to `locations.id` with a blocking rule (`RESTRICT`, `NO ACTION` or omitted) is in `_RESTRICTING_LOCATION_REFERENCES`;
- nothing is in the list that does not block a delete;
- the scan itself finds the known references, so an empty scan cannot make the other two pass.

## Completion gate

| Check                                             | Result                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | clean (flake8 7.3.0 with flake8-pytest-style 2.2.0, CI's pins)                                                                                                                   |
| `black --check` / `isort --check-only`            | clean (black 26.5.1, isort 9.0.1, CI's pins)                                                                                                                                     |
| `python3 scripts/validate_migrations.py --strict` | passed, single head `2794794bda6e`                                                                                                                                               |
| backend tests (scoped)                            | 810 passed, 1 skipped (`py_vapid`, optional dependency) — `-k "location or admin_hub or display or facilit or restrict_references or live_schema_drift or account_status_gates"` |
| `python scripts/mypy_ratchet.py`                  | 0 errors, matching the baseline                                                                                                                                                  |
| `npm run typecheck`                               | exit 0                                                                                                                                                                           |
| `npm run lint`                                    | exit 0                                                                                                                                                                           |

The first scoped run reported 2 failures in `tests/test_live_schema_drift.py`. The sandbox database was at revision `59449acab7ba`, three migrations behind head, and those tests read the live database for the duplicate-foreign-key drift that migration `7c8e6565e05e` repairs. After `alembic upgrade head` on the sandbox database, the same tests pass and the full scoped run is the 810 above. Not a code defect.
