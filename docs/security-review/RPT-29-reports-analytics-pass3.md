# Security Review — Feature 29: Reports & Analytics (pass 3)

**Prefix:** `RPT3` · **Rotation pass:** 3 (prior: module-audit iteration 16,
app-review B16/A7, security-review pass 2 — PR #1912)
**Files:** `backend/app/api/v1/endpoints/reports.py`, `analytics.py`,
`platform_analytics.py`, `dashboard.py`, `labels.py`; services
`reports_service.py`, `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`. Frontend `modules/reports` (routes, service,
export utilities).

## Scope and method

This is the security-review rotation's **third** pass over this feature (after
module-audit iteration 16, four app-review passes, and security-review pass 2
— `docs/security-review/RPT2-29-reports-analytics.md`, PR #1912, merged
2026-08-27). Per the rotation rule, prior findings were re-verified against
current code rather than re-derived; every closed finding below cites the line
that proves it still holds.

Diffed all ten files against the commit pass 2 merged as (`721a60e7`): the only
change since is one small commit, **"Improve direct label printer workflow"**
(`4dfbb9f8`, 2026-08-29, Codex), which added a `printer_id` field to the label
preset (`LabelPresetBody`/`LabelService.set_preset`). Read every endpoint and
service in full end to end (not just the diff) and re-enumerated every route's
auth/permission dependency, per the rotation's "enumerate, don't spot-check"
rule.

## Route enumeration (auth/permission coverage)

| File                  | Route                                 | Dependency                                                                                                  |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| reports.py            | `GET /reports/available`              | `require_permission("reports.view")`                                                                        |
| reports.py            | `POST /reports/generate`              | `require_permission("reports.view")` + `_enforce_report_pii_permission`                                     |
| reports.py            | `GET /reports/saved`                  | `require_permission("reports.view")`                                                                        |
| reports.py            | `POST /reports/saved`                 | `require_permission("reports.manage")`                                                                      |
| reports.py            | `PATCH /reports/saved/{id}`           | `require_permission("reports.manage")`                                                                      |
| reports.py            | `DELETE /reports/saved/{id}`          | `require_permission("reports.manage")`                                                                      |
| reports.py            | `POST /reports/saved/{id}/run`        | `require_permission("reports.view")` + `_enforce_report_pii_permission`                                     |
| analytics.py          | `POST /analytics/track`               | `get_current_user`                                                                                          |
| analytics.py          | `GET /analytics/metrics`              | `require_permission("analytics.view")`                                                                      |
| analytics.py          | `GET /analytics/export`               | `require_permission("analytics.view")`                                                                      |
| platform_analytics.py | `GET /platform-analytics`             | `require_permission("settings.manage")`                                                                     |
| dashboard.py          | `GET /dashboard/asset-widgets`        | `get_current_active_user` (+ per-module permission/enabled-module checks in-body)                           |
| dashboard.py          | `GET /dashboard/operations`           | `get_current_active_user` (+ per-section permission/enabled-module checks in-body)                          |
| dashboard.py          | `GET /dashboard/widgets`              | `get_current_active_user` (+ per-card permission/enabled-module checks in-body)                             |
| dashboard.py          | `GET /dashboard/stats`                | `get_current_active_user`                                                                                   |
| dashboard.py          | `GET /dashboard/admin-summary`        | `require_permission("settings.manage")`                                                                     |
| dashboard.py          | `GET /dashboard/action-items`         | `get_current_active_user` (+ in-code `meetings.view`/`minutes.view` split per half — DASH-3, app-review A7) |
| dashboard.py          | `GET /dashboard/community-engagement` | `require_permission("events.manage")`                                                                       |
| labels.py             | `POST /labels/preview`                | `get_current_user` + `_authorize_module`                                                                    |
| labels.py             | `GET /label-preset/{module}`          | `get_current_user` + `_authorize_module`                                                                    |
| labels.py             | `PUT /label-preset/{module}`          | `get_current_user` + `_authorize_module`                                                                    |
| labels.py             | `POST /labels/generate`               | `get_current_user` + `_authorize_module`                                                                    |
| labels.py             | `GET /label-printers`                 | `get_current_user` only — deliberate, see LBL-29-2 (unchanged)                                              |
| labels.py             | `POST /label-printers`                | `require_permission("settings.manage", "organization.update_settings")`                                     |
| labels.py             | `PUT /label-printers/{id}`            | same                                                                                                        |
| labels.py             | `DELETE /label-printers/{id}`         | same                                                                                                        |
| labels.py             | `POST /label-printers/{id}/test`      | same                                                                                                        |
| labels.py             | `GET /label-printers/{id}/status`     | same                                                                                                        |
| labels.py             | `POST /label-printers/probe`          | same                                                                                                        |
| labels.py             | `POST /labels/print`                  | `get_current_user` + `_authorize_module`                                                                    |

