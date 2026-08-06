# Module Audit — Training

**Scope:** the largest module in the audit — 8 endpoint files (~8,100 L, 154
endpoints: `training.py`, `training_programs.py`, `training_enhancements.py`,
`training_submissions.py`, `training_waivers.py`, `training_sessions.py`,
`training_module_config.py`, `external_training.py`) + ~13 services (~9,300 L),
frontend `modules/training`. PHI-adjacent (certifications, scores, medical/
training waivers, member compliance). (`compliance_*`/`skills_testing` are
audited separately under #22.)
**Audited:** iteration 18 — split across two parallel readers: (A) member-facing
+ compliance/waiver/submission integrity; (B) programs + external-provider +
enrollment/session isolation. `training_program_service.py` (4,027 L) got
invariant-focused (not line-by-line) coverage.

> **Coverage note (2026-08-05):** This audit predates the multi-class course
> feature. `course_syllabus.py` and `course_cohorts.py` (2 endpoint files, 20
> endpoints) and their two services (`course_syllabus_service.py`,
> `course_cohort_service.py`) are **not covered by the findings below** and
> should be read in the next iteration. Written to the module's existing
> conventions — `training.manage` on every write, `assert_in_org` on every
> client-supplied FK, `organization_id` on every by-id query, `safe_error_detail`
> on every handler, audit events on the consequential operations — but that is a
> claim by the author, not an audit result. Two areas worth a reader's attention:
> generation writes across four tables plus Events, TrainingSessions,
> EventRSVPs and ProgramEnrollments in one transaction (a wide blast radius for
> an org-scoping miss), and `GET /training/cohorts/{id}` is the module's only
> endpoint that grants a non-officer read based on **roster membership** rather
> than a permission.

## Verified good ✅
- **Auth coverage:** all 154 endpoints authed (`training.manage`/`.view_all`/
  `events.manage`/`system.admin`).
- **Per-member PHI endpoints are self-or-officer gated** via
  `_require_self_or_training_officer` (`/stats/user/{id}`,
  `/compliance-summary/{id}`, `/reports/user/{id}`, `/requirements/progress/{id}`,
  `/category-hours/{id}`) and `GET /records` confines non-officers to their own
  id. Waivers are fully `training.manage`-gated (no member self-grant).
- **Programs-service tenant isolation is solid** — every by-id
  read/update/delete/enroll/advance/reset/withdraw is org-scoped (direct filter
  or via `get_program_by_id`/`get_enrollment_by_id`/`_get_org_scoped_progress`);
  **XC-3 clean**. `enroll_member` validates program + `User.organization_id`.
  Credit accrual routes through an idempotency ledger (no double-credit on
  re-sync/re-approve).
- **External-provider SSRF + credentials are solid:** the provider base URL is
  `validate_integration_url`'d at write time **and** re-validated before every
  outbound call (`test_connection`, `_fetch_external_records`,
  `fetch_*_categories`); API keys/secrets are `encrypt_data`-wrapped and
  write-only (omitted from responses). Sync writes re-verify the mapped user is
  in-org (`_verify_user_in_org`).
- **No SQL injection** (parameterized equality/`in_`; no raw LIKE); enhancement
  file upload uses magic-byte MIME + server-generated names; download has a
  realpath containment guard. Submission self-approval blocked on the manual
  review path.

## Findings

### TR-1 — HIGH — Cross-member PHI leak: `GET /training/certifications/expiring` — ✅ FIXED
Member-authenticated (`get_current_user`) but scoped **only by org**, returning
every member's expiring certification records (course, certification_number,
issuing_agency, score, instructor) to any authenticated member. A near-duplicate
route (`/training/expiring-certifications`) is correctly `training.manage`-gated —
this one was the under-gated twin.
**Fix:** confine non-officers to `user_id == current_user.id` (officers with
`training.manage` still see the whole org) via a new `user_id` filter on the
service method.

