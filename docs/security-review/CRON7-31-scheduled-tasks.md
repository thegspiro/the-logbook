# Security Review — Feature 31: Scheduled Tasks (pass 7)

**Prefix:** `CRON7` · **Iteration:** 31 (pass 7) · **Reviewed:** 2026-10-17

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py` (grown
to **65 registered tasks**, up from pass 6's 51 — `SCHEDULE`/`TASK_RUNNERS`
still exactly 1:1), plus the `_for_each_org` helper and 14 newly-registered
task runners delegating into 8 new, not-previously-reviewed service modules.
`backend/main.py`'s scheduler loops (`_scheduled_task_loop`,
`_scheduled_email_loop`, claim renewal) are **unchanged** this pass — the
`main.py` diff since pass 6 is schema-repair DDL and Alembic duplicate-
revision handling (Core infrastructure, Feature 33) plus startup audit-chain
sealing (Security/audit, Feature 28), both out of this feature's scope.
**Frontend:** none — unchanged.
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

PR #3381 (Feature 30, Onboarding, pass 7) merged 2026-10-17 ~20:45 UTC. No
`claude/security-review-*` PR or branch existed for Feature 31 at the time
this iteration started (confirmed via `list_pull_requests` — the four open
PRs at the time, #3383/#3382/#3378/#3344, are all unrelated feature work).
The dedicated `/loop 30m /security-review` session this rotation depends on
was not reachable. This iteration picked up the next `⬜` row from outside
that loop, per `docs/security-review/PROGRESS.md`'s row 31.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, all six prior
security-review passes in full (`CRON-31`, `CRON2-31` … `CRON6-31`), and the
sibling `docs/app-review/scheduled-tasks.md` track (pass 5, CRON-40). Every
finding any of these left open was re-verified against current code at its
current location, not re-derived.

**Delta-focused, full diff read.** Pass 6's baseline merge is `c2fc7935`
(PR #3005, 2026-10-08). Diffed `c2fc7935..HEAD` (2026-10-17): `scheduled.py`
— zero changes; `scheduled_tasks.py` — **+1075/−202 lines**; `main.py` —
schema-repair and audit-sealing changes outside this feature's two owned
files, not re-reviewed here (see Backend line above).

**14 new task runners, delegating to 10 new service modules.** Checked each
new module's first-added commit date against the most recent security-review
pass of the feature that owns it, to avoid re-reviewing what another pass
already covered:

| New runner                          | Delegates to                                    | Owning feature (status)                                                                                                                 |
| ----------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `program_requirement_deadlines`     | `program_requirement_deadlines.py` (new)        | Training core/extended (✅) — read in full, this pass                                                                                   |
| `minutes_action_item_reminders`     | `minutes_reminder_service.py` (new)             | Meetings & minutes (✅) — read in full, this pass                                                                                       |
| `admin_only_folder_digest`          | `admin_only_folder_digest.py` (new)             | Documents & legal (✅) — read in full, this pass                                                                                        |
| `membership_auto_purge`             | `membership_pipeline_service.py` (existing)     | Membership pipeline (✅) — new entry point only, read in full                                                                           |
| `audit_chain_seal`                  | `app.core.audit.audit_logger` (existing)        | Security, audit & IP (✅) — new entry point only, read in full                                                                          |
| `retry_message_deliveries`          | `message_delivery_service.py` (existing)        | Messaging & notifications (✅) — new entry point only, read in full                                                                     |
| `compliance_member_notices`         | `compliance_member_notices.py` (new)            | Compliance (✅) — read in full, this pass                                                                                               |
| `saved_report_delivery`             | `saved_report_schedule.py` (new)                | Reports & analytics (✅) — read in full, this pass                                                                                      |
| `google_workspace_attention_digest` | `google_workspace_attention_digest.py`          | Integrations — **already reviewed in INT-27 pass 7** (PR #3375, merged 2026-10-17 11:56 UTC, after this file's last edit) — not re-read |
| `google_workspace_suspension_sync`  | `directory_account_service.py`                  | Integrations — **already reviewed in INT-27 pass 7**, same PR — not re-read                                                             |
| `budget_request_reminders`          | `finance_budget_request_notifications.py` (new) | Finance & approvals (✅) — read in full, this pass                                                                                      |
| `grant_reminders`                   | `grant_reminder_notifications.py` (new)         | Grants & fundraising (✅) — read in full, this pass                                                                                     |
| `prune_public_portal_access_log`    | inline (new)                                    | Public surface (✅) — platform-wide maintenance sweep, read in full                                                                     |
| `calendar_sync`                     | `calendar_sync_service.py` (new)                | Integrations (✅) — read in full, this pass (not covered by INT-27, which named only the Google Workspace files)                        |

Verified the two Integrations-owned files were last touched (`04:48` and
`23:40` UTC on 2026-10-16/17) before INT-27 pass 7 merged (`11:56` UTC
2026-10-17) — git log on both files — so that pass's review covers their
current state and re-reading here would be a duplicate, not additional
coverage.

## Route inventory

Unchanged since pass 1 — re-confirmed against current `scheduled.py` (0 diff
since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                               |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                  |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. CRON4-31-1's audit-log-before-run fix present, unchanged. |

## Verified good ✅

- **`_for_each_org`'s MissingGreenlet fix is correct and closes a real,
  previously-latent class of bug across every caller.** A per-org rollback
  (after one org's exception) expires every `Organization` instance the
  session holds; touching an expired attribute outside an `await` on an
  `AsyncSession` raises `MissingGreenlet` from a lazy-load attempt, which
  would have turned "one bad org" into "every org after it also fails" —
  the exact self-concealing shape CRON-1 fixed for commits, now fixed for
  reads. The shared helper gained `_refresh_if_expired` (refreshes a stale
  `Organization` row at the top of the per-org `try`, tolerant of its own
  failure) and 9 of the file's other inline org-loops (`run_event_reminders`,
  `run_post_event_validation`, `run_post_shift_validation`,
  `run_shift_reminders`, `run_end_of_shift_summary`,
  `run_trainee_report_escalation`, `run_series_end_reminders`,
  `run_shift_auto_checkout`, `run_event_request_reminders`) now capture each
  org's id into a plain `str` **before** the loop and call the same refresh,
  mirroring the pattern pass 6 already verified for `run_paypal_capture_
