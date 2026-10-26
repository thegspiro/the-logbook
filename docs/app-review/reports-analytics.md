# Application Review — Reports & Analytics (Tier B)

**Prefix:** `RPT2` · **Iteration:** B16 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-20 (pass 5)

**Backend:** `endpoints/reports.py` (7), `analytics.py` (3), `platform_analytics.py`
(1), `services/reports_service.py` (1,952 L)
**Frontend:** `modules/reports`
**Prior audit:** `docs/module-audit/reports-analytics.md` (iteration 16) — RPT-1
(HIGH cross-org leak) and RPT-2 (500 on bad filter) fixed; RPT-3 (PII at
`reports.view`), RPT-4 (org-id typing), RPT-5 (aggregate correctness) left open.

---

## Pass 5 (2026-10-20) — one member could take the analytics dashboard down for the whole organization (2 fixed, 1 flagged)

Lens for this pass: the update-payload discipline of B4–B15 driven through the real
handlers, then — because the null probe came back clean — the other direction: what a
client-supplied value does when it is _read back_. The module has one update route
(`PATCH /reports/saved/{id}`) and three analytics routes; the 2,439-line report service
and the schedule helper were scanned for dead names and read at the saved-report paths.

**Saved-report `PATCH` (clean).** A real change saves and answers 200 (a rename; a schedule
switched on and then off, which sets and clears `next_run_date`), and `null` for every field
of `SavedReportUpdate` behaves: the two NOT NULL columns (`name`, `is_scheduled`) answer 400
and keep their value, and the nullable ones are accepted. The handler commits and refreshes
before it responds, so the GF2-1 shape (a flushed row returned with an expired `updated_at`)
is not present. No code change; the nine cases are kept as a regression file.

### RPT2-1 — MEDIUM — a non-string `error_reason` in one stored event broke `/analytics/metrics` for everyone — ✅ FIXED

`POST /analytics/track` is open to any authenticated member and stores a client-supplied
`metadata` dict. `GET /analytics/metrics` builds its failure breakdown by using
`metadata["error_reason"]` (or `["reason"]`) as a dictionary key. A dict or list is
unhashable, so the line raised `TypeError`; the bad row is stored, so **every later
`/metrics` call for the organization answered 500** — for every holder of `analytics.view`,
on every event filter, until someone deleted the row by hand. Reproduced over HTTP: a
`check_in_failure` event with `{"error_reason": {"a": 1}}` (and again with a list), then
`GET /analytics/metrics` → 500. A very long string was not an error but was echoed into the
response as a key, up to 500 times.

**Fixed** with `_failure_reason(metadata)`: the reason is used only if it is a non-empty
string, is cut to 100 characters, and is otherwise counted as `unknown`. Strings behave as
before (`error_reason`, then `reason`).

### RPT2-2 — LOW/MED — `/analytics/track` stored metadata of any size — ✅ FIXED

The request body limit is 60 MB (`MAX_REQUEST_BODY_SIZE`), and the route had no bound of its
own, so one member could store a row that size, repeatedly, and `/analytics/export` returns up
to 1,000 rows including their metadata. **Fixed** with a validator on `AnalyticsEventCreate`
that answers 422 for metadata over 4,096 bytes serialized; the client posts a handful of short
keys (device, timestamp, an error type and message). There is still no per-caller rate limit
on the route: one is not added because members check in from a shared station network, where a
per-IP limit would drop legitimate events silently (the client discards failures), and a
per-user one is a design call. Noted, not built.

Tests: `tests/test_analytics_endpoints_integration.py` (8) and
`tests/test_saved_report_update_endpoints_integration.py` (9). With the endpoint change
stashed, 4 of the 8 analytics cases fail (dict, list, long reason, oversized metadata); the
other 13 pass either way. 0 of the 17 are selected under the unit job's marker expression.

### RPT2-3 — MEDIUM — nothing in the application writes an analytics event, so the dashboard reads zeros — ✅ FIXED 2026-10-25

Owner chose option 1, recorded server-side (`app/services/qr_check_in_analytics.py`): the
self-check-in page's first load records one `qr_scan` per member per event, and
`POST /events/{id}/self-check-in` records `check_in_success`, or `check_in_failure` with one
of four fixed reasons. Manual officer check-ins are not counted. Original finding below.

