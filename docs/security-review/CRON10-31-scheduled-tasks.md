# Security Review — Feature 31: Scheduled Tasks (pass 10)

**Prefix:** `CRON10` · **Iteration:** 31 (pass 10) · **Reviewed:** 2026-10-27

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py`
(68 registered tasks, **unchanged count** from pass 9 — the delta is entirely
inside existing task bodies, +230/−111 lines across 5 non-security-review
commits).
**Frontend:** none — unchanged.
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

PR #3785 (Feature 30, Onboarding, pass 10) merged 2026-10-27 ~22:48 UTC. No
`claude/security-review-*` PR was open at the time this iteration started —
confirmed via `search_pull_requests` (`is:pr is:open head:claude/security-review-`,
0 results) and `list_pull_requests` (state=open, 2 unrelated docs PRs
#3774/#3772), both checked immediately before starting. `main` (`eb3e1a50`)
already carried row 30 at ✅ (the merge commit itself marks it), so there was
nothing to record from Step 0 before beginning this feature. Row 31
(Scheduled tasks) was confirmed the next `⬜` row by reading the rotation
table directly on this freshly fetched `main`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md`'s pass 12 (latest),
all nine prior security-review passes in full (`CRON-31` … `CRON9-31`), and
the sibling `docs/app-review/scheduled-tasks.md` (app-review track, pass 5,
2026-09-09) and `docs/module-audit/scheduling.md` (a different feature —
shift _scheduling_, not scheduled _tasks_; confirmed out of scope and not
re-read). Every finding any of these left open was re-verified against
current code at its current location, not re-derived.

