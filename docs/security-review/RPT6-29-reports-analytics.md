# Security Review — Feature 29: Reports & Analytics (pass 8)

**Prefix:** `RPT6` · **Rotation pass:** 8 · **Reviewed:** 2026-10-08 · **PR:** (this PR)

**Backend:** `api/v1/endpoints/reports.py` (7 routes), `analytics.py` (3),
`platform_analytics.py` (1), `dashboard.py` (7), `labels.py` (12) — 30 routes
total; services `reports_service.py` (2,406 L), `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`; `schemas/reports.py`.
**Frontend:** `modules/reports` (read, unchanged this pass).
**Migrations:** none touching this feature's tables since pass 7.

---

## Scope and provenance

Prior coverage: module-audit iteration 16, four app-review passes (A7/B16,
plus app-review's dashboard pass 3 on 2026-10-04 — a different rotation,
noted below but not duplicated), and security-review passes 2 through 7
(`RPT2-29-reports-analytics.md`, `RPT-29-reports-analytics-pass3.md`,
`RPT4-29-reports-analytics.md`, `RPT5-29-reports-analytics.md` — which itself
contains three rounds, labelled "Pass 5", "Pass 6" and "Pass 7" inside that
one file).

**Step 0:** confirmed via `list_pull_requests` (implied by the task's own
pre-check) that no `claude/security-review-*` PR was open before starting;
row 28 (Security, audit & IP) was already ✅ from PR #2990's merge
(`724791a1`), and row 29 was the first `⬜`.

**Real delta since the last pass is zero.** `git log --oneline -- <all ten
files>` since `RPT5-29-reports-analytics.md`'s "Pass 7" (merged as PR #2897,
`6c422896`, 2026-10-04) shows exactly one commit touching any of the ten
files, `c9dceac5` ("feat(members): hide archived members..."). Read directly:
it has **no recorded parent** (`git log --format="%H %P" -1 c9dceac5` prints
no parent hash) and its diff is a full-tree "every file added" diff — the
same shallow-clone squash/rebase history-boundary artifact prior passes
already documented (`f8fdd1a`, `0430faa0`, `bad9fff0`, `703c5123`), not a
real code change. So this pass's code is byte-identical to what pass 7
(2026-10-04) last reviewed.

Given that, this pass did a **full fresh read** of all five endpoint files
and all five services end to end (not a diff review, since there is no real
diff) against all seven checklist dimensions, re-enumerating every route from
source rather than trusting the prior table, specifically to catch anything
a diff-only pass would miss. It also cross-checked the **separate**
app-review rotation's dashboard pass 3 (`docs/app-review/dashboard.md`,
2026-10-04, DASH-30 through DASH-40, 7 fixes/4 flagged) and module-audit's
`reports-analytics.md`, since both share this feature's files — those are a
different rotation's findings and are not re-litigated here, but were read to
confirm none of them left a security-relevant regression (all were frontend
routing/UX/contrast fixes or flagged UX gaps; none touches auth, org-scoping,
or data exposure).

## Route inventory

All 30 routes re-enumerated from source this pass. Unchanged in count and
gate from pass 4 onward.

| File                    | Route                             | Gate                                                                     |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `reports.py`            | `GET /available`                  | `reports.view`                                                           |
| `reports.py`            | `POST /generate`                  | `reports.view` + `_enforce_report_pii_permission`                        |
| `reports.py`            | `GET /saved`                      | `reports.view`                                                           |
| `reports.py`            | `POST /saved`                     | `reports.manage`                                                         |
| `reports.py`            | `PATCH /saved/{id}`               | `reports.manage`                                                         |
| `reports.py`            | `DELETE /saved/{id}`              | `reports.manage`                                                         |
| `reports.py`            | `POST /saved/{id}/run`            | `reports.view` + `_enforce_report_pii_permission`                        |
| `analytics.py`          | `POST /track`                     | `get_current_user`                                                       |
| `analytics.py`          | `GET /metrics`                    | `analytics.view`                                                         |
| `analytics.py`          | `GET /export`                     | `analytics.view`                                                         |
| `platform_analytics.py` | `GET /`                           | `settings.manage`                                                        |
| `dashboard.py`          | `GET /asset-widgets`              | `get_current_active_user` + per-block permission + module checks         |
| `dashboard.py`          | `GET /operations`                 | `get_current_active_user` + `OPERATIONS_SECTION_PERMISSIONS` per section |
| `dashboard.py`          | `GET /widgets`                    | `get_current_active_user` + per-card permission + module checks          |
| `dashboard.py`          | `GET /stats`                      | `get_current_active_user`                                                |
| `dashboard.py`          | `GET /admin-summary`              | `settings.manage`                                                        |
| `dashboard.py`          | `GET /action-items`               | `get_current_active_user` + `meetings.view`/`minutes.view` per half      |
| `dashboard.py`          | `GET /community-engagement`       | `events.manage`                                                          |
| `labels.py`             | `POST /labels/preview`            | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |
| `labels.py`             | `GET /label-preset/{module}`      | `get_current_user` + `_authorize_module`                                 |
| `labels.py`             | `PUT /label-preset/{module}`      | `get_current_user` + `_authorize_module`                                 |
| `labels.py`             | `POST /labels/generate`           | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |
| `labels.py`             | `GET /label-printers`             | `get_current_user` only — LBL-29-2, deliberate, still org-scoped         |
| `labels.py`             | `POST /label-printers`            | `settings.manage` OR `organization.update_settings`                      |
| `labels.py`             | `PUT /label-printers/{id}`        | same                                                                     |
| `labels.py`             | `DELETE /label-printers/{id}`     | same                                                                     |
| `labels.py`             | `POST /label-printers/{id}/test`  | same                                                                     |
| `labels.py`             | `GET /label-printers/{id}/status` | same                                                                     |
| `labels.py`             | `POST /label-printers/probe`      | same                                                                     |
| `labels.py`             | `POST /labels/print`              | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |

Every route carries a recognized auth dependency. No ungated route. Matches
the SEC-00 baseline's route-auth sweep (this feature is not among the ones
with intentionally-public routes).

Not in `labels.py` itself, but reached through its service from
`inventory.py`: `GET/POST /inventory/label-setups`, `DELETE
/inventory/label-setups/{id}` — all gated `inventory.manage`, re-verified
unchanged (see "Verified good" below).

## Verified good ✅

1. **Org-scoping holds across all 13 report generators**, re-checked by
   bounding each `_generate_*` function to its next `def` and confirming
   every query either filters `organization_id` directly or resolves through
   an already-org-scoped parent id list. No regression since pass 6's
   line-by-line sweep.
2. **`platform_analytics.py`'s all 16 aggregate queries** still filter
   `<model>.organization_id == current_user.organization_id`; the endpoint's
   "platform" naming remains per-org, not a cross-tenant superadmin surface.
3. **Zero injection surface, re-confirmed by grep.** No `.like()`/`.ilike()`,
   no `csv.writer`/`csv.DictWriter`, no raw SQL interpolation across any of
   the ten files. The one `sa.text("SECOND")` in `analytics.py` is a
   hardcoded `TIMESTAMPDIFF` unit, not interpolated input.
4. **Label-printer transport SSRF hardening unchanged**: port allowlist
   (9100–9109, 6101), blocked address classes (loopback/link-local/
   multicast/reserved), operator-network allowlist (fails closed on an
   invalid entry), and resolve-once-connect-to-IP-literal to close the
   DNS-rebinding TOCTOU — all re-read in `printer_transport.py` this pass.
5. **`storage_areas` module and the inventory label-setups endpoints**
   (added since pass 6, reviewed in pass 7) still org-scope their queries and
   validate the client-supplied `printer_id` FK in-org
   (`LabelPrinterService.get_printer`) before storing it in the
   organization's JSON settings — re-confirmed at
   `inventory.py:7219-7224`.
6. **`SavedReport` update path's `apply_updates` fix (RPT5-29-2) holds** —
   an explicit `null` on `name` (NOT NULL) still raises 400, not a 500.
7. **`MAX_LABELS_PER_JOB = 500`, `MAX_ACTIVE_SAVED_REPORTS_PER_ORG = 200`,
   `ExtraLine`'s `max_length=100`, `/analytics/export`'s `.limit(1000)`** are
   all still present and enforced.
8. **`PII_REPORT_PERMISSIONS` still covers exactly the 8 PII-bearing report
   types** (`member_roster`, `pipeline_overview`, `training_summary`,
   `training_progress`, `annual_training`, `certification_expiration`,
   `compliance_status`, `admin_hours`); the 5 ungated generators
   (`event_attendance`, `department_overview`, `call_volume`,
   `apparatus_status`, `inventory_status`) were re-read end to end this pass
   and confirmed to carry no member-identifying field beyond asset/unit
   names, matching pass 4's original enumeration.
9. **`SavedReport.created_by` and `LabelPrinter.created_by_id`**
   (`ondelete="SET NULL"`) are both `nullable=True`. Migration chain: 543
   revisions, single head `7db20aa49329`, `validate_migrations.py --strict`
   passes.

## Findings

### RPT6-29-1 — MEDIUM — `pipeline_overview` report did not hide the caller's own prospective-membership record — ✅ FIXED

