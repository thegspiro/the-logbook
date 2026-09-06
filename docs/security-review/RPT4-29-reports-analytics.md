# Security Review — Feature 29: Reports & Analytics (pass 4)

**Prefix:** `RPT4` · **Iteration:** rotation pass 4 · **Reviewed:** 2026-09-06 ·
**PR:** #<pending>

**Backend:** `api/v1/endpoints/reports.py` (7 routes), `analytics.py` (3),
`platform_analytics.py` (1), `dashboard.py` (7), `labels.py` (12); services
`reports_service.py`, `dashboard_widget_service.py`,
`attendance_dashboard_service.py`, `label_service.py`,
`label_printer_service.py`; `schemas/reports.py`
**Frontend:** `modules/reports`, `utils/apiCache.ts`
**Migrations:** none touching this feature's tables since pass 3

---

## Scope

**This pass is delta-focused, and that is a deliberate choice rather than a
shortcut — but it does mean not every line below carries a fresh verdict.**

Prior coverage: module-audit iteration 16, four app-review passes, and
security-review passes 2 (PR #1912) and 3 (PR #2091, merged `b6c283a7`). Pass 3
read all ten files end to end.

What this pass did read in full:

- **The entire delta since pass 3** — `git diff b6c283a7..HEAD` over the ten
  files: 141 insertions, 21 deletions across 5 files. Every hunk read and
  worked against all seven checklist dimensions.
- **All 30 routes re-enumerated** from source (table below), not sampled — each
  one's auth dependency and permission string read off the decorator.
- **New surface not present at pass 3**: the `hidden_prospect_ids` dependency on
  the three label routes, and `app/api/prospect_privacy.py` in full.
- **Targeted whole-feature sweeps** for the dimensions where a regression is
  cheap to introduce: `.like`/`.ilike`, raw SQL, bare `csv.writer`, and the
  `UNCACHEABLE_PREFIXES` entries this feature owns.
- **Every report generator's output keys**, enumerated programmatically against
  `PII_REPORT_PERMISSIONS` (13 generators vs 8 gated — see below).

What this pass did **not** re-read end to end: the bodies of
`reports_service.py` (1800+ lines), `dashboard.py` and `label_service.py`
outside the delta. Pass 3 read those in full one commit-range ago and its
findings are re-cited rather than re-derived. A reader wanting a fresh
whole-file verdict on those should treat pass 3's as the current one.

## Route inventory

All 30 routes, unchanged in count and gate from pass 3. Every route carries an
auth dependency; none is public.

| File                    | Route                         | Gate                                                                     |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `reports.py`            | `GET /available`              | `require_permission("reports.view")`                                     |
| `reports.py`            | `POST /generate`              | `reports.view` + `_enforce_report_pii_permission`                        |
| `reports.py`            | `GET /saved`                  | `reports.view`                                                           |
| `reports.py`            | `POST /saved`                 | `reports.manage`                                                         |
| `reports.py`            | `PATCH /saved/{id}`           | `reports.manage`                                                         |
| `reports.py`            | `DELETE /saved/{id}`          | `reports.manage`                                                         |
| `reports.py`            | `POST /saved/{id}/run`        | `reports.view` + `_enforce_report_pii_permission`                        |
| `analytics.py`          | `POST /track`                 | `get_current_user`                                                       |
| `analytics.py`          | `GET /metrics`                | `analytics.view`                                                         |
| `analytics.py`          | `GET /export`                 | `analytics.view`                                                         |
| `platform_analytics.py` | `GET /`                       | `settings.manage`                                                        |
| `dashboard.py`          | `GET /asset-widgets`          | `get_current_active_user` + per-widget permission checks in body         |
| `dashboard.py`          | `GET /operations`             | `get_current_active_user` + `OPERATIONS_SECTION_PERMISSIONS` per section |
| `dashboard.py`          | `GET /widgets`                | `get_current_active_user` + per-card checks in body                      |
| `dashboard.py`          | `GET /stats`                  | `get_current_active_user`                                                |
| `dashboard.py`          | `GET /admin-summary`          | `settings.manage`                                                        |
| `dashboard.py`          | `GET /action-items`           | `get_current_active_user` + `meetings.view`/`minutes.view` per half      |
| `dashboard.py`          | `GET /community-engagement`   | `events.manage`                                                          |
| `labels.py`             | `POST /labels/preview`        | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |
| `labels.py`             | `GET /label-preset/{module}`  | `get_current_user` + `_authorize_module`                                 |
| `labels.py`             | `PUT /label-preset/{module}`  | `get_current_user` + `_authorize_module`                                 |
| `labels.py`             | `POST /labels/generate`       | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |
| `labels.py`             | `GET /label-printers`         | `get_current_user` only — LBL-29-2, deliberate, still org-scoped         |
| `labels.py`             | `POST /label-printers`        | `settings.manage` OR `organization.update_settings`                      |
| `labels.py`             | `PUT /label-printers/{id}`    | same                                                                     |
| `labels.py`             | `DELETE /label-printers/{id}` | same                                                                     |
| `labels.py`             | `POST /.../{id}/test`         | same                                                                     |
| `labels.py`             | `GET /.../{id}/status`        | same                                                                     |
| `labels.py`             | `POST /label-printers/probe`  | same                                                                     |
| `labels.py`             | `POST /labels/print`          | `get_current_user` + `_authorize_module` + `get_hidden_prospect_ids`     |

## Verified good ✅

Each claim names the mechanism, so the next pass can re-check it cheaply.

1. **The `equipment_check.manage` → `inventory.check_manage` swap does not widen
   the gate to the baseline.** `dashboard.py:491,655` now gate the operations
   `daily_ops` section and the failed-checks card on `inventory.check_manage`.
   Resolved `DEFAULT_POSITIONS` and `OPERATIONAL_RANKS` in a live interpreter:
   `member` holds `inventory.check_submit` and `inventory.view`; `firefighter`
   holds `inventory.view`. **Neither holds `check_manage`**, and neither holds
   the `inventory.*` wildcard that `permissions.py:334` notes would grant it —
   `inventory.view` is a discrete permission, not a wildcard. Pitfall #23 clear.

2. **The apparatus asset-widget gate was tightened, not loosened.**
   `dashboard.py:243-252` now requires `apparatus.view OR apparatus.manage`
   **and** `apparatus.manage OR settings.manage`. The added conjunct only
   removes a tile from a `settings.manage` holder who cannot open `/apparatus`.

3. **`call_type_labels` (new in both call-volume reports) cannot cross tenants.**
   `reports_service.py:1348,1440` call `CallTrackingService.type_labels(org_id)`
   → `get_settings` → `ShiftEligibilityService._get_org(org_id)`
   (`call_tracking_service.py:55-62`), which resolves the org by the id passed
   down from `current_user.organization_id`. Labels come from that org's own
   settings JSON.

4. **The label preset's `printer_id` still validates in-org, and the new UNSET
   semantics do not open a hole.** `labels.py:149-155` validates via
   `LabelPrinterService.get_printer(id, org)` whenever `printer_id is not None`.
   The three cases: absent → `UNSET` → prior value preserved (validated when it
   was stored); explicit `null` → clears, no FK to validate; explicit value →
   validated before storage. Pitfalls #1 and #14c both satisfied.

5. **Prospect self-access filtering reaches all three label paths.**
   `_filter_ids` (`label_service.py:53-66`) normalizes both sides through
   `normalize_prospect_id`, closing the re-cased / unhyphenated-UUID bypass. It
   is wired into `generate` (`label_service.py:351`), `preview` (`:375`) **and**
   `print` (`label_printer_service.py:368`) — the print path being the one that
   would matter most had it been missed.

6. **`PII_REPORT_PERMISSIONS` is complete for the current generator set.**
   13 generators (`reports_service.py:137-150`); 8 gated. Enumerated the output
   keys of the 5 ungated ones by bounding each function to its next `def`:
   `event_attendance` returns per-event counts and rates only;
   `department_overview` and `call_volume` return aggregates; the `"name"` key
   in `apparatus_status` is `a.unit_number or a.name` and in `inventory_status`
   is `item.name` — asset names, not member names. No member PII escapes the
   gate. _(An initial unbounded `awk` appeared to show a `member_name` key in
   `event_attendance`; that hit belonged to a later function and was wrong.)_

7. **Injection dimensions are n/a for this feature, still.** Zero `.like`/
   `.ilike` calls across the ten files; zero `csv.writer`/`csv.DictWriter`. The
   single `sa.text` (`analytics.py:159`) is the literal `"SECOND"` unit argument
   to `TIMESTAMPDIFF` — a constant, no interpolation.

8. **Pass 3's cache fix holds.** `/dashboard/action-items` is still in
   `UNCACHEABLE_PREFIXES` (`apiCache.ts:86`).

## Findings

**No new findings this pass.**

That claim is made with the previous pass's history in mind: pass 3 also opened
with "no new findings" and Codex's review then produced six real ones. So it is
worth being explicit about what would have caught those six here — the delta
review, the route re-enumeration, and the generator-vs-PII-gate enumeration are
the three sweeps that found five of pass 3's six. The sixth (per-element string
bounds on `extra_lines`) is a schema-bounds check; `ExtraLine`'s
`StringConstraints(max_length=100)` is present on both bodies at
`labels.py:82,269`, verified this pass.

