# Security Review — Feature 31: Scheduled Tasks (pass 12)

**Prefix:** `CRON12` · **Iteration:** 31 (pass 12) · **Reviewed:** 2026-11-04

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(**72 registered tasks, up from 70** — two new runners this pass, both
delegating to other features' own already-reviewed code).
**Frontend:** none — unchanged (`docs/KNOWN_LIMITATIONS.md`'s "Admin — No
Scheduled Tasks Page" entry, owner-accepted 2026-10-05, still describes the
current state).
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

The dedicated `/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
has been unreachable across many consecutive cycles (confirmed via
`ListAgents`, "No reachable agents" each time). PR #4003 (Feature 30,
Onboarding, pass 12) had already merged; a GitHub search for
`is:pr is:open head:claude/security-review` returned zero results, confirming
row 31 as the next `⬜` row on a freshly-pulled `main`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s latest pass, and
pass 11 (`CRON11-31-scheduled-tasks.md`) in full. Every finding pass 11 left
open was re-verified against current code at its current location, not
re-derived.

**Delta-focused, full diff read.** Pass 11's baseline merge is `e67f8521e`
(PR #3857). `git log --oneline e67f8521e..HEAD --no-merges --
backend/app/api/v1/endpoints/scheduled.py backend/app/services/scheduled_tasks.py`
found exactly **3** commits touching either file (`540fabea7`, `c45f5d8b5`,
`4cb2afc77`). `scheduled.py`: zero changes, confirmed by `git diff` (0 lines)
— still 82 L, 2 routes (re-enumerated by AST: `list_scheduled_tasks`,
`run_scheduled_task`), same two permission strings.
`scheduled_tasks.py`: the full unified diff (300 lines) was read in full, not
sampled.

**Two new registered tasks, plus one existing-task fix.** `SCHEDULE` /
`TASK_RUNNERS` re-verified by AST at **72/72** — up from 70, exactly the two
new entries below — and the two sets' keys are identical to each other.

| New/changed task           | What                                                                                                                         | Owning logic (status)                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zeffy_payment_sync`       | New hourly task: read every linked Zeffy campaign's payments                                                                 | `ZeffySyncService` — Feature 22 (Grants & fundraising, pass 13, PR #3962) and Feature 27 (Integrations, pass 12, PR #3996) own scope; reviewed here only for the scheduler-wiring angle |
| `evaluation_due_notices`   | New daily task: evaluation step reminders/overdue notices                                                                    | `EvaluationNoticeService.send_due_notices` — Feature 17/29's own scope; reviewed here only for the scheduler-wiring angle                                                               |
| `inventory_overdue_alerts` | Existing task fixed (CRON-41, already merged): dedupe so a mid-day restart no longer re-sends the day's reminder to everyone | Fix already landed; re-verified against its security properties below                                                                                                                   |

### `zeffy_payment_sync` — wired correctly, no new finding

`run_zeffy_payment_sync` selects `(Integration.id, Integration.organization_id)`
tuples across orgs — filtered to `integration_type == "zeffy"`, `enabled`,
`status == "connected"`, and `Organization.active.isnot(False)` — then, per
target, **re-fetches that one `Integration` row filtered by both its own id
and its own `organization_id`** before calling
`ZeffySyncService(db).sync_integration(integration)`. Neither id is
client-supplied (both come from the loop's own first query), so there is no
IDOR surface here, and the per-target re-fetch (rather than holding the
first query's loaded rows across the loop) is the same "ids, not loaded rows"
pattern pass 11 verified for `weather_alert_poll`, with the same reason
stated in the new code's own comment: a rollback after one org's failure
expires every held instance, and reading an expired one raises
`MissingGreenlet`. Each target commits (success) or rolls back + logs +
`persist_task_error_log(org_id, ...)` (failure) independently, so one
department's revoked API key cannot abort the run for any other department.
The exception log call passes `org_id` as a logger argument, not spliced into
the message (CLAUDE.md Pitfall #33). `TASK_INTERVALS_SECONDS["zeffy_payment_sync"] = 3600`
matches the `SCHEDULE` entry's `35 * * * *` cron comment.

### `evaluation_due_notices` — wired correctly, no new finding

`run_evaluation_due_notices` is a one-line delegate to
`EvaluationNoticeService(db).send_due_notices()`. Read that method and its
`_notify_one` helper in full to verify the two claims this layer cares about
(idempotency and locking), not to re-review the notice content itself (Feature
17/29's scope): `send_due_notices` selects candidate `(step_id, organization_id)`
tuples org-joined through `Organization.active.isnot(False)`, then
`_notify_one` takes a `.with_for_update()` lock on that one step row (scoped
by both `id` and `organization_id`), re-checks `status`/`due_date` under the
lock, and sends only when `reminder_sent_at` or `overdue_notice_sent_at` is
still `None` for that notice kind — each step commits (releasing its lock) or
rolls back on its own, so two concurrent runs cannot both send the same
step's notice, and a crash after sending but before the commit repeats the
notice rather than losing it (the "send, then stamp" ordering CLAUDE.md
Pitfall #36 calls for on a reminder, stated explicitly in the service's own
docstring). Registered daily (`86400`s), matching `SCHEDULE`'s `20 8 * * *`.

### `inventory_overdue_alerts` (CRON-41) — already-landed fix, re-verified good

Before this fix, the task had no sent-log: because the in-process scheduler
keeps its last-run timestamps in memory only, every process restart or deploy
re-ran every task immediately, re-sending the overdue-equipment email to every
member still holding overdue gear, however recently they had already been
reminded. The fix adds a `NotificationLog`-backed sent-log
(`_members_emailed_since`, keyed on `OVERDUE_CHECKOUT_LOG_CATEGORY`) filtered
to `organization_id == str(org.id)` (never a client-supplied value — `org` is
the loop's own current org), computes "today" from
`scheduling_timezone(org)`/`today_in`/`local_day_start_utc` (the org's own
configured timezone, not the server's), and records the log row **after** a
successful send and commits immediately — again "send, then stamp", correct
for a reminder per Pitfall #36. Confirmed `scheduling_timezone`, `today_in`,
and `local_day_start_utc` exist in `app/utils/org_timezone.py` with the
signatures the new code assumes.

## Route inventory

Unchanged since pass 1 — re-confirmed by AST against current `scheduled.py`
(0 diff since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                       |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                          |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **`SCHEDULE`/`TASK_RUNNERS` remain 1:1 (now 72/72)**, re-verified by AST,
  not by eyeballing the registry comment or trusting pass 11's count.
- **`TASK_INTERVALS_SECONDS` is missing one key present in `SCHEDULE`/
  `TASK_RUNNERS` (`scheduled_emails`) — re-confirmed not a new gap.** First
  found and explained at pass 9: `scheduled_emails` is deliberately listed in
  `_MANUAL_ONLY_TASKS` (driven by `main.py`'s `_scheduled_email_loop`
  instead), and `tests/test_scheduled_task_coverage.py` asserts
  `TASK_RUNNERS − TASK_INTERVALS_SECONDS − _MANUAL_ONLY_TASKS == ∅` for
  exactly this class of defect. Ran that file directly this pass — 5/5 still
  pass after the two new tasks were added to all three dicts.
- **Neither new task, nor the `inventory_overdue_alerts` fix, touches
  `main.py` or `app/core/background_claim.py`** — confirmed by the
  path-scoped `git log` above finding zero commits there since pass 11. The
  in-process scheduler's claim-renewal mechanism (app-review CRON-40, ✅
  FIXED 2026-10-04) is unaffected; both new tasks dispatch through the same
  claim-protected `_scheduled_task_loop` every other runner already goes
  through.
- **Neither new task's per-org/per-integration/per-step loop can mix one
  org's or department's data into another's response or email.** Every
  write and read inside `run_zeffy_payment_sync`'s loop body and
  `EvaluationNoticeService._notify_one` filters by the specific
  `organization_id` the outer loop is currently on; nothing passes a bare,
  org-unfiltered id into a by-id lookup (CLAUDE.md Pitfall #14).

## Findings

No new findings this pass.

## Re-confirmed still open, unchanged — not re-applied

Per the rotation's rule against re-reporting a prior pass's considered,
unresolved call:

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list, bypassing `safe_error_detail()`. Already recorded OPEN by
  design in `docs/app-review/scheduled-tasks.md`.
- **CRON-31-7 / CRON-31-8** (app-review, "Re-verified, still open") and **the
  Redis-down fallback failing open** — all three unchanged, none touched by
  this window's diff.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with every pass since —
nothing to update there this pass.

## Schema & migration notes

No new migration touching this feature's own tables this pass;
`scheduled_tasks.py` and `scheduled.py` own no tables directly.

## Guard tests added

None this pass — no new defect found to guard against. Both new delegates'
own idempotency/locking already carry dedicated test coverage from the
commits that introduced them (not added by this review), and
`inventory_overdue_alerts`'s new sent-log is covered by the commit that
fixed CRON-41.

## Completion gate

| Check                                                                      | Result                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)             | ✅ 0 violations                                            |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)    | ✅ clean, 2872 files unchanged                             |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned) | ✅ clean                                                   |
| `python3.13 scripts/validate_migrations.py --strict`                       | ✅ 711 revisions, single head `289504a34d3c`               |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)                  | ✅ 72/72, up from 70                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 298 routes, 0 errors/warnings, unchanged                |
| `python3.13 -m pytest tests/test_scheduled_task_coverage.py -q`            | ✅ 5 passed                                                |
| Scoped `pytest` (scheduled-task/cron + both new delegates)                 | ✅ 170 passed, 1 pre-existing skip (`pywebpush`), 0 failed |
| `cd frontend && npm run typecheck`                                         | n/a — no frontend files touched this pass                  |
| `cd frontend && npm run lint`                                              | n/a — no frontend files touched this pass                  |

Scoped selection: `-k "scheduled_task or cron or scheduler or zeffy_sync or
evaluation_notice or evaluation_due or inventory_overdue or
inventory_low_stock or officer_alert_copies"` against `backend/tests/` —
170 passed, 1 skipped, 27512 deselected in 157.78s.