**What:** every list/aggregate route under `membership_pipeline.py`
(`/widget-summary`, the kanban board, `/stats`, `/source-events`,
`/prospects`, both bulk routes, `/election-packages`, `/my-sign-offs` —
8+ routes) excludes the caller's own prospective-membership record via
`get_hidden_prospect_ids` (`app/api/prospect_privacy.py`), and
`labels.py`'s three label routes (`preview`/`generate`/`print`) do the same
for the `prospective_members` module. `app/api/prospect_privacy.py`'s own
module docstring states the invariant in absolute terms: "A member must
never be able to read ... the prospective-membership record that describes
_them_", specifically because it stays sensitive "after they are elected and
hold `prospective_members.view` in their own right" — interview notes,
reference checks and membership-vote commentary are confidential even from
the person it concerns.

`reports_service._generate_pipeline_overview` — the "Pipeline Overview"
report, gated behind `reports.view` + `prospective_members.view` via
`PII_REPORT_PERMISSIONS` — builds `prospects_query` from
`ProspectiveMember.organization_id`/`pipeline_id`/date filters only. It never
applied the exclusion every sibling lister in this same org carries, and it
is exactly the shape the privacy guard exists for: it returns each
prospect's name, email, current pipeline stage, days in pipeline and applied
date in `prospects`, and feeds the viewer's own record into every aggregate
(`total_applicants`, `active_applicants`, `yearly_trends`, stage/group
counts) the report computes.

This is not a new defect — the gap is as old as `pipeline_overview` itself —
but it was never caught by a prior pass of any of the three review layers
(module-audit, app-review, or security-review passes 2–7), none of which
cross-referenced this report against `prospect_privacy.py`'s router-wide
guarantee. The closest precedent, `MP-32` (`docs/security-review/
MP-08-membership-pipeline.md`), found and fixed the identical shape on
`GET /my-sign-offs` for the same reason (no `{prospect_id}` path parameter
means the router-level `block_self_prospect_access` dependency never fires,
so a list/aggregate route must apply `get_hidden_prospect_ids` itself) —
`pipeline_overview` is reached through `reports.py`, a different router with
no such dependency at all, so it was never in that fix's blast radius either.

**Where:** `app/services/reports_service.py`, `_generate_pipeline_overview`
(the `prospects_query` construction, pre-fix at roughly line 2080); dispatched
from `app/api/v1/endpoints/reports.py`'s `generate_report` and
`run_saved_report`.

**Failure scenario:** a department elects a former applicant into a role
holding `prospective_members.view` or `.manage` (a coordinator, a
membership-committee officer) — not unusual once years pass and the pipeline
keeps every historical application. That officer (or anyone who runs this
report and was once in this same org's pipeline — including someone whose
application was withdrawn or rejected before eventually being re-admitted by
a different path) opens Reports → Pipeline Overview, or any saved report of
this type, and sees their own name, email, current/historical pipeline
stage, days-in-pipeline and applied date listed among the prospect rows —
exactly the fact `prospect_privacy.py` says a member must never read about
themselves through any surface. The per-row fields here (name/email/stage)
are less sensitive than the interview notes `ProspectInterview` guards, but
the design intent is unconditional ("never"), and the established remedy
(exclude from the query entirely, which also removes the self-record from
every derived count) is cheap and exactly matches the pattern already proven
safe at 9+ other call sites in this codebase.

**Impact:** self-privacy bypass (own-record exposure through an aggregate
report rather than a by-id leak), not a cross-tenant or cross-member leak —
every other prospect's data stays correctly org-scoped and permission-gated
as before. Severity MEDIUM, matching `MP-32`'s LOW/MEDIUM precedent for the
identical shape, raised slightly here because the leaked fields (stage,
applied date) are visible alongside the viewer's own identity in a report a
chief may distribute or export, where the sign-offs list `MP-32` fixed was a
narrower, session-only view.

