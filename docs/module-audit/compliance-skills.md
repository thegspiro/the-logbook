# Module Audit — Compliance / Skills

**Scope:** PHI-adjacent compliance + skills-testing surface —
`endpoints/skills_testing.py` (1,412 L) + `skills_testing_service.py`,
`endpoints/compliance_officer.py` (281 L) + `compliance_officer_service.py`
(1,151 L) + `training_compliance.py`, `endpoints/compliance_config.py` (280 L) +
`compliance_config_service.py` (455 L). Member compliance status, certifications,
skills-test scores/pass-fail, evaluator notes, ISO-readiness reports.
**Audited:** iteration 22 — three parallel readers: (A) skills-testing, (B)
compliance-officer + training-compliance, (C) compliance-config.

## Verified good ✅
- **No cross-tenant IDOR anywhere in the three modules.** Every by-id
  read/update/delete is org-scoped (skills tests/templates via
  `organization_id == current_user.organization_id`; compliance profiles/reports
  via an org-scoped parent join). Compliance-officer endpoints take **no**
  client-supplied record ids at all (officer-gated aggregation only). **XC-3
  clean.**
- **The `get_current_user`-only skills routes are org-scoped**, and the one
  mutation (`DELETE /tests/{id}/discard`) is practice-only **and**
  examiner-ownership-checked — not a bare IDOR.
- **XC-1 on skills write paths already solid** — `requirement_id`,
  `template_id`, `candidate_id` all validated in-org on create/update;
  `examiner_id` is server-set, never client-supplied.
- **Compliance-officer reads are officer-gated** (`training.manage` / management
  perms); no endpoint accepts a target member id, so no member can pull another
  member's compliance/cert detail.
- **No NULL-org compliance rows** — `TrainingRequirement.organization_id` is
  `nullable=False`; requirement/config lookups strictly org-filtered.
- **No SQL injection** — no LIKE/raw SQL/f-string queries; all matching is
  parameterized or in-memory. Division-by-zero guarded throughout. Report
  generation fails cleanly (FAILED status, no dangling GENERATING row).

## Findings

### CS-1 — MEDIUM (cross-member PHI) — Any member could read every member's skills-test scores + evaluator notes — ✅ FIXED
`GET /skills-testing/tests` and `GET /tests/{id}` were org-scoped but had **no
intra-tenant object-level authorization** — any authenticated member (no officer
role) could list every skills-test record in the org (pass/fail, `overall_score`,
examiner) and fetch any single test by id, including top-level evaluator `notes`
and per-criterion `section_results`. Contrast with the template list, which
already downgrades non-officers via `_user_has_officer_role`.
**Fix:** a non-officer is now confined to tests where they are the candidate or
examiner (`or_(candidate_id == self, examiner_id == self)` on the list; a
by-id 404 on the detail). Officers (`training.manage` / officer role) keep the
full org view — mirrors the module's existing template-visibility split and the
audit's TR-1/FIN-3 self-confinement precedent.

### CS-2 — LOW — `GET /templates/{id}` skipped the visibility filter the list applies — ✅ FIXED
A regular member could fetch an `officers_only` / `assigned_only` template
directly by id even though the list route hides it from non-officers.
**Fix:** applied the same `_user_has_officer_role` visibility gate (404 on a
restricted template for non-officers).

### CS-3 — MEDIUM (XC-1) — Compliance profile stored unvalidated cross-org FK ids — ✅ FIXED
`create_profile` / `update_profile` persisted client-supplied
`required_requirement_ids`, `optional_requirement_ids`, `role_ids`, and
`admin_hours_requirements[].category_id` with no in-org check. A `settings.manage`
caller could store requirement / role / admin-hours-category ids from another
tenant (or garbage), silently corrupting compliance evaluation (a member measured
against a non-existent-in-org requirement drops out or mis-flags) and creating a
latent cross-tenant disclosure vector.
**Fix:** a new `_validate_profile_fks` helper validates each id against an
org-scoped query (`TrainingRequirement`, `Position`, `AdminHoursCategory`) before
storing; a foreign/unknown id raises (→ 400).

