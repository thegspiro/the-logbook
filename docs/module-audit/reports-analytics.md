# Module Audit — Reports & Analytics

**Files:** `app/api/v1/endpoints/reports.py` (244 L, 7 endpoints),
`app/api/v1/endpoints/analytics.py` (206 L, 3), `app/api/v1/endpoints/platform_analytics.py`
(337 L, 1), `app/services/reports_service.py` (1,947 L), frontend `modules/reports`.
**Audited:** iteration 16 (cross-org aggregate leakage — the #1 risk for a
reporting module — plus filter injection and PII exposure).

## Verified good ✅
- **Auth coverage:** all 11 endpoints authed (`reports.view`/`.manage`,
  `analytics.view`, platform-analytics on `settings.manage`).
- **`platform_analytics.py` is fully org-scoped** — despite the "platform-wide"
  naming, all 16 aggregate queries filter `organization_id == current org`
  (verified each).
- **Reports are org-scoped almost everywhere:** training-summary, event-attendance,
  apparatus-status, admin-hours, pipeline-overview, and the analytics self-join
  all anchor to the caller's org (directly or via an org-scoped `IN`/join). No
  report takes a client-supplied `user_id`/`member_id` for a cross-user drill-down.
- **No injection:** group-by/column selectors are never client-supplied; report
  types/statuses dispatch through fixed dicts / enum coercion; the one
  `sa.text("SECOND")` is a hardcoded `TIMESTAMPDIFF` unit. flake8 clean.
- The only export (`analytics export`) returns JSON (no CSV formula-injection
  surface).

## Findings

### RPT-1 — HIGH — Cross-org leak: `department_overview` counted minutes action items across all orgs — ✅ FIXED
`_generate_department_overview`'s `open_minutes_items` counted
`MinutesActionItem` (the meeting-minutes `ActionItem`) filtered **only by
status — no org**. That model has no `organization_id` of its own (it's scoped
via `minutes_id → meeting_minutes.organization_id`), so the count was a **global
total across every organization**, returned to any `reports.view` user running
the department-overview report. The sibling query right above it
(`open_meeting_items`) correctly filters org — so this was a clear oversight.
**Fix:** join `MeetingMinutes` and filter `MeetingMinutes.organization_id == org_id`.

### RPT-2 — LOW/MED — Unvalidated numeric report filters could 500 — ✅ FIXED
`_generate_annual_training` did `date(int(year), ...)` and
`certification_expiration` did `int(filters["expiring_soon_days"])` on
client-supplied `filters` (from `ReportRequest.filters`, unvalidated) — a
non-numeric value raised an uncaught `ValueError` → HTTP 500.
**Fix:** added a `_safe_int(value, default)` helper and used it for `year` and
`expiring_soon_days`, so an invalid filter falls back to the default instead of
crashing.

### RPT-3 — LOW/MED (flagged) — Member/applicant PII at `reports.view`
`member_roster` returns each member's `email` + `membership_number`;
`certification_expiration` returns `certification_number`/`issuing_agency`;
`pipeline_overview` returns prospective-member `email` + full name. All gate on
the relatively low `reports.view`. Org-scoped (not a leak), but if member/
applicant PII warrants a stronger grant, `reports.view` is too weak.
**Status:** flagged — permission-granularity policy decision.

### RPT-4 — LOW — Inconsistent org-id typing in `_generate_annual_training` — ✅ FIXED (app-review B16)
Compared `User.organization_id == organization_id` with the raw `UUID` object
while every other method passes `str(organization_id)` (the column is
`String(36)`). Worked today but dialect-fragile. **Fix (B16):** normalized both
comparisons to `str(organization_id)`. See `docs/app-review/reports-analytics.md`.

### RPT-5 — LOW — Aggregate correctness / polish — ⚠️ PARTLY FIXED (app-review B16)
**Fixed (B16):** `completion_rate` now divides by records attributed to a tracked
member (not `len(records)`, which included departed/exempt members and skewed the
rate low); `department_overview.total_checkins` now joins `Event` and filters the
report period (was all-time next to period-bounded events). 1 regression test
added. **Still flagged:** `_generate_inventory_status` sums `float(current_value)`
(FIN-7 refactor); `apparatus_status.last_inspection_date` hardcoded `None`
(incomplete feature — needs a maintenance-record lookup). See
`docs/app-review/reports-analytics.md`.

## Notes
- The "Platform Analytics" endpoint name is misleading — it's per-org usage
  analytics, correctly scoped to the caller's org, not a cross-tenant super-admin
  surface. No platform/super-admin cross-org endpoint exists in this module.
