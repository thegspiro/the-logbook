# Security Review — Feature 31: Scheduled Tasks (pass 2)

**Prefix:** `CRON` · **Iteration:** 31 (pass 2) · **Reviewed:** 2026-08-31 · **PR:** [#2095](https://github.com/thegspiro/the-logbook/pull/2095)

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (58 L, 2 routes),
`backend/app/services/scheduled_tasks.py` (5,600 L, **43 task runners** —
grown from the 44/43 counted at pass 1; `SCHEDULE`/`TASK_RUNNERS` still
exactly 1:1, no drift), plus the in-process scheduler in `backend/main.py`
that now drives every runner automatically (`_scheduled_task_loop`,
`_scheduled_email_loop`) — new since pass 1 and out of that pass's stated
scope, brought into scope here since it is the thing that actually executes
`TASK_RUNNERS` in production.
**Frontend:** none — this feature has no UI; `GET /scheduled/tasks` feeds an
admin listing elsewhere, not owned by this feature.
**Migrations:** none touched or needed this pass.

---

## Scope and method

Loaded, in order, before reading any code: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`,
`docs/app-review/scheduled-tasks.md` (app-review passes 1–2), and
`docs/security-review/CRON2-31-scheduled-tasks.md` (security-review pass 1,
PR #1915 + its Codex round, findings CRON2-31-1 through CRON2-31-13). Every
finding those left open or fixed was re-verified against current code before
looking for anything new, per the rotation's own rule.

Read `scheduled.py` in full and `scheduled_tasks.py` end to end, function by
function (not diffed against pass 1), including the `SCHEDULE` /
`TASK_RUNNERS` / `TASK_INTERVALS_SECONDS` / `_MANUAL_ONLY_TASKS` registries.
Also read the in-process scheduler in `main.py` (`_scheduled_task_loop`,
`_scheduled_email_loop`, `_try_claim_background_task`) — this exists in the
codebase already but was outside pass 1's stated scope (`scheduled_tasks.py`

- "services reached by individual runners"); it is the mechanism that
  actually fires every `TASK_RUNNERS` entry in a default, cron-less deployment,
  so it belongs in this feature's review.

Diffed pass 1's merged head (`348039199bb6b489932cea1f0998ab7f24c91fca`, PR
#1915's own final commit) against current `HEAD` for the two target files —
one real code change since pass 1, in `run_publish_scheduled_messages`
(CRON-31-1 below is entirely about that change).

## Route inventory

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing, no data)        | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                                                                                                                                                                     |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | `SYSTEM_RUN_TASKS` (`app/core/permissions.py:447-451`) is granted to no default role or rank — only the wildcard System Owner (`it_manager`) matches it. Verified: `grep -rn "system.run_tasks"` finds it nowhere in `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS`. Matches the exact expectation the task brief named ("likely `system.admin` or similar"). |

Both routes' gates are unchanged since pass 1 and re-verified correct.

## Verified good ✅ (re-confirmed from pass 1, no regressions)

Every item below was re-read against current code, not assumed from the
prior doc.

- **CRON2-31-1** — `InventoryNotificationService.process_pending_notifications`
  still commits/rolls back per `(org, user)` group with the `needs_refresh` +
  `await self.db.refresh(rec)` pattern.
  `app/services/inventory_notification_service.py:155-297`.
- **CRON2-31-2** — `run_post_shift_validation` still excludes cancelled
  shifts. `scheduled_tasks.py:1472` (`.where(Shift.status != ShiftStatus.CANCELLED)`).
- **CRON2-31-3** — the three original "don't stamp the dedup flag on a
  not-ready-yet exit" guards, plus the fourth (empty `member_ids` after the
  active-user filter) added in the Codex round, are all present in
  `run_end_of_shift_checklist_reminders`: `scheduled_tasks.py:2320`,
  `:2335`, `:2369-2375`. See CRON-31-3 below for the sibling gap this pass
  found in `run_shift_reminders`, which never got the equivalent guard.
- **CRON2-31-4** — `run_end_of_shift_checklist_reminders` still joins `User`
  and filters `is_active`. `scheduled_tasks.py:2302`.
- **CRON2-31-5** — `run_scheduled_emails` (now `_run_scheduled_emails_inner`,
  same body) still commits per item and uses the `needs_refresh` +
  `db.get(Organization, ..., populate_existing=True)` pattern on a rollback.
  `scheduled_tasks.py:3412-3563`.
- **CRON2-31-6** — `RetentionService.enforce()` still uses the snapshot
  pattern (`(str(org.id), self._org_config(org))` extracted before the loop)
  plus per-org commit/rollback and an `log_audit_event()` call per org with
  deletions. `app/services/retention_service.py:277-334`. Deliberately still
  unfiltered on `Organization.active` — re-verified the reasoning holds (a
  decommissioned department's stale PII is exactly the case retention exists
  for).
- **CRON2-31-7** — `run_audit_log_archival`'s except block still calls
  `db.rollback()`. `scheduled_tasks.py:3370-3373`.
- **CRON2-31-8** — `run_officer_directory_sync` still uses `.isnot(False)`.
  `scheduled_tasks.py:5403`.
- **CRON2-31-9** — `SalesforceService._api_url()` still validates
  `instance_url` against `_INSTANCE_URL_RE` unconditionally, on every call
  regardless of cached-token state.
  `app/services/integration_services/salesforce_service.py:157-176`.
- **CRON2-31-10** — `run_rolling_recurrence_extend` still computes
  `now = datetime.now(dt_timezone.utc).replace(tzinfo=None)` (naive-but-UTC,
  not naive-local). `scheduled_tasks.py:4653`.
- **CRON2-31-11** — all three joins (`run_compliance_auto_reports`,
  `run_external_training_auto_sync`, `run_salesforce_auto_sync`) still filter
  `Organization.active.isnot(False)` through their join.
  `scheduled_tasks.py:4292`, `:5040`, `:5488`.
- **CRON2-31-12** — `run_action_item_reminders`'s `MeetingActionItem` branch
  is still the only source with no `Organization` join at all (its own
  `organization_id` column, `app/models/meeting.py:217-221`, makes the org
  filter moot for reads but there is still no active-org filter on the
  query). Re-confirmed still open, still flagged — see also the new
  CRON-31-2 finding below, a different bug in the _other_ branch
  (`MinutesActionItem`) of the same function.
- **CRON2-31-13** — `run_admin_hours_auto_close` still has no
  `log_audit_event()` call anywhere in `admin_hours_service.py`'s
  `auto_close_stale_sessions`. Re-confirmed still open, still flagged — this
  pass makes the same design-choice call pass 1 did (owning feature's
  decision, not a drive-by).
- **Registry sync** — `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS` are
  all still in sync: verified with a direct Python check
  (`set(SCHEDULE) == set(TASK_RUNNERS)`, 43/43, and every `TASK_RUNNERS` key
  is in `TASK_INTERVALS_SECONDS` or `_MANUAL_ONLY_TASKS`) rather than by
  reading the dict literals. `tests/test_scheduled_task_coverage.py` (not
  new this pass, but re-run and re-verified) asserts this as an invariant.
- **The in-process scheduler is a real overlap guard** (new territory this
  pass, not reviewed at pass 1): `main.py`'s `_scheduled_task_loop` claims a
  single-worker lease via Redis `SETNX` (`_try_claim_background_task`,
  `main.py:1540-1552`) and then runs every due task **sequentially in one
  loop**, so two runs of the _same_ task cannot overlap on the worker that
  holds the lease. This closes app-review's "Future development #2: No
  overlap guard" and "#1: No task-run observability" (the loop's own
  `Scheduled task '{name}' failed: {e}` log line, plus
  `test_scheduled_task_coverage.py`'s "every runner is scheduled or manual"
  guard, together mean a task that stops firing is now detectable, not
  silent). Residual risk, not fixed (see Flagged below): the Redis-down
  fallback runs the loop on **every** worker unguarded.

## Findings — fixed

### CRON-31-1 — MED — `run_publish_scheduled_messages`: one message's failure orphans every later message in the batch — ✅ FIXED

**What:** new code since pass 1 (added after PR #1915 merged; not covered by
that review). The claim step clears `scheduled_at` for **every** due message
in the batch and commits, _before_ any per-message processing runs — that
clearing is the only condition the "due" query selects on
(`scheduled_at.isnot(None)`). The per-message loop that followed had **no
try/except at all**: `messaging.materialize_recipients(message)` and its
`await db.commit()` could raise for any one message (a bad targeting rule, a
transient DB error), and the exception propagated straight out of the
function.

**Where:** `app/services/scheduled_tasks.py:3634` (function start), the
per-message loop originally at `:3670-3690` before the fix.

**Failure scenario:** three department messages come due in the same 15-minute
tick. The claim step clears `scheduled_at` on all three and commits. Message
1 processes fine. Message 2's `materialize_recipients` raises. The exception
is never caught, so the function returns via exception — messages 2 **and 3**
never get `db.commit()`'d as delivered, but their `scheduled_at` is already
`None` and already committed, so the next run's "due" query will never select
them again. Message 3 (which would have processed cleanly) is silently lost
forever, with no error, no log entry naming it, and no retry.

**Verified:** reproduced with a mocked-`AsyncSession` regression test before
fixing (`materialize_recipients` raises on the first of two messages) — the
second message's `deliver()` was never called and the exception propagated
out of `run_publish_scheduled_messages` entirely.

**Fix:** wrapped the per-message body in try/except (log, count as `failed`,
`continue`) so one message's failure cannot cost the rest of the batch.
Mirrors the `needs_refresh` + `await db.refresh(message)` pattern from
CRON2-31-1/5/6 for the same reason: `AsyncSession.rollback()` expires every
persistent object in the session, so a later message in the same `due` list
needs refreshing before its attributes are touched again. Added a `"failed"`
key to the return payload (also updated the one existing test asserting the
full dict).

**Correction (round 2, Codex-caught):** the fix above still read
`getattr(message, "id", "?")` inside the except block, for the log line.
Codex correctly identified that when the failure is `db.commit()` itself
failing (not `materialize_recipients()` raising a plain exception), the
session enters a state requiring an explicit rollback — and empirically
verified against a real connection (not assumed), _any_ attribute read on
_any_ loaded object, not just an expired one, raises `PendingRollbackError`
until that rollback runs. `getattr(message, "id", "?")`'s default only
catches `AttributeError`; `PendingRollbackError` propagates through it
unchanged, so the read itself raised, aborting this exception handler before
it reached its own `db.rollback()` — the exact class of bug this finding
exists to fix, reintroduced by the fix. Moved the `id` capture (via the same
`getattr(..., "?")`, which also still needs to tolerate a test double lacking
`.id`) to happen immediately after any needed `db.refresh()` but before any
further DB operation in the try block, so it is captured while the session is
still known-good. New guard test
(`TestPublishScheduledMessagesCommitFailureIsSurvivable`, real `db_session`,
forces a genuine FK-violation `IntegrityError` on the commit right after
`materialize_recipients()`) reproduces this against a real connection;
verified to fail with the fix reverted (`PendingRollbackError` propagates out
of the whole function, taking the fixture's own teardown down with it) and
pass with it restored.

### CRON-31-2 — MED — `run_action_item_reminders`'s minutes-action-item branch always raised `MissingGreenlet`, silently, every single time — ✅ FIXED

**What:** `minutes_action_items` (`app/models/minute.py`'s `ActionItem`)
carries no `organization_id` column of its own — the task resolves it via
`item.minutes.organization_id`, an **unloaded** relationship. An
`AsyncSession` does not support an implicit lazy load outside the greenlet
bridge; touching `item.minutes` without eager-loading it first raises
`sqlalchemy.exc.MissingGreenlet`.

**Where:** `app/services/scheduled_tasks.py:813-838` (the query), the
`organization_id=(item.minutes.organization_id if item.minutes else None)`
line inside the per-item `try` a few lines below it.

**Failure scenario:** every time this task finds a due/overdue action item
from meeting minutes with an assignee, it raises `MissingGreenlet` while
building the `NotificationLog`. The failure is invisible in production: it
lands inside the function's own per-item `try/except`, which logs
`"Failed to create minutes action item notification: ..."` and moves on —
the task reports success (`total_reminders: 0` for that branch, no error
surfaced to `POST /run-task`'s caller), so nothing about the response looks
broken. Zero test coverage existed for this function before this pass, which
is exactly why it went unnoticed since the day it was written.

**Verified:** reproduced against a real MariaDB connection via
`async_session_factory()` (not the `db_session` test fixture — see the note
below) before fixing: `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has
not been called; can't call await_only() here.` The `MeetingActionItem`
branch (the other of the two tables this task reads) was **not** affected —
it carries its own `organization_id` column and needs no relationship
traversal.

**A note on how this was verified, because it very nearly wasn't:** the
obvious regression test — insert rows via the `db_session` fixture, then call
the function with that same session — **passes even with the bug present**.
SQLAlchemy's many-to-one lazy loader resolves via the identity map before
issuing any SQL when the related object (here, the just-inserted
`MeetingMinutes`) is already resident in the _same_ session, so no IO is
needed and `MissingGreenlet` never fires. Production calls this task with a
session that has never touched `MeetingMinutes` before, so this masks the
real bug entirely. The guard test added (see below) calls
`db_session.expunge()` on both objects first, forcing a genuine lazy load —
confirmed to fail without the fix and pass with it before trusting it.

**Fix:** `.options(selectinload(MinutesActionItem.minutes))` on the query.

### CRON-31-3 — MED — `run_shift_reminders` stamped its dedup flag even when every assigned member turned out inactive — ✅ FIXED

**What:** CRON2-31-3/4 already fixed this exact shape
(precondition-not-met exit stamping the dedup flag as if a reminder had
been sent) in `run_shift_reminders`'s three "not ready yet" exits and in its
sibling `run_end_of_shift_checklist_reminders`'s fourth exit
(empty `member_ids` after the active-user filter). `run_shift_reminders`
never got that fourth guard: it filters assigned users to active ones
(`scheduled_tasks.py:1926`), but if **every** assigned user for a shift
happens to be inactive, `roster` ends up empty and the function falls
through to unconditionally stamp `start_reminder_sent = True`
(`scheduled_tasks.py`, previously at the "Mark as sent" block) even though
zero notifications and zero emails were sent.

**Where:** `app/services/scheduled_tasks.py`, roster-building block ending
around line 1946 (before the fix).

**Failure scenario:** a shift has one assigned member, and that member is
deactivated (left the department) before the reminder window. The task
correctly sends nobody a reminder — but permanently marks the shift as
"reminded". If an active member is added to the same shift later in the
same 30-minute-cadence window (a common recovery: an officer notices the gap
and reassigns someone), they never receive the pre-shift reminder, silently,
with the shift showing no error.

**Verified:** reproduced with a new integration test
(`db_session` fixture, real DB) before fixing — asserted
`shift.activities.get("start_reminder_sent")` was `True` with zero
notifications sent; confirmed to fail with the fix removed and pass with it
restored.

**Fix:** added `if not roster: continue` (no stamp) immediately after the
roster-building loop, mirroring the sibling function's guard exactly.

### CRON-31-4 — LOW — `run_rolling_recurrence_extend` had no per-parent commit/rollback isolation — ✅ FIXED

**What:** this loop iterates `Event` parents (not `Organization` rows), so it
fell outside the structural test that catches the CRON-1 shape
(`test_org_selects_skip_deactivated_organizations`/
`test_org_loops_roll_back_on_failure` in
`tests/test_scheduled_tasks_structure.py` both match on the literal
`"select(Organization)"` substring in a function's source — this function
never contained it). It also had a **single trailing commit** deferred to
after the whole loop (`if total_created > 0: await db.commit()`), the exact
"worst" shape CRON2-31-1 found and fixed in `run_shift_auto_checkout`: a
later parent's failure discards every earlier parent's already-built
occurrences and `recurrence_end_date` update on the eventual rollback (or,
here, with no rollback at all, poisons the session for every parent after
it).

**Where:** `app/services/scheduled_tasks.py:4630-4812`.

**Failure scenario:** three rolling recurring series are due for extension.
The third's `_generate_recurrence_dates` call raises (a malformed
`recurrence_custom_days` value, say). Before this fix: the exception was
caught and logged, but no rollback ran, so if a **later** parent in the same
run also needed a `select()`, it would raise `PendingRollbackError` from the
poisoned session — and even without that, the two earlier successful
parents' new `Event` rows and `parent.recurrence_end_date` updates sat
uncommitted until the function's own tail `if total_created > 0` check,
which any subsequent parent's rollback (once added) would have discarded.

