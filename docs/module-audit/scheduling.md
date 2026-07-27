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
- **Swap approval blocks self-approval** on the manual review path (approver ≠
  requester enforced).

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

### SCH-5 — MEDIUM (flagged) — Swap re-validation & self-approval on the accept path
When a swap is *accepted* by the counterparty (as opposed to manager approval),
the target shift's current state (capacity, cancellation, finalization) is not
re-validated at accept time, and the accept path's approver-identity check is
looser than the manual-review path. Behavior-change — flagged rather than
auto-applied. **Status:** flagged (M1/M2).

### SCH-6 — LOW (flagged) — `finalize_shift` manual_hours & apparatus/station/template FKs
`finalize_shift` trusts a client-supplied `manual_hours` override, and
`create_shift`/`update_shift` accept `apparatus_id` / `station_id` /
`template_id` FKs without an in-org check (all currently backstopped by
org-scoped downstream reads, so not live cross-tenant writes — defense-in-depth
only). **Status:** flagged (F3/F4).

## Notes
- Large-module caveat: `scheduling_service.py` (~5,000 L) was reviewed for
  security invariants (org-scoping, XC-1/3, self-service escalation, DoS), not
  line-by-line. The invariants held on every path examined.
