# Security Review 18 — Training Extended

**Prefix:** `TRX` · **Iteration:** 18 · **Reviewed:** 2026-08-26 · **PR:** TBD

**Backend:** `api/v1/endpoints/training_submissions.py` (730 L),
`api/v1/endpoints/training_waivers.py` (238 L),
`api/v1/endpoints/training_enhancements.py` (885 L → 906 L),
`api/v1/endpoints/external_training.py` (1,243 L),
`api/v1/endpoints/course_cohorts.py` (717 L),
`api/v1/endpoints/course_syllabus.py` (273 L),
`services/training_submission_service.py` (739 L),
`services/training_waiver_service.py` (283 L, unchanged),
`services/training_enhancement_service.py` (1,677 L → 1,745 L),
`services/external_training_service.py` (1,318 L, unchanged),
`services/course_cohort_service.py` (1,517 L → 1,545 L),
`services/course_syllabus_service.py` (363 L),
`services/training_program_service.py` (one org-scoping fix, out of this
iteration's file list — see TRX-1)
**Migrations:** none this iteration (no schema change)

---

## Scope

Feature 18 of the security-review rotation — the second and final half of
the training module's module-audit unit (iteration 18, 8 endpoint files,
154 endpoints), split across the rotation's features 17 ("training core":
`training.py`/`training_programs.py`/`training_sessions.py`, closed via
PR #1851) and this one ("training extended"): `training_submissions.py`,
`training_waivers.py`, `training_enhancements.py`, `external_training.py`,
and `course_cohorts.py`/`course_syllabus.py`.

`course_cohorts.py`/`course_syllabus.py` had **never been read by any prior
audit or review pass** — the module-audit's own coverage note (2026-08-05)
explicitly deferred them ("should be read in the next iteration") and no
pass ever picked that up until now. Everything else here carries prior
coverage: module-audit TR-1..TR-6, and app-review passes 1-4 (TR-3/TR-5/
TR-6/TR-7/TR-8/TR-9/TR-10, all closed).

Read all twelve files in full, split across four parallel reads (submissions

- waivers; enhancements; external-training; cohorts + syllabus), each
  briefed with the specific prior findings and flagged/backstopped items in
  its files so the pass re-verified rather than re-derived.

## Findings

**10 new findings, all fixed:**

### TRX-1 — HIGH (XC-1, confirmed live) — `bulk_enroll_members` leaked a foreign org member's real name

`training_program_service.py`'s prerequisite-gate error strings
(`"{name} has not completed prerequisite program"`) were built from a batch
`User` lookup with **no organization filter** — `select(User).where(User.id.in_(user_id_strs))`.
A `training.manage` caller in org A who knows (or guesses) a `User.id` UUID
belonging to org B, and supplies it to `POST /training/programs/{id}/bulk-enroll`
against any org-A program with `prerequisite_program_ids` set, always fails
that gate (a foreign user can never appear in the completed-prerequisites
set) — and the response embeds the org-B member's real first + last name.
The actual `ProgramEnrollment` write is safely blocked elsewhere in the same
method; only the name-lookup used for the error message was unscoped. Not
caught by the TR-17 pass despite `training_program_service.py` being in
that iteration's file list — this method's error-message path isn't a
by-id read/update/delete, so it didn't match that pass's search pattern.
**Fix:** filter the batch lookup on `User.organization_id`; a foreign id now
falls back to the raw UUID in the error string instead of resolving a name.

### TRX-2 — LOW — External-provider update: blind `setattr` on a NOT NULL column

`update_provider` (`external_training.py`) looped
`setattr(provider, field, value)` over the allowed field set with no
NOT-NULL guard. `ExternalTrainingProviderUpdate.name` is `Optional[str]`
(permits an explicit `null`), while `ExternalTrainingProvider.name` is
`nullable=False` — an explicit `{"name": null}` reached `db.commit()`
unguarded and raised a raw `IntegrityError` (500) instead of a clean 400.
No try/except wrapped the write at all. **Fix:** route the write through
`apply_updates`, wrapped in `except ValueError → 400`, matching the
established pattern elsewhere in this module (MS-5/FAC-7-class fix).

