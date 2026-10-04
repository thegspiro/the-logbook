# Security Review — Feature 32: Locations & Kiosk (pass 5)

**Prefix:** `LOC5` · **Iteration:** 32 · **Reviewed:** 2026-10-04 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (434 L, 8 routes — +1 since
pass 4), `app/services/location_service.py` (394 L), `app/api/public/display.py`
(550 L, 4 routes — +1 since pass 4), `app/api/v1/endpoints/admin_hub.py`
(112 L, 3 routes, byte-identical), `app/services/admin_hub_service.py`
(2,616 L — "empty set is not a passing set" fixes + a shared timezone
helper, see below), `app/services/guest_check_in_service.py` (439 L —
pipeline-advance timing moved to event finalize, see below),
`app/schemas/admin_hub.py` (byte-identical), `app/schemas/location.py`
(+badge-check-in fields/schema), `app/models/admin_hub.py`
(byte-identical), `app/models/location.py` (+`nfc_badge_check_in_enabled`
column). Read for the new public surface this pass reaches into:
`app/services/nfc_tag_service.py` (889 L — the kiosk tap handler is new;
the rest is Feature 13's own territory, read because it is now reachable
from this feature's public endpoint), `app/schemas/nfc_tag.py` (+kiosk
request/response schemas), `app/utils/nfc_integration.py` (58 L,
byte-identical — the fail-closed integration gate both new endpoints call).
**Frontend:** `pages/LocationKioskPage.tsx` (+badge reader), `pages/
RoomCheckInPage.tsx` (new — the authenticated display endpoint's new
caller), `pages/RoomQRCodesPage.tsx` (+badge switch, room NFC tags),
`pages/LocationsPage.tsx` (permission-gated controls), `components/admin/
AdminHubFrame.tsx` (mobile layout only), `components/nfc/KioskBadgeReader.tsx`
(new), `constants/nfc.ts` (+room check-in tag target).
**Migrations:** two since pass 4, both for this feature:
`20261002_2303_5bed4c485d2f_grant_nfc_tag_writers.py` (seeds
`locations.manage_nfc_tags` / `apparatus.manage_nfc_tags` onto existing
installs' stored positions) and
`20261003_0142_040ae44ad286_add_location_nfc_badge_check_in.py` (adds
`locations.nfc_badge_check_in_enabled`, default off).

---

## Delta method

Pass 4's baseline is commit `f9c67bdf6` (PR #2527, 2026-09-13, merged).
`git diff --stat f9c67bdf6 origin/main` scoped to every file pass 4 listed,
plus the files this pass's own diff pulled in, found real changes — **not**
a zero-diff pass:

- **A new feature landed:** member ID card ("badge") check-in at a room's
  public kiosk, on the 2026-10-02/03 commits. A room can opt in
  (`nfc_badge_check_in_enabled`, off by default) to accept unauthenticated
  card taps at `POST /api/public/v1/display/{code}/badge-tap`, resolving the
  room's own open event and checking the tapper in or out through the same
  `NfcTagService.check_in` a staffed station uses. Gated on both the room's
  own switch and the department's NFC ID Cards integration
  (`nfc_id_cards_enabled`, fail-closed), checked on every tap rather than
  cached from page load.
- **The dead endpoint is dead no longer.** `GET /locations/{id}/display`
  (flagged since 2026-08-08 as LOC-3, zero callers across four prior passes)
  now has a real caller: `RoomCheckInPage.tsx`, where a member's phone lands
  after tapping a room's own NFC tag (distinct from the room's kiosk
  display-code tag — see below). See finding LOC5-32-1.
- **A room's physical NFC tag now carries a different URL than its kiosk.**
  `buildRoomCheckInUrl` writes `/locations/{id}/check-in` (an authenticated,
  id-keyed, non-secret URL) rather than the kiosk's display-code URL —
  deliberately, per the comment in `constants/nfc.ts`: a room's tag is
  readable by anyone who walks past, so it must not carry the bearer
  credential that protects the kiosk's QR code.
