# Module Audit — Admin Hours

**Files:** `app/api/v1/endpoints/admin_hours.py` (1,042 L, 27 endpoints),
`app/services/admin_hours_service.py` (1,539 L), model
`app/models/admin_hours.py`, frontend `modules/admin-hours`. A time-clock:
members clock in/out of admin-work categories, create manual entries, officers
approve for compliance credit.
**Audited:** iteration 15 (time-integrity, self-service scoping, tenant
isolation).

## Verified good ✅
- **Auth coverage:** all 27 endpoints authed; writes/approvals require
  `admin_hours.manage`; 11 self-service endpoints use `get_current_user`.
- **Self-service ownership is clean.** `clock_out` (id + user_id + ACTIVE),
  `clock_out_by_category` (category_id + user_id + ACTIVE),
  `get_active_session` / `list_my_entries` (user_id-scoped) — a member cannot
  read or end another member's session by id or category. No member-callable
  entry edit/delete (the only edit is `admin_hours.manage`).
- **Clock integrity:** double clock-in blocked; clock-out duration is computed
  server-side from the stored `clock_in_at` (no client-trusted duration, no
  negative duration).
- **XC-3 clean on approvals/edits:** `approve_or_reject`, `bulk_approve`,
  `edit_pending_entry`, `admin_force_clock_out` all filter `organization_id`.
- **No impersonation:** `create_manual_entry` sets `user_id` from `current_user`;
  `get_user_hours_compliance` forces a non-admin to their own id.
- No raw SQL, no PK-bypass, flake8 clean, no TODO.

## Findings

### AH-1 — HIGH — Members could self-credit *approved* time via `create_manual_entry` — ✅ FIXED
Manual entries carry fully client-supplied `clock_in_at`/`clock_out_at`, but
their status went through the same `_determine_post_clockout_status` as a
server-timed clock-out — so for a `require_approval=False` category (or a
duration under `auto_approve_under_hours`) the entry landed **APPROVED with no
officer review**, feeding straight into compliance credit. Validation gaps
widened it: no max-duration cap (only `< 1 min` rejected) and `clock_out_at` was
never checked against "now" (a single entry could claim thousands of hours);
backdating was unbounded.
**Fix:** manual entries now **always** start `PENDING` (auto-approval is reserved
for server-timed clock-outs); added a `clock_out_at <= now` check and a
24-hour max-duration cap (`MAX_MANUAL_ENTRY_MINUTES`). Behavior change: manual
entries always require officer review. Verified the mock-based service tests
(updated the one that asserted the old auto-approve).

### AH-2 — MEDIUM — `auto_close_stale_sessions` mutated every tenant — ✅ FIXED
The per-org endpoint `POST /close-stale-sessions` (`admin_hours.manage`) called
`auto_close_stale_sessions`, whose query selected ACTIVE entries **across all
organizations** (no org filter) and rewrote their `clock_out_at`/`duration`/
`status`/`description`. An org-A officer could force-close and mutate every other
tenant's live sessions.
**Fix:** added an optional `organization_id` param — the endpoint passes its org
(scoped), and the global scheduled task (`scheduled_tasks.py`) still omits it to
sweep all orgs. No behavior change for the cron.

### AH-3 — LOW — Auto-approved clock-outs left no `approved_at` — ✅ FIXED
When a clock-out auto-approved, the entry was written APPROVED with
`approved_by`/`approved_at` both `None` — an inconsistent audit trail vs
`credit_event_attendance` (which stamps `approved_at`).
**Fix:** stamp `approved_at = now` on auto-approval (`approved_by` stays `None`
to denote a system/auto approval).

### AH-4 — MEDIUM (flagged) — Officers can approve their own entries (no segregation of duties)
`approve_or_reject` / `bulk_approve` don't check `entry.user_id != approver_id`,
so an `admin_hours.manage` holder can create a pending entry, edit its times, and
self-approve. **Why flagged, not auto-fixed:** in small volunteer departments the
only officer legitimately logs and approves their own admin hours, so blocking
self-approval outright could break real workflows. Recommend a configurable
segregation-of-duties toggle (or at least an audit flag on self-approval) — a
product decision.

### AH-5 — LOW (flagged, not exploitable) — Minor scoping omissions
`get_active_session` reads the category by id without an org filter (but only for
the caller's own session); `_check_overlap` filters `user_id` not
`organization_id` (harmless — a user belongs to one org); `delete_category`'s
active-session count omits org (but `category_id` is already validated in-org).
Defense-in-depth only.
