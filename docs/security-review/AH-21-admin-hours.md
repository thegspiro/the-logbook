# Security Review — Admin Hours

**Prefix:** `AH` · **Iteration:** 21 · **Reviewed:** 2026-08-26/27 · **PR:** TBD

**Backend:** `app/api/v1/endpoints/admin_hours.py` (1,052 L, 27 endpoints),
`app/services/admin_hours_service.py` (1,780 L), model `app/models/admin_hours.py`,
schema `app/schemas/admin_hours.py`. Touches `app/services/event_service.py`
(3 call sites threading `organization_id` into a signature change).
**Frontend:** `modules/admin-hours`; not reviewed this pass — backend only,
per rotation scope
**Migrations:** none touched this iteration

---

## Scope

Read in full via three parallel background agents: (A) the endpoint file
end-to-end, (B) the service file's first ~970 lines, (C) the service file's
remaining ~810 lines through EOF. This module is explicitly labeled
HIGH-sensitivity in prior audits — an `admin_hours.manage` holder both logs
their own hours into this pool **and** approves entries from it, so the
self-approval control is the module's core invariant.

Prior context read first: `docs/module-audit/admin-hours.md` (iteration 15)
and `docs/app-review/admin-hours.md` (4 passes, prefix AH2, through
2026-08-09). Both were exhaustive — this pass does not re-derive AH-1
through AH-6, and starts from what grew since 2026-08-09 (endpoint file
+5 L, service file +212 L) plus the one item those passes deliberately left
as a product decision.

## Verified good ✅ (re-confirmed, not re-derived)

- **AH-1** — `create_manual_entry` always starts `PENDING`, rejects a future
  `clock_in_at`/`clock_out_at`, and caps duration at `MAX_MANUAL_ENTRY_MINUTES`
  (24h).
- **AH-2** — `auto_close_stale_sessions` takes an optional `organization_id`;
  the per-org endpoint passes the caller's org, the global scheduled task
  omits it to sweep every org.
- **AH-3** — an auto-approved clock-out stamps `approved_at` (`approved_by`
  stays `None` to denote a system approval).
- **AH-4 / AH-6 (separation of duties)** — the single-entry approve path
  (`approve_or_reject`) still calls `assert_different_person`; `bulk_approve`
  still **skips** (never approves, never aborts the batch) any entry the
  approver owns, tracked via `skipped_self`.
- **AH-5** — `_get_active_session`, `_check_overlap`, and `delete_category`'s
  active-session count all still filter `organization_id`.
- **No impersonation** — `create_manual_entry` sets `user_id` from
  `current_user`, never from the request body; `AdminHoursEntryCreate`
  exposes no `user_id`/`organization_id` field.
- Every client-supplied FK id that gets persisted (`category_id` on
  `clock_in`, `create_manual_entry`, `edit_pending_entry`;
  `admin_hours_category_id` on `create_event_hour_mapping`) is validated
  in-org before storage.
- No SQL injection, no LIKE/ilike anywhere in the module, `SafeCsvWriter`
  used for the entries export (not raw `csv.writer`).

## Findings

### AH-7 — HIGH — `get_user_hours_compliance` resolved a target user with no org filter — ✅ FIXED

**What:** `GET /compliance/{user_id}` restricts **non-admin** callers to
their own id, but any caller holding `admin_hours.manage` /
`compliance.view` / `*` could pass **any** `user_id`, including one from a
different organization. The service then fetched that `User` row
(`select(UserModel).where(UserModel.id == user_id)`, no org filter) and used
its `membership_type`/`positions` to pick a compliance profile from the
**caller's own org**, plus a hours-sum query that also carried no org
filter.
**Where:** `app/services/admin_hours_service.py` — the `User` fetch and the
per-requirement hours-sum query inside `get_user_hours_compliance` (was
unscoped on both).
**Failure scenario:** an officer in Org A with `compliance.view` calls
`GET /compliance/{some-Org-B-user-id}`. The target user's row resolves
regardless of tenant; their `membership_type`/`positions` are matched
against Org A's compliance profiles, and a `category_id` collision (in-org
category ids are UUIDs, so unlikely but not structurally prevented by this
query alone) would sum that user's hours into the response. At minimum this
is a cross-tenant existence/attribute oracle on `User`; independently
identified by two separate review agents (endpoint-side and service-side),
which is why it's rated HIGH despite the hours data itself rarely lining up
in practice — the `User` row and its membership/position data is a real,
reachable cross-tenant read regardless.
**Fix:** both queries now filter `organization_id` — the `User` fetch
directly, and the hours-sum query for defense-in-depth consistency with
every other by-id query in this file (the category id it also filters was
already org-validated earlier in the function, so this one was likely
non-exploitable on its own, but the invariant should hold uniformly).

