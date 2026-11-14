# Security Review — Feature 32: Locations & Kiosk (pass 13)

**Prefix:** `LOC13` · **Iteration:** 32 · **Reviewed:** 2026-11-11 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/services/location_display.py` (new since pass 12), `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `pages/RoomCheckInPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.
**Migrations:** `2bb7c963f351` ("Keep training, meeting and request locations; make location names unique") — the only migration touching this feature's tables since pass 12.

A dedicated rotation session, not a watchdog pickup. PR #4245 (Feature 31,
Scheduled tasks, pass 13) had already merged clean (`17ffe629a`) at the point
this session started. A fresh `list_pull_requests` (state `open`) found
eleven open PRs, none with a `claude/security-review-*` head; row 32 was
confirmed the next pending (`⬜`) row in `docs/security-review/PROGRESS.md`
on a freshly fetched `main`.

---

## Scope

Pass 12's baseline is PR #4016, head `c139cc640eba`, merged 2026-11-04.
`git diff c139cc640eba..HEAD` (850 commits) touched 10 of this feature's
declared files; the rest (`locations.py`'s non-display routes beyond what is
quoted below, `admin_hub.py`, `models/admin_hub.py`, `schemas/location.py`,
`schemas/admin_hub.py`, `guest_check_in_service.py`, `core/error_codes.py`
beyond one unrelated scheduling entry, and all of `LocationKioskPage.tsx`,
`GuestCheckInPage.tsx`, `GuestEmailSignIn.tsx`'s backend-facing logic) are
byte-identical to pass 12 and are not re-derived.

Every route re-enumerated by an AST walk over all three endpoint files'
`@router.<verb>` decorators (script quoted below) rather than trusted from
pass 12's table: **17/17, unchanged** — 8 in `locations.py`, 6 in
`display.py`, 3 in `admin_hub.py`.

```
backend/app/api/v1/endpoints/locations.py: 8 (list, create, get, update,
  delete, regenerate_display_code, set_badge_check_in, get_location_display_info)
backend/app/api/public/display.py: 6 (get_public_location_display,
  kiosk_badge_tap, get_guest_check_in_info, guest_check_in, guest_lookup,
  guest_confirm)
backend/app/api/v1/endpoints/admin_hub.py: 3 (get_admin_hub_summary,
  get_admin_hub_metrics, update_admin_hub_metrics)