- **`guest_check_in_service.py`:** the applicant-pipeline auto-advance moved
  from the moment of guest check-in to the moment the event's attendance is
  finalized (`advance_prospects_for_settled_event`, called from
  `EventService._advance_prospects_after_finalize`), plus a nightly
  `prospect_attendance_advance` scheduled task (already reviewed in
  `docs/security-review/CRON5-31-scheduled-tasks.md`, Feature 31 pass 5) for
  events nobody finalizes. Business-logic correctness (an applicant no
  longer advances off a door record the department has not stood behind),
  not a security change; read in full, org-scoped via `event.organization_id`
  on both sides, best-effort and exception-swallowing so a pipeline failure
  never costs a finalize.
- **`admin_hub_service.py`:** two "empty set reads as a passing set" fixes
  (Pitfall #29 corollary — a department with zero training requirements or
  zero shifts no longer reads "100% compliant" / "every shift closed out"),
  and the hub's own ad-hoc timezone resolution was replaced with the shared
  `scheduling_timezone()` helper so the hub counts the same local day the
  rest of the app does. Correctness fixes, already landed; re-verified
  rather than re-derived.
- **Permission grants:** `locations.manage_nfc_tags` (room tags, badge
  check-in toggle) and `apparatus.manage_nfc_tags` (apparatus tags) are new,
  seeded onto leadership + the relevant officer position by migration
  `5bed4c485d2f` with the additions-only, evidence-gated shape Pitfall #23
  requires — reviewed in full, see "Verified good".

Everything else in pass 4's surface (`location_service.py` apart from the
new `set_badge_check_in` method, `schemas/location.py` apart from the new
fields, `models/location.py` apart from the new column, `admin_hub.py`,
`schemas/admin_hub.py`, `models/admin_hub.py`) is byte-identical to what
pass 4 signed off.

## Route inventory

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                         | Notes                                                                                                                                                              |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                                | `display_code` only if `can_view_kiosk_display_codes`                                                                                                              |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                                |                                                                                                                                                                    |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                                |                                                                                                                                                                    |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                |                                                                                                                                                                    |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                                |                                                                                                                                                                    |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                | audit-logged                                                                                                                                                       |
| PUT    | `/locations/{id}/badge-check-in`                           | `get_current_user`        | `locations.manage_nfc_tags`           | yes (via `set_badge_check_in` → `get_location`)    | **new**; enabling requires `nfc_id_cards_enabled`, disabling always allowed; audit-logged (`warning`/`info`)                                                       |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                                | **no longer dead code** — see LOC5-32-1                                                                                                                            |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` + `Organization.active`         | rate-limited 60/min/IP; now also reports `badge_check_in_enabled`                                                                                                  |
| POST   | `/api/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                   | resolved server-side via display_code→location→org | **new**; rate-limited 60/min/IP + 60/min/room (both 5-min lockout); refuses unless both the room switch and the org integration are on, checked fresh on every tap |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org              | rate-limited 60/min/IP                                                                                                                                             |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org              | rate-limited 10/min/IP + 300/day/event, reserved after every rejection gate                                                                                        |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                                |                                                                                                                                                                    |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                |                                                                                                                                                                    |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                | audit-logged                                                                                                                                                       |

15 routes (13 at pass 4, +2 new: badge-check-in toggle, badge-tap). Every
route re-enumerated directly from the current source, not copied from
pass 4's table.

## Verified good ✅

- **All prior-pass findings re-verified intact, by reading the current code
  directly** rather than assumed from the byte-diff: `get_location_by_
display_code` still joins `Organization` and filters `Organization.active
== True` (`location_service.py:363-370` area); the guest-check-in link
  race is still scoped to a `begin_nested()` SAVEPOINT with the
  `.with_for_update()` recheck; `update_location`'s duplicate check still
  reads `model_fields_set`; the guest-check-in daily cap is still reserved
  after every rejection gate; `LocationUpdate` still rejects an explicit
  `null` for `name`/`is_active`.