### AH-8 — LOW — `clock_out` was the one query in this file not yet org-scoped — ✅ FIXED

**What:** `clock_out` filtered only `id` + `user_id` + `status == ACTIVE`,
with no `organization_id` predicate — the exact class of gap AH-5 closed
everywhere else in this module. Not currently exploitable (one org per
user, so `user_id` alone happens to scope correctly), but inconsistent with
the codebase's own stated invariant, and notably: a same-day commit
(`aebfbd84`, part of the apparatus/NFC feature's own review) fixed the
identical shape on the sibling method `clock_out_by_category` and its
commit message explicitly deferred `clock_out` itself "for the Admin Hours
module's own rotation turn" — i.e., this pass.
**Where:** `app/services/admin_hours_service.py` (`clock_out`).
**Fix:** added an `organization_id` parameter, threaded through from
`clock_out_by_category`'s internal call and the endpoint, filtering the
query the same way its sibling already does.

### AH-9 — MED — `update_category` used a blind `setattr` loop — ✅ FIXED

**What:** `for key, value in kwargs.items(): setattr(category, key, value)`.
The method's own docstring already documented the intended behavior
("setting description=None clears it"), but a blind loop applies an
explicit null to **any** field including NOT NULL columns (`name`,
`require_approval`, `is_active`, `sort_order`) — which would reach
`flush()` and raise an unhandled `IntegrityError` (500) instead of a clean 400.
**Where:** `app/services/admin_hours_service.py` (`update_category`).
**Fix:** routed through `apply_updates`, which is the drop-in replacement
for exactly the behavior the docstring already promised — nullable columns
still clear on an explicit null, NOT NULL columns now raise a clean
`ValueError` instead of crashing at flush.

### AH-10 — MED — `clock_in` was a read-then-write race with no lock (Pitfall #27) — ✅ FIXED

**What:** `clock_in` reads `_get_active_session` (a plain SELECT) to check
"no other active session," then inserts a new ACTIVE entry — no row lock
anywhere in between. Two concurrent clock-in requests for the same user
(a double-tap, or two open tabs/devices) could both pass the check and both
insert an ACTIVE row, corrupting the "one active session at a time"
invariant `clock_out`/`get_active_session` depend on.
**Where:** `app/services/admin_hours_service.py` (`clock_in`).
**Fix:** both halves Pitfall #27 requires: locks the caller's own `User`
row first (guaranteed to exist, one per user — the same "lock a guaranteed
parent row" pattern used for SKT-4 in this rotation), then makes the
active-session check itself a locking read (`_get_active_session` gained a
`for_update` parameter, used only here — the plain read path,
`get_active_session`, is unaffected).

### AH-11 — LOW/MED — event-hour-mapping percentage totals could race past 100% — ✅ FIXED (best-effort)

**What:** `create_event_hour_mapping` and `update_event_hour_mapping` each
sum existing active mappings' `percentage` for the same source
(`event_type` or `custom_category`), then write a new/updated percentage —
with no lock on the read. Two concurrent creates/updates for the same
source could both read a total under 100 and jointly exceed it, so more
than 100% of an event's duration gets credited across categories. This is a
data-integrity issue, not a tenant-isolation or auth bypass.
**Where:** `app/services/admin_hours_service.py` (both methods' percentage
sum query).
**Fix:** added `.with_for_update()` to both sum queries. **Residual, stated
plainly:** there is no single row representing "a source" (`event_type` is
a string, not an FK to a lockable row), so this closes the race whenever at
least one mapping for the source already exists — the common case once a
source has any allocation — but does not fully close a race between two
concurrent **first** mappings for a brand-new source. A DB-level unique/
check constraint would close that gap completely; that's a schema decision
left for a future pass, not attempted here.

### AH-12 — LOW — `edit_pending_entry` skipped the guards `create_manual_entry` enforces — ✅ FIXED

**What:** editing a pending entry's times only checked ordering
(`end > start`) and a 1-minute minimum — no future-time rejection, no 24h
cap, and no overlap re-check, even though the entry can be moved just as
freely as the original manual entry could. Prior app-review passes called
this "a parity nit, not a hole" (admin-only surface, entry stays `PENDING`
under the AH-4 approval gate) and left it open; closing it needs no product
decision, just applying the same guards the sibling create path already
has.
**Where:** `app/services/admin_hours_service.py` (`edit_pending_entry`).
**Fix:** added the future check, the `MAX_MANUAL_ENTRY_MINUTES` cap, and an
overlap check via the existing `_check_overlap(..., exclude_entry_id=...)`
(already built for exactly this call, just never wired in).

### AH-13 — LOW — four `datetime.fromisoformat` call sites turned a bad date into a 500 — ✅ FIXED

**What:** `list_my_entries`, `list_all_entries`, `export_entries`, and
`get_summary` all parsed `start_date`/`end_date` query params with a bare
`datetime.fromisoformat(...)`, unguarded by any try/except — a malformed
date string raised an unhandled `ValueError` surfaced as a raw 500. Flagged
by the 2026-08-08 app-review pass as "a module-wide status-code robustness
gap... recorded for a future robustness sweep," not fixed at the time.
**Where:** `app/api/v1/endpoints/admin_hours.py`, all four endpoints.
**Fix:** a small `_parse_optional_date(value, field_name)` helper raises a
clean `HTTPException(400, ...)` on a bad value; all four call sites route
through it.

### AH-14 — LOW — `source_rsvp_id`-keyed queries carried no org filter — ✅ FIXED

**What:** `credit_event_attendance`'s stale-entry cleanup and
idempotency-existence check, and `delete_event_attendance_entries`, all
queried `AdminHoursEntry` by `source_rsvp_id` (and sometimes
`category_id`) with no `organization_id` predicate. `rsvp_id` is always
resolved server-side from an already org-scoped `EventRSVP`/`Event` in
every current caller (confirmed by reading `event_service.py`'s call
sites), so this was not reachable as cross-tenant IDOR from client input —
but it's the same inconsistency-against-the-codebase's-own-invariant class
as AH-5 and AH-8, in code added since the last audit.
**Where:** `app/services/admin_hours_service.py` (`credit_event_attendance`,
`delete_event_attendance_entries`).
**Fix:** added `organization_id` filters to all three queries;
`delete_event_attendance_entries` gained an `organization_id` parameter
(threaded through its two callers in `event_service.py`, one of which —
`_revoke_event_attendance_credit` — also gained the parameter and now
org-scopes its own RSVP lookup via a join to `Event`).

## Confirmed still open — flagged, not fixed (product/design decisions)

- **Per-org SoD toggle (AH-4 refinement)** — re-confirmed unchanged: the
  self-approval guard is unconditional by design; a genuine sole-officer
  department would need a second `admin_hours.manage` holder. Still a
  deliberate product/config decision, not a bug.
- **`credit_event_attendance`'s resync path can grow an already-APPROVED
  entry past its category's auto-approve threshold without re-review.**
  When an event is reopened and an attendee's corrected check-out time
  lengthens their session, the resync update path
  (`credit_event_attendance(resync=True)`) updates `duration_minutes` in
  place on an entry that may already be `APPROVED`, without re-running
  `_determine_post_clockout_status`. The method's own docstring documents
  this as deliberate — status/`approved_by`/`approved_at` are intentionally
  left untouched so a correction doesn't silently revoke an officer's
  already-made review decision — but the flip side is that the same
  mechanism never re-evaluates it either, so an entry can grow past a
  threshold that would have required review had it been that long from the
  start. This is officer/leader-driven (not member self-service), so lower
  severity than a raw self-credit bug, but it's a genuine gap in the
  approval-integrity model that needs a product decision (re-queue for
  review above some growth threshold? leave as-is and rely on the officer
  noticing?), not a unilateral code fix that might contradict the documented
  intent.

## Schema & migration notes

n/a — no model or migration changes this iteration.

## Guard tests added

All in `tests/test_admin_hours_service.py` unless noted:

- `TestClockOutOrgScoped` — `clock_out`'s compiled WHERE clause includes
  `organization_id`.
- `TestClockInLocking` — the User-row lock query and the active-session
  check both render `FOR UPDATE`, against `users` and
  `admin_hours_entries` respectively, in that order.
- `TestUpdateCategoryNullabilityGuard` — `name` (NOT NULL) rejects an
  explicit null; `description` (nullable) still clears.
- `TestEditPendingEntryParityGuards` — an edit that would exceed 24h, land
  in the future, or overlap another entry is now rejected the same as a
  create; the overlap check excludes the entry being edited itself.
- `TestEventHourMappingPercentageLocking` — both `create_event_hour_mapping`
  and `update_event_hour_mapping`'s percentage-sum queries render
  `FOR UPDATE`.
- `TestUserHoursComplianceOrgScoped` — the target-user fetch's compiled
  WHERE clause includes `organization_id`.
- `tests/test_event_attendance_lock.py` — updated the existing
  `delete_event_attendance_entries` call-signature assertion for the new
  `organization_id` argument.

## Completion gate

| Check                                              | Result                  |
| -------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                           | clean                   |
| `black --check` (changed files)                    | clean                   |
| `isort --check-only` (changed files)               | clean                   |
| `python3 scripts/validate_migrations.py --strict`  | PASSED (no migrations)  |
| backend tests, scope (`-k "admin_hours or event"`) | 604 passed, 1 skipped   |
| backend tests, full suite                          | 8845 passed, 22 skipped |