**Verified:** reproduced with a mocked-`AsyncSession` regression test (3
parents, the second raises) before fixing — asserted 1 commit (the deferred
tail commit) and 0 rollbacks; after the fix, 2 commits (one per successful
parent) and 1 rollback.

**Fix:** commit immediately after each parent's `series_extended += 1`
(inside the same `try`), removed the trailing conditional commit, and added
`await db.rollback()` in the except block.

**Correction (round 2, Codex-caught, two distinct gaps in the fix above):**

1. **Counters incremented before the commit that could still fail.**
   `total_created`/`series_extended` were bumped _before_ `await db.commit()`,
   not after — a parent whose commit itself failed (not just
   `_generate_recurrence_dates`) still had its counts included in the
   totals, alongside its own entry in `errors`: the task reported and logged
   occurrences that were never persisted. Fixed by moving both increments to
   after the commit succeeds.
2. **The same `parents`-list session-poisoning gap CRON-31-1 had.** This
   loop pre-fetches every parent into one list up front, exactly like
   `run_publish_scheduled_messages`'s `due` list — so the same
   `needs_refresh` + `db.refresh(parent)` pattern was required here too, and
   was missing. Without it, the parent processed immediately after a failed
   one raises `MissingGreenlet` reading its own now-expired attributes (or,
   per CRON-31-1's correction above, `PendingRollbackError` if that read
   happens before the rollback rather than after). Also moved the `parent.id`
   capture (via `getattr(parent, "id", "?")`, same reasoning as CRON-31-1) to
   before any further DB operation in the try, for the same reason.