## Still flagged, re-confirmed unchanged

Carried forward from passes 2 and 3, no new information, deliberately not
re-litigated:

- **RPT2-29-2 (MED/policy)** — `SavedReport` scheduling fields remain stored and
  API-writable with no scheduler reading them; `SavedReportResponse.enforced`
  is hardcoded `False`, which is the correct Pitfall #19 labelling rather than a
  silent claim of automation. Mirrored in `KNOWN_LIMITATIONS.md`.
- **LBL-29-2 (LOW/policy)** — `GET /label-printers` gated on authentication
  only, documented at `labels.py:304-307`, org-scoped.
- **LBL-29-4 (Info)** — the PDF label path still has no per-request count cap
  analogous to `print_labels`'s `MAX_LABELS_PER_JOB = 500`.
- **DASH-2 (LOW)** — `GET /dashboard/stats` still has no frontend caller.
- **RPT-5c / RPT-6 / RPT-7** — inventory `float()` (belongs with the FIN-7
  Decimal refactor), `apparatus_status.last_inspection_date` hardcoded `None`,
  `requirement_breakdown` completion able to exceed 100% in the shared-
  requirement double-enrollment case.
- **Dead frontend export service** — `reportExportService.exportReport()` posts
  to a `/reports/export` route that does not exist; zero callers. Not
  exploitable (404), still worth deleting.

## Completion gate

Run against the committed tree at `main` = `f7a9ad8d`, with the three linters at
CI's pinned versions (`flake8 7.3.0`, `black 26.5.1`, `isort 9.0.1` — verified,
not assumed, because a missing `isort` passes silently).

| Check                                                   | Result                                   |
| ------------------------------------------------------- | ---------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                          |
| `black --check app/ tests/ alembic/`                    | ✅ 1506 files unchanged                  |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                 |
| `python3 scripts/validate_migrations.py --strict`       | ✅ VALIDATION PASSED                     |
| `pytest -k "report or label or analytics or dashboard"` | ✅ **816 passed**, 1 skipped (pywebpush) |
| `npm run typecheck` (frontend)                          | ✅ 0 errors                              |
| `npx eslint .` (frontend)                               | ✅ 0 errors, 2 pre-existing warnings     |

No code changed this pass, so no guard test was added — there is no new
invariant to protect.