- **The new kiosk badge-tap endpoint is org-scoped end to end with no
  client-supplied organization id anywhere on the path.** `kiosk_badge_tap`
  resolves `location` from the `display_code` alone (already filtered to
  an active organization), then calls `NfcTagService.kiosk_check_in` with
  `organization_id=str(location.organization_id)` — server-derived, never
  from the request. `resolve_tag` then filters `NfcTag.organization_id ==
organization_id` and `User.organization_id == organization_id` before
  trusting either (`nfc_tag_service.py:296-318`), and `_check_in_event`
  independently re-filters `Event.organization_id` on top
  (`nfc_tag_service.py:581-588`). A card issued in one department cannot
  resolve at another's kiosk even if both happen to read the same physical
  UID, because the lookup is always scoped to the tapping kiosk's own org.
- **The response is data-minimized on purpose, not by omission.**
  `KioskBadgeTapResponse` / `_kiosk_result` strip every result down to
  `status`, `message`, `target_name`, `member_display_name` (first name +
  last initial only — `_kiosk_result`, `nfc_tag_service.py:493-511`),
  `occurred_at`, `duration_minutes`. No member id, full name, or membership
  number ever reaches the public response; `user_id`/`event_id` are carried
  internally only for the audit entry and are not part of the Pydantic
  response model. `TestResponseSchema.test_the_public_response_has_no_
identifying_fields` and `TestKioskCheckIn.test_the_result_names_the_
member_by_first_name_and_initial` (`tests/test_kiosk_badge_tap.py`) assert
  this directly.
- **The overlap-resolution path cannot be used to enumerate a stranger's
  attendance.** When two events are open in one room, `_only_event_checked_
into` resolves the tapped card to a member first and refuses (same
  generic message) for an unknown/inactive card _before_ it ever looks at
  which event that card might be checked into — `tests/test_kiosk_badge_
tap.py::TestOnlyEventCheckedInto::test_an_unknown_card_says_nothing_
about_attendance` asserts this.
- **Both gates — the room's own switch and the org's NFC ID Cards
  integration — are re-checked on every tap, not cached from page load.**
  `kiosk_badge_tap` re-reads `location.nfc_badge_check_in_enabled` and calls
  `nfc_id_cards_enabled(db, ...)` fresh on each request
  (`display.py:339-347`); `nfc_id_cards_enabled` itself fails closed on a
  missing integration row (`nfc_integration.py:47-48`). `TestBadgeTapEndpoint::
test_the_integration_switched_off_refuses_even_an_enabled_room` and
  `test_a_room_with_badge_taps_off_refuses` cover both halves.
