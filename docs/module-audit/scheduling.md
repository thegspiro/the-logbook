# Module Audit — Scheduling

**Scope:** `api/v1/endpoints/scheduling.py` (~1,900 L, shifts / assignments /
open-shift signup / swaps / patterns / member-hours reports) and
`services/scheduling_service.py` (~5,000 L). Covers manager shift management,
self-service member signup/swap, recurring-pattern generation, and hours
reporting. Frontend `modules/scheduling`.
**Audited:** iteration 19 — split across two parallel readers: (A) self-service
paths (open-shift signup, swaps, member hours); (B) manager paths (shift CRUD,
pattern generation, tenant isolation).

## Verified good ✅

- **Manager tenant isolation is solid (XC-3 clean).** Every by-id shift/
  assignment/pattern read/update/delete resolves through
  `get_shift_by_id`/`get_assignment_by_id`/`get_pattern_by_id`, each of which
  filters `organization_id`. Admin mutations behind `scheduling.manage` fetch
  the target org-scoped first, so an org-A manager cannot touch an org-B shift.
- **No SQL injection** — parameterized equality/`in_` throughout; no raw LIKE.
- **Manager review enforces separation of duties.** The swap review path rejects
  both the requester and a targeted participant; target acceptance is not
  supported through the manager-review endpoint. Time-off review likewise
  rejects the member who submitted the request. Rejected reviews leave the
  request pending.

## Findings

### SCH-1 — HIGH — Self-signup for an `officer` position self-escalated to `shift_officer_id` — ✅ FIXED

`signup_for_shift` → `create_assignment` on an `open_to_all_members` shift ran
the manager-path "auto-promote the officer-position assignee to
`shift.shift_officer_id`" block. A rank-and-file member signing up for an
officer slot therefore set themselves as the shift officer, gaining crew-wide
authority over that shift.
**Fix:** threaded a `self_signup: bool = False` param through `create_assignment`;
the signup endpoint passes `self_signup=True`, and the officer auto-promote block
is now guarded by `not self_signup`. Manager-initiated assignment (default
`self_signup=False`) keeps the existing behavior.

### SCH-2 — HIGH — Self-signup skipped cancelled/finalized/past-date guards — ✅ FIXED

The self-service signup path did not re-check shift state, so a member could sign
themselves onto a CANCELLED, finalized, or past-dated shift.
**Fix:** when `self_signup=True`, `create_assignment` rejects
`ShiftStatus.CANCELLED`, `shift.is_finalized`, and `shift.shift_date <
date.today()`.

### SCH-3 — HIGH — Unbounded `generate_shifts_from_pattern` (DoS) — ✅ FIXED

The recurring-pattern generation endpoint accepted an arbitrary start/end range
and materialized one shift row per matching day with no upper bound — a single
call with a multi-decade range could exhaust DB/memory.
**Fix:** added `MAX_GENERATION_DAYS = 366` and endpoint-level validation that
rejects `end < start` and `(end - start).days > MAX_GENERATION_DAYS`.

### SCH-4 — MEDIUM (XC-1 + cross-org PII leak) — `shift_officer_id` not org-validated; hours-report User join unscoped — ✅ FIXED

Two related gaps:

- `create_shift` / `update_shift` stored a client-supplied `shift_officer_id`
  without confirming that user is in-org, and `_sync_officer_assignment` then
  minted an apparatus assignment for that (possibly foreign) id.
- `get_member_hours_report`'s `User` join had no `organization_id` filter, so a
  shift carrying a foreign `shift_officer_id` (or any cross-org row that slipped
  through) could surface a foreign member's name/email in the report.
  **Fix:** `create_shift` and `update_shift` now call
  `_user_in_org(shift_officer_id, organization_id)` and return "Shift officer not
  found" on mismatch; the hours-report join adds
  `User.organization_id == str(organization_id)`.

### SCH-5 — MEDIUM (flagged) — Swap re-validation & self-approval on the accept path — ✅ RESOLVED (security review SCH-15 pass 2, 2026-08-28)

When a swap is _accepted_ by the counterparty (as opposed to manager approval),
the target shift's current state (capacity, cancellation, finalization) is not
re-validated at accept time, and the accept path's approver-identity check is
looser than the manual-review path. Behavior-change — flagged rather than
auto-applied. **Status:** flagged (M1/M2).

**Resolved by a later redesign, confirmed rather than assumed:**
`respond_to_swap_offer` (added 2026-08-24, `app/services/scheduling_service.py`)
replaced the general swap-accept path with a narrower one-way-offer accept;
every two-way exchange still goes exclusively through `review_swap_request`
(manager review, which already re-validates and enforces separation of
duties). The one-way accept path re-validates the target shift's live state
before moving the seat (`_validate_assignment_candidate(require_mutable=True,
reject_past=True, enforce_capacity=True)` — cancellation, finalization, and
capacity all checked) and enforces a strict `target_user_id == responder_id`
identity check. Covered by `tests/test_swap_offer_response.py` (17 tests,
DB-free, all passing). See `docs/security-review/SCH-15-scheduling.md` → Pass
2 for the full trace.

### SCH-6 — MEDIUM/LOW — `finalize_shift` manual_hours & apparatus FKs — ✅ FIXED (app-review B19)

**Real gap fixed:** `finalize_shift` created a `ShiftAttendance` row from a
client-supplied `manual_hours[].user_id` with no in-org check — a foreign user
could be credited hours on this org's shift. Now validated via `_user_in_org`
(rejects before writing). The manual `hours` _value_ was already bounded at the
schema (`ManualHoursEntry.hours: Field(gt=0, le=48)`), so that half was already
closed. **Also:** `create_shift`/`update_shift` now validate `apparatus_id` in-org
via `is_in_org` (DiD — was backstopped by the org-scoped min-staffing lookup).
`station_id` is an unwired placeholder (no reads); `template_id` isn't a `Shift`
field. 2 regression tests added. See `docs/app-review/scheduling.md`.

## Notes

- Large-module caveat: `scheduling_service.py` (~5,000 L) was reviewed for
  security invariants (org-scoping, XC-1/3, self-service escalation, DoS), not
  line-by-line. The invariants held on every path examined.
