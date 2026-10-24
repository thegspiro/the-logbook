# Security Review — Feature 31: Scheduled Tasks (pass 9)

**Prefix:** `CRON9` · **Iteration:** 31 (pass 9) · **Reviewed:** 2026-10-24

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (82 L, 2 routes,
**unchanged** since pass 4), `backend/app/services/scheduled_tasks.py` (grown
to **68 registered tasks**, up from pass 8's 67 — `SCHEDULE`/`TASK_RUNNERS`
still exactly 1:1).
**Frontend:** none — unchanged.
**Migrations:** none new to this feature's own tables this pass.

---

## Watchdog pickup

PR #3658 (Feature 30, Onboarding, pass 9) merged 2026-10-24 ~23:27 UTC. No
`claude/security-review-*` PR or branch existed for Feature 31 at the time
this iteration started (`search_pull_requests` and `list_pull_requests`,
`is:pr is:open head:claude/security-review-`, 0 results both, checked once
immediately before starting and again immediately before branching). No
reachable agent via `ListAgents` either — the dedicated `/loop 30m
/security-review` session this rotation depends on produced no branch or PR
of its own. This iteration picked up the next `⬜` row (31) from outside
that loop, per `docs/security-review/PROGRESS.md`.

## Scope and method

Loaded, in order: `docs/security-review/CHECKLIST.md`, all eight prior
security-review passes in full (`CRON-31` … `CRON8-31`), and the sibling
`docs/app-review/scheduled-tasks.md` track. Every finding any of these left
open was re-verified against current code at its current location, not
re-derived.

