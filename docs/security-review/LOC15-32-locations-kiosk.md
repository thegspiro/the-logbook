# Security Review — Feature 32: Locations & Kiosk (pass 15)

**Prefix:** `LOC15` · **Iteration:** 32 · **Reviewed:** 2026-11-25 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/services/location_display.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `pages/RoomCheckInPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.
**Migrations:** none touching this feature's tables in this window.

Watchdog pickup (the dedicated `/loop 30m /security-review` session,
`session_011T1ZyyLrD5HagusgK9uDw2`, remains unreachable — confirmed via
`ListAgents` → "No reachable agents"). PR #4708 (Feature 31, Scheduled
tasks, pass 15) was fully green (`CI`, `Secret Scan`, `Supply Chain`,
`Docs Site` all `success` on its head SHA; the two Codex-bot comments are
the same usage-limit failure noise seen on every recent pass, not an
actionable finding) and was merged by this same watchdog session as
squash commit `220abf469`. A fresh `list_pull_requests` (state `open`)
then returned 0 results, so this iteration continued to Step 1: row 32
(Locations & kiosk) was the next `⬜` row, confirmed directly against the
rotation table on a freshly fetched `main`.

---

## Scope

Pass 14's baseline is PR #4576, merge commit `8c20bff8c`. `git diff
8c20bff8c..HEAD` touched 3 of this feature's declared files:

```
backend/app/schemas/event.py              | 99 +++++++++++++++++++++++++++++--
backend/app/services/admin_hub_service.py | 36 +++++++++++
backend/app/services/location_service.py  |  7 +++
frontend/src/pages/RoomQRCodesPage.tsx    |  4 +-
```

Every other declared file (`locations.py`, `display.py`, `admin_hub.py`,
`location_display.py`, `models/location.py`, `models/admin_hub.py`,
`schemas/location.py`, `schemas/admin_hub.py`, `guest_check_in_service.py`,
`error_codes.py`, `LocationsPage.tsx`, `LocationKioskPage.tsx`,
`RoomCheckInPage.tsx`, `AdminHubFrame.tsx`, `GuestCheckInPage.tsx`,
`GuestEmailSignIn.tsx`) is byte-identical to pass 14 and is not re-derived.

Every route re-enumerated by an AST-equivalent `grep` walk over all three
endpoint files' `@router.<verb>` decorators (not trusted from pass 14's
table): **17/17, unchanged** — 8 in `locations.py`, 6 in `display.py`, 3 in
`admin_hub.py`, same handler names as pass 14.

`schemas/event.py`'s 99-line addition is entirely new Outreach/Events/
Training-template classes (`feedback_form_id`/`feedback_rating_field_id`
on `RequestPipelineUpdate`, `essential` on `OutreachRoleNeed`, the new
`EventVolunteerRole`/`EventVolunteerSignup`/`EventVolunteerSeat`/
`EventVolunteerSeatBoard` classes, and new training-link fields on
`EventTemplateTrainingDetails`) — confirmed by listing every added
field/class in the diff. None is referenced by `guest_lookup`,
`guest_check_in`, `guest_confirm`, or any other symbol this feature's
public display/guest endpoints use; this file's growth belongs to
Events/Outreach/Training's own review and is not re-derived here, matching
pass 14's treatment of the same file.

## Real delta

1. **`admin_hub_service.py:840-868`** — a new `_double_credit_attention`
   row was added to `_training_attention` (Training's own module spec,
   `permission="training.manage"`). It calls
   `count_open_flags(ctx.db, ctx.organization_id)`
   (`training_credit_duplicates.py:176-199`) — read in full: the query
   joins `TrainingCreditDuplicateFlag` to both its `TrainingRecord` sides
   and applies `_open_criteria(organization_id, ...)`, so the count and
   oldest-flag timestamp cannot include another organization's pairs. The
   row's `href` and `detail` carry only a count and an age in days, no
   member name or record content. `training.manage` remains the only gate
   on everything `_training_attention` returns — unchanged from pass 13's
   confirmation that `admin_hub`'s own three routes are gated by
   `MODULE_REGISTRY`/`_require_module_access`, since this is an addition
   inside an existing attention resolver, not a new route. Unlike the
   adjacent `_course_link_attention` call, this one is not wrapped in its
   own `try`/`except` — but neither are its other two siblings
   (`_skill_test_attention`, `_shift_report_attention`), so this matches
   the file's existing, already-accepted convention rather than
   introducing a new unguarded call; only `_course_link_attention` earned
   isolation, per the comment above it, because of a call chain already
   known to be failure-prone.
2. **`admin_hub_service.py:1715`** — `_scheduling_hours_this_month`'s shift
   totals query gained `duty_shifts_only()` (`utils/duty_shifts.py`), which
   filters `Shift.is_outreach.is_(False)`. This is a correctness fix
   (Pitfall #29 — a shift-hours total must agree with every other figure
   that totals shift hours) with no org-scoping or auth implication: the
   surrounding query already filters `Shift.organization_id ==