### TRX-3 — MEDIUM-LOW — `GET /effectiveness/evaluations` had no gate and leaked every member's self-evaluations org-wide

The endpoint depended only on `get_current_user` — no permission, no
self-filter — and `TrainingEffectivenessService.get_evaluations` filtered
solely by `organization_id`. Any authenticated member (no `training.manage`)
could read every coworker's submitted training-effectiveness evaluation:
free-text `comments`, `behavior_observations`, `behavior_rating`,
`results_notes`. This is the same member-training-PII class
`get_member_competencies` in the same file already gates ("competency
levels are member training PII. Members read their own via
GET /competency/me"), which this endpoint had no equivalent for. **Fix:**
confine non-officers to their own submissions
(`user_id=None if is_officer else current_user.id`), mirroring the
established `training.py` pattern (`get_expiring_certifications`) rather
than introducing a third access-control shape.

### TRX-4 — MEDIUM — Cohort class reschedule/cancel: mutate-before-validate, and a silent audit gap on mismatch

`reschedule_cohort_class`/`cancel_cohort_class` resolved the target purely
by `cohort_class_id` (org-scoped, but **not** scoped to the URL's
`cohort_id`) — `_get_cohort_class` filtered only `id` + `organization_id` —
mutated it, **committed**, and only afterward checked
`cohort_class.cohort_id == cohort_id`, returning 404 on a mismatch. Any
`training.manage` holder (already permitted to manage any cohort org-wide,
so not a tenant-isolation break) supplying a `cohort_class_id` from cohort B
while the URL names cohort A genuinely rescheduled/cancelled the class in
cohort B — real state mutation, event cancelled — while being told 404
("nothing happened"). For cancel specifically, `log_audit_event` sat after
the mismatch check, so a mismatched cancel left **zero audit trail** for a
real cancellation. **Fix:** threaded `cohort_id` into `_get_cohort_class`
(and `reschedule_class`/`cancel_class`), so a cross-cohort id fails closed
_before_ any write — the endpoint's post-hoc mismatch check is now
unreachable and was removed.

### TRX-5 / TRX-5b — LOW — Cohort/syllabus-class update: blind `setattr` on NOT NULL columns

Same class as TRX-2, two more instances:

- `CourseCohortService.update_cohort` — `CourseCohort.name`/`.status` are
  `nullable=False`; `CourseCohortUpdate.name`/`.status` are `Optional`, so
  an explicit null 500'd.
- `CourseSyllabusService.update_class` — `CourseClass.class_course_id`/
  `.day_offset`/`.duration_minutes` are `nullable=False`;
  `CourseClassUpdate`'s corresponding fields are `Optional`, same failure
  shape.

**Fix:** both routed through `apply_updates` (preserving the enum-cast/
UUID-stringify/JSON-deep-copy special-casing each already had for specific
fields); both endpoints already caught `ValueError → 400`, so no endpoint
change was needed beyond the service-layer fix.

### TRX-6 — LOW (XC-1) — Waiver `requirement_ids` unvalidated, and confirmed to be projected (corrects a stale premise)

`training_waivers.py` stored a client-supplied `requirement_ids` array with
no in-org check. The task brief for this pass (inherited from the TR-17
carried-forward notes) assumed this field was "not projected into any
response" and therefore lower-priority; that premise does **not** hold —
`_to_response` explicitly serializes `waiver.requirement_ids` into
`TrainingWaiverResponse`, returned from all four waiver endpoints.
Concrete risk stays low (it echoes back exactly what the same caller
submitted; the one consumer, `count_waived_months`, does a same-org string
check and never dereferences the ids into a `TrainingRequirement` row), but
the write-path gap is real and now closed rather than left flagged on a
false premise. `update_training_waiver` also had the TRX-2-shape blind
`setattr` bug (`TrainingWaiver.start_date` is `nullable=False`). **Fix:**
`assert_all_in_org` on `requirement_ids` for both create and update; update
path also routed through `apply_updates`.

### TRX-7 — LOW/MED (XC-1) — Submission `category_id` unvalidated

`training_submission_service.py`'s `create_submission`/`update_submission`
never validated the client-supplied `category_id` against
`TrainingCategory`, unlike `training.py`'s own `create_record`/
`update_record` (the TR-7 fix from the module audit) for the exact same
field on the sibling manual-entry path. Backstopped everywhere it's
currently read (the category-hours breakdown org-scopes its own lookup), so
not a confirmed leak — but `_create_record_from_submission` copies
`category_id` verbatim onto the resulting `TrainingRecord` on approval, so
an unvalidated value here becomes exactly the dangling FK TR-7 closed for
the direct-entry path. **Fix:** `assert_in_org` on both create and update.

### TRX-8 — MEDIUM (XC-1) — Recertification pathway: five unvalidated client FKs

`RecertificationService.create_pathway`/`update_pathway` stored
`source_requirement_id`, `assessment_course_id`, `required_courses`,
`category_hour_requirements[].category_id`, and `prerequisite_pathway_ids`
with **no** org validation — unlike the file's own `InstructorQualification-
Service`/`TrainingEffectivenessService`, both of which have a dedicated
`_validate_references` for exactly this purpose. No field is currently
dereferenced back into a response, so this is a dangling-FK gap today, not
a confirmed leak — but every one of these fields is _named_ for exactly the
kind of display a future feature would naturally add (a renewal task
showing "Source requirement: {name}"), the same reasoning TR-11 used for
the program-import path. **Fix:** added a `_validate_references` matching
the existing sibling pattern, called from both create and update.

### TRX-9 — MEDIUM (XC-1) — Multi-agency exercise: two unvalidated client FKs

`MultiAgencyService.create_exercise`/`update_exercise` stored
`training_session_id`/`training_record_id` (both real DB-level foreign
keys) with no org check. `MultiAgencyTrainingResponse` doesn't currently
join/expose either referenced row's data, so no confirmed leak. **Fix:**
`assert_in_org` (allow_none) on both fields, both create and update.

### TRX-10 — LOW (XC-1) — xAPI ingestion: `source_provider_id` unvalidated

`XAPIService.ingest_statement` stored the client-supplied
`source_provider_id` (a real FK to `ExternalTrainingProvider`) unchecked.
Confirmed nothing anywhere in the codebase reads `XAPIStatement.source_provider_id`
back (write-only), so this was the least-impactful of the batch — included
for the same "close it before something dereferences it" reasoning as
TRX-8/TRX-9. **Fix:** `assert_in_org` (allow_none); the single-statement
endpoint's `except ValueError` handling was also missing entirely (it only
had a catch-all `except Exception → 500`) — added, so the new check
actually surfaces as a 400. The batch-ingestion endpoint needed no change:
`ingest_batch` already catches per-statement exceptions and reports them in
its per-row `errors` array rather than raising.

## Corrections to prior write-ups

- **`docs/KNOWN_LIMITATIONS.md`, "Outbound Integration Requests — DNS-Rebinding
  TOCTOU"**: the SCH-10 finding's "seven call sites, three transports" count
  was itself stale. `ExternalTrainingSyncService.__init__`
  (`external_training_service.py:40`) also hand-builds its own
  `httpx.AsyncClient` rather than going through `create_integration_client`
  — an eighth site sharing the same narrowed-not-closed TOCTOU shape (its
  SSRF re-validation is present and correctly wired; only the client
  construction bypasses the shared factory). Not itself exploitable today
  (this httpx version's defaults already match the factory's `verify=True`/
  `follow_redirects=False`), and not fixed here: the factory's timeout
  (10s) is too short for a real LMS catalog sync, so migrating onto it needs
  a per-call timeout override added to `create_integration_client` first —
  a shared-infrastructure change out of this feature-scoped review's
  bounds, same reasoning SCH-10 already gave for not fixing the other seven
  inline. Corrected the count and added the eighth site's detail.

## Verified good ✅ (re-confirmed, no code change)

- **The wide-blast-radius cohort-generation transaction** (`create_cohort`,
  writing `CourseCohort`/`CourseCohortClass`/`Event`/`TrainingSession`/
  `ProgramEnrollment`/`EventRSVP` in one transaction) — every id feeding it
  traced to source: all are either `assert_in_org`-validated at this file's
  own boundary, or resolved from `CourseClass` rows that were themselves
  validated at their own write time in `course_syllabus_service.py`. No
  missing org check found.
- **The roster-membership-based read** (`GET /cohorts/{id}`) — org-scoped
  (`is_roster_member` filters `organization_id`, so a caller can't claim
  roster membership in a foreign-org cohort), and peer-PII is gated behind
  `include_member_data=is_officer` in one place (`get_cohort_detail`) — a
  non-officer roster member gets an empty member list and `None` counts,
  matching the docstring's stated contract exactly.
- TR-3/TR-6/TR-9 (external-training user/category mapping + enrichment
  scoping), TR-5 (auto-approve credit-routing guard), and the manual
  submission-review self-approval block (`assert_different_person`) — all
  re-verified unchanged and intact.
- The three items TR-6's residual note left "flagged, backstopped, not
  live" (xAPI `source_provider_id` read-side, `bulk_enroll` name lookups,
  `perform_sync_task`'s provider re-fetch) were re-traced individually:
  xAPI and `perform_sync_task` are still genuinely backstopped (confirmed,
  not merely assumed); `bulk_enroll` was **not** backstopped — see TRX-1.
- File-upload MIME/path-containment guards (submissions, enhancements
  attachments), external-provider credential encryption + fail-closed
  decrypt, and SSRF re-validation before every external-training outbound
  call — all re-verified unchanged.

## Flagged, not fixed

Nothing new this iteration beyond the TR-17-carried enum-validation and
`enroll_member`-race items (both already in `docs/KNOWN_LIMITATIONS.md`,
out of this iteration's file scope).

## Schema & migration notes

No schema changes this iteration. No `SET NULL` nullability issues found.

## Guard tests added

- `test_training_extended_fk_scoping.py` — 8 tests (TRX-1, TRX-6, TRX-7,
  TRX-8, TRX-9, TRX-10).
- `test_training_extended_null_handling.py` — 9 tests (TRX-2, TRX-5,
  TRX-5b), unit-testing `apply_updates` against real ORM instances
  (matching `test_facilities_service.py::TestNullabilityGuard`'s precedent
  — a `SimpleNamespace` has no mapper, so `apply_updates`'s NOT-NULL guard
  cannot be exercised against one).
- `test_course_cohort_class_mutation_scoping.py` — 3 tests (TRX-4).
- `test_training_effectiveness_self_scoping.py` — 2 tests (TRX-3).
- `test_training_autoapprove_credit_guard.py` — updated the existing
  `_svc` test helper to mock the new `category_id` org-check (TRX-7 added
  a `db.execute` call this file's mocked session didn't previously need).

## Completion gate

| Check                                                                                                  | Result                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `flake8` (changed files)                                                                               | ✅ 0 violations                                                  |
| `black --check` (changed files)                                                                        | ✅ clean                                                         |
| `isort --check-only` (changed files)                                                                   | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`                                                      | ✅ single head                                                   |
| `pytest tests/ -k "training or cohort or syllabus or waiver or external or enhancement or submission"` | ✅ 979 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)                                                                   | ✅ 8778 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                                                                            | n/a — no frontend file changed this iteration                    |
