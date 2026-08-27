# Security Review — Feature 31: Scheduled Tasks

**PR:** #1915
**Files:** `backend/app/api/v1/endpoints/scheduled.py`,
`backend/app/services/scheduled_tasks.py` (5,446 L, ~44 task runners),
plus services reached by individual runners:
`inventory_notification_service.py`, `retention_service.py`,
`integration_services/salesforce_service.py`.

This is the cron/background-job layer. The prior app-review pass
(`docs/app-review/scheduled-tasks.md`) explicitly says it did **not** read
line-by-line across all 38 runners ("at 4570 L that would not be an honest
single-iteration claim") — it reviewed structural patterns and sampled a
few. The file has since grown to 5,446 lines (+19%, now 44 runners). This
pass did the line-by-line read the prior one skipped, via four parallel
background agents covering the file by line range.

No criticals. Twelve real findings (four MED, the rest LOW), all traceable
to two established risk classes this file already has names for:

- **CRON-1/CRON-5 shape** — a loop over multiple units (orgs, or any other
  key) on one shared `AsyncSession` must commit each unit's success and
  roll back a failed unit, or a failed flush poisons the session and every
  _later_ unit in the loop silently fails too, misreported as its own
  independent failure. The original CRON-1/CRON-5 fixes covered the 11
  runners that loop directly over `Organization` rows; this pass found the
  same shape recurring in three places that don't (a delegated service, an
  inline per-item email loop, and a delegated org loop with zero isolation
  at all).
- **CRON-2 shape** — every org-iterating query must filter
  `Organization.active.isnot(False)`. The original fix covered the 9
  direct `select(Organization)` queries; this pass found the same gap in
  runners that iterate a _child_ table keyed by `organization_id` instead,
  which the original fix's own regression test (AST-matching for the
  literal string `select(Organization)`) structurally cannot see.

Registry sync re-verified: `SCHEDULE`/`TASK_RUNNERS` still exactly 1:1,
grown from 38/39 to 43/43, no drift.

## Findings — fixed

### CRON2-31-1 — MED — `InventoryNotificationService.process_pending_notifications` had no per-group commit/rollback

**File:** `backend/app/services/inventory_notification_service.py`

Grouped by `(org_id, user_id)` on a shared session, with a single trailing
`commit()` after the whole loop and no `rollback()` in its `except`. A
failed group left the session poisoned for every later group in the batch
(same class as the original CRON-1), invisible to the existing structural
test since the loop lives outside `scheduled_tasks.py` and isn't keyed on
`Organization` at all.

**Fix:** commit after each group's outcome (three exit paths: net-out
skip, no-email skip, sent/not-sent), roll back on a failed group — mirrors
`_for_each_org`.

### CRON2-31-2 — MED — `run_post_shift_validation` never excluded cancelled shifts

**File:** `backend/app/services/scheduled_tasks.py`

The query filtered `Shift.is_finalized.is_(False)` but not
`Shift.status != ShiftStatus.CANCELLED`. A cancellation leaves
`is_finalized` `False` forever, so every cancelled shift whose original
`end_time` fell in the lookback window generated a bogus "validate
attendance" notification and email to its officer — the common case, since
most cancellations happen at or near the original shift time.

**Fix:** added the missing filter, matching the convention used throughout
`scheduling_service.py`.

### CRON2-31-3 — MED — Reminder dedup flags stamped permanently `True` even when nothing was sent

**File:** `backend/app/services/scheduled_tasks.py` (`run_shift_reminders`'s
`start_reminder_sent`; `run_end_of_shift_checklist_reminders`'s
`eos_checklist_reminder_sent`, two of its three exit points)

When a shift had no assignments yet / no apparatus yet / no templates
resolved yet, the code set the dedup flag to `True` anyway before
`continue`-ing — permanently silencing that shift's reminder even if the
missing precondition (a crew assigned, an apparatus set) was satisfied
later in the same reminder window. Indistinguishable from working
correctly: no error, just a shift the crew never got reminded about.

**Fix:** removed the premature flag-set on all three "not ready yet" exit
paths — they now just `continue` without stamping, so the next run
re-checks.

### CRON2-31-4 — LOW — `run_end_of_shift_checklist_reminders` notified deactivated members

**File:** `backend/app/services/scheduled_tasks.py`