**Delta-focused, full diff read.** Pass 9's baseline merge is `1acb6213`
(PR #3672, 2026-10-24). `git log --oneline 1acb6213..HEAD -- scheduled.py
scheduled_tasks.py` over 350 total commits in that range found exactly
**5** touching either file (confirmed by path-scoped `git log`, not assumed
from the unscoped range): `2c95e130`, `43e46010` (+ its merge `366658c2`),
`0a7e2a9e`, `1ff282b9`. `scheduled.py`: zero changes, confirmed by direct
re-read against pass 9's own quoted text — still 82 L, 2 routes, same
docstrings. `scheduled_tasks.py`: the full unified diff (543 lines) was read
in full, not sampled; every hunk is accounted for below.

**No new registered task.** `SCHEDULE`/`TASK_RUNNERS` re-verified by AST
(not by eyeballing the registry) at **68/68**, unchanged from pass 9. The
delta is entirely new behavior inside five existing runners, reached through
four cross-feature delegates, each read in full rather than trusted from its
commit message:

| Runner (changed)                  | New delegate read in full                                                                                | Owning feature (status)                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_post_event_validation`       | `EmailTemplateService.is_switched_off`/`render_stored_or_default` (both new 2026-10-27)                  | Messaging & notifications (feature 25, ✅ as of pass 10, PR #3768 merged 13:36 UTC) — `is_switched_off` landed 15:18 UTC, **after** that pass; read in full this pass |
| `run_post_shift_validation`       | same, plus `SchedulingService._get_apparatus_map` (pre-existing, new call site)                          | same as above, plus Scheduling (feature 19/module-audit, pre-existing method, unchanged)                                                                              |
| `run_shift_reminders`             | same `is_switched_off` gate on the existing email send                                                   | same as above                                                                                                                                                         |
| `_run_scheduled_emails_inner`     | same `is_switched_off`, plus `is_always_sent`/`ALWAYS_SENT_TYPES` (both new 2026-10-27)                  | same as above                                                                                                                                                         |
| `run_compliance_auto_reports`     | `ComplianceReportService.retry_unsent_auto_emails`/`UNSENT_EMAIL_RETRY_DAYS` (new, PR #3727, 2026-10-24) | Reports & analytics / Compliance (feature 29, ✅ as of pass 12) — landed after that pass; read in full this pass                                                      |
| `run_prospect_attendance_advance` | `MembershipPipelineService.roll_forward_missed_meeting` (new, 2026-10-25)                                | Membership pipeline (feature, ✅ as of pass 13 PR #3702, merged 2026-10-25 earlier in the day) — read in full this pass                                               |

Two template-type-string fixes (`end_of_shift_summary`,
`shift_report_acknowledgment_reminder` replacing a stale copy-pasted
`"post_shift_validation"` in `run_end_of_shift_summary` and
`run_trainee_report_escalation`) are a correctness fix with no security
shape — each email was being sent under the wrong audit `template_type`
label, not the wrong content or recipient. Not a finding; noted for
completeness.

## Route inventory

Unchanged since pass 1 — re-confirmed by AST (`ast.walk` over
`scheduled.py`'s decorators, not eyeballed) against current `scheduled.py`
(0 diff since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                       |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                          |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **The per-template "switched off" gate added to four call sites in this
  file is correctly org-scoped, cannot silence a security-critical email, and
  escapes every value it interpolates.** `EmailTemplateService.is_switched_off`
  (`email_template_service.py:3509-3528`) filters
  `EmailTemplate.organization_id == str(organization_id)` — the id each call
  site passes is always the loop's own current org (`org.id`/`org_id`), never
  client input — and short-circuits `False` for
  `EmailTemplateType.CUSTOM`/`is_always_sent(template_type)` before touching the
  database, so a department cannot switch off Password Reset, IT Password
  Notification, Welcome, Ballot Notification or Application Status Link even
  by manipulating the stored row directly (`update_template` also refuses the
  change with a 400, per feature 25's own commit, confirmed read but not
  re-reviewed in full here — see cross-feature note below). The two rewritten
  senders (`run_post_event_validation`, `run_post_shift_validation`) moved
  from hand-built `wrap_email_body()` HTML strings to
  `EmailTemplateService.render_stored_or_default()`; every new context key
  they pass (`event_title`, `recipient_name`, `shift_name`, `shift_date`,
  `attendee_count`, etc.) is a plain dict value, not listed in
  `_RAW_HTML_VARIABLES` (checked the full set at
  `email_template_service.py:4303-4341` — none of the new keys appear in it),
  so `_replace_variables`'s default `escape_html=True` path
  (`email_template_service.py:4343-4375`) HTML-escapes every one of them
  before interpolation — confirmed by reading `_replace_variables` itself
  rather than trusting the docstring. `appendix_html` (the checklist/report
  list appended to the Post-Shift Validation email) is pre-escaped at its own
  construction site (`scheduled_tasks.py:2258-2270`, one `_html.escape(n)` per
  checklist name) before being handed to `render()`, matching that method's
  documented contract ("The HTML must already be escaped").
- **`run_post_shift_validation`'s new `_get_apparatus_map` call is org-scoped
  by construction.** `SchedulingService._get_apparatus_map`
  (`scheduling_service.py:838-850`) delegates to
  `resolve_apparatus_display_map(self.db, apparatus_ids, organization_id)`,
  and the call site (`scheduled_tasks.py:~2033`) passes the loop's own
  `org_id`, never a client-supplied value — the apparatus ids themselves come
  from the org-scoped `shifts` already loaded earlier in the same function.
- **`ComplianceReportService.retry_unsent_auto_emails`
  (`compliance_config_service.py:410-470`) closes the retry gap correctly for
  both Pitfall #36 (idempotency) and Pitfall #27 (locked read-then-write).**
  Read in full, including `_email_report` (`:506-640`), the method that
  actually sends: the "stamp after send" order is deliberate and documented
  in the method's own docstring (a crash between send and
  `report.emailed_at = ...; await self.db.flush()` can at most re-send the
  same report email — "for a summary with a link is the lesser harm", the
  Pitfall #36 "send, then stamp" choice, correctly reasoned for this case) and
  the duplicate-send window is itself bounded by the row lock: the SELECT
  that finds unsent reports is `.with_for_update()`
  (`compliance_config_service.py:459`), so a second concurrent run blocks
  until the first's per-org `await db.commit()`
  (`scheduled_tasks.py:6021`/`6050`) releases it and then re-reads the
  now-`emailed_at`-stamped row, which no longer matches the `is_(None)`
  filter. The call site (`scheduled_tasks.py:5942-5967`) runs the retry pass
  _before_ building `due` (new-report generation) in the same per-org
  try/except/commit block that already implements the CRON-1 class fix
  (commit per org, roll back a failed one before the next org's work), so a
  failed retry cannot poison the session for the generation step that
  follows it or for later orgs. `UNSENT_EMAIL_RETRY_DAYS = 7` is a documented,
  deliberate bound (long enough to ride out a weekend mail outage, short
  enough that a report nobody can deliver for a week stops being retried
  forever) — not an unbounded tracker in the Pitfall #9 sense, since it is a
  time-windowed SQL query, not an in-memory dict.
- **`MembershipPipelineService.roll_forward_missed_meeting`
  (`membership_pipeline_service.py:9436-9559`) is org-scoped and idempotent by
  construction, exactly as its own docstring claims — verified rather than
  trusted.** The `ProspectiveMember` lookup filters
  `organization_id == str(organization_id)` (`:9466-9469`), and every
  subsequent query (`Event`, `EventExternalAttendee`, `ProspectActivityLog`)
  is scoped through that already-org-confirmed `prospect.id` rather than
  re-filtering by org — the correct parent-resolution shape for a model with
  no direct `organization_id` column (CLAUDE.md Pitfall #14's "(b)" case).
  Idempotency (Pitfall #36): a miss is recorded once per event, keyed on
  `event_id` inside the activity log's `details` JSON and checked against
  `ProspectActivityLog.action == "meeting_missed"` before writing
  (`:9522-9532,9541-9542`), and `_auto_link_event_for_step`'s own link is
  unique on `(prospect_id, event_id)` — a second run of the nightly pass
  finds the same recorded miss and the same open link and writes nothing
  further. The call site (`scheduled_tasks.py:7361-7404`) passes `org_id`
  from the loop's own `select(Organization.id)` scan, never client input, and
  sits inside the same per-org commit/rollback block the function already
  had (CRON-1 class, unchanged structure).
- **`SCHEDULE`/`TASK_RUNNERS` remain exactly 1:1 (68/68)**, re-verified by AST
  (`ast.walk` over both dict literals, not by eyeballing the registry
  comment or trusting pass 9's count).

## Findings

No new findings this pass.

### Cross-feature note for Feature 25's (Messaging & notifications) next pass — not a Feature 31 finding

`is_switched_off`/`ALWAYS_SENT_TYPES`/`is_always_sent` and the broader
per-template kill switch (commit `0a7e2a9e`, "Stop sending an email whose
template is switched off") landed at 2026-10-27 15:18 UTC — **after**
Feature 25's own pass 10 merge (`02bdfb59`, 13:36 UTC the same day). The
commit touches `email_templates.py`'s endpoint (the 400-refusal for
`ALWAYS_SENT_TYPES`), `email_service.py` (129 lines — the shared
`_render_unless_switched_off` sixteen template-backed senders now go
through), `election_service.py`, `event_request_service.py`,
`inventory_notification_service.py`,
`property_return_reminder_service.py`, `scheduling_service.py`, and
`storefront_notification_service.py`, in addition to the four call sites in
`scheduled_tasks.py` this pass reviewed. This pass read and verified only the
`scheduled_tasks.py` call sites and the shared `is_switched_off` /
`_replace_variables` escaping mechanism they depend on (above) — the other
eight senders, the endpoint's 400-refusal path, and the new
`test_email_template_switched_off.py` (379 lines, not re-run beyond the
scoped selection below) belong to Feature 25's own scope and were not
re-read in full here, matching the precedent CRON9 set for feature 13's new
NFC surface. Flagged here so Feature 25's next lap picks the whole mechanism
up rather than assuming its own ✅ still covers code that landed after it.

### Minor note, not a finding: one extra query per shift in `run_shift_reminders`

The new `is_switched_off` check in `run_shift_reminders`
(`scheduled_tasks.py:2675-2681`) runs inside the per-shift loop rather than
once per org, adding one bounded single-row `SELECT` per shift that has a
roster and `send_email` enabled. The shift set per org per run is already
small and bounded (shifts starting inside the reminder lookahead window),
and the function already issues several other per-shift lookups, so this is
a style nit rather than an N+1/DoS concern under checklist §6 — not fixed,
not worth a drive-by change inside a security pass, noted for whichever pass
next touches this function's performance.

## Re-confirmed still open, unchanged — not re-applied

Per the rotation's rule against re-reporting a prior pass's considered,
unresolved call:

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4, re-confirmed by direct
  read this pass), so a manual trigger can still race the in-process
  scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list (e.g. `run_compliance_auto_reports`'s
  `{"org_id": ..., "error": str(e)}` at `scheduled_tasks.py:6046`, and the
  new retry path's own `retry_entry["email"] = "failed"` branch logs through
  `persist_task_error_log` rather than `str(e)` directly — consistent with
  the existing pattern, not a new instance of the gap), bypassing
  `safe_error_detail()`. Already recorded OPEN by design in
  `docs/app-review/scheduled-tasks.md`.

`CRON2-31-13` (admin-hours auto-close audit trail) remains **✅ Resolved
2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with every pass since —
nothing to update there this pass either.

## Schema & migration notes

No new migration touching this feature's own tables this pass;
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The
delegated-to modules' own tables (`compliance_reports`,
`prospect_activity_log`, `prospect_event_links`) belong to their owning
features' migrations, all pre-existing, confirmed via the read-path checks
above rather than re-verified as schema.

## Guard tests added

None this pass — no new defect found to guard against. The four new/changed
delegates read in full this pass (`retry_unsent_auto_emails`'s locking
pattern, `roll_forward_missed_meeting`'s idempotency, the `is_switched_off`
gate, the two template-type-label fixes) each already carry their own
dedicated test coverage, added alongside them in the commits that introduced
them (`test_compliance_auto_report_email_retry` and similar, per PR #3727;
`test_email_template_switched_off.py`; `test_shift_scheduled_tasks.py`
additions), not by this review.

## Completion gate

| Check                                                                      | Result                                       |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)             | ✅ 0 violations                              |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)    | ✅ clean, 2706 files unchanged               |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned) | ✅ clean                                     |
| `python3.13 scripts/validate_migrations.py --strict`                       | ✅ 666 revisions, single head `0d9897752425` |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)                  | ✅ 68/68, unchanged from pass 9              |
| `pytest tests/test_scheduled_task_coverage.py`                             | ✅ 5 passed                                  |
| Scoped `pytest` (scheduled-task/cron + all changed-delegate suites)        | ✅ see below                                 |
| `cd frontend && npm run typecheck`                                         | n/a — no frontend files touched this pass    |
| `cd frontend && npm run lint`                                              | n/a — no frontend files touched this pass    |

Scoped selection: `-k "scheduled_task or cron or scheduler or
compliance_auto_report or compliance_email_retry or prospect_attendance or
roll_forward or email_template_switched_off or post_event_validation or
post_shift_validation or shift_reminder or shift_scheduled_task or
next_meeting"` against `backend/tests/` — **252 passed, 1 skipped (optional
`pywebpush`, unrelated), 0 failed, 25807 deselected** in 173.56s.