```

The real delta is substantial despite the file list being mostly unchanged:
three owner decisions of 2026-11-01 landed between passes 12 and 13
(LOC-40/LOC-41's consolidation and unique-name constraint, and the
nine-kinds-of-records deletion decision), plus a standalone fix to the
guest-lookup member oracle (LOC10-3) and a MS-18-driven rework of
`admin_hub_service.py`'s screening-appointment query. All four are read in
full below, not merely diffed.

## Route inventory

| Method | Path                                                   | Auth dependency           | Permission                                                                                                        | Org-scoped                                                                                 | Notes                                                      |
| ------ | ------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| GET    | `/locations`                                           | `get_current_user`        | none (any member)                                                                                                 | yes — `current_user.organization_id` passed to the service                                 | list, no change                                            |
| POST   | `/locations`                                           | `require_permission`      | `locations.create` OR `locations.manage`                                                                          | yes                                                                                        |                                                            |
| GET    | `/locations/{id}`                                      | `get_current_user`        | none                                                                                                              | yes — `get_location` filters `organization_id`                                             |                                                            |
| PATCH  | `/locations/{id}`                                      | `require_permission`      | `locations.edit` OR `locations.manage`                                                                            | yes                                                                                        |                                                            |
| DELETE | `/locations/{id}`                                      | `require_permission`      | `locations.delete` OR `locations.manage`                                                                          | yes                                                                                        | 409 (`LocationInUseError`) on a race, not 500              |
| POST   | `/locations/{id}/regenerate-display-code`              | `require_permission`      | `locations.edit` OR `locations.manage`                                                                            | yes                                                                                        | audited                                                    |
| PUT    | `/locations/{id}/badge-check-in`                       | `require_permission`      | `locations.manage_nfc_tags`                                                                                       | yes                                                                                        | audited; needs NFC ID Cards integration to turn on         |
| GET    | `/locations/{id}/display`                              | `get_current_user`        | none                                                                                                              | yes                                                                                        | **has a real caller** (see LOC13-1 below)                  |
| GET    | `/public/v1/display/{code}`                            | none (public)             | n/a                                                                                                               | by display code → org, then `is_active`/`Organization.active` gated                        | 60/min/IP rate limit                                       |
| POST   | `/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                                                                                               | by display code; both the room switch and the org integration flag re-checked on every tap | 60/min/IP + 60/min/room rate limits                        |
| GET    | `/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                                                                                               | event resolved through the display-code-owning location                                    | 60/min/IP                                                  |
| POST   | `/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                                                                                               | same                                                                                       | 10/min/IP + 10-min lockout + per-event daily cap, honeypot |
| POST   | `/public/v1/display/{code}/events/{id}/guest-lookup`   | none (public)             | n/a                                                                                                               | same                                                                                       | same, plus the member-oracle fix (LOC13-2)                 |
| POST   | `/public/v1/display/{code}/events/{id}/guest-confirm`  | none (public)             | n/a                                                                                                               | same                                                                                       | same; token-scoped (event+room+org, 10-minute expiry)      |
| GET    | `/admin-hub/{module_key}/summary`                      | `get_current_active_user` | the module's own `.manage` permission, resolved through `MODULE_REGISTRY` and checked by `_require_module_access` | n/a (summary reads the caller's own org via `MetricContext`)                               | unknown/forbidden module both 404                          |
| GET    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                                                                                              | n/a                                                                                        |                                                            |
| PUT    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                                                                                              | n/a                                                                                        | audited                                                    |

No route gained, lost, or changed its auth dependency or permission string
since pass 12.

## Verified good ✅

- **Route count and gating unchanged, re-derived by AST** (17/17, table
  above), not trusted from pass 12.
- **LOC-40 (duplicate display builder) is fixed and re-verified.**
  `app/services/location_display.py` is now the single producer for both
  `GET /locations/{id}/display` and the public kiosk feed; both endpoints
  call `build_location_display(db, location, events, recheck_window=...)`
  with only the `recheck_window` keyword differing, matching the owner
  decision recorded in `docs/KNOWN_LIMITATIONS.md`. Read the new file in
  full — it correctly keeps the one deliberate difference (the public kiosk
  re-evaluates `_validate_check_in_window` against the clock now; the
  authenticated room page trusts the already-strict selection) and nothing
  else.