ctx.organization_id`, unchanged.
3. **`location_service.py:560-611`** — `check_overlapping_events` gained an
   optional `exclude_event_ids: Collection[str] = ()` parameter, appended
   as an additional `Event.id.not_in(...)` filter alongside the existing
   `exclude_event_id` single-id filter. Traced its one caller,
   `event_service.py`'s `_refuse_series_room_clashes` (Events/Requests'
   own file, not re-reviewed here beyond this call site): the ids passed
   are `[str(e.id) for e in occurrences]` — the series' own occurrences
   that `update_event` already resolved server-side from an org-scoped
   fetch — never a client-supplied id, so the new parameter cannot be used
   to exclude an arbitrary event from the clash check. `for_booking`
   still defaults to `True` at every call site that reaches this path, so
   `lock_room_bookings` and the query's own `with_for_update()` (Pitfall
   #27) are unchanged by this addition.
4. **`RoomQRCodesPage.tsx:542,546`** — removed a redundant `text-sm` on the
   "Card Readers" link and `py-2.5` on the "Print All" button; both
   already come from `btn-secondary`/`btn-primary`'s own sizing. Purely
   cosmetic (the shared button utilities already set the touch-target
   height this duplicated), no behavior or data change.

## Route inventory

No route gained, lost, or changed its auth dependency or permission string
since pass 14 — table reproduced from pass 14 and re-verified field by
field against the current source (all three files byte-identical except
the two non-route changes in items 1–2 above, which sit in a helper
function this table does not cover).

| Method | Path                                                   | Auth dependency           | Permission                                    | Org-scoped                       |
| ------ | ------------------------------------------------------ | ------------------------- | --------------------------------------------- | -------------------------------- |
| GET    | `/locations`                                           | `get_current_user`        | none                                          | yes                              |
| POST   | `/locations`                                           | `require_permission`      | `locations.create` OR `locations.manage`      | yes                              |
| GET    | `/locations/{id}`                                      | `get_current_user`        | none                                          | yes                              |
| PATCH  | `/locations/{id}`                                      | `require_permission`      | `locations.edit` OR `locations.manage`        | yes                              |
| DELETE | `/locations/{id}`                                      | `require_permission`      | `locations.delete` OR `locations.manage`      | yes                              |
| POST   | `/locations/{id}/regenerate-display-code`              | `require_permission`      | `locations.edit` OR `locations.manage`        | yes                              |
| PUT    | `/locations/{id}/badge-check-in`                       | `require_permission`      | `locations.manage_nfc_tags`                   | yes                              |
| GET    | `/locations/{id}/display`                              | `get_current_user`        | none                                          | yes                              |
| GET    | `/public/v1/display/{code}`                            | none (public)             | n/a                                           | by display code → org            |
| POST   | `/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                           | by display code                  |
| GET    | `/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                           | via display-code-owning location |
| POST   | `/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                           | same                             |
| POST   | `/public/v1/display/{code}/events/{id}/guest-lookup`   | none (public)             | n/a                                           | same                             |
| POST   | `/public/v1/display/{code}/events/{id}/guest-confirm`  | none (public)             | n/a                                           | same; token-scoped               |
| GET    | `/admin-hub/{module_key}/summary`                      | `get_current_active_user` | module's own `.manage`, via `MODULE_REGISTRY` | n/a                              |
| GET    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                          | n/a                              |
| PUT    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                          | n/a                              |

## Verified good ✅

