# Security Review — Feature 31: Scheduled Tasks (pass 6)

**Prefix:** `CRON6` · **Iteration:** 31 (pass 6) · **Reviewed:** 2026-10-08

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(grown to **51 registered tasks**, up from pass 5's 47 — `SCHEDULE`/
`TASK_RUNNERS` still exactly 1:1), plus `backend/main.py`'s in-process
scheduler (`_scheduled_task_loop`, `_scheduled_email_loop`,
`_try_claim_background_task`, `_renew_background_task_claim`) and the new
`backend/app/core/background_claim.py`.
**Frontend:** none — unchanged.
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

PR #2996 (Feature 30, Onboarding, pass 6) merged 2026-10-08 10:53 UTC. By
13:46 UTC — nearly 3 hours later, well past this rotation's own documented
~90-minute stall threshold — no `claude/security-review-*` PR or branch
existed for Feature 31 (confirmed via `search_pull_requests`,
`is:open head:claude/security-review-`, and `git branch -r`). The dedicated
`/loop 30m /security-review` session was not running. This iteration picked
up the next `⬜` row from outside that loop.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, all five prior
security-review passes in full (`CRON-31`, `CRON2-31`, `CRON3-31`, `CRON4-31`,
`CRON5-31-scheduled-tasks.md`), and the sibling `docs/app-review/
scheduled-tasks.md` track. Every finding any of these left open was
re-verified against current code at its current location, not re-derived.

