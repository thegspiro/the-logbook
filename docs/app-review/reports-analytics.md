# Application Review — Reports & Analytics (Tier B)

**Prefix:** `RPT2` · **Iteration:** B16 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/reports.py` (7), `analytics.py` (3), `platform_analytics.py`
(1), `services/reports_service.py` (1,952 L)
**Frontend:** `modules/reports`
**Prior audit:** `docs/module-audit/reports-analytics.md` (iteration 16) — RPT-1
(HIGH cross-org leak) and RPT-2 (500 on bad filter) fixed; RPT-3 (PII at
`reports.view`), RPT-4 (org-id typing), RPT-5 (aggregate correctness) left open.

---

## Pass 3 (2026-08-09) — RPT-3 confirmed resolved; 4 E712 swept

Re-verified the module: RPT-1 (cross-org aggregate leak) and RPT-2 (`_safe_int`
filter guards) hold; **RPT-3 confirmed RESOLVED** — the PII-report gate landed
earlier this session via the owner read-permission decision
(`PII_REPORT_PERMISSIONS` + `_enforce_report_pii_permission` on `/generate` and
`/saved/{id}/run`, `/available` filters the catalog). Update-bypass stays clean
(`SavedReportUpdate` exposes no org/`created_by`/`report_type`).

**Latent-500 lens clean:** `SavedReport` (the analytics model) has **no** enum
columns — `report_type`/`schedule_frequency` are `String`, so no free-string→ENUM
path; the report generators return `{"error": …}` handled explicitly at the endpoint.

### RPT2-1 — NIT — 4 boolean-column E712 swept — ✅ FIXED

`reports.py` (`SavedReport.is_active`) and `platform_analytics.py`
(`Event.is_cancelled` ×2, `EventRSVP.checked_in`) carried `== True/False  # noqa: E712`
comparisons; converted to `.is_(...)`. Both files are now E712-free.

### Still flagged (unchanged)

- **RPT-6** — `requirement_breakdown` completion % can exceed 100% in the
  shared-requirement + double-enrollment case; the numerator fix risks skewing the
  common-case metric, so it stays flagged rather than auto-applied.
- **RPT-7** — `/generate` and `/run` lack the `except ValueError→400` wrapper; no
  generator raises `ValueError` deterministically today (they return `{"error"}`), so
  it's a defensive-consistency item for a robustness sweep, not a live fault.
- **RPT-5c** — inventory float→Decimal (with FIN-7), other polish.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · report/analytics tests **108 passed** (DB-free; the
`db_session` errors are unrelated files matched by the `-k` substring).

---

## Pass 2 (2026-08-08) — six-lens sweep — no code change

Re-verified all four pass-1 fixes hold: RPT-1 (every query in
`platform_analytics.py`/`analytics.py` filters `organization_id ==
current_user.organization_id`; platform analytics is per-org, not global; no raw
SQL beyond a literal `timestampdiff` unit), RPT-4 (`str()`-consistent org compare),
RPT-5a (completion divides by `counted_records`), RPT-5b (`total_checkins`
period-bounded). The six-lens sweep confirmed the module is **clean of any
cross-tenant leak, IDOR, update-bypass, or cross-org write** — the dominant risk in
a reporting module:

- **Read-leak lens (the big one):** every by-id / `IN (...)` read resolves through
  an org-scoped anchor — event-attendance aggregates use org-scoped `event_ids`,
  apparatus maintenance uses org-scoped `apparatus_ids`, admin-hours/user/category
  joins hang off org-filtered entries, pipeline steps/progress hang off org-scoped
  pipeline/prospect ids, and a client-supplied `pipeline_id` is itself org-filtered.
  No client-supplied member/category id is read without an org anchor.
- **Update-bypass:** `SavedReportUpdate` exposes no org/`created_by`/`report_type`
  field, so the mass `setattr` on the org-scoped fetch can't reassign tenancy.
- **`*_name`:** all have fallbacks (member→username, course→id, type/station→
  "unknown"); none are unpopulated.

### Flagged (no drive-by fix)

- **RPT-3 — ✅ RESOLVED (owner decision, 2026-08-09)** — `member_roster` returns
  email + membership_number and `pipeline_overview` returns applicant name/email/PII,
  so a `reports.view` holder without `members.view`/`prospective_members.view` could
  read PII they couldn't fetch directly. `reports.py` now maps those two report types
  to their source-record read permission (`PII_REPORT_PERMISSIONS`) and enforces it
  in `/generate` and `/saved/{id}/run` via `_enforce_report_pii_permission` (403 if
  missing); `/available` hides PII reports the caller can't run. Aggregate reports
  stay at `reports.view`. Covered by `tests/test_read_permission_gates.py`.
