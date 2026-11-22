# Security Review — Feature 31: Scheduled Tasks (pass 14)

**Prefix:** `CRON14` · **Iteration:** 31 (pass 14) · **Reviewed:** 2026-11-22

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4, re-confirmed by a 0-line `git diff` against pass
13's baseline), `backend/app/services/scheduled_tasks.py` (**88 registered
tasks, up from 80 at pass 13's merge point** — 8 new runners this pass, all
delegating to other features' own code, plus two genuine in-file changes
reviewed in full below).
**Frontend:** none — unchanged (`docs/KNOWN_LIMITATIONS.md`'s "Admin — No
Scheduled Tasks Page" entry, owner-accepted 2026-10-05, still describes the
current state).
**Migrations:** none new to this feature's own files — see "Schema &
migration notes" for the pre-existing, out-of-scope forked chain this pass's
gate ran into.

---

## Step 0

`list_pull_requests` (state `open`) returned ten open PRs (#4563, #4562,
#4561, #4560, #4551, #4550, #4548, #4545, #4538, #4530) — none with a
`claude/security-review-*` head. PR #4558 (Feature 30, Onboarding, pass 14)
had already merged clean to `main` at `2248da3bf`, confirming row 31
(Scheduled tasks) as the first `⬜` row on a freshly fetched `main`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s latest pass, and
`CRON13-31-scheduled-tasks.md` (pass 13) in full. Every item pass 13 left
open was re-verified against current code at its current location, not
re-derived.

**Baseline:** pass 13's merge commit, `17ffe629a` (PR #4245). `git diff
17ffe629a HEAD -- backend/app/api/v1/endpoints/scheduled.py
backend/app/services/scheduled_tasks.py backend/main.py
backend/app/core/background_claim.py` is the full delta this pass worked
from.

**Eight new registered tasks**, all delegating to another feature's own
already-built service:

| New task                                 | Delegate                                                                        | Owning feature (status)            |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| `leave_ending_reminders`                 | `leave_workflow_notices.send_leave_ending_reminders`                            | Users & organizations (feature 07) |
| `leave_request_upkeep`                   | `leave_workflow_notices.run_request_upkeep`                                     | Users & organizations (feature 07) |
| `open_ended_leave_digest`                | `leave_workflow_notices.send_open_ended_leave_digest`                           | Users & organizations (feature 07) |
| `guest_headcount_reminders`              | `guest_headcount_reminder_service.GuestHeadcountReminderService.send_reminders` | Events & requests (feature 16)     |
| `attendance_waiver_attachment_retention` | `attendance_waiver_attachments.AttendanceWaiverAttachmentService.sweep`         | Training extended (feature 18)     |
| `attendance_waiver_expiry`               | `attendance_waiver_expiry.AttendanceWaiverExpiry.sweep`                         | Training extended (feature 18)     |
| `pending_file_deletions`                 | `pending_file_deletions.PendingFileDeletionSweep.run`                           | Documents & legal (feature 10)     |
| `history_import_expiry`                  | `history_import_service.HistoryImportService.expire_drafts`                     | Integrations (feature 27)          |

Read each delegate's entry point for the two things this layer owns
(idempotency, org-scoping), not the business logic, which belongs to its
owning feature:

- **`leave_ending_reminders` / `leave_request_upkeep` / `open_ended_leave_digest`**
  — `send_leave_ending_reminders` and `send_open_ended_leave_digest` filter
  every query on `organization_id == org_id`; both claim before sending via
  `_claim`, an insert against `LeaveNoticeSend`'s unique `(organization_id,
kind, key)` that catches `IntegrityError` on a repeat — a real
  unique-constraint-backed claim, not a read-then-write check. A failed send
  releases the claim (`_release`) so a later run retries, which is the
  correct trade-off for a reminder (duplicate is a nuisance, not harm;
  CLAUDE.md pitfall #36). `run_request_upkeep` delegates the actual
  settle-on-departed-approver decision to `LeaveRequestService.resettle_pending`,
  which filters `organization_id == org_id` and locks each candidate row
  (`self._get(org_id, request_id, lock=True)`) before deciding it — the
  decision-write locking this layer's own checklist dimension 7 cares about
  is present at the delegate. `_officers` filters `User.is_active`, which is
  `ACTIVE_ACCOUNT_STATUSES` plus `deleted_at IS NULL` (`models/user.py`'s
  hybrid property) — the correct CLAUDE.md pitfall #32 shape, not a literal
  `== ACTIVE` comparison.
- **`guest_headcount_reminders`** — `send_reminders` filters the event query
  on `Event.organization_id == org_id` and combines it with the same
  `outreach_event_clause` the Outreach Impact report uses (pitfall #29, one
  definition of "outreach event" on both sides). Idempotency is a marker
  (`REMINDER_MARKER`) written into `Event.custom_fields` as a freshly-built
  dict (`{**(event.custom_fields or {}), REMINDER_MARKER: True}`) and
  committed with the sends (send-then-stamp, a nuisance-only duplicate on a
  crash) — a brand-new top-level dict object, so this is not the pitfall #12
  shallow-copy shape (nothing nested is mutated in place).
- **`attendance_waiver_attachment_retention` / `attendance_waiver_expiry`** —
  neither goes through `_for_each_org`; each `sweep()` reads its own distinct
  `organization_id` list and commits/rolls back per org inside the loop, so
  one department's failure can't discard another's. `attendance_waiver_expiry`
  locks both the request (`.with_for_update()`) and, where relevant, the
  member row before deciding, and sends its notice only after the expiry is
  committed (stamp-then-send, appropriate here since the alternative —
  sending "your request expired" without a committed expiry — is the harmful
  direction).
- **`pending_file_deletions`** — claims rows with
  `.with_for_update(skip_locked=True)`, so the sweep and the delete endpoint's
  own immediate cleanup attempt can race safely; filtered on
  `organization_id` throughout, one commit per org for the row resolutions and
  their audit record.
- **`history_import_expiry`** — thin `_for_each_org` delegate; its own
  docstring states the idempotency ("an expired draft is no longer a draft,
  so the second run finds nothing to do").

None of the eight takes a client-supplied id anywhere in this file — every id
comes from the loop's own current org or (for the two sweep-style tasks) the
service's own first, org-filtered query. No new `.like()`/`.ilike()`, no new
CSV export, no new raw SQL in this window's diff to any of these.

### Two genuine in-file changes — reviewed in full, no new finding

- **`_run_scheduled_emails_inner`'s CC/BCC merge** now also resolves
  `template.default_cc_position_ids` to addresses via
  `EmailTemplateService.position_holder_emails(item.organization_id, ...)`.
  Read that method in full: it joins `Position`/`user_positions`/`User`
  filtered on `Position.organization_id == organization_id` **and**
  `User.organization_id == organization_id` **and**
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)` — org-scoped on both sides of
  the join, so a stored position id from another org (there is none here;
  `template.default_cc_position_ids` is read from the already org-scoped
  `template`, fetched either by a client-supplied `item.template_id` filtered
  on `EmailTemplate.organization_id == item.organization_id`, or by
  `template_svc.get_template(item.organization_id, ...)`) cannot resolve to
  another org's members. The new `apply_template_copies=False` passed to
  `email_svc.send_email` is honoured by `EmailService.send_email` (guarded by
  `if apply_template_copies and db is not None and template_type`), so the
  merge here is not silently re-applied a second time inside the send layer.
  **Verified good, no finding.**
- **`run_rolling_recurrence_extend`'s cancelled-occurrence fix** — the series
  query now reads every occurrence (cancelled included) to build
  `taken_starts`, and picks `latest` as the newest **non-cancelled** row,
  rather than the previous `LIMIT 1` query that excluded cancelled rows
  entirely from both roles. Read in full: this closes a real idempotency gap
  (CLAUDE.md pitfall #36) — before this change, a cancelled future occurrence's
  date was invisible to `taken_starts`, so a nightly re-run could regenerate a
  live copy on a date the officer had explicitly cancelled, undoing their
  action every night. `child_fields`/`custom_fields` are still built with
  `copy.deepcopy()` (pitfall #12), and the org/timezone resolution
  (`Organization.active.isnot(False)`, per-org `resolve_scheduling_timezone`)
  is unchanged. **Verified good, no finding** — a correctness fix landed by
  this feature's own commit, not by this rotation.

## Route inventory

Unchanged since pass 1 — re-confirmed by a 0-line `git diff` against pass
13's baseline:

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                      |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                         |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | `SYSTEM_RUN_TASKS` resolves to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry; only the global `*` wildcard grants it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **`SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`/`_MANUAL_ONLY_TASKS`
  are fully consistent (88/88/87+1)**, re-verified by `ast.walk` over all
  four dict/set literals (not by trusting a prior pass's count):
  `SCHEDULE − TASK_RUNNERS = ∅`, `TASK_RUNNERS − SCHEDULE = ∅`,
  `(TASK_RUNNERS − TASK_INTERVALS_SECONDS) − _MANUAL_ONLY_TASKS = ∅`,
  `TASK_INTERVALS_SECONDS − TASK_RUNNERS = ∅`. The one manual-only entry
  (`scheduled_emails`) is unchanged.
- **The in-process scheduler's claim-renewal mechanism is unaffected.**
  `git diff 17ffe629a HEAD -- backend/main.py
backend/app/core/background_claim.py` shows only one change — a new
  public router include (`app/api/public/shift_evaluations.py`, Training
  core's own already-reviewed feature, added at pass 15 per `PROGRESS.md`
  row 17) — no change to `_try_claim_background_task`,
  `_renew_background_task_claim`, or `_run_scheduled_task_cycles`. All eight
  new tasks are automatically covered by the renew-per-task loop because
  they are in `TASK_INTERVALS_SECONDS` (confirmed by the registry-consistency
  check above); nothing had to special-case them.
- **None of the eight new tasks' per-org/per-record loops can mix one org's
  data into another's response or email** — every read and write inside each
  new runner's loop body filters by the specific `organization_id` the outer
  loop (or the service's own first query) is currently on.

## Findings

No new defects found this pass.

## Re-confirmed still open, unchanged — not re-applied

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list (8 occurrences of `results.append({"org_id": org_id, "error":
str(e)})` in `_for_each_org`-shaped runners, confirmed unchanged by grep),
  bypassing `safe_error_detail()`. Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`.
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by explicit design comment (confirmed unchanged at
  `scheduled_tasks.py:1882-1888`: `if not recipients: ... reminders_sent ...
continue`).
- **The Redis-down fallback still fails open** — `_try_claim_background_task`
  returns `True` when Redis is unreachable (`main.py:1642`), confirmed
  unchanged by direct read. Unchanged and still the considered trade-off.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with every pass since —
nothing to update there this pass.

## Schema & migration notes

No new migration touching this feature's own files this pass.
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The eight new
tasks' own tables/columns belong to Users & organizations (07), Events &
requests (16), Training extended (18), Documents & legal (10) and
Integrations (27)'s own migrations respectively, reviewed there — this pass
checked only that each one is in fact migration-backed (not a `create_all`-only
addition masquerading as one), out of this feature's scope to verify further.

**`validate_migrations.py --strict` fails on current `main` for a reason
unrelated to this feature.** `main` carries two Alembic heads,
`809893462b67` (PR #4542, ADV2-10) and `dd939b45d6c0` (the merge revision from
PR #4557). PR #4560 (open, not yet merged as of this pass) already carries an
empty merge revision (`561a3e9f4165`) joining exactly this pair; duplicating
it here would only add a third fork, so it is left to that PR, the same
precedent PR #4553 set for an identical situation at pass 14 of Feature 28.
This fork is also the root cause of four scoped-suite test failures below —
none in this feature's own code.

## Guard tests added

None this pass — no new defect found to guard against. Each new delegate's
own idempotency/locking already carries dedicated test coverage from the
commit that introduced it, not added by this review.

## Completion gate

| Check                                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.5.0 in this sandbox; CI pins 7.4.1) | ✅ 0 violations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `black --check app/ tests/ alembic/` (26.10.1, CI-pinned)            | ✅ clean, 3,419 files unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)         | ✅ clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `python3.13 scripts/validate_migrations.py --strict`                 | ❌ FAILED — pre-existing fork on `main`, already owned by open PR #4560 (see above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)            | ✅ 88/88, up from 80                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `python3 scripts/check_route_permissions.py --strict` (repo root)    | ✅ 338 routes, 0 errors/warnings, unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Scoped `pytest` (scheduled-task/cron + all eight new delegates)      | ⚠️ 738 passed, 4 failed, 1 pre-existing skip (`pywebpush`) — all 4 failures are `Unknown column 'prospective_members.identity_edited_by_applicant_at'`, the same forked-migration root cause above (PR #4542's column never applied because the chain won't run to a single head); none of the 4 failing tests is in this feature's own files or delegates (`test_attendance_waiver_attachments.py::TestMemberData`, `test_attendance_waiver_member_data.py` ×2 — all three are member-anonymization tests, not the retention sweep itself; `test_google_workspace_provisioning.py::TestSuspensionSweep` — Integrations' own suspension sweep) |
| `cd frontend && npm run typecheck`                                   | ✅ 0 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `cd frontend && npm run lint`                                        | ✅ 0 errors/warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Scoped selection: `-k "scheduled_task or cron or scheduler or leave_workflow
or leave_request or guest_headcount or attendance_waiver or
pending_file_deletion or history_import_expiry or rolling_recurrence"`
against `backend/tests/` — 738 passed, 4 failed, 1 skipped, 31976 deselected
in 183.94s.
