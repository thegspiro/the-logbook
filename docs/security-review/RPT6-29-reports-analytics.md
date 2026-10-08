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
