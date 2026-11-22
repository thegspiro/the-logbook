# Security Review — Feature 31: Scheduled Tasks (pass 14)

**Prefix:** `CRON14` · **Iteration:** 31 (pass 14) · **Reviewed:** 2026-11-22

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4 — 0 diff by direct `git diff`),
`backend/app/services/scheduled_tasks.py` (**88 registered tasks, up from
80 at pass 13's merge point** — 7 new runners this pass, all delegating to
other features' own code, plus one bug fix to an existing runner; see below).
**Frontend:** none — unchanged (confirmed no frontend code references
`/scheduled/tasks` or `/scheduled/run-task`; `docs/KNOWN_LIMITATIONS.md`'s
"Admin — No Scheduled Tasks Page" entry still describes the current state).
**Migrations:** none new to this feature's own tables this pass — the new
runners' tables (`leave_notice_send`, `pending_file_deletions`, the History
Import `expires_at` column, the attendance-waiver workflow's own tables)
belong to Leave of absence, Member lifecycle, History import and Training
waivers' own migrations, reviewed there.

---

## Step 0

Checked out and fast-forwarded `main` (`git pull --ff-only`), landing on
`2248da3b` (PR #4558, Feature 30/Onboarding pass 14's merge). A fresh
`list_pull_requests` (state `open`, 10 results, re-checked with a second page
returning 0) found **no** PR with a head branch starting
`claude/security-review-`. PR #4558 itself was confirmed merged
(`pull_request_read`: `state: closed`, `merged: true`) — `PROGRESS.md`'s Open
PR row (which had still shown it pending) was corrected in the working tree
per the skill's Step 0 rule, superseded into its own `<details>` block, not
committed separately; it rides along with this PR. Row 30 was already `✅`.
Row 31 (Scheduled tasks) was confirmed the next pending feature by direct
read of `PROGRESS.md`'s Open PR history (no literal `⬜`-row table exists in
this file — each pass's own narrative is the record; the "next pending" claim
in pass 13's own merged PR note, corroborated by `CRON13-31-scheduled-
tasks.md`'s dated history, is the evidence).

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s latest pass (17),
`CRON13-31-scheduled-tasks.md` (pass 13) in full, and the sibling
`docs/app-review/scheduled-tasks.md` (app-review track, pass 6) in full.
Every finding either track left open was re-verified against current code at
its current location, not re-derived.

**Delta identification.** `git diff <pass 13's baseline commit,
079b82fb9c1>..HEAD -- backend/app/services/scheduled_tasks.py
backend/app/api/v1/endpoints/scheduled.py` taken directly (not inferred from
`git log`, whose path-filtered output in this tree omits some of the real
contributing commits — see the note below) — this is the one count that
cannot be fooled by a merge-commit artifact. `scheduled.py`: 0 diff.
`scheduled_tasks.py`: 7 new `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`
entries, plus a correctness fix to the existing `run_rolling_recurrence_extend`
and an unrelated CC/BCC-merge change inside the manual-only `scheduled_emails`
runner (owned by the email-templates/Communications feature, reviewed below
for the scheduler-wiring angle only).

**Note on git log vs. the real diff.** `git log --no-merges <baseline>..HEAD
-- scheduled_tasks.py` returned only 4 of the 7 commits that actually touch
the file in this window (confirmed by `git log -S'"<task_id>"'` for each of
the 3 it missed — `pending_file_deletions`, `attendance_waiver_expiry`,
`history_import_expiry` — each resolves to a real, different commit not in
that log's output). This tree's merge-commit history has already been noted
as anomalous by pass 13 (`CRON13-31-scheduled-tasks.md`'s "Note on git
history"); this pass worked around it by diffing file content directly
rather than reconstructing it from `git log`, and records this so the next
pass does not trust a path-filtered `git log` as a complete delta here.

**Seven new registered tasks:**

| New task                    | Delegate                                                                                    | Owning feature (reviewed there)     |
| --------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| `guest_headcount_reminders` | `guest_headcount_reminder_service.GuestHeadcountReminderService.send_reminders`             | Events/Outreach                     |
| `leave_ending_reminders`    | `leave_workflow_notices.send_leave_ending_reminders`                                        | Leave of absence (new feature area) |
| `open_ended_leave_digest`   | `leave_workflow_notices.send_open_ended_leave_digest`                                       | Leave of absence                    |
| `leave_request_upkeep`      | `leave_workflow_notices.run_request_upkeep` → `LeaveRequestService.resettle_pending`        | Leave of absence                    |
| `attendance_waiver_expiry`  | `attendance_waiver_expiry.AttendanceWaiverExpiry.sweep` (own org loop, not `_for_each_org`) | Training waivers                    |
| `pending_file_deletions`    | `pending_file_deletions.PendingFileDeletionSweep.run` (own org loop)                        | Member lifecycle (hard delete)      |
| `history_import_expiry`     | `history_import_service.HistoryImportService.expire_drafts`                                 | History import                      |

Read each delegate in full for the two things this layer owns — idempotency
and org-scoping — not the business logic, which belongs to its owning
feature, matching pass 13's convention for the Finance/Medical/Training
delegates.

### The seven new tasks — wired correctly, no new finding

- **`guest_headcount_reminders`** — every query filters `Event.organization_id
== org_id` / `User.organization_id == org_id`. Idempotent via a
  `REMINDER_MARKER` key written into `Event.custom_fields` as a **new** dict
  (`{**(event.custom_fields or {}), REMINDER_MARKER: True}`, not an in-place
  mutation — Pitfall #12 compliant) and committed with the sends. Send, then
  stamp (Pitfall #36): a crash between the email and the commit at worst
  repeats one reminder. Recipients are filtered to holders of
  `events.manage` via the already-reviewed permission-resolution helper
  (`user_has_permission`), so an organizer who lost the permission is
  correctly skipped rather than silently emailed a card they can no longer
  act on.
- **`leave_ending_reminders` / `open_ended_leave_digest` / `leave_request_upkeep`**
  — all route through `_for_each_org` (the shared, already-reviewed
  per-org commit/rollback helper) and `leave_workflow_notices._claim`, which
  takes a **durable, DB-unique claim** before sending: `LeaveNoticeSend` carries
  `UniqueConstraint("organization_id", "kind", "key", name="uq_leave_notice_send")`
  (`backend/app/models/leave_request.py:340`), and `_claim` inserts then
  commits, catching `IntegrityError` and returning `None` on a repeat
  (`leave_workflow_notices.py:130-141`) — this is the Pitfall #36 "unique
  constraint on the provider's own id" shape, done with a real DB constraint
  rather than a read-then-write JSON flag. `send_leave_ending_reminders`
  additionally **releases** the claim when nothing could actually be
  delivered (`_release`, `leave_workflow_notices.py:288-291`), which is a
  stricter, better-behaved version of the "stamp sent with zero recipients"
  trade-off CRON-31-8 accepted elsewhere — a department that later fixes its
  mail configuration gets the reminder on the next run instead of never.
  `run_request_upkeep`'s `resettle_pending` re-checks `request.status ==
LeaveRequestStatus.PENDING` under `with_for_update()` per row
  (`leave_request_service.py:1386-1392`) before acting, so a second
  concurrent run (the no-Redis scheduler fallback, or a manual trigger racing
  the scheduler — CRON4-31-2) finds nothing left to settle rather than
  double-acting.
- **`attendance_waiver_expiry`** — does **not** use `_for_each_org`
  (deliberately: each request is its own transaction, documented in the
  class docstring, to avoid holding a department's worth of locks against the
  engine's own lock order). Idempotent by **row re-read under lock**:
  `_expire` re-selects the request `WHERE status = 'pending'`
  `.with_for_update()` immediately before acting
  (`attendance_waiver_expiry.py:216-229`), so a second sweep, or the sweep
  racing a member/approver decision, finds nothing to do. Stamp, commit, then
  email (Pitfall #36: a crash between the two loses an email, never repeats
  one). The member-facing notice text carries only the event title and date —
  no reason, category or note (`expiry_notice`, `:53-63`), consistent with
  CLAUDE.md's PHI-in-notifications discipline for a workflow whose waivers
  may be medical.
- **`pending_file_deletions`** — rows are claimed `FOR UPDATE SKIP LOCKED`
  (`pending_file_deletions.py:123`), explicitly so the endpoint's own
  post-commit cleanup and an hourly sweep (or two sweeps under the no-Redis
  scheduler fallback) never contend for the same row. The side effect is
  idempotent too: deleting an already-gone file still counts as resolved
  (`_resolve`'s doc comment, `:174-181`). Every query is `organization_id`-
  filtered, including the age-ordered selection query. Notably, this runner's
  own error path (`run`, `:285-289`) logs `org_id` only and appends `{"org_id":
org_id}` to its errors list — **no raw exception text reaches the
  response**, unlike `_for_each_org`'s own `str(e)` (CRON-4, still open
  elsewhere) — a stricter pattern than the one this file's other 86 runners
  follow, worth noting as the better precedent rather than a defect.
- **`history_import_expiry`** — thin `_for_each_org` delegate.
  `expire_drafts` filters `HistoryImport.organization_id == str(organization_id)`,
  takes `.with_for_update()`, and its own idempotency is the status filter
  (`status == DRAFT`) re-evaluated against the committed row on every run
  (`history_import_service.py:1094-1117`) — a second run after the status
  flips to `EXPIRED` finds nothing.

None of the seven takes a client-supplied id anywhere in this file — every id
either comes from the loop's own current org or (for the two with their own
org loop) from that loop's own first, org-scoped query, never from a request.
No new `.like()`/`.ilike()`, no new CSV export, no new raw SQL in this
window's diff to any of these.

### `run_rolling_recurrence_extend` — a real idempotency bug fixed by its own feature, verified here — no new finding

The existing runner's query for "the latest occurrence" changed from
`Event.is_cancelled.is_(False)` + `.limit(1)` to reading the **whole** series
and separately tracking which start times the series already holds
(`taken_starts`), including cancelled ones. Before this change, a cancelled
occurrence was invisible to the query, so a nightly re-run would recreate a
**live** copy of the exact date an officer had just cancelled — undoing the
cancellation every night. Traced directly (`scheduled_tasks.py:7126-7198` in
the current tree): `new_occurrences` is now filtered on both `s >
latest_start` **and** `s not in taken_starts`, closing the gap. This is a
correctness fix landed by the Events feature's own commit
(`519fa759`), not a change made by this review; verified end to end against
the current source rather than trusted from the commit message. Guarded by
`tests/test_rolling_recurrence_extend_isolation.py` (pre-existing coverage,
confirmed present and passing in the scoped run below).

### The `scheduled_emails` CC/BCC merge change — scheduler-wiring angle only, no new finding

`_run_scheduled_emails_inner` (the body of the one `_MANUAL_ONLY_TASKS`
runner) now also resolves CC addresses from `template.default_cc_position_ids`
via `template_svc.position_holder_emails(str(item.organization_id), [...])`
and passes `apply_template_copies=False` to the send call so the send layer
does not look the template's copies up a second time. This is the
email-templates/Communications feature's own change (commit `0b0b14a4`,
"Make election and minutes emails editable templates"); reviewed here only
because it landed inside this feature's shared file. The org-scoping is
correct (`item.organization_id` is passed through, not a bare position id),
and the existing `copies = not is_always_sent(template.template_type)` guard
— unchanged — still gates the whole block, so a credential-bearing template
type (`NO_TEMPLATE_COPY_TYPES`) still never has its CC/BCC lists copied. The
business logic of `position_holder_emails` and `is_always_sent` belongs to
Communications/email-templates and was not re-derived here.

## Route inventory

Unchanged since pass 1 — re-confirmed by AST against current `scheduled.py`
(0 diff since pass 4, confirmed by direct `git diff` against pass 13's own
baseline commit):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                            |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                               |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry; only the global `*` wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. No per-task lock (CRON4-31-2, still open). |

## Verified good ✅

- **`SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`/`_MANUAL_ONLY_TASKS` are
  fully consistent (88/88/87+1)** — re-verified by `ast.walk` over all four
  dict/set literals (handling both `Assign` and the `TASK_INTERVALS_SECONDS:
Dict[str, int] = {...}` `AnnAssign` form, which a naive walk silently
  under-counts): `SCHEDULE − TASK_RUNNERS = ∅`, `TASK_RUNNERS − SCHEDULE = ∅`,
  `(TASK_RUNNERS − TASK_INTERVALS_SECONDS) − _MANUAL_ONLY_TASKS = ∅`,
  `TASK_INTERVALS_SECONDS − TASK_RUNNERS = ∅`. The one manual-only entry
  (`scheduled_emails`) is unchanged.
- **Every one of the seven new runners is covered by its own dedicated test
  file**, shipped by the commit that introduced it, not added by this
  review: `test_guest_headcount_reminders.py`, `test_leave_workflow_notices.py`,
  `test_attendance_waiver_expiry.py`, `test_pending_file_deletions.py`, and
  History Import's existing `test_history_import*.py` suite. Confirmed
  present and passing in the scoped run below.
- **None of the seven new tasks' per-org/per-record loops can mix one org's
  or department's data into another's response or email** — every read and
  write inside each new runner's own scope filters by the specific
  `organization_id` the outer loop (or, for the two with their own loop, that
  loop's own first query) is currently on; nothing passes a bare,
  org-unfiltered id into a by-id lookup (CLAUDE.md Pitfall #14 / checklist
  dimension 3).
- **The in-process scheduler's claim-renewal mechanism (app-review CRON-40) is
  unaffected by this window's diff.** `git diff <pass-13-baseline>..HEAD --
backend/main.py backend/app/core/background_claim.py` is empty. All seven
  new tasks are automatically covered by the renew-per-task loop because they
  are present in `TASK_INTERVALS_SECONDS` (confirmed by the registry-
  consistency check above) — nothing had to special-case them.

## Findings

No new defects found this pass. One real idempotency bug in an **existing**
runner was fixed by its owning feature's own commit during this window and is
recorded above as a correctness improvement, not a finding of this review.

## Re-confirmed still open, unchanged — not re-applied

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration still
  reaches `POST /run-task`'s response body inside each task's own results
  list (`_for_each_org`'s `results.append({"org_id": org_id, "error":
str(e)})`, confirmed unchanged at `scheduled_tasks.py:1066`), bypassing
  `safe_error_detail()`. Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`. (Contrast: the new
  `pending_file_deletions` runner does **not** repeat this pattern — see
  above.)
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by explicit design comment (confirmed unchanged at
  `scheduled_tasks.py:1883-1888`).
- **The Redis-down fallback still fails open** — `_try_claim_background_task`
  returns `True` when Redis is unreachable (`main.py:1609-1623`), confirmed
  unchanged by direct read. Unchanged and still the considered trade-off.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`; `CRON-31-7` remains correctly recorded
as fixed (2026-10-05) per pass 13's own correction. Nothing to update in
either doc this pass.

## A pre-existing, out-of-scope Alembic fork — flagged, not fixed

`main` currently has **2 Alembic heads** (`809893462b67`, `dd939b45d6c0`), so
`validate_migrations.py --strict` fails — see the Completion gate below. This
is not a defect introduced by this feature or this pass: [PR
#4560](https://github.com/thegspiro/the-logbook/pull/4560) (open, not yet
merged as of this review) already adds the join revision these two heads
need (`561a3e9f4165`). Per the standing rule this class of defect has
followed since the two-head case in `SEC-00` pass 17 (and pass 13's own
companion note here), this pass does **not** write a competing merge
revision — that would add a third head rather than resolve the fork — and
instead flags it and leaves the fix to #4560.

## Schema & migration notes

No new migration touching this feature's own tables this pass.
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The seven new
tasks' own tables/columns (`leave_notice_send` with its
`uq_leave_notice_send` unique constraint, `pending_file_deletions`,
`history_imports.expires_at`, the attendance-waiver workflow's existing
tables) belong to Leave of absence, Member lifecycle, History import and
Training waivers' own migrations respectively, and are reviewed there — this
pass checked only that each is in fact migration-backed (not a
`create_all`-only addition masquerading as one) by confirming each model
appears in a real Alembic revision, not that the migration itself is correct
(out of this feature's scope).

## Guard tests added

None this pass — no new defect found to guard against. Each new delegate's
own idempotency/locking already carries dedicated test coverage from the
commit that introduced it (see "Verified good" above), not added by this
review.

## Completion gate

| Check                                                                           | Result                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                  | ✅ 0 violations                                                                                                                                            |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)         | ✅ clean, 3419 files unchanged                                                                                                                             |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)      | ✅ clean                                                                                                                                                   |
| `python3.13 scripts/validate_migrations.py --strict`                            | ❌ **2-head fork, pre-existing** — 819 revisions, heads `809893462b67`/`dd939b45d6c0`; fix already carried by open PR #4560, not re-fixed here (see above) |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST, handling `AnnAssign`) | ✅ 88/88, up from 80                                                                                                                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)               | ✅ 338 routes, 0 errors/warnings                                                                                                                           |
| `python3.13 -m pytest tests/test_scheduled_task_coverage.py -q`                 | ✅ 5 passed                                                                                                                                                |
| Scoped `pytest` (scheduled-task/cron + all seven new delegates)                 | ✅ 694 passed, 1 pre-existing skip (`pywebpush`), 0 failed, 236.74s                                                                                        |
| `cd frontend && npm run typecheck`                                              | ✅ 0 errors                                                                                                                                                |
| `cd frontend && npm run lint`                                                   | ✅ 0 errors/warnings                                                                                                                                       |

Scoped selection: `-k "scheduled_task or cron or scheduler or quickbooks or
dues_late_fee or dues_reminder or fiscal_year_due or advance_statement or
medical_screening_expiry or program_milestone or meeting_action_item or
action_item_reminder or guest_headcount or leave_workflow or
attendance_waiver_expiry or pending_file_deletion or history_import or
rolling_recurrence"` against `backend/tests/` — 694 passed, 1 skipped, 32024
deselected in 236.74s.

**On the one red row:** CLAUDE.md's "Fix All Errors" rule requires every
encountered error to be fixed in the same commit or explicitly escalated as a
full inventory — this is the escalation. The fork is not this feature's own
tables, a fix already exists on an open PR, and writing a second, competing
merge revision here would turn a 2-head fork into a 3-head one (the exact
mistake `SEC-00` pass 17 documents happening three times to this same class
of defect). The correct remedy is for #4560 to merge; nothing in this
feature's own scope is blocked by it.