- **Rate limiting is dual and ordered correctly.** `_rate_limit_badge_tap_ip`
  (60/min/IP, a FastAPI dependency so it runs before the handler body) and
  `_rate_limit_badge_tap_room` (60/min/room, called first in the handler,
  before the display-code DB lookup) both apply 5-minute lockouts on top of
  the window. Unlike the guest-check-in daily cap (LOC-32-4's lesson), there
  is no shared scarce resource here for a doomed request to exhaust — each
  rate-limit key is either a caller IP or a display code, so spending a
  bucket on a malformed/disabled/nonexistent code only self-limits that
  useless key, not a real quota. `TestBadgeTapEndpoint::test_the_room_
ceiling_is_enforced` and `test_a_malformed_code_404s_before_any_lookup`
  cover the ordering.
- **The badge-check-in toggle endpoint (`PUT .../badge-check-in`) is its own
  grant, its own audited act, and org-scoped through the existing
  `LocationService.get_location`/`set_badge_check_in` path** — not a field
  on the general location-edit form, matching its own docstring's stated
  reasoning. Enabling is blocked unless the org's NFC ID Cards integration
  is connected (`locations.py:306-312`); disabling is always allowed, so a
  department can always turn a room off even if the integration is later
  disconnected. Audited as `warning` (enable) / `info` (disable),
  `tests/test_kiosk_badge_tap.py::TestRoomSwitch` covers the permission,
  integration gate and audit severity split directly.
- **`locations.manage_nfc_tags` / `apparatus.manage_nfc_tags` are seeded
  correctly per Pitfall #23.** Migration `5bed4c485d2f` writes only
  `is_system = True` positions, only when the row is non-empty and does not
  already cover the grant by any spelling (exact permission, module
  wildcard, or `*`), and is additions-only (never strips a grant a
  department added itself) — the shape `docs/rules/migrations.md` requires.
  Frozen `_GRANTS`/`_REQUIRES` tables rather than derived from the live
  registry, so the migration keeps writing what it wrote the day it ran
  regardless of later registry changes.
- **The new `nfc_badge_check_in_enabled` column migration tolerates a
  `create_all`-built table** (Pitfall #26) — `040ae44ad286` guards on both
  the table and the column already existing before adding either, and
  `locations` is in the migration-built set regardless, so the guard is
  defensive rather than load-bearing.
- **The room-tag frontend flow does not put the kiosk's bearer credential
  on a physically-exposed tag.** `buildRoomCheckInUrl` encodes
  `/locations/{id}/check-in` — an authenticated page requiring a session,
  resolved within the tapping member's own org server-side — never the
  kiosk's `display_code`. `RoomCheckInPage.tsx` itself does no eligibility
  decision; it only reads which event is open and hands the member to that
  event's own `self_check_in` page, which enforces every rule about who may
  check in.
- **`RoomQRCodesPage.tsx`'s badge-check-in switch uses `useConfirm()`, not
  `window.confirm`** (Pitfall #16), is gated on `locations.manage_nfc_tags`
  AND the integration being connected client-side (matching, not replacing,
  the server-side gate), and the confirmation copy states the exact
  consequence ("nobody signed in at the kiosk") before the toggle takes
  effect.
- **`LocationsPage.tsx`'s edit/delete/create controls are now
  permission-gated to match the backend they call**, rather than shown to
  every member and 403ing on click — a defense-in-depth UI fix, not a new
  access-control boundary (the backend already enforced each permission).
- **No regression in the data-exposure baseline the public kiosk already
  established.** The badge-tap endpoint's own event/room resolution reuses
  `LocationService.get_current_events_in_check_in_window`, the same
  unfiltered-by-audience query the fully-anonymous public kiosk display has
  used since pass 1 — so an authenticated member seeing the same event
  names via the kiosk flow is not a new exposure relative to what an
  anonymous passerby already sees at the physical kiosk.

## Findings

### LOC5-32-1 — LOW/MED — The now-live `GET /locations/{id}/display` shipped without the redaction its own backlog required — ✅ FIXED

**What:** `docs/KNOWN_LIMITATIONS.md`'s LOC-3 entry tracked this endpoint as
dead code with three known gaps relative to its public sibling, and stated
the condition for closing it: "give it a caller and bring it in line with
its public sibling on all three points before that caller ships." The
2026-10-02/03 NFC work gave it a caller — `RoomCheckInPage.tsx`'s
`getCurrentCheckIns`, reached when a member taps a room's own NFC tag — but
shipped without revisiting any of the three points. One of them is a real,
if narrow, data-exposure gap: the endpoint still built
`event_description=event.description`, while its public sibling
(`public/display.py:262`) explicitly nulls the same field with a comment
("Don't expose description publicly"). The query both endpoints share,
`LocationService.get_current_events_in_check_in_window`, applies no
audience/membership-tier filter — it reports whatever event is physically
using the room — so an authenticated member of the org could read the
description of an event they might not otherwise be entitled to see,
simply by visiting (or being redirected to) `/locations/{id}/display` for
a room where such an event happens to be open.

**Where:** `backend/app/api/v1/endpoints/locations.py:356-430`
(`get_location_display_info`), as it stood before this pass's fix.

**Failure scenario:** a department restricts an event to a membership tier
the caller does not hold, but schedules it in a room whose kiosk (or now,
whose NFC tag) any member can reach. A member outside that tier taps the
room's tag, lands on `RoomCheckInPage`, and — even though the frontend does
not currently render `event_description` — could read it directly from the
JSON response (devtools, or any other caller of the same authenticated
endpoint), learning event detail text the department restricted for a
reason.

**Impact:** LOW/MED — requires an authenticated org member and a
tier-restricted event scheduled in a kiosk/tag-reachable room; no
cross-tenant exposure (the endpoint is already org-scoped) and the event's
_title_ is already visible to this same audience via the endpoint's own
`event_name` field and, for the public kiosk, to literally anyone
unauthenticated. Only the free-text description was the actual gap.

**Fix:** `event_description` now returns `None` unconditionally, matching
the public sibling exactly. The current caller does not read the field, so
this is a pure reduction in what the response carries with no functional
loss. Also re-examined, not changed: the `is_valid=True`/`can_check_in=True`
hardcoding this endpoint has always used is **not** a gap — the query
feeding it already applies the precise canonical per-event window (fixed at
LOC-1 and re-confirmed at every pass through LOC4), so every event the loop
sees genuinely is checkable, and the hardcoded value matches reality rather
than assuming it. The missing `timezone` field remains open but low
priority — the current caller renders every time through its own
`useTimezone()` rather than this response, so closing it has no present
consumer to justify the extra query; left for whenever a caller actually
needs it. `docs/KNOWN_LIMITATIONS.md`'s LOC-3 entry rewritten to reflect
all three outcomes. Guard test:
`tests/test_location_display_endpoint.py::TestLocationDisplayInfo::
test_event_description_is_redacted`.

## Schema & migration notes

Two new migrations this pass, both reviewed above under "Verified good":
`5bed4c485d2f` (seeds `locations.manage_nfc_tags` / `apparatus.manage_
nfc_tags` onto existing installs, additions-only, Pitfall #23 compliant)
and `040ae44ad286` (adds `locations.nfc_badge_check_in_enabled`,
`nullable=False` with `server_default="0"`, guarded against a
`create_all`-built table per Pitfall #26). `Location.created_by`'s FK gained
an explicit `ondelete="RESTRICT"` (previously the implicit default); still
`nullable=True`, not a `SET NULL` column so Pitfall #2 does not apply.
`scripts/validate_migrations.py --strict`: 509 revisions, single head
(`d058b5e7c1f4`).

## Guard tests added

- `tests/test_location_display_endpoint.py::TestLocationDisplayInfo::
test_event_description_is_redacted` — LOC5-32-1: asserts
  `current_events[0]["event_description"]` is `None` even when the
  underlying event has a non-empty `description`, so a regression back to
  `event.description` fails rather than passing by coincidence on an empty
  field.
- No other new guard tests added by this pass — the new badge check-in /
  kiosk-tap surface already shipped with its own dedicated coverage
  (`tests/test_kiosk_badge_tap.py`, 34 tests across org-scoping, redaction,
  rate-limit ordering, the permission/integration gate on the toggle
  endpoint, and the audit-severity split), written alongside the feature
  rather than by this review. Re-run clean as part of the scoped and full
  suites below; not re-authored here since nothing in them needed a fix.

## Completion gate

| Check                                                                                                                                                                                                                                                            | Result                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                    | ✅ 0 violations                                                                      |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                             | ✅ clean, 1853 files unchanged                                                       |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.1)                                                                                                                                                                                                         | ✅ clean                                                                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                                                | ✅ 509 revisions, single head                                                        |
| Scoped tests (`-k "location or kiosk or admin_hub or guest_check_in or public_display or badge"`)                                                                                                                                                                | ✅ 564 passed, 1 skipped (pywebpush, pre-existing)                                   |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage`, `test_require_permission_registry`, `test_scheduled_task_coverage`, `test_cron_org_loop_isolation`, `test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`) | ✅ 75 passed                                                                         |
| Full backend suite (`pytest tests/`)                                                                                                                                                                                                                             | ✅ 15,696 passed, 21 skipped (pre-existing: pywebpush, Docker unavailable), 0 failed |
| `npm ci` (fresh worktree, repo root)                                                                                                                                                                                                                             | ✅ clean install                                                                     |
| `npm run typecheck` (aliased `tsc-native`)                                                                                                                                                                                                                       | ✅ 0 errors                                                                          |
| `npm run lint`                                                                                                                                                                                                                                                   | ✅ 0 errors, 0 warnings                                                              |