- **Route count and gating unchanged, re-derived by grep over every
  `@router.<verb>` decorator** (17/17).
- **The new `_double_credit_attention` row is correctly org-scoped**
  (`_open_criteria(organization_id, ...)` inside `count_open_flags`) **and
  correctly gated** (sits inside `_training_attention`, same
  `training.manage` module gate as every other row it returns), and its
  response fields carry only a count and an age — no PII.
- **LOC-40/LOC-41/LOC8-2 (pass-13 fixes) remain in place** — `location_display.py`
  is still the single display builder for both endpoints;
  `uq_locations_org_name_building` still backs the `building_key` column
  (no migration in this window touches `locations`); the
  `_RESTRICTING_LOCATION_REFERENCES` set and its six `ondelete="RESTRICT"`
  FKs are unchanged (no diff touches `models/location.py`,
  `models/training.py`, `models/meeting.py`, or `models/event_request.py`
  in this window).
- **The new `exclude_event_ids` parameter cannot be used to bypass the
  room-overlap check against an arbitrary event** — its only caller passes
  server-resolved ids of the series being edited, never a client-supplied
  value, and the existing lock (`lock_room_bookings` + `with_for_update()`)
  is unchanged.
- **No new or changed migration in this window touches this feature's
  tables.**
- **The one frontend change is cosmetic** — removing a redundant Tailwind
  class the shared `btn-*` utility already applies, no new data exposure.

## LOC10-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC10-2 | LOW      | 🚩 FLAGGED  | `tests/test_guest_email_first_sign_in.py` is byte-identical to pass 14 — the `_member()` fixture still bypasses the `EncryptedText`/`EncryptedEnum` bind-param path with a raw `text()` INSERT. Unchanged assessment: a test-fixture-convention decision, not a one-line fix.                                                                                           |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection branch still logs the raw applicant email by f-string (`membership_pipeline_service.py`), confirmed unchanged at its pass-14 location. Still unreachable from this feature's own kiosk/guest-lookup path; still out of scope for Locations & kiosk — flagged for Membership pipeline's own next pass. |

**0 fixed, 0 new findings.** Every real change in this window was already
reviewed as safe (items 1-4 above); no new risk surfaced.

## Note on a stale app-review finding (not corrected here — different track)

Unchanged from pass 14: `docs/app-review/locations-kiosk.md`'s `LOC-41`
entry predates pass 13's fix and remains stale. Left for the app-review
rotation to close on its own cadence, per pass 14's note.

## Schema & migration notes

- `scripts/validate_migrations.py --strict` — 844 revisions, single head
  `e9cf8ab7e4e4`.
- No migration since pass 14 touches a `locations`/`admin_hub` table or
  column.
- `ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True` — unchanged (no diff touches `models/location.py` or the
  three referencing models).

## Guard tests added

None new this pass — no code behavior changed that a missing guard would
leave unprotected. The existing guard suites from prior passes
(`test_location_display_builder.py`, `test_location_name_uniqueness.py`,
`test_location_name_unique_migration.py`,
`test_delete_reference_guards.py::TestTrainingMeetingsAndRequestsKeepTheirLocation`,
`test_location_restrict_references.py`) all re-ran and passed as part of
this pass's scoped suite below.

## Completion gate

| Check                                                                                                                                                        | Result                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1)                                                                                                          | ✅ 0 violations                                  |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1)                                                                                                 | ✅ 3541 files unchanged                          |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2)                                                                                              | ✅ clean                                         |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                         | ✅ 844 revisions, single head `e9cf8ab7e4e4`     |
| Route re-enumeration (grep walk of all 3 files' decorators)                                                                                                  | ✅ 17/17, unchanged from pass 14                 |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)                                                                                         | ✅ 344 routes, 0 errors/warnings                 |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display or double_credit or training_credit_duplicate"` | ✅ 780 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                                                                          | ✅ 0 errors                                      |
| `npm run lint`                                                                                                                                               | ✅ 0 errors/warnings                             |
| Relevant vitest (`LocationsPage`, `RoomQRCodesPage`, `LocationKioskPage`, `RoomCheckInPage`, `AdminHubFrame`, `GuestCheckInPage`, `GuestEmailSignIn`)        | ✅ 106 passed (6 files)                          |
