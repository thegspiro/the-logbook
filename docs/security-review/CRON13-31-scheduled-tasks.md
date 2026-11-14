# Security Review — Feature 31: Scheduled Tasks (pass 13)

**Prefix:** `CRON13` · **Iteration:** 31 (pass 13) · **Reviewed:** 2026-11-11

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(**80 registered tasks, up from 73 at pass 12's merge point** — 7 new runners
this pass, all delegating to other features' own code; see below).
**Frontend:** none — unchanged (`docs/KNOWN_LIMITATIONS.md`'s "Admin — No
Scheduled Tasks Page" entry, owner-accepted 2026-10-05, still describes the
current state; confirmed no frontend code references `/scheduled/tasks` or
`/scheduled/run-task` — the only "scheduled" frontend surface is the
unrelated Communications "scheduled email" compose feature).
**Migrations:** none new to this feature's own tables this pass — the new
runners' tables (`advance_statements`, `quickbooks_connections`, dues/fiscal
columns) belong to Finance's own migrations, reviewed there.

---

## Step 0

`list_pull_requests` (state `open`) returned three open PRs: #4214 (docs
pass), #4204 (CI sharding), #4129 (workflow-review second passes) — none with
a `claude/security-review-*` head. PR #4240 (Feature 30, Onboarding, pass 13)
had already merged clean to `main` at `deb9601f3`. `docs/security-review/
PROGRESS.md`'s rotation table confirms row 31 (Scheduled tasks) as the first
`⬜` row on a freshly fetched `main`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s latest pass,
`CRON12-31-scheduled-tasks.md` (pass 12) and `CRON11-31-scheduled-tasks.md`
(pass 11) in full, and the sibling `docs/app-review/scheduled-tasks.md`
(app-review track, pass 6, 2026-11-02). Every finding either track left open
was re-verified against current code at its current location, not re-derived.

