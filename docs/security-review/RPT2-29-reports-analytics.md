# Security Review — Feature 29: Reports & Analytics

**PR:** #1912 (guessed — corrected if wrong)
**Files:** `backend/app/api/v1/endpoints/reports.py`, `analytics.py`,
`platform_analytics.py`, `dashboard.py`, `labels.py`; services
`reports_service.py`, `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`.

This feature spans two very different scopes:

- **Reports & analytics proper** (`reports.py`/`analytics.py`/
  `platform_analytics.py`/`reports_service.py`) has two prior review passes —
  `docs/module-audit/reports-analytics.md` and `docs/app-review/reports-analytics.md`
  (4 passes). This pass re-verifies those findings hold and reviews the
  ~13% of `reports_service.py` that's new since the last audit.
- **Dashboard** (`dashboard.py`, `dashboard_widget_service.py`,
  `attendance_dashboard_service.py`) and **labels**
  (`labels.py`, `label_service.py`, `label_printer_service.py`) have **never**
  been through module-audit or app-review — first-ever full reads.

Three parallel background agents covered these three sub-scopes independently.

## Part A — Reports & analytics: re-verification

RPT-1 through RPT-7 (see the two prior docs) were individually re-checked
against current code. **No regressions** — all hold exactly as last recorded.
The one new surface since the last audit, count-only call-volume tracking
(`_generate_call_volume_from_counts`, added 2026-08-18, `CHANGELOG.md`), is
correctly org-scoped and PII-free by design; no findings there.

### RPT2-29-1 — LOW/MED — `pipeline_overview`'s `stage_groups` filter crashes on malformed input — ✅ FIXED

`ReportRequest.filters` is unvalidated `Dict[str, Any]`. `_generate_pipeline_overview`
used `filters.get("stage_groups")` directly in place of the stored
`pipeline.report_stage_groups` with no shape validation — a client posting
`{"filters": {"stage_groups": ["x"]}}` hit an unhandled `AttributeError` on
`group.get(...)` for any non-dict entry (a generic 500, no info leak — same
severity class as RPT-2, which this codebase already treats as worth a guard).

**Fix:** added `_is_valid_stage_groups()` next to `_safe_int` — requires a
non-empty list of dicts, each with a string `name` and list `step_ids`;
anything else falls back to `pipeline.report_stage_groups`, matching
`_safe_int`'s "invalid filter is a no-op, not a 500" contract.

### RPT2-29-2 — MEDIUM — `SavedReport` scheduling is stored and API-writable, but nothing reads it — 🚩 FLAGGED (Pitfall #19), partial fix applied

`POST /reports/saved` / `PATCH /reports/saved/{id}` fully accept
`is_scheduled`, `schedule_frequency`, `schedule_day`, `email_recipients`.
`create_saved_report` never computes `next_run_date` (stays `None` forever),
`scheduled_tasks.py`'s `TASK_RUNNERS` registry has no entry for saved
reports, and no Celery beat/APScheduler config exists for this anywhere.
A chief can set `is_scheduled=True`, add recipients, see it listed as
scheduled — and no report is ever generated or emailed. Textbook CLAUDE.md
Pitfall #19 shape.

**Fix applied:** `SavedReportResponse.enforced` reports `False` (hardcoded —
there is no reader to derive per-row state from), so the frontend can label
a saved report as not-yet-automated instead of Active. Building the actual
`TASK_RUNNERS` reader (including re-deriving/enforcing the RPT-3 PII
permission gate at send time, since that gate currently lives only in the
endpoint layer) is a feature addition, not a security-review drive-by —
mirrored to `docs/KNOWN_LIMITATIONS.md` with both closure options.

### RPT2-29-3 — LOW — `avg_time_to_check_in` ignores the `event_id` filter every other `/metrics` field respects — ✅ FIXED

`GET /analytics/metrics?event_id=X` scopes every other returned figure
(`total_scans`, `successful_check_ins`, `device_breakdown`, …) via
`base_filter`, which includes `event_id` when supplied. The
`avg_time_to_check_in` query only filtered `organization_id` — when a caller
asked for one event's metrics, this one field silently reported the
org-wide average across all events instead. Same-org only (no cross-tenant
leak); an aggregate-correctness gap in the RPT-5a/5b family.

**Fix:** added `scan.event_id == event_id` to the query's `where` when
`event_id` is supplied.

### Unchanged (re-confirmed, not touched)

RPT-5c (inventory `float()`, `apparatus_status.last_inspection_date` hardcoded
`None`), RPT-6 (`requirement_breakdown` completion % can exceed 100% in the
shared-requirement double-enrollment case), RPT-7 (no `ValueError→400`
wrapper — confirmed still dead code, no generator raises `ValueError`) all
hold exactly as previously flagged. No action this pass.

## Part B — Dashboard (first-ever pass)

Clean module. Every aggregate/count query correctly org-scopes both sides of
any join — the RPT-1 cross-org-leak shape this audit specifically checked for
is consistently guarded here. No IDOR, no unbounded caches, no JSON-mutation
issues, no capacity/race conditions (no update endpoints exist in `dashboard.py`
at all — all seven routes are read-only).

### DASH-29-1 — LOW — `MeetingAttendee` attendance query missing defense-in-depth org filter — ✅ FIXED

`AttendanceDashboardService.get_dashboard()` filtered `MeetingAttendee` only
by `meeting_id.in_(meeting_ids)` (itself org-scoped via `meetings`), with no
`MeetingAttendee.organization_id == org_id` of its own. Not currently
exploitable — every write path independently validates org before writing —
but every comparable join elsewhere in this same feature (facility,
inventory, finance, minutes) double-filters both sides even when one side is
already implied safe. This was the one query that didn't.