### TR-2 — MEDIUM (XC-1) — `POST /training/records` skipped `user_id` org validation — ✅ FIXED
The client-supplied `user_id` was only org-validated inside the "auto-populate
rank/station" block, so supplying both `rank_at_completion` and
`station_at_completion` skipped the check and let a record be attributed to an
arbitrary/foreign user id (org-stamped to the caller's org, feeding that id's
compliance math). The course-expiration lookup was also not org-scoped.
**Fix:** validate the member is in-org **unconditionally** (404 otherwise),
reusing the row for auto-populate; org-scoped the `TrainingCourse` lookup.

### TR-3 — MEDIUM (XC-1 + cross-org PII leak) — External user-mapping leaked a foreign user's name/email — ✅ FIXED
`update_user_mapping` stored a client-supplied `internal_user_id` with no in-org
check, and both the list and update-response **enrichment lookups**
(`select(User.full_name, User.email).where(User.id == internal_user_id)`) had **no
org filter** — so a manager could set the mapping to a foreign org's user UUID and
read back that user's name + email.
**Fix:** validate `internal_user_id` is in-org before storing, and org-scoped both
enrichment lookups.

### TR-4 — LOW (cleanup) — Dead no-op default-year expression — ✅ FIXED (removed) + flagged
`get_all_requirements_progress` had a dead `year or datetime.now().year` statement
(result discarded). Removed the no-op. **Flagged:** whether `year` should default
to the current year (vs the current "all years" when omitted) is a
compliance-semantics decision — not changed unverified, as it would alter which
year's requirements members are measured against.

### TR-5 — LOW/MED (flagged) — Auto-approved submissions bypass separation-of-duties
The manual submission-review path blocks self-approval, but the **auto-approve**
branch (`require_approval=False` or `hours_completed <= auto_approve_under_hours`)
immediately spawns a COMPLETED record crediting the member's self-reported hours
with no reviewer. Config-driven (likely intended), but the only limit on member
self-credit is the org's auto-approve config. **Status:** flagged (mirror the
manual path's SoD guard or accept as documented config).
> **Clarification (app-review A9):** the *manual* path's self-approval block is
> now the shared `assert_different_person` guard
> (`training_submission_service.review_submission`, line 289) rather than an
> inline check — belt-and-suspenders consistency with finance/skills/admin-hours.
> This does **not** close TR-5: the finding is about the **auto-approve** branch
> in `create_submission` (line 114), which spawns a COMPLETED record with *no
> reviewer at all*, so an actor≠subject check does not apply. TR-5 remains a
> config decision (bound the auto-approve threshold, or accept it as documented).

### TR-6 — MEDIUM (upgraded) — External/enhancement cross-org FK — ⚠️ PARTLY FIXED (app-review B18)
**Live leak found & fixed (B18):** `update_category_mapping` stored a client
`internal_category_id` unchecked and the list/update enrichment lookups read
`TrainingCategory.name` by that id with **no org filter** — a `training.manage`
user could map to a **foreign org's** category id and read its name back (the TR-3
shape, for categories; this was under-rated as "defense-in-depth"). Fixed:
validate `internal_category_id` in-org on write + org-scope both enrichment
lookups. Also fixed `provider.default_category_id` (validated in-org on
create/update — it attributes imported records at sync time). 2 endpoint tests
added. **Spot-check resolved:** `training_enhancement_service` by-id methods
(`get_pathway`/`get_matrix`/`update_qualification`/…) all filter `organization_id`
— confirmed. **Still flagged (backstopped, not live):** xAPI `source_provider_id`,
`bulk_enroll` name lookups, `perform_sync_task` provider re-fetch (backstopped by
downstream org-scoped writes); `_decrypt_field` returns raw on decrypt failure (a
migration shim — should fail closed once CI-5 field-encryption backfill completes).
See `docs/app-review/training.md`.

## Notes
- Large-module caveat: `training_program_service.py` (4,027 L) and
  `training_enhancement_service.py` were reviewed for security invariants, not
  line-by-line. The invariants (org-scoping, XC-3, SSRF, credentials) held on
  every path examined.
- flake8 `PT028` warnings on `external_training.test_provider_connection` are
  pytest-plugin false positives (it's a FastAPI endpoint, not a test).
