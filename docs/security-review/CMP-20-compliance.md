# Security Review — Compliance

**Prefix:** `CMP` · **Iteration:** 20 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-30 (pass 2), 2026-09-05 (pass 3) · **PR:** #1902 (pass 1, merged),
[#2059](https://github.com/thegspiro/the-logbook/pull/2059) (pass 2, merged),
pass 3 (this PR)

## Pass 3 (2026-09-05)

Diff-scoped against pass 2's merge commit (`4931fbb54cb85fa30f0108cbe16f659ed47a6155`,
PR #2059) rather than re-reading the whole surface. All four declared backend
files (`compliance_config.py`, `compliance_officer.py`,
`compliance_config_service.py`, `compliance_officer_service.py`) and all three
declared frontend files (`ComplianceOfficerDashboard.tsx`, the
compliance-related exports of `trainingServices.ts`, and their test files) are
**byte-identical** to pass 2's merge. `training_compliance.py` (CMP2-3's own
fix site) is also unchanged.

**One file did change: `ComplianceRequirementsConfigPage.tsx` (+19/-3),
already fixed correctly, not by this rotation.** The diff adds an explicit
"Not yet active" notice under the Grace Period (days) field
(`grace_period_days`), plus a matching backend guard test
(`backend/tests/test_compliance_grace_period_is_unwired.py`, new). This is the
exact CLAUDE.md Pitfall #19 shape CMP2-1 already flagged for the two
notification settings on the same page — `grace_period_days` is stored
(`compliance_configs.grace_period_days`) and read by nothing in the backend,
unlike its sibling fields on the same screen. The fix was made outside this
rotation (git blame: not part of any `security-review-compliance*` branch) and
does exactly what Pitfall #19 prescribes: labels the field as not yet in
effect rather than silently shipping a dead setting, with a guard test that
fails in either direction (a reader appearing, or the notice being removed
while the gap remains). Re-verified both halves hold: `grep`/AST-walked
`grace_period_days` outside `schemas/`/`models/` — zero reader sites; the
notice text is present in the component. No finding — this is a correctly
applied instance of an already-established pattern, not a new gap.

**Re-verified, all still hold, no code change needed:**

- CMP-1 through CMP-7 (pass 1) — `apply_updates`/`exclude_unset` on both
  update endpoints (`compliance_config.py:69,162`), still routed correctly.
- CMP2-2/CMP2-3/CMP2-4/CMP2-2-A/CMP2-B (pass 2) — the frontend clear-to-null
  fix, the `required_requirement_ids is not None` / threshold-override fix in
  `compute_org_compliance_pct` (`training_compliance.py:752,764-767`, exact
  code shown above still present), the `loadConfig` null-fallback fix, and the
  behavioral (not source-scanning) guard test are all unchanged.
- CMP2-1 (notification settings unwired) — still open by design, still
  correctly labeled "Not yet active" in the UI. No reader has appeared;
  re-confirmed via the same `grep -rn "notify_days_before_deadline\|notify_non_compliant_members" backend/app`
  sweep pass 2 used — hits only in `schemas/`/`models/`, same as before.
- CS-8 (attestation dual-control) / CS-9 (monthly-report windowing) — still
  open by design; the file is unchanged so there is nothing new to
  re-verify beyond confirming that.
- Route inventory — `compliance_config.py` (12 routes) +
  `compliance_officer.py` (8 routes) = 20/20, unchanged from pass 1/2's
  count; all still gated by `require_permission(...)`.
