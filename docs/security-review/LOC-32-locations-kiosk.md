# Security Review — Feature 32: Locations & Kiosk (pass 2)

**Prefix:** `LOC` · **Iteration:** 32 · **Reviewed:** 2026-08-31 · **PR:** [#2098](https://github.com/thegspiro/the-logbook/pull/2098)

**Backend:** `app/api/v1/endpoints/locations.py` (364 L, 8 routes),
`app/services/location_service.py` (382 L), `app/api/public/display.py`
(419 L, 3 routes), `app/api/v1/endpoints/admin_hub.py` (112 L, 3 routes),
`app/services/admin_hub_service.py` (1,841 L), `app/services/
guest_check_in_service.py` (382 L), `app/models/location.py`,
`app/models/admin_hub.py`, `app/schemas/location.py` (+ a
`model_validator`), `app/schemas/admin_hub.py`.
**Frontend:** not read this pass — no response shape or contract this
pass's fixes touch changed (see each finding).
**Migrations:** none — no schema change.

## Correction — the round-1 zero-diff claim used an unreachable commit

The first round of this pass diffed against `1b7be79a`, the last commit of
pass 1's source branch before it merged. **That object is not reachable
from `main`'s history.** PR #1916 was squash-merged, and `1a0a35c8` is the
actual commit that landed. `1b7be79a` only resolved locally in that round
because this session had explicitly fetched it by SHA earlier in the same
session (GitHub will serve an object by exact SHA if it exists anywhere on
the remote, including an orphaned pre-squash branch tip); a normal clone or
CI checkout cannot resolve it, so `git diff 1b7be79a HEAD` as written was
not actually reproducible. Verified the fix: `1a0a35c8` is a real ancestor
of `main` (`git log` shows it as `security(locations-kiosk): 3 fixes,
LOC-3 still flagged (#1916)`), and diffs identically to `1b7be79a` for
every file in this feature's surface — the zero-diff conclusion itself was
correct, only the citation was wrong. Caught by Codex's review of this PR;
thanks. Every commit reference in this document uses `1a0a35c8`.

## Correction — the round-1 zero-diff read missed five real gaps

Round 1 read every file in the surface in full but reported zero findings.
Codex's review of the same PR found five real, independently verified
issues that a genuine diff would not have surfaced (nothing in the diffed
files changed) but that a closer functional read should have caught. All
five are fixed below. This is why the rotation runs the completion gate and
accepts review findings as bug reports to verify, not merely a formality —
"no diff" is not the same claim as "no bug."

---

## Scope

**Read in full:** `locations.py` (all 8 routes), `admin_hub.py` (all 3
routes), `location_service.py` (all methods), `public/display.py` (all 3
routes), `admin_hub_service.py` (all 1,841 lines), `guest_check_in_service.py`
(all methods), `models/location.py`, `models/admin_hub.py`,
`schemas/location.py`, `schemas/admin_hub.py`.

**Re-verified against:** `docs/security-review/LOC2-32-locations-kiosk.md`
(pass 1, PR #1916, 3 findings + LOC-3 flagged).

## Route inventory

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

## Verified good ✅

- **LOC2-32-1/2/3 (pass 1) still fixed**, unchanged since PR #1916:
  `_events_attendance_rate`'s independent `Event.organization_id` filter;
  `_sanitize`'s shared `_permitted()` gate across both selection loops; the
  bounded first-insert retry (with the Codex-caught `db.refresh(ctx.user)`
  correction) in `save_settings`.
- **LOC-1, LOC-2, LOC-4 (pre-pass-1) still hold** — canonical check-in
  window, kiosk timezone, and the 24h prefilter bound.
- **`admin_hub_service.py`'s full resolver set remains org-scoped
  throughout** — every `select()` filters `organization_id` directly or via
  a shared criteria helper never called without it. No raw SQL, no
  `.like()`/`.ilike()` anywhere in the file.
- **No PII/PHI leak in dashboard text** — every attention/metric value is
  an aggregate count, percentage, or generic phrase.
- **`can_view_kiosk_display_codes` gate applied uniformly** across all four
  `locations.py` response builders.
- **`ondelete="SET NULL"` columns still `nullable=True`** —
  `Location.facility_id`/`facility_room_id`.

## Findings

### LOC-32-1 — MED — A lost prospect-link race could cost the guest their attendance, not just the pipeline link — ✅ FIXED

**What:** `guest_check_in_service.py`'s `_link_prospect` catches a broad
`Exception` around its whole body, on the documented reasoning that
"a failure here must not cost the guest their attendance." That reasoning
holds for a business-logic failure, but not for a failed database flush:
`link_prospect_to_event`'s `self.db.add(...)` + `await self.db.flush()` ran
with no SAVEPOINT, so a duplicate-key `IntegrityError` (two concurrent
sign-ins linking the same prospect to the same event both pass the
existing-link SELECT and both attempt the INSERT) left the whole session's
transaction needing a rollback it never got. `check_in_guest`'s own
`await self.db.commit()` — which is what actually persists the guest's
`EventExternalAttendee` row — runs unguarded a few lines later and fails on
that poisoned session, so the request 500s and the attendance record the
comment promised would survive is lost along with the pipeline link.

**Where:** `backend/app/services/guest_check_in_service.py:249-266` (as it
stood at `1a0a35c8`; `link_prospect_to_event`).

**Failure scenario:** two guests (or one guest tapping the QR code twice
from two tabs) with the same email sign in for the same event within the
same race window. Both resolve to the same existing prospect, both attempt
to insert the `(prospect_id, event_id)` link, and the second one's flush
fails. Before the fix, that guest sees a 500 and their sign-in is not
recorded at all — worse than the pipeline simply not linking.

**Impact:** availability — a race an anonymous, unauthenticated, rate-limited
but still-reachable caller can trigger (deliberately, or just two people
scanning the same code at once) turns a best-effort pipeline link into a
lost attendance record.

**Fix:** wrapped the insert in `async with self.db.begin_nested():` (a
SAVEPOINT), matching the identical pattern `MembershipPipelineService.
create_prospect` already uses for its own duplicate-email race, and catch
only `IntegrityError` there. A lost race now rolls back just the failed
insert; the outer transaction (the attendee record) is untouched. Guard
test: `tests/test_guest_check_in.py::TestGuestProspectCreation::
test_link_race_is_scoped_to_a_savepoint_not_the_whole_commit`.

### LOC-32-2 — MED — Kiosk display codes kept working after the organization was deactivated — ✅ FIXED

**What:** `LocationService.get_location_by_display_code` filtered only
`Location.is_active`, never `Organization.active`. Deactivating an
organization does not touch its `Location` rows, so a printed QR code or a
bookmarked kiosk tablet URL kept resolving indefinitely — both the public
display read and the guest-check-in write paths (`public/display.py`)
depend on this one lookup for tenant resolution. Other public intake
surfaces in this codebase (`event_requests.py:264`, and every login path in
`auth.py`) already gate on `Organization.active`; this was the one that
didn't.

**Where:** `backend/app/services/location_service.py` (`get_location_by_
display_code`, was lines 343-352 at `1a0a35c8`).

**Failure scenario:** a department's account is deactivated (contract
ended, account suspended). Its kiosk tablets and any previously-printed
room QR codes keep showing live event data and accepting guest sign-ins —
including creating `ProspectiveMember` records — for an org that should have
no further activity.

**Impact:** a deactivated tenant's public surface stays live; low
likelihood (requires an org to actually be deactivated) but a real gap with
no compensating control, matching the established app-wide invariant.

**Fix:** joined `Organization` and added `Organization.active == True` to
the query, alongside the existing `Location.is_active` filter. Both public
callers already treat "not found" as a generic 404, so a deactivated org's
code is now indistinguishable from one that never existed — no new error
path needed. Guard tests: `tests/test_location_display_code.py::
TestGetLocationByDisplayCode`.

### LOC-32-3 — LOW/MED — A location's uniqueness scope was only re-checked on a name change — ✅ FIXED

**What:** `LocationService.update_location`'s duplicate check only ran when
`location_data.name and location_data.name != location.name`. The scope it
protects, per the create path's own comment ("Rooms at different stations
may share a name"), is the pair `(name, building)` — but a PATCH that
changes only `building` skipped the check entirely.

**Where:** `backend/app/services/location_service.py` (`update_location`,
was lines 122-145 at `1a0a35c8`).

**Failure scenario:** two locations named "Bunk Room" exist, one at Station
1 and one at Station 2 — both valid under the stated scope. An admin PATCHes
Station 2's "Bunk Room" with `{"building": "Station 1"}` (no `name` in the
payload). The check never runs; both stations now have a "Bunk Room" at
Station 1, an ambiguous duplicate the uniqueness rule exists to prevent.

