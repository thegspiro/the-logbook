# Security Review — Feature 32: Locations & Kiosk

**Prefix:** `LOC` · **Iteration:** 32 · **Reviewed:** 2026-08-27 · **PR:** [#1916](https://github.com/thegspiro/the-logbook/pull/1916)

**Backend:** `app/api/v1/endpoints/locations.py` (364 L, 7 endpoints),
`app/services/location_service.py` (364 L), `app/api/public/display.py`
(401 L, 4 endpoints — the kiosk's actual data source, plus the new guest
check-in path), `app/api/v1/endpoints/admin_hub.py` (112 L, 3 endpoints),
`app/services/admin_hub_service.py` (1,798 L, never previously reviewed).
**Frontend:** `pages/LocationKioskPage.tsx`, `pages/GuestCheckInPage.tsx` (new),
`pages/RoomQRCodesPage.tsx`, `pages/LocationsPage.tsx`.
**Migrations:** none this pass — no schema change.

This is two features sharing a rotation slot: Locations & kiosk (re-verified
against `docs/app-review/locations-kiosk.md`'s 2026-08-05/08 pass) and the
Administration-page frame (`admin_hub.py`/`admin_hub_service.py`), which had
never been reviewed at all. Five parallel background agents split the work:
four read `admin_hub_service.py` by line range (never reviewed, 1,798 lines),
one re-verified locations/kiosk against the prior pass's four findings and
reviewed everything added since.

Three real findings, all fixed (one LOW, two MED). One prior flagged item
(LOC-3, dead code) confirmed still open with a third gap since the last pass.
One agent-reported LOW investigated and found **not reproducible** — recorded
under Verified good with the mechanism that already prevents it.

---

## Scope

**Read in full:** `admin_hub_service.py` (all 1,798 lines, across 4 agents by
line range), `admin_hub.py`, `schemas/admin_hub.py`, `models/admin_hub.py`,
`locations.py`, `location_service.py`, `public/display.py`,
`LocationKioskPage.tsx`, `GuestCheckInPage.tsx`.

**Re-verified against prior findings:** `docs/app-review/locations-kiosk.md`
(LOC-1 through LOC-4).

**Not read this pass:** `RoomQRCodesPage.tsx`/`LocationsPage.tsx` beyond the
specific lines needed to investigate the one frontend finding reported by the
re-verification agent (see Verified good).

## Route inventory

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                            | Notes                                                          |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                   | `display_code` included only if `can_view_kiosk_display_codes` |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                   |                                                                |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                   |                                                                |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                   |                                                                |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                   |                                                                |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                   | audit-logged (new since last pass)                             |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                   | dead code, zero callers — LOC-3                                |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` (global-unique)    | rate-limited 60/min/IP                                         |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org | rate-limited (new — guest check-in)                            |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org | rate-limited 10/min/IP + 300/day/event (new)                   |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                   | 404s an unknown/forbidden module identically                   |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                   |                                                                |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                   | audit-logged                                                   |

Every route carries an auth dependency; the three public routes are
intentionally public and rate-limited (verified below).

## Verified good ✅

- **`admin_hub_service.py`'s 30+ metric/attention resolvers are correctly
  org-scoped.** Four agents read the file end-to-end by line range. Every
  query filters `organization_id` — directly, or through shared criteria
  helpers (`_active_member_criteria()`, `_in_service_criteria()`,
  `_below_par_criteria()`) that are never called without the org filter
  alongside them at any of their call sites. No cross-tenant leak found in
  the members, training, inventory, or events metric families.
- **`MODULE_REGISTRY`'s permission model is consistent and enforced, not
  just declarative.** All four modules gate on `"<module>.manage"`; the
  `members` module's screening metric and attention queue additionally
  require `medical_screening.view`. `AdminHubService.get_summary` checks
  `spec.attention_permission` before resolving the queue, `_render_metric`
  checks `metric.permission` before resolving a card, and `_sanitize`
  (before this pass's LOC2-32-2 fix, only in its primary loop) re-checks
  permission against a _stored_ selection — so a permission revoked after
  a selection was saved cannot be resurrected by reading it back.
- **No injection surface.** No raw SQL string interpolation and no
  `.like()`/`.ilike()` calls anywhere in `admin_hub_service.py` (confirmed
  by grep across the whole file, not just per-agent ranges).
- **Dashboard card text carries no PII/PHI.** Every `AdminAttentionItem`/
  `AdminMetric` value reviewed is an aggregate count, percentage, or generic
  phrase ("3 medical screenings expired," "SCBA hydro test due — 2
  cylinders") — no member names or contact info surfaced on a card.
- **LOC-1 still fixed.** `locations.py:329` calls
  `EventService._get_check_in_window(event)` — no reintroduced hardcoded
  window.
- **LOC-2 still fixed.** `public/display.py:235-248` populates
  `LocationDisplayInfo.timezone` from `Organization.timezone`;
  `LocationKioskPage.tsx` still prefers it over the browser's zone.
- **LOC-4 still fixed.** `location_service.py:238-276` still narrows the
  24h SQL prefilter to exactly the events whose canonical
  `_get_check_in_window` is open now, matching `_validate_check_in_window`'s
  predicate.
- **New: `can_view_kiosk_display_codes` gate.** `dependencies.py:255-270`,
  applied uniformly across every `locations.py` response builder. Requires
  `locations.manage`/`facilities.manage`/`locations.edit` before
  `display_code` is included in _any_ response — closing a real, previously
  unflagged exposure (the kiosk's bearer credential was visible to every
  authenticated user who could list locations at all).
- **New: `POST /locations/{id}/regenerate-display-code`.** Gated on
  `locations.edit`/`.manage`, org-scoped via `get_location()`, audit-logged.
- **New: guest check-in (3 routes in `public/display.py`, backed by
  `GuestCheckInService`, 361 L).** Full 7-dimension review: rate-limited
  (60/min/IP on both GETs, 10/min/IP + 10-min lockout on the write, plus a
  per-event `daily_cap_exceeded` ceiling of 300/day guarding the expensive
  prospect-creation side effect, checked _before_ that work runs); tenant
  isolation resolved server-side only, from `display_code` → `location` →
  `organization_id`, never from client input, with every failure path
  (bad code, wrong org, wrong room, guest check-in disabled, cancelled/draft
  event) collapsing to one generic 404 to prevent enumeration; event
  descriptions withheld from both response schemas; exceptions routed
  through `safe_error_detail()`; a honeypot field mirrors the existing
  public-forms pattern. No HIGH/CRITICAL findings on this new surface.
- **XC-3 on `display_code` re-confirmed.** `Location.display_code` is still
  `unique=True` **globally**, not per-org (`models/location.py:68`), so
  `get_location_by_display_code`'s `scalar_one_or_none()` remains safe by
  construction.
- **Frontend kiosk/guest pages have no banned date APIs.** No
  `.toLocaleString()`/`.toLocaleDateString()`/`date-fns` imports/
  `toISOString().slice()` in `LocationKioskPage.tsx` or the new
  `GuestCheckInPage.tsx`; every formatter call passes a `timezone`.
- **Investigated and not reproducible: `RoomQRCodesPage.tsx` /display/undefined
  concern.** The re-verification agent flagged `locationCardProps()`
  (`RoomQRCodesPage.tsx:218`) as building a kiosk URL from `display_code`
  with no null-guard, and reasoned that a viewer without
  `can_view_kiosk_display_codes` (e.g. `apparatus.view`-only, who the route's
  own permission gate admits) would get `display_code: null` back and render
  a broken `/display/undefined` card. On inspection this does not reproduce:
  `locationCardProps` is only ever called on locations that came through
  `groupByStation()` (`utils/locationGrouping.ts:19`), which itself filters
  `locations.filter((l) => l.display_code)` before grouping — a location with
  a null/falsy code never reaches a card in either the "signs" or "grid"
  layout. Existing test coverage
  (`RoomQRCodesPage.test.tsx`: `'groups rooms under their station and drops
locations without codes'`) already asserts this. No code change made.

## Findings

### LOC2-32-1 — LOW — `_events_attendance_rate` joined `Event` without independently filtering its org — ✅ FIXED

**What:** both queries filtered `EventRSVP.organization_id ==
ctx.organization_id` but joined to `Event` with no `Event.organization_id`
filter, relying on the invariant that a joined RSVP's org always matches its
parent Event's org rather than verifying it.

**Where:** `backend/app/services/admin_hub_service.py:1058-1085`.

**Failure scenario:** if any future bug elsewhere in the RSVP-creation path
ever wrote an `EventRSVP` row stamped with the caller's own org but pointing
via `event_id` at a _different_ org's event (a data-integrity violation, not
possible through today's RSVP-creation code paths), this metric would count
that row in the ratio — reporting a stranger's event as this org's own
attendance data. Every other query in this file that joins to `Event` filters
both sides; this was the one exception. Not independently exploitable today
(no user-controlled path to create such a row was found), hence LOW rather
than a live cross-tenant leak.

**Impact:** defense-in-depth gap, not a live leak.

**Fix:** added `Event.organization_id == ctx.organization_id` to both
queries; also collapsed the two independent `datetime.now(timezone.utc)`
calls (one per query) into a single `now` reused by both, so `going` and
`attended` can no longer be computed against slightly different instants.
Regression test constructs the invariant-violating row directly (an
`EventRSVP` correctly stamped with the caller's org but pointing at another
org's event) and asserts the metric excludes it:
`tests/test_admin_hub_db.py::TestEventsAttendanceRateOrgScoping`.

### LOC2-32-2 — MED — The metric-slot padding loop skipped the permission/module gate its own primary loop applies — ✅ FIXED

**What:** `AdminHubService._sanitize()` fills empty slots two ways: a primary
loop over the caller's stored selection (which checks `metric.permission`
and `metric.requires_module` before accepting a key), then a padding loop
over `spec.default_metrics` to top up any slots still empty — which checked
only `key in by_key`, no permission or module check at all.

**Where:** `backend/app/services/admin_hub_service.py` (padding loop, was
lines 1610-1614).

**Failure scenario:** if a module's stored selection resolves to fewer than
three usable keys — because the admin lacks permission for one, or a module
was toggled off — the padding loop could inject a permission-gated default
metric key straight into `resolved`, bypassing the check its sibling loop
enforces two lines above it. That key then reaches `_render_metric`, whose
permission-denied branch redacts the _value_ to `UNKNOWN_VALUE` but still
returns the metric's **label** — so an admin holding a module's base
`.manage` permission but not a specific metric-level permission (e.g.
`medical_screening.view`) could be shown a headline card carrying that
protected metric's name, directly conflicting with the file's own stated
intent ("must not advertise or preview protected data to an administrator
who cannot read the underlying records"). No module in the current registry
has a permission-gated _default_ metric, so this was latent rather than live
— but it is exploitable the moment one is added, silently, since nothing
would catch it.

**Impact:** label-level metadata leak to an under-privileged admin, latent
under the current registry contents.

**Fix:** factored the permission/module check into a shared `_permitted()`
closure and applied it in both loops. Regression test uses a purpose-built
`ModuleSpec` with a permission-gated default (the real registry has none, so
this couldn't be exercised against `MODULE_REGISTRY` itself) and asserts the
gated default is excluded from padding:
`tests/test_admin_hub_metrics.py::TestSlotResolution::test_padding_from_module_defaults_still_respects_permission_gates`.

### LOC2-32-3 — LOW/MED — Concurrent first-time settings saves could 500 instead of retrying — ✅ FIXED

**What:** `save_settings` reads the department/personal preference rows, and
if either is `None`, constructs and `db.add()`s a fresh row — with no
handling for the case where a concurrent request does the same thing for the
same `(org, module, scope)` at the same time.

**Where:** `backend/app/services/admin_hub_service.py` (`save_settings`, was
lines 1743-1775).

**Failure scenario:** two admins (or one admin double-submitting) save the
same module's department-wide settings for the first time within the same
race window. Both observe `department is None`, both insert, and the second
`commit()` raises `IntegrityError` against `uq_admin_hub_metric_pref_scope`
— uncaught, surfacing as an opaque 500 that silently drops the second
admin's legitimate save rather than retrying or merging it. Low likelihood
(requires a genuine first-save race), but a real gap: this repo's other
capacity/race-prone paths (Pitfall #27) are expected to handle contention
rather than crash.

**Impact:** a dropped save under low-probability but realistic concurrent
first-use, reported to the caller as a generic server error with no
indication their change didn't take.

**Fix:** wrapped the read-then-write in a bounded retry (2 attempts): catch
`IntegrityError` on commit, roll back, and re-read/re-apply once as an
update against whichever row won the race; re-raise if the second attempt
also conflicts, rather than looping or swallowing the error. `db_session`'s
test fixture wraps each test in one rolled-back transaction and cannot host
two independently-committing sessions (the same reason
`test_capacity_locking.py` verifies its locking invariants statically rather
than via a live two-connection race — see that file's docstring), so this is
covered with a mocked-session test that exercises the retry loop directly:
`tests/test_admin_hub_metrics.py::TestSaveSettingsFirstInsertRace` (one
asserting a single conflict retries and succeeds, one asserting a second
consecutive conflict still raises rather than looping).

**Revised after Codex review (PR #1916):** the fix above committed/rolled
back correctly but missed the same second-order effect this session's
CRON2-31 pass already named: `AsyncSession.rollback()` expires _every_
persistent object in the session, not just the row(s) the failed attempt
tried to insert — including `ctx.user`, the same `User` object the method's
caller (and the endpoint, for its post-save audit-log call) keeps using
afterward. On the retry, `user_has_permission()` reading `user.positions`
(a `selectinload`-populated relationship) would attempt an implicit async
reload outside the greenlet bridge and raise `MissingGreenlet` — negating
the whole point of the fix by turning the race into a _different_ 500 on
retry. The mocked test missed this because it supplies a bare
`SimpleNamespace`, which has no expiration semantics to violate. Fixed by
explicitly refreshing `ctx.user` (columns, then the `positions` relationship
by name) immediately after the rollback, before the retry continues.
Regression test extended to assert both `db.refresh` calls happen with the
expected arguments, on every rollback (including the final one before
re-raising, since the exception can propagate to code — the endpoint's
audit-log call — that also reads the now-expired user):
`tests/test_admin_hub_metrics.py::TestSaveSettingsFirstInsertRace`.

## LOC-3 status — still flagged, third gap since the last pass

`GET /locations/{id}/display` (the endpoint LOC-1 corrected) still has
**zero frontend callers** — confirmed via grep; the kiosk still calls
`/api/public/v1/display/{code}`. It still hardcodes `is_valid=True` /
`can_check_in=True` and never populates `timezone` (defaults to `None`),
exactly as flagged in the last pass. **New since then:** it also still emits
`event_description=event.description`
(`locations.py:336`), while its public sibling explicitly nulls that field
(`display.py:206`, with a comment: "Don't expose description publicly"). If
this endpoint is ever wired up rather than deleted, the fix list is now
three items — `is_valid`, `timezone`, and description redaction — not two.
Not fixed this pass either, for the same reason as before: deleting or
wiring up a dead endpoint is an API-surface decision, not a correction.
Already tracked in `docs/KNOWN_LIMITATIONS.md`; no change needed there beyond
noting the third gap.

## Schema & migration notes

No new columns or tables this pass. `AdminHubMetricPreference` (existing
table, `admin_hub_metric_preferences`) and `Location.display_code` (existing
column, migration `20260218_0900_add_location_display_code.py`) are both
unchanged.

## Guard tests added

- `tests/test_admin_hub_db.py::TestEventsAttendanceRateOrgScoping` — 2 tests
  asserting LOC2-32-1: a cross-org-referencing RSVP is excluded from the
  ratio, and the normal same-org case still counts correctly.
- `tests/test_admin_hub_metrics.py::TestSlotResolution::test_padding_from_module_defaults_still_respects_permission_gates`
  — asserts LOC2-32-2: a permission-gated default metric is never padded
  into a resolved selection for a caller who lacks the permission.
- `tests/test_admin_hub_metrics.py::TestSaveSettingsFirstInsertRace` — 2
  tests asserting LOC2-32-3: a single commit conflict retries and succeeds;
  a second consecutive conflict still raises.

## Completion gate

| Check                                                                      | Result                       |
| -------------------------------------------------------------------------- | ---------------------------- |
| `flake8 app/ tests/ alembic/`                                              | ✅ 0 violations              |
| `black --check app/ tests/ alembic/`                                       | ✅ clean                     |
| `isort --check-only app/ tests/ alembic/`                                  | ✅ clean                     |
| `python3 scripts/validate_migrations.py --strict`                          | ✅ passed (no schema change) |
| Scoped backend tests (`test_admin_hub_db.py`, `test_admin_hub_metrics.py`) | ✅ 174 passed                |
| `tsc --noEmit` (via `npm run typecheck`)                                   | ✅ 0 errors                  |
| `eslint` (`RoomQRCodesPage.tsx`)                                           | ✅ clean                     |
| Frontend tests (`RoomQRCodesPage.test.tsx`)                                | ✅ 13 passed                 |

**Codex round (this PR's own review):** `black`/`isort`/`flake8` re-run on
`admin_hub_service.py` and `test_admin_hub_metrics.py` — clean.
`test_admin_hub_metrics.py`/`test_admin_hub_db.py` re-run — 174/174 passed.