Its assignment lookup had no `User.is_active` filter, unlike its sibling
`run_shift_reminders`, which explicitly documents why one is needed ("a
member assigned before being deactivated should not receive reminders").

**Fix:** joined `User` and added the same filter.

### CRON2-31-5 — MED — `run_scheduled_emails` had no per-item commit/rollback isolation

**File:** `backend/app/services/scheduled_tasks.py`

Up to 100 pending emails spanning arbitrary orgs, processed on one shared
session with a single trailing `commit()`. One item's failed flush left
the session poisoned for every later item (misreported as its own
failure), and the eventual commit/rollback at the outer transaction
boundary could discard every earlier item's already-`SENT` status,
re-sending an email a member already received on the next run.

**Fix:** commit per item on every exit path (three early `continue`s plus
the sent/not-sent fall-through); on exception, try to record the failure
and commit it as its own unit, falling back to a roll-back-and-retry-next-run
if the session itself is what's broken.

### CRON2-31-6 — MED — `RetentionService.enforce()` had zero per-org isolation, and its PII-bearing deletes were never audit-logged

**File:** `backend/app/services/retention_service.py`

Unlike every other multi-org runner in this file, the org loop had no
try/except at all — one org's transient DB error (a lock timeout, a
dropped connection) would propagate uncaught, discarding every earlier
org's already-flushed-but-uncommitted deletions and 500ing the whole
nightly run for every org. Separately: this service deletes PII-bearing
rows at scale on a recurring, unattended schedule (applicant
`form_submissions`, public `guest_check_ins`) with no audit trail of what
was purged, when, or how many rows — unlike `run_audit_log_archival`,
which does log its own archival operation.

**Fix:** commit per org on success, roll back on a failed org (mirroring
`_for_each_org`); added a `log_audit_event()` call per org when that org
had any deletions (silent when nothing was deleted, to avoid noise). Left
the query's `Organization.active` scope unchanged — deliberately, with a
comment: retention exists specifically to keep stale PII from piling up,
so a decommissioned department's data is the case this most needs to run
against, not an exception to it (this is a considered call, not the
CRON-2 gap — see the flagged item below for the parallel case that _is_
the gap).

### CRON2-31-7 — LOW — `run_audit_log_archival`'s except block didn't roll back

**File:** `backend/app/services/scheduled_tasks.py`

Designed to return a graceful `200` with a partial-results/errors payload
on failure, but never called `db.rollback()` — so a DB-level failure that
dirtied the session (the common case) left the session poisoned, and
`get_session()`'s own outer commit-then-rollback-and-reraise turned the
intended graceful response into an unhandled 500 anyway, one layer up from
where the bug looks like it lives.

**Fix:** added the same `try: await db.rollback() except Exception: pass`
used everywhere else in this file.

### CRON2-31-8 — LOW (latent) — `run_officer_directory_sync` used a bare `where(Organization.active)`

**File:** `backend/app/services/scheduled_tasks.py`

Every other org-active filter in this file is `.isnot(False)` specifically
so a row whose flag was never populated (`NULL`) still counts as active.
This one query used the bare truthy form, which excludes `NULL` — an org
inserted outside the normal ORM path would be silently, permanently
skipped from directory sync.

**Fix:** `.isnot(False)`, matching every other call site.

### CRON2-31-9 — MED, SSRF-adjacent — Salesforce's cached-access-token path never validated `instance_url`

**File:** `backend/app/services/integration_services/salesforce_service.py`

`instance_url` is org-admin-editable config, validated against
`_INSTANCE_URL_RE` only on the token-refresh paths. `_ensure_access_token()`
returns a cached token without ever calling `_refresh_access_token()`
whenever one is already stored — the common case for a connected
integration. `_api_url()`, the one call site every outbound request goes
through regardless of token state, built URLs from the unvalidated value.
An org admin (or an attacker who compromises one, a materially lower bar
than compromising the platform) setting `instance_url` to an internal
address, with a cached token still present, turns the unattended 30-minute
sync task into a repeating SSRF beacon with the org's bearer token attached.

**Fix:** validate in `_api_url()` itself, unconditionally. 2 regression
tests added (`test_api_url_rejects_untrusted_instance_url_on_the_cached_token_path`,
`test_api_url_accepts_a_valid_instance_url`).

### CRON2-31-10 — INFO, now safely fixable — naive-datetime issue in `run_rolling_recurrence_extend`