**Delta-focused, full diff read.** Pass 5's baseline merge is `09f463f1`
(PR #2899). Diffed `09f463f1..HEAD`: `scheduled.py` — zero changes;
`scheduled_tasks.py` — **+524/−105 lines** (one commit, `ffc8daee`, landed
alongside unrelated member-profile work — read in full regardless of the
commit's own title); `main.py` — **+155/−49 lines**, all of it the CRON-40
fix (see below) plus one unrelated router registration (`mcp_oauth_router`,
out of this feature's scope — Feature 03/Public surface territory).

**CRON-40 (HIGH, flagged by pass 5) is already fixed, independently of this
pass.** PR #2901 ("fix(scheduler): renew the worker claim only while it is
still ours") merged 2026-10-04 17:22 UTC — the exact fix pass 5's findings
file pointed to as unmerged on branch `claude/cron-40-scheduler-claim-cas`.
Read in full against current `main.py` (`_renew_background_task_claim`,
`:1576-1605`; both loops' renewal calls, `:1764-1777` and `:1873-1897`;
`release_claim` at shutdown, `:1937-1947`) and `background_claim.py` (new,
Lua-script CAS renewal). Matches the fix PR's description exactly: renewal is
now conditional on the stored PID, both loops stand down to a claim-waiting
state rather than exiting, the task loop renews mid-batch (not only at the
end), and shutdown releases only the claim this worker holds.
`docs/app-review/scheduled-tasks.md` and `KNOWN_LIMITATIONS.md` both already
show CRON-40 as ✅ Resolved — no update needed either place.

## Route inventory

Unchanged since pass 1 — re-confirmed against current `scheduled.py` (0 diff
since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                               |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                  |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. CRON4-31-1's audit-log-before-run fix present, unchanged. |

## New since pass 5 — reviewed fresh, not spot-checked

**`run_paypal_capture_backfill`** (`scheduled_tasks.py:4336-4393`) — queried
per-integration rather than through `_for_each_org`: `select(Integration)
.join(Organization, ...).where(Integration.integration_type == "paypal",
Integration.enabled.is_(True), Organization.active.isnot(False))`, every id
server-resolved. Reads every integration's org id into a plain tuple
**before** the loop (`targets = [(i, str(i.organization_id)) for i in
integrations]`), correctly avoiding the `MissingGreenlet` lazy-load-after-
rollback trap this file's own established pattern exists to prevent — one
failed integration no longer aborts every integration after it. Each
integration's work is isolated in its own `try`/`except`/rollback.

**`run_self_report_attachment_retention`** (thin wrapper delegating to
`app/services/self_report_attachment_retention.py`, new, 268 L) — reviewed in
full as new infrastructure, not spot-checked:

- Per-org query is org-scoped (`SelfReportConfig.attachment_retention_days
.isnot(None)`, batched per org inside `_sweep_org` with `TrainingSubmission
.organization_id == org_id`).
- **Path confinement on file deletion**: `_org_confined_path` resolves
  `os.path.realpath(file_path)` and requires it start with
  `org_root + os.sep` before any `os.remove()` — `file_path` is
  client-writable through the submission schemas, so without this check a
  crafted attachment record pointing outside the org's own upload directory
  (another org's file, an arbitrary path) would be a path-traversal delete.
  Anything that fails the check is left alone (neither deleted nor stripped
  from the row), which is the fail-safe direction.
  `_strip_records` (dropping the same deleted paths from the member's
  `TrainingRecord.attachments`) is scoped to `TrainingRecord.organization_id
== submission.organization_id AND user_id == submission.submitted_by` —
  correct, since approval copies attachments onto the record of the same
  member in the same org.
- **Locking read** (`.with_for_update()`) on the batch query, holding off a
  concurrent approval reversal that would otherwise un-reject/un-approve a
  submission out from under a delete already in flight.
- **JSON mutation correctness**: `submission.attachments = kept` /
  `record.attachments = kept` followed by `flag_modified(...)` in both
  places (Pitfall #12) — a new list is built, not an in-place edit of the
  existing one.
- **Order of operations is deliberate and stated in the module docstring**:
  unlink the file first, update the database second, so a commit failure
  after a successful unlink is self-healing on the next run (the row still
  names a now-gone file, which the next sweep treats as already removed)
  rather than orphaning a file nothing points at.

**`run_reap_expired_sessions`** (`scheduled_tasks.py:6490-6530`) — deletes
`Session` rows past `REFRESH_TOKEN_EXPIRE_DAYS +
SESSION_RETENTION_DAYS_AFTER_REFRESH_EXPIRY` (30d). Correctly **not**
org-scoped — this is a cross-tenant maintenance sweep with no org-specific
read or response, just deletion of rows whose refresh token is already dead,
so there is no tenant-isolation dimension to apply. Batched
(`_SESSION_REAP_BATCH = 1000`) with a commit per batch, which is the right
shape for a first run against years of accumulated rows on an older
installation.

**`run_notify_expired_passwords`** (`scheduled_tasks.py:6533-6590`) —
org-scoped (`User.organization_id == Organization.id`, `Organization.active
.isnot(False)`). Reads `(User.id, User.organization_id)` tuples before the
per-member loop, not ORM instances, for the same lazy-load-after-rollback
reason as the PayPal backfill above; re-fetches each `User`/`Organization` by
id inside the loop. `password_expiry_notified_at` is set and committed
**per member**, so a notice that goes out is never re-sent because a later
member's notice fails — correct idempotency shape, matches this file's other
per-item-commit tasks.

**`run_salesforce_auto_sync`** refactor — delegates to the new
`run_salesforce_sync()` (owned by the integrations feature, out of this
pass's scope to re-review) and adds `record_integration_run()` on both the
success and failure paths, including an explicit `db.refresh(integration)`
before recording a failure (the ORM instance was expired by the rollback
immediately above it — correct use of the refresh-after-rollback pattern this
file already established elsewhere). `persist_task_error_log` added
alongside, not in place of, the existing Loguru logging.

**`app/core/error_reporting.persist_task_error_log`** (new, consumed from
~14 call sites added across this diff) — reviewed as consumed here, owned by
the Security/audit feature (Feature 28, already ✅). Requires a non-empty
`organization_id` (returns `False` otherwise — fails closed rather than
writing an org-less error row), writes through its **own** session
(`database_manager.get_session()`), not the caller's already-rolled-back
one, and truncates the message to `MAX_ERROR_MESSAGE_LENGTH`. Writes to
`error_logs`, an admin-only internal table (Error Monitoring page, itself
permission-gated under Feature 28) — not returned to any API caller, so this
does not reopen CRON-4's raw-exception-to-caller concern.

## Previously-flagged findings — independently fixed, re-verified, not by this

pass

**CRON2-31-12 (LOW, latent, open since pass 2) — now fixed.**
`run_action_item_reminders`'s both branches (`MeetingActionItem` and the
`minute`-model `ActionItem`) now join to `Organization` and filter
`Organization.active.isnot(False)` (`scheduled_tasks.py:947-957` and
`:1008-1016`), with an explicit in-code citation of this finding
("Both sweeps run platform-wide, so each joins back to its organization and
skips a deactivated one, as the per-org jobs do (CRON2-31-12)"). Verified by
direct read of both query constructions — the `MeetingActionItem` branch
joins `Organization` directly; the minutes branch joins through
`MeetingMinutes` to `Organization`, since `MinutesActionItem` has no direct
org FK. Never previously mirrored into `KNOWN_LIMITATIONS.md` (only
CRON2-31-13 was), so there is nothing to update there.

**CRON-31-7 (the early "sent" stamp, open since pass 2) — now fixed**, and
already recorded as such in `KNOWN_LIMITATIONS.md`'s CRON-31-7/8 entry
("settled on 2026-10-05"). Re-verified directly:
`run_end_of_shift_summary` now tracks `in_app_ok`/`email_ok` per member and
only appends to `newly_sent` when a channel that was actually due actually
succeeded (`if email_ok if email_due else in_app_ok:`,
`scheduled_tasks.py:3144`) — email is the channel of record (Pitfall #18),
so a failed email is retried on the next run inside the lookback window even
though that re-sends the in-app notice, while a member with no email due is
delivered once the in-app notice is durably written. This closes the
specific bug CRON-31-7 flagged (`newly_sent.append(uid)` unconditional after
a per-member send attempt regardless of success).

## Findings — fixed

None by this pass — the two fixes above landed as part of ordinary feature
work, not this review.

## Findings — flagged, not fixed

### CRON2-31-13, CRON-31-8, CRON4-31-2 — re-confirmed still open, unchanged

No new information this pass; not re-applied, per the rotation's rule
against re-reporting a prior pass's considered, unresolved call:

- **CRON2-31-13** — `admin_hours_service.py` still has no `log_audit_event`
  call anywhere (`grep -n "log_audit_event" app/services/admin_hours_
service.py` → no matches). Still the owning feature's design decision.
  Already in `KNOWN_LIMITATIONS.md`.
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by the same explicit design comment
  (`scheduled_tasks.py:1224`). Already in `KNOWN_LIMITATIONS.md`
  (CRON-31-7/8 entry).
- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching, so a manual trigger can still race the in-process scheduler's
  own run of the same task. `scheduled.py` has zero diff since pass 4.

### CRON-4 (app-review, re-verified here) — LOW — raw exception strings

returned to the trigger caller — still open, unchanged

`scheduled.py` is unchanged since pass 4, so this standing app-review finding
(every runner's `str(e)` reaching `POST /run-task`'s response, bypassing
`safe_error_detail()`) is re-confirmed present at the same location. Already
recorded as OPEN by design in `docs/app-review/scheduled-tasks.md` (low
impact — gated behind `system.run_tasks`, the platform's most privileged
principal; the alternative loses the operator's only debugging signal). Not
re-applied here as a new finding.

## Schema & migration notes

No new migration touching this feature's own tables this pass. n/a otherwise.

## Guard tests added

None this pass — no new defect to guard against. The four new tasks already
carry dedicated test coverage added alongside them
(`test_paypal_backfill.py`, `test_reap_expired_sessions.py`,
`test_self_report_attachment_retention.py`, folded into
`test_password_expiry_gate.py`/`test_forgot_password_expiry.py` for the
expired-password notice), all re-run clean below.

## Completion gate

| Check                                                                 | Result                                            |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/`                           | ✅ 0 violations                                   |
| `python3.13 -m black --check app/ tests/ alembic/`                    | ✅ clean (2,043 files unchanged)                  |
| `python3.13 -m isort --check-only app/ tests/ alembic/`               | ✅ clean (isort 9.0.1, CI's pin)                  |
| `python3.13 scripts/validate_migrations.py --strict`                  | ✅ 543 revisions, single head `7db20aa49329`      |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check                   | ✅ 51/51, no drift (up from pass 5's 47)          |
| Scoped `pytest` (21 pre-existing scheduled-task/cron isolation files) | ✅ 243 passed                                     |
| Scoped `pytest` (4 new-task test files)                               | ✅ 48 passed                                      |
| `cd frontend && npm run typecheck`                                    | ✅ 0 errors (no frontend files touched this pass) |
| `cd frontend && npm run lint`                                         | ✅ 0 errors, 0 warnings                           |

Scoped test files (pre-existing): `test_cron_org_loop_isolation.py`,
`test_property_return_reminder_schedule.py`,
`test_property_return_reminder_service.py`, `test_property_return_service.py`,
`test_scheduled_email_active_org.py`, `test_scheduled_email_group_isolation.py`,
`test_scheduled_task_coverage.py`, `test_scheduled_task_manual_trigger_audit.py`,
`test_scheduled_tasks_structure.py`, `test_shift_scheduled_tasks.py`,
`test_inventory_nfc_audit_schedule.py`, `test_pipeline_stage_auto_advance.py`,
`test_message_delivery_claim_recovery.py`, `test_message_delivery_service.py`,
`test_action_item_reminders.py`, `test_rolling_recurrence_extend_isolation.py`,
`test_external_training_auto_sync_isolation.py`, `test_retention_service.py`,
`test_inventory_notification_group_isolation.py`, `test_audit_shipping.py`,
`test_scheduler_claim_renewal.py`. New: `test_paypal_backfill.py`,
`test_reap_expired_sessions.py`, `test_self_report_attachment_retention.py`,
`test_password_expiry_gate.py`.