### CS-4 — MEDIUM — CSV/spreadsheet formula injection in the annual compliance export — ✅ FIXED
`export_annual_report` wrote member `name` (built from user-controlled
first/last name) verbatim into CSV cells, so a member named `=cmd|…` gets that
formula executed when a compliance officer opens the export in Excel/Sheets —
stored injection against the officer's workstation.
**Fix:** a `_csv_safe` helper prefixes any cell beginning with `= + - @` / control
chars with an apostrophe (applied to `name` and `status`). Normal names unchanged.

### CS-5 — MEDIUM (correctness) — Member with zero requirements mislabeled `at_risk` and dropped from compliant count — ✅ FIXED
In `generate_annual_report`, a member with `req_total == 0` had `compliance_pct`
set to 100 but the status ladder (`met_count >= req_total and req_total > 0`) fell
through to `at_risk`, so they were never counted `fully_compliant` and the org-wide
percentage was understated (an org with no active requirements reported 0% with
every member "at_risk"). This contradicted the sibling
`compute_org_compliance_pct`, which returns 100 for zero requirements.
**Fix:** treat `req_total == 0` as compliant, matching the sibling service.

### CS-6 — MEDIUM (email HTML injection) — Skills-result email interpolated names/labels unescaped — ✅ FIXED
`email_test_results` f-string-interpolated template `section_name`/`label` and
denormalized candidate/examiner/template names into the result email HTML with no
escaping.
**Fix:** `html.escape()` on the interpolated values (matches the MSG-1/EV-2
pattern from earlier iterations).

### CS-7 — LOW — Threshold-ordering not validated on compliance config — ✅ FIXED
`compliant_threshold` / `at_risk_threshold` were independent 0-100 fields with no
cross-field validator, so an inverted pair (compliant=50, at_risk=90) produced
incoherent status bucketing.
**Fix:** a `model_validator` on the create + update schemas rejects
`at_risk_threshold > compliant_threshold`.

### CS-8 — MED/LOW (flagged) — Separation-of-duties on skills tests + attestations
- Skills: an examiner (`training.manage`) can create a test where they are also
  the candidate, then score + pass it, auto-completing their own linked training
  requirement — self-certification. (skills #3)
- Attestations: `create_attestation` records a client-supplied
  `compliance_percentage` with nothing recomputed server-side and no second
  approver (self-attestation). (officer #3)
**Status:** flagged — both need a candidate≠examiner / dual-control rule (and
possibly an `is_practice` carve-out), which changes the workflow.

### CS-9 — LOW — partially FIXED — Reporting correctness / abuse-surface polish
- **✅ Report email HTML injection closed.** `_email_report` interpolated the org
  name, `report_type`, and `period_label` raw into the HTML body — `org.name` is
  user-controlled and `report_type` flowed from the request, so an unescaped
  value was HTML/script injection in the recipient's mail client. All three are
  now `html.escape`d. (config #6)
- **✅ `report_type` constrained.** `generate_report` now rejects anything other
  than `"monthly"`/`"annual"` (was a free-form string that is persisted and
  interpolated). (config #4)
- **Flagged (feature):** monthly reports still return the annual dataset relabeled
  — a real monthly view needs `generate_annual_report` to accept a month window
  (data-layer change), deferred. (config #2)
- **Flagged (policy decision):** report emailing accepts client-supplied
  `additional_recipients` with no allow-list. Restricting to org-member emails
  would close a compliance-data exfiltration path but breaks legitimate external
  recipients (e.g. a state compliance auditor), so it needs an owner decision.
  (config #5)
- **✅ Unblocked (officer #2, resolved 2026-07-30: `audit_logs.organization_id` exists (migration `20260801_0009`, backfilled from user_id, hash-bound from version 3)):**
  attestation history now filters on the audit log's `organization_id`
  column instead of over-fetching globally and filtering in Python;
  `records_with_certification` mislabel is ambiguous-intent, left as-is
  (officer #5); ISO-readiness `user_id` String match is latent (officer #6).
**Status:** injection + input-validation fixed; monthly windowing (feature) and
recipient allow-list (policy) deferred.

## Notes
- Large-file caveat: `compliance_officer_service.py` (1,151 L) and
  `skills_testing.py` (1,412 L) were reviewed for security invariants
  (org-scoping, XC-1/2/3, PHI exposure, injection), not line-by-line. The
  invariants held on every path examined.
- CS-1 and CS-2 use the module's existing `_user_has_officer_role` helper (a
  role-string / permission-list check), keeping the fix consistent with the
  module's own authorization model.
