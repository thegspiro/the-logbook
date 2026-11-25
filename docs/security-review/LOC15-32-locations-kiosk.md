# Security Review — Feature 32: Locations & Kiosk (pass 15)

**Prefix:** `LOC15` · **Iteration:** 32 · **Reviewed:** 2026-11-25 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/services/location_display.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `pages/RoomCheckInPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.
**Migrations:** none touching this feature's own tables in this window. 23 migrations landed between pass 14 and this pass; none creates or alters a `locations`/`admin_hub` table or column (checked by name and by `git diff --name-status` against the baseline — full list in Scope).

Watchdog pickup (the dedicated `/loop 30m /security-review` session remains
unreachable). PR #4708 (Feature 31, Scheduled tasks, pass 15) had already
merged (`220abf469`) before this iteration started, confirmed by that commit
being the tip of a freshly-fetched `origin/main`. A fresh `list_pull_requests`
(state `open`) returned 0 results — no `claude/security-review-*` head
existed — so this iteration started Feature 32, the next pending (`⬜`) row
on the rotation table, read directly rather than inferred from narrative.
(The working tree initially carried a leftover local branch,
`claude/security-review-scheduled-tasks-p15`, from the iteration that opened
#4708; `git status` was empty, so switching to `main` and fast-forwarding
cost no work.)

---

## Scope

Pass 14's baseline is PR #4576, merge commit `8c20bff8c`. `git diff
8c20bff8c..HEAD` touched 3 of this feature's declared files:

```
backend/app/services/admin_hub_service.py | 36 +++++++++++++++++++++++++++++
backend/app/services/location_service.py  |  7 ++++++
frontend/src/pages/RoomQRCodesPage.tsx    |  4 ++--
```

Every other declared file (`locations.py`'s routes themselves, `display.py`,
`admin_hub.py`, `location_display.py`, `models/location.py`,
`models/admin_hub.py`, `schemas/location.py`, `schemas/admin_hub.py`,
`guest_check_in_service.py`, `schemas/event.py`, `error_codes.py`,
`LocationsPage.tsx`, `LocationKioskPage.tsx`, `RoomCheckInPage.tsx`,
`AdminHubFrame.tsx`, `GuestCheckInPage.tsx`, `GuestEmailSignIn.tsx`) is
byte-identical to pass 14 (`git diff 8c20bff8c..HEAD -- <each file>` empty)
and is not re-derived.

Every route re-enumerated by an AST walk over all three endpoint files'
`@router.<verb>` decorators (not trusted from pass 14's table): **17/17,
unchanged** — 8 in `locations.py`, 6 in `display.py`, 3 in `admin_hub.py`,
same handler names as pass 14.

23 new migrations landed in this window
(`20261122_0100_e3b8d61f4a27` … `20261125_0648_e9cf8ab7e4e4`, found via
`git diff 8c20bff8c..HEAD --name-status -- backend/alembic/versions/` and
filtered to `A` (added) rows only, discarding the much larger "touched by
some commit in range" list `git log --name-only` over-reports for files that
predate the range). None names or alters a `locations` or `admin_hub` table;
one (`20261123_0542_66f64aabdda2_training_credit_duplicate_flags.py`) creates
the table the new admin-hub attention row in finding delta item 2 below
reads, and is Training's own migration to review, not this feature's.

## Real delta

1. **`location_service.py:559-612`** — `check_overlapping_events` gained an
   `exclude_event_ids: Collection[str] = ()` parameter, applied as
   `Event.id.not_in([...])` alongside the pre-existing `exclude_event_id`
   single-id exclusion. Used by a new series-edit path in
   `event_service.py:1695-1700` (Events' own file, out of this feature's
   scope, read only to confirm the call shape) to exclude a recurring
   series' own not-yet-moved occurrences from their own clash check. The
   org-scoping clauses this query already carried
   (`Event.organization_id == str(organization_id)`, confirmed present at
   `location_service.py:584`) sit **before** this change and are untouched
   by it; the new clause only narrows the result set further. No new
   tenant-isolation surface.
2. **`admin_hub_service.py:114-115,840,870-902,1715`** — a new attention-item
   row, `_double_credit_attention`, appended to `_training_attention`
   (`training.manage`-gated ModuleSpec, unchanged — confirmed at
   `admin_hub_service.py:2258-2260`). It calls
   `training_credit_duplicates.count_open_flags(ctx.db, ctx.organization_id)`
   — read in full: `_open_criteria` filters
   `TrainingCreditDuplicateFlag.organization_id == organization_id` directly
   (`training_credit_duplicates.py:160`), so the count and oldest-flag
   timestamp it surfaces cannot cross a tenant boundary. The item's `title`
   and `detail` carry only a count and an age-in-days phrase — no member
   name, no record id — so nothing PII-bearing reaches the admin-hub
   response. Separately, `_scheduling_hours_this_month` gained a
   `duty_shifts_only()` filter clause (`app/utils/duty_shifts.py`, a shared
   helper: `Shift.is_outreach.is_(False)`) so a community-outreach signup
   sheet's staffed hours are not double-counted against the scheduling
   hours tile — a correctness fix for Pitfall #29 ("don't re-derive what
   another computation already defines"), not a tenant-isolation or
   authorization change; the query's own `Shift.organization_id ==
