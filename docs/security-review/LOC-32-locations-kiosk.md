# Security Review — Feature 32: Locations & Kiosk (pass 2)

**Prefix:** `LOC` · **Iteration:** 32 · **Reviewed:** 2026-08-31 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (364 L, 8 routes),
`app/services/location_service.py` (365 L), `app/api/public/display.py`
(401 L, 3 routes), `app/api/v1/endpoints/admin_hub.py` (112 L, 3 routes),
`app/services/admin_hub_service.py` (1,841 L), `app/services/
guest_check_in_service.py` (361 L), `app/models/location.py`,
`app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/
admin_hub.py`.
**Frontend:** not re-read this pass (see Scope) — no backend or shared type
changed, so nothing new to verify on the frontend side.
**Migrations:** none this pass — no schema change since the last one
(`20260218_0900_add_location_display_code.py`, unchanged).

This is a **zero-diff re-verification**. A byte-for-byte diff against PR
#1916's merge commit (`1b7be79a`) across every backend file in this
feature's surface — endpoints, services, models, schemas — came back empty:

```
git diff 1b7be79a HEAD -- app/services/admin_hub_service.py \
  app/api/v1/endpoints/admin_hub.py app/api/v1/endpoints/locations.py \
  app/services/location_service.py app/api/public/display.py \
  app/schemas/admin_hub.py app/models/admin_hub.py app/models/location.py \
  app/services/guest_check_in_service.py
# (no output)
```

Per the rotation's "read the real code, don't trust a diff" rule, every file
above was still read in full this pass rather than skipped on the strength of
that diff — the diff only set expectations for what the read would find.

## Scope

**Read in full, this pass:** `locations.py` (all 8 routes),
`admin_hub.py` (all 3 routes), `location_service.py` (all methods),
`public/display.py` (all 3 routes, including `_resolve_guest_event`),
`admin_hub_service.py` (all 1,841 lines — every metric resolver, every
attention resolver, the full `MODULE_REGISTRY`, and the `AdminHubService`
class), `guest_check_in_service.py` (all methods), `models/location.py`,
`models/admin_hub.py`, `schemas/location.py`, `schemas/admin_hub.py`.

**Re-verified against:** `docs/security-review/LOC2-32-locations-kiosk.md`
(pass 1, PR #1916, 3 findings + LOC-3 flagged) and, transitively, `docs/
app-review/locations-kiosk.md` (LOC-1 through LOC-4) which pass 1 already
re-verified.

**Not read this pass:** the four frontend pages pass 1 covered
(`LocationKioskPage.tsx`, `GuestCheckInPage.tsx`, `RoomQRCodesPage.tsx`,
`LocationsPage.tsx`) — the zero-diff check above covers every backend
contract they depend on (response shapes, field names, the
`can_view_kiosk_display_codes` gate), and none of those files themselves
appear in `git diff 1b7be79a HEAD --stat -- frontend/src` either, so there is
no new frontend behavior to verify.

## Route inventory

Unchanged from pass 1 — reproduced here for a self-contained record, each
row re-confirmed by this pass's own read rather than copied:

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                            | Notes                                                          |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                   | `display_code` included only if `can_view_kiosk_display_codes` |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                   |                                                                |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                   |                                                                |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                   |                                                                |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                   |                                                                |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                   | audit-logged                                                   |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                   | dead code, zero callers — LOC-3, still open                    |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` (global-unique)    | rate-limited 60/min/IP                                         |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org | rate-limited 60/min/IP                                         |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org | rate-limited 10/min/IP + 300/day/event                         |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                   | 404s an unknown/forbidden module identically                   |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                   |                                                                |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                   | audit-logged                                                   |

Every route carries an auth dependency; the three public routes are
intentionally public and rate-limited.

## Verified good ✅

- **LOC2-32-1 still fixed.** `admin_hub_service.py:1059-1092`
  (`_events_attendance_rate`) still filters `Event.organization_id ==
ctx.organization_id` independently on both queries, not just the RSVP
  side. Guard test `tests/test_admin_hub_db.py::
TestEventsAttendanceRateOrgScoping` unchanged and still passing.
- **LOC2-32-2 still fixed.** `admin_hub_service.py:1600-1635` (`_sanitize`)
  still runs the shared `_permitted()` closure in both the primary
  selection loop and the default-metric padding loop — a permission-gated
  default cannot be padded into a resolved selection for a caller who lacks
  the permission. Guard test `tests/test_admin_hub_metrics.py::
TestSlotResolution::test_padding_from_module_defaults_still_respects_permission_gates`
  unchanged and still passing.
- **LOC2-32-3 still fixed, including the Codex round's correction.**
  `admin_hub_service.py:1768-1819` (`save_settings`) still wraps the
  first-insert race in a bounded 2-attempt retry, and the `except
IntegrityError` branch still explicitly `db.refresh(ctx.user)`s (columns,
  then `positions`) before the retry — the fix for the session-expiration
  gap Codex caught in PR #1916. Guard tests
  `tests/test_admin_hub_metrics.py::TestSaveSettingsFirstInsertRace`
  unchanged and still passing (both the single-conflict-retries and the
  second-conflict-still-raises cases).
- **LOC-1, LOC-2, LOC-4 (pre-pass-1 findings) still hold**, re-confirmed
  directly rather than inherited: `locations.py:329` and
  `display.py:198,329` (via `location_service.py:273`) still call
  `EventService._get_check_in_window(event)` rather than a hardcoded
  window; `display.py:235-248` still populates `LocationDisplayInfo.timezone`
  from `Organization.timezone`; `location_service.py:249` still bounds its
  SQL prefilter to a 24h horizon matching the widest configurable check-in
  lead, with the exact window still applied in Python against the canonical
  per-event function.
- **`can_view_kiosk_display_codes` gate still applied uniformly.** All four
  `locations.py` response builders (`_location_to_list_item`,
  `_location_to_response`, called from `list`, `create`, `get`, `update`,
  `regenerate_display_code`) still pass `include_display_code=
can_view_kiosk_display_codes(current_user)` — no response path bypasses it.
- **Guest check-in surface (`guest_check_in_service.py`, read in full this
  pass) has no injection or tenant-isolation surface.** `organization_id` is
  always the value the endpoint resolved from `display_code` → `Location` →
  org, never read from the request body or trusted from the client;
  `_find_existing_attendee` matches on `func.lower(...)` equality, not
  `.like()`/`.ilike()`, so `LIKE_ESCAPE_CHAR` does not apply. Pipeline and
  prospect-creation failures (`_link_prospect`,
  `try_advance_attendance_pipeline`) are caught and logged, never allowed to
  roll back a guest's already-committed attendance record — matches the
  file's own stated intent.
- **`admin_hub_service.py`'s full resolver set (all 1,841 lines, one
  continuous read this pass) remains org-scoped throughout** — every
  `select()` filters `organization_id` directly or through a shared
  criteria helper (`_active_member_criteria`, `_in_service_criteria`,
  `_below_par_criteria`) that is never called without it. No raw SQL, no
  `.like()`/`.ilike()` anywhere in the file (re-confirmed by grep, not just
  the read).