**Delta identification.** `git log` message search for the pass-11/12
security-review merge commits (by PR number and by commit-message pattern)
found nothing on `main` — those two passes' commits are not individually
addressable in this tree's current history (see note below), so the delta
was found a different way: `git diff <the earliest commit that already
contains CRON12-31-scheduled-tasks.md> HEAD -- backend/app/services/
scheduled_tasks.py` for added `SCHEDULE` dict keys, cross-checked against
every commit touching either scope file since 2026-11-01 read in full
(`2b971c2a2`, `ae11628e2`, `7884706fa`, `3e478316d`, `14313f4a4`, plus two
no-registry-change commits `16f5ea1f6`/`6b80b9943` that only reworded the
end-of-shift summary's call-type rollup). `SCHEDULE`/`TASK_RUNNERS`/
`TASK_INTERVALS_SECONDS`/`_MANUAL_ONLY_TASKS` re-verified by `ast.walk` at
**80/80/79+1**, all four sets consistent with each other (see Verified good).

**Note on git history.** The merge commit that brought `CRON12-31-
scheduled-tasks.md` into this tree (`818a61f1a`) carries an enormous,
unrelated diff (`.claude/`, `.github/workflows/`, hundreds of other files) and
is dated _after_ several of the commits it supposedly precedes by subject
matter; PR numbers #3857 and #4006, named in `PROGRESS.md`'s own text for
passes 11/12, do not appear anywhere in `git log --all`. This looks like a
history rewrite/import boundary upstream of this review's control, not
something this pass caused or can resolve — recorded here so the next pass
does not spend time on the same search. It did not block this review:
`SCHEDULE` already held 73 entries at that merge commit, consistent with "73,
up from 72" one commit past pass 12's own stated count, and every commit
after it was readable and readable in full.

**Seven new registered tasks**, all delegating to another feature's own
already-built (or concurrently-built) service:

| New task                             | Commit (date)            | Delegate                                                                | Owning feature (status)                                                  |
| ------------------------------------ | ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `quickbooks_sync`                    | `2b971c2a2` (2026-11-06) | `quickbooks_sync_service.run_for_organization`                          | Finance (feature 05) — reviewed here only for the scheduler-wiring angle |
| `fiscal_year_due_reminders`          | `ae11628e2` (2026-11-06) | `finance_year_due_notifications.send_year_due_reminders`                | Finance (feature 05) — ditto                                             |
| `advance_statements`                 | `ae11628e2` (2026-11-06) | `cash_advance_statements.send_advance_statements`                       | Finance (feature 05) — ditto                                             |
| `dues_late_fees`                     | `ae11628e2` (2026-11-06) | `dues_terms.apply_late_fees`                                            | Finance (feature 05) — ditto                                             |
| `dues_reminders`                     | `ae11628e2` (2026-11-06) | `dues_reminders.send_dues_reminders`                                    | Finance (feature 05) — ditto                                             |
| `medical_screening_expiry_reminders` | `3e478316d` (2026-11-08) | `screening_reminder_service.ScreeningReminderService.process_reminders` | Medical screening (feature 09) — ditto                                   |
| `program_milestones`                 | `14313f4a4` (2026-11-08) | `program_milestones.sweep_organization`                                 | Training core (feature 17) — ditto                                       |

An eighth change in this window, `7884706fa` (2026-11-05), does not register
a new task: it adds email delivery to the existing `action_item_reminders`
runner (meeting-record items are now emailed, not just given a bell entry —
owner decision 2026-11-01), via a new `meeting_action_item_reminder_service`.
Reviewed in full below since it is new code inside this feature's own file,
not a pointer to another feature's service.

### The six Finance/Medical/Training delegates — wired correctly, no new finding

Read each delegate in full for the two things this layer owns (idempotency,
org-scoping), not the business logic, which belongs to its owning feature:

- **`quickbooks_sync`** — the runner selects `(organization_id)` only (never
  a loaded `Organization` row) for orgs with a `CONNECTED` QuickBooks
  connection, filtered through `Organization.active.isnot(False)`, then calls
  `run_for_organization(db, org_id)` per id with its own try/except +
  `db.rollback()` + `persist_task_error_log(org_id, ...)` on failure — one
  department's sync failure cannot poison another's. `run_for_organization`'s
  own docstring states "Safe to run twice: the lease keeps two runs apart,
  and each payment posts once" — verified: `_acquire_lease`/`_release_lease`
  gate the whole sync, and `QuickBooksConnection.access_token`/
  `refresh_token`/`pending_attempt` are `EncryptedText` columns (checklist
  dimension 5 — secrets encrypted at rest), never logged (no `logger` call in
  either file splices a token into a message).
- **`fiscal_year_due_reminders`** / **`advance_statements`** / **`dues_reminders`**
  — all three route through `_for_each_org` (the shared, already-reviewed
  per-org commit/rollback helper), and their delegates each document and
  implement a `NotificationLog`-backed or dedicated-table sent-log keyed on
  (recipient or advance, event, date), checked before send and written after
  (CLAUDE.md pitfall #36's "send, then stamp"). `send_advance_statements`'s
  claim step (`_claim`, a `db.begin_nested()` SAVEPOINT insert racing on
  `AdvanceStatement`'s unique `(advance_id, statement_date)`) isolates a
  concurrent-claim `IntegrityError` without poisoning the org's own
  transaction — the same shape `zeffy_payment_sync` used at pass 12. All
  three use `Decimal` for money, not `float` (CRON-6's class).
- **`dues_late_fees`** — does **not** use `_for_each_org` (deliberately: it
  is one UPDATE across every org's `MemberDues`, not a per-org loop), and its
  idempotency is a single atomic UPDATE whose WHERE clause re-asserts
  `late_fee_applied.is_(None)` at write time — a second run, or a concurrent
  one, re-evaluates the guard against the committed row and updates 0 rows
  for anything already charged, which closes the race without a lock.
- **`medical_screening_expiry_reminders`** — thin `_for_each_org` delegate;
  the delegate's own docstring states the `screening_reminder_sends` table's
  unique key is what makes a second daily run a no-op.
- **`program_milestones`** — thin `_for_each_org` delegate; idempotent per
  (milestone, enrollment) via a unique achievement row, committed before
  anything is announced, per its own docstring.

None of the six takes a client-supplied id anywhere in this file — every id
either comes from the loop's own current org or (for `quickbooks_sync`) from
the loop's own first query, never from a request. No new `.like()`/`.ilike()`,
no new CSV export, no new raw SQL in this window's diff to any of these.

### `action_item_reminders` gains email delivery — wired correctly, no new finding

`run_action_item_reminders`'s existing bell-notification loops (meeting and
minutes action items) are unchanged; the new piece is `owed_emails` collected
alongside the existing meeting-item bell entries and handed to
`send_meeting_action_item_emails` (new file,
`app/services/meeting_action_item_reminder_service.py`) after the bell
entries commit. Read that file in full:

- **Idempotent by design, stated in its own module docstring**:
  `meeting_action_items.reminder_emailed_on` holds the department-local day
  an item's email went out; `_send_for_org`'s query excludes any item whose
  `reminder_emailed_on` is today or later, so a second run that day sends
  nothing for an already-emailed item. Send, then stamp, then commit
  per-member (crash between the two repeats a reminder, not harm per pitfall
  #36).
- **Org-scoped throughout.** `_send_for_org(db, org_id, reminders)` re-fetches
  `MeetingActionItem` rows filtered on both `.id.in_(...)` **and**
  `.organization_id == org_id`, and the `User` query is filtered on
  `User.organization_id == org_id` too — defense in depth even though the ids
  passed in already came from an org-scoped query one call up. A failure for
  one org's batch is caught, rolled back, and logged (`org_id` as a logger
  argument, not spliced — pitfall #33 compliant); other orgs' batches are
  unaffected since each is its own `_send_for_org` call.
- **HTML-escaped.** `_email`'s body interpolates `item.description`,
  `urgency(...)` and the meeting title through `html.escape` before building
  the `<li>`; the link is also escaped before being placed in `action(...)`.
- **No double-email with the sibling runner.** The module docstring states
  why: `MinutesReminderService` (the `minutes_action_item_reminders` task)
  already emails _minutes_ action items on the department's own schedule,
  and this file deliberately emails _meeting-record_ items only — the two
  item types are disjoint tables (`MeetingActionItem` vs. minutes'
  `ActionItem`), so there is no overlap to double-send.

## Route inventory

Unchanged since pass 1 — re-confirmed by AST against current `scheduled.py`
(0 diff since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                                                                                           |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                                                                                              |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — grep of `permissions.py` finds `SYSTEM_RUN_TASKS` only in its own definition and the permission catalog; only the global `*` wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **`SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`/`_MANUAL_ONLY_TASKS`
  are fully consistent (80/80/79+1)** — re-verified by `ast.walk` over all
  four dict/set literals, not by eyeballing the registry comment or trusting
  a prior pass's count: `SCHEDULE − TASK_RUNNERS = ∅`,
  `TASK_RUNNERS − SCHEDULE = ∅`, `(TASK_RUNNERS − TASK_INTERVALS_SECONDS) −
_MANUAL_ONLY_TASKS = ∅`, `TASK_INTERVALS_SECONDS − TASK_RUNNERS = ∅`. The
  one manual-only entry (`scheduled_emails`, driven by `main.py`'s own
  60-second loop) is unchanged since pass 9.
- **The in-process scheduler's claim-renewal mechanism (app-review CRON-40,
  ✅ FIXED 2026-10-04) is unaffected by this window's diff.** `git log
--since="2026-11-01" -- backend/main.py backend/app/core/
background_claim.py` finds no commit touching either file (only the one
  large, unrelated history-boundary merge). All seven new tasks are
  automatically covered by the renew-per-task loop in
  `_run_scheduled_task_cycles` because they are in `TASK_INTERVALS_SECONDS`
  (confirmed by the registry-consistency check above) — nothing had to
  special-case them, and nothing bypasses the claim-protected dispatch.
  `_try_claim_background_task`'s and `_renew_background_task_claim`'s
  documented fail-open-on-Redis-outage posture is unchanged (read directly,
  `backend/main.py:1608-1647`).
- **None of the seven new tasks' per-org/per-record loops can mix one
  org's or department's data into another's response or email** — every
  read and write inside each new runner's loop body filters by the specific
  `organization_id` the outer loop (or, for `quickbooks_sync`, the loop's
  own first query) is currently on; nothing passes a bare, org-unfiltered id
  into a by-id lookup (CLAUDE.md pitfall #14 / checklist #3).
- **CRON-31-7 is fixed, and has been since 2026-10-05 — the "still open"
  claim carried in passes 7 through 12 (security-review) and app-review pass
  6 was stale, not a live defect.** Direct read of
  `run_end_of_shift_summary` (`scheduled_tasks.py:3759-3766`) shows
  `if email_ok if email_due else in_app_ok: newly_sent.append(uid)` — a
  member is marked "sent" only once their email actually went (when one was
  due) or once the in-app notice was written (when none could go), exactly
  as `6e59402af` ("fix(scheduled-tasks): stamp an end-of-shift summary sent
  only once its email went", 2026-10-05) describes and as
  `docs/security-review/CRON6-31-scheduled-tasks.md` (pass 6, the pass that
  shipped the fix) and `docs/KNOWN_LIMITATIONS.md`'s own `CRON-31-7/8` entry
  both already correctly record. Passes 7-12 of this track, and app-review's
  pass 6, re-asserted "still open" without re-reading this specific code —
  propagating a stale finding is exactly the class of error Step 2/3 of this
  skill exists to prevent. Corrected in `docs/app-review/scheduled-tasks.md`
  (see Schema & migration notes / doc corrections below); `KNOWN_LIMITATIONS.md`
  needed no change, since it was already right.

## Findings

No new defects found this pass. One stale finding corrected (see above and
"Doc corrections" below) — not a code change, a documentation one.

## Re-confirmed still open, unchanged — not re-applied

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list (`_for_each_org`'s `results.append({"org_id": org_id,
"error": str(e)})`, confirmed unchanged at `scheduled_tasks.py:998`),
  bypassing `safe_error_detail()`. Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`.
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by explicit design comment (confirmed unchanged at
  `scheduled_tasks.py:1777-1783`: `if not recipients: ... reminders_sent ...
continue`).
- **The Redis-down fallback still fails open** — `_try_claim_background_task`
  returns `True` when Redis is unreachable (`main.py:1619-1622`), confirmed
  unchanged by direct read. Unchanged and still the considered trade-off.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with every pass since —
nothing to update there this pass.

## Doc corrections

- **`docs/app-review/scheduled-tasks.md`'s "Re-verified, still open" bullet
  for CRON-31-7 was removed.** It had been re-asserted as open across
  multiple passes (the file's own pass 6, 2026-11-02, and the security-review
  track's passes 7-12) despite having been fixed on 2026-10-05
  (`6e59402af`) and correctly recorded as fixed in that same file's pass-6
  section and in `KNOWN_LIMITATIONS.md`. Replaced with a one-line note
  pointing to the already-correct history, so a future pass reading only the
  "still open" bullets does not inherit the stale claim again.
- `docs/KNOWN_LIMITATIONS.md`'s `CRON-31-7/8` entry needed no change — it
  already states CRON-31-7 was settled 2026-10-05 and only the other two
  items stand.

## Schema & migration notes

No new migration touching this feature's own tables this pass.
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The seven new
tasks' own tables/columns (`quickbooks_connections`, `advance_statements`,
`member_dues.late_fee_applied`/`due_reminder_sent_at`/
`overdue_reminder_sent_at`, `fiscal_year` notification metadata via
`NotificationLog`, `meeting_action_items.reminder_emailed_on`) belong to
Finance (05), Medical screening (09), Training core (17) and Meetings &
minutes (24)'s own migrations respectively, and are reviewed there — this
pass checked only that each one is in fact a migration-backed column (not a
`create_all`-only addition masquerading as one) by confirming each appears in
a real Alembic revision via `grep`, not that the migration itself is correct
(out of this feature's scope).

## Guard tests added

None this pass — no new defect found to guard against. Each new delegate's
own idempotency/locking already carries dedicated test coverage from the
commit that introduced it (Finance batch 10/11, the medical-screening and
training-milestone commits), not added by this review. The
`meeting_action_item_reminder_service` is covered by tests added with
`7884706fa`.

## Completion gate

| Check                                                                      | Result                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)             | ✅ 0 violations                                                     |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)    | ✅ clean, 3116 files unchanged                                      |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned) | ✅ clean                                                            |
| `python3.13 scripts/validate_migrations.py --strict`                       | ✅ 757 revisions, single head `09f0171ccf5e`                        |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)                  | ✅ 80/80, up from 73                                                |
| `python3 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 305 routes, 0 errors/warnings, unchanged                         |
| `python3.13 -m pytest tests/test_scheduled_task_coverage.py -q`            | ✅ 5 passed                                                         |
| Scoped `pytest` (scheduled-task/cron + all seven new delegates)            | ✅ 351 passed, 1 pre-existing skip (`pywebpush`), 0 failed, 177.06s |
| `cd frontend && npm run typecheck`                                         | ✅ 0 errors                                                         |
| `cd frontend && npm run lint`                                              | ✅ 0 errors/warnings                                                |

Scoped selection: `-k "scheduled_task or cron or scheduler or quickbooks or
dues_late_fee or dues_reminder or fiscal_year_due or advance_statement or
medical_screening_expiry or program_milestone or meeting_action_item or
action_item_reminder"` against `backend/tests/` — 351 passed, 1 skipped,
29443 deselected in 177.06s.