ctx.organization_id` clause is unchanged.
3. **`RoomQRCodesPage.tsx:542,547`** — two buttons lost a `text-sm`/`py-2.5`
   class each (the shared `btn-secondary`/`btn-primary` utilities already
   set type size and touch-target height; the inline classes were
   redundant leftovers). Pure styling, no data or permission change.

## Route inventory

No route gained, lost, or changed its auth dependency or permission string
since pass 14 — table below reproduced from pass 14 and re-verified field by
field against the current source (`locations.py` read in full this pass;
`display.py`/`admin_hub.py` confirmed byte-identical by diff, so their
pass-14 field values stand).

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

- **Route count and gating unchanged, re-derived by AST** (17/17); `locations.py`
  read in full this pass byte-for-byte against the table above.
- **`check_overlapping_events`'s new `exclude_event_ids` narrows an
  already-org-scoped query** — the `organization_id` filter predates this
  change and is untouched (verified by reading the full function body, not
  just the diff hunk).
- **The new `_double_credit_attention` row is org-scoped at its source**
  (`TrainingCreditDuplicateFlag.organization_id == organization_id` in
  `_open_criteria`) and gated by the same `training.manage` permission every
  other row in `_training_attention` already requires — no new route, no new
  permission string, no new public surface.
- **The new admin-hub row exposes no PII** — only a count and a derived age
  in days, re-confirmed by reading `AdminAttentionItem`'s construction in
  full.
- **LOC-40/LOC-41/LOC8-2 (pass-13 fixes) remain in place** —
  `location_display.py` is still the single display builder for both
  endpoints (byte-identical to pass 14); `uq_locations_org_name_building`
  still backs `building_key` (no migration in this window touches
  `locations`); `_RESTRICTING_LOCATION_REFERENCES` and its six
  `ondelete="RESTRICT"` FKs are unchanged (no diff touches
  `models/location.py`, `models/training.py`, `models/meeting.py`, or
  `models/event_request.py` in this window).
- **The public kiosk/guest surface (`display.py`) is byte-identical to pass
  14** and was re-read in full regardless, given the briefing's emphasis on
  abuse resistance for kiosk-facing endpoints: all six routes carry a
  per-route rate limiter (`_rate_limit_display` 60/min, `_rate_limit_guest_