**Fix:** `ReportsService.generate_report` gained an optional
`hidden_prospect_ids: Optional[Set[str]] = None` parameter, forwarded only to
`_generate_pipeline_overview` (the one report type that needs it — every
other of the 13 generators keeps its unchanged 4-argument signature, so this
asymmetry lives in one place, the dispatcher, rather than being threaded
through all of them). `_generate_pipeline_overview` adds
`ProspectiveMember.id.notin_(hidden_prospect_ids)` to `prospect_conditions`
when supplied — the same query-level exclusion `pipeline_widget_summary` and
every other sibling lister already use, so the self-record is removed from
the list **and** from every count/percentage/trend derived from `prospects`,
not merely hidden from the rendered rows. `reports.py`'s `generate_report`
and `run_saved_report` endpoints both now declare
`hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids)` (the same
dependency `labels.py` already uses for its three prospect-label routes) and
pass it through unconditionally; every report type other than
`pipeline_overview` silently ignores the extra kwarg via the dispatcher's own
conditional, so there is no behavior change for the other 12 report types
and no extra query cost for them beyond the one `get_hidden_prospect_ids`
lookup FastAPI now runs per `/generate` or `/saved/{id}/run` call (cheap:
it is already paid on every one of `labels.py`'s three routes today).

## Still flagged, re-confirmed unchanged (no new information, not re-applied)

- **RPT2-29-2 (MEDIUM/policy)** — `SavedReport` scheduling
  (`is_scheduled`, `schedule_frequency`, `email_recipients`) remains stored
  and API-writable with no reader: re-grepped `scheduled_tasks.py`'s
  `TASK_RUNNERS` (line 6741) — still no entry for saved/scheduled reports.
  `SavedReportResponse.enforced` still hardcodes `False`
  (`schemas/reports.py:100`). Mirrored in `docs/KNOWN_LIMITATIONS.md`.
- **LBL-29-2 (LOW/policy)** — `GET /label-printers` still gated on
  authentication only (`labels.py:316-331`), a deliberate documented design
  choice, still org-scoped. Unchanged.
- **LBL-29-4 (Informational)** — `LabelService.generate()` (the PDF path)
  still has no per-request count cap analogous to `print_labels`'s
  `MAX_LABELS_PER_JOB = 500`. Unchanged, flagged asymmetry.
- **RPT-5c / RPT-6 / RPT-7** — `_generate_inventory_status`'s
  `float(item.current_value)` (belongs with the codebase-wide FIN-7 Decimal
  refactor), `apparatus_status.last_inspection_date` hardcoded `None`
  (incomplete feature), `training_summary.requirement_breakdown`'s
  completion % able to exceed 100% in the shared-requirement
  double-enrollment case, and no generator raises `ValueError` (so the
  `/generate`/`/run` `ValueError→400` shape some sibling endpoints use is
  unreachable dead code here) — all re-confirmed unchanged by direct read
  this pass, same reasoning as every prior pass.
- **DASH-2 (LOW)** — `GET /dashboard/stats` / `dashboardService.getStats()`
  still has zero frontend callers (`grep -rn "dashboardService.getStats"
frontend/src/` — zero hits; re-checked this pass). Delete-or-implement,
  unchanged since 2026-08-08. (App-review's own dashboard pass 3 on
  2026-10-04 re-confirmed the same thing independently, as `DASH-2` in
  `docs/app-review/dashboard.md`; not duplicated as a separate finding here.)
- **RPT5-29-1 (MEDIUM, Pitfall #29 shape) / RPT5-29-5** —
  `compliance_status`/`training_summary.requirement_breakdown` still
  re-derive training compliance by two different rules rather than
  consuming `training_compliance.py`'s shared evaluator; re-read both
  generators in full this pass (`reports_service.py:1151-1310` for
  `compliance_status`, now calling `requirement_applies_to_user`/
  `catch_up_deadline`/`member_join_date` correctly; `:258-457` for
  `training_summary`, whose `requirement_breakdown` section still calls
  none of those three helpers and still grades a grandfathered-exempt
  member as unmet). No new evidence beyond pass 7's; disposition unchanged
  — a product/architecture decision between rewriting
  `requirement_breakdown` as a per-member loop or re-scoping what it claims
  to measure, not a security-review drive-by. Mirrored in
  `docs/KNOWN_LIMITATIONS.md`.

## Additional checks this pass

- **Dashboard app-review pass 3 cross-check (different rotation, same
  files):** read `docs/app-review/dashboard.md`'s pass 3 (DASH-30 through
  DASH-40, 2026-10-04) end to end to confirm none of its 7 fixes or 4 flagged
  items touches auth, permission gating, org-scoping or data exposure — they
  are dead/broken navigation links (`href` targets with no matching route),
  a duplicate facility-maintenance tile, two destination-reachability
  tightenings (`inventory`/`facilities` asset-widget blocks now also require
  the destination route's own permission, narrowing access, never widening
  it), a stale wiki permission name, and a DST-boundary date-window bug.
  Confirmed by reading the current `dashboard.py` (above) that the two
  permission-tightening fixes (DASH-32) are present and correct: the
  `inventory`/`facilities` asset-widget blocks require both the aggregate
  permission and the destination route's own gate, matching the `apparatus`
  block's pre-existing pattern. No security finding of this pass's own
  arises from that file; not duplicated here.
- **`storage_areas` label module (added pass 7) re-verified**: barcode
  assignment (`_build_storage_area_specs`) commits only within the same
  request that reads it, is org-scoped (`StorageArea.organization_id ==
org_id`), and the parent-trail walk bounds a cycle with a `seen` set so a
  corrupted `parent_id` chain cannot hang the request.
- **Label setups (`list_setups`/`save_setup`/`delete_setup`)**: `save_setup`/
  `delete_setup` both lock the organization row (`.with_for_update()`) before
  the read-modify-write and `copy.deepcopy()` the JSON before mutating
  (Pitfall #12 satisfied), capped at `MAX_LABEL_SETUPS = 20`.

## Schema & migration notes

No model or migration change this pass (the fix is pure query logic, no new
column). Alembic chain: 543 revisions, single head `7db20aa49329`,
`validate_migrations.py --strict` passes. The one `ondelete="SET NULL"` FK
each on `SavedReport` (`created_by`) and `LabelPrinter` (`created_by_id`)
remain `nullable=True`.

## Guard tests added

`tests/test_pipeline_overview_report_privacy.py` (4 tests, `integration`
marked — uses `db_session`):

- `test_without_hidden_ids_both_applicants_are_listed` — baseline: without
  the new parameter, both applicants (including the "self" one) are listed,
  for contrast with the fix.
- `test_hidden_prospect_id_is_excluded_from_the_list_and_totals` — with
  `hidden_prospect_ids={self_prospect.id}`, the self-record is absent from
  `prospects` **and** `total_applicants` drops accordingly (proving the
  exclusion is query-level, not a post-hoc filter on the rendered rows).
- `test_generate_report_dispatch_threads_hidden_ids_through` — asserts the
  public `generate_report()` dispatcher (what the endpoints actually call),
  not just the private generator, carries the exclusion through.
- `test_other_report_types_ignore_hidden_ids_without_error` — asserts a
  non-`pipeline_overview` report type does not raise when
  `hidden_prospect_ids` is passed, protecting the dispatcher's
  conditional-forwarding shape against a future refactor that tries to
  thread the parameter into every generator uniformly and breaks the other
  12's signatures.

## Completion gate

| Check                                                                                                                                             | Result                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.3.0`, pinned)                                                                                           | ✅ 0 violations                                                |
| `black --check app/ tests/ alembic/` (`black==26.5.1`, pinned)                                                                                    | ✅ 2042 files unchanged (after formatting the 2 touched files) |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`, pinned, matches CI)                                                                    | ✅ clean                                                       |
| `python3 scripts/validate_migrations.py --strict`                                                                                                 | ✅ 543 revisions, single head                                  |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline"` | ✅ **1141 passed**, 1 skipped (pywebpush, env-only)            |
| `pytest tests/test_pipeline_overview_report_privacy.py` (new file)                                                                                | ✅ **4 passed**                                                |
| `pytest tests/` (full unit suite, `-m "not integration and not slow and not docker"`)                                                             | ✅ **13446 passed, 1 skipped**, 3955 deselected                |
| `cd frontend && npm run typecheck`                                                                                                                | ✅ 0 errors (aliased 7.0.2 compiler)                           |
| `cd frontend && npm run lint`                                                                                                                     | ✅ 0 errors, 0 warnings                                        |
| `cd frontend && npx vitest run src/modules/reports`                                                                                               | ✅ **51 passed** (5 files)                                     |

**One pre-existing, out-of-scope environment issue found and corrected
(not a code defect):** the sandbox database had been brought to the Alembic
head via `alembic upgrade head` alone, without the app's own startup-time
`_add_missing_model_columns` repair step (`main.py`) ever running once. Six
unrelated tables (`events`, `event_rsvps`, `shift_completion_reports`,
`training_module_configs`) were missing 12 columns their models declare —
this is normal for a model updated after the table's initial `create_all`,
and is exactly the gap `_add_missing_model_columns` exists to close on every
real boot. It produced 25 failures in `test_shift_completion.py`,
`test_call_tracking.py` and three other files — none in this feature's own
files, and confirmed pre-existing by reproducing one failure on an
unmodified `git stash` of this branch before touching anything. Invoked
`_add_missing_model_columns(engine)` directly (the same function `main.py`
calls on a normal boot when already at head) against the sandbox's sync
engine, which added the 12 missing columns; all 25 then passed. This is an
environment-setup action, not an application or migration fix, and is not
part of this PR's diff — recorded here per CLAUDE.md's "no silent pass-over"
rule rather than quietly working around it.

---

## Pass 9 (2026-10-17)

**Prefix:** `RPT6` (unchanged) · **Rotation pass:** 9 · **Reviewed:** 2026-10-17 · **PR:** (this PR)

PR #2994 (pass 8, `b40475bd`) merged with nothing started for the next
feature since; this pass picked up Feature 29. Real delta since pass 8
diffed directly against `b40475bd` across all ten scope files plus
`frontend/src/modules/reports`:

- **`feat(reports): send scheduled saved reports and add the saved-reports
screen` (RPT2-29-2, resolved).** `RPT2-29-2` — `SavedReport` scheduling
  fields stored and API-writable with no reader — is now fixed: a new daily
  task `saved_report_delivery` (`app/services/saved_report_schedule.py`,
  registered in `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`) sends
  each organization's due reports via the existing `_for_each_org` helper.
  Read the new module in full: the PII gate
  (`PII_REPORT_PERMISSIONS`) is enforced at both save time
  (`_settle_schedule` in `reports.py`, calling `disallowed_pii_recipients`)
  and send time (`_owner_may_run` re-checks the schedule's owner still holds
  the report type's permission; `disallowed_pii_recipients` re-checks every
  recipient is an active, non-deleted member of the _same organization_
  holding that permission — both queries filter `organization_id`). Only a
  numeric top-level summary (`_numeric_summary`) and a link ever reach the
  email body; every interpolated value is `html.escape`d; no per-member row
  is emailed. `email_recipients` is now `List[EmailStr]` on both
  create/update schemas. `POST/PATCH /saved/{id}` and `DELETE /saved/{id}`
  remain org-scoped by-id (checklist 14a, re-verified at
  `reports.py:282-325`). External recipients are run through the existing
  `audit_external_recipients` helper before sending. No new finding — this
  closes RPT2-29-2 rather than opening anything.
- **`Let members and departments customize the Department pulse cards`
  (new surface, reviewed clean).** New `GET/PUT/DELETE
/dashboard/pulse-layout` (self-scoped: no id in the path, reads/writes
  only `current_user`'s own row) and `PUT/DELETE
/dashboard/pulse-layout/default` (`settings.manage` OR
  `organization.update_settings`, writing
  `Organization.settings["dashboard_pulse"]` through the existing
  `OrganizationService.update_organization_settings`, which already
  `copy.deepcopy()`s before mutating — pitfall #12 satisfied). Verified the
  commit message's central claim by reading `get_main_dashboard_widgets`
  (unchanged by this commit): the pulse layout is read-order preference
  only, and `GET /dashboard/widgets` is the sole gate on which cards a
  caller's data can populate — a layout cannot make a card appear whose
  block that endpoint did not return. `schemas/dashboard_pulse.py`'s
  `PulseCardPreference`/`DashboardPulseLayout` use `extra="forbid"`, a
  `Literal` allowlist of 8 card ids (unknown ids are dropped, not stored),
  a 40-character title cap with a control-character rejection, and a
  duplicate-card-id rejection; `normalize_pulse_layout` degrades any
  malformed stored value to "not set" rather than raising (read on every
  dashboard load). New `users.dashboard_pulse` column
  (`a51a4e1d2443_add_user_dashboard_pulse.py`): nullable JSON, no FK
  (pitfall #2 n/a), guards `_has_table`/`_has_column` (pitfall #26). Both
  write handlers assign a fresh dict from `stored_layout()` rather than
  mutating an existing one in place, so the plain JSON column change is
  seen by SQLAlchemy without needing `flag_modified`. Department-level
  writes are audit-logged (`log_audit_event`,
  `organization_settings_updated`). No finding.
- **Four smaller real changes, each reviewed and clean:** `fix(reports):
read report date ranges on the department's calendar` (GF-24a) —
  timezone-correctness only, org id already resolved by the caller before
  reaching the changed date-math helpers, no query org-filter touched;
  `feat(reports): warn on a range predating the tracking mode` (SCHED-14,
  SCHED-15) — two additive, non-sensitive keys on the call-volume report
  payload and a JSON-setting timestamp stamped from the existing
  `update_scheduling_settings` write path, already org-scoped; `fix(inventory):
low stock sums lots...` (W47-6) — the dashboard's low-stock widget gained
  one additive `exclude_item_types` keyword on an already org-scoped call,
  no new query; `fix(reports): keep the available-reports list an array on
a malformed response` (RPT2-29-2, frontend) — a defensive `asArray()` on
  the store, no backend change.
- **mypy-cleanup commits** (`51c77a9c`, `c926b687`, `0d4d7c5a`, `0dfcd516`,
  `f5ad6018`, `265a26be`) touching `dashboard.py`, `platform_analytics.py`,
  `reports_service.py`, `attendance_dashboard_service.py`,
  `dashboard_widget_service.py`: type annotations and `hasattr(...,
"value") else str(...)` → `str(getattr(..., "value", ...))` rewrites,
  each mechanically equivalent; spot-checked several for a dropped
  `organization_id` filter or changed query shape — none found.
- **Accessibility-only commits** (`fb70c06a`, `7770b180`, `b5c5f90e`,
  `e8425b6e`) touching `ReportsPage.tsx`/`SavedReportsPage.tsx`: dialog
  `aria-modal`/role/name, `aria-disabled` on busy buttons, heading levels —
  no security relevance, confirmed by reading each diff.
- **`f460cd48` (FORM-10) is the squash/rebase history-boundary artifact**
  prior passes have already documented (its diff is "every file in this
  feature added at once," 11226 insertions across 40 files, with no
  resolvable parent) — not a real touch to this feature's scope, and its
  actual subject (one-submission-per-person on forms) belongs to Feature 26
  (Forms), already reviewed there.

**Re-verification, not re-citation.** `RPT6-29-1` (pipeline_overview
self-exposure) re-confirmed fixed by direct read of
`_generate_pipeline_overview` and both `reports.py` endpoints that pass
`hidden_prospect_ids` through. `RPT2-29-2` is now RESOLVED (above), so it
moves out of "still flagged." Every other still-flagged item from pass 8
(`LBL-29-2`, `LBL-29-4`, `RPT-5c`/`RPT-6`/`RPT-7`, `DASH-2`,
`RPT5-29-1`/`RPT5-29-5`) re-confirmed unchanged by direct read — none
re-litigated here. Route surface re-enumerated: 30 → 34 (+4:
`/dashboard/pulse-layout` × 2 verbs self-scoped, `/dashboard/pulse-layout/default`
× 2 verbs `settings.manage`-OR-gated); every route carries a recognized
auth dependency.

**Also discovered and fixed (unrelated to this feature's own code, but
blocking the completion gate):** the Alembic chain had forked into two
heads — `244b0fd07205` (ballot send jobs, a different pull request) and
`d3bb8f81ed07` (directory account license flags, another). Neither
revision's branch had seen the other when it merged, which is the same
shape CLAUDE.md's migration-fork precedents describe. Resolved with a merge
revision (`fccdac60063f`, `20261017_1330_fccdac60063f_merge_heads.py`),
clean per `validate_migrations.py --strict`. The sandbox database was then
behind both branches' new columns (`ballot_send_jobs.kind`, two
`directory_account_provisions` flags); `alembic upgrade head` plus
`scripts/repair_schema.py` brought it current, after which the four tests
that had failed only on the missing `ballot_send_jobs.kind` column
(`test_ballot_send_jobs.py` ×3, `test_w50_roster_frozen_roll.py` ×1 — none
in this feature's own files) passed with no code change. This is an
environment/migration-graph fix, not part of this feature's own diff, and
is recorded per CLAUDE.md's "no silent pass-over" rule.

## Completion gate (pass 9)

| Check                                                                                                                                             | Result                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.3.0`, pinned)                                                                                           | ✅ 0 violations                                                                   |
| `black --check app/ tests/ alembic/` (`black==26.5.1`, pinned)                                                                                    | ✅ 2416 files unchanged                                                           |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`, pinned, matches CI)                                                                    | ✅ clean                                                                          |
| `python3 scripts/validate_migrations.py --strict`                                                                                                 | ✅ 616 revisions, single head `fccdac60063f` (after the merge-revision fix above) |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline"` | ✅ **1291 passed**, 1 skipped (`pywebpush`, env-only)                             |
| `pytest tests/` (full unit suite, `-m "not integration and not slow and not docker"`)                                                             | ✅ **15472 passed**, 4 skipped (env-only), 0 failed                               |
| `cd frontend && npm run typecheck`                                                                                                                | ✅ 0 errors                                                                       |
| `cd frontend && npm run lint`                                                                                                                     | ✅ 0 errors, 0 warnings                                                           |
| `cd frontend && npx vitest run src/modules/reports`                                                                                               | ✅ **73 passed** (8 files)                                                        |

Findings: 0 fixed in this feature's own code, 0 new, 1 standing finding
(RPT2-29-2) resolved by regular engineering work and verified. No
`KNOWN_LIMITATIONS.md` change needed — its RPT2-29-2 entry already carries
a "✅ Resolved 2026-10-11" note matching the fix described above, checked
against current code rather than taken on its own say-so, and needed no
correction. Rotation row 29 → ✅. Next: Feature 30 (Onboarding).

## Pass 10 (2026-10-20)

**Prefix:** `RPT6` (unchanged) · **Rotation pass:** 10 · **Reviewed:**
2026-10-20 · **PR:** (this PR)

Baseline: pass 9's merge, PR #3379 (`11807edf`). `git log 11807edf..HEAD`
restricted to this feature's backend scope files (`reports.py`,
`analytics.py`, `platform_analytics.py`, `dashboard.py`, `labels.py` and
their schemas/models, plus `reports_service.py`,
`dashboard_widget_service.py`, `attendance_dashboard_service.py`,
`label_service.py`, `label_printer_service.py`, `saved_report_schedule.py`)
and `frontend/src/modules/reports` found exactly two real (non-merge)
commits:

- **`86882208` ("Count dashboard overdue dues by the dues screen's
  rule").** `dashboard_widget_service.py`'s finance tile now counts
  `MemberDues` rows via the shared `dues_overdue_clause(now)` (the same
  predicate the Dues list, its filter and `mark_overdue_dues` already use)
  instead of a hand-rolled `status IN (...) AND due_date < ...` that
  double-counted part-paid records. Read in full: the query still filters
  `MemberDues.organization_id == organization_id`; the change is a
  predicate substitution for correctness, nothing touches scoping or
  authorization. No finding.
- **`5ef9c11e` (workflow-review W72, "reports — 3 fixed, 0 flagged").**
  Adds an `admin_hours` entry to `get_available_reports()`'s catalog
  (`reports_service.py`), fixes the Admin Hours report's per-row date to
  use the org's local day instead of UTC
  (`resolve_reporting_timezone`/`local_date`), and makes `ReportsPage.tsx`
  actually call `/reports/available` to filter its fixed card list rather
  than always offering every card. Re-verified from this feature's own
  angle, not taken on the commit message's word: `admin_hours` was already
  present in `PII_REPORT_PERMISSIONS`
  (`saved_report_schedule.py:81` → `"admin_hours": "admin_hours.manage"`)
  and `generate_report` already calls
  `_enforce_report_pii_permission(current_user, request.report_type)`
  (`reports.py:118`) before generating — so listing the catalog entry does
  not open a new report type, it only lets `/available` (which already
  filters `PII_REPORT_PERMISSIONS` entries by the caller's permission,
  `reports.py:95-109`) and the frontend correctly show/hide a report that
  was already gated server-side. The date fix and the frontend diffs
  (`ExportControls.tsx`, `AdminHoursRenderer.tsx`, `SavedReportsPage.tsx`)
  are touch-target/accessibility/label-formatting only — no
  `dangerouslySetInnerHTML`, no new API call. No finding.

**Re-verification, not re-citation.** Every standing item from pass 9
(`LBL-29-2`, `LBL-29-4`, `RPT-5c`/`RPT-6`/`RPT-7`, `DASH-2`, `RPT5-29-1`/
`RPT5-29-5`) re-confirmed unchanged by direct read this pass — none of this
pass's two commits touch the files those findings cite
(`labels.py`, `platform_analytics.py`, `dashboard.py`'s non-pulse routes,
or `reports_service.py`'s `compliance_status`/`training_summary`/
`_generate_inventory_status`/`apparatus_status` generators), so there is no
new evidence to weigh and no re-litigation below. Route surface
re-enumerated: unchanged at 7 + 3 + 1 + 12 + 12 = 35 routes across the five
endpoint files; every route carries a recognized auth dependency
(`require_permission`, `get_current_user`, or `get_current_active_user`).

## Completion gate (pass 10)

| Check                                                                                                                                                                                                                              | Result                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.3.0`, pinned)                                                                                                                                                                            | ✅ 0 violations                                      |
| `black --check app/ tests/ alembic/` (`black==26.5.1`, pinned)                                                                                                                                                                     | ✅ clean                                             |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`, pinned, matches CI)                                                                                                                                                     | ✅ clean                                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                  | ✅ 631 revisions, single head `ca0c2111466f`         |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report" -m "not integration and not slow and not docker"` | ✅ **898 passed**, 1 skipped (`pywebpush`, env-only) |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                 | ✅ 0 errors                                          |
| `cd frontend && npm run lint`                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings                              |
| `cd frontend && npx vitest run src/modules/reports`                                                                                                                                                                                | ✅ **77 passed** (9 files)                           |