New guard test
(`test_a_commit_failure_does_not_inflate_counts_or_crash_the_next_parent`,
mocked `db.commit` raising specifically on the second of three parents, after
what the pre-fix code would already have counted) catches both: verified to
fail against the pre-fix code (`series_extended: 3` instead of `2`, one
too many) and pass with the fix restored, including an explicit
`db.refresh.assert_awaited_once_with(parents[2])` proving the third parent
was refreshed before use.

### CRON-31-5 — LOW (latent) — `run_rolling_recurrence_extend` had no `Organization.active` filter at all — ✅ FIXED

**What:** same shape as CRON2-31-11/CRON2-31-13 — this loop is keyed on
`Event`, not `Organization`, so it fell outside every prior sweep for this
class. Unlike CRON2-31-11's three fixed sites, this one had **no** org
filter of any kind, not even the bare (`== True`, non-`NULL`-safe) form
CRON2-31-8 fixed elsewhere.

**Where:** `app/services/scheduled_tasks.py:4656-4665` (before the fix).

**Impact:** latent, like the original CRON-2 — nothing in the codebase sets
`Organization.active = False` today. The moment an org-deactivation flow
exists, this task would keep generating new calendar occurrences (and
associated notifications from whatever reads them) for a decommissioned
department's recurring event series.

