# Security Review — Feature 31: Scheduled Tasks (pass 4)

**Prefix:** `CRON4` · **Iteration:** 31 (pass 4) · **Reviewed:** 2026-09-13

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (58 L → 82 L, 2
routes), `backend/app/services/scheduled_tasks.py` (6,084 L, still 44 task
runners), plus `backend/main.py`'s in-process scheduler
(`_scheduled_task_loop`, `_scheduled_email_loop`, `_try_claim_background_task`)
re-checked for regression since pass 3.
**Frontend:** none — unchanged.
**Migrations:** none touched or needed this pass.

---

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, then all three prior
passes in full — `CRON2-31-scheduled-tasks.md` (pass 1, PR #1915, findings
CRON2-31-1 through 13), `CRON-31-scheduled-tasks.md` (pass 2, PR #2095,
findings CRON-31-1 through 8, plus the in-process scheduler), and
`CRON3-31-scheduled-tasks.md` (pass 3, PR #2362, findings CRON3-31-1/2). No
`docs/module-audit/` doc exists for this feature.

**Delta-focused, per the established convention.** Pass 3's merge commit for
the target files is `ff8cf35c0` (PR #2362). Diffed `ff8cf35c0..HEAD`:
`scheduled.py` — zero changes; `scheduled_tasks.py` — +18/−3 lines, entirely
from an **unrelated app-review pass** (`ac9990d0c`, "Close seven
email-configuration gaps found in review") that:

1. Closed the exact CRON2-31-11/CRON-31-5/CRON3-31-1 shape in
   `_run_scheduled_emails_inner` (`scheduled_tasks.py:3517-3542`) — joined
   `Organization`, filtered `.isnot(False)`. This is a fourth sibling of the
   same gap, on the scheduled-**email** table rather than the scheduled-
   **message** table CRON3-31-1 fixed; it was outside this rotation's own
   findings but is the same invariant this file now enforces in every
   org-spanning query. Read in full and verified correct: the filter matches
   the file's existing idiom exactly, and a new test
   (`tests/test_scheduled_email_active_org.py`, not written by this rotation)
   exercises it — run and confirmed passing.
2. Replaced a direct `(org.settings or {}).get("email_service", {}).get(...)`
   read with `stored_email_section(org.settings).get("enabled")`
   (`app/utils/email_providers.py:91-106`, new helper) — settles the same
   "settings.email_service can be an explicit `null`" shape CLAUDE.md pitfall
   #1's `apply_updates`/`blankToNull` family exists for, on the read side.
   Read the helper in full: it type-guards with `isinstance(..., Mapping)`
   before indexing, so a `None`/non-dict `email_service` section degrades to
   `{}` rather than raising `AttributeError` mid-task (which, before this
   helper existed, would have hit the same per-org `try/except` isolation
   this file already has and merely counted as one org's failure — not a
   security issue, but confirmed this is a strict improvement, not a
   behavior change to re-verify).

Both are correct, already tested outside this rotation, and required no
further action here beyond re-verification.

Also confirmed no drift in `main.py`'s scheduler
(`git diff --stat ff8cf35c0..HEAD -- backend/main.py` — empty) and no changes
to `message_delivery_service.py`, `retention_service.py`,
`inventory_notification_service.py`, or
`integration_services/salesforce_service.py` (the four service dependencies
pass 2/3 brought into scope).

**Every prior finding (CRON2-31-1 through 13, CRON-31-1 through 8, CRON3-31-1
and 2) was re-verified against current code**, not re-derived:

- Registry sync: `set(SCHEDULE) == set(TASK_RUNNERS)` → **44/44**, every
  `TASK_RUNNERS` key present in `TASK_INTERVALS_SECONDS` or
  `_MANUAL_ONLY_TASKS` — checked via a direct Python import, not by reading
  the dict literals.
- `grep -rn "\.active = False"` across `app/` — still zero matches outside
  this file's own comments. Every "latent, no live exposure today" framing
  in all three prior passes still holds: no org-deactivation flow exists yet.
- `_for_each_org`'s org-active filter, per-org commit/rollback, and error
  collection (`scheduled_tasks.py:517-553`) — unchanged, still the shape
  documented in pass 1.
- `run_recover_stranded_message_deliveries` (CRON3-31-1's fix) —
  `scheduled_tasks.py:3896-4097` — read in full; the `Organization` join,
  `.isnot(False)`/`.is_(False)` filters, and per-message `try/except` with
  rollback are all present and unchanged.
- `run_publish_scheduled_messages`'s `with_for_update(skip_locked=True,
of=DepartmentMessage)` (CRON3-31-1's other fix) — present, unchanged.
- `system.run_tasks` (`app/core/permissions.py:461`) — still granted to no
  `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry; only the wildcard `"*"`
  resolves it (`grep -n '"system\.'` finds only the one declaration line).
- The in-process scheduler's single-worker lease (`main.py:1544-1556`,
  `1721-1801`) and its Redis-down fail-open fallback — unchanged, same
  accepted trade-off as pass 2/3.

**Not re-read line-by-line this pass:** the ~5,900 lines of
`scheduled_tasks.py` outside the diff above and outside what re-verifying
prior findings required touching. Pass 2 did the full line-by-line read;
this pass (like pass 3) trusts that read for unchanged code and applies its
own scrutiny to what changed, plus a fresh look at the one file/endpoint no
prior pass gave full-file attention: `scheduled.py` itself (58 lines; all
three prior passes covered its two routes' auth/permission shape but not its
audit-logging posture — see finding below).

## Route inventory

Unchanged permission/tenancy shape since pass 1 (re-confirmed against
current `scheduled.py`):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                         |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing, no data)        | Lists `SCHEDULE` entries verbatim. No change this pass.                                                                       |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Wildcard-only (`it_manager`/System Owner), re-verified. **Now logs an audit event before running the task — see CRON4-31-1.** |

## Findings — fixed

### CRON4-31-1 — LOW — `POST /run-task` had no audit trail for a platform-wide, System-Owner-only action — ✅ FIXED

**What:** `run_scheduled_task` called `TASK_RUNNERS[task](db)` directly with
no `log_audit_event()` call anywhere on the path. Every one of the 44 task
runners it can dispatch to iterates **every organization on the platform**
(that is the entire reason the endpoint is gated to the wildcard
`system.run_tasks` rather than a single-org permission), and several have
real side effects at that scale: `retention_enforcement` deletes rows
org-wide, `publish_scheduled_messages`/`recover_stranded_message_deliveries`
send department messages, `mark_overdue_dues`/`admin_hours_auto_close` change
money-adjacent and paid-hours state. None of that left any record of _who_
triggered it or _when_ — the audit log has an entry for a chief updating
three metric slots (`admin_hub.py`) but none for a System Owner manually
firing a platform-wide send. This is exactly the pattern CLAUDE.md's Backend
Patterns section names ("Audit-sensitive operations should call
`log_audit_event()`") and every comparable privileged-admin-action endpoint
in this codebase follows; `scheduled.py` was the outlier, not a considered
exception — no prior pass (CRON2-31 through CRON3-31, or the app-review pass)
discusses or accepts this gap, it was simply never in scope until this pass
gave the endpoint file itself full attention.

**Where:** `app/api/v1/endpoints/scheduled.py`, `run_scheduled_task`.

**Impact:** LOW, not MED/HIGH — the endpoint is already about as narrowly
gated as this codebase gets (only the wildcard System Owner resolves
`system.run_tasks`; see the route inventory above and CRON-31/CRON3-31's
independent re-verification that no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS`
entry grants it). The gap is pure accountability/forensics, not access
control: without an audit trail, a compromised or careless System Owner
account's manual task runs (e.g. triggering `retention_enforcement` off-cycle,
or replaying `publish_scheduled_messages` to force a resend) are
indistinguishable after the fact from the task's own normal automated
schedule, which matters for exactly this kind of platform-wide action.

**Fix:** added a `log_audit_event()` call (`event_type
"scheduled_task.manual_trigger"`, `event_category "administration"`,
`event_data={"task": task}`, caller's `user_id`/`username`, and `ip_address`
via `get_client_ip(request)`) immediately before invoking the runner, **plus
an explicit `await db.commit()` right after it**. The commit placement is
deliberate and is itself a small correctness fix, not decoration:
`log_audit_event()` only opens a nested `SAVEPOINT`
(`audit.py`'s `create_log_entry`, `async with db.begin_nested()`), and
`get_db`'s request-scoped session (`database.py`'s `get_session`) commits
once at the very end of a successful request — or rolls back the _entire_
session, audit entry included, the moment the handler raises
(`except Exception: await session.rollback(); raise`). Every task runner in
this file already contains an org loop that can itself raise past its own
per-org guard in the unlikely case of a bug in the initial query or in code
outside a runner's own `try/except`, and several runners' own doc comments
describe exactly this "recorded before the thing that might fail" pattern
(`needs_refresh`, per-org commit/rollback) as the standing convention here —
without the explicit commit, an audit record for a manually-triggered
platform-wide action could be silently discarded by the very failure it
would be most useful for investigating. Logging first (rather than after the
runner returns) means the attempt is on record even when the runner never
returns at all.

**Verified:** `tests/test_scheduled_task_manual_trigger_audit.py`, 3 new
tests, all verified to **fail** against the pre-fix code (a plain
`TypeError: run_scheduled_task() got an unexpected keyword argument
'request'` — confirming the tests actually exercise the new code path, not
just the assertion) and **pass** after:

- `test_a_successful_run_is_logged_with_the_caller_and_task` — a normal
  manual run leaves exactly one matching `AuditLog` row, with the caller's
  id/username and `event_category="administration"`.
- `test_a_runner_that_raises_does_not_erase_the_audit_record` — the specific
  regression this fix's commit placement guards against: a task runner
  monkeypatched to raise still leaves the audit row behind, proving the
  `await db.commit()` (not just the `log_audit_event()` call) is load-bearing.
- `test_an_unknown_task_is_rejected_before_anything_is_logged` — an unknown
  task id 400s before any audit row is written (the existing validation order
  was preserved, not moved).

## Findings — flagged, not fixed

### CRON4-31-2 — LOW — the manual `/run-task` endpoint has no per-task lock, so it can race the in-process scheduler's own run of the same task

**What:** pass 2 named the in-process scheduler's single-worker Redis lease
(`main.py`'s `_try_claim_background_task`/`_scheduled_task_loop`) "a real
overlap guard" because it stops the _same_ task from overlapping _itself_
across workers — one worker holds the lease, runs every due task
sequentially, and no other worker's loop is active concurrently. That
analysis is still correct as far as it goes, but it only covers the
automated path. `POST /run-task` takes no lease, lock, or lock-equivalent of
any kind before calling `TASK_RUNNERS[task](db)` — any worker can serve it at
any time, including the same instant the leader worker's own loop is
mid-way through that exact task.

**Where:** `app/api/v1/endpoints/scheduled.py`, `run_scheduled_task` (no
change made here — this is the same call site CRON4-31-1 added logging to,
immediately below it).

**Why this is not a new risk class, and why it is still worth naming
explicitly:** this is not a fresh discovery so much as a previously
unnamed instance of a risk class the app-review pass already flagged and the
project already accepted: "No overlap guard... The dedup flags make
double-sending unlikely, but they are read-then-write with no lock, so
concurrent runs are a real (if narrow) double-send window" (future
development #2, `docs/app-review/scheduled-tasks.md`). Pass 2's in-process
scheduler review closed the auto-loop's own self-overlap instance of that
risk and, in doing so, implicitly narrowed the accepted trade-off's scope
without saying so — the "considered, accepted" framing every later pass
re-confirms is about the Redis-down fallback specifically, and none of the
three prior passes state that a _manually triggered_ run is covered by, or
excluded from, that same acceptance. Concretely, the exposure splits into
two shapes depending on the runner:

- **Runners already backed by a DB-level claim** —
  `run_publish_scheduled_messages`'s and (since CRON3-31-1)
  `run_recover_stranded_message_deliveries`'s
  `with_for_update(skip_locked=True)` claims, and similar patterns elsewhere
  in the backend (`admin_hours_service.py`, `equipment_check_service.py`,
  `training_program_service.py`, per CRON3-31-1's own citation) — are safe
  under this race by construction: two concurrent callers claiming the same
  row set simply partition it, per Pitfall #27's row-locking pattern. No
  action needed for these.
- **Runners that rely only on an in-memory or flag-based dedup check** (the
  majority of the 44 — e.g. `run_shift_reminders`'s `start_reminder_sent`,
  `run_event_reminders`'s per-interval "sent" stamp, `run_end_of_shift_
summary`'s `newly_sent` list) read "not yet sent" and write "sent" with no
  row lock between the two. A manual trigger landing mid-cycle with the
  auto-loop's own run of the same task can therefore double-send exactly the
  way two racing auto-loop workers could during a Redis outage — the
  narrow, low-severity risk the app-review pass already accepted for a
  volunteer department's reminder emails, just reachable through one more
  door than previously enumerated.

**Impact:** LOW, unchanged in kind from the already-accepted risk — a
duplicate reminder/notification, not data loss or a security boundary
crossing, and only reachable by the same wildcard System Owner who already
has unrestricted platform access. Requires a System Owner to manually
trigger a task at the same moment the scheduler's own automatic run of it is
in flight, which is an operational edge case (deliberate ops action colliding
with routine automation) rather than something an attacker can force.

**Why flagged rather than fixed:** closing this properly means a lock that
is _shared_ between the auto-loop's dispatch (`main.py`) and the manual
endpoint's dispatch (`scheduled.py`) — a per-task-execution lock held for the
duration of the run, not the auto-loop's existing per-leader startup lease,
which only ever governed which worker owns the loop, not which invocations of
an individual task may run concurrently. That is a small locking primitive
change touching two files and the shared dispatch contract between them, is
exactly the kind of thing this rotation's own convention (see `audit.py`'s
SEC2-28-10 precedent) treats as needing an owner decision rather than a
drive-by fix in a review pass — particularly given the acceptable-severity
call the project has already made twice for the same risk class (app-review's
original finding, and pass 2's explicit "residual risk, not fixed" framing
of the Redis-down fallback). Recorded here so the next pass (or whoever
revisits the accepted-risk list) has the manual-trigger door named alongside
the other two.

## Schema & migration notes

No model or migration touched this pass. n/a.

## Guard tests added

`backend/tests/test_scheduled_task_manual_trigger_audit.py` — 3 tests, all
marked `integration` (uses `db_session`, per CLAUDE.md pitfall #30b), all
independently verified to fail against the pre-fix `scheduled.py` and pass
after (see CRON4-31-1 for the specific failure mode each one guards against).

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                 | Result                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/api/v1/endpoints/scheduled.py tests/test_scheduled_task_manual_trigger_audit.py`                                                                                                                                                                                                                                          | ✅ 0 violations                                   |
| `black --check app/api/v1/endpoints/scheduled.py tests/test_scheduled_task_manual_trigger_audit.py`                                                                                                                                                                                                                                   | ✅ clean                                          |
| `isort --check-only app/api/v1/endpoints/scheduled.py tests/test_scheduled_task_manual_trigger_audit.py`                                                                                                                                                                                                                              | ✅ clean                                          |
| `pytest tests/test_scheduled_task_manual_trigger_audit.py -v`                                                                                                                                                                                                                                                                         | ✅ 3 passed                                       |
| `pytest tests/test_scheduled_task_coverage.py tests/test_scheduled_tasks_structure.py tests/test_cron_org_loop_isolation.py tests/test_message_delivery_claim_recovery.py tests/test_message_delivery_service.py tests/test_scheduled_email_active_org.py tests/test_scheduled_email_group_isolation.py tests/test_audit_shipping.py` | ✅ 68 passed, 0 failed                            |
| `python3 -c "set(SCHEDULE) == set(TASK_RUNNERS)"` registry check                                                                                                                                                                                                                                                                      | ✅ 44/44, no drift                                |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                                                                                                                    | ✅ 0 errors (no frontend files touched this pass) |
| `cd frontend && npm run lint`                                                                                                                                                                                                                                                                                                         | ✅ 0 errors (no frontend files touched this pass) |

No migration touched — `validate_migrations.py` and `generate_schema_docs.py`
not applicable this pass.