Findings: 0 fixed, 0 new, 0 standing findings changed. No
`KNOWN_LIMITATIONS.md` change needed — nothing this pass found is an
owner-decision item and RPT2-29-2's existing resolved note still matches
current code. Rotation row 29 → ✅ (pending this PR's merge). Next: Feature
30 (Onboarding).

## Pass 11 (2026-10-24) — rotation lap 2; RPT5-29-1/RPT5-29-5 were already

resolved and this file's own pass 9/10 sections had missed it

**Prefix:** `RPT6` (unchanged) · **Rotation pass:** 11 · **Reviewed:**
2026-10-24 · **PR:** (this PR)

**Step 0:** `search_pull_requests` (`head:claude/security-review-`,
state=open) → 0 results immediately before starting. `PROGRESS.md`'s table
had every row ✅ as of the pass-11 watchdog note in
`SEC-00-cross-cutting-baseline.md` and was reset to ⬜ for this lap; row 29
was the first ⬜ row, confirmed by reading the table directly on a freshly
fetched, unshallowed `main` (`597ad4f5`).

**Baseline:** pass 10's merge, `886e21faf`. **Real delta since then**,
diffed directly against all ten scope files plus `frontend/src/modules/reports`
(`git log --oneline 886e21fa..HEAD -- <scope>`, excluding merge commits):

- **`5b7ee3ca1` (app-review B16, `RPT2-1`/`RPT2-2`).** `analytics.py`'s
  `/track` now bounds `metadata` to 4 KB and `/metrics`'s failure breakdown
  keys on a plain, length-capped string (`_failure_reason`) instead of
  whatever a client posted — a non-string or oversized `error_reason` could
  previously 500 every later `/metrics` call for the organization. Read in
  full: org-scoping untouched, no new query shape. Already fixed and
  covered by `tests/test_analytics_endpoints_integration.py`
  (re-run above, passing).
- **`8a57d0699` (Pitfall #32 sweep).** `dashboard.py` (3 sites),
  `attendance_dashboard_service.py` (1) and `reports_service.py` (5) moved
  `User.status == UserStatus.ACTIVE` to
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`, so a probationary member now
  counts in the dashboard's active-member tiles, the attendance roster, and
  every `ReportsService` population this file's own `active_result`
  queries build. Every changed query still filters
  `organization_id`/`org_id` on the same line — this is a predicate
  widening, not a new tenancy surface. Covered by the repo-wide
  `tests/test_account_status_gates.py` (re-run above, passing).
- **`94c8d82d7`.** `update_saved_report`/`run_saved_report` added
  `SavedReport.is_active.is_(True)` to their by-id, org-scoped lookup, so a
  soft-deleted saved report can no longer be edited or re-run by id — a real
  bug fix, still org-scoped, no new finding.
- **`746382501`.** `labels.py`'s `LabelPrinterBody.dpi` and
  `schemas/reports.py`'s `SavedReportCreate`/`Update.schedule_day` gained
  `ge=INT32_MIN, le=INT32_MAX` — mechanical, part of the repo-wide numeric-
  bounds sweep.
- **`755011342`.** One line in `ReportsPage.tsx`, a contrast-only shade
  change — no security relevance.
- Three merge commits (`659acd468`, `b29ba6ee2`, `489f3f646`) carry no
  content beyond the five commits above — confirmed by reading each one's
  diff against its first parent.

Route surface re-enumerated **by AST** this pass (not by re-reading the prior
table): a small script walked every `@router.<verb>(...)`-decorated function
across the five endpoint files and printed path, handler and every
`Depends(...)` default. **35 routes** (7 + 3 + 1 + 12 + 12), unchanged from
pass 10. Every route carries `get_db` plus one of
`get_current_user`/`get_current_active_user`/`require_permission(...)`; the
three with no permission beyond authentication
(`track_event`, `get_label_preset`/`set_label_preset`,
`list_label_printers`, `preview_labels`/`generate_labels`/`print_labels`) are
exactly the ones already named in LBL-29-2 and the `_authorize_module`
dynamic-permission design — re-confirmed by reading `_authorize_module`
(`labels.py:65-75`) and its four call sites directly, not taken from the
prior pass's table.

### RPT6-29-2 — LOW (documentation/process) — RPT5-29-1 and RPT5-29-5 were fixed on 2026-10-11 but this file's pass 9 and pass 10 sections both recorded them as "still flagged, unchanged" — ✅ CORRECTED

**What:** `28b65fb26` ("label the program-progress reports as such and grade
grandfathered members (RPT5-29-1)"), merged 2026-10-11 — six days _before_
pass 9 (2026-10-17) and _inside_ pass 9's own diffed window
(`b40475bd2..11807edf2`, pass 8's merge to pass 9's merge) — rewrote
exactly the two things RPT5-29-1/RPT5-29-5 were about:

1. **Relabeled, per RPT5-29-1's own option (2).** `compliance_status` is now
   titled "Program Requirement Progress" and `training_summary` "Training &
   Program Progress Summary" (`reports_service.py:1610,1665`; ids, routes
   and response shapes unchanged), with both descriptions and their
   renderers saying plainly they measure program-enrollment progress, not
   org-wide annual compliance.
2. **Fixed the grandfathering gap RPT5-29-5 described.**
   `_generate_training_summary`'s `requirement_breakdown` section
   (`reports_service.py:396-465` at current line numbers) now calls
   `requirement_applies_to_user`/`catch_up_deadline` per member/requirement
   — read directly this pass — exactly as `_generate_compliance_status`
   already did, so a grandfathered-exempt or still-catching-up member is no
   longer counted as unmet. `tests/test_training_summary_program_progress.py`
   (4 tests) and `frontend/.../programProgressLabels.test.tsx` (3 tests)
   both re-run this pass, passing.

`docs/KNOWN_LIMITATIONS.md`'s RPT5-29-1 entry already carries an accurate
"✅ Resolved 2026-10-11" note dated the same day as the fix — so the
_product_ record was never wrong. The miss is confined to this rotation's
own findings file: pass 9's "real delta" enumeration listed the mypy-cleanup
commits that touch nearby lines
(`0d4d7c5a0`/`0dfcd5168`/`f5ad6018a`) but never surfaced `28b65fb26` itself,
despite it being a direct, non-merge commit to `reports_service.py` inside
the exact window pass 9 diffed — and then stated "RPT5-29-1/RPT5-29-5
re-confirmed unchanged by direct read," which this pass's own re-read of the
same lines shows was not true at the time it was written. Pass 10 then
explicitly declined to re-open the question ("none of this pass's two
commits touch the files those findings cite... so there is no
re-litigation below"), carrying pass 9's miss forward unverified for a
second pass.

**Where:** `docs/security-review/RPT6-29-reports-analytics.md` — pass 9's
and pass 10's "Still flagged" sections (unchanged, left as the historical
record of what each pass believed); `backend/app/services/reports_service.py:1610,1665,396-465`
(the fix itself); `28b65fb26` (the fix commit);
`docs/KNOWN_LIMITATIONS.md`'s RPT5-29-1 entry (already correct).

**Impact:** no security exposure of any kind — this was always a
correctness/trust finding (two screens disagreeing), not a leak or an
authorization gap, and it was already fixed in the code the whole time this
rotation's own paperwork said otherwise. The impact is confined to this
rotation's bookkeeping: a reader trusting pass 9/10's "still flagged" list
over the actual source would believe an open item remained open for two
passes after it closed.

**Why re-verification (not re-citation) matters here:** this is the second
time one of this rotation's intermediate passes has carried a stale claim
forward without re-reading the cited lines (RPT6-29-1's own writeup
contrasts with every prior pass having missed that defect too) — both are
instances of the same root cause the skill's Step 3 already names ("A
repeat pass re-enumerates too... reviewing only the files the diff lists").
Pass 9's delta enumeration here was not wrong about which commits existed
in its window; it simply did not read `reports_service.py`'s two relevant
sections end to end against the _current_ text of its own open findings
before writing "re-confirmed unchanged."

**Fix:** none needed in application code. **Disposition: CORRECTED** — this
pass's own "Still flagged" list below drops RPT5-29-1/RPT5-29-5. No
`KNOWN_LIMITATIONS.md` change needed (already accurate).

## Still flagged, re-confirmed unchanged (pass 11)

Re-read directly against current source, not taken from pass 10's table:

- **RPT2-29-2 (MEDIUM/policy) — RESOLVED, not re-opened.** Already fixed by
  pass 9 (`saved_report_delivery` scheduled task); `enforced` on
  `SavedReportResponse` is now `bool(r.is_scheduled)`
  (`reports.py:156`), confirmed by direct read. Listed here only to record
  that it was checked, not because it is open.
- **LBL-29-2 (LOW/policy)** — `GET /label-printers` (`list_label_printers`)
  still carries no permission dependency beyond `get_current_user`
  (`labels.py`'s AST-enumerated dependency list this pass), a deliberate
  documented design choice (LAN host/port/location only, no credentials).
  Unchanged.
- **LBL-29-4 (Informational)** — `LabelService.generate()`
  (`label_service.py:562`) still has no count cap of its own, unlike
  `LabelPrinterService`'s `MAX_LABELS_PER_JOB = 500`
  (`label_printer_service.py:56,372`) on the print path; bounded only by
  `LabelGenerateBody.ids`'s `max_length=2000`. Unchanged, flagged asymmetry.
- **RPT-5c / RPT-6 / RPT-7** — `_generate_inventory_status`'s
  `float(item.current_value)` (`reports_service.py:1114`, the codebase-wide
  FIN-7 Decimal refactor), `apparatus_status.last_inspection_date`
  hardcoded `None` (`reports_service.py:1044`, incomplete feature — the
  field is populated correctly two report types over, at
  `reports_service.py:1142-1143`, confirming this one is simply not wired
  rather than broken), and the shared-requirement double-enrollment
  completion-percentage-over-100% case — all re-confirmed unchanged by
  direct read this pass.
- **DASH-2 (LOW)** — `GET /dashboard/stats` / `dashboardService.getStats()`
  still has zero frontend callers (`grep -rn "\.getStats()" frontend/src/`,
  filtered to the dashboard service's own export — zero hits, re-checked
  this pass). Delete-or-implement, unchanged since 2026-08-08.

## Addendum to pass 11 — a second, independent watchdog session raced this same pass concurrently

A second watchdog session worked this same rotation slot at the same time
(both ran Step 0's `search_pull_requests`/`list_pull_requests` check before
either had pushed, so neither saw the other's in-flight branch). Rather than
open a duplicate, competing PR, that session's one genuinely new finding is
folded into this PR as a follow-up commit, per this rotation's own
"Medical supplies pass 16" precedent for exactly this situation.

### RPT6-29-3 — LOW — Member Roster report's own Active/Inactive tally counted a probationary member as inactive — ✅ FIXED

**What:** the repo-wide probationary-account-status sweep (`8a57d069`,
CLAUDE.md Pitfall #32) moved every `User.status == UserStatus.ACTIVE`
**query filter** in this feature's files to
`User.status.in_(ACTIVE_ACCOUNT_STATUSES)`, but `_generate_member_roster`
(`reports_service.py`) has no status filter at all — it lists every member
and classifies each into the report's own `active_members`/
`inactive_members` tallies with a **local-variable** comparison,
`is_active = status_val == UserStatus.ACTIVE.value`. The sweep's own
detector (`tests/test_account_status_gates.py`'s `_LITERAL_ACTIVE` regex,
which matches `User.status`/`user.status` directly) cannot pattern-match a
local variable holding the status string, so this site was never on the
sweep's list and survived it untouched.

**Where:** `app/services/reports_service.py`, `_generate_member_roster`
(pre-fix at line 233).

**Failure scenario:** any `reports.view` holder runs the Member Roster
report. Every probationary member is listed correctly in `members[]` with
`status: "probationary"`, but the report's own "Active"/"Inactive" stat
cards (`frontend/src/modules/reports/components/renderers/
MemberRosterRenderer.tsx:44-45`) count that same member under **Inactive**
— understating current headcount on the one screen built to answer that
question. No row is hidden (unlike the query-filter shape Pitfall #32
usually describes); only the summary tally is wrong.

**Impact:** data-integrity/correctness, not an access-control bypass or a
cross-tenant leak. Severity LOW. `grep -rn "== UserStatus.ACTIVE.value"
app/` finds only this one site in the whole backend.

**Fix:** `is_active` now checks membership in `{s.value for s in
ACTIVE_ACCOUNT_STATUSES}` rather than equality with the single `ACTIVE`
value — the same rule the rest of this file already applies, extended to
the one call shape the existing sweep's regex can't see.
`test_account_status_gates.py`'s `_LITERAL_ACTIVE` regex itself is left
untouched: it is a shared, repo-wide test outside this feature's files, and
generalizing it to also catch an arbitrarily-named local variable risks
false positives across the 300+ files it already sweeps clean —
flagging the gap here rather than widening someone else's detector for a
one-site fix.

**Guard test:** `backend/tests/test_reports_service.py::
TestMemberRosterActiveTally::test_probationary_member_counts_as_active_not_inactive`
— three mock users (active, probationary, suspended); asserts
`active_members == 2`, `inactive_members == 1`, and that each member's own
`status` field is still reported verbatim (proving the fix changes only the
tally, not the per-row data). Confirmed red against the pre-fix code
(`active_members == 1`) before the fix, green after (CLAUDE.md Pitfall #37).

**Completion gate for this addendum:**

| Check                                                                                                                                                                                                                              | Result                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.3.0`, pip-installed to match CI)                                                                                                                                                         | ✅ 0 violations                              |
| `black --check app/ tests/ alembic/` (`black==26.5.1`, pip-installed to match CI)                                                                                                                                                  | ✅ 2612 files unchanged                      |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`, pip-installed to match CI)                                                                                                                                              | ✅ clean                                     |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                  | ✅ 650 revisions, single head `a8c3b50b6d9b` |
| `pytest tests/test_reports_service.py -k MemberRosterActiveTally` against the pre-fix code                                                                                                                                         | ✅ fails red (`active_members == 1`, not 2)  |
| `pytest tests/test_reports_service.py -k MemberRosterActiveTally` after the fix                                                                                                                                                    | ✅ 1 passed                                  |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report" -m "not integration and not slow and not docker"` | ✅ 922 passed, 1 skipped (env-only)          |
| `pytest tests/test_account_status_gates.py`                                                                                                                                                                                        | ✅ 12 passed                                 |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                 | ✅ 0 errors                                  |
| `cd frontend && npm run lint`                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings (exit 0)             |

Findings for the addendum: 1 fixed (RPT6-29-3, LOW). Combined with the rest
of pass 11 above: 1 fixed, 1 documentation correction, 0 new unfixed
findings.

## Completion gate (pass 11)

| Check                                                                                                                                                                                                                              | Result                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (`flake8==7.4.1`, pinned)                                                                                                                                                                            | ✅ 0 violations                                                    |
| `black --check app/ tests/ alembic/` (`black==26.10.1`, pinned)                                                                                                                                                                    | ✅ 2612 files unchanged                                            |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`, pinned, matches CI)                                                                                                                                                     | ✅ clean                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                  | ✅ 650 revisions, single head `a8c3b50b6d9b`                       |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report" -m "not integration and not slow and not docker"` | ✅ **921 passed**, 1 skipped (`pywebpush`, env-only)               |
| `pytest tests/` (full unit suite, `-m "not integration and not slow and not docker"`)                                                                                                                                              | ✅ **17281 passed**, 4 skipped (env-only: `pywebpush`, `nginx` ×3) |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                 | ✅ 0 errors                                                        |
| `cd frontend && npm run lint`                                                                                                                                                                                                      | ✅ 0 errors, 0 warnings (exit 0)                                   |
| `cd frontend && npx vitest run src/modules/reports`                                                                                                                                                                                | ✅ **77 passed** (9 files)                                         |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                  | ✅ 275 routes, 0 errors, 0 warnings                                |

Findings: 0 fixes to application code, 0 new security findings, 1
documentation correction (RPT6-29-2, dropping a two-pass-old stale "still
flagged" status for an item that was already fixed). No
`KNOWN_LIMITATIONS.md` change needed. Rotation row 29 → ✅ (pending this
PR's merge). Next: Feature 30 (Onboarding).

## Pass 12 (2026-10-27) — watchdog pickup, real delta (timezone/UX correctness fixes), 0 new findings

Watchdog pickup (dedicated `/loop 30m /security-review` session
`session_011T1ZyyLrD5HagusgK9uDw2` unreachable, confirmed via `ListAgents`).
No open security-review PR — confirmed via `search_pull_requests`, 0
results, after Feature 28 (Security, audit & IP) pass 10's own PR (#3783)
merged. Row 29 confirmed the next `⬜` row by reading the rotation table on
a freshly fetched `main` (head `115bd921`).

**Baseline:** pass 11's merge, `14e95ce1` (PR #3647). **Real delta since
then**, each of this doc's ten backend files plus `frontend/src/modules/reports`
diffed by content (`git diff --stat 14e95ce1..HEAD -- <file>`) rather than
trusted from `git log`: two files carry a real diff, `reports.py`,
`dashboard.py`, `labels.py`, `reports_service.py`,
`dashboard_widget_service.py`, `attendance_dashboard_service.py`,
`label_service.py`, `label_printer_service.py`, `schemas/reports.py` and
the frontend module are all byte-identical to pass 11's merged state.

- **`analytics.py`'s `/metrics` hourly-activity breakdown now buckets by the
  organization's local hour instead of UTC (W75).** Rows are grouped by UTC
  date+hour in SQL (`func.date(...)`/`extract("hour", ...)`, at most 24
  buckets per day), then each bucket is converted with
  `resolve_reporting_timezone` (pre-existing, Scheduling's own utility,
  already reviewed under Feature 15) and re-bucketed by local hour. Read in
  full: the underlying `base_filter` (org-scoping) is untouched, no new
  query shape, no client-supplied timezone — the org id passed to
  `resolve_reporting_timezone` is always `current_user.organization_id`.
  Pure correctness fix (an evening check-in no longer appears after
  midnight on the chart); **verified good, no new finding.**
- **`platform_analytics.py`'s login/error trend charts now bucket by local
  calendar day instead of UTC day, and the charted window now matches the
  headline total printed above it (W78-1), and the Module Usage section now
  reads the organization's actual `enabled_modules` instead of a hardcoded
  `True` for every module (W78-2).** Read the full diff: every query
  changed still filters `User.organization_id == org_id` /
  `ErrorLog.organization_id == org_id` on the same line — this is a
  bucketing/label change, not a new tenancy surface (Pitfall #14
  unaffected). `OrganizationService(db).get_enabled_modules(org_id)` is
  called with the caller's own org id, not a client-supplied one. The
  endpoint's auth dependency is unchanged
  (`require_permission("settings.manage")`, confirmed by direct read).
  Both fixes are covered by dedicated integration tests
  (`tests/test_platform_analytics_w78.py`,
  `tests/test_admin_monitoring_w75.py` for the sibling `/metrics` fix) —
  both files are module-level `pytest.mark.integration` (Pitfall #30b,
  correctly scoped: they use `db_session`) and were re-run directly against
  a freshly migrated database (the session's sandbox DB had drifted one
  migration behind `main`'s new head during this rotation; `alembic upgrade
head` resolved it — an environment gap, not a code defect): **4 passed.**
  **Verified good, no new finding.**

No other commit touches `reports.py`, `dashboard.py`, `labels.py`,
`reports_service.py`, `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`, `schemas/reports.py`, or
`frontend/src/modules/reports` since pass 11 — confirmed by `git diff
--stat 14e95ce1..HEAD -- <each file>` individually, each empty.

### Route inventory — re-enumerated by AST, 35 routes, unchanged from pass 11

Counted every `@router.<method>` decorator in the five endpoint files
directly: 7 (`reports.py`) + 3 (`analytics.py`) + 1 (`platform_analytics.py`)

- 12 (`dashboard.py`) + 12 (`labels.py`) = **35**, identical to pass 11. No
  route added, removed, or re-gated; `get_platform_analytics`'s
  `require_permission("settings.manage")` dependency is unchanged.

### Still flagged — every open item re-checked against current code, not the doc

- **LBL-29-2 (LOW/policy)** — `list_label_printers` (`labels.py:318`) still
  carries only `get_current_user`, no permission string; re-read in full,
  unchanged (deliberate: LAN host/port/location only, no credentials).
- **LBL-29-4 (Informational)** — `LabelService.generate()`
  (`label_service.py:562`) still has no count cap of its own, unlike
  `LabelPrinterService.MAX_LABELS_PER_JOB = 500`
  (`label_printer_service.py:56,372`); re-grepped, unchanged.
- **RPT-5c / RPT-6 / RPT-7** — `_generate_inventory_status`'s
  `float(item.current_value)`, `apparatus_status.last_inspection_date`
  hardcoded `None`, and the shared-requirement double-enrollment
  completion-percentage case — `reports_service.py` has zero commits since
  pass 11, so all three are unchanged by definition; not independently
  re-executed beyond that diff check.
- **DASH-2 (LOW)** — `grep -rn "dashboardService\.getStats" frontend/src/`
  — 0 hits, re-checked this pass. Still zero callers, unchanged since
  2026-08-08.

### No new findings this pass

**0 fixes applied, 0 new findings.** Both real changes found were already
fixed and shipped by other work (the W75/W78 workflow-review passes); this
pass's job was re-verifying each against current code, which is what the
"Verified good" entries above record. No `KNOWN_LIMITATIONS.md` change
needed — none of the four open items' status changed this pass.

### Completion gate (Pass 12)

| Check                                                                                                                                                                                                                              | Result                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                      | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                               | ✅ 2702 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                          | ✅ clean                                         |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                                  | ✅ PASSED, single head `b8236e29ec44`            |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                  | ✅ 279 routes, 0 errors, 0 warnings              |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report" -m "not integration and not slow and not docker"` | ✅ 948 passed, 1 pre-existing skip (`pywebpush`) |
| `pytest tests/test_platform_analytics_w78.py tests/test_admin_monitoring_w75.py` (integration, run directly after migrating the sandbox DB to head)                                                                                | ✅ 4 passed                                      |
| `cd frontend && npm run typecheck`                                                                                                                                                                                                 | ✅ 0 errors                                      |
| `cd frontend && npm run lint`                                                                                                                                                                                                      | ✅ clean, exit 0                                 |
| `cd frontend && npx vitest run src/modules/reports`                                                                                                                                                                                | ✅ 77 passed (9 files)                           |

Next in rotation: Feature 30 (Onboarding — `api/v1/onboarding.py`, 26 unauth
bootstrap routes).

## Addendum to pass 12 — a second, independent watchdog session raced this same pass concurrently

A second watchdog session worked this same rotation slot at the same time
(both ran Step 0's `search_pull_requests` check before either had pushed, so
neither saw the other's in-flight branch; the second session's push was
rejected with "fetch first" against this already-pushed branch name). Rather
than open a duplicate, competing PR, that session's findings are folded in
here as this follow-up commit, per this rotation's own "Medical supplies
pass 16" and "pass 11 addendum" precedent for exactly this situation.

**Gap found: this pass's own file enumeration never checked
`saved_report_schedule.py` or `app/utils/external_recipients.py`, both in
this feature's declared scope** (the pass 11 PR's own "Backend" line lists
`saved_report_schedule.py` among this feature's services). The passage above
lists nine backend files plus the frontend module as "byte-identical to pass
11's merged state" — `saved_report_schedule.py` is not among them, and
`external_recipients.py` isn't named at all. A direct `git diff --stat
14e95ce1..HEAD` confirms both have substantial real changes (248 and 23
lines) since pass 11's merge, left entirely unreviewed by this pass.

(One apparent second gap was checked and ruled out rather than reported: a
`git log --oneline 14e95ce1..HEAD -- backend/app/services/reports_service.py`
run during the race lists `5ef9c11e` — Oct 16, predating pass 11's own Oct
24 merge — as if it were new. `git merge-base --is-ancestor 5ef9c11e
14e95ce1` returns false, so it is topologically not an ancestor, yet `git
diff --stat 14e95ce1..HEAD -- reports_service.py` shows **zero** difference.
This is the repo's own documented shallow-clone/rebase history-boundary
artifact — `git log`'s path-filtered traversal surfacing a commit whose
content independently already matches the target, not a real unreviewed
change. Confirmed by content diff, not by trusting `git log`, precisely
because this rotation has been burned by trusting a log enumeration before
(RPT6-29-2). `reports_service.py` is correctly byte-identical to pass 11, as
this pass's own text says.)

### RPT6-29-4 — review completeness gap (no code change) — `saved_report_schedule.py` / `external_recipients.py`'s real delta since pass 11 was never reviewed by this pass — ✅ CORRECTED

**What:** two commits, `016d389e` ("Make scheduled report delivery
retry-safe and idempotent") and `deb1d3e0` ("Report delivery follow-ups:
compliance email outcome, failed-attempt record, recipient de-dupe,
weekly-report retry"), together rewrite `send_due_saved_reports`/`_send_one`
in `saved_report_schedule.py` and add `dedupe_addresses` to
`external_recipients.py`. Read in full this pass:

- **`next_run_date` now advances only after the email is accepted** (was:
  advanced before sending), so a failed or crashed send retries on the next
  daily run instead of silently skipping that occurrence until the next
  scheduled one — the exact shape CLAUDE.md Pitfall #36 asks for on a
  reminder-type send (at-least-once is the right choice here; a duplicate
  summary email is the lesser harm than one that never arrives, and the
  function's own docstring says so).
- **Each saved report now runs in its own `try`/`except`**, re-fetching the
  row by id per iteration rather than holding a loaded instance across a
  `rollback()` (which would raise `MissingGreenlet` on next access) — one
  report's exception is logged via `persist_task_error_log` and no longer
  blocks the reports after it in the same department.
- **An occurrence that can never succeed** (owner lost `_owner_may_run`,
  every recipient refused by the PII gate, an unknown schedule frequency, or
  `ReportsService.generate_report` returning an `"error"` key) is still
  settled via `_settle_without_sending` so it isn't retried forever — the
  other half of Pitfall #36 ("name the id that makes the second run a
  no-op").
- **`dedupe_addresses`** (new) replaces a bare `list(set(saved.email_recipients))`-style
  filter with a case-insensitive, trimmed, stable-order dedupe, preserving
  the pre-existing `isinstance(address, str)` filter — `A@x.org` and
  `a@x.org` no longer both receive a copy.
- **Every query in the touched functions stays scoped** to
  `organization_id`/`saved.organization_id`/`org_id` — no tenancy surface
  changed, only send timing, error isolation and recipient normalization.
  Logger calls throughout use the `logger.warning("...{}", arg)`
  positional-argument form, never an f-string combined with positional
  arguments (Pitfall #33).
- A companion fix in the same two commits, to `compliance_config_service.py`
  (`auto_report_exists`) and `scheduled_tasks.py`, correctly applies the
  Pitfall #27 lock-then-locking-read pattern to make the compliance
  auto-report task idempotent too — that file is Feature 20's own scope, not
  re-litigated here, but read in full to confirm it introduces nothing this
  feature's own `saved_report_schedule.py` depends on incorrectly.

**Where:** `backend/app/services/saved_report_schedule.py` (the whole
`_send_one`/`send_due_saved_reports` rewrite), `backend/app/utils/
external_recipients.py` (`dedupe_addresses`, new); commits `016d389e`,
`deb1d3e0`.

**Impact:** no security exposure — every change is already fixed, tested
(`tests/test_saved_report_delivery.py` gained 124 lines across the two
commits covering retry-on-failure, per-report isolation, and the
unsendable-occurrence settle path) and shipped. The impact is confined to
this rotation's own completeness: this pass's file enumeration omitted two
in-scope files entirely rather than reviewing and clearing them, which is
the same root cause this rotation's own Step 3 rule already names ("a
repeat pass re-enumerates too... reviewing only the files the diff lists")
and the same category of miss as RPT6-29-2 (pass 9/10 carrying a stale claim
forward without re-reading the cited file).

**Fix:** none needed in application code. **Disposition: CORRECTED** — this
addendum records that `saved_report_schedule.py` and
`external_recipients.py` were in fact reviewed (by this follow-up) and found
clean, so the next pass's baseline diff starts from a state where every
in-scope file has actually been read, not assumed byte-identical.

**Completion gate for this addendum:**

| Check                                                                                                                                                                                   | Result                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                           | ✅ 0 violations                    |
| `black --check app/ tests/ alembic/`                                                                                                                                                    | ✅ clean                           |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                               | ✅ clean                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                       | ✅ single head `b8236e29ec44`      |
| `pytest tests/test_saved_report_delivery.py tests/test_compliance_auto_report_idempotency.py tests/test_external_recipient_audit.py tests/test_security_weekly_report.py -v`            | ✅ all passed                      |
| Scoped backend tests (`-k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report"`) | ✅ 948 passed, 1 pre-existing skip |
| `cd frontend && npm run typecheck`                                                                                                                                                      | ✅ 0 errors                        |
| `cd frontend && npm run lint`                                                                                                                                                           | ✅ 0 errors, 0 warnings            |

Findings for the addendum: 0 fixes (nothing needed), 1 documentation
completeness correction (RPT6-29-4). Combined with the rest of pass 12
above: 0 fixes, 0 new unfixed findings, 1 completeness correction.

## Pass 13 (2026-10-30) — watchdog pickup, zero-delta on all declared backend/frontend files; closes a frontend scope gap, 0 new findings

Watchdog pickup (dedicated `/loop 30m /security-review` session
`session_011T1ZyyLrD5HagusgK9uDw2` unreachable, confirmed via `ListAgents`,
"No reachable agents"). PR #3854 (Feature 28, Security, audit & IP, pass 11)
had already merged (`6e5ba65f`); `search_pull_requests` for
`head:claude/security-review-` returned zero open results both before
starting and again right before this push.

**Baseline:** pass 12 + its addendum's merge, `65b566ee` (PR #3784).

**Zero delta on every backend file and declared service.** Each of the
thirteen backend files this rotation has carried since pass 12's addendum
(`reports.py`, `analytics.py`, `platform_analytics.py`, `dashboard.py`,
`labels.py`, `reports_service.py`, `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`, `schemas/reports.py`, `saved_report_schedule.py`,
`external_recipients.py`) diffed individually against `65b566ee` with `git
diff --stat` — all thirteen empty, despite 219 non-merge commits landing on
`main` in that window. `frontend/src/modules/reports` is likewise empty.

**The declared frontend scope was itself incomplete, and this pass closes
that gap rather than carrying it forward unread.** Every prior pass's header
line reads "Frontend: `modules/reports`" — but `dashboard.py` and
`dashboard_widget_service.py` render through `frontend/src/pages/Dashboard.tsx`,
`analytics.py`/`platform_analytics.py` render through
`frontend/src/pages/AnalyticsDashboardPage.tsx` and
`frontend/src/pages/PlatformAnalyticsPage.tsx`, and `labels.py` renders
through the shared `frontend/src/components/labels/` tree (used by
Apparatus/Facilities/Inventory/Prospective-members' own label-print pages,
which wrap it) — none of which is under `modules/reports`. This is the same
root cause as RPT6-29-4 (pass 12's own addendum): a declared scope line that
undercounts the feature's real surface, left unnoticed because nothing in it
had changed across the passes that would have caught it. Checked this pass,
not deferred:

- **`frontend/src/pages/Dashboard.tsx`** (+2/-0 since `65b566ee`) — adds one
  `<WeatherAlertBanner />` render inside the page body. That component and
  its backing route are Feature 27's (Integrations) own pass-11 scope,
  already reviewed there (org-scoped NWS data, HTML-escaped free text); this
  is a one-line inclusion, not a new finding here.
- **`frontend/src/pages/AnalyticsDashboardPage.tsx`** (+90/-54) — a
  loading-skeleton restructure (the repo-wide layout-shift sweep's shape:
  `loading && !metrics` replaces a bare `loading` guard so the 10-second
  auto-refresh no longer blanks the whole page each cycle; header and
  export-button JSX hoisted into a `const` reused by both the loading and
  loaded branches). No new request, no new field read, no change to
  `analyticsService` calls. Cosmetic. **Verified good, no new finding.**
- **`frontend/src/components/labels/LabelPrintPage.tsx`** (+30/-24 net) and
  new **`frontend/src/components/labels/barcodeGeometry.ts`** (122 lines) —
  replaces a direct `JsBarcode(svgRef.current, value, {...})` call with
  `drawCode128ForPrinter(svg, value, style, availableWidthIn, dpi)`, a
  wrapper that still calls the same `JsBarcode(svg, value, {...})`
  internally (read in full: `barcodeGeometry.ts:87-99`) but renders twice to
  snap the module width to a whole number of printer dots before fixing the
  SVG's physical `width`/`height` attributes in inches. `value` (the encoded
  label text) reaches `JsBarcode` exactly as it did before this refactor —
  same library, same call shape, no new escaping surface introduced or
  removed. Purely a print-fidelity fix (bar width was rounding differently at
  203 dpi than at 96 CSS px, a scanner-readability bug, not a security one).
  **Verified good, no new finding.**
- **`frontend/src/pages/PlatformAnalyticsPage.tsx`** — confirmed unchanged
  (`git diff --stat` empty).

**For future passes, the frontend scope line above now reads correctly** (see
the updated header); this does not change what any future pass must
re-review, since all four files were read here, but it means the next pass's
"byte-identical to pass N" claim can legitimately include them instead of
silently omitting them the way "Frontend: `modules/reports`" did for twelve
passes running.

### Route inventory — re-enumerated by AST from source, 35 routes, unchanged from pass 12

Counted every `@router.<method>(...)` decorator directly, not trusted from
the prior table: 7 (`reports.py`) + 3 (`analytics.py`) + 1
(`platform_analytics.py`) + 12 (`dashboard.py`) + 12 (`labels.py`) = **35**,
identical to pass 12. Every route's auth dependency grepped individually
(`require_permission(...)`, `get_current_user`, or `get_current_active_user`)
— none bare. `list_label_printers` (`labels.py`) is the one route on
`get_current_user` alone among the label-printer CRUD set — this is LBL-29-2
below, unchanged. `print_labels`/`preview_labels`/`generate_labels` on
`get_current_user` alone is the feature's established self-serve pattern
(any authenticated member may render/print a label from data already visible
to them), consistent with every prior pass's gate table, which this pass's
route list reproduces exactly.

### Still flagged — every open item re-checked against current code, not the doc

- **LBL-29-2 (LOW/policy)** — `list_label_printers` still carries only
  `get_current_user`, no permission string; re-grepped this pass, unchanged
  (deliberate: LAN host/port/location only, no credentials).
- **LBL-29-4 (Informational)** — `LabelService.generate()` still has no
  count cap of its own, unlike `LabelPrinterService.MAX_LABELS_PER_JOB = 500`;
  `label_service.py` has zero diff since pass 12, so unchanged by definition.
- **RPT-5c / RPT-6 / RPT-7** — `reports_service.py` has zero diff since pass
  12; all three unchanged by definition, not independently re-executed
  beyond that diff check.
- **DASH-2 (LOW)** — `grep -rn "dashboardService\.getStats" frontend/src/`
  — 0 hits, re-checked this pass. Still zero callers.

### No new findings this pass

**0 fixes applied, 0 new security findings.** The only correction is the
scope-line fix described above, which has no behavior change. No
`KNOWN_LIMITATIONS.md` change needed — none of the four open items' status
changed this pass.

### Completion gate (Pass 13)

| Check                                                                                                                                                                                                   | Result                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (`flake8==7.4.1`, CI's pin)                                                                                                                                               | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/` (`black==26.10.1`, via `python3.13 -m`, CI's pin)                                                                                                                  | ✅ 2743 files unchanged                           |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.2`, via `python3.13 -m`, CI's pin)                                                                                                               | ✅ clean                                          |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                    | ✅ 678 revisions, single head `f90b1124e6f4`      |
| `python3.13 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                    | ✅ 280 routes, 0 errors, 0 warnings               |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard or pipeline or prospect_privacy or membership_pipeline or dues_overdue or saved_report"`                       | ✅ 1513 passed, 1 pre-existing skip (`pywebpush`) |
| `pytest tests/test_platform_analytics_w78.py tests/test_admin_monitoring_w75.py tests/test_saved_report_delivery.py tests/test_external_recipient_audit.py`                                             | ✅ 48 passed                                      |
| `cd frontend && npm run typecheck`                                                                                                                                                                      | ✅ 0 errors                                       |
| `cd frontend && npm run lint`                                                                                                                                                                           | ✅ 0 errors/warnings                              |
| `npx vitest run src/modules/reports src/pages/AnalyticsDashboardPage.test.tsx src/pages/Dashboard.test.tsx src/components/labels/LabelPrintPage.test.tsx src/components/labels/barcodeGeometry.test.ts` | ✅ 236 passed (13 files)                          |

Next in rotation: Feature 30 (Onboarding — `api/v1/onboarding.py`, 26 unauth
bootstrap routes).