check_in`/`_rate_limit_guest_lookup` 10/min + 10-min lockout,
  `_rate_limit_badge_tap_ip` 60/min + 5-min lockout, plus a **second**,
  per-room `_rate_limit_badge_tap_room` ceiling that a caller spread across
  IPs cannot evade); `guest_check_in`/`guest_lookup`/`guest_confirm` also
  carry a per-event `daily_cap_exceeded` ceiling, checked _after_ every
  content-based rejection so a flood of refused requests cannot exhaust a
  legitimate event's daily allowance; `guest-lookup` answers an unknown
  email, a department member's own email, and the honeypot field
  identically, so the endpoint cannot be used to enumerate member addresses;
  `guest-confirm`'s token is scoped to the event, room and org it was issued
  for and expires in ten minutes. None of this changed in this window, and
  none of it needed to.
- **No new or changed migration in this window touches this feature's
  tables** — all 23 new migrations create/alter tables for other features
  (CRR, training, apparatus-event seats, history, email types).
- **The frontend change is styling-only** — no new data read, no new prop
  passed to a component that renders it.

## LOC10-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC10-2 | LOW      | 🚩 FLAGGED  | `tests/test_guest_email_first_sign_in.py` is byte-identical to pass 14 (`git diff 8c20bff8c..HEAD` touches nothing in this file) — the `_member()` fixture still bypasses the `EncryptedText`/`EncryptedEnum` bind-param path with a raw `text()` INSERT. Unchanged assessment: a test-fixture-convention decision, not a one-line fix.                                                                                                                                                                                                                                          |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection branch still logs the raw applicant email by f-string — re-read directly at `membership_pipeline_service.py:1918-1922` this pass (same line numbers as pass 14; the file carries no diff in this window). Still unreachable from this feature's own kiosk/guest-lookup path (the kiosk's own `guest_lookup` route, reviewed above, deliberately audits only an outcome and a prospect id, never the email). Still out of scope here — flagged for Membership pipeline / Volunteer recruitment's own next pass. |

## Note on the pass-14 stale app-review finding — now resolved by that track itself

Pass 14 recorded that `docs/app-review/locations-kiosk.md`'s `LOC-41` entry
("(name, building) uniqueness has no constraint behind it") predated this
rotation's `LOC13` fix and was stale. Re-checked this pass: that document's
summary section (line 36-39) now reads correctly — "migration `2bb7c963f351`
adds the stored generated column `building_key` ... and
`uq_locations_org_name_building`" — while its detailed finding entry further
down (line 348) still carries the original 🚩 FLAGGED framing as a historical
record of what was found and fixed. The app-review rotation has evidently
already closed this on its own cadence; no edit needed here.

## Schema & migration notes

- `scripts/validate_migrations.py --strict` — 844 revisions, single head
  `e9cf8ab7e4e4` (an unrelated merge of two other features' chains).
- No migration in `8c20bff8c..HEAD` touches a `locations`/`admin_hub` table
  or column.
- `ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True` — unchanged (no diff touches `models/location.py` or the
  three referencing models).

## Guard tests added

None new this pass — no code behavior changed that a missing guard would
leave unprotected. `check_overlapping_events`'s new parameter only narrows
an existing, already-tested query path; the existing coverage in
`test_location_display_builder.py`, `test_location_name_uniqueness.py`,
`test_location_name_unique_migration.py`,
`test_delete_reference_guards.py::TestTrainingMeetingsAndRequestsKeepTheirLocation`,
and `test_location_restrict_references.py` all re-ran and passed as part of
this pass's scoped suite below.

## Completion gate

| Check                                                                                                          | Result                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                          | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/` (26.5.1)                                                                  | ✅ 3541 files unchanged                          |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                                                              | ✅ clean                                         |
| `python3 scripts/validate_migrations.py --strict`                                                              | ✅ 844 revisions, single head `e9cf8ab7e4e4`     |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                     | ✅ 17/17, unchanged from pass 14                 |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                              | ✅ 344 routes, 0 errors/warnings                 |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display"` | ✅ 779 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                            | ✅ 0 errors                                      |
| `npm run lint`                                                                                                 | ✅ 0 errors/warnings                             |
| `npx vitest run src/pages/RoomQRCodesPage.test.tsx` (the only frontend file touched this pass)                 | ✅ 25 passed                                     |