**File:** `backend/app/services/scheduled_tasks.py`

Flagged-not-fixed by the prior review pending exactly this verification:
`datetime.now()` (naive local server time) compared against
`DateTime(timezone=True)` columns. This pass verified, via two other sites
in the same file that already handle this, that aiomysql returns these
columns **naive-but-conceptually-UTC** on this stack — so the prior
review's feared aware/naive `TypeError` doesn't materialize, but the
comparison was only correct by accident of the server's TZ being UTC.

**Fix:** `datetime.now(timezone.utc).replace(tzinfo=None)` — stays naive
(no `TypeError`) but is now actually UTC.

### CRON2-31-11 — LOW (latent) — three more org-scoped loops skipped the active filter entirely

**File:** `backend/app/services/scheduled_tasks.py`
(`run_compliance_auto_reports`/`ComplianceConfig`,
`run_external_training_auto_sync`/`ExternalTrainingProvider`,
`run_salesforce_auto_sync`/`Integration`)

Same shape as CRON2-31-8/the original CRON-2, but these three don't
literally `select(Organization)` — they iterate a child table keyed by
`organization_id` — so they fell outside both the original fix and its
regression test's detection heuristic.

**Fix:** joined `Organization` and added `.isnot(False)` to all three.

## Findings — flagged, not fixed

### CRON2-31-12 — LOW (latent) — `run_action_item_reminders` has no org loop at all, so it was never in scope for CRON-2

**File:** `backend/app/services/scheduled_tasks.py`

Queries `MeetingActionItem`/`MinutesActionItem` platform-wide by status and
due date, with no join back to `Organization.active` at all — structurally
different enough from every other runner (no org loop, not even a
child-table-keyed one) that it dodges the CRON-2 fix, this pass's
CRON2-31-11 extension of it, and the regression test. Latent today for the
same reason CRON-2 originally was (nothing sets `Organization.active =
False` yet). Left flagged rather than fixed: closing it means joining two
different action-item tables through two different parent tables
(`Meeting`, `MeetingMinutes`) to `Organization`, which is enough
structural change to warrant its own careful pass rather than a bundled
drive-by inside an already-large fix set.

### CRON2-31-13 — LOW — `run_admin_hours_auto_close` has no audit trail

**File:** `backend/app/services/admin_hours_service.py`
(`auto_close_stale_sessions`, called from `scheduled_tasks.py`)

Force-closes a member's open admin-hours session and flips its status —
a money-adjacent (paid-hours) state change with no `log_audit_event()`
call anywhere in the file, unlike `run_audit_log_archival` and (after this
pass) `RetentionService.enforce()`. Left flagged: what to log (per-session
vs. one batched summary event, matching which pattern) is a design choice
the owning feature (admin hours) should make deliberately, not something
to bolt on inside this rotation's pass.

## Verified good (re-confirmed, no regression)

CRON-1 (org-loop commit/rollback on the original 11 runners plus every new
one added since — `run_event_reminders`, `run_post_event_validation`,
`run_shift_auto_checkout`'s "worst" deferred-tail-commit fix, `run_series_end_reminders`,
`run_trainee_report_escalation`, `run_end_of_shift_summary`), CRON-2 (the
original 9 direct `Organization` queries plus `_for_each_org` itself),
CRON-6 (storefront payment reminders still use `Decimal`, no regression),
Pitfall #12 JSON-dedup writes (every dedup flag in the file uses the safe
new-dict/deepcopy pattern except the three sites fixed above), Pitfall #18
SMS-allowlist (`run_publish_scheduled_messages` still routes through
`resolve_sms_recipients`/`SmsAlert`), election-lifecycle invariants
(resolves through the real service methods, doesn't bypass them). No SQL
injection, no cross-tenant/IDOR issues (no client-supplied ids reach this
server-driven layer), org-scoping on `push_org_to_salesforce`/
`pull_org_from_salesforce` verified clean.

## Completion gate

- `black --check` / `isort --check-only` / `flake8` on all changed files —
  clean.
- `python3 scripts/validate_migrations.py --strict` — passed (no schema
  change).
- Scoped tests across every touched runner/service — 299/299 passed.
- Full backend suite (`pytest tests/`) — 8971 passed, 22 skipped (all
  pre-existing Docker/optional-dependency skips), 0 failures.
