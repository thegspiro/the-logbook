# Security Review — Feature 32: Locations & Kiosk (pass 6)

**Prefix:** `LOC6` · **Iteration:** 32 · **Reviewed:** 2026-10-11 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes, byte-identical
route surface — same 8 as pass 5), `app/services/location_service.py`
(type-annotation modernization + two correctness/perf fixes, see below),
`app/api/public/display.py` (4 routes, byte-identical), `app/api/v1/endpoints/
admin_hub.py` (3 routes, byte-identical), `app/services/admin_hub_service.py`
(+4 new attention-queue items, see below), `app/schemas/admin_hub.py`
(byte-identical), `app/schemas/location.py` (byte-identical),
`app/models/admin_hub.py` / `app/models/location.py` (SQLAlchemy 2.0
`Mapped[]` typed-column modernization only, no column/behavior change).
Also read: `app/services/guest_check_in_service.py` (type-annotation-only
diff), `app/services/nfc_tag_service.py` (display-name + null-guard fixes,
see below), `app/utils/org_locks.py` (new `ROOM_BOOKING` lock, reviewed as
cross-reference — see below).
**Frontend:** `pages/LocationsPage.tsx` (touch-target/layout rework),
`pages/RoomQRCodesPage.tsx` (touch-target/layout rework),
`pages/LocationKioskPage.tsx` (+stale-display fix, see "Verified good"),
`components/admin/AdminHubFrame.tsx` (+described-card tab bar, consumes the
same gated summary it always has).
**Migrations:** none touching this feature's tables (54 new migrations
landed since pass 5, all for other features — `locations`, `admin_hub_*`,
and `nfc_tags` do not appear in any of their diffs).

---

## Watchdog context