- **No PII/PHI leak in dashboard text**, re-confirmed line by line: every
  `AdminAttentionItem`/`AdminMetric` value constructed in this pass's read
  is an aggregate count, percentage, or generic phrase — no member name,
  email, or other identifying field is interpolated into a `title` or
  `detail` string anywhere in the file.
- **Fail-safe exception boundaries unchanged.** `get_summary`'s attention-
  queue try/except and `_render_metric`'s per-metric try/except both still
  degrade to an empty queue / `UNKNOWN_VALUE` on failure rather than taking
  the whole page down, exactly as pass 1 found.
- **`ondelete="SET NULL"` columns still `nullable=True`.**
  `Location.facility_id` and `Location.facility_room_id` (`models/
location.py:73-85`) are both `ForeignKey(..., ondelete="SET NULL")` and
  both `nullable=True` — CLAUDE.md Pitfall #2 holds.
- **`AdminMetricSettingsUpdate` sends every field the screen owns on every
  save** (`metric_keys`, `applies_to_everyone`, both required, no optional
  omission path) — CLAUDE.md Pitfall #1's update-path form does not apply
  here since there is no partial-update semantics for this payload.

## Findings

None. Zero code change since pass 1 (verified by diff, above), and this
pass's independent full read of every file found no new issue and no
regression in any of pass 1's three fixes.

## LOC-3 status — still flagged, unchanged

`GET /locations/{id}/display` (`locations.py:290-364`) still has zero
frontend callers (confirmed via grep across `frontend/src`), still hardcodes
`is_valid=True`/`can_check_in=True`, still never populates `timezone`
(defaults to `None`), and still emits `event_description=event.description`
unredacted (`locations.py:336`) while its public sibling
(`display.py:206`) explicitly nulls that field. No new gap since pass 1 — the
third gap (description redaction) pass 1 already identified is the same one
today. Not fixed this pass either, for the same reason: deleting or wiring up
a dead endpoint is an API-surface decision, not a drive-by correction.
Already tracked in `docs/KNOWN_LIMITATIONS.md`; no change needed there.

## Schema & migration notes

No new columns or tables. `AdminHubMetricPreference` and
`Location.display_code` both unchanged since pass 1.
`scripts/validate_migrations.py --strict` — 394 revisions, single head.

## Guard tests added

None this pass — no fix to guard, since no new finding. Pass 1's three guard
tests (`TestEventsAttendanceRateOrgScoping`,
`test_padding_from_module_defaults_still_respects_permission_gates`,
`TestSaveSettingsFirstInsertRace`) were re-run and still pass (see
Completion gate).

## Completion gate

| Check                                                                 | Result                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| Diff against pass 1's merge commit (`1b7be79a`), full feature surface | ✅ empty — no backend or frontend file changed                |
| Scoped backend tests (`-k "location or admin_hub or guest_check_in"`) | ✅ 290 passed, 1 skipped (pre-existing, missing optional dep) |
| `python3 scripts/validate_migrations.py --strict`                     | ✅ passed, 394 revisions, single head                         |
| `flake8`/`black --check`/`isort --check-only`                         | n/a — no file in this feature's surface changed               |
| `tsc --noEmit` / `eslint .`                                           | n/a — no frontend file in this feature's surface changed      |

No linter run was needed or skipped: nothing changed for it to check, so
running it would exercise no code this pass touched. The full-suite lint/
typecheck jobs already ran clean on this exact `HEAD` as part of PR #2095's
completion gate one iteration ago.