`/analytics/metrics` and `/analytics/export` read the `analytics_events` table, and the
`AnalyticsDashboardPage` (per-event at `/events/:id/analytics`, and the admin route) renders
them. The only writer in the repository is `POST /analytics/track`, whose only client is
`analyticsService.trackEvent`, which is reached through `trackQRScan`, `trackCheckInSuccess`,
`trackCheckInFailure`, `trackQRView` and `trackQRPrint` — **and none of those five is called
by any page or component** (searched `frontend/src` excluding tests). The server never
creates an `AnalyticsEvent` itself either: `self_check_in` and `check_in_attendee` do not
write one. So on an installation where nobody has called the API by hand, the screen reports
zero scans, zero check-ins and an empty error breakdown, which is indistinguishable from a
department that simply has not used QR check-in.

This is the CLAUDE.md #19 shape in reverse: a reader with no writer. Mirrored to
`docs/KNOWN_LIMITATIONS.md` (RPT2-3) with the options (emit server-side from the check-in
handlers, wire the five client calls, or retire the page), and a correction is added under
the existing accepted entry _"Events — There Is No Per-Event Analytics Panel"_, which says
the per-event QR check-in analytics "cover the need" on the assumption that they are fed.
Not fixed here: which events to count, and where, is a metric definition.

### Observation, not changed

A failed check-in whose metadata is empty or missing is skipped by the breakdown rather than
counted as `unknown`, and the sample is the latest 500 failures, so the breakdown need not sum
to `failed_check_ins`. Harmless today, since no failure events exist (RPT2-3).

### Verified good ✅ (this pass)

- **Nothing unreferenced.** The AST scan (counting `tests/`, `scripts/`, `alembic/`) over the
  three endpoint files, the report and schedule services, the model and the schema found no
  unused name or method, and no `noqa` / `TODO`.
- **Gating.** `reports.manage` on saved-report create / update / delete, `reports.view` on
  list / run / generate, the PII gate (`_enforce_report_pii_permission`) on save, update, run
  and generate; `analytics.view` on metrics and export; `settings.manage` on platform
  analytics. `/track` is open to any member by design.
- **Org scoping.** Every by-id read of a saved report filters `organization_id`; every
  analytics query filters it, including the time-to-check-in self-join.

### Not read (scope, stated plainly)

The report generators inside `reports_service.py` (the roster, training, attendance, compliance
and department-overview builders) were left to their dedicated suites, which pass; the
scheduled-delivery task was covered by `test_saved_report_delivery.py`; `platform_analytics.py`
was read for its gate only; the `modules/reports` frontend was not read.

### Completion gate (pass 5)

| Check                                                           | Result                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/`                                            | ✅ exit 0, no output                                               |
| `black --check app/ tests/`                                     | ✅ 1857 files unchanged                                            |
| `isort --check` (changed files)                                 | ✅                                                                 |
| `mypy app/api/v1/endpoints/analytics.py`                        | ✅ no issues                                                       |
| Related backend suites (14 files incl. the org-scoping ratchet) | ✅ 180 passed                                                      |
| New files                                                       | ✅ 17 pass; 4 fail without the fix; 0 under the unit job's markers |
| `check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings                                            |
| Frontend                                                        | n/a — no frontend change                                           |

---

## Pass 4 (2026-08-09) — invariants re-verified; RPT-7 reconfirmed defensive-only

Re-verified: RPT-1 (cross-org aggregate leak) and RPT-2 (`_safe_int` filter
guards) hold; RPT-3 PII gate (`_enforce_report_pii_permission`) intact on
`/generate` and `/saved/{id}/run`; `SavedReport` has no enum columns (latent-500
lens N/A); both files E712-free.

**RPT-7 re-examined and deliberately left flagged.** The candidate was adding the
`except ValueError → 400` wrapper to `/generate` and `/run`. Traced both paths:
`generate_report` returns a dict and the endpoint already maps `"error"` → 400
(reports.py 106); dates/filters are Pydantic-validated (422, not a handler
`ValueError`); the generators return `{"error": …}` rather than raising. So there
is **no `ValueError` path today** — the wrapper would be dead code, which
CLAUDE.md's anti-speculation guidance argues against. It stays a
defensive-consistency item for a future robustness sweep (best paired with a
generator that actually raises), not a rotation-tick addition.

**Still flagged (unchanged):** RPT-6 (completion % can exceed 100% in the
shared-requirement double-enrollment case — the numerator fix risks skewing the
common case), RPT-5c (inventory float→Decimal, with FIN-7).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

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

| Check                     | Result                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `flake8` (service + test) | ✅ 0 violations                                                                                                   |
| `black --check`           | ✅ formatted                                                                                                      |
| `tsc --noEmit`            | ✅ n/a — no frontend change                                                                                       |
| backend tests             | ✅ `test_reports_service` **11 passed** (+1 new `TestTrainingSummaryCompletionRate`). No DB needed for this file. |
