# Application Review — Scheduled Tasks & Cron

**Prefix:** `CRON` · **Iteration:** A3 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1 (endpoints gated; SCHEDULE/TASK_RUNNERS in sync — now 39/39;
Pitfall-#12 dedup writes assign fresh dicts; the 8 CRON-1 inline runners roll back).
The sweep found the **pass-1 CRON-1 fix was incomplete** — three sibling org-loops
were never covered — plus a money-precision gap. **6 fixes.**

### CRON-5 — MED — Three more org-loops could poison the shared session / lose cross-org work — ✅ FIXED

CRON-1 established that a per-org loop over a shared `AsyncSession` must commit each
org and roll back a failed one, or one org's failed flush poisons the session and
every *later* org fails too (self-concealing as "many orgs broken"). Pass-1 fixed 8
runners but missed:
- **`run_shift_auto_checkout`** — the worst: it *had* a rollback but **deferred its
  commit** to a single tail commit, so a late org's rollback discarded **every
  earlier org's** checkouts + reminders (and re-sent them next run). Now commits
  per org; tail commit removed.
- **`run_compliance_auto_reports`** and **`run_officer_directory_sync`** — inline
  loops with no per-org commit and no rollback. Both now commit per org + roll back
  a failed one.
- **`cert_alert_service.run_daily_cert_alerts`** (endpoint-invoked, not a registered
  runner) — added the rollback.
1 DB-free regression test pins the isolation (`test_cron_org_loop_isolation.py`).

### CRON-2b — LOW — `run_daily_cert_alerts` didn't skip inactive orgs — ✅ FIXED

The registered `_for_each_org` path filters `Organization.active.isnot(False)`; this
endpoint-invoked sibling selected *all* orgs, so a decommissioned department would
still be mailed. Aligned to the same filter.

### CRON-6 — LOW-MED (money) — Overdue-property reminder totalled chargeable value as float — ✅ FIXED

`property_return_reminder_service` summed the outstanding-property value (shown to
the member and persisted to the `Numeric` `total_value_outstanding`) as `float` —
the FIN-7 / LIFE-1 class. Now accumulated as `Decimal` (per-item output values kept
`float` for the existing JSON shape). Also guarded the bare `ZoneInfo(org.timezone)`
in `_to_local` with the same fallback the runners use — `process_reminders` has no
surrounding try, so a malformed stored zone would have aborted the whole run.

**Flagged (not fixed):** the naive `datetime.now()` in `run_rolling_recurrence_extend`
(line 4019) — converting to `timezone.utc` risks a naive-vs-aware `TypeError` against
the DB datetime it's compared to (aiomysql return-type dependent), so it needs a
verified-against-DB change, not a drive-by; the `run_rolling_recurrence_extend`
rollback (SELECT-only body, low risk); and the `cert_alert_service` per-record N+1
(perf). CRON-4 (raw `str(e)` to the System Owner) stands.

---

**Backend:** `app/api/v1/endpoints/scheduled.py` (60 L, 2 endpoints),
`app/services/scheduled_tasks.py` (4570 L, **38 task runners**),
`app/services/cert_alert_service.py` (541 L),
`app/services/property_return_reminder_service.py` (456 L)
**Frontend:** none — tasks are driven by the operator's cron
**Docs:** the `SCHEDULE` registry is the source of truth; no standalone doc

---

## Scope

Both endpoints; the `SCHEDULE`/`TASK_RUNNERS` registries in full; the shared
`_for_each_org` helper; and the org-iteration, error-handling, dedup and
timezone behavior of the runners. Individual task *business logic* was sampled
(event reminders, shift reminders, auto-checkout, low-stock alerts, end-of-shift
summary) rather than read line-by-line across all 38 — at 4570 L that would not
be an honest single-iteration claim. The findings below are structural and
therefore apply across the whole file; per-task logic belongs to each feature's
own iteration.

## Verified good ✅

- **Both endpoints are correctly gated, and the gating is well-reasoned.**
  `POST /run-task` requires `system.run_tasks` (the wildcard System Owner) with
  a docstring explaining why: each task iterates *every* organization, so
  triggering one has platform-wide side effects that a single-org admin must not
  be able to cause. `GET /tasks` requires `admin.access` or `settings.manage`.
- **`SCHEDULE` and `TASK_RUNNERS` are exactly in sync — 38/38, no drift** in
  either direction. A registry entry with no runner would be advertised to
  operators but un-triggerable; a runner with no entry would have no documented
  cadence. Now locked by a test.
- **Per-org error isolation is the right design** — one org's failure is logged
  and collected into the response rather than aborting the run.
- **Reminder dedup is real and correctly implemented.** Sent intervals are
  recorded (`reminders_sent`, `start_reminder_sent`,
  `eos_checklist_reminder_sent`) so a re-run does not re-send. Notably these
  live in JSON columns but **avoid Pitfall #12**: the code assigns a *new* dict
  via `{**custom, "reminders_sent": ...}` rather than shallow-copying and
  mutating a nested value, so SQLAlchemy sees a genuine change and issues the
  UPDATE. Had this used `dict(...)` plus nested mutation, every reminder would
  have re-sent on every run.
- **Timezone handling is correct** in the day-level reminder path: the org's
  IANA timezone is resolved with a sane fallback, the reminder instant is
  computed in *local* time, then converted to UTC for comparison — not the naive
  "UTC hour" approximation this class of code usually gets wrong.

## Findings

### CRON-1 — MED — 8 of 9 org loops never rolled back, so one bad org broke the rest of the run — ✅ FIXED

**What:** `_for_each_org` catches a per-org exception, records it, and then
rolls the session back — with a comment stating exactly why: *"The orgs share
one session; roll back the failed unit of work so a broken commit doesn't leave
the session in a failed state that cascades into every later org's callback."*
**Eight other runners re-implement that same loop inline and none of them
rolled back.**

**Where:** `run_event_reminders`, `run_post_event_validation`,
`run_post_shift_validation`, `run_shift_reminders`, `run_end_of_shift_summary`,
`run_trainee_report_escalation`, `run_series_end_reminders`,
`run_shift_auto_checkout` — all in `scheduled_tasks.py`.

**Impact:** after a failed flush, SQLAlchemy leaves the session in a failed
transaction state and every subsequent `execute()` raises `PendingRollbackError`.
So a single failing organization silently truncated the task for **every
organization processed after it** — shift reminders never sent, auto-checkouts
never performed, end-of-shift summaries never delivered. The failure is
self-concealing: the response reports an error for each subsequent org too, so
it reads as "many orgs are broken" rather than "one org poisoned the session".
Alphabetical/insertion ordering decides who is affected, which is why this would
present as intermittent and org-specific.

**Fix:** added the same guarded rollback to all eight, mirroring the helper and
citing it. Locked by `test_org_loops_roll_back_on_failure`, which was verified to
actually fail when a rollback is removed (it reported
`assert ['run_event_reminders'] == []`) — a structural test that cannot fail is
worthless, so this was checked rather than assumed.

### CRON-2 — LOW (latent) — Tasks processed deactivated organizations — ✅ FIXED

**What:** all 9 org-iterating queries were a bare `select(Organization)` with no
filter on `Organization.active`.

**Impact:** *latent, not live.* `Organization.active` exists (indexed, defaults
True) but **nothing in the codebase ever sets it False** — there is no org
deactivation or suspension flow — so no inactive org exists to be wrongly
processed today. The moment one is built, all 38 tasks would keep mailing,
texting and pushing to members of a decommissioned department, and the bug would
be spread across nine call sites rather than one.

**Fix:** all nine now filter `Organization.active.isnot(False)` — deliberately
*not* `== True`, so a row whose flag was never populated still counts as active.
That makes the change a provable no-op against today's data while making the
whole task set correct in advance. Locked by
`test_org_selects_skip_deactivated_organizations`.

### CRON-3 — LOW — `POST /run-task` docstring listed 5 of 38 tasks — ✅ FIXED

**What:** the endpoint's docstring enumerated five task ids as "Available
tasks". There are 38, and the list had gone stale as runners were added.

**Impact:** documentation only — the endpoint dispatches from `TASK_RUNNERS`, so
the other 33 always worked — but an operator reading the API docs would conclude
they were the only ones manually triggerable.

**Fix:** replaced the hand-maintained list with a pointer to `GET
/scheduled/tasks`, which is generated from the same registry and therefore
cannot drift.

### CRON-4 — LOW — Raw exception strings returned to the trigger caller — OPEN

**What:** every runner puts `str(e)` into its result payload
(`{"org_id": ..., "error": str(e)}`), which `POST /run-task` returns to the
caller, bypassing `safe_error_detail()`.

**Impact:** low — the endpoint requires `system.run_tasks`, i.e. the platform
System Owner, who is already the most privileged principal. But it is the one
place in the codebase where an unsanitized DB exception (potentially carrying
SQL fragments or table names) is returned in an API response by design.

**Why not fixed:** these strings are also the operator's only debugging signal
for a failing task, and `safe_error_detail` would flatten most of them to "An
unexpected error occurred" — a net loss for the person who needs them. The right
fix is to log the full exception and return a correlation id, which is a small
design change rather than a substitution.

## Duplication

**`_for_each_org` has eight inline re-implementations** — this is the finding
behind CRON-1 and CRON-2. Both defects existed *only* in the copies; the shared
helper was correct in both respects. The copies exist for a real reason: the
helper's callback contract returns a bare `int`, while these eight need richer
per-org result payloads (`in_app_reminders`, `emails_sent`, `auto_checkouts`, …).

Consolidating means widening the helper's contract to accept a dict result and
migrating eight large functions — worth doing, but it is a refactor of ~1500
lines of notification logic and does not belong in the same change as a
correctness fix. Recorded as future development; the two structural tests now
prevent the *next* copy from losing the same guards, which is the cheaper half
of the benefit.

## Dead code

None found. All 38 runners are reachable through `TASK_RUNNERS`, and the
registry symmetry test now guarantees none becomes orphaned.

## Documentation gaps

- Fixed: the stale task list (CRON-3).
- **Not fixed — no operator-facing scheduling doc.** `SCHEDULE` carries a
  `cron` expression per task, but nothing tells an operator that these must be
  installed in a real crontab/Celery beat, what happens if a task is never
  scheduled (silently nothing — no alerting on a task that stops running), or
  that `recommended_time` values assume a particular server timezone. For a
  self-hosted deployment this is the gap most likely to produce "reminders
  stopped working and nobody noticed". Belongs with the deployment docs.

## Future development

1. **No task-run observability.** Nothing records that a task ran, when it last
   succeeded, or how long it took. A task silently not firing — a crontab typo,
   a container without the scheduler — is invisible until a member complains
   that reminders stopped. A `task_runs` table plus a staleness check would
   close it, and would also give `GET /tasks` something real to show.
2. **No overlap guard.** Two tasks run every 15 minutes. If one run exceeds its
   interval, a second starts concurrently against the same rows. The dedup flags
   make double-sending unlikely, but they are read-then-write with no lock, so
   concurrent runs are a real (if narrow) double-send window. An advisory lock
   per task id would close it.
3. **Consolidate the eight inline org loops** onto a widened `_for_each_org`
   (see Duplication).
4. **`property_return_reminder_service` and `cert_alert_service` were read only
   at their call sites.** Both are reminder engines with their own dedup logic
   and deserve the same structural scrutiny in the iteration that owns them
   (A6 member lifecycle, and training respectively).
5. **Errors are collected but never surfaced.** A task that fails for an org
   logs and returns the error in a payload nobody reads unless they manually
   triggered it. Cron output typically goes to `/dev/null`. Tie this to item 1.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change this iteration) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ clean (one file reformatted during the iteration, then re-verified) |
| `eslint` | ✅ clean |
| backend tests | ✅ **2501 passed, 0 failed** (was 2498 — the 3 new structural tests). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL (653 matching connection/timeout lines). |
| new tests | ✅ 3 added in `tests/test_scheduled_tasks_structure.py`, each verified to fail when its invariant is broken |
</content>