Picked up from outside the dedicated `/loop 30m /security-review` session:
no `claude/security-review-*` branch or PR existed anywhere in the repo, and
the last rotation merge (PR #3005, Feature 31, Scheduled tasks, pass 6) had
landed **2026-10-08 15:16 UTC** — roughly 70 hours before this pass started,
far past the rotation's own documented ~90-minute stall threshold. Feature
32 (Locations & kiosk) is the next `⬜` row in `PROGRESS.md`, already five
passes deep (LOC-32 through LOC5-32), so this continues that sequence as
pass 6 rather than starting fresh.

## Delta method

Pass 5's baseline is commit `a5e83d9c` (merged 2026-10-04). `git diff --stat
a5e83d9c origin/main` scoped to every file pass 5 listed found a real,
non-trivial diff — 11 files, 586 insertions / 177 deletions — so this is a
genuine re-review, not a zero-diff rubber stamp:

- **SQLAlchemy 2.0 typed-column modernization.** `models/admin_hub.py` and
  `models/location.py` convert every `Column(...)` to `Mapped[...] =
mapped_column(...)`, and two service methods (`get_location_by_display_
code`, `_resolve_tag` in `nfc_tag_service.py`, the external-attendee lookup
  in `guest_check_in_service.py`) gain an explicit `Optional[...]` return
  annotation on an already-existing `scalar_one_or_none()` call. No column,
  type, nullability, or query changed — confirmed by reading every
  `mapped_column(...)` call against its prior `Column(...)` call site
  side-by-side; only the declarative style changed.
- **Two already-reviewed-elsewhere fixes landed in `location_service.py`,
  cross-referenced rather than re-derived:**
  - `check_overlapping_events` now takes the organization's `ROOM_BOOKING`
    lock and makes its own read a `.with_for_update()` locking read before a
    caller books a room — this is **EV-26** (Pitfall #27 shape: lock the
    parent, then make the count itself a locking read), tracked and fixed
    under Feature 16 (Events & requests) pass 7, confirmed in
    `docs/security-review/EV-16-events-requests.md` and
    `docs/KNOWN_LIMITATIONS.md`'s EV-26 entry. `tests/test_room_booking_
race.py` and `tests/test_capacity_locking.py` already cover it; re-run
    clean below. Nothing new to review here — `LocationService` is simply
    where the shared method this fix touches happens to live.
  - `check_overlapping_events`'s duplicate-name guard query in
    `create_location`/`update_location` gains `.limit(1)`. Unbounded, two
    concurrent creates of the same name/building could both pass the
    "no existing row" check (a true read-then-write race distinct from
    EV-26's locked one — this path is a 400-returning validation, not a
    booking decision) and leave a duplicate pair; the _next_ read of that
    name then raised `MultipleResultsFound` from `scalar_one_or_none()`,
    rendered as a generic 500 by `handle_service_errors` rather than the
    400 the feature intends. Capped at one row, the race still allows the
    duplicate pair (no lock added — correctly, since a duplicate display
    name is a usability annoyance, not a security or data-integrity
    problem) but removes the crash-on-next-read. A correctness hardening,
    not a new finding — confirmed by reading `handle_service_errors` and
    the 434-line route file's own error mapping.
- **`location_service.py`'s `get_current_events_in_check_in_window`** drops
  an unused `selectinload(Event.rsvps)` — the two callers (both display
  endpoints) project scalar columns only and nothing in this feature reads
  the RSVP collection. A performance fix on a **public, unauthenticated,
  30-second-poll** endpoint (an org-wide event with many RSVPs was eager-
  loading every RSVP row on every poll); reviewed because an abuse-
  resistance dimension (checklist §6, "list endpoints are bounded") is
  exactly what this is — removing dead eager-loading narrows the public
  kiosk's per-request cost, which is a hardening in the right direction, not
  a new exposure (it reads strictly less than before).
- **`admin_hub_service.py` gains four new attention-queue items** (skills
  tests awaiting validation, shift reports awaiting review/flagged, pending
  event-attendance-decision requests, storefront order windows open past
  their close time) and the training-compliance metric switches from a
  percentage-plus-reconstructed-count to a tally object
  (`compute_org_compliance_tally`) that reports graded/compliant counts
  directly rather than back-deriving them from the whole roster — the
  Pitfall #29 "empty set is not a passing set" shape, already the subject of
  pass 5's note on this same file. All four new items and the tally
  reviewed fresh — see "Verified good".
- **`nfc_tag_service.py`:** two small, unrelated fixes — a batch name lookup
  now reads `preferred_name` through the shared `format_display_name`
  helper (display-name correctness, not security: the kiosk already
  data-minimizes to first-name-plus-initial regardless of which name is
  used as the source), and a `clock_in_at = active["clock_in_at"] if active
and in_this_category else None` null-guard that prevents a `TypeError` on
  a falsy `active` rather than a silent wrong value — a crash-prevention
  fix, confirmed by reading the surrounding `_resolve_direction` call, which
  already handles `None` correctly.
- **`AdminHubFrame.tsx`** adds an optional described-card tab layout
  (`AdminHubCardTabs`) and an `onSummaryChange` callback so a hub can badge
  its own navigation from the same summary fetch. Both consume exactly the
  summary the existing, permission-gated `GET /admin-hub/{module_key}/
summary` endpoint already returns — no new request, no new trust boundary.
- **`LocationKioskPage.tsx`** clears stale `data` on a 404 refresh rather
  than leaving the last-fetched payload rendered behind a "connected" icon.
  This is a genuine data-staleness fix with a security angle (a display
  code an officer rotates to revoke a leak, per the kiosk's own threat
  model, previously kept showing the pre-revocation payload indefinitely on
  a kiosk nobody was actively reloading) — already fixed in this delta, not
  a finding to raise here.
- **Everything else** in pass 5's surface (`locations.py` apart from the
  one new `Organization.timezone` field on `GET /{id}/display`,
  `location_service.py` apart from the above, `display.py`, `admin_hub.py`,
  `schemas/*`, `nfc_integration.py`) is byte-identical to what pass 5 signed
  off, confirmed by `git diff --stat` showing no further hunks in those
  files beyond what is described above.

## Route inventory

Re-enumerated directly from current source. **15 routes, unchanged from
pass 5** (8 `locations.py` + 4 `display.py` + 3 `admin_hub.py`) — no route
added, removed, or regated since pass 5's table, which is reproduced here
unchanged because nothing in it is stale:

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                         | Notes                                                                                           |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                                | `display_code` only if `can_view_kiosk_display_codes`                                           |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                                | duplicate-name race now capped at one row instead of crashing (see Delta method)                |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                                |                                                                                                 |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                | same duplicate-name hardening as POST                                                           |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                                |                                                                                                 |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                | audit-logged                                                                                    |
| PUT    | `/locations/{id}/badge-check-in`                           | `get_current_user`        | `locations.manage_nfc_tags`           | yes                                                | unchanged since pass 5                                                                          |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                                | +`timezone` field, server-derived from `Organization.timezone`, no client input                 |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` + `Organization.active`         | rate-limited 60/min/IP; byte-identical to pass 5                                                |
| POST   | `/api/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                   | resolved server-side via display_code→location→org | byte-identical to pass 5                                                                        |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org              | byte-identical to pass 5                                                                        |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org              | byte-identical to pass 5                                                                        |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                                | now also returns the 4 new attention items, each independently org-scoped — see "Verified good" |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                |                                                                                                 |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                | audit-logged                                                                                    |

## Verified good ✅

- **All prior-pass findings re-verified intact by reading the current code
  directly.** LOC5-32-1's fix is unregressed: `get_location_display_info`
  still returns `event_description=None` unconditionally
  (`locations.py:408`), matching the public sibling's own `event_description
=None  # Don't expose description publicly` (`display.py:262`) — both
  grepped directly rather than assumed from the byte-diff. `get_location_by_
display_code` still joins `Organization` and filters `Location.is_active.
is_(True)` **and** `Organization.active.is_(True)` (`location_service.py:
418-419`).
- **Every new attention-queue item added to `admin_hub_service.py` filters
  `organization_id`, with no client-supplied id anywhere on the path.**
  `_skill_test_attention` uses `pending_validation_criteria(ctx.organization_
id)` (itself `SkillTest.organization_id == organization_id`, confirmed at
  `skills_testing_service.py:693-707`); `_shift_report_attention` filters
  `ShiftCompletionReport.organization_id == ctx.organization_id` directly
  and checks `TrainingModuleConfig.organization_id == ctx.organization_id`
  for the shift-reports-enabled switch, with the correct Pitfall #19
  "no row = current behaviour (on)" default; the attendance-petition count
  filters `pending_petition_criteria(ctx.organization_id, str(ctx.user.id))`
  (confirmed `EventAttendancePetition.organization_id == organization_id` at
  `event_attendance_petition_service.py:79-90`) **and** joins to `Event` with
  its own `Event.organization_id == ctx.organization_id` — belt-and-
  suspenders, not a gap; the storefront overdue-window count filters
  `StoreOrderWindow.organization_id == ctx.organization_id`. `ctx.organization_
id` itself is server-derived from the authenticated caller, never from a
  request parameter — confirmed at the `MetricContext` construction site in
  `admin_hub_service.py`, unchanged since pass 1.
- **Every new attention item is a single bounded aggregate query, not an
  N+1 or an unbounded list.** All four route through the existing
  `_count_and_oldest(db, model, *criteria, date_column)` helper
  (`admin_hub_service.py:263-270`), which issues exactly one
  `select(func.count(...), func.min(...))` per item — read directly, not
  assumed from its name.
- **The new attention items carry no PII beyond what their own linked
  screen already shows to the same permission holder.** Each `AdminAttention
Item` is `title`/`detail`/`count`/`oldest_age_days`/`href` — no member name,
  no record id, no free-text field from the underlying row — and the whole
  response is already gated behind the summary endpoint's own
  `require_permission(spec.permission)`, unchanged since pass 1.
- **The room-booking locking change (`check_overlapping_events`'s
  `ROOM_BOOKING` lock + `.with_for_update()`) is EV-26, already reviewed,
  fixed, and tested under Feature 16** — re-confirmed rather than
  re-derived: `docs/security-review/EV-16-events-requests.md` records it
  "confirmed fixed" at pass 7 (commit `5b0929492`), `docs/KNOWN_LIMITATIONS.
md` carries the EV-26 entry describing the per-department (not
  cross-department) serialization boundary, and `tests/test_room_booking_
race.py` + the `check_overlapping_events` source check in
  `tests/test_capacity_locking.py` both re-run clean below. Nothing in this
  feature's own files calls `check_overlapping_events` with `for_booking=
False` in a way that would bypass the lock — the three production callers
  (`event_requests.py:1131`, `event_service.py:394,995`,
  `training_session_service.py:486`, `course_cohort_service.py:331`) all
  take the method's `for_booking=True` default.
- **The new `Organization.timezone` field on the authenticated `GET
/locations/{id}/display`** is server-derived from `location.organization_
id` (`locations.py:437-442`), never from client input, and carries nothing
  more sensitive than the department's configured IANA zone name — already
  sent unauthenticated by the public kiosk sibling endpoint, so this is not
  a new exposure for an authenticated, already-org-scoped caller.
- **The duplicate-name-guard race's remaining behavior (allowing a
  duplicate pair under true concurrency, just not crashing on the next
  read) is a deliberate, correctly-scoped choice, not a missed lock.** A
  duplicate room/building name is a data-quality nuisance an admin can
  rename away; it is not a capacity cap, a payment decision, or a tenant
  boundary, so Pitfall #27's locking pattern is not the applicable fix here
  — `.limit(1)` removing the crash is the right-sized remediation.
- **No regression in the kiosk's existing data-minimization or rate-
  limiting.** Both re-read directly: `_kiosk_result` still strips to
  `status`/`message`/`target_name`/`member_display_name` (first name +
  initial only)/`occurred_at`/`duration_minutes`; `_rate_limit_badge_tap_ip`
  and `_rate_limit_badge_tap_room` are unchanged since pass 5.

## Findings

None. This pass found no new security-relevant defect and no regression in
any prior-pass fix. The real delta — four admin-hub attention items, a
duplicate-name crash fix, dead-eager-load removal, display-name/type-
annotation modernization, and a kiosk staleness fix — was all either
correctness/UX work with no access-control or tenancy implication, or (for
the room-booking lock) a change already reviewed, fixed, and tested under a
different feature (EV-26, Feature 16).

## Schema & migration notes

No migration touches this feature's tables since pass 5. `models/admin_hub.
py` and `models/location.py` changed from `Column(...)` to `Mapped[...] =
mapped_column(...)` — a SQLAlchemy 2.0 declarative-style change with no
effect on the generated schema, nullability, or `ondelete` behavior; every
`mapped_column` call carries the exact same arguments (type, `nullable`,
`server_default`, `ForeignKey(..., ondelete=...)`) its prior `Column` call
had, confirmed by reading both sides of the diff. `scripts/validate_
migrations.py --strict`: 563 revisions, single head (`4b7e1f0c9a2d`).

## Guard tests added

None by this pass — nothing needed a fix. The pre-existing suite
(`tests/test_room_booking_race.py`, `tests/test_capacity_locking.py`,
`tests/test_kiosk_badge_tap.py`, `tests/test_location_display_endpoint.py`)
already covers every invariant this pass re-verified; re-run clean below.

## Completion gate

| Check                                                                                                                                                                                                                      | Result                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                              | ✅ 0 violations                      |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                       | ✅ clean, 2130 files unchanged       |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                  | ✅ clean                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                          | ✅ 563 revisions, single head        |
| Scoped tests (`-k "location or kiosk or admin_hub or guest_check_in or public_display or badge or room_booking"`)                                                                                                          | ✅ 645 passed, 1 skipped (pywebpush) |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage`, `test_require_permission_registry`, `test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`, `test_room_booking_race`) | ✅ 86 passed                         |
| `npm run typecheck` (aliased `tsc-native`)                                                                                                                                                                                 | ✅ 0 errors                          |
| `npm run lint`                                                                                                                                                                                                             | ✅ 0 errors, 0 warnings              |
