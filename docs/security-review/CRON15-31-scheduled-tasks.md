# Security Review — Feature 31: Scheduled Tasks (pass 15)

**Prefix:** `CRON15` · **Iteration:** 31 (pass 15) · **Reviewed:** 2026-11-25

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (83 L, 2 routes,
**unchanged since pass 4** — 0 diff by direct `git diff` against pass 14's
baseline), `backend/app/services/scheduled_tasks.py` (**91 registered tasks,
up from 88 at pass 14's merge point** — 3 new runners this pass, plus one new
side effect appended to an existing runner; see below).
**Frontend:** none — unchanged (confirmed no frontend code references
`/scheduled/tasks` or `/scheduled/run-task`).
**Migrations:** none new to this feature's own tables this pass —
`scheduled.py`/`scheduled_tasks.py` own no tables directly, as in every prior
pass. The new runners' own columns
(`training_approvals.reminder_sent_at`, pre-existing since
`20260122_0014_add_training_session_enhancements.py`;
`crr_activities.resident_details_cleared_at`, added
`20261122_1613_5c2e8a417d90_crr_activities_and_grants.py`;
`apparatus_event_seat_requests.status` widened with a new string value,
`lapsed`, on an existing `Mapped[str]` column that needs no migration) belong
to Training core, CRR Catalogue and Apparatus events respectively.

---

## Step 0