Every route carries a recognized auth dependency. No ungated route found. This
matches the SEC-00 baseline's route-auth sweep, which does not list any file in
this feature among the five features with intentionally-public routes.

## Re-verification of pass-2 fixes (all hold, no regressions)

- **RPT2-29-1** (`_is_valid_stage_groups` guard on `pipeline_overview`'s
  `stage_groups` filter, including the per-element `str` check Codex's round-1
  review added) — present at `reports_service.py:56-78`, called at line 1875.
- **RPT2-29-3** (`avg_time_to_check_in` respects `event_id`) — present at
  `analytics.py:137-141`.
- **DASH-29-1** (`MeetingAttendee.organization_id` defense-in-depth filter) —
  present at `attendance_dashboard_service.py:81`.
- **DASH-29-2** (`grant_waiver` self-validates via `assert_in_org`) — present
  at `attendance_dashboard_service.py:248-251`.
- **DASH-29-3** (`total_external_attendees` scoped to public event types,
  matching its sibling) — present at `dashboard.py:1288-1303`.
- **LBL-29-1** (audit trail on `generate_labels`/`print_labels` for
  `prospective_members`/`membership`, using the specs-actually-rendered count
  Codex's round-1 review corrected) — present at `labels.py:193-204,
526-541`; `LabelService.generate()` still returns `(pdf, auto_populated,
len(specs))` at `label_service.py:309-336`.
- **LBL-29-3** (`extra_lines` bounded to `max_length=20`) — present on both
  `LabelGenerateBody` and `LabelPrintBody` at `labels.py:82, 269`.
- **DASH-3** (app-review A7; `action-items` gates each half independently
  behind `meetings.view`/`minutes.view` rather than relying on the outer
  `get_current_active_user`) — present at `dashboard.py:1164-1167`.
- **RPT-1/RPT-4/RPT-5a/RPT-5b** (module-audit/app-review; department-overview
  org scoping, `str(organization_id)` typing, completion-rate denominator,
  period-bounded check-ins) — all hold, unchanged code.

## Still flagged, re-confirmed unchanged (no new information, not re-applied)

- **RPT2-29-2 / RPT-3 (MEDIUM/policy)** — `SavedReport` scheduling
  (`is_scheduled`, `schedule_frequency`, `email_recipients`) remains stored
  and API-writable with no reader: `grep -rn "SavedReport"` finds no
  `TASK_RUNNERS` entry or scheduler anywhere in `backend/app/`.
  `SavedReportResponse.enforced` still hardcodes `False`
  (`schemas/reports.py:95`). Textbook Pitfall #19 shape, still correctly
  labeled rather than silently claiming automation. Building the scheduler is
  a feature addition, not a security-review drive-by — left as-is, mirrored in
  `docs/KNOWN_LIMITATIONS.md`.
- **LBL-29-2 (LOW/policy)** — `GET /label-printers` still has no permission
  gate beyond authentication, a deliberate documented design choice
  (`labels.py:304-307`), still org-scoped. Unchanged.
- **LBL-29-4 (Informational)** — the PDF label path (`LabelService.generate`)
  still has no per-request count cap analogous to `print_labels`'s
  `MAX_LABELS_PER_JOB = 500`. Unchanged, still a flagged asymmetry rather than
  an exploitable issue.
- **RPT-3 / RPT2-3 (LOW/MED, permission-granularity policy)** — `member_roster`
  and `pipeline_overview` remain gated by their source-record permission
  (`PII_REPORT_PERMISSIONS`, `reports.py:37-53`) rather than a report-specific
  PII tier; `certification_expiration` still returns
  `certification_number`/`issuing_agency` at plain `reports.view`. Unchanged
  policy call, recorded in `docs/KNOWN_LIMITATIONS.md`.
- **RPT-5c / RPT-6 / RPT-7** — inventory `float()` (belongs with the
  codebase-wide FIN-7 Decimal refactor), `apparatus_status.last_inspection_date`
  hardcoded `None`, `requirement_breakdown` completion % can exceed 100% in the
  shared-requirement double-enrollment case, and no generator raises
  `ValueError` (so the `/generate`/`/run` wrapper would be dead code) — all
  re-confirmed unchanged, same reasoning as pass 2 and the app-review passes
  that first flagged them.
- **DASH-2 (LOW, app-review A7)** — `GET /dashboard/stats` /
  `dashboardService.getStats()` is still dead: `grep -rn
"dashboardService.getStats"` across `frontend/src/` finds zero call sites.
  Low sensitivity (aggregate member/event counts only), not a vulnerability —
  a delete-or-implement product call, unchanged since 2026-08-08.

## New surface reviewed this pass

**`4dfbb9f8` — `printer_id` on the label preset.** `LabelPresetBody.printer_id`
is a client-supplied FK. The endpoint validates it against the caller's org
_before_ it reaches `LabelService.set_preset` (`labels.py:140-146`, calling
`LabelPrinterService(db).get_printer(data.printer_id,
current_user.organization_id)`, which raises `ValueError` → 400 on a
cross-org or nonexistent id via its own org filter,
`label_printer_service.py:160-168`). This is the correct pattern per Pitfall
14c (`assert_in_org`-equivalent validation of a client-supplied FK before
storage). **Verified good — no finding.**

## Additional checks this pass (dimensions not fully re-derived in pass 2's writeup)

- **LIKE/ILIKE:** no `.like()`/`.ilike()` call anywhere in the ten files
  (`grep` returned zero matches). N/A for this feature — matches the SEC-00
  baseline's finding that this class lives entirely in other modules.
- **CSV/export injection:** the backend has no CSV export in this feature
  (`analytics.py`'s `/export` returns JSON). The frontend's client-side CSV
  generator (`modules/reports/utils/export.ts`) routes every cell through
  `escapeCsvCell` (`frontend/src/utils/csv.ts`), which neutralizes
  `=`/`+`/`-`/`@`/leading-tab/leading-CR triggers — the same class
  `SafeCsvWriter` closes server-side. **Verified good.**
  - Noted in passing, not a security finding: `modules/reports/services/api.ts`
    exports a `reportExportService.exportReport()` that calls `POST
/reports/export` — no such backend route exists (confirmed by grep against
    `reports.py`/`api.py`). It has zero callers anywhere in the frontend
    (`grep -rn "reportExportService" frontend/src/modules/reports` finds only
    its own definition). Dead code, not exploitable (a call would 404), and
    out of scope for a security fix — flagging for whoever next touches this
    file to delete rather than fixing here.
- **Data exposure — `platform_analytics.py`'s error-log projection:** the
  `top_error_types` aggregate selects only `ErrorLog.error_type` (a short
  enum-like string) and a count — never `error_message` or `context`, which
  can carry stack traces or request data. Deliberate narrow projection.
  **Verified good.**
- **Schema/migration integrity:** `SavedReport.organization_id` is
  `ondelete="CASCADE"` (not `SET NULL`), n/a for the nullable check.
  `LabelPrinter.created_by_id` is the one `ondelete="SET NULL"` FK in this
  feature's models and is `nullable=True` (`label_printer.py:81`). Migration
  chain: 394 revisions, single head, `validate_migrations.py --strict` passes.

## Findings

No new findings. Every checklist dimension was worked (see table above); all
prior findings across all three review layers (module-audit, app-review,
security-review pass 2) re-verified as fixed-and-holding or
correctly-still-flagged. No code changes this pass.

## Completion gate

| Check                                                                         | Result                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------- |
| `flake8` (10 feature files)                                                   | ✅ 0 violations                              |
| `black --check` (10 feature files)                                            | ✅ unchanged                                 |
| `isort --check-only` (10 feature files)                                       | ✅ clean                                     |
| `python3 scripts/validate_migrations.py --strict`                             | ✅ 394 revisions, single head `f6a7b8c9d0e1` |
| `pytest tests/ -k "reports or analytics or dashboard or attendance or label"` | ✅ **486 passed, 1 skipped** (0 failed)      |
| `tsc --noEmit` / `eslint .`                                                   | n/a — no frontend file changed this pass     |

No code changed this pass, so the full-repo `flake8`/`black`/`isort` gate and
frontend `tsc`/`eslint` were not re-run repo-wide (nothing to regress); the
scoped checks above cover everything read this pass.
