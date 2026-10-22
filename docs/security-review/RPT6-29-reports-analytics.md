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