**Delta-focused, full diff read.** Pass 8's baseline merge is `da17a8da`
(PR #3521, 2026-10-21). Diffed `da17a8da..HEAD` (2026-10-24): `scheduled.py`
— zero changes; `scheduled_tasks.py` — **+138/−9 lines** across five
non-security-review commits.

**One new task runner, plus four changed ones.** Checked each new/changed
delegate's owning feature and last-touch date against that feature's most
recent security-review pass, same method as pass 8's table:

| Runner (new/changed)               | Delegates to                                                                                 | Owning feature (status)                                                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nfc_card_tap_purge` (new)         | `NfcCardAdminService.purge_expired_taps` (`nfc_card_admin_service.py`, new 2026-10-23)       | Apparatus & NFC (feature 13, ✅) — the new Member ID Cards admin surface (`/nfc-tags/bulk-status`, tap log, CSV export) is **not yet re-reviewed** by that feature's own rotation; read the delegate in full this pass (below), the rest is feature 13's to pick up on its next pass |
| `google_workspace_suspension_sync` | `DirectoryAccountService.retry_group_removals` / `.sync_pending_names` (both new 2026-10-23) | Integrations (feature 27, ✅) — both newer than INT-27's last pass; read in full this pass                                                                                                                                                                                           |
| `inventory_low_stock_alerts`       | local change only (adds a gear-specific reorder link alongside the existing medical one)     | Inventory (feature 11, ✅) / local to this call site — read in full                                                                                                                                                                                                                  |
| `supply_expiration_alerts`         | `MedicalSupplyCheckService.uncounted_supply_positions` (pre-existing method, new call site)  | Medical Supplies (feature 23, ✅) — read the new call site in full                                                                                                                                                                                                                   |
| `compliance_auto_reports`          | `ComplianceReportService.auto_report_exists` (new 2026-10-24, same-day PR #3664)             | Reports & analytics (feature 29, ✅ as of pass 11, PR #3647 merged 20:29 UTC) — `auto_report_exists` landed at 21:06 UTC, **after** that pass; read in full this pass                                                                                                                |

## Route inventory

Unchanged since pass 1 — re-confirmed against current `scheduled.py` (0 diff
since pass 4):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                       |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing)                 | Lists `SCHEDULE` entries verbatim.                                                                                                                          |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | Re-confirmed granted to no `DEFAULT_POSITIONS`/`OPERATIONAL_RANKS` entry — only the wildcard resolves it. Audit-before-run (CRON4-31-1) present, unchanged. |

## Verified good ✅

- **`purge_expired_taps` (`nfc_card_admin_service.py:570-586`) is correctly
  org-scoped and the retention read is defensive.** The delete filters
  `NfcCardTap.organization_id == str(organization.id)` and a `tapped_at <
cutoff` computed from a calendar-month `relativedelta`, so a department's
  retention choice is honored even though months vary in length. The
  retention value itself comes from `tap_retention_months_in(org.settings)`
  (`nfc_card_admin_service.py:90-106`), which explicitly follows Pitfall #19:
  a missing, wrong-typed, or out-of-range value degrades to
  `DEFAULT_TAP_RETENTION_MONTHS` rather than raising inside the nightly
  purge, where an exception would skip the whole organization. The new task
  runner (`scheduled_tasks.py`, `run_nfc_card_tap_purge`) dispatches through
  `_for_each_org`, matching every other per-org task in this file, and
  commits per org. `tests/test_nfc_card_admin.py::TestBulkAndRetention` (a
  `@pytest.mark.integration` class, correctly marked per Pitfall #30b —
  confirmed by running the unit-only selection and finding no DB-backed test
  misfiled there) exercises `purge_expired_taps` directly with a seeded
  `now`. The surrounding Member ID Cards admin surface this method belongs
  to (bulk status endpoint, tap log export, auto-suspend-on-departure) is
  new since feature 13's last pass and is **not** re-reviewed here — flagged
  below as a note for that feature's own next pass, not read in full, since
  it is out of this feature's scope.
- **`retry_group_removals` and `sync_pending_names`
  (`directory_account_service.py:893-933`) follow the same safe, global-scan
  shape as the pre-existing `sync_pending_suspensions`.** Each selects
  `(user_id, organization_id)` pairs across **all** organizations with no org
  filter at the top level — by design, since this is a platform-wide sweep,
  not a per-org task — but every id pair then re-scopes to its own row's
  `organization_id` for the actual mutation: `_retry_group_removal` calls
  `self._load(organization_id, user_id=user_id, lock=True)`, which filters on
  both, before touching anything. The `organization_id` driving that re-scope
  comes from the database row itself, never from client input, so there is no
  cross-tenant surface despite the unscoped top-level `SELECT`.
  `retry_group_removals` filters an emptied JSON array in Python
  (`if groups`) rather than in SQL, with a comment explaining why (`IS NULL`
  does not match a stored JSON `null`) — read and confirmed correct against
  the column's actual write path. `_retry_group_removal`'s own exception
  handler logs `user_id` (an id, not free text) and rolls back per failure,
  matching Pitfall #33's "log an id, not user text" guidance. The call site
  in `run_google_workspace_suspension_sync` (`scheduled_tasks.py:6785-6797`)
  just aggregates the three independent attempt counts into one result dict;
  no new org-scoping surface there.
- **The gear-specific low-stock link in `run_inventory_low_stock_alerts`
  (`scheduled_tasks.py:4927-5090`) is correctly escaped and conditionally
  shown.** Both the existing medical-supplies link and the new gear link are
  built from `settings.FRONTEND_URL` (not user input) and passed through
  `_html.escape()` before interpolation into the email body, same as every
  other link this function already emitted. Each is shown only when
  `any_medical`/`any_gear` is true for that recipient's rows, so a
  medical-only officer never receives a link to a gear page they may lack
  permission to open, and vice versa — the stated intent in the new
  comment, verified against the actual conditional.
- **The "not yet counted" section added to `run_supply_expiration_alerts`
  (`scheduled_tasks.py:5553-5739`) keeps the feature's existing escaping
  discipline.** `_uncounted_section`'s item name and location path are both
  passed through `_html.escape()` per part (the location is split on `" › "`
  and each segment escaped individually, matching the existing `_lot_section`
  pattern), and the new `uncounted` list is fetched once per org via
  `check_service.uncounted_supply_positions(str(org.id), ...)` — org-scoped
  by construction since `org.id` is the loop's own current organization, not
  client-supplied. It only reaches the medical-domain recipients (`unseen =
uncounted if DOMAIN_MEDICAL in domains else []`), consistent with the rest
  of this function's audience split.
- **`ComplianceReportService.auto_report_exists`
  (`compliance_config_service.py:338-382`) closes the compliance
  auto-report's duplicate-send risk the correct way for a retried task
  (Pitfall #36) and the correct way for a read-then-write capacity-style
  check (Pitfall #27).** It locks the organization's `ComplianceConfig` row
  with `.with_for_update()` first, then performs its own existence lookup as
  a locking read (also `.with_for_update()`) rather than a plain `SELECT` —
  under the documented REPEATABLE READ semantics this repo already relies on
  elsewhere, a plain read would answer from a snapshot taken before the lock
  was won and could miss a concurrent run's commit. The call site in
  `run_compliance_auto_reports` (`scheduled_tasks.py:5852-5882`) checks this
  before generating either the monthly or yearly report and commits per
  organization immediately after (`await db.commit()` at line ~5898),
  which is what releases the row lock and lets the next organization's own
  check proceed independently — read the full per-org try/except block to
  confirm the commit boundary actually matches the claim in the commit
  message. `generate_report` (`compliance_config_service.py:232-268`) leaves
  `generated_by` at its default of `None` for every scheduled (non-manual)
  call, which is exactly what `auto_report_exists`'s
  `generated_by.is_(None)` filter expects, and sets `status =
ReportStatus.COMPLETED` only after the report body is built and before the
  optional email send — a raised exception before that point leaves no
  COMPLETED row to be seen by a later check, and the whole insert is rolled
  back by the caller's per-org `except` block, so a crashed generation is
  correctly retried rather than silently counted as done. This PR landed
  after RPT6-29's pass 11 merge (20:29 UTC) and before this review started —
  read in full as a cross-feature delegate per the pass 8 methodology, not
  re-derived from its commit message.
- **`SCHEDULE`/`TASK_RUNNERS` remain exactly 1:1 (68/68)**, re-verified by
  AST (not by eyeballing the literal) rather than trusting the registry
  comment. `TASK_INTERVALS_SECONDS` is missing one key present in
  `SCHEDULE`/`TASK_RUNNERS` (`scheduled_emails`) — checked this is **not**
  a new gap: `scheduled_emails` is deliberately listed in
  `_MANUAL_ONLY_TASKS` (`scheduled_tasks.py:7905-7907`, "driven by main.py's
  `_scheduled_email_loop`"), and `tests/test_scheduled_task_coverage.py`
  already asserts `TASK_RUNNERS − TASK_INTERVALS_SECONDS − _MANUAL_ONLY_TASKS
== ∅` for exactly this class of "registered but never auto-run" defect
  (the module's own docstring names the five earlier tasks this bit the repo
  for). Ran that test file directly — 5/5 pass.

## Findings

No new findings this pass.

### Note for Feature 13's next pass (not a Feature 31 finding)

The Member ID Cards admin page (commit `f2f821e3`, 2026-10-23) added
substantial new surface to `nfc_tags.py` — a new `POST
/nfc-tags/bulk-status` endpoint, a paginated/filterable/CSV-exportable tap
log, and auto-suspend/restore wiring into every member status-change path —
none of which has been reviewed by Apparatus & NFC's own rotation pass
(feature 13, last marked ✅ before this commit existed). This pass read only
`purge_expired_taps`, the one method `scheduled_tasks.py` calls directly, and
confirmed it is safe (above); the bulk-status endpoint, tap log export, and
auto-suspend sweep are out of this feature's scope and are flagged here so
feature 13's next lap picks them up rather than assuming "✅" still covers
them.

## Re-confirmed still open, unchanged — not re-applied

Per the rotation's rule against re-reporting a prior pass's considered,
unresolved call:

- **CRON4-31-2** — `POST /run-task` still takes no per-task lock before
  dispatching (`scheduled.py`, 0 diff since pass 4), so a manual trigger can
  still race the in-process scheduler's own run of the same task.
- **CRON-4** (app-review) — raw `str(e)` from a failed per-org iteration
  still reaches `POST /run-task`'s response body inside each task's own
  results list (e.g. `compliance_auto_reports`'s `{"org_id": ..., "error":
str(e)}`), bypassing `safe_error_detail()` (`scheduled.py`/
  `scheduled_tasks.py`, unchanged this pass). Already recorded OPEN by
  design in `docs/app-review/scheduled-tasks.md`.

`CRON2-31-13` (admin-hours auto-close audit trail) remains
**✅ Resolved 2026-10-11** in `KNOWN_LIMITATIONS.md`, consistent with passes
7 and 8's re-verification — nothing to update there this pass either.

## Schema & migration notes

No new migration touching this feature's own tables this pass;
`scheduled_tasks.py` and `scheduled.py` own no tables directly. The
delegated-to modules' own tables (`nfc_card_taps`, `directory_account_provisions`,
`compliance_reports`) belong to their owning features' migrations, all
pre-existing, and out of this pass's scope to re-verify beyond the read-path
confirmations above.

## Guard tests added

None this pass — no new defect found to guard against. The two new delegates
read in full this pass (`auto_report_exists`'s locking pattern,
`purge_expired_taps`'s retention handling) each already carry their own
dedicated test coverage, added alongside them in the commits that introduced
them, not by this review.

## Completion gate

| Check                                                                           | Result                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.3.0, CI-pinned)                  | ✅ 0 violations                                            |
| `python3.13 -m black --check app/ tests/ alembic/` (26.5.1, CI-pinned)          | ✅ clean, 2633 files unchanged                             |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)      | ✅ clean                                                   |
| `python3.13 scripts/validate_migrations.py --strict`                            | ✅ 651 revisions, single head `3d67883cd461`               |
| `set(SCHEDULE) == set(TASK_RUNNERS)` registry check (AST)                       | ✅ 68/68, no drift (up from pass 8's 67)                   |
| `pytest tests/test_scheduled_task_coverage.py`                                  | ✅ 5 passed                                                |
| Scoped `pytest` (scheduled-task/cron + all changed-delegate suites), full       | ✅ 321 passed, 1 skipped (optional `pywebpush`, unrelated) |
| Scoped `pytest`, unit-only (`-m "not integration and not slow and not docker"`) | ✅ 150 passed, 1 skipped                                   |
| `cd frontend && npm run typecheck`                                              | n/a — no frontend files touched this pass                  |
| `cd frontend && npm run lint`                                                   | n/a — no frontend files touched this pass                  |

Scoped selection: `-k "scheduled_task or cron or scheduler or nfc_card or
google_workspace or directory_departure or compliance_auto_report or
saved_report_delivery or inventory_low_stock or supply_expiration"` against
`backend/tests/` — 321 passed, 1 skipped, 24378 deselected, 84.82s (full run,
DB available); 150 passed, 1 skipped, 24549 deselected, 35.38s (unit-only
run, to confirm no DB-backed test is mis-marked per Pitfall #30b — none
found).
