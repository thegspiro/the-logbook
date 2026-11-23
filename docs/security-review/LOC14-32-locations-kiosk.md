# Security Review — Feature 32: Locations & Kiosk (pass 14)

**Prefix:** `LOC14` · **Iteration:** 32 · **Reviewed:** 2026-11-22 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/services/location_display.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `pages/RoomCheckInPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.
**Migrations:** none touching this feature's tables in this window (the only migration between pass 13 and this pass, `561a3e9f4165`, is the merge-heads revision for a pre-existing, out-of-scope Alembic fork left by pass 13 of Scheduled tasks — not this feature's own change).

Watchdog pickup (the dedicated `/loop 30m /security-review` session,
`session_011T1ZyyLrD5HagusgK9uDw2`, remains unreachable). PR #4566
(Feature 31, Scheduled tasks, pass 14) had already merged (`42f390383`)
before this iteration started, with its Open PR row correctly cleared. A
fresh `list_pull_requests` (state `open`, 18 results, no
`claude/security-review-*` head) confirmed row 32 as the next pending
(`⬜`) row on a freshly fetched `main`.

---

## Scope

Pass 13's baseline is PR #4252, merge commit `b29782324`. `git diff
b29782324..HEAD` (1,442 commits) touched 6 of this feature's declared
files:

```
backend/app/api/v1/endpoints/locations.py |  11 +-
backend/app/core/error_codes.py           |   4 +-
backend/app/schemas/event.py              | 248 ++++++++++++++++++++++
backend/app/services/admin_hub_service.py |  46 ++++
frontend/src/pages/LocationKioskPage.tsx  |  17 +-
frontend/src/pages/RoomCheckInPage.tsx    |   4 +-
```

Every other declared file (`display.py`, `admin_hub.py`,
`location_service.py`, `location_display.py`, `models/location.py`,
`models/admin_hub.py`, `schemas/location.py`, `schemas/admin_hub.py`,
`guest_check_in_service.py`, `LocationsPage.tsx`, `RoomQRCodesPage.tsx`,
`AdminHubFrame.tsx`, `GuestCheckInPage.tsx`, `GuestEmailSignIn.tsx`) is
byte-identical to pass 13 and is not re-derived.

Every route re-enumerated by an AST walk over all three endpoint files'
`@router.<verb>` decorators (not trusted from pass 13's table):
**17/17, unchanged** — 8 in `locations.py`, 6 in `display.py`, 3 in
`admin_hub.py`, same handler names as pass 13.

`schemas/event.py`'s 248-line addition is entirely new Outreach/Events
classes (`OutreachRoleNeed`, `GuestHeadcountUpdate`, `OutreachMaterial`,
`OutreachCloseoutUpdate`, `EventTemplateTrainingDetailsBase`,
`EventTemplateTrainingDetails`, `OutreachCalendarItem`) — confirmed by
listing every added `class`/`def` in the diff. None is referenced by
`guest_lookup`, `guest_check_in`, `guest_confirm` or any other symbol this
feature's public display/guest endpoints use; this file's growth belongs to
Events/Outreach's own review and is not re-derived here.

## Real delta

1. **`locations.py:224-237`** — `delete_location`'s docstring was expanded
   to name every kind of record `_RESTRICTING_LOCATION_REFERENCES` protects
   (training record/class/cohort/cohort class, meeting, event request, plus
   the three already-documented kinds) and to state the 409-on-race/retry
   behavior explicitly. Text-only; the behavior it describes is pass 13's
   already-fixed `LOC8-2`/`LOC-41` code, re-confirmed unchanged below.
2. **`error_codes.py:168-174`** — two resolution strings for
   `AUTH_MFA_SETUP_INCOMPLETE` were reworded ("Profile → Security" →
   "My Account → Security"; "Organization Settings → Security" →
   "Settings → Authentication → MFA Policy") to match the current nav
   labels. Text-only, unrelated to this feature's own error codes (no
   `LOCATION_*`/`ADMIN_HUB_*` entries in the diff).
3. **`admin_hub_service.py:823-868`** — a new attention-item row,
   `_course_link_attention`, was added to `_training_attention` (Training's
   own module spec, `permission="training.manage"`). It calls
   `TrainingCourseLinkService(ctx.db).unlinked_names(ctx.organization_id)`
   — read in full (`training_course_links.py:147-177`): both the
   `TrainingRecord` query and the `TrainingCourse` library lookup it draws
   suggestions from filter `organization_id == org_id` directly, so the row
   cannot surface another organization's training names. The call is
   wrapped in its own `try`/`except Exception`, logged at `logger.warning`
   with the org id and the exception as separate arguments (not an
   f-string combined with logger args — Pitfall #33 compliant), so a
   failure in this one row cannot take down the submissions/certification
   rows already computed above it in the same function. `training.manage`
   remains the only gate on everything `_training_attention` returns —
   unchanged from pass 13's confirmation that `admin_hub`'s own three
   routes are gated by `MODULE_REGISTRY`/`_require_module_access`, since
   this addition sits inside an existing attention resolver rather than
   adding a route.
4. **`LocationKioskPage.tsx:262-299`** — three `QRCodeSVG` elements (member
   check-in, guest sign-in, and the guest-only single-QR view) gained a
   `title` prop naming what each code is for. Presentational accessibility
   fix only (screen-reader labels); the QR values themselves
   (`getCheckInUrl(currentEvent.event_id)`) are unchanged.
5. **`RoomCheckInPage.tsx:24-59`** — swapped `getErrorMessage` for the
   shared `getLoadFailureMessage(err, 'this room')` helper on the
   non-404 branch of the load-failure message. Same
   `toAppError(err).status === 404` branching as pass 13; no new
   information is exposed in either branch (the 404 branch is unchanged,
   and `getLoadFailureMessage` is the same shared helper other pages in the
   app already use for this exact phrasing, not a hand-rolled string).

## Route inventory

No route gained, lost, or changed its auth dependency or permission string
since pass 13 — table below reproduced from pass 13 and re-verified field by
field against the current source (`locations.py`, `display.py`,
`admin_hub.py` — the latter two byte-identical, the former's only change is
the docstring in item 1 above).

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

- **Route count and gating unchanged, re-derived by AST** (17/17).
- **LOC-40/LOC-41/LOC8-2 (pass-13 fixes) remain in place.** `location_display.py`
  is still the single display builder for both endpoints;
  `uq_locations_org_name_building` still backs the `building_key` column
  (no migration in this window touches `locations`); the
  `_RESTRICTING_LOCATION_REFERENCES` set and its six `ondelete="RESTRICT"`
  FKs are unchanged (confirmed no diff touches `models/location.py`,
  `models/training.py`, `models/meeting.py`, or `models/event_request.py`
  in this window).
- **The new `_course_link_attention` row is correctly org-scoped and
  correctly gated**, and fails closed on its own row only, not the whole
  attention list (item 3 above).
- **No new or changed migration in this window touches this feature's
  tables** — the one migration since pass 13 (`561a3e9f4165`) is a head
  merge for an unrelated, already-flagged Alembic fork from the Scheduled
  tasks rotation.
- **The two frontend changes are accessibility/presentation only** — no new
  data exposure, no new field read from the API response.

## LOC10-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LOC10-2 | LOW      | 🚩 FLAGGED  | `tests/test_guest_email_first_sign_in.py` is byte-identical to pass 13 (confirmed by `git diff b29782324..HEAD` touching nothing in this file) — the `_member()` fixture still bypasses the `EncryptedText`/`EncryptedEnum` bind-param path with a raw `text()` INSERT. Unchanged assessment: a test-fixture-convention decision, not a one-line fix.                                                                                                                                                              |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection branch still logs the raw applicant email by f-string (`membership_pipeline_service.py:1919`, shifted one line from pass 13's 1918 by an unrelated import insertion earlier in the file; text at that line unchanged — confirmed by reading it directly). Still unreachable from this feature's own kiosk/guest-lookup path; still out of scope for Locations & kiosk — flagged for Membership pipeline / Volunteer recruitment's own next pass. |

## Note on a stale app-review finding (not corrected here — different track)

`docs/app-review/locations-kiosk.md`'s `LOC-41` entry ("(name, building)
uniqueness has no constraint behind it — 🚩 FLAGGED") predates this
rotation's own `LOC13` fix (migration `2bb7c963f351`, `uq_locations_org_name_building`)
and is now stale — the constraint exists. That document belongs to the
separate app-review rotation (its own pass numbering, `A8` pass 4 as of
this writing), which runs on its own cadence; correcting it here risks
colliding with that track's own in-progress session, so it is recorded
here rather than edited. The next app-review pass on this feature should
close it.

## Schema & migration notes

- `scripts/validate_migrations.py --strict` — 820 revisions, single head
  `561a3e9f4165` (the Scheduled-tasks-rotation head merge, unrelated to
  this feature).
- No migration in `b29782324..HEAD` touches a `locations`/`admin_hub`
  table or column.
- `ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True` — unchanged (no diff touches `models/location.py` or the
  three referencing models).

## Guard tests added

None new this pass — no code behavior changed that a missing guard would
leave unprotected. The existing guard suites for pass 13's fixes
(`test_location_display_builder.py`, `test_location_name_uniqueness.py`,
`test_location_name_unique_migration.py`,
`test_delete_reference_guards.py::TestTrainingMeetingsAndRequestsKeepTheirLocation`,
`test_location_restrict_references.py`) all re-ran and passed as part of
this pass's scoped suite below.

## Completion gate

| Check                                                                                                                                                 | Result                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                                                                 | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/`                                                                                                                  | ✅ 3421 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`                                                                                                             | ✅ clean                                         |
| `python3 scripts/validate_migrations.py --strict`                                                                                                     | ✅ 820 revisions, single head `561a3e9f4165`     |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                                                            | ✅ 17/17, unchanged from pass 13                 |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                     | ✅ 338 routes, 0 errors/warnings                 |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display"`                                        | ✅ 779 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                                                                   | ✅ 0 errors                                      |
| `npm run lint`                                                                                                                                        | ✅ 0 errors/warnings                             |
| Relevant vitest (`LocationsPage`, `AdminHubFrame`, `RoomCheckInPage`, `RoomQRCodesPage`, `LocationKioskPage`, `GuestCheckInPage`, `GuestEmailSignIn`) | ✅ 106 passed (6 files)                          |