backfill`. `run_salesforce_auto_sync` and the new `run_calendar_sync` apply
  the id-capture half of the same fix to `Integration` rows for the identical
  reason.
- **Every new per-org task runner is correctly org-scoped.** Read in full:
  `program_requirement_deadlines.py` (every query filters
  `organization_id`/joins through an org-scoped parent — `ProgramRequirement`
  has no org column and is reached only through `TrainingProgram.
organization_id`, matching #14's parent-resolution shape), `minutes_
reminder_service.py`, `admin_only_folder_digest.py` (delegates `org_id` into
  `DocumentsService`, no re-derivation), `compliance_member_notices.py`,
  `finance_budget_request_notifications.py`, `grant_reminder_notifications.py`
  — each entry point takes the already-org-scoped `Organization` row
  `_for_each_org` hands it and threads `org_id` through every query.
  `prune_public_portal_access_log` is correctly **not** org-scoped (a
  cross-tenant retention sweep with no per-org read or response, same shape
  as pass 6's `run_reap_expired_sessions`), batched by primary key
  (`_ACCESS_LOG_PRUNE_BATCH = 1000`) with a commit per batch.
- **The scheduled saved-report sender's PII gate is real and checked twice.**
  `saved_report_schedule.py`'s `PII_REPORT_PERMISSIONS` map is the same one
  the save endpoints validate against (not a duplicate — the module docstring
  names this as the point), and `send_due_saved_reports` re-checks both
  halves on every run, not only at save time: the schedule's owner must still
  hold the report's permission (`_owner_may_run`, else the schedule is
  skipped and logged rather than silently sent) and every recipient must
  still be an active member holding it (`disallowed_pii_recipients`, dropping
  only the disallowed addresses rather than refusing the whole send). The
  email itself carries only top-level counts (`_numeric_summary` reads only
  top-level `int`/`float` values, explicitly excluding anything nested) and a
  link — no member-level row ever reaches the message body, which is the
  control that makes sending a PII report to an external address (allowed for
  non-PII types) safe by construction rather than by permission check alone.
- **Money is `Decimal` throughout the two new finance-adjacent reminder
  modules.** `finance_budget_request_notifications.py` and `grant_reminder_
notifications.py` both quantize every emailed amount through a shared
  `money()` helper (`Decimal(value or 0).quantize(Decimal("0.01"))`) rather
  than formatting a `float`, avoiding the FIN-7/LIFE-1/CRON-6 float-precision
  class in money shown to a member.
- **User-supplied and officer-entered free text is `html.escape`d at every
  new email call site** checked — action-item descriptions and minutes
  titles (`minutes_reminder_service.py`), folder names (`admin_only_folder_