Fetched `origin` and listed open PRs for `thegspiro/the-logbook`
(`list_pull_requests`, state `open`) — **0 results**, so no PR with a head
branch starting `claude/security-review-` exists. `git status --short` was
clean, and `git pull` (fast-forward) landed local `main` on `2aa03ecdc`
(merge of PR #4707, Feature 30/Onboarding pass 15), matching this iteration's
briefing exactly. `docs/security-review/PROGRESS.md`'s rotation table was
re-read directly (not inferred from narrative) and confirmed row 31
(Scheduled tasks) is the first `⬜` after row 30's `✅`; rows 32-34 remain
`⬜`. Marked 🔄 in the working tree, not committed separately — it rides
along with this pass's own commit per the skill's instructions.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`, and
`CRON14-31-scheduled-tasks.md` (pass 14) in full, plus the sibling
`docs/app-review/scheduled-tasks.md` (app-review track, through pass 6) in
full. `docs/module-audit/` has no scheduled-tasks-specific file. Every item
either track left open was re-verified against current code at its current
location below, not re-derived.

**Delta identification.** `git diff 42f390383..HEAD -- backend/app/api/v1/endpoints/scheduled.py backend/app/services/scheduled_tasks.py`
taken directly against pass 14's own merge commit (`42f390383`, PR #4566).
`scheduled.py`: 0 diff, confirmed by full re-read (reproduced in the Route
inventory below). `scheduled_tasks.py`: +149/-0 lines — 3 new
`SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS` entries plus a new,
committed side effect appended to the existing `run_shift_auto_checkout`.
Also checked `git diff 42f390383..HEAD -- backend/main.py
backend/app/core/background_claim.py`: `background_claim.py` is 0 diff;
`main.py` changed (+105/-16) but every hunk is outside the scheduler loop,
the claim/renewal functions and `_try_claim_background_task` (confirmed by
line-range comparison against the hunks reported — the changes are a new
migration-recovery helper and two new public-history router mounts,
unrelated to this feature and out of its scope).

**Registry re-count, not trusted from the prior pass's number.** Walked
`SCHEDULE`, `TASK_RUNNERS`, `TASK_INTERVALS_SECONDS` and `_MANUAL_ONLY_TASKS`
by `ast.walk` (handling both the `Assign` and `AnnAssign` forms, as pass 14
did) rather than reusing its count:

| Registry                 | Count                  |
| ------------------------ | ---------------------- |
| `SCHEDULE`               | 91                     |
| `TASK_RUNNERS`           | 91                     |
| `TASK_INTERVALS_SECONDS` | 90                     |
| `_MANUAL_ONLY_TASKS`     | 1 (`scheduled_emails`) |

`SCHEDULE − TASK_RUNNERS = ∅`, `TASK_RUNNERS − SCHEDULE = ∅`,
`(TASK_RUNNERS − TASK_INTERVALS_SECONDS) − _MANUAL_ONLY_TASKS = ∅`,
`TASK_INTERVALS_SECONDS − TASK_RUNNERS = ∅`. 88 (pass 14) + 3 new = 91,
confirmed exactly.

**Three new registered tasks:**

| New task                         | Delegate                                                                                                       | Owning feature (reviewed there)                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `apparatus_seat_request_lapse`   | `ApparatusEventService.lapse_unanswered_requests` → `apparatus_seat_request_notices.send_seat_request_notices` | Apparatus events (new feature area)                             |
| `training_approval_reminders`    | `training_approval_reminders.send_approval_reminders`                                                          | Training core (Feature 17)                                      |
| `crr_resident_details_retention` | `CrrActivityService.clear_expired_resident_details` (own org loop, not `_for_each_org`)                        | CRR Catalogue (new feature area, not yet in the rotation table) |

Read each delegate in full for the two things this layer owns — idempotency
and org-scoping — not the business logic, which belongs to its owning
feature, matching pass 14's convention.

### The three new tasks — wired correctly, no new finding

- **`apparatus_seat_request_lapse`** — `lapse_unanswered_requests`
  (`apparatus_event_service.py:1590-1631`) selects only
  `organization_id == org_id`-filtered, still-`pending` requests whose event
  has started, been cancelled, or had attendance finalized, under
  `.with_for_update(of=ApparatusEventSeatRequest)`. Stamp (close the request
  and commit), then send (Pitfall #36: a crash between the two costs one
  member a notice, never repeats one) — the docstring states this order
  explicitly, and the code matches it: `await self.db.commit()` runs before
  `send_seat_request_notices` is called from the runner. A second run's
  `WHERE status == 'pending'` finds nothing left, so a manual trigger racing
  the scheduler (CRON4-31-2, still open generally — see below) cannot double
  -close or double-email the same request. The notice layer
  (`apparatus_seat_request_notices.py`) re-reads each request/event by
  `organization_id`-filtered id before composing the email, never raises out
  of `deliver()` (caught and logged), and is explicitly email-only (Pitfall
  #18, stated in its own module docstring) — no `SmsAlert` entry.
- **`training_approval_reminders`** — `send_approval_reminders`
  (`training_approval_reminders.py`) filters every join on
  `organization_id == org_id` (approval, session and event all three), and
  the "which approval" subquery (`~select(newer.id)...exists()`) correctly
  restricts to the newest, still-live approval per session so a superseded
  roster is never chased. Idempotent via a **conditional UPDATE** claim
  (`_claim`, `:115-139`): `TrainingApproval.reminder_sent_at` is set only
  when `status == PENDING` and the stamp is absent (first reminder) or
  predates `created + 14d` (second reminder), committed immediately, and the
  claim's own `rowcount` decides whether to actually send — a second worker
  or a re-run finds the UPDATE affects 0 rows and sends nothing. The two
  -reminder cap (7 days, then 14, then stop) is enforced by the same
  predicate. No SMS (Pitfall #18, stated in the module docstring); the
  reminder's own `_send` loop catches per-recipient exceptions so one bad
  address does not stop the rest.
- **`crr_resident_details_retention`** — does **not** use `_for_each_org`
  (its own org loop, mirroring `attendance_waiver_expiry`'s precedent from
  pass 14: a per-org `try`/`commit`/`except`/`rollback` so one department's
  failure does not poison the shared session for the rest — confirmed
  present at `scheduled_tasks.py`'s new `run_crr_resident_details_retention`).
  Skips deactivated orgs the same way `_for_each_org` does
  (`Organization.active.isnot(False)`). Idempotent by a **stamp read back on
  every query**: `clear_expired_resident_details`
  (`crr_activity_service.py:609-649`) selects only
  `organization_id`-filtered rows with `resident_details_cleared_at IS NULL`
  and `occurred_at < cutoff`, so a second run (or a restart mid-sweep) finds
  nothing left to clear — a cleared row is permanently excluded by its own
  stamp, not by a time window that could re-admit it. `retention_months()`
  (`crr_catalogue_service.py:35-45`) reads the org's JSON setting
  defensively — a missing or malformed value (including a bare `bool`, which
  `isinstance(value, int)` would otherwise accept since `bool` subclasses
  `int` in Python) falls back to the 24-month default rather than "keep
  forever" or "clear now" (CLAUDE.md Pitfall #19's "absence must mean current
  behaviour" rule, applied correctly). The audit event written per
  organization (`event_type="crr_resident_details_retention"`) carries only
  `organization_id` and a count — no resident name, address or note reaches
  the audit log (CHECKLIST §5, PII absent from audit payloads).

None of the three takes a client-supplied id anywhere in this file — every id
comes from the loop's own current org or (for the CRR task's own loop) that
loop's first, org-scoped query, never from a request. No new
`.like()`/`.ilike()`, no new CSV export, no new raw SQL in this window's
diff.

### `run_shift_auto_checkout` — a new side effect appended, reviewed for the scheduler-wiring angle — no new finding

The existing runner now also credits an outreach signup sheet's hours through
its event once an auto-checkout closes it
(`sync_sheet_attendance`, imported from the new
`app/services/outreach_sheet_credit.py`). Reviewed here because it lands
inside this feature's shared runner; the crediting logic itself belongs to
Events/Scheduling.

- **Org-scoping is correct.** `closed_outreach_sheets` is populated only
  from `shifts`, which is queried `WHERE Shift.organization_id ==
str(org.id)` for the loop's current org (`scheduled_tasks.py:7513-7518`);
  `sync_sheet_attendance(db, sheet_id, org_id)` is then called with that same
  `org_id`, and every query inside it (`Shift`, `EventRSVP`, `Event`) is
  itself filtered on the `organization_id` argument it was passed
  (`outreach_sheet_credit.py:185-244`) — no cross-org leak path.
- **Committed after the checkout, before the credit, per sheet.** The new
  block runs after `await db.commit()` closes the auto-checkout batch for
  the org, and wraps each sheet's `sync_sheet_attendance` call in its own
  `try`/`commit`/`except`/`rollback`-and-log
  (`scheduled_tasks.py:7625-7639`), so one sheet's failure costs only that
  sheet's credit and never the checkouts already committed, and never the
  next sheet in the list.
- **Idempotent by construction, not by a sent-flag.** `sync_sheet_attendance`
  is a compare-and-correct mirror (`_mirror`, `outreach_sheet_credit.py:113
-160`): it diffs the RSVP's stored fields against the sheet's own
  check-in/out times and only writes what differs, and `credit_admin_hours_
for_rsvp` is keyed on the RSVP id, which is what the module's own docstring
  states prevents double-crediting a member checked in on both the sheet and
  the event. Running the same sheet through this path twice (two
  auto-checkout cycles, or a crash-and-retry) settles the same RSVP rather
  than creating a second one — verified by reading `sync_sheet_attendance`'s
  full body, not assumed from the docstring's claim.
- **Locking read matches CLAUDE.md Pitfall #27.** The event row is
  `.with_for_update()`-locked before the RSVPs are read, and the RSVP read
  is itself `.with_for_update()` — not a plain `SELECT` that could answer
  from a pre-lock snapshot — so a concurrent finalize and this mirror cannot
  interleave.

## Route inventory

Unchanged since pass 4 — re-confirmed by full re-read of the current
`scheduled.py` (83 L, 2 routes) against pass 14's own table:

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                            |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                               |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry; only the global `*` wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. No per-task lock (CRON4-31-2, still open). |

## Verified good ✅

- **`SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`/`_MANUAL_ONLY_TASKS`
  are fully consistent (91/91/90+1)** — re-verified by a fresh `ast.walk` over
  all four dict/set literals this pass, not reused from pass 14's number (see
  Scope and method above).
- **Every one of the three new runners is covered by its own dedicated test
  coverage**, shipped by the commit that introduced it, not added by this
  review: `test_training_approval_reminders.py` (registration, dedup timing,
  newest-approval-only, cross-org isolation, dead-link exclusion — 9 tests),
  `test_apparatus_event_seat_requests.py` (lapse behaviour, including a test
  naming `scheduled_tasks.run_apparatus_seat_request_lapse` directly), and
  `test_crr_activities.py` (imports and calls
  `run_crr_resident_details_retention` directly). `test_outreach_sheet_credit.py`
  covers the mirror's compare-and-correct behaviour the new auto-checkout
  side effect depends on. All confirmed present and passing in the scoped
  run below.
- **None of the three new tasks' per-org/per-record loops, nor the new
  `run_shift_auto_checkout` side effect, can mix one org's or department's
  data into another's response or email** — every read and write inside each
  new runner's own scope filters by the specific `organization_id` the outer
  loop (or, for the CRR task's own loop, that loop's own first query) is
  currently on (CLAUDE.md Pitfall #14 / CHECKLIST §3).
- **The in-process scheduler's claim-renewal mechanism (app-review CRON-40)
  is unaffected by this window's diff.** `git diff 42f390383..HEAD --
backend/app/core/background_claim.py` is empty, and `main.py`'s diff this
  window touches migration recovery and two new public-history router
  mounts only — none of its hunks fall inside the scheduler loop, the claim
  functions, or `_try_claim_background_task`/`_renew_background_task_claim`
  (confirmed by direct re-read of those functions, lines 1673-1700+, against
  the diff hunk line ranges). All three new tasks are automatically covered
  by the renew-per-task loop because they are present in
  `TASK_INTERVALS_SECONDS` (confirmed by the registry-consistency check
  above).
- **The pre-existing 2-head Alembic fork pass 14 flagged is now resolved.**
  `validate_migrations.py --strict` now reports a single head
  (`e9cf8ab7e4e4`), confirming PR #4560 (which pass 14 deferred to) has since
  merged. Nothing left to flag here.

## Findings

No new defects found this pass.

## Re-confirmed still open, unchanged — not re-applied

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list (`_for_each_org`'s `results.append({"org_id": org_id,
"error": str(e)})`, re-confirmed unchanged at `scheduled_tasks.py:1098`,
  and the same pattern repeats at the other `_for_each_org`-derived call
  sites), bypassing `safe_error_detail()`. Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`. (The three new runners this pass do
  not add a new instance of the pattern — `crr_resident_details_retention`'s
  own loop logs `org_id` and the exception via `logger.error("... {}: {}",
organization.id, exc)` and does not put `str(exc)` into its returned
  payload at all, following `pending_file_deletions`' stricter precedent
  from pass 14 rather than repeating CRON-4.)
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by explicit design comment (re-confirmed unchanged at
  `scheduled_tasks.py:2013-2016`, "Mark all due intervals as sent" runs
  unconditionally after the send loop regardless of how many sends
  succeeded).
- **The Redis-down fallback still fails open** — `_try_claim_background_task`
  returns `True` when Redis is unreachable (`main.py:1673-1686`), confirmed
  unchanged by direct read. Unchanged and still the considered trade-off.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`; `CRON-31-7` remains correctly
recorded as fixed (2026-10-05). Nothing to update in either doc this pass —
no new owner-decision item surfaced.

## Schema & migration notes

No new migration touching this feature's own tables this pass.
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The three new
tasks' own columns (`training_approvals.reminder_sent_at`, pre-existing;
`crr_activities.resident_details_cleared_at`, added by a prior, already
-applied migration; `apparatus_event_seat_requests.status`'s new `lapsed`
string value, which needs no migration since the column is a plain
`Mapped[str]`, not a native DB enum) belong to Training core, CRR Catalogue
and Apparatus events' own migrations respectively, and are reviewed there —
this pass checked only that each is in fact migration-backed where a
migration was needed (confirmed above), not that the migration itself is
correct (out of this feature's scope). The pre-existing 2-head Alembic fork
flagged by pass 14 is now resolved to a single head — see "Verified good"
above.

## Guard tests added

None this pass — no new defect found to guard against. Each new delegate's
own idempotency/locking already carries dedicated test coverage from the
commit that introduced it (see "Verified good" above), not added by this
review.

## Completion gate

| Check                                                                                         | Result                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                | ✅ 0 violations                                                                                  |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                       | ✅ clean, 3541 files unchanged                                                                   |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                    | ✅ clean                                                                                         |
| `python3.13 scripts/validate_migrations.py --strict`                                          | ✅ single head (`e9cf8ab7e4e4`), 844 revisions — the 2-head fork pass 14 flagged is now resolved |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST, handling `AnnAssign`)               | ✅ 91/91, up from 88                                                                             |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)                          | ✅ 344 routes, 0 errors/warnings                                                                 |
| `python3.13 -m pytest tests/test_scheduled_task_coverage.py -q`                               | ✅ 5 passed                                                                                      |
| Scoped `pytest` (scheduled/cron/background_claim + all three new delegates + outreach credit) | ✅ 256 passed, 1 pre-existing skip (`pywebpush`), 0 failed, 181.01s                              |
| `cd frontend && npm run typecheck`                                                            | ✅ 0 errors                                                                                      |
| `cd frontend && npm run lint`                                                                 | ✅ 0 errors/warnings                                                                             |

Scoped selection: `-k "scheduled or cron or background_claim or
apparatus_seat_request or training_approval_reminder or crr_activit or
outreach_sheet_credit"` against `backend/tests/` — 256 passed, 1 skipped,
33321 deselected in 181.01s.