**Impact:** data-quality, not tenant isolation or injection — ambiguous
entries in location pickers/event forms. Real and directly reachable by any
caller with `locations.edit`, not merely latent.

**Fix:** compute the effective `(name, building)` pair (payload value if
supplied, else the location's current value) and run the duplicate check
whenever either component differs from the current row — not only when
`name` is supplied. Guard tests: `tests/test_location_uniqueness.py`.

**Revised after Codex review (this PR):** the first fix computed
"supplied" as `location_data.building is not None`, which cannot tell an
explicit `PATCH {"building": null}` (clearing it) apart from an omitted
`building` — both read as `None`. So a clear fell back to the location's
_current_ building for the dup-check while still persisting `None` via
`model_dump(exclude_unset=True)`, missing a conflict with an existing
same-named, no-building location. `name` cannot be explicitly null
(LocationUpdate rejects it as of LOC-32-5), so this only bit `building`.
Fixed by reading `location_data.model_fields_set` instead of an `is not
None` check, so "omitted" and "explicitly null" are told apart correctly
for both fields. Guard tests added:
`test_explicit_null_building_is_checked_for_duplicates` (asserts the
generated query checks `building IS NULL`, not the old value) and
`test_explicit_null_building_with_no_conflict_clears_it`.

### LOC-32-4 — MED — The guest-check-in daily cap was reserved before every rejection gate — ✅ FIXED

**What:** `POST .../guest-check-in` called `daily_cap_exceeded()` — an
atomic Redis `INCR`, so asking the question spends an allowance slot —
_before_ checking whether the check-in window was even open, and before the
service-level `attendance_is_finalized` check. `event_requests.py`'s public
submission endpoint documents and enforces the correct ordering for the
identical class of cap (EV-19): "the counter is spent only by a submission
that would otherwise be accepted, so every rejection path belongs above
it." This endpoint didn't follow it.

**Where:** `backend/app/api/public/display.py` (`guest_check_in`, was lines
325-345 at `1a0a35c8`).

**Failure scenario:** a distributed caller who has seen (or guessed) a
room's display code and an upcoming event id sends requests before the
check-in window opens (or after attendance is finalized). Every one gets
rejected with 400 — but each rejection still consumed one unit of the
event's 300/day allowance. Enough of them exhaust the cap before the window
opens, so every legitimate guest who shows up later that day gets a 429
instead of being able to sign in — the exact denial-of-service the cap
exists to prevent, now caused by the cap itself.

**Impact:** availability — turns a compensating control into the attack
surface. Reachable by an unauthenticated caller with no rate-limit bypass
needed beyond the existing per-IP window (distributed callers are exactly
what the daily cap is meant to catch that per-IP limiting can't).

**Fix:** moved the check-in-window-open check and the
`attendance_is_finalized` check (previously only checked inside the
service, after the cap) above `daily_cap_exceeded`, matching
`event_requests.py`'s established ordering. The service's own
`attendance_is_finalized` check stays in place as defense in depth for the
staff-entry path that shares `check_in_guest`. Guard tests:
`tests/test_public_display.py::TestGuestCheckInDailyCapOrdering`.

### LOC-32-5 — LOW — An explicit `null` for a NOT NULL location field reached the database as a 500, not a validation error — ✅ FIXED

**What:** `LocationUpdate.name` and `LocationUpdate.is_active` are typed
`Optional[...] = None` to make them _omittable_ on a PATCH — but that same
typing also accepts an explicit `null` in the request body.
`update_location`'s `model_dump(exclude_unset=True)` preserves a
supplied-but-null key, and `setattr(location, field, value)` then writes
`None` straight into `Location.name` (`String(200), nullable=False`) or
`Location.is_active` (`Boolean, nullable=False)`.

**Where:** `backend/app/schemas/location.py` (`LocationUpdate`, was lines
56-72 at `1a0a35c8`).

**Failure scenario:** `PATCH /locations/{id}` with body `{"name": null}` or
`{"is_active": null}`. Both pass schema validation, reach
`update_location`, and fail at the database's own NOT NULL constraint —
returning a generic 500 (via `handle_service_errors`'s catch-all, so no
detail leaks) instead of the clean 422 a malformed request should get.

**Impact:** LOW — no data corruption (the constraint holds) and no
information disclosure, but a caller-triggerable 500 for input that should
be rejected at the boundary, and unnecessary error-log noise.

**Fix:** added a `model_validator(mode="after")` on `LocationUpdate` that
raises when either field is present in `model_fields_set` with a `None`
value — omission still passes untouched, matching every other optional
field's contract, but an explicit null on these two now 422s at the schema
boundary. Guard tests:
`tests/test_location_uniqueness.py::TestLocationUpdateRejectsNullForNonNullableFields`.

## LOC-3 status — still flagged, unchanged

`GET /locations/{id}/display` still has zero frontend callers, still
hardcodes `is_valid`/omits `timezone`, still emits `event_description`
unredacted. Not fixed, for the same reason as pass 1: deleting or wiring up
a dead endpoint is an API-surface decision. Already tracked in
`docs/KNOWN_LIMITATIONS.md`.

## Schema & migration notes

No new columns or tables. `scripts/validate_migrations.py --strict` — 394
revisions, single head.

## Guard tests added

- `tests/test_guest_check_in.py::TestGuestProspectCreation::
test_link_race_is_scoped_to_a_savepoint_not_the_whole_commit` — LOC-32-1:
  asserts `begin_nested()` wraps the link insert and a lost race still lets
  the attendee commit succeed.
- `tests/test_location_display_code.py::TestGetLocationByDisplayCode` —
  LOC-32-2: asserts the query joins `organizations` and filters `active`.
- `tests/test_location_uniqueness.py` — LOC-32-3: a building-only change
  against a same-named location in the target building is rejected; a
  building-only change with no conflict succeeds; a change touching neither
  name nor building skips the query entirely; an explicit
  `building: null` clear is checked against the no-building scope (not the
  location's old building) and succeeds when there is no conflict.
- `tests/test_public_display.py::TestGuestCheckInDailyCapOrdering` —
  LOC-32-4: a window-not-open rejection and a finalized-attendance rejection
  never call `daily_cap_exceeded`; a genuinely open request still does.
- `tests/test_location_uniqueness.py::
TestLocationUpdateRejectsNullForNonNullableFields` — LOC-32-5: an explicit
  `null` for `name` or `is_active` is rejected; omitting either, or a real
  value, still passes.

## Completion gate

| Check                                                                           | Result                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                   | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                                            | ✅ clean (after formatting one file)                |
| `isort --check-only app/ tests/ alembic/`                                       | ✅ clean                                            |
| `python3 scripts/validate_migrations.py --strict`                               | ✅ 394 revisions, single head                       |
| Scoped tests (`-k "location or admin_hub or guest_check_in or public_display"`) | ✅ 313 passed, 1 skipped (pre-existing)             |
| Full backend suite (`pytest tests/`)                                            | ✅ 9368 passed, 22 skipped (pre-existing), 0 failed |
| `tsc --noEmit` / `eslint .`                                                     | n/a — no frontend file changed                      |