**Fix:** joined `Organization` and added `.isnot(False)`, matching every
other org-scoped loop in this file. Provably a no-op against today's data,
same reasoning as CRON-2's original fix.

### CRON-31-6 — LOW — `run_external_training_auto_sync` had no rollback in its per-provider except — ✅ FIXED

**What:** `ExternalTrainingSyncService.sync_training_records` commits its own
outcome internally on both its success and (internally caught) failure
paths (`external_training_service.py:371,378`) — so it is designed to be a
self-contained unit per provider. But its very first two statements
(`self.db.add(sync_log); await self.db.flush()`) sit **before** its own
internal `try`, so a failure there (e.g. a transient DB error) propagates
out to the runner's own per-provider `except`, which — unlike every other
per-item loop in this file — never called `db.rollback()`.

**Where:** `app/services/scheduled_tasks.py:5047-5060` (before the fix).

**Failure scenario:** two providers are due for sync. The first's initial
`flush()` fails (a DB blip). The exception reaches the runner's except,
which logs and increments `failed` — but the session is left in a failed
transaction state. The second provider's own `sync_training_records` call
immediately fails too (its own `self.db.add(sync_log); await
self.db.flush()` raises `PendingRollbackError`), reported as its own
independent failure — the same self-concealing "many providers are broken"
presentation CRON-1's original writeup described for orgs.