- **LOC-41 ((org, name, building) uniqueness) is fixed and re-verified.**
  `Location.building_key` is a stored, generated `COALESCE(building, '')`
  column backing `uq_locations_org_name_building`
  (`organization_id, name, building_key`), added by migration
  `2bb7c963f351`. Confirmed the migration handles: existing duplicates
  (renamed, oldest keeps its name, Pitfall #35), a table `create_all` has not
  yet built (`event_requests`, Pitfall #26), and running twice (every step is
  guarded by an `information_schema`/inspector existence check). The service
  layer's `_name_taken`/`_commit_named`/`save_system_named_location` correctly
  treat a lost race on the key as the same friendly 400 the pre-check would
  have given (`_violates_name_constraint` matches the constraint name from
  the driver's `IntegrityError.orig`), rather than surfacing a raw
  `IntegrityError` as a 500.
- **LOC8-2 (hard-delete silently clearing a location from nine kinds of
  record) is fixed and re-verified for the two kinds the owner chose to
  protect.** Training records, course classes, cohorts, cohort classes,
  meetings and event requests all changed from `ON DELETE SET NULL` to
  `ON DELETE RESTRICT` (same migration), and their six columns joined
  `LocationService._RESTRICTING_LOCATION_REFERENCES`
  (`location_service.py:50-60`) so `remove_location` deactivates rather than
  hard-deletes a location any of them reference. Re-derived the model-level
  FK directly from each model file (`training.py` ×4, `meeting.py`,
  `event_request.py`) rather than trusting the migration docstring — every
  one reads `ondelete="RESTRICT"`, matching the migration. Inventory items,
  storage areas and NFC tap logs were deliberately left on `SET NULL`,
  matching the owner's split decision.
- **LOC10-3 (guest-lookup member oracle) is substantially narrowed, by an
  already-merged, independent commit (`184b28bc5`, 2026-11-08), re-verified
  directly against the current code rather than trusted from the commit
  message.** `guest_lookup` no longer distinguishes a department member's
  address from an unknown one — both now answer `LOOKUP_NOT_FOUND` with the
  same message (`display.py:628-634`). `GuestLookupResponse.status` dropped
  `'member'` from its documented union (`schemas/event.py:1012`), and the
  frontend's `GuestLookupResult` type was narrowed to match
  (`types/event.ts:613-620` — confirmed no `'member'` literal remains
  anywhere in `GuestEmailSignIn.tsx` or its test). The service's internal
  `LOOKUP_MEMBER` classification still exists and is still used in two
  places that are not reachable from this public endpoint: the audit log
  (`event_type="event_guest_lookup"`, so the true outcome is still
  traceable after the fact) and `link_or_open_prospect`'s staff-entered
  walk-in path (`guest_check_in_service.py:723`, which must keep telling a
  member apart from an applicant to avoid opening a duplicate pipeline
  record for a member staff typed in by hand) — both legitimate, in-code-only
  consumers. The residual oracle this leaves (an active applicant vs.
  everyone else) is the one pass 10 already assessed as a deliberate,
  rate-limited, audited tradeoff; closing the member half removes the part
  of it that was not intentional.
- **The MS-18 (medical screening PHI encryption) follow-on in
  `admin_hub_service.py` is correctly scoped and does not reintroduce a
  cross-tenant or N+1 problem.** `screening_type` and `status` on
  `ScreeningRecord` became ciphertext columns that "refuse a SQL comparison
  outright" (per that model's own comment), so the hub's missed-appointment
  count could no longer filter by status in SQL. The replacement
  (`_missed_screening_appointments`, `admin_hub_service.py:349-380`) loads
  candidate rows with `ScreeningRecord.organization_id == ctx.organization_id`
  **and** `User.organization_id == ctx.organization_id` (both sides of the
  join org-filtered, not just one), then does the status/date comparison in
  Python — matching the pattern the model's own comment prescribes. The
  query is bounded to one organization's current members' screening records,
  not table-wide. No other `ScreeningRecord.status`/`.screening_type` SQL
  comparison remains in this file (checked by grep across the whole file).
  The attention item this feeds is still gated on `medical_screening.view`
  via `spec.attention_permission` before `_members_attention` is even
  called (`admin_hub_service.py:2475-2478`, unchanged since pass 12), and the
  attention text itself still carries only an aggregate count.
- **`ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True`** on the three untouched ones (`inventory_items`,
  `storage_areas`, `nfc_card_taps`) — unchanged, re-derived from
  `Base.metadata` rather than trusted.
- **No new or changed migration adds an unbounded scan, an unescaped
  `LIKE`, or a raw `csv.writer`** — `2bb7c963f351` is the only migration in
  scope and uses parameterized `sa.text()` throughout; confirmed by reading
  it in full (above).
- **The `LocationsPage.tsx` forms-review rework (F-2: field-level 422
  display, `useDiscardGuard` on both dialogs, `formCoercions` for
  create/update blank-value semantics) introduces no new data exposure.**
  Confirmed `formCoercions` — not a hand-rolled `??`/`||` — is what converts
  blank optional fields on both the station and room forms, and that
  `useDiscardGuard` (not a bare `onKeyDown`/`closeOnClickOutside`) is what
  Escape and the close button now route through, matching Pitfall #31's
  rule against a silent-discard dialog dismiss. No field here is
  PII/PHI-bearing beyond what the existing `LocationResponse`/`LocationCreate`
  schemas already carry (address, city, state, zip — a department's own
  station, not a member's).
- **`AdminHubFrame.tsx`'s header/breadcrumb extraction into
  `AdminPageHeader` is presentational only** — diffed in full; no permission
  or data-fetching logic moved, same props in, same markup out (confirmed by
  the component test still passing unchanged, see Completion gate).

## Findings

### LOC13-1 — LOW — `LOC-3`'s "zero callers" claim has been stale since pass 5, and passes 8/9/10/11/12 kept re-asserting it — correction, not a new defect

**What:** every security-review pass from LOC8 through LOC12 (five passes,
2026-10-21 through 2026-11-04) carried forward a line reading `GET
/locations/{id}/display` "still has zero frontend callers, still hardcodes
`is_valid`/omits `timezone`" and marked it 🚩 FLAGGED. This was accurate when
first written (pass 2/3, 2026-08-08) but **pass 5 (`LOC5-32-locations-kiosk.md`,
2026-10-0x) already recorded that the endpoint gained a caller** —
`RoomCheckInPage.tsx`'s `getCurrentCheckIns`, reached when a member taps a
room's own NFC tag — and fixed the three gaps the finding named (closing
them under LOC5-32-1). Confirmed directly: `frontend/src/services/facilitiesServices.ts:1207-1219`
(`locationsService.getCurrentCheckIns`) calls `GET /locations/${locationId}/display`
and is the only caller `RoomCheckInPage.tsx` uses; `git log --diff-filter=A`
on `RoomCheckInPage.tsx` traces its earliest ancestor to commit `53830a269`
("Add room NFC tags that check a member into the room's current event"),
well before pass 8's first repetition of the stale claim.

**Where:** `docs/security-review/LOC8-32-locations-kiosk.md` through
`LOC12-32-locations-kiosk.md`'s repeated "LOC-3 ... zero frontend callers"
table rows; the original, correct closure is
`docs/security-review/LOC5-32-locations-kiosk.md` (LOC5-32-1) and the
corresponding `docs/KNOWN_LIMITATIONS.md` edit it made at the time (since
superseded by LOC-40's full consolidation, which also closes the remaining
field-parity gap LOC5-32-1 didn't reach — see "Verified good" above).

**Impact:** none to the running system — this is a documentation-accuracy
defect in the review trail itself (the exact shape CLAUDE.md Pitfall #37
and the scheduled-tasks pass 13 CRON-31-7 correction both warn about: a
claim repeated across several passes without being re-read against the
code). It is worth recording because a reader skimming LOC8–LOC12 for
"what is still open" would conclude this endpoint is dead code wired to
nothing, when it has been a live, authenticated check-in landing path for
members tapping room NFC tags for over a month.

**Fix:** none needed in code — LOC-40 (this pass, re-verified above)
independently closes every substantive gap the original LOC-3/LOC5-32-1
finding named (the builder is now shared, so `is_valid`/`timezone`/
`allow_guest_check_in`/`badge_check_in_enabled` are computed identically on
both endpoints). This entry exists so the next pass does not re-open LOC-3
a sixth time. Not mirrored to `docs/KNOWN_LIMITATIONS.md` — it never had an
entry there, and there is nothing open for an operator to decide.

### LOC13-2 — INFO — The guest-lookup docstring still described the removed `'member'` outcome — ✅ FIXED

**What:** `guest_lookup`'s own docstring (`display.py:559-567`) still read "a
department member is pointed at the member QR code", which was true before
`184b28bc5` and is no longer: the inline comment three lines above the
`return` it describes (`display.py:628-631`) correctly explains the new
behavior, but the docstring above the function itself was not updated in
that commit.

**Where:** `backend/app/api/public/display.py:559-567`.

**Failure scenario:** none — this is a stale comment, not a code defect. Recorded
because an outdated docstring on a public, security-relevant endpoint is
exactly the kind of drift that caused LOC13-1's five-pass repetition: a
reader trusts the comment over the three-line gap down to the code it
describes.

**Impact:** documentation-accuracy only.

**Fix:** docstring rewritten to state the current behavior and point at the
comment that explains why (`display.py:559-566`, this pass).

## LOC10-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC10-2 | LOW      | 🚩 FLAGGED  | `tests/test_guest_email_first_sign_in.py`'s `_member()` fixture still bypasses the `EncryptedText`/`EncryptedEnum` bind-param path with a raw `text()` INSERT, so it only ever exercises the `email_hash` branch of the lookup, never a real ciphertext comparison. Closing it is a test-fixture-convention decision (rewrite the fixture through the ORM, or add a narrow standalone unit test), not a one-line fix — unchanged from pass 10's assessment. File unchanged since pass 10 (confirmed: `git diff c139cc640eba..HEAD -- backend/tests/test_guest_email_first_sign_in.py` touches only unrelated lines added after this helper). |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection branch still logs the raw applicant email by f-string (`membership_pipeline_service.py:1918`, line number shifted from pass 10's 1813 by unrelated insertions in the same file, text unchanged). Still unreachable from this feature's own kiosk/guest-lookup path (`find_active_prospect_by_email` is a different code path); still out of scope — flagged for Membership pipeline / Volunteer recruitment's own next pass.                                                                                                                                               |

Neither file's relevant lines changed in this window, so neither is
re-derived beyond confirming the text is unchanged (grep above).

## Schema & migration notes

- `scripts/validate_migrations.py --strict` — 757 revisions, single head
  `09f0171ccf5e` (unrelated to this feature — an Events postponement
  migration from the same window).
- `2bb7c963f351` is the only migration in `c139cc640eba..HEAD` touching a
  table or column this feature declares. Read in full under "Verified good"
  above; it is idempotent, Pitfall #26/#35-aware, and its downgrade is
  documented as not reversing the duplicate-renaming (correctly recorded in
  `docs/UPGRADING.md`'s scope per the migration's own docstring).
- `ondelete="SET NULL"` vs `nullable=True` (Pitfall #2): every `SET NULL`
  reference to `locations.id` remains nullable (3 columns: `inventory_items`,
  `storage_areas`, `nfc_card_taps`); every `RESTRICT` reference is nullable
  too (RESTRICT does not require non-null — these columns are optional
  references that simply cannot be nulled by a location delete once set).

## Guard tests added

None new this pass. The three owner-decision fixes (LOC-40, LOC-41, LOC8-2)
each already shipped with their own guard tests before this pass started
(`tests/test_location_display_builder.py`, `tests/test_location_name_uniqueness.py`,
`tests/test_location_name_unique_migration.py`,
`tests/test_delete_reference_guards.py::TestTrainingMeetingsAndRequestsKeepTheirLocation`,
`tests/test_location_restrict_references.py`) and the member-oracle fix with
its own (the two rewritten assertions in
`tests/test_guest_email_first_sign_in.py` plus the removed frontend test),
all re-run and passing as part of this pass's scoped suite below. LOC13-1 and
LOC13-2 are documentation corrections with no code behavior to guard.

## Completion gate

| Check                                                                                                          | Result                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.4.1)                                                                          | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/`                                                                           | ✅ 3116 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`                                                                      | ✅ clean                                         |
| `python3 scripts/validate_migrations.py --strict`                                                              | ✅ 757 revisions, single head `09f0171ccf5e`     |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                     | ✅ 17/17, unchanged from pass 12                 |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                              | ✅ 305 routes, 0 errors/warnings                 |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display"` | ✅ 769 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck`                                                                                            | ✅ 0 errors                                      |
| `npm run lint`                                                                                                 | ✅ 0 errors/warnings                             |
| Relevant vitest (`LocationsPage`, `AdminHubFrame`, `RoomCheckInPage`, `RoomQRCodesPage`)                       | ✅ 73 passed (4 files)                           |