**Fix:** added `MeetingAttendee.organization_id == org_id` to the query.

### DASH-29-2 — LOW — `grant_waiver` trusts its caller for org-scoping instead of self-enforcing — ✅ FIXED

The service method didn't itself validate that `meeting_id`/`user_id` belong
to `organization_id` before writing — safe today only because its one caller
(`POST /{meeting_id}/attendance-waiver`) re-fetches both scoped to the org
first. An implicit, unenforced contract: a future caller that skips that
check would create a cross-org `MeetingAttendee` row, directly feeding
DASH-29-1's trust boundary.

**Fix:** added `assert_in_org(db, Meeting, meeting_id, organization_id)` and
`assert_in_org(db, User, user_id, organization_id)` at the top of
`grant_waiver`, per pitfall 14c — the standard helper, not an ad-hoc check.

### DASH-29-3 — LOW — `total_external_attendees` doesn't filter to public event types, unlike its sibling metric — ✅ FIXED

In `get_community_engagement`, `total_member_attendees` correctly scopes to
`public_types` events, but the very next query, `total_external_attendees`,
counted every `EventExternalAttendee` row in the org with no event-type or
checked-in filter — inflating the "community engagement" figure with private
events' guests. `DashboardWidgetService.community()` (same audit scope) gets
this right. Same-org only, not a tenant leak — a correctness drift between
two implementations of the same metric.

**Fix:** scoped `total_external` the same way `total_member_attendees` (and
`DashboardWidgetService.community()`) already do: `checked_in == True` and
`event_id` in the public-events subquery.

## Part C — Labels / label-printing (first-ever pass)

Unusually well-hardened for a first pass — SSRF, ZPL/ESC-POS command
injection, and cross-tenant IDOR are all deliberately and correctly
addressed, with in-code comments citing the relevant CLAUDE.md pitfalls by
number. No critical/high findings; the items below are hardening gaps or
policy calls, not exploitable bugs as deployed. Verified in detail: printer
transport port-allowlists to 9100-9109/6101 only, blocks loopback/
link-local/the 169.254.169.254 metadata endpoint/reserved ranges, fails
**closed** on an empty `LABEL_PRINTER_ALLOWED_NETWORKS`, and connects to the
resolved IP literal (not the hostname) to prevent DNS-rebinding between
validation and connect; ZPL/ESC-POS renderers correctly escape every
caller-influenced field before embedding it in a print job.

### LBL-29-1 — LOW — No audit trail for generating/printing PII-bearing labels — ✅ FIXED

Printer _configuration_ changes are all audit-logged. Actually generating or
printing labels was not — for any module, including `prospective_members`
(whose label embeds the applicant's public status-check token) and
`membership` (membership number). Every other read of sensitive PII in this
app is audit-logged per CLAUDE.md; this was the one gap.

**Fix:** added `log_audit_event()` calls (`labels_generated`/`labels_printed`,
`event_category="data_access"`) in `generate_labels` and `print_labels`,
scoped to `_AUDITED_LABEL_MODULES = {"prospective_members", "membership"}`.

### LBL-29-2 — LOW — `GET /label-printers` requires no permission at all — 🚩 FLAGGED (deliberate design, permission-granularity policy)

Every sibling endpoint in `labels.py` requires at least a module or
`settings.manage` permission; `list_label_printers` requires only
`get_current_user`, reachable by any authenticated org member regardless of
role, returning each printer's LAN `host`/`port`/`location`. This is an
explicit, documented design choice in the code ("a printer's name and host
are not sensitive") — still org-scoped, not a cross-tenant leak. Flagging
because it's the one zero-permission-gate endpoint in the module, exposing
internal network topology to the broadest possible audience. A policy call
(gate on the union of `MODULE_LABELS` permissions, or leave as-is), not a
drive-by — left unchanged.

### LBL-29-3 — LOW — `extra_lines` had no length bound, unlike every other list/string field in these schemas — ✅ FIXED

`LabelGenerateBody`/`LabelPrintBody` bound every other field explicitly
(`ids` at 2000, strings at 20-255); `extra_lines` was the one unbounded list
(unbounded item count, unbounded item length), feeding a per-item render
loop for up to 2000 items. The only prior backstop was the global 60MB
request-body cap. Not an injection risk (verified: the renderer's
`"custom:"` free-text path is properly escaped before embedding) — just an
inconsistent-with-the-rest-of-the-schema sizing gap.

**Fix:** `Field(None, max_length=20)` on both `LabelGenerateBody.extra_lines`
and `LabelPrintBody.extra_lines`, capping the list length.

### LBL-29-4 — Informational — No per-request label-count cap on the PDF path, unlike the print path — 🚩 FLAGGED (product tradeoff)

`print_labels` explicitly caps at `MAX_LABELS_PER_JOB = 500` (documented
wire-payload-size rationale). `LabelService.generate()` (the PDF path) has no
analogous cap — bounded only by the schema's `ids` max of 2000. Applying the
same 500 cap to PDF generation would be a behavior change (e.g. printing a
600-person roster to PDF currently works) with no evidence it's needed —
reportlab rendering per label is small and bounded, so the DoS risk is low.
Left as a flagged asymmetry for a product decision, not fixed speculatively.

## Completion gate

- `black --check` / `isort --check-only` / `flake8` on all changed files —
  clean.
- `pytest tests/ -k "reports or analytics or dashboard or attendance or label"`
  — see PR for the count.
- Full backend suite — see PR for the count.