**Verified:** reproduced with a mocked-`AsyncSession` regression test (2
providers, the first raises before its internal try) before fixing —
asserted 0 `db.rollback()` calls; after the fix, 1.

**Fix:** added `await db.rollback()` in the except block, matching the
pattern used everywhere else in this file.

**Correction (round 2, Codex-caught):** same `providers`-list session-
poisoning gap as CRON-31-1/CRON-31-4's addendum — this loop also pre-fetches
every provider into one list up front, so the rollback above expires every
provider still left in it, not just the one that failed. The fix added the
rollback but not a `needs_refresh` + `db.refresh(provider)` step for the
provider processed next, and read `provider.name`/`provider.id` for the log
line without capturing them first. Fixed the same way as the other two
findings. Strengthened the existing guard test with
`db.refresh.assert_awaited_once_with(providers[1])`; verified to fail against
the pre-fix code (refresh never called) and pass with the fix restored.

## Findings — flagged, not fixed

### CRON-31-7 — LOW — `run_end_of_shift_summary` can mark a member "sent" without anything actually reaching them

**File:** `app/services/scheduled_tasks.py:2709-2874`.

Both the in-app `NotificationLog` construction and the email send are
individually wrapped in their own `try/except` that logs and continues.
`newly_sent.append(uid)` runs unconditionally after both attempts,
regardless of whether either one actually succeeded — the same shape
CRON2-31-3 fixed elsewhere.

