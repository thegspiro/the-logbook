# Security Review — Feature 31: Scheduled Tasks (pass 8)

**Prefix:** `CRON8` · **Iteration:** 31 (pass 8) · **Reviewed:** 2026-10-21

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py` (grown
to **67 registered tasks**, up from pass 7's 65 — `SCHEDULE`/`TASK_RUNNERS`
still exactly 1:1), plus 2 newly-registered task runners delegating into one
new and one existing service module.
**Frontend:** none — unchanged.
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

PR #3517 (Feature 30, Onboarding, pass 8) merged 2026-10-21 ~12:10 UTC. No
`claude/security-review-*` PR or branch existed for Feature 31 at the time
this iteration started (`search_pull_requests`, `is:pr is:open
head:claude/security-review-`, 0 results, checked once before starting and
again immediately before branching). The dedicated `/loop 30m
/security-review` session this rotation depends on had produced no new
branch or PR in the ~2.5 hours since that merge (no reachable agent via
`ListAgents` either). This iteration picked up the next `⬜` row from outside
that loop, per `docs/security-review/PROGRESS.md`'s row 31.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, all seven prior
security-review passes in full (`CRON-31` … `CRON7-31`), and the sibling
`docs/app-review/scheduled-tasks.md` track. Every finding any of these left
open was re-verified against current code at its current location, not
re-derived.

**Delta-focused, full diff read.** Pass 7's baseline merge is `320aa866`
(PR #3384, 2026-10-17). Diffed `320aa866..HEAD` (2026-10-21): `scheduled.py`
— zero changes; `scheduled_tasks.py` — **+118/−21 lines**.

**2 new task runners.** Checked each new/changed delegate's owning feature
and last-touch date against that feature's most recent security-review pass,
to avoid re-reviewing what another pass already covers:

| New runner                          | Delegates to                                                                            | Owning feature (status)                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weekly_security_report`            | `security_weekly_report.py` (new, 2026-10-16 23:36 UTC)                                 | Security, audit & IP — **already reviewed in SEC2-28 pass 8** (PR #3475, merged 2026-10-20 15:30 UTC, names this file by name) — not re-read        |
| `directory_account_departure_check` | `DirectoryAccountService.check_departed_suspensions` (new method, 2026-10-20 18:46 UTC) | Integrations — **not yet covered**: INT-27 pass 8 (PR #3467) merged 2026-10-20 14:48 UTC, **before** this method was added — read in full this pass |

## Route inventory

Unchanged since pass 1 — re-confirmed against current `scheduled.py` (0 diff
since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                               |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                  |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. CRON4-31-1's audit-log-before-run fix present, unchanged. |

## Verified good ✅

- **`check_departed_suspensions` (`directory_account_service.py:999-1087`) is
  correctly org-scoped end to end.** The listing query filters both
  `DirectoryAccountProvision.organization_id` and `User.organization_id` to
  the caller's org; the entry point (`run_directory_account_departure_check`,
  `scheduled_tasks.py`) is invoked through `_for_each_org`, which hands it
  `str(org.id)` per org. The only external call it makes
  (`directory_for(integration).list_users(domain)`) lists the one domain
  configured on that org's own connected integration — no cross-tenant read.
  Matched records are re-suspended through `reconcile_suspension`, which
  reloads the row by `(organization_id, user_id)` under `lock=True`
  (`_load`) before writing, so the sweep cannot act on another org's row even
  if a `user_id` collided. The audit event it writes
  (`log_audit_event(..., organization_id=str(organization_id))`) carries only
  `target_user_id` — no PII in the payload.
- **The two new tasks both have registry entries in all three dicts.**
  `SCHEDULE`, `TASK_RUNNERS` and `TASK_INTERVALS_SECONDS` each carry
  `weekly_security_report` (hourly check, documented as sending at most weekly
  per org) and `directory_account_departure_check` (daily). Verified by direct
  read of all three dicts' diffs and by script
  (`set(SCHEDULE) == set(TASK_RUNNERS)`, 67/67, up from pass 7's 65) rather
  than eyeballing a long literal.
- **A real read-then-write race in the scheduled-email sender is now closed,
  and matches the cancel endpoint's own lock.** `_run_scheduled_emails_inner`
  (`scheduled_tasks.py:4108-4123`) re-reads
  `ScheduledEmail.status` under `.with_for_update()` immediately before
  sending each row, skipping it if a concurrent cancel already flipped it off
  `PENDING`. `cancel_scheduled_email` and `update_scheduled_email`
  (`email_templates.py:1040-1141`) take the identical
  `.with_for_update()` lock on the same row, so a cancel and a send now
  serialize instead of racing on the sender's unlocked initial batch read —
  the exact read-then-write shape CLAUDE.md Pitfall #27 describes, applied
  here to a status flag rather than a capacity count. Guarded by
  `test_a_row_cancelled_after_the_batch_was_read_is_not_sent`
  (`test_cancel_and_stage_delete_audit.py`), which simulates the cancel
  landing inside the send loop and asserts the row stays `CANCELLED`, not
  sent. This is ordinary engineering work landed independently of this
  review, re-verified by direct read rather than taken on its commit message.
- **`run_notify_expired_passwords` now follows Pitfall #32.** The query gates
  on `User.status.in_(ACTIVE_ACCOUNT_STATUSES)` (`scheduled_tasks.py:7314`,
  via the `app.models.user` import added this diff) instead of
  `== UserStatus.ACTIVE`, so a probationary member's password-expiry notice
  is no longer silently skipped. Re-verified against `tests/
test_account_status_gates.py`'s sweep, which does not list this call site in
  its `ALLOWED` literal-comparison exceptions — consistent with the fix, not
  a gap in the sweep.
- **`run_mark_overdue_dues` now derives its predicate from the same place the
  dues screens do.** The hand-rolled `WHERE` clause was replaced with
  `dues_past_due_unpaid_clause(now)` from `finance_service.py` — the Pitfall
  #29 shape (a screen/task must consume a shared rule, not re-derive it) —
  so what this task persists into the `OVERDUE` column is exactly what
  `effective_dues_status` already reports live. Read both the clause's
  definition and this call site; no divergence.
- **`run_rolling_recurrence_extend`'s new RSVP-deadline carry-forward is
  correctly computed per-occurrence, not copied verbatim.** The new
  occurrence's deadline is derived via `rsvp_deadline_lead` from the latest
  occurrence's own start and deadline, then re-applied to each new start with
  `rsvp_deadline_at` — so a series with a "3 days before" deadline keeps a
  3-day lead on every generated occurrence rather than inheriting one fixed
  timestamp. Out of this feature's own security scope (Events, already ✅),
  read only to confirm it introduces no new org-scoping surface — it does
  not; the query it extends from was already org-scoped pre-existing code.
- **`run_supply_expiration_alerts`'s compartment-path display change keeps
  escaping on every part.** The new `compartments` list (a full path rather
  than a single compartment name) is still passed through the same
  `_html.escape(str(part))` generator expression as before — no new
  unescaped interpolation. Medical Supplies' own feature is ✅; read only for
  this file's local correctness.

## Findings

No new findings this pass.

## Re-confirmed still open, unchanged — not re-applied

Per the rotation's rule against re-reporting a prior pass's considered,
unresolved call:

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4), so a manual trigger can
  still race the in-process scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from every runner still reaches
  `POST /run-task`'s response, bypassing `safe_error_detail()`
  (`scheduled.py`, 0 diff since pass 4). Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`.

`CRON2-31-13` (admin-hours auto-close audit trail) is already recorded
**✅ Resolved 2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with pass 7's
re-verification — nothing to update there this pass either.

## Schema & migration notes

No new migration touching this feature's own tables this pass;
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The two new
delegated-to modules' own tables (`security_alert`/`error_log`, read-only
here; `directory_account_provisions`, written here) belong to their owning
features' migrations, both pre-existing and out of this pass's scope to
re-verify.

## Guard tests added

None this pass — no new defect found to guard against. The row-lock fix and
the Pitfall #32 fix each carry their own dedicated or sweep-level test
coverage, added alongside them in the same commits (not written by this
review).

## Completion gate

| Check                                                                           | Result                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `flake8==7.3.0 app/ tests/ alembic/`                                            | ✅ 0 violations                                            |
| `black==26.5.1 --check app/ tests/ alembic/`                                    | ✅ clean                                                   |
| `isort==9.0.1 --check-only app/ tests/ alembic/`                                | ✅ clean                                                   |
| `python3 scripts/validate_migrations.py --strict`                               | ✅ 634 revisions, single head `1eb43da769b2`               |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check                             | ✅ 67/67, no drift (up from pass 7's 65)                   |
| Scoped `pytest` (scheduled-task/cron + new-runner suites), full                 | ✅ 162 passed, 1 skipped (optional `pywebpush`, unrelated) |
| Scoped `pytest`, unit-only (`-m "not integration and not slow and not docker"`) | ✅ 71 passed, 1 skipped                                    |
| `cd frontend && npm run typecheck`                                              | n/a — no frontend files touched this pass                  |
| `cd frontend && npm run lint`                                                   | n/a — no frontend files touched this pass                  |

Scoped selection: `-k "scheduled_task or cron or scheduler or
directory_departure or security_weekly_report or mark_overdue_dues or
dues_past_due"` against `backend/tests/` — 162 passed, 1 skipped, 22720
deselected, 59.71s (full run, DB available); 71 passed, 1 skipped, 22811
deselected, 120.71s (unit-only run, to confirm no DB-backed test is
mis-marked per Pitfall #30b — none found: `test_security_weekly_report.py`
and `test_directory_departure_check.py` both mark their `db_session`-using
classes `@pytest.mark.integration` individually).
