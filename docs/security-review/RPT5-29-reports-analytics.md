# Security Review — Feature 29: Reports & Analytics (pass 5)

**Prefix:** `RPT5` · **Iteration:** rotation pass 5 · **Reviewed:** 2026-09-06 ·
**PR:** #2344 (this round extends the already-open pass-4 PR rather than
opening a new one — see "Scope and provenance" below)

**Backend:** `api/v1/endpoints/reports.py` (7 routes), `analytics.py` (3),
`platform_analytics.py` (1), `dashboard.py` (7), `labels.py` (12); services
`reports_service.py` (2,240 L), `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`; `schemas/reports.py`; `training_compliance.py`
(read for comparison, not owned by this feature).
**Frontend:** `modules/reports`, `utils/apiCache.ts` (re-verified, unchanged)
**Migrations:** none touching this feature's tables this pass.

---

## Scope and provenance

**This round is a full end-to-end re-read of `reports_service.py`,
`dashboard.py`, `attendance_dashboard_service.py` and `label_service.py`/
`label_printer_service.py`**, the exact scope pass 4
(`RPT4-29-reports-analytics.md`) explicitly named as _not_ re-read
("`reports_service.py` (1800+ lines), `dashboard.py` and `label_service.py`
outside the delta"). Pass 4 was a deliberate delta-only pass; this round
supplies the whole-file read pass 4 deferred, one round later, the same way
pass 3's round 2 supplied what pass 3's round 1 missed.

**Why this is a round on PR #2344, not a new PR:** PR #2344
("security(reports-analytics): pass 4 — 0 new findings, 8 verified good")
was already open against `main` when this review started. The rotation's own
rule is one PR per feature at a time; a second, independent PR for the same
feature would fork the "Open PR" row in `PROGRESS.md` and the rotation table
into two disagreeing states. This round's commits extend the same branch
(`claude/security-review-reports-analytics-pass4`) instead.

**Re-verified, not re-derived:** every item pass 3
(`RPT-29-reports-analytics-pass3.md`) and pass 4 already closed or flagged.
None regressed. One item pass 3 fixed —
`AttendanceDashboardService.list_waivers` missing an org filter on its two
`User` lookups — is **not** re-litigated here: it was independently fixed by
a different feature's rotation pass
(`6d784018`, "security(meetings-minutes): pass 3 review, MM-14 cross-org
name-leak surface fixed" — `attendance_dashboard_service.py` is reached from
`meetings.py` and is in that feature's blast radius too). Confirmed present
and correct at `attendance_dashboard_service.py:309-320` before writing this
doc, so as not to double-claim a fix this pass did not make.

## Findings

### RPT5-29-1 — MEDIUM — `compliance_status` and `training_summary`'s requirement breakdown re-derive training compliance independently of the canonical evaluator — 🚩 FLAGGED (Pitfall #29 shape)

**What:** `reports_service._generate_compliance_status` (the `compliance_status`
report, gated behind `training.manage` via `PII_REPORT_PERMISSIONS`) computes
each member's compliance percentage by checking whether a `RequirementProgress`
row exists with status `COMPLETED`/`VERIFIED`, reached only through a
`ProgramEnrollment` in an **active or completed** program enrollment
(`reports_service.py:1128-1240`, unchanged since pass 2).
`_generate_training_summary`'s `requirement_breakdown` section does the same
for its own numerator/denominator (`reports_service.py:343-422` — already the
subject of the still-open RPT-6 double-enrollment finding, which is about a
bug _within_ this same mechanism, not the mechanism itself). Neither goes
through `app/services/training_compliance.py`'s `compute_org_compliance_pct` /
`_evaluate_member_compliance` — the shared evaluator `/dashboard/admin-summary`
(`training_completion_pct`) and the training compliance-matrix endpoint both
use, which additionally applies compliance-profile-scoped requirement lists
(`_find_matching_profile`/`required_requirement_ids`), per-profile threshold
overrides, waivers (`fetch_org_waivers`), and per-requirement date windows
(rolling periods, custom annual windows, `include_current_month`).

**Where:** `reports_service.py:1128-1240` (`compliance_status`),
`reports_service.py:343-422` (`training_summary`'s `requirement_breakdown`),
vs. `training_compliance.py:647-820` (`compute_org_compliance_pct`).

**Failure scenario:** an organization that tracks its annual training
requirements the way `training_compliance.py` expects — completing
`TrainingRecord`s directly, with no formal `ProgramEnrollment` in a structured
training _program_ — has every member showing `compliance_percentage: 0` (or
sharply understated) on the "Compliance Status" report, while the same org's
`/dashboard/admin-summary` reports a normal-to-high `training_completion_pct`
for the identical date and the training compliance-matrix screen shows those
same members compliant. This is the exact shape CLAUDE.md Pitfall #29
describes: two screens computing the same-sounding number from different
rules, disagreeing, with nothing raising or failing a test — visible only by a
chief opening both screens side by side. Confirmed this report type is live,
not dead code: `frontend/src/modules/reports/pages/ReportsPage.tsx` renders it
(`ComplianceStatusRenderer`) and exports it to CSV
(`getComplianceStatusExportData`).

**Impact:** correctness/trust, not a cross-tenant leak or authorization
bypass — both code paths are independently org-scoped and permission-gated
correctly. The risk is a chief making a real staffing/certification decision
off a report that disagrees with the dashboard for the same organization on
the same day.

**Fix:** not applied. Reconciling the two would mean either rewriting
`_generate_compliance_status` to call the shared evaluator (which currently
returns only an org-wide percentage, not the per-member breakdown this report
displays — a non-trivial return-shape refactor of `training_compliance.py`)
or documenting that `compliance_status`/`training_summary`'s
`requirement_breakdown` measure a distinct concept ("program-enrollment
requirement completion" vs. "org-wide annual compliance") and labeling them
accordingly. Either is a product/architecture decision beyond a security-
review drive-by fix, per CLAUDE.md Pitfall #29's own guidance ("where a rule
must exist on both sides of the wire, extract it so there is one definition").
Mirrored in `docs/KNOWN_LIMITATIONS.md` (RPT5-29-1).

### RPT5-29-2 — LOW — `PATCH /reports/saved/{id}` used a bare `setattr` loop, so an explicit `null` on the `name` column would 500 instead of 400 — ✅ FIXED

**What:** `update_saved_report` built `update_data =
request.model_dump(exclude_unset=True)` and applied it with `for key, value in
update_data.items(): setattr(report, key, value)` — the anti-pattern CLAUDE.md
Pitfall #1 names, minus the _silent-drop_ half (there was no `if value is not
None` guard, so it did not drop explicit nulls) but also without the NOT-NULL
guard `apply_updates` provides.

**Where:** `app/api/v1/endpoints/reports.py:243-245` (pre-fix).

**Failure scenario:** `SavedReportUpdate.name` is `Optional[str]` (so a client
_can_ send `"name": null`), but `SavedReport.name` is `nullable=False`
(`models/analytics.py:65`). A caller sending an explicit `name: null` reached
`setattr(report, "name", None)` then `await db.commit()`, raising an uncaught
`IntegrityError` — a generic 500 instead of the 400 every other mutation on
this feature returns for a rejected value, and unlike this feature's sibling
`label_printer_service.update_printer`, which already uses `apply_updates` for
exactly this reason.

**Impact:** availability/robustness (an unhandled 500, with the real
`IntegrityError` visible only in server logs), not a data-integrity or
tenant-isolation issue — no other field in `SavedReportUpdate` maps to a
NOT NULL column, so `name` was the only field this could happen to.

**Fix:** replaced the loop with `apply_updates(report, update_data,
skip={"organization_id", "id"})`, wrapped in the same
`except ValueError: raise HTTPException(400, ...)` pattern already used
elsewhere in this file for service-layer validation errors. 3 guard tests
added.

## Schema & migration notes

No model or migration changes this pass. Re-confirmed: the one
`ondelete="SET NULL"` FK on `SavedReport` (`created_by`) and on `LabelPrinter`
(`created_by_id`) are both `nullable=True`. Alembic chain: 431 migrations,
single head (`d7c1b95e2a40`), `validate_migrations.py --strict` passes.

## Guard tests added

- `tests/test_reports_saved_caps_and_analytics_input.py::TestSavedReportUpdateExplicitNull`
  (3 tests): an explicit `null` on the NOT NULL `name` column raises `400` and
  leaves the row unmodified (`db.commit` never awaited); a partial update
  (only `description` sent) leaves `name` untouched; an explicit `null` on the
  nullable `description` column actually clears it. Uses a real (unattached,
  uncommitted) `SavedReport` ORM instance rather than a `SimpleNamespace`,
  because `apply_updates`'s NOT-NULL detection reads the SQLAlchemy mapper,
  which a plain mock has none of.

No guard test was added for RPT5-29-1: it is flagged, not fixed, and the
architectural question (which evaluator a report should consume) has no
single mechanical assertion that would not itself encode the product
decision this doc declines to make.

## Completion gate

| Check                                                                                      | Result                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                              | ✅ 0 violations                                    |
| `black --check app/ tests/ alembic/`                                                       | ✅ 1,506 files unchanged                           |
| `isort --check-only app/ tests/ alembic/` (pinned `isort==9.0.1`, matching CI)             | ✅ clean                                           |
| `python3 scripts/validate_migrations.py --strict`                                          | ✅ passed, single head                             |
| `pytest tests/ -q -k "reports or label or analytics or attendance_dashboard or dashboard"` | ✅ **517 passed, 1 skipped** (0 failed)            |
| `pytest tests/test_reports_saved_caps_and_analytics_input.py -q` (modified file)           | ✅ **15 passed**                                   |
| `tsc --noEmit` (frontend)                                                                  | ✅ 0 errors                                        |
| `eslint .` (frontend)                                                                      | ✅ 0 errors (no frontend files changed this round) |

---

## Pass 6 (2026-09-13) — findings-history fragmentation resolved; two lint/hygiene fixes

**Prefix:** `RPT5` (continued) · **Rotation pass:** 6 · **PR:** #2517

### Fragmentation note

This feature's findings history is split across four files with no single
linear numbering: `RPT-29-reports-analytics-pass3.md` (pass 3, PR #2091,
2026-08-31), `RPT2-29-reports-analytics.md` (pass 2, PR #1912, 2026-08-27 —
chronologically _before_ the "pass3"-named file despite the plain `RPT2`
prefix sorting after `RPT`), `RPT4-29-reports-analytics.md` (pass 4,
2026-09-06, delta-only), and this file, `RPT5-29-reports-analytics.md` (pass
5, 2026-09-06, PR #2344, extending pass 4's same PR/branch — a full
end-to-end re-read of the four large files pass 4 explicitly deferred).
Cross-checked against `PROGRESS.md`'s own running log (search terms
"Reports"/"RPT"), which confirms this ordering and that PR #2344 (covering
both pass 4 and pass 5's commits) merged 2026-09-06 21:58:57Z as `cf18d329`.
`RPT5-29-reports-analytics.md` is therefore the chronologically latest
findings file, and this pass continues it as "Pass 6" with `RPT5-29-3`
continuing its own id sequence (skipping no numbers: RPT5-29-1 and
RPT5-29-2 were the two findings pass 5 opened).

No commit has touched any of this feature's ten files since PR #2344 merged
(`git log --oneline -- <the ten files>` shows only one intervening commit,
`f8fdd1a`, which is an unrelated squash-merge boundary in this repo's history
that reintroduces the whole tree rather than a targeted edit — confirmed by
its diff touching essentially every file in the repository, not a
reports/analytics-specific change). So this pass re-verifies a codebase
byte-identical to what pass 5 last reviewed, plus does its own full,
independent read rather than trusting that byte-identity implies nothing was
missed.

### Re-verified, unchanged

Every item closed or flagged by module-audit iteration 16, the four
app-review passes, and security-review passes 2 through 5 was re-checked
against current source (not re-derived from the docs) and holds exactly as
last recorded:

- All 30 routes re-enumerated from source; every one carries a recognized
  auth dependency (table in pass 4, unchanged).
- `platform_analytics.py`'s all 16 aggregate queries independently re-read
  line by line this pass — every one filters
  `<model>.organization_id == current_user.organization_id` (or its
  `org_id` alias). Gated on `settings.manage`, which is an ordinary
  per-org permission here, not a platform-wide superadmin role — the
  endpoint's name is misleading (module-audit's original observation) but
  it cannot leak one org's data to another org's admin, confirmed again by
  reading every query rather than sampling.
- `reports_service.py`'s 15 report generators re-checked for org-scoping by
  bounding each function to its next `def` and confirming every DB query
  either filters `organization_id` directly or resolves through an
  already-org-scoped parent id list (e.g. `_generate_event_attendance`'s
  RSVP aggregate keyed off `event_ids` drawn from an org-filtered `Event`
  query; `_generate_apparatus_status`'s maintenance-count query keyed off
  `apparatus_ids` from an org-filtered `Apparatus` query). `PII_REPORT_
PERMISSIONS` (RPT-3/pass-3-round-2) still covers all eight PII-bearing
  report types.
- `SavedReportUpdate`'s explicit-`null` path (RPT5-29-2's `apply_updates`
  fix) still in place at `reports.py:243-248`.
- Labels/label-printer transport hardening (port allowlist, blocked address
  classes, operator network allowlist, resolve-then-connect-to-IP-literal)
  re-read in `printer_transport.py` and unchanged; `_filter_ids`'s
  prospect-self-access normalization still wired into all three label paths
  (preview, generate, print).
- `apiCache.ts`: `/dashboard/action-items` (pass 3) and `/analytics/export`
  (raw per-user analytics events) both still present in
  `UNCACHEABLE_PREFIXES`.
- Frontend CSV export (`modules/reports/utils/export.ts`) still routes every
  cell through `escapeCsvCell`; no backend CSV export exists in this feature
  (`analytics.py`'s `/export` returns JSON) — `SafeCsvWriter` is therefore
  n/a here, confirmed again by grep (zero `csv.writer`/`csv.DictWriter`
  across all ten files).
- Zero `.like`/`.ilike` calls across all ten files (n/a, unchanged).
- Migrations: 444 revisions now (was 431 at pass 5 — unrelated features'
  migrations landed in between), single head, `validate_migrations.py
--strict` passes. `SavedReport.created_by` and `LabelPrinter.created_by_id`
  (`ondelete="SET NULL"`) both still `nullable=True`.

### RPT5-29-3 — LOW (hygiene) — `dashboard.py`/`attendance_dashboard_service.py` had 6 real `# noqa: E712` suppressions the pass-2 sweep missed, plus a stray leftover marker — ✅ FIXED

**What:** Pass 2 (`RPT2-1`) swept `== True`/`== False` boolean comparisons to
`.is_(True)`/`.is_(False)` in `reports.py` and `platform_analytics.py` "both
files are now E712-free" — but never touched `dashboard.py` or
`attendance_dashboard_service.py`, which carry the identical pattern and were
already part of this feature's file list at the time. CLAUDE.md Pitfall #10
is explicit that a `# noqa` suppression is not a fix and applies to every
flake8 violation, not only the enumerated codes — E712 is exactly the kind of
"suppress instead of fix" the pitfall exists to catch, and having already
fixed the identical pattern in two sibling files in this same feature makes
the remaining six a clear oversight rather than a deliberate choice.

**Where:** `dashboard.py:941,1022,1307,1316,1333,1350` (`Event.is_cancelled ==
False`, `EventRSVP.checked_in == True`, `EventExternalAttendee.checked_in ==
True`, each with a `# noqa: E712`) and
`attendance_dashboard_service.py:93` (`MemberLeaveOfAbsence.active == True`,
same marker). A seventh spot, `dashboard.py:763`, carried a stray `# noqa:
E712` left over on the closing paren of a query whose comparison had already
been fixed to `.is_(False)` at some earlier point — dead marker, not masking
anything, but confusing to a future reader who might assume the query still
needs it.

**Impact:** none behaviorally — `==` against a SQLAlchemy boolean column
produces the same SQL as `.is_()` (both compile to `= 1`/`= 0` /
`IS TRUE`/`IS FALSE` depending on dialect), so no query result was ever wrong.
This is a lint-hygiene and consistency finding, not a correctness or security
bug, but it is a real, present flake8 violation being silently suppressed
rather than fixed, and app-wide precedent already established the fix.

**Fix:** replaced all six with `.is_(True)`/`.is_(False)` and removed the six
`# noqa: E712` markers, plus the one stray marker. `flake8` on both files is
now clean with no suppression.

### RPT5-29-4 — Informational (hygiene) — Dead `reportExportService` deleted — ✅ FIXED

Pass 3 found `modules/reports/services/api.ts`'s `reportExportService.
exportReport()` posts to a `/reports/export` route that has never existed in
`reports.py`, with zero callers anywhere in the frontend, and flagged it for
"whoever next touches this file to delete rather than fixing here." Re-
confirmed zero callers repo-wide (`grep -rn "reportExportService" frontend/
src/` — the only other hit is an unrelated, actually-used export of the same
name in `services/trainingServices.ts`, a different module) and deleted the
dead block. Not exploitable as it stood (a call would have 404'd), so this is
cleanup rather than a vulnerability fix.

### Findings this pass

Two fixed (RPT5-29-3, RPT5-29-4), both hygiene-class, both low-risk and
mechanical. No new correctness, tenant-isolation, or data-exposure findings —
the org-scoping, PII-gating, and injection sweeps above all re-confirmed
clean. RPT5-29-1 (compliance-metric re-derivation, Pitfall #29 shape) remains
flagged, unchanged, per its own architectural-decision reasoning; no new
information this pass. `RPT2-29-2` (saved-report scheduling has no reader),
`LBL-29-2` (`GET /label-printers` authentication-only), `LBL-29-4` (no PDF
label-count cap), `DASH-2` (`GET /dashboard/stats` has no frontend caller),
and `RPT-5c`/`RPT-6` (inventory float, hardcoded `last_inspection_date`,
double-enrollment completion-% overcounting) are all re-confirmed unchanged,
same reasoning as every prior pass — not re-litigated here.

### Guard tests

None added. Both fixes are mechanical (a lint-clean rewrite with no behavior
change, and a dead-code deletion) with no new invariant to protect — matching
pass 2's precedent for the identical E712 pattern, which also added no test.

### Completion gate

| Check                                                                                      | Result                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                              | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                                                       | ✅ unchanged                                                 |
| `isort --check-only app/ tests/ alembic/` (`isort==9.0.1`, matches CI pin)                 | ✅ clean                                                     |
| `python3 scripts/validate_migrations.py --strict`                                          | ✅ passed, single head (444 revisions)                       |
| `pytest tests/ -q -k "reports or label or analytics or dashboard or attendance_dashboard"` | ✅ **545 passed, 1 skipped** (0 failed)                      |
| `pytest tests/` (full backend suite)                                                       | ✅ **12,490 passed, 21 skipped** (Docker/pywebpush env-only) |
| `npm run typecheck` (frontend)                                                             | ✅ 0 errors                                                  |
| `npm run lint` (frontend)                                                                  | ✅ 0 errors, 0 warnings                                      |
| `npx vitest run src/modules/reports` (scoped)                                              | ✅ **42 passed** (5 files)                                   |