**Why flagged instead of fixed:** the realistic exposure here is much
narrower than CRON2-31-3's. `db.add(notif)` is an in-memory operation — it
does not flush to the database at this point (the actual persistence happens
at the org-level `await db.commit()` after the whole shift loop, whose
failure is _already_ caught and rolled back at the org level, discarding the
whole org's batch for this run rather than silently marking one member
"sent"). So the in-app `try/except` here guards against a Python-level
construction failure, which is very unlikely, not a persistence failure.
The one channel with a real, common failure mode — the email send — already
has its own established behavior elsewhere in this codebase (`deliver()` in
`message_delivery_service.py` and `run_publish_scheduled_messages`'s own
docstring) of treating "one channel failed, the other succeeded" as
delivered rather than retriable. Changing this needs a decision about
whether "in-app succeeded, email failed" should count as delivered for this
specific task, which is a product call, not a drive-by fix. Mirrored to
`KNOWN_LIMITATIONS.md`.

### CRON-31-8 — LOW — `run_event_reminders` stamps a due interval as sent when zero recipients exist yet, by explicit design

**File:** `app/services/scheduled_tasks.py:1062-1068`.

When `reminder_target == "going"` and nobody has RSVP'd "going"/"maybe" yet
at the moment a reminder interval comes due, `recipients` is empty and the
code stamps that interval as sent anyway — the comment reads "Mark all due
intervals as sent to avoid re-processing". If someone RSVPs "going" after
that specific interval's threshold has passed but before the event, they
will not receive that interval's reminder (a _closer_ interval, not yet
due, would still fire normally, since each interval's dedup is independent).

