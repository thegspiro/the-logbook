# Security Review — Feature 31: Scheduled Tasks (pass 5)

**Prefix:** `CRON5` · **Iteration:** 31 (pass 5) · **Reviewed:** 2026-10-04

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(**6,452 L, 47 task runners** — grown from pass 4's 6,084 L / 44 runners;
`SCHEDULE`/`TASK_RUNNERS` still exactly 1:1), plus `backend/main.py`'s
in-process scheduler (`_scheduled_task_loop`, `_scheduled_email_loop`,
`_try_claim_background_task`) re-checked for regression since pass 4.
**Frontend:** none — unchanged.
**Migrations:** `20260924_2304_b1eb0458782a_inventory_nfc_audit_schedule.py`
added the `inventory_nfc_audit_digests` table this window (not written this
pass — pre-existing, verified sound).

---

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, then all four prior
security-review passes in full — `CRON2-31-scheduled-tasks.md` (pass 1, PR
#1915), `CRON-31-scheduled-tasks.md` (pass 2, PR #2095), `CRON3-31-scheduled-
tasks.md` (pass 3, PR #2362), `CRON4-31-scheduled-tasks.md` (pass 4, PR
#2525) — and `docs/app-review/scheduled-tasks.md` (the sibling application-
review track, passes 1/2/5, most recently 2026-09-09). No `docs/module-audit/`
doc exists for this feature. Every finding any of these left open was
re-verified against current code at its current location, not re-derived.

**Delta-focused.** Pass 4's merge commit for the two endpoint files is
`fb94aa36` (PR #2525). Diffed `fb94aa36..HEAD`: `scheduled.py` — zero
changes; `scheduled_tasks.py` — **+533/−138 lines**, three new registered
tasks (`property_return_reminders`, `inventory_audit_digest`,
`prospect_attendance_advance`) plus a repo-wide rewiring of every email send
in this file onto a new shared email-preference module
(`app/services/email_policy.py`) and a new org-local-"today"/timezone module
(`app/utils/org_timezone.py`). `main.py`'s diff (+27 lines) is unrelated to
the scheduler — a link-domain pub/sub listener and a public branding router
wired into the same `lifespan()` function; the scheduler's own code
(`_try_claim_background_task`, `_scheduled_task_loop`, `_scheduled_email_loop`)
has **zero** diff since pass 4, confirmed by direct read, not just the stat
line.

**The full diff was read, not summarized from `--stat`.** Every new task
runner, both new helper modules, and every call site rewired onto them were
read end to end against all seven checklist dimensions, per the brief's
"grown substantially since last pass → full scrutiny" standard. The
~6,100 lines outside this diff and outside what re-verifying prior findings
required were **not** re-read line-by-line this pass — pass 2 did that full
read 6,452 lines ago; this pass trusts it for unchanged code, per the
established convention of passes 3 and 4.

**A finding from the sibling app-review track needed re-verification, not
re-discovery.** `docs/app-review/scheduled-tasks.md`'s pass 5 (2026-09-09,
four days before this feature's own security-review pass 4) flagged
`main.py`'s claim-renewal logic as HIGH (CRON-40 there — see below). Pass 4
of this track did not mention it. Re-verified directly against current
`main.py`: still present, unchanged. See Findings — flagged.

## Route inventory

Unchanged since pass 1 — re-confirmed against current `scheduled.py` (0 diff
since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                                                                                                                                                                             |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | `grep -n '"system\.'` against `permissions.py`: only its own declaration line (`:485`) and the unrelated new `system.manage_link_domain` (`:494`, a different feature). Re-verified granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. CRON4-31-1's audit-log-before-run fix is present and unchanged (lines 60-79). |

## Verified good ✅ (re-confirmed from pass 4, no regressions)

- **Registry sync, 47/47** — verified with a direct Python import
  (`set(SCHEDULE) == set(TASK_RUNNERS)`, every `TASK_RUNNERS` key present in
  `TASK_INTERVALS_SECONDS` or `_MANUAL_ONLY_TASKS`), not by reading the dict
  literals. Grown from 44 at pass 4 by exactly the three new tasks below.
- **`system.run_tasks` isolation** — unchanged, re-verified as above.
- **CRON4-31-1 (audit trail on manual trigger)** — present, unchanged,
  `scheduled.py:69-79`.
- **CRON3-31-1 (stranded-delivery sweep's `Organization.active` filters)** —
  re-read in full at its current location; unchanged.
- **CRON-31-1 through 6 (per-org/per-item commit-rollback isolation across
  `run_publish_scheduled_messages`, `run_action_item_reminders`'s minutes
  branch, `run_shift_reminders`, `run_rolling_recurrence_extend`,
  `run_external_training_auto_sync`)** — all re-read at their current
  (shifted) line numbers; logic byte-for-byte unchanged apart from the
  email-policy/org-timezone rewiring reviewed fresh below.
- **CRON2-31-1 through 11 (the original `_for_each_org`/`.isnot(False)`
  fixes)** — re-confirmed unchanged.
- **The in-process scheduler's single-worker lease and sequential
  execution** (`main.py:1739-1815`) — unchanged since pass 2; still a real
  guard against the _same_ task overlapping itself on the leader worker.

### New since pass 4 — reviewed fresh, not spot-checked

**`run_property_return_reminders`** (`scheduled_tasks.py:858-869`) — a thin
wrapper over `PropertyReturnReminderService.process_reminders`, which the
app-review track already hardened (CRON-6, `Decimal` money fix, pass 2) and
which org-scopes its own query (`User.organization_id == organization_id`,
`property_return_reminder_service.py:82-87`). Routed through `_for_each_org`,
so it inherits the active-org filter and per-org commit/rollback for free.
`DEPARTURE_NOTICES` (the email kind that covers "property return reminders"
per `email_policy.py:148`) is `required=True`, correctly not gated behind
`member_receives_email` — a department cannot let a departed member opt out
of being told what property they still owe back.

**`run_inventory_audit_digest`** (`scheduled_tasks.py:4365-4470`) — org-scoped
throughout: `InventoryNfcAuditDigest.organization_id == org_id` (the weekly-
send dedup check), `InventoryAuditScheduleService.list_schedule(org_id, ...)`
(itself filters `StorageArea.organization_id == org_id`,
`inventory_audit_schedule_service.py:96-98`), and
`_stock_alert_recipients(db_session, org_id, ...)` for the recipient list —
all server-resolved org ids from the `_for_each_org` loop, never client
input. Email HTML escapes every free-text field it interpolates
(`_html.escape(place)` for storage area/location names,
`_html.escape(audit_url)` for the link href); `row["audit_frequency"].value`
is an enum, not user text. **Correctly avoids the CRON-31-7 anti-pattern**:
`if success_count <= 0: return 0` — the digest row (and therefore the
weekly-dedup clock) is only written when the send actually succeeded, so a
failed send is retried the next day rather than silently marked delivered.
New table `inventory_nfc_audit_digests` has a migration
(`20260924_2304_b1eb0458782a`), a non-nullable `CASCADE` FK to
`organizations` (no SET NULL/nullable mismatch), and an index on
`(organization_id, sent_at)` matching the query that reads it.

**`run_prospect_attendance_advance`** (`scheduled_tasks.py:6094-6196`) — does
**not** use `_for_each_org` (a manual org loop, since its callback isn't the
`int`-returning shape that helper expects) but reproduces its invariants by
hand, correctly: `select(Organization.id).where(Organization.active.isnot(
False))` for the org list (explicit comment citing CRON2-31-10's precedent),
and a per-org `try`/`await db.commit()`/`except: await db.rollback()` block —
the CRON-1 shape, present and correct. Each prospect is resolved through
`MembershipPipelineService.get_prospect(prospect_id, organization_id)`, which
filters `ProspectiveMember.id == prospect_id AND .organization_id ==
organization_id` (`membership_pipeline_service.py:1510-1516`) — the
"resolve through an already-org-scoped parent" shape (Pitfall #14's
correct-(b) pattern), not a bare by-id query. `_try_auto_advance_step`
(the method this ultimately calls) catches both its expected "stage gate
not satisfied yet" `ValueError` and any other exception internally and
returns `False` rather than raising, so a single prospect's failure cannot
poison the org's shared session for the next prospect in the same org — the
per-org commit/rollback above is this function's actual safety net, and
nothing here needs the `needs_refresh` pattern CRON-31-1/4/6 required,
because this task never re-reads a pre-fetched ORM object's attributes after
a rollback (each prospect is freshly re-fetched by `get_prospect` from inside
`_try_auto_advance_step`).

**`app/services/email_policy.py`** (451 L, new since pass 4, consumed by
~10 call sites in this file) — reviewed as consumed here, not as its own
feature (it is shared infrastructure messaging/notifications owns). Every
public function degrades safely on malformed input: `department_required_
kinds` returns `frozenset()` for a non-`Mapping` settings blob or a
non-list stored value (`email_policy.py:350-362`); `member_choice` ignores a
non-bool stored choice and falls through to the legacy preference / default
(`:409-415`). `is_required`/`member_receives_email` take `department_required`
as a **required** positional argument specifically so a new call site cannot
forget it and accidentally let a department-mandated email be opted out of —
verified every one of this file's ~10 new call sites threads
`department_required_kinds(org)` through, none hand-rolls the old two-flag
(`email_notifications`/`event_reminders`) check it replaces.

**`app/utils/org_timezone.py`** (135 L, new since pass 4) — `scheduling_
timezone` wraps `ZoneInfo(...)` in `try/except`, falling back to
`America/New_York` on a malformed stored timezone string rather than raising
out of a scheduled task (matches the pre-existing pattern this file already
used inline before the helper existed). `_org_todays` (the batch form,
`scheduled_tasks.py:131-141`) filters `Organization.active.isnot(False)` —
correct precedent citation (CRON2-31-10) in its own docstring.

## Findings — fixed

None this pass. No defect requiring a code fix was found in the new surface
or in re-verifying the standing findings.

## Findings — flagged, not fixed

### CRON-40 (app-review, re-verified here) — HIGH — the scheduler's claim renewal is still an unconditional write, not a renewal

**What:** re-verified directly against current `main.py` (lines 1558-1570,
1686-1815, unchanged since pass 4 and, per `git log`, since well before it).
`_try_claim_background_task`'s helper is SETNX-only; both loops' periodic
"renew the claim" step is a bare `redis_client.set(key, pid, ex=ttl)` with no
`xx`, no comparison against the stored value, and no code path that ever
exits the loop. This is `docs/app-review/scheduled-tasks.md`'s pass-5 finding
(2026-09-09), already mirrored into `docs/KNOWN_LIMITATIONS.md` as HIGH/Open.
Not re-derived here — re-confirmed present, because **this feature's own
pass 4** (2026-09-13, four days _after_ app-review found it) reviewed this
exact code ("the in-process scheduler's single-worker lease... unchanged,
same accepted trade-off as pass 2/3") without naming CRON-40 specifically, so
this pass closes that gap by re-stating the re-verification explicitly rather
than letting a reader infer pass 4 covered it.

**Where:** `backend/main.py:1717-1726` (`_scheduled_email_loop`'s renewal),
`:1803-1812` (`_scheduled_task_loop`'s renewal).

**Why flagged, not fixed, in this pass:** this is the same owner-decision
call app-review's pass 5 and `KNOWN_LIMITATIONS.md` already made — the
correct fix (compare-and-swap renewal, stand down when the claim is lost)
changes worker-coordination behavior in production startup code, which this
rotation's own convention treats as needing a decision outside a review
pass, not a drive-by. Re-applying that same call here rather than
re-litigating it.

**Noteworthy for whoever picks this up next:** a complete, tested fix for
this exact finding already exists, unmerged, on branch
`claude/cron-40-scheduler-claim-cas` (2 commits: `684206938` "fix(scheduler):
renew the worker claim only while it is still ours (CRON-40)" and `d86ca07cd`
"docs(app-review): record the CRON-40 completion gate", both dated
2026-10-04, same day as this pass) — a new `app/core/background_claim.py`
with a Lua-script CAS renewal, both loops standing down to the claim-waiting
state rather than exiting outright, a fixed `release_claim` that only drops
what the calling worker itself holds, and `tests/test_scheduler_claim_
renewal.py` (237 lines, run against real Redis for the Lua-script half).
**No pull request exists for it** — `list_pull_requests` (head=that branch,
state=all) returns empty. This pass did not merge, cherry-pick, or build on
that branch: it belongs to the app-review track (not this security-review
rotation) and inspecting, let alone adopting, another in-flight branch's
unreviewed work is outside this pass's scope. Recorded here only as a
pointer so the fix is not reinvented or lost. Flagged to the user directly
in this iteration's report as well.

### CRON2-31-12, CRON2-31-13, CRON-31-7, CRON-31-8, CRON4-31-2 — re-confirmed still open, unchanged

No new information this pass; not re-applied, per the rotation's rule
against re-reporting a prior pass's considered, unresolved call. Re-read at
their current (shifted) locations since the file grew 368 lines:

- **CRON2-31-12** — `run_action_item_reminders`'s `MeetingActionItem` branch
  still has no `Organization` join/active filter at all
  (`scheduled_tasks.py:916-923`). Its per-item `today` lookup now falls back
  to a global default timezone's today (`fallback_today`) for an item whose
  org isn't in the `_org_todays()` map — i.e., the same latent gap, now also
  meaning a (hypothetically) deactivated org's items would be dated against
  the wrong calendar in addition to still being processed at all. Still
  latent (nothing sets `Organization.active = False` today); still flagged
  as a structural change too large for a drive-by (joining two different
  action-item tables through two different parent tables to `Organization`).
- **CRON2-31-13** — `admin_hours_service.py` still has no `log_audit_event`
  call anywhere (`grep -n "log_audit_event" app/services/admin_hours_
service.py` → no matches). Still the owning feature's design decision.
- **CRON-31-7** — `run_end_of_shift_summary` still appends to `newly_sent`
  unconditionally after a per-member send attempt regardless of whether
  either channel actually succeeded (`scheduled_tasks.py:3079`, was `:2972`
  at pass 4). Same narrow exposure analysis as pass 2: `db.add()` is
  in-memory only at that point, the real persistence failure mode is already
  caught at the org-commit level.
- **CRON-31-8** — `run_event_reminders` still stamps a due interval as sent
  with zero recipients, by the same explicit design comment
  (`scheduled_tasks.py:1212`, was `:1122` at pass 4).
- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching, so a manual trigger can still race the in-process scheduler's
  own run of the same task. Unchanged; still the same accepted risk class as
  the Redis-down fallback and CRON-40 above.

## Schema & migration notes

One migration landed in this window —
`20260924_2304_b1eb0458782a_inventory_nfc_audit_schedule.py`, adding
`inventory_nfc_audit_digests` (and the `storage_areas.audit_frequency`
column it schedules against). Not written this pass; reviewed as part of
the new `run_inventory_audit_digest` task above — FK is `nullable=False` with
`ondelete="CASCADE"` (no SET NULL/nullable mismatch), single head confirmed
by `validate_migrations.py --strict` below. No other schema change in this
feature's own tables this pass.

## Guard tests added

None this pass — no new defect to guard against. The three new tasks already
carry test coverage from their owning features
(`tests/test_property_return_reminder_schedule.py` /
`test_property_return_reminder_service.py`, `tests/test_inventory_nfc_audit_
schedule.py`, `tests/test_pipeline_stage_auto_advance.py`), all re-run clean
below.

## Completion gate

| Check                                                                                                              | Result                                                               |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                      | ✅ 0 violations                                                      |
| `black --check app/ tests/ alembic/`                                                                               | ✅ clean (1,853 files unchanged)                                     |
| `isort --check-only app/ tests/ alembic/`                                                                          | ✅ clean (isort 9.0.1, CI's pin — already installed in this sandbox) |
| `python3 scripts/validate_migrations.py --strict`                                                                  | ✅ 509 revisions, single head `d058b5e7c1f4`                         |
| `python3 -c "set(SCHEDULE) == set(TASK_RUNNERS)"` registry check                                                   | ✅ 47/47, no drift                                                   |
| Scoped `pytest` (19 files: every scheduled-task/cron isolation test, plus the 3 new tasks' own feature test files) | ✅ 221 passed, 0 failed                                              |
| `cd frontend && npm run typecheck`                                                                                 | ✅ 0 errors (no frontend files touched this pass)                    |
| `cd frontend && npm run lint`                                                                                      | ✅ 0 errors, 0 warnings                                              |

Scoped test files: `test_cron_org_loop_isolation.py`,
`test_property_return_reminder_schedule.py`,
`test_property_return_reminder_service.py`, `test_property_return_service.py`,
`test_scheduled_email_active_org.py`, `test_scheduled_email_group_isolation.py`,
`test_scheduled_task_coverage.py`, `test_scheduled_task_manual_trigger_audit.py`,
`test_scheduled_tasks_structure.py`, `test_shift_scheduled_tasks.py`,
`test_inventory_nfc_audit_schedule.py`, `test_pipeline_stage_auto_advance.py`,
`test_message_delivery_claim_recovery.py`, `test_message_delivery_service.py`,
`test_action_item_reminders.py`, `test_rolling_recurrence_extend_isolation.py`,
`test_external_training_auto_sync_isolation.py`, `test_retention_service.py`,
`test_inventory_notification_group_isolation.py`, `test_audit_shipping.py`.
