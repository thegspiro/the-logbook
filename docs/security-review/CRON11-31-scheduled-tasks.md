# Security Review — Feature 31: Scheduled Tasks (pass 11)

**Prefix:** `CRON11` · **Iteration:** 31 (pass 11) · **Reviewed:** 2026-10-30

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(**70 registered tasks, up from 68** — two new runners this pass, both
delegating to other features' own already-reviewed code).
**Frontend:** none — unchanged (`docs/KNOWN_LIMITATIONS.md`'s "Admin — No
Scheduled Tasks Page" entry, owner-accepted 2026-10-05, still describes the
current state).
**Migrations:** none new to this feature's own tables this pass (`weather_alerts`,
the one new table this window's diff touches, belongs to Feature 27/Integrations).

---

## Watchdog pickup

The dedicated `/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
was unreachable (confirmed via `ListAgents`, "No reachable agents"). PR #3856
(Feature 30, Onboarding, pass 11) had already merged (`6bf6ba32`);
`search_pull_requests` for `head:claude/security-review-` returned zero open
results, both before starting and again right before this push. Row 31 was
confirmed the next `⬜` row on a freshly fetched `main`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s latest pass, all ten
prior security-review passes in full (`CRON-31` … `CRON10-31`), and the
sibling `docs/app-review/scheduled-tasks.md` (app-review track, pass 5,
2026-09-09 — the scheduler-claim HIGH finding, CRON-40, already ✅ FIXED
2026-10-04 and unaffected by anything in this window). Every finding any of
these left open was re-verified against current code at its current location,
not re-derived.

**Delta-focused, full diff read.** Pass 10's baseline merge is `8213ae8f`
(PR #3786, 2026-10-27). `git log --oneline 8213ae8f..HEAD --no-merges --
backend/app/api/v1/endpoints/scheduled.py backend/app/services/scheduled_tasks.py`
over the intervening commits on `main` found exactly **3** touching either
file: `de9aade2`, `31f39cf6`, `a36d27f1`. `scheduled.py`: zero changes,
confirmed by direct re-read against pass 10's own quoted text — still 82 L,
2 routes, same docstrings, same two permission strings. `scheduled_tasks.py`:
the full unified diff (239 lines changed) was read in full, not sampled.

**Two new registered tasks.** `SCHEDULE`/`TASK_RUNNERS` re-verified by AST
(`ast.walk` over both dict literals) at **70/70** — up from 68, exactly the two
new entries below — and the two sets' keys are identical to each other
(no key in one dict missing from the other).

| New task                       | Delegate (new, read in full)             | Owning feature (status)                                                                                                                          |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `weather_alert_poll`           | `weather_alert_service.poll_department`  | Integrations (feature 27, ✅ pass 11, PR #3853) — reviewed there for org-scoping and escaping; re-read here for the scheduler-trigger angle only |
| `prospect_follow_up_reminders` | `FollowUpFormService.send_due_reminders` | Membership pipeline (feature 08) — reviewed here for the scheduler-trigger angle only                                                            |

Neither delegate's own body (announce/escaping logic for the first,
pipeline-stage logic for the second) was re-derived from scratch — each is
owned by a different rotation feature. What this pass verified independently,
because it is this feature's own concern, is **how each is wired into the
scheduler**: org-loop placement, interval registration, and whether the
delegate's own idempotency/locking actually closes the two failure modes this
layer cares about (a crashed run, and a second worker racing the same run).

### `weather_alert_poll` — wired correctly, no new finding

`run_weather_alert_poll` is a thin wrapper around `_for_each_org`, passing the
loop's own `org` object straight to `poll_department(db_session, org)` — never
a client-supplied id. `poll_department` → `poll_zone` commits the new/updated
`WeatherAlert` rows (unique on `(organization_id, nws_id)`) **before**
`announce()` sends anything, and catches the one race it can hit
(`IntegrityError` from two workers recording the same alert) with its own
`rollback()` + early return — so it never raises an exception up through
`_for_each_org`'s per-org commit/rollback wrapper in the ordinary case, and if
`announce()` itself does raise, `_for_each_org`'s existing CRON-1-class
handling (log, record, roll back, refresh the next org before continuing)
applies exactly as it does to every other runner. Registered at
`TASK_INTERVALS_SECONDS["weather_alert_poll"] = 900`, matching the SCHEDULE
entry's `*/15 * * * *` — the two cannot drift independently of each other
being re-checked, since the AST count above covers both dicts.

### `prospect_follow_up_reminders` — wired correctly, no new finding

`run_prospect_follow_up_reminders` does **not** go through `_for_each_org` —
deliberately, and correctly: `FollowUpFormService.send_due_reminders` already
does its own org-scoped query (joined through `ProspectFormRequest`/
`ProspectiveMember`/`Organization`, filtered on `Organization.active.isnot(False)`)
and its own per-row locking (`_remind_one`'s `.with_for_update()` plus a
re-check of `reminder_due` after acquiring the lock), committing or rolling
back **each candidate individually** rather than per-org. That is a stronger
isolation unit than `_for_each_org` provides, not a weaker one, so wrapping it
in `_for_each_org` would have been redundant rather than missing. Verified the
cadence constants directly: `REMINDER_INTERVAL_DAYS = 7`,
`MAX_REMINDERS = 3`, matching the task's own docstring ("every seven days, up
to three times"). Registered hourly (`3600`s), matching the SCHEDULE entry and
the documented reason (a reminder lands soon after 09:00 department-local
time without a per-department-timezone schedule entry).

## Route inventory

Unchanged since pass 1 — re-confirmed by AST against current `scheduled.py`
(0 diff since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                       |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                          |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **The new `add_in_app_copies` helper (`app/services/officer_alert_copies.py`,
  new this window) is org-scoped by construction and safe against double-runs.**
  Four existing runners (`run_inventory_low_stock_alerts`,
  `run_inventory_audit_digest`, `run_nfpa_retirement_alerts`,
  `run_supply_expiration_alerts`) now also write a bell entry alongside the
  pre-existing email, for officers whose email is turned off (owner decision
  2026-10-29, same shape as CLAUDE.md Pitfall #19's "a switch with no
  reader"). Read the helper in full: its one query filters
  `NotificationLog.organization_id == str(organization_id)`, and every call
  site passes `organization_id=str(org.id)` from the loop's own current org
  and `recipient_ids` drawn from an already org-scoped `User` query — never a
  client-supplied value, since none of these four runners takes any request
  input. `replace_unread=True` with a `dedupe_key` makes a rerun (two workers
  racing, or the same worker retried) a refresh of the existing unread row
  rather than a second one — the dedupe key is matched against unread rows
  only (`NotificationLog.read.is_not(True)`), so once an officer reads an
  entry the next run correctly starts a fresh one rather than silently
  updating a card the officer has already dismissed.
- **The new commits added mid-function (bell copies committed before the
  email loop in all four call sites) do not reintroduce the `MissingGreenlet`
  class of bug pass 2 fixed (CRON-31-2).** Confirmed `expire_on_commit=False`
  at the session-factory level (`app/core/database.py:139`) — a successful
  `commit()` does not expire already-loaded ORM instances under this
  configuration, only a `rollback()` does (and the existing
  `_for_each_org`/standalone-loop code already handles that case by
  re-reading ids before any rollback and refreshing before the next org's
  callback, unchanged by this diff). The rows each function renders into HTML
  after its mid-function commit (`low_stock`, `due`, `items_due`,
  `medical_lots`/`gear_lots`) were all loaded before that commit and are
  plain already-fetched attributes, not deferred/lazy relationships touched
  for the first time afterward.
- **`run_inventory_audit_digest`'s "nobody to email" branch now correctly
  advances the weekly gate instead of silently never recording.** Before this
  change, an organization where every qualifying officer had turned off
  quartermaster email would return `0` without writing an
  `InventoryNfcAuditDigest` row, so the daily check would retry forever.
  Read the new branch: when `emails` is empty after the bell copies are
  written and committed, it writes `InventoryNfcAuditDigest(..., recipient_count=0)`
  and commits, so the weekly gate (`AUDIT_DIGEST_MIN_GAP`) advances on the
  strength of the bell delivery alone — correct, since the bell entry is now
  a genuine delivery channel, not a no-op. The success-path behavior (record
  only after `success_count > 0`, "so tomorrow's check tries again" on a send
  failure) is unchanged.
- **`SCHEDULE`/`TASK_RUNNERS` remain 1:1 (now 70/70)**, re-verified by AST,
  not by eyeballing the registry comment or trusting a prior pass's count.
- **The in-process scheduler's claim-renewal mechanism (app-review CRON-40,
  ✅ FIXED 2026-10-04) is unaffected by this window's diff** — neither new
  task nor the `add_in_app_copies` helper touches `main.py` or
  `app/core/background_claim.py`, confirmed by the path-scoped `git log`
  above finding zero commits there since pass 10. Both new tasks are
  dispatched through the same claim-protected `_scheduled_task_loop` every
  other runner already goes through; neither opens a code path around it.

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
nothing to update there this pass either. The "NWS Weather Alerts" entry in
`KNOWN_LIMITATIONS.md` was already updated to "resolved 2026-10-29" by
Feature 27's own pass; this pass's registration of `weather_alert_poll` is
the scheduler-side half of that same already-recorded decision, not a new one
to mirror.

## Schema & migration notes

No new migration touching this feature's own tables this pass;
`scheduled_tasks.py` and `scheduled.py` own no tables directly. `weather_alerts`
(the one new table reachable through this window's diff) belongs to Feature
27/Integrations' own migration, reviewed there.

## Guard tests added

None this pass — no new defect found to guard against. The two new
delegates' own idempotency/locking already carry dedicated test coverage from
the commits that introduced them (Feature 27's weather-alert tests, Feature
08's follow-up-reminder tests), not added by this review. `add_in_app_copies`
and its four new call sites are covered by existing scheduled-task test
files, confirmed passing below.

## Completion gate

| Check                                                                      | Result                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)             | ✅ 0 violations                                            |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)    | ✅ clean, 2743 files unchanged                             |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned) | ✅ clean                                                   |
| `python3.13 scripts/validate_migrations.py --strict`                       | ✅ 678 revisions, single head `f90b1124e6f4`               |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)                  | ✅ 70/70, up from 68                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root)          | ✅ 280 routes, 0 errors/warnings, unchanged                |
| Scoped `pytest` (scheduled-task/cron + both new delegates)                 | ✅ 259 passed, 1 pre-existing skip (`pywebpush`), 0 failed |
| `cd frontend && npm run typecheck`                                         | n/a — no frontend files touched this pass                  |
| `cd frontend && npm run lint`                                              | n/a — no frontend files touched this pass                  |

Scoped selection: `-k "scheduled_task or cron or scheduler or weather_alert or
inventory_low_stock or inventory_audit_digest or nfpa_retirement or
supply_expiration or officer_alert_copies or follow_up_form or
prospect_follow_up or in_app_copies"` against `backend/tests/` — **259
passed, 1 skipped (optional `pywebpush`, unrelated), 0 failed, 26344
deselected** in 140.43s.