**Why flagged instead of fixed:** unlike CRON-31-3 (`run_shift_reminders`,
no comment, no evidence of intent), this exit carries an explicit comment
stating the chosen behavior, which reads as a deliberate trade-off (avoid an
unbounded number of near-empty per-tick "still nobody RSVP'd" checks against
every future interval) rather than an oversight. Reversing it is a product
decision about whether a late RSVP should retroactively "unlock" an
already-past reminder interval, not a bug with one obviously-correct fix.
Mirrored to `KNOWN_LIMITATIONS.md`.

### CRON2-31-12, CRON2-31-13 — re-confirmed still open (see Verified good ✅ above)

No new information this pass; not re-applied, per the rotation's own rule
against re-reporting what a prior pass already left as a considered,
unresolved call.

## New territory this pass: the in-process scheduler (`main.py`)

Not part of pass 1's stated scope. Reviewed because it is what actually
fires every `TASK_RUNNERS` entry in the default (cron-less) deployment this
file's own module docstring still tells operators to wire up externally via
`curl -X POST .../run-task` — both mechanisms coexist, and both call the
same runners.

**Verified good:** single-worker leader election via Redis `SETNX`
(`_try_claim_background_task`), sequential execution within one loop
(so the _same_ task cannot overlap itself on the worker holding the lease),
and every registered task is now provably auto-fired
(`test_scheduled_task_coverage.py`'s `test_every_runner_is_scheduled_or_manual`).

**Flagged, not fixed — Redis-down fallback runs the loop on every worker
unguarded.** `_try_claim_background_task` (`main.py:1540-1552`) returns
`True` (i.e. "you may run it") on any Redis error, so if Redis is
unavailable, **every** uvicorn worker runs `_scheduled_task_loop`
concurrently, with no coordination between them. In that state, two workers
could process the same due row (a shift reminder, a scheduled message)
independently and both send it — a duplicate-notification risk, not a data
corruption or security risk, since every downstream write in this file is
either idempotent-by-dedup-flag or (worse case) results in one extra email/
in-app notification, not a double-charge or a lost record.

**Why flagged instead of fixed:** the alternative — fail closed and run on
no worker when Redis is down — is strictly worse for this feature: it means
zero scheduled tasks fire at all until Redis recovers (no reminders, no
low-stock alerts, no dues marked overdue), which is a worse outcome for a
volunteer fire department than an occasional duplicate reminder email. This
mirrors the documented trade-off in CLAUDE.md's own "Attack Protection" table
(breached-password detection fails open for the same class of reason: the
alternative blocks a legitimate action entirely). Changing the failure
direction here is a product/ops decision, not a bug fix. Mirrored to
`KNOWN_LIMITATIONS.md`.

## Schema & migration notes

No model or migration touched this pass. n/a.

## Guard tests added

- `tests/test_message_delivery_service.py::TestPublishScheduledMessages::test_one_message_failure_does_not_lose_the_rest_of_the_batch` —
  CRON-31-1. Verified to fail (unhandled `RuntimeError` propagating out of
  the function) with the fix reverted.
- `tests/test_message_delivery_service.py::TestPublishScheduledMessagesCommitFailureIsSurvivable::test_a_commit_failure_on_one_message_does_not_abort_the_batch` —
  CRON-31-1's round-2 correction. Real `db_session`, forces a genuine
  FK-violation `IntegrityError` specifically on `db.commit()` (not a plain
  Python exception) to exercise the exact `PendingRollbackError` mechanism
  Codex identified. Verified to fail (`PendingRollbackError` propagates out
  of the whole function) with the correction reverted.
- `tests/test_action_item_reminders.py::TestMinutesActionItemReminder::test_due_minutes_action_item_sends_a_reminder` —
  CRON-31-2. Uses `db_session.expunge()` on both the parent and child rows
  so the test actually exercises the lazy-load path production hits (see
  the note in the finding above on why the naive version of this test is
  worthless). Verified to fail (`total_reminders: 0`, no exception raised —
  swallowed by the function's own per-item try/except) with the fix
  reverted. `TestMeetingActionItemReminder` alongside it is a control case
  for the unaffected sibling branch.
- `tests/test_shift_scheduled_tasks.py::TestShiftRemindersDedupFlagNotStampedWhenRosterEmpty` —
  CRON-31-3 (two tests: flag not stamped when every assignee is inactive;
  flag stamped normally when a reminder was actually sent). Verified to
  fail with the fix reverted.
- `tests/test_rolling_recurrence_extend_isolation.py::TestRollingRecurrenceExtendIsolation::test_one_parents_failure_does_not_lose_an_earlier_parents_commit` —
  CRON-31-4. Verified to fail (1 commit instead of 2, 0 rollbacks instead of
  1. with the fix reverted.
- `tests/test_rolling_recurrence_extend_isolation.py::TestRollingRecurrenceExtendIsolation::test_a_commit_failure_does_not_inflate_counts_or_crash_the_next_parent` —
  CRON-31-4/5's round-2 correction. Failure forced specifically at
  `db.commit()`, after what the pre-fix code would already have counted.
  Verified to fail (`series_extended: 3` instead of `2`) with the correction
  reverted.
- `tests/test_external_training_auto_sync_isolation.py::TestExternalTrainingAutoSyncIsolation::test_one_providers_failure_does_not_abort_the_run` —
  CRON-31-6, strengthened in round 2 with
  `db.refresh.assert_awaited_once_with(providers[1])`. Verified to fail
  (refresh never called) with the correction reverted.

Every guard test above was independently verified to fail against the
pre-fix code and pass against the post-fix code — not merely written and
assumed correct.

## Completion gate

| Check                                                                                                                                                                                                                       | Result                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                               | ✅ 0 violations                                                                                                                                             |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                        | ✅ clean (1 file auto-reformatted during the iteration, re-verified clean after)                                                                            |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                   | ✅ clean                                                                                                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                           | ✅ 394 revisions, single head `f6a7b8c9d0e1`                                                                                                                |
| `pytest tests/ -k "scheduled_task or rolling_recurrence or shift_scheduled or action_item_reminder or message_delivery or cron_org_loop or retention_service or inventory_notification or salesforce or external_training"` | ✅ 143 passed, 1 skipped (pre-existing, missing optional `py_vapid` dep), 0 failed (round 2: +2 tests)                                                      |
| `pytest tests/` (full suite)                                                                                                                                                                                                | ✅ **9353 passed, 22 skipped, 0 failed** — all skips are the same pre-existing Docker/optional-dependency/contract-suite skips this codebase always reports |
| `tsc --noEmit` / `eslint .`                                                                                                                                                                                                 | n/a — no frontend file changed this pass                                                                                                                    |
