# Security Review — Feature 32: Locations & Kiosk (pass 12)

**Prefix:** `LOC12` · **Iteration:** 32 · **Reviewed:** 2026-11-04 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.

**Watchdog pickup** — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents`, "No reachable agents"). PR #4006 (Feature 31, Scheduled tasks,
pass 12) had just merged into `main` (`085db1523`, itself a prior watchdog
pickup); a GitHub listing of open PRs returned nothing whose head branch
starts with `claude/security-review-`, confirming row 32 as the next `⬜` row
on a freshly-fetched `main`.

---

## Scope

Pass 11's baseline is PR #3865, tip `c3b156bdd` (merged 2026-10-30). A
path-scoped `git diff c3b156bdd..HEAD --stat` against this feature's declared
backend/frontend files found exactly three changed files — `display.py` (1
line), `guest_check_in_service.py` (26 lines), `admin_hub_service.py` (162
lines) — out of 507 total commits on `main` in that window; every other
declared file (`locations.py`, `location_service.py`, `admin_hub.py`,
`models/location.py`, `models/admin_hub.py`, `schemas/location.py`,
`schemas/admin_hub.py`, `schemas/event.py`, `core/error_codes.py`, and all six
frontend files) confirmed byte-identical via the same diff.

All three changed files read in full:

- **`display.py`** — a one-line rename, `check_in_window_state` →
  `guest_sign_in_state`, following Events & requests' own consolidation
  (`9458cb31`, already reviewed as behavior-preserving at pass 11). No new
  diff beyond the rename.
- **`guest_check_in_service.py`** — a real fix, already merged before this
  pass started: `check_in_guest` now takes the event row's lock
  (`_lock_event`) before a locking read (`_find_existing_attendee(...,
for_update=True)`), closing the two-simultaneous-QR-scans race its own
  docstring names. Reviewed in full below — this pass found and fixed a
  second race the same bug class left behind.
- **`admin_hub_service.py`** — `_members_screening_current` and
  `_members_attention`'s medical-screening lapse detection now delegate to
  `MedicalScreeningService.get_compliance_roster` instead of re-deriving
  compliance with their own queries, closing a CLAUDE.md Pitfall #29
  violation (the hub's own hand-rolled logic ignored requirements, the
  frequency rule, position scoping and failures, and disagreed with the
  Compliance tab about the same member). Reviewed below under "Verified
  good".

## Route inventory

Re-enumerated by AST walk (`ast.walk` over all three files' `@router.<verb>`
decorators): **17 routes, unchanged from pass 11** — 8 in `locations.py`, 6 in
`display.py`, 3 in `admin_hub.py`. No drift on any path, auth dependency or
permission string; see pass 10/11's table in `LOC10-32-locations-kiosk.md` /
`LOC11-32-locations-kiosk.md`, re-verified identical by the AST count (neither
changed file in this window added or removed a `@router.*` decorator).

## Verified good ✅

- **Route count and gating unchanged** — 17/17, re-derived by AST rather than
  trusted from the prior pass's table.
- **`ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True`** (Pitfall #2) — `models/location.py` is byte-identical to
  pass 11, so the count (5 `RESTRICT`, 9 `SET NULL`) is unchanged.
- **The `check_in_window_state` → `guest_sign_in_state` rename in `display.py`
  is purely a repoint**, not new logic — confirmed by the one-line diff and by
  `guest_sign_in_state` itself being unchanged since pass 11.
- **`admin_hub_service.py`'s medical-screening rework is correctly module- and
  permission-gated**: the `screening_current` `MetricSpec` still carries
  `permission="medical_screening.view"` and `requires_module="medical_screening"`
  (both unchanged in this diff), and `_members_attention`'s own call is still
  behind its existing `if "medical_screening" in ctx.enabled_modules:` guard —
  so `get_compliance_roster` is never reached for an org that hasn't enabled
  the module, consistent with pass 10/11's established gating.
- **The new `get_compliance_roster` call is org-scoped the same way the
  queries it replaced were** — `ctx.organization_id` (the authenticated
  caller's own org, resolved by `get_summary`'s own permission-checked
  endpoint layer) is the only organization id passed in; `MedicalScreeningService`
  belongs to Feature 09 (Medical screening, PHI) and was reviewed there — not
  re-derived here, only checked for correct use at this call site.
- **No PHI/PII leak in the reworked attention item** — `screenings_not_compliant`'s
  title and detail carry only an aggregate count and a generic phrase ("a
  screening expired, failed or not yet recorded"), matching every other
  attention item on this page (pass 2's "no PII/PHI leak in dashboard text"
  claim, re-confirmed).
- **No new migration reaches this feature's tables** — none of the three
  changed files is a model or migration file.

## Findings

### LOC12-1 — MED — A known applicant's second kiosk confirm could race the first and both report a fresh sign-in — ✅ FIXED

**What:** `GuestCheckInService.check_in_known_prospect` decided its own
`already_checked_in` return value from an unlocked pre-check —
`self._find_existing_attendee(...)` with no `for_update`, run _before_ calling
`check_in_guest` — rather than from the value `check_in_guest` itself derives
under the event row's lock a few lines later (`already_checked_in = bool(attendee
and attendee.checked_in)` at what is now line 141, added by this window's
`_lock_event`/`for_update=True` fix). `check_in_guest` already computed the
correct, race-safe answer internally; it just never handed it back, so this
caller re-asked the same question itself, the unlocked way.

**Where:** `backend/app/services/guest_check_in_service.py` (`check_in_known_prospect`,
was lines 678-696 before this fix).

**Failure scenario:** an applicant the kiosk already recognises taps "Confirm"
twice in quick succession — a double-tap, or a retry of a POST that timed out
after the first one was processed, the identical trigger the `_lock_event` fix
exists to cover for the typed-email path. Both calls' unlocked pre-checks can
run before either has inserted the attendee row, so both see "not yet checked
in" and both return `already_checked_in=False`. Reached through
`display.py`'s and `event_guest.py`'s `/guest-confirm` endpoints, this means:
both responses tell the kiosk the applicant was _just_ signed in (rather than
one "already checked in"), and both calls log a `event_guest_checkin` audit
event — `if not already_checked_in: await log_audit_event(...)` — for what is
actually one attendance, producing a duplicate audit log entry. The
underlying attendee row itself still ends up correct (one row, one
`checked_in_at`) because `check_in_guest`'s own locking governs the write; this
is a correctness/audit-integrity gap in what the _caller_ reports, not a data
leak or a double-counted attendee.

**Impact:** LOW/MED — no tenant-isolation or injection exposure, and no
duplicate attendance record (the actual write stays correct under
`check_in_guest`'s lock), but a reachable, unauthenticated-caller-triggerable
race that produces an inaccurate audit trail (two "first sign-in" log entries
for one person) and a misleading kiosk response ("Thanks for signing in!"
shown twice for what the second tap should have reported as already done).

**Fix:** removed the separate unlocked pre-check entirely. `check_in_guest`'s
return signature now carries the `already_checked_in` it already decides under
lock as a fourth tuple element (`attendee, error, prospect_created,
already_checked_in`), and `check_in_known_prospect` uses that value instead of
asking the question itself. The two other callers (`display.py`'s and
`event_guest.py`'s typed-sign-in `/guest-check-in` endpoints) were updated to
unpack the fourth value; neither reads it, since neither gates on
`already_checked_in` today, but the signature has to agree everywhere it is
called. All test call sites across `test_guest_check_in.py`,
`test_pipeline_stage_auto_advance.py`, `test_bulk_advance_attendance_gate.py`
and `test_guest_check_in_race.py` updated to the four-value return.

**Verified against the unfixed code**: reverted the fix locally, confirmed
both new guard tests go red (`TestConcurrentKnownProspectConfirms` and the
source-level `test_known_prospect_confirm_does_not_re_derive_already_checked_in`),
then restored the fix and confirmed both pass, three consecutive runs each way
— CLAUDE.md Pitfall #37.

Guard tests:
`tests/test_guest_check_in_race.py::TestConcurrentKnownProspectConfirms::test_two_simultaneous_confirms_disagree_on_already_checked_in`,
`tests/test_guest_check_in_race.py::TestTheLockIsDeclared::test_known_prospect_confirm_does_not_re_derive_already_checked_in`.

## LOC-3, LOC10-2, LOC8-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                   |
| ------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC-3   | LOW      | 🚩 FLAGGED  | `GET /locations/{id}/display` still has zero frontend callers, still hardcodes `is_valid`/omits `timezone`. Deleting or wiring up a dead endpoint is an API-surface decision, not a security fix.         |
| LOC10-2 | LOW      | 🚩 FLAGGED  | The guest-confirm token comparison; closing it is a test-fixture-convention decision, not a one-line guard.                                                                                               |
| LOC8-2  | LOW      | 🚩 FLAGGED  | Hard-deleting a location nulls its location on 9 kinds of records (owner decision; `docs/KNOWN_LIMITATIONS.md` already reflects it).                                                                      |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection log line still carries the raw email — cross-feature, out of this feature's own files, flagged for Membership pipeline's own next pass. |

None of these files changed in this window (confirmed by the scope diff
above), so none is re-derived; `docs/KNOWN_LIMITATIONS.md`'s LOC8-2 entry needs
no edit.

## Schema & migration notes

No new columns or tables; no model file in this feature's scope changed.
`scripts/validate_migrations.py --strict` — 712 revisions, single head
`b5e906ebdd7d`.

## Guard tests added

- `tests/test_guest_check_in_race.py::TestConcurrentKnownProspectConfirms::
test_two_simultaneous_confirms_disagree_on_already_checked_in` — LOC12-1: two
  concurrent `check_in_known_prospect` calls for the same applicant produce
  exactly one attendee row and disagree on `already_checked_in` (one `False`,
  one `True`); both `False` is the bug this guards against.
- `tests/test_guest_check_in_race.py::TestTheLockIsDeclared::
test_known_prospect_confirm_does_not_re_derive_already_checked_in` — a
  source-level guard so the fix cannot be quietly reverted where the DB-backed
  test above is not run: `check_in_known_prospect`'s source must not call
  `_find_existing_attendee` directly, and must take `already_checked_in` from
  `check_in_guest`'s own return.

## Completion gate

| Check                                                                                                          | Result                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.5.0)                                                                          | ✅ 0 violations                                      |
| `black --check app/ tests/ alembic/` (reformatted 4 touched files, then clean)                                 | ✅ clean                                             |
| `isort --check-only app/ tests/ alembic/`                                                                      | ✅ clean                                             |
| `python3 scripts/validate_migrations.py --strict`                                                              | ✅ PASSED, 712 revisions, single head `b5e906ebdd7d` |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                     | ✅ 17/17, unchanged from pass 11                     |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                              | ✅ 298 routes, 0 errors/warnings                     |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display"` | ✅ 727 passed, 1 skipped (pre-existing `pywebpush`)  |
| Guard tests red-then-green against the unfixed code (Pitfall #37)                                              | ✅ confirmed, 3 runs each way                        |
| `npm run typecheck` / `npm run lint`                                                                           | n/a — no frontend file changed this pass             |