digest.py`), requirement and program names (`program_requirement_
deadlines.py`), saved-report names and titles (`saved_report_schedule.py`).
- **`run_calendar_sync` reuses the existing SSRF-pinned transport, not a new
  HTTP path.** `GoogleCalendarService` and `OutlookCalendarService` (the two
  connectors `default_service_factory` returns) both default their
  `client_factory` to `create_integration_client` — confirmed by reading
  both modules' own INT-9 comments, which flag Google's httplib2 token-
  refresh call as the one documented exception to that factory, already a
  standing, previously-flagged item outside this feature's scope. The
  reconciler's `calendar_id` is an opaque provider-assigned id passed to that
  fixed client, not a value used to construct an arbitrary outbound URL, so
  the "re-validate a stored outbound URL at send time" checklist item does
  not apply to it the way it would to a webhook URL.
- **`CRON2-31-13` (admin-hours auto-close has no audit trail, open since
  pass 2) is now independently fixed**, not by this pass. `admin_hours_
service.py`'s `auto_close_stale_sessions` now calls a new `_audit_
auto_closed` helper (`admin_hours_service.py:1566-1597`, added 2026-10-14,
  `265a26be`) that writes `admin_hours.session_auto_closed` with
  `trigger="scheduled"`/`"manual"`, org-scoped (`organization_id=str(entry.
organization_id)`), one event per closed entry. Verified by direct read of
  the call site (`scheduled_tasks.py:7067-7079`'s `run_admin_hours_auto_
close` → `AdminHoursService.auto_close_stale_sessions` → `self.db.flush()`
  then `self._audit_auto_closed(...)` when any entry closed) and the audit
  call itself. `KNOWN_LIMITATIONS.md` never carried this item (only
  CRON-31-7/8 were mirrored there), so there is nothing to update there.
- **Registry symmetry holds.** `SCHEDULE` and `TASK_RUNNERS` both list the
  same 65 task ids (14 new since pass 6's 51); `TASK_INTERVALS_SECONDS`
  carries a matching entry for every non-manual-only task, each with a
  comment stating the idempotency mechanism (a sent-log, a `next_run_date`
  advance, or a per-row retry schedule) that makes running it more than once
  a day safe. Cross-checked by direct read of all three dicts' diffs; the
  file's own coverage test (`test_scheduled_task_coverage.py`, unchanged)
  enforces this mechanically.

## Findings

No new findings this pass. The two defects this diff fixed as part of
ordinary feature work (not findings of this review) are the `_for_each_org`
MissingGreenlet class above and CRON2-31-13, both recorded under "Verified
good" since this pass neither discovered nor applied them.

## Re-confirmed still open, unchanged — not re-applied

Per the rotation's rule against re-reporting a prior pass's considered,
unresolved call:

- **CRON-31-8** — `run_event_reminders` still marks all due intervals as
  sent when an event has zero recipients
  (`scheduled_tasks.py:1525-1531`, `"Mark all due intervals as sent to avoid
re-processing"`), by the same explicit design comment as pass 6. Already in
  `KNOWN_LIMITATIONS.md` (CRON-31-7/8 entry).
- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4), so a manual trigger can
  still race the in-process scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from every runner still reaches
  `POST /run-task`'s response, bypassing `safe_error_detail()`
  (`scheduled.py`, 0 diff since pass 4). Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`.

## Schema & migration notes

No new migration touching this feature's own tables this pass; `scheduled_
tasks.py` and `scheduled.py` own no tables directly. The new delegated
service modules' own tables (`program_requirements`'s three columns,
`calendar_sync_mappings`, etc.) belong to their owning features' migrations,
out of this pass's scope to re-verify.

## Guard tests added

None this pass — no new defect found to guard against. The `_for_each_org`
fix and the 14 new runners each carry their own dedicated test coverage
added alongside them in the same commits (not written by this review).

## Completion gate

| Check                                                     | Result                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8==7.3.0 app/ tests/ alembic/`                      | ✅ 0 violations                                            |
| `black==26.5.1 --check app/ tests/ alembic/`              | ✅ clean (2,423 files unchanged)                           |
| `isort==9.0.1 --check-only app/ tests/ alembic/`          | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`         | ✅ 618 revisions, single head `1117b642643b`               |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check       | ✅ 65/65, no drift (up from pass 6's 51)                   |
| Scoped `pytest` (scheduled-task/cron + new-runner suites) | ✅ 708 passed, 1 skipped (optional `pywebpush`, unrelated) |
| `cd frontend && npm run typecheck`                        | n/a — no frontend files touched this pass                  |
| `cd frontend && npm run lint`                             | n/a — no frontend files touched this pass                  |

Scoped selection: `-k "scheduled_task or cron or scheduler or property_return
or action_item_reminders or admin_hours or minutes_reminder or
program_requirement or compliance_member_notices or saved_report_schedule or
budget_request or grant_reminder or calendar_sync or google_workspace_
attention or directory_account or retry_message_deliveries or
audit_chain_seal or prune_public_portal"` against `backend/tests/` —
708 passed, 1 skipped, 20856 deselected, 228.75s.