- `scheduled_tasks.py`'s only compliance touch-point
  (`ComplianceReportService` for `auto_report_frequency`/
  `report_email_recipients`) is unchanged — the file grew substantially this
  cycle but entirely in unrelated scheduled-task logic (feature 31's scope,
  not this feature's).

**No new findings, no code changes this pass.**

## Pass 1 (2026-08-26)

**Backend:** `app/api/v1/endpoints/compliance_officer.py` (283 L),
`app/api/v1/endpoints/compliance_config.py` (288 L),
`app/services/compliance_officer_service.py` (1,290 L),
`app/services/compliance_config_service.py` (538 L),
`app/services/training_compliance.py` (771 L),
`app/models/compliance_config.py` (337 L), `app/schemas/compliance_config.py` (248 L)
**Frontend:** compliance/officer admin screens; not reviewed this pass — backend
only, per rotation scope
**Migrations:** none touched this iteration

---

## Scope

Read in full via three parallel background agents: (A) `compliance_officer.py`

- `compliance_officer_service.py`, (B) `training_compliance.py`, (C)
  `compliance_config.py` + `compliance_config_service.py` + the model + schema.

This module already carries the deepest prior coverage of any feature in this
rotation so far: `docs/module-audit/compliance-skills.md` (iteration 22, one
of three parallel readers) plus **four** `docs/app-review/compliance-skills.md`
passes (2026-08-06 through 2026-08-09), the last of which did an exhaustive
client-FK re-audit. Both were read in full first. This pass explicitly does
not re-derive CS-1 through CS-7, CS-10, CS-11, or CS2-1 — all confirmed FIXED
and re-verified spot-intact by the background agents — and starts from the
two items those passes left **open by design**, plus whatever grew in the
~140 combined lines added since 2026-08-09 that no prior pass ever saw.

## Verified good ✅ (re-confirmed, not re-derived)

- **CS-1** — non-officer confined to own skills tests (feature 19's territory,
  confirmed still intact, out of scope here).
- **CS-3 / XC-1** — `_validate_profile_fks` still validates every
  client-supplied FK (`required/optional_requirement_ids`, `role_ids`,
  `admin_hours_requirements[].category_id`) in-org before persisting, on both
  `create_profile` (`compliance_config_service.py:132`) and `update_profile`
  (`:158`).
- **CS-6** — `_email_report` still `html.escape()`s org name, report_type, and
  period_label before interpolating into the report email
  (`compliance_config_service.py:371-373`).
- **CS-7** — the threshold-order `model_validator` still rejects
  `at_risk_threshold > compliant_threshold` on both the create and update
  schemas.
- **CS-9 recipient audit** — every email-report send path (`generate_report`,
  `email_existing_report`) still routes through `audit_external_recipients`,
  auditing any non-org-member recipient rather than restricting them.
- **CS-8 skills half** — `assert_different_person` still blocks
  examiner == candidate on `create_test`/`validate_test` (feature 19's
  territory).
- **No cross-tenant IDOR** — every by-id read/update/delete in all three
  files is org-scoped (direct filter or an org-scoped parent join); no
  compliance-officer endpoint accepts a target member id at all — reads are
  org-wide aggregates, not per-member lookups by id.
- **No SQL injection** — no raw/f-string SQL anywhere in the module; the only
  substring matching (`certification_record_matches` in
  `training_compliance.py`) is plain Python `in` on in-memory strings, not a
  LIKE query.
- **`training_compliance.py` is genuinely read-only** — confirmed via a full
  grep for `db.add`/`db.commit`/`setattr` across the file: none present. No
  write-path risk class applies to it at all.

## Findings

### CMP-1 — MED — `create_or_update_config`'s update path silently dropped explicit nulls — ✅ FIXED

**What:** the endpoint called `data.model_dump(exclude_none=True)` before
handing the payload to the service, which then applied it with
`for key, value in data.items(): if hasattr(config, key): setattr(...)`.
`exclude_none=True` strips an explicit JSON `null` from the payload before it
ever reaches the service — so there was no way to clear a nullable
`ComplianceConfig` field (`report_email_recipients`, `report_day_of_month`,
`notify_days_before_deadline`) via `PUT /config` at all; every save either
left the field untouched or overwrote it with another non-null value.
**Where:** `app/api/v1/endpoints/compliance_config.py:66`,
`app/services/compliance_config_service.py:63-66` (was).
**Fix:** endpoint now uses `exclude_unset=True` (omitted key = untouched,
explicit null = clear it, per CLAUDE.md Pitfall #1's update-path rule); the
service's update branch now routes through `apply_updates(config, data)`,
which additionally rejects an explicit null against a NOT NULL column with a
clean `ValueError` instead of a flush-time `IntegrityError`.

### CMP-2 — MED — `update_profile` had the identical bug, on a field with no other way to reset — ✅ FIXED

**What:** same `exclude_none=True` + blind-`setattr`-with-`value is not None`
pattern on `update_profile`. `ComplianceProfile.compliant_threshold_override`
and `at_risk_threshold_override` are documented as _"null = use org
default"_ — a caller who wanted to reset a profile back to the org default
had no way to do it: `PUT /config/profiles/{id}` could never send a value
that actually cleared the override, only another number that replaced it.
**Where:** `app/api/v1/endpoints/compliance_config.py:156`,
`app/services/compliance_config_service.py:159-161` (was).
**Fix:** same two-part fix as CMP-1 (`exclude_unset=True` at the endpoint,
`apply_updates(profile, data, skip={"config_id", "id"})` in the service).
Guard tests confirm `name` (NOT NULL) still rejects a null and
`compliant_threshold_override` (nullable) now actually clears.

### CMP-3 — LOW — first-write race on `ComplianceConfig` surfaced as a raw 500 — ✅ FIXED

**What:** `create_or_update_config`'s insert branch does a plain
read-then-insert with no row lock: `config = await self.get_config(...)` then
`if config is None: self.db.add(ComplianceConfig(...))`. Two concurrent
first-time saves for the same org (`PUT /config` and/or
`POST /config/initialize`, which both route through this method) can both
observe `config is None` and both attempt an insert.
`ComplianceConfig.organization_id` is `unique=True`, so the loser's insert
fails closed — no duplicate row, no data corruption — but the raw
`IntegrityError` was unhandled and surfaced as a generic 500 rather than a
clean 400 (`handle_service_errors` only special-cases `ValueError`).
**Where:** `app/services/compliance_config_service.py:53-61` (was).
**Fix:** wrapped the insert's `flush()` in `try/except IntegrityError`,
rolling back and raising `ValueError("Compliance configuration already
exists for this organization")` — the endpoint's existing `ValueError` → 400
handling covers the rest.

### CMP-4 — MED — `get_incomplete_records` silently invisible past 500 completed records — ✅ FIXED

**What:** fetched only the 500 most-recently-completed `TrainingRecord`s
(`.order_by(completion_date.desc()).limit(500)`), then filtered for missing
fields in Python and stopped once `limit` (default 50, caller-capped at 200)
incomplete ones were found. For any organization with more than 500
completed training records, incomplete records **older** than the 500 most
recent were permanently invisible to this tool — with no signal to the
caller that the scan didn't cover the full dataset. This is a
compliance-officer-facing "what's missing" report; a silent, undocumented
truncation on exactly that tool defeats its purpose for any department with
enough history.
**Where:** `app/services/compliance_officer_service.py:564-610` (was).
**Failure scenario:** a department with 3 years of training records has an
incomplete record from 18 months ago (missing instructor). Every call to
`GET /incomplete-records` scans only the newest 500 rows, which are all
recent and complete — the old gap is never surfaced, and nothing about the
response indicates the scan was partial.
**Fix:** the missing-field predicate (`instructor` empty, `location` **and**
`location_id` both empty, `hours_completed` empty/≤0, `course_name` empty) is
now evaluated in SQL, and `.limit(limit)` applies to the actual incomplete
rows rather than to an arbitrary pre-filter window — every incomplete record
in the org is now reachable (in `completion_date` descending order, capped
only by the caller's own `limit` param), not just those inside a fixed
recent-records scan. Response shape is unchanged.

**Revised after Codex review:** the first version of this fix's SQL location
clause checked only `location IS NULL`, but the Python fallback logic
(`not r.location`) also treats `location=""` as missing — an input the
training schemas allow. A completed record with `location=""` and no
`location_id` was silently excluded from the SQL scan by the initial fix,
the opposite of what the endpoint exists to surface. Corrected to
`location IS NULL OR location = ''` (alongside `location_id IS NULL`),
matching the Python check exactly. Guard test:
`test_empty_string_location_is_included_in_the_sql_predicate` compiles the
statement with literal binds and asserts both branches are present.

### CMP-5 — LOW — `report_type`'s accepted set drifted between schema, model comment, and prior audit docs — ✅ FIXED

**What:** the service's runtime check accepts `"monthly"`, `"annual"`, **and
`"yearly"`** — added after the 2026-08-09 audit (which documented "monthly/
annual only") for a scheduled auto-report task
(`scheduled_tasks.py:4176-4184`) that calls `ComplianceReportService.generate_report`
directly with `report_type="yearly"`, bypassing the Pydantic schema
entirely. But `ComplianceReportGenerate.report_type` (the HTTP-facing schema)
was still a bare `str`, so the real 3-value constraint existed only inside
the service's own `if report_type not in (...)` check — a 422 from the
schema layer never happened, and the `ComplianceReport.report_type` column
comment still said `"monthly or yearly"` (missing `"annual"` entirely, the
value nearly every request-path report actually uses).
**Where:** `app/schemas/compliance_config.py:207-210` (was),
`app/models/compliance_config.py:274` (was).
**Impact:** none functionally — "yearly" and "annual" behave identically
everywhere they're consumed (verified: `generate_report`'s
`period_label`/monthly-annotation branch only special-cases `"monthly"`) —
but the schema no longer documented or enforced the real constraint, and the
model comment actively contradicted it.
**Fix:** `ComplianceReportGenerate.report_type` is now
`Literal["monthly", "annual", "yearly"]`, giving a clean 422 for an unknown
value at the HTTP boundary instead of relying solely on the service's
`ValueError` → 400. The service's own check is **kept** (not redundant — it's
the only guard on the scheduled-task call path, which never goes through the
schema). Model comment and schema description corrected to name all three
values.

### CMP-6 — NIT — dict-key type-drift fragility reintroduced in code added after the CS-9 fix — ✅ FIXED

**What:** `ISOReadinessService.get_iso_readiness` carries an explicit,
commented fix (`compliance_officer_service.py:269-273`, CS-9/officer #6) for
exactly this pattern: normalize a queried id to `str()` before using it as a
dict key, because nothing guarantees a `String(36)` column always comes back
as a Python `str` across every load path. The newer `ContributedHoursService`
and `AnnualComplianceReportService._get_admin_hours_summary` (added after the
2026-08-09 audit — see the "genuinely new surface" note below) reintroduced
the un-normalized version of the same pattern: `member_ids = [m.id for m in
members]`, `training_by_user[uid] = ...`, `admin_by_user[uid] = ...`, and
`user_mins[uid] = ...` all used the raw queried id as a dict key with no
`str()` wrapper.
**Where:** `app/services/compliance_officer_service.py` — `get_contributed_hours`
(was `:642,672,695,735-736`), `_get_admin_hours_summary` (was `:1131`).
**Impact:** not a live bug today — every id involved is a `String(36)`
column, so SQLAlchemy always returns a plain `str` in practice — but it is
the identical latent-fragility shape CS-9 was written to close, reintroduced
in code that postdates the fix. Left uncorrected, a future refactor that
changed any one load path to hand back a `UUID` object would silently drop
that member's contributed-hours or admin-hours totals from the report, the
same way CS-9's bug did for ISO readiness.
**Fix:** wrapped every id at both the write side (dict assignment) and read
side (dict lookup) in `str(...)`, matching the ISO readiness precedent
exactly. Guard test constructs a member whose `.id` is a real `uuid.UUID`
object (not a string) and asserts training/admin hours still match — this
would have failed before the fix and does not depend on the DB layer's
actual return type.

### CMP-7 — NIT — `create_attestation`'s percentage bound was schema-only — ✅ FIXED

**What:** `compliance_percentage` is range-bounded at
`AttestationCreate.compliance_percentage: Field(ge=0, le=100)` — the one
current HTTP call site — but `ComplianceAttestationService.create_attestation`
itself only checked `if compliance_pct is None`, with no range check of its
own. Every other field this method validates (`period_type`, `period_year`,
`period_quarter`) is checked at the service layer, not left to the caller's
schema.
**Where:** `app/services/compliance_officer_service.py:406-408` (was).
**Impact:** latent only — there is exactly one call site today, which does
go through the bounding schema — but the service method itself was not safe
to call directly with an unbounded value, unlike its sibling checks in the
same function.
**Fix:** added `if not 0 <= compliance_pct <= 100: raise ValueError(...)`,
consistent with the function's existing validation style. Guard tests cover
both out-of-range rejection and the 0/100 boundary being accepted.

## Confirmed still open — flagged, not fixed (product/workflow decisions)

- **CS-8 attestation dual-control / server-side recompute** — re-confirmed
  via direct inspection of `create_attestation`'s exact signature and the
  fields it persists: an attestation record carries exactly **one** party id
  (`attested_by`) and no "subject" field at all — it's an officer's own claim
  about the _organization's_ aggregate compliance for a period, not a record
  about another person. This is why `assert_different_person` (the pattern
  that closed CS-10/FIN-4/AH-4/TR-5) genuinely does not apply here without
  first adding a second-approver field and a review workflow — confirmed
  across two independent lines of reasoning (this pass's agent, and the
  identical conclusion in the 2026-08-08/09 app-review passes). Still needs a
  product decision on which of "server-side recompute" or "second approver"
  the department wants; already tracked in `docs/KNOWN_LIMITATIONS.md`.
- **CS-9 monthly windowing** — monthly reports still return the annual
  dataset relabeled; a real monthly view needs `generate_annual_report`
  to accept a month window (data-layer feature). Untouched, out of scope for
  this pass.
- **`records_with_certification` mislabel** — confirmed still present at its
  documented location, deliberately left as ambiguous-intent per the prior
  audit; not re-flagging as new.

## Design observations raised for owner awareness (not bugs — likely intentional)

Surfaced by this pass's read of the genuinely new `ContributedHoursService` /
admin-hours-in-annual-report code (added after the 2026-08-09 audit, which
never saw it). Both read as deliberate given the docstrings, but are real
divergences from the rest of the module worth a second pair of eyes:

- **`GET /contributed-hours` accepts a broader permission set** than every
  other endpoint in this file — `training.manage` **or** `reports.view` **or**
  `compliance.view`, where the rest of the module (aside from the two report
  reads) is `training.manage`-only. `reports.view` in particular is a much
  more generic grant, and this endpoint returns every active member's name
  plus their individual training/admin hour totals.
- **`ContributedHoursService.get_contributed_hours` does not filter
  `compliance_exempt` members**, unlike `ISOReadinessService.get_iso_readiness`
  and `AnnualComplianceReportService.generate_annual_report`, which both do.
  Per the docstring ("fundraising teams who need total hours contributed by
  all members") this looks deliberate — compliance-exempt status shouldn't
  matter for a total-hours report — but it means the same member can appear
  in one report and be silently absent from a sibling report with no
  explanation visible to either.

## Schema & migration notes

n/a — no model or migration changes; `apply_updates` reads existing column
nullability, and the `report_type` Literal is a schema-layer constraint with
no column change.

## Guard tests added

- `tests/test_compliance_config_service.py::TestConfigService::test_update_profile_applies_fields_and_clears_an_explicit_null` — rewritten from the old
  (buggy) expectation "None is ignored" to the corrected "None clears the
  field."
- `tests/test_compliance_config_service.py::TestConfigService::test_update_profile_name_cannot_be_nulled` — a NOT NULL column rejects an
  explicit null with `apply_updates`'s clean `ValueError`, using a real
  `ComplianceProfile` ORM instance (mirrors FAC-7's `TestNullabilityGuard`
  precedent — a bare `SimpleNamespace` has no inspectable mapper for the
  NOT-NULL check to see).
- `tests/test_compliance_config_service.py::TestConfigService::test_update_profile_threshold_override_can_be_reset_to_default` — the nullable
  override field actually clears now.
- `tests/test_compliance_config_service.py::TestCreateOrUpdateConfig` (new
  class) — the update branch routes through `apply_updates`; the first-write
  race raises a clean `ValueError` and rolls back.
- `tests/test_compliance_config_service.py::TestReportTypeSchema` (new
  class) — all three known `report_type` values accepted at the schema
  layer; an unknown value raises `ValidationError` (422), not a 400 from the
  service.
- `tests/test_compliance_officer.py::TestGetIncompleteRecords` (new class) —
  the query's `LIMIT` binds to the caller's own `limit` param (not a
  hardcoded 500), the missing-field predicate is evaluated in the compiled
  SQL, and per-record `missing_fields` are still reported correctly.
- `tests/test_compliance_officer.py::TestComplianceAttestationValidation::test_out_of_range_compliance_percentage_raises` /
  `test_boundary_compliance_percentage_is_accepted` — the new service-layer
  range check.
- `tests/test_compliance_officer.py::TestContributedHoursService::test_hours_still_match_when_member_id_is_a_uuid_object` — a member whose
  `.id` is a real `uuid.UUID` object still has training/admin hours matched
  correctly; would have failed before the `str()` normalization fix.
- `tests/test_compliance_officer.py::TestGetIncompleteRecords::test_empty_string_location_is_included_in_the_sql_predicate` — the SQL
  predicate matches `location = ''` as well as `location IS NULL`, guarding
  the Codex-caught regression in the first version of CMP-4's fix.

## Completion gate

| Check                                             | Result                  |
| ------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                          | clean                   |
| `black --check` (changed files)                   | clean                   |
| `isort --check-only` (changed files)              | clean                   |
| `python3 scripts/validate_migrations.py --strict` | PASSED (no migrations)  |
| backend tests, compliance scope (`-k compliance`) | 270 passed, 1 skipped   |
| backend tests, full suite                         | 8834 passed, 22 skipped |

---

## Pass 2 (2026-08-30)

**Prefix:** `CMP2` · **PR:** [#2059](https://github.com/thegspiro/the-logbook/pull/2059)

**Scope check:** diffed the current tree against `bf63018b` (the pass-1 merge
commit for PR #1902) across the full backend surface named in pass 1's scope
line — both endpoint files, both service files, `training_compliance.py`, the
model, and the schema. `git diff --stat bf63018b..HEAD -- <those 7 files>`
returns **no output — byte-for-byte unchanged**. Two commits that touched
compliance-adjacent code did land since pass 1 (`250c7905`, shift-compliance
rounding in `scheduling_service.py` — a different feature's file entirely, not
in this feature's scope; `16a23823`, a docs-only schema regen for an unrelated
grants column), neither touches any of the seven files above. Given zero
backend diff, this pass is re-verification of the seven pass-1 fixes plus the
frontend, which pass 1 explicitly did not review — not a first read of grown
files.

### Re-verification of pass-1 fixes (CMP-1 through CMP-7)

Re-read the current code directly for each, not re-cited from the doc:

- **CMP-1 / CMP-2** — `update_compliance_config` and `update_compliance_profile`
  still dump with `exclude_unset=True` (`compliance_config.py:69,162`) and
  route through `apply_updates` (`compliance_config_service.py`), which still
  rejects an explicit null against a NOT NULL column and clears a nullable one.
- **CMP-3** — `create_or_update_config`'s insert branch still wraps its
  `flush()` in `try/except IntegrityError`, raising a clean `ValueError` rather
  than surfacing a raw 500 on a concurrent first-write race.
- **CMP-4** — `get_incomplete_records`'s SQL predicate still reads
  `location IS NULL OR location = ''` alongside `location_id IS NULL` (the
  Codex-caught regression fix), and `LIMIT` still binds to the caller's own
  `limit` rather than a hardcoded pre-filter window.
- **CMP-5** — `ComplianceReportGenerate.report_type` is still
  `Literal["monthly", "annual", "yearly"]`; the service's own three-value check
  is still present as the scheduled-task call path's only guard.
- **CMP-6** — every dict-key id in `get_contributed_hours` and
  `_get_admin_hours_summary` is still wrapped in `str(...)` at both the write
  and read side.
- **CMP-7** — `create_attestation` still rejects `compliance_pct` outside
  `[0, 100]` with its own `ValueError`, independent of the schema's `Field`
  bound.

**Route auth coverage re-enumerated independently** (a fresh AST walk over
both endpoint files, not a re-read of pass 1's prose): all 8 routes in
`compliance_officer.py` and all 12 in `compliance_config.py` carry
`Depends(require_permission(...))` — 20/20, matching pass 1's inventory
route-for-route. No route relies on `get_current_user` alone. No
`require_permission(...)` OR-gate in either file has grown a third alternative
since pass 1; `get_contributed_hours`'s three-permission OR
(`training.manage`, `reports.view`, `compliance.view`) is unchanged and remains
the design observation pass 1 already raised (not re-flagged as new).

**Org-scoping re-swept mechanically.** Every by-id read/update/delete in both
endpoint files resolves through `current_user.organization_id`, either as a
direct filter or via an org-scoped parent join in the service layer (profile
update/delete join through `ComplianceConfig.organization_id`; report
get/delete/email filter `organization_id` directly). No compliance-officer
endpoint accepts a target _member_ id at all — unchanged from pass 1's "no
cross-tenant IDOR" finding, re-confirmed rather than re-derived.

**CS-8 / CS-9 — still open by design, re-confirmed.** `create_attestation`
persists exactly one party id (`attested_by`) and no "subject" field; the
dual-control question (server-side recompute vs. a second approver) still
needs a product decision and is unchanged in `docs/KNOWN_LIMITATIONS.md`.
Monthly reports still relabel the annual dataset (CS-9's data-layer gap).
Neither is re-flagged here.

### Frontend scope — established for the first time this pass

Pass 1 was backend-only ("not reviewed this pass — backend only, per rotation
scope"). Traced every frontend file that imports `complianceOfficerService` or
`complianceConfigService` (the two service objects that call the 20 endpoints
above; `trainingServices.ts` is a shared file also serving training core/
extended, so only the compliance-related exports and their two consuming pages
are in scope — `ComplianceMatrixTab.tsx`, `MemberTrainingStatusPage.tsx`, and
the rest of the ~100-file `grep -ri compliance` surface call `/training/*`
endpoints owned by features 17/18, not this feature): `services/
trainingServices.ts` (compliance sections only), `pages/
ComplianceOfficerDashboard.tsx` (1,195 L), `pages/
ComplianceRequirementsConfigPage.tsx` (1,400 L), and their four test files.

- **Both service objects call the shared `api` client** (`services/api.ts`) —
  `withCredentials: true`, the CSRF double-submit interceptor, and the
  stale-while-revalidate GET cache all apply. Not a bespoke per-module axios
  instance, so CLAUDE.md Pitfall #7 does not apply.
- **Cache exclusion verified against the live route table, not assumed.**
  `'/compliance/'` is already a full-prefix entry in `UNCACHEABLE_PREFIXES`
  (`utils/apiCache.ts` — "compliance attestations, member compliance data
  (PII)"), and the check is a `url.startsWith(prefix)` test, so every one of
  the 20 `/compliance/*` routes — including `/compliance/annual-report` and
  `/compliance/contributed-hours`, both of which return every member's name
  alongside individual hours — is covered. No gap found.
- **Standard sweep, both pages and the service file: zero hits** for
  `window.confirm`/`window.alert`/`window.prompt` (the delete-profile and
  delete-report confirmations both go through `useConfirm()`, matching Pitfall
  #16), `dangerouslySetInnerHTML`, banned `.toLocale*`/`date-fns`/
  `new Date().toISOString().slice(0,10)` (both pages use `formatDate`/
  `formatDateCustom` from `utils/dateFormatting.ts` with `useTimezone()`),
  direct `fetch(`, and `localStorage`/`sessionStorage`. The email-report
  modal (`ComplianceRequirementsConfigPage.tsx`) is a hand-rolled
  `fixed inset-0 flex items-center justify-center` overlay but already uses
  `modal-panel-scroll` on the panel, so Pitfall #21's height-cap defect does
  not apply.

No new finding in either dimension above — both re-confirm an existing
invariant rather than surface a gap.

### CMP2-1 — MED — Two compliance notification settings are stored and displayed, and read by nothing — 🚩 FLAGGED (UI labeled this pass; reader is a product decision)

**What:** `ComplianceRequirementsConfigPage.tsx`'s Notifications panel lets an
officer toggle "Notify members when they become non-compliant"
(`notify_non_compliant_members`) and set a "Reminder Days Before Deadline"
list (`notify_days_before_deadline`, e.g. "30, 14, 7"). Both persist to
`ComplianceConfig` via `PUT /config` and come back on every `GET /config`, so
the toggle shows as checked and the day list shows as saved. **No code
anywhere in the backend reads either column.** Verified two ways: `grep -rn
"notify_days_before_deadline\|notify_non_compliant_members"
backend/app --include="*.py"` returns hits only in `schemas/compliance_config.py`
and `models/compliance_config.py`; and a read of every `compliance` reference
in `scheduled_tasks.py` shows exactly one compliance-related task
(`run_compliance_auto_reports`, registered at `scheduled_tasks.py:5498`), which
handles `auto_report_frequency`/`report_email_recipients` only — a distinct,
already-wired pair of settings on the same config row.

This is CLAUDE.md Pitfall #19 ("A Config Switch Must Have a Reader Before It
Has a UI") on a second module: exactly the `notification_rules` shape the
pitfall was written from — a chief can create/enable a rule and believe it is
active. Here there is no separate rule table, but the effect is identical: the
switch is stored, displayed as on, and inert.

**Where:** `frontend/src/pages/ComplianceRequirementsConfigPage.tsx:632-658`
(the Notifications panel); `backend/app/models/compliance_config.py:136-144`
(the two unread columns); `backend/app/services/scheduled_tasks.py` (no
reader registered).

**Failure scenario:** a compliance officer, worried that members are missing
their training deadlines, opens Compliance → Configuration → Thresholds,
checks "Notify members when they become non-compliant", sets reminder days to
"30, 14, 7", and saves. The page shows a success toast and the checkbox stays
checked on reload. No member is ever notified — there is no code path that
evaluates a member's compliance status against these settings and sends
anything. The officer has no way to discover this short of reading the
backend source; nothing in the UI indicated the setting was inert.

**Disposition:** **partially FIXED, reader FLAGGED.** Building the reader
(a scheduled task that evaluates org compliance state against
`notify_days_before_deadline`, resolves recipients, and sends per Pitfall #18
— email always, SMS only via an `SmsAlert` allowlist entry if ever added) is a
real feature with cadence and message-content decisions to make, not a
drive-by fix — flagged rather than implemented, and mirrored into
`docs/KNOWN_LIMITATIONS.md`. What _is_ fixed this pass, as the pitfall itself
sanctions ("mark it in the UI as not yet in effect"): the panel now carries an
explicit "Not yet active" notice
(`ComplianceRequirementsConfigPage.tsx:632-638`) so the page stops implying
the feature works. Guard test:
`ComplianceRequirementsConfigPage.clearFields.test.tsx`'s "unwired
notification settings" block pins the notice's presence inside the
Notifications section specifically (not merely somewhere on the page), so it
cannot be silently deleted; it does not and cannot assert a reader exists —
that remains this finding's open half.

### CMP2-2 — MED — The compliance config/profile forms have the frontend half of CMP-1/CMP-2's bug: clearing a field and saving silently keeps the old value — ✅ FIXED

**What:** CMP-1 and CMP-2 (pass 1) fixed the _backend_ half of CLAUDE.md
Pitfall #1's update-path rule for this module — `apply_updates` clears a
nullable column on an explicit JSON `null`, and does nothing on an omitted
key. Pass 1 never reviewed the frontend, and the frontend was never updated to
match: every "blank box" field in both save handlers on
`ComplianceRequirementsConfigPage.tsx` coerced an empty value to `undefined`
(`value || undefined`, `list.length > 0 ? list : undefined`), which
`JSON.stringify` drops from the request body entirely — the exact omission
the backend fix exists to distinguish from an explicit clear. Six fields on
the profile save (`description`, `membership_types`, `required_requirement_ids`,
`optional_requirement_ids`, `compliant_threshold_override`,
`at_risk_threshold_override`) and two on the config save
(`report_email_recipients`, `notify_days_before_deadline`) all had this shape.
All eight columns are `nullable=True` (`models/compliance_config.py`), so the
backend was ready to clear them the whole time — the frontend simply never
asked it to.

**Where:** `frontend/src/pages/ComplianceRequirementsConfigPage.tsx` —
`handleSaveConfig` (was `:224-235`) and `handleSaveProfile` (was
`:303-315`).

**Failure scenario:** a compliance officer opens a profile that overrides the
compliant threshold to 90%, decides the override should go away (revert to
the org default), clears the "Compliant Threshold Override" box, and clicks
"Update Profile". The success toast fires; `PUT
/config/profiles/{id}` receives a payload with `compliant_threshold_override`
_absent_ (not `null`); the backend's `exclude_unset=True` + `apply_updates`
combination — working exactly as CMP-2 intended — treats the absent key as
"leave alone" and the 90% override survives. The same mechanism means an
officer can never fully remove all required-training selections or all
membership-type restrictions from an existing profile (unchecking every box
and saving leaves the old list stored), and a compliance officer clearing the
report email recipients to stop auto-emailing a former officer can save
successfully while the old address keeps receiving reports.

**Fix:** the two scalar override fields and `description` now send an
explicit `null` when blank (`value || null` / `value ? parseFloat(value) :
null`) instead of `undefined` — correct on both the create and the update
path, since a `null` and an omitted key are equivalent on `create_profile`'s
full (non-`exclude_unset`) dump, so there is no branch to get wrong. The four
list-typed fields (`membership_types`, `required_requirement_ids`,
`optional_requirement_ids`, `report_email_recipients`,
`notify_days_before_deadline`) now always send the current array — including
empty — matching the already-correct `admin_hours_requirements` pattern this
same file used (with an explanatory comment) for exactly this reason.

~~Verified against the read side: every consumer of these columns
(`training_compliance.py` `if profile.membership_types:`, `if profile and
profile.required_requirement_ids:`, `compliance_config_service.py`'s
`_validate_profile_fks`, `if config and config.report_email_recipients:`)
does a truthiness check, so `[]` and `None` are read identically — the switch
from "omit when empty" to "always send, possibly empty" changes nothing about
create-path behavior and only fixes the update path.~~ **Correction (Codex
review on PR #2059, CMP2-2-C): this generalization was wrong for one of the
four fields it named.** `membership_types` and `report_email_recipients` are
_additive restriction_ lists, where "no restriction" and "empty restriction"
are the same state by design (the page's own copy says as much: "Leave empty
to apply to all membership types") — `[]` and `None` really are equivalent
there, and `_validate_profile_fks` no-ops on either regardless of meaning.
`required_requirement_ids` is a _substitution_ list: `None` means "no
override, grade against every org-wide requirement" and `[]` means "this
group requires nothing" — two opposite instructions that the truthy check in
`compute_org_compliance_pct` (`training_compliance.py`) could not tell apart,
silently taking the `None` branch either way. Because CMP2-2 is exactly what
makes an officer's `[]` reach that column for the first time (pass 1 fixed
only the backend's own update-path handling, not this frontend omission),
this pass made a pre-existing, previously-unreachable backend bug reachable
without noticing. Fixed as CMP2-3 below, found in Codex's review of this PR
rather than by this pass's own verification. Two frontend types
(`ComplianceProfileCreate`/`ComplianceProfileUpdate`'s three scalar fields,
`ComplianceConfigUpdate`'s two array fields) were widened to `| null` to
accept the new payload shape — `exactOptionalPropertyTypes` requires the
property's declared type to include `null` before a `null` value can be
assigned to it.

Guard test:
`ComplianceRequirementsConfigPage.clearFields.test.tsx` — originally asserted
against the page's source (matching this file's own established pattern in
`.tab.test.tsx`/`.adminHours.test.tsx`, since reaching these lines via a full
render needs five mocked services) that the config and profile payload blocks
send `null` and not `undefined` for the three scalar fields, and that the
four list fields are sent unconditionally rather than hidden behind a
`.length > 0 ? … : undefined` guard. **Rewritten (Codex review, CMP2-2-A):**
a source-text scan would keep passing even if the Save button stopped calling
the service, or reverted to sending `undefined` — it asserts what the code
_says_, not what it _does_. The file now renders the real page with the five
services mocked (the "needs five mocked services" reason the original test
gave for not doing this no longer holds it back), drives each field through
an actual clear via `@testing-library/user-event`, clicks Save, and asserts
the exact request body `updateConfig`/`updateProfile` received — per CLAUDE.md
rule #13, real arguments via `toHaveBeenCalledWith(...)`, not a bare/zero-arg
call. It also gained a second describe block, `reading a cleared field back
after reload (CMP2-4)`, covering the read-path fix below.

### CMP2-3 — HIGH — A compliance profile with zero required requirements graded members against every org requirement instead of none, and its threshold overrides were silently skipped — ✅ FIXED

**What:** `compute_org_compliance_pct` (`training_compliance.py`) matched a
member to their highest-priority compliance profile and then read two things
off it behind a single guard:

```python
if profile and profile.required_requirement_ids:
    member_reqs = [reqs_by_id[rid] for rid in profile.required_requirement_ids if rid in reqs_by_id]
    if profile.compliant_threshold_override is not None:
        member_compliant_threshold = profile.compliant_threshold_override
    if profile.at_risk_threshold_override is not None:
        member_at_risk_threshold = profile.at_risk_threshold_override
```

`if profile.required_requirement_ids:` is a truthy check, so `[]` (an officer
explicitly unchecked a profile's last required requirement — "this group
requires nothing") and `None` (the profile never overrode the requirement
list at all — "no override, use every org requirement") took the _same_
branch: `member_reqs` stayed `list(requirements)`, every active org-wide
requirement. An officer who believed they had zeroed out a group's
requirements instead graded that group against the full org list. The same
guard also skipped the threshold overrides for a profile that set only
`compliant_threshold_override`/`at_risk_threshold_override` and never touched
`required_requirement_ids` — a lenient- or strict-threshold-only profile
never actually changed the pass bar.

Before CMP2-2, the `[]` half of this was **unreachable in practice**: the
frontend's `.length > 0 ? list : undefined` guard meant an officer clearing
every checkbox sent `undefined` (dropped from the request body), and the
stored value never became `[]` — it silently kept whatever the profile had
before. CMP2-2 fixed that omission so the clear actually persists, which is
what makes CMP2-3 the bug an officer can now actually trigger. The
threshold-override half was reachable independently of CMP2-2, on any profile
that set an override without also setting `required_requirement_ids`.

**Where:** `backend/app/services/training_compliance.py:744-767` (was
`:743-756` pre-CMP2-2; the compliance-percentage evaluation loop inside
`compute_org_compliance_pct`).

**Failure scenario:** a training officer creates an "Admin only" profile for
members who do no field training, unchecks every required requirement so the
profile shows 0 required, and saves — the officer now believes the org
dashboard grades this group against nothing. `compute_org_compliance_pct`
instead evaluates every admin-only member against the full active-requirement
list, so members who cannot mechanically complete field-only requirements
(apparatus checks, driving evaluations) show as chronically non-compliant on
the org-wide compliance percentage, and a chief pulling that number for a
grant or ISO submission gets a materially wrong figure. Separately, a "New
recruit" profile set up with only a lenient `at_risk_threshold_override: 50`
(no required-list override) never actually got the lenient threshold — every
recruit was still graded at the org default.

**Fix:** decoupled the two reads. `required_requirement_ids is not None` (not
truthy) governs the requirement-list substitution, so an explicit `[]` is
honored as "grade against nothing" instead of falling through to "grade
against everything." The threshold overrides moved out from under that guard
entirely — they now apply whenever a profile matched the member at all,
independent of whether that profile also overrides the requirement list.
`optional_requirement_ids` was checked for the same class of bug: it is
tracked on the model and validated on write (`compliance_config_service.py`'s
`_validate_profile_fks`) but has no reader anywhere in
`training_compliance.py`, so there is no truthy-vs-`is not None` distinction
to get wrong there — it is reporting-only today, unrelated to this fix.

Guard test: `backend/tests/test_compute_org_compliance_pct_profile_overrides.py`
— three integration tests against a real database (`db_session`, no mocked
query layer): a profile with `required_requirement_ids: []` grades its one
matched member as fully compliant against an otherwise-unmet requirement
(fails pre-fix at 0%, per the bug above); the same setup with
`required_requirement_ids: None` still grades against every org requirement
(so the first test cannot pass merely by always returning 100, and this half
was already correct pre-fix); and a profile with only threshold overrides set
(no required-list override) has that override actually applied (fails
pre-fix, since the org default's 100%/75% thresholds still governed).

### CMP2-4 — MED — A cleared reminder-days list reappeared with its old-looking default text immediately after reload — ✅ FIXED

**What:** CMP2-2 makes clearing "Reminder Days Before Deadline" and saving
send/store an explicit `null` in `notify_days_before_deadline`. `loadConfig`'s
response mapping did not honor that: `data.notifyDaysBeforeDeadline?.join(',
') ?? '30, 14, 7'` falls back to the suggested-default string whenever the
field is `null` (optional chaining turns `null` into `undefined`, same as a
missing key, so `??` cannot tell "never configured" apart from "explicitly
cleared"). `'30, 14, 7'` is only supposed to be the pre-save placeholder — the
component's initial `useState` for a config that has never been saved at
all — but the same fallback fired every time a _saved_ config's field came
back `null`, so an officer who cleared the box, saved, and reloaded the page
saw the old-looking default value sitting in the box again, even though the
database correctly held no reminder schedule. `report_email_recipients` and
every profile-side field mapped by this same load function
(`description`, both threshold overrides, `membershipTypes`,
`requiredRequirementIds`, `optionalRequirementIds`) were checked for the
identical shape and do not have it — each already falls back to `''`/`[]` on
`null`, not to a value that looks like real data.

**Where:** `frontend/src/pages/ComplianceRequirementsConfigPage.tsx:165`
(`loadConfig`, inside the `handleSaveConfig`-adjacent form-state hydration).

**Fix:** the fallback for a loaded (non-null `data`) config is now `''`, not
`'30, 14, 7'` — the suggested text only ever shows before a config has been
saved for the first time, never as a stand-in for an explicit clear.
`ComplianceConfigData.reportEmailRecipients`/`notifyDaysBeforeDeadline` were
widened to `| null` (they were `| undefined`-only) to type the value the
backend's `Optional[List[...]] = None` response schema actually sends over
the wire, matching the pattern the update-payload types already used.

Guard test:
`ComplianceRequirementsConfigPage.clearFields.test.tsx`'s "reading a cleared
field back after reload (CMP2-4)" block — a config with
`notifyDaysBeforeDeadline: null` renders the reminder-days box empty (fails
pre-fix, shows `'30, 14, 7'`); the same config with a real list still shows it
(so the first assertion cannot pass by rendering every list as empty); and a
config with `reportEmailRecipients: null` renders that box empty too
(already-correct behavior, pinned so it cannot regress).

## Completion gate (pass 2)

| Check                                             | Result                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                          |
| `black --check app/ tests/ alembic/`              | ✅ 1335 files unchanged                                                  |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (`isort==8.0.1`, CI's pin, already installed)                   |
| `python3 scripts/validate_migrations.py --strict` | ✅ 394 revisions, single head `f6a7b8c9d0e1`                             |
| `pytest tests/ -q -k "compliance or attestation"` | ✅ 290 passed, 1 skipped (pre-existing optional-dependency skip)         |
| `pytest tests/ -q` (full backend suite)           | ✅ 9268 passed, 22 skipped (pre-existing Docker/no-MySQL/optional skips) |
| `cd frontend && npx tsc --noEmit`                 | ✅ 0 errors                                                              |
| `cd frontend && npx eslint .`                     | ✅ 0 errors, 10 pre-existing warnings (none in files this pass touched)  |
| `cd frontend && npx vitest run` (full suite)      | ✅ 5458/5458 passed, 415/415 files — see below                           |

Backend code changed after Codex review (CMP2-3, `training_compliance.py`);
figures above reflect that fix and its new test file
(`test_compute_org_compliance_pct_profile_overrides.py`).

**Beyond the declared gate — one pre-existing, unrelated frontend failure,
originally escalated and now fixed instead (Codex review, CMP2-B):** the full
`npx vitest run` (not itself part of the eight-command gate above, run as
extra diligence since this pass touches frontend types) originally came back
5456/5457 passing. The one failure —
`src/pages/scheduling/EquipmentCheckTemplateBuilder.test.tsx > EquipmentCheckTemplateBuilder movement persistence > keeps a rejected item in its source and does not show a success toast`
(`EquipmentCheckTemplateBuilder.test.tsx:465`, a `findByRole('button', { name:
'Collapse Oxygen mask' })` that timed out) — was in the scheduling/equipment-
check module (feature 14, already reviewed in an earlier rotation pass), not
compliance, and confirmed pre-existing on the untouched base tree.

This pass's first version of this document treated that as a Hard Stop under
CLAUDE.md and reported it without fixing it. **That was the wrong call.**
CLAUDE.md's Hard Stop is for a fix that "genuinely exceeds the current scope"
— its own example is "hundreds of strict-mode violations across unrelated
files" — and does not carve out an exception for a fix that happens to sit in
a different feature's file; "pre-existing" and "unrelated" are explicitly
_not_, on their own, grounds to skip a fix ("There Are No Acceptable
Pre-Existing Errors"). Investigating the actual cause took a few minutes: the
`movement persistence` describe block's `beforeEach` was the one block in this
test file that never overrode `window.matchMedia` to simulate a laptop
viewport, unlike two sibling blocks in the same file (`EquipmentCheckTemplateBuilder.test.tsx:166,223`)
that already do exactly this. Left at the suite-wide default
(`matches: false`, from `src/test/setup.ts`), the component's `isLaptop` flag
was permanently false for every test in that block, so the item-row toggle's
accessible name could only ever read "Edit X" — never "Collapse X" — no
matter how the failed-move error handler expanded the item. Copying the same
override already used twice in this file into that block's `beforeEach` (a
five-line, no-production-code change, confined to one test file) makes the
assertion reachable; the fix does not touch
`EquipmentCheckTemplateBuilder.tsx` at all, only its test. All 32 tests in
that file pass, including the previously-failing one — not merely restored to
its old (broken) state.

`git stash`-ed this pass's changes and re-ran the test against the untouched
base tree to confirm it failed identically there first (same assertion, same
line, same timeout) before concluding it was pre-existing and safe to fix
alongside this pass's own changes rather than a symptom of something this
pass broke.