- **RPT-6 (new, LOW) — `requirement_breakdown` completion % can exceed 100%.** The
  numerator counts `RequirementProgress` rows while the denominator counts
  `distinct(ProgramEnrollment.user_id)`; with no unique `(user_id, program_id)`
  enrollment constraint, a member double-enrolled in two programs that share a
  requirement contributes 2 to the numerator but 1 to the denominator. The
  mechanical fix (`count(distinct(user_id))` in the numerator) only matters in that
  shared-requirement + double-enrollment case; **flagged rather than auto-applied**
  because changing a multi-join aggregate's numerator risks skewing the common-case
  metric and the misfire is a cosmetic >100% display, not an integrity bug.
- **RPT-7 (new, LOW) — `POST /generate` and `/run` lack the `except ValueError→400`
  wrapper.** No generator raises `ValueError` deterministically today, so there's no
  single-line mechanical fix; the endpoints should adopt the standard try/except
  pattern in a robustness sweep. Also noted: `department_overview.total_checkins`
  counts check-ins on cancelled events (the paired `total_events` filters
  `is_cancelled`) — a defensible metric choice, left as-is.

**No code changed.** The reporting surface is tenant-safe; the verifications and the
three recorded flags are the deliverable.

---

## Scope

Tier B: the open findings. The #1 risk for a reporting module — cross-org
aggregate leakage — was already closed (RPT-1) and re-confirmed, along with the
"platform analytics is actually per-org" finding and the no-injection posture.
This pass fixed the typing and correctness items and re-flagged the PII policy
call.

## Findings

### RPT-4 — LOW — Inconsistent org-id typing in `_generate_annual_training` — ✅ FIXED

Two comparisons used the raw `UUID` object (`User.organization_id ==
organization_id`, same for `TrainingRecord`) while every other method compares
against `str(organization_id)` — the column is `String(36)`. It works today
because `str(uuid)` equals the stored form, but it's dialect-fragile. **Fix:**
normalized both to `str(organization_id)`.

### RPT-5a — LOW — `completion_rate` skewed low (numerator/denominator mismatch) — ✅ FIXED

`_generate_training_summary` computed `completion_rate = completed_count /
len(records)`, but `completed_count` only counts records belonging to a **tracked**
(active, non-exempt, non-deleted) member — while `len(records)` includes records
for departed/exempt members. So the rate was diluted by records the numerator
could never count. **Fix:** count `counted_records` (records attributed to a
tracked member) and divide by that, aligning numerator and denominator.
**1 regression test added** proving an untracked member's record no longer inflates
the denominator (1 completed / 2 tracked = 50%, not 1/3 = 33%).

### RPT-5b — LOW — `department_overview.total_checkins` counted all-time — ✅ FIXED

Every other metric in the department-overview report is period-bounded
(`total_events` filters `Event.start_datetime` to the period), but `total_checkins`
counted every checked-in RSVP for the org **all-time**, with no period filter — so
a period report showed a lifetime check-in number next to period-scoped events.
**Fix:** join `EventRSVP → Event` and apply the same period bounds, so check-ins are
counted over events in the report period.

### RPT-3 — LOW/MED — Member/applicant PII at `reports.view` — 🚩 FLAGGED (permission-granularity policy)

`member_roster` (email + membership_number), `certification_expiration`
(certification_number/issuing_agency), and `pipeline_overview` (applicant email +
full name) all gate on the relatively low `reports.view`. Org-scoped, so not a
leak — but if member/applicant PII warrants a stronger grant, `reports.view` is
too weak. A permission-granularity decision (a `reports.view.pii` sub-grant, or
redaction for plain `reports.view`), not a drive-by. Recorded in
`KNOWN_LIMITATIONS.md`.

### RPT-5c — LOW — Remaining polish — 🚩 FLAGGED

`_generate_inventory_status` sums `float(current_value)` (belongs with the
codebase-wide FIN-7 float→Decimal refactor); `apparatus_status.last_inspection_date`
is hardcoded `None` (needs a maintenance-record lookup to populate — an
incomplete-feature gap, not a correctness bug). Unchanged.

## Cleanup applied

Swept all **14** `== True`/`== False  # noqa: E712` suppressions in
`reports_service.py` to `.is_(True)`/`.is_(False)` (including one inside a
`case()` expression) — the AP-2 pattern, honoring Pitfall #10.

## Verified good ✅ (re-confirmed)

- RPT-1 (`department_overview` open-minutes-items joins `MeetingMinutes` for the
  org filter) and RPT-2 (`_safe_int` guards `year`/`expiring_soon_days`) hold.
- `platform_analytics.py` fully org-scoped despite the name; all 11 endpoints
  authed; no client-supplied group-by/column selectors; the only export is JSON
  (no CSV-injection surface).

## Documentation

`docs/module-audit/reports-analytics.md` updated: RPT-4/RPT-5a/RPT-5b resolved;
RPT-3 and the RPT-5 polish items stand.

## Future development

1. **RPT-3** — a PII-tier permission or redaction for plain `reports.view`.
2. **RPT-5c** — inventory float→Decimal (with FIN-7); populate
   `apparatus_status.last_inspection_date` from maintenance records.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_reports_service` **11 passed** (+1 new `TestTrainingSummaryCompletionRate`). No DB needed for this file. |
