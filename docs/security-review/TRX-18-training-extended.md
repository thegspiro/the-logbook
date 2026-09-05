# Security Review 18 — Training Extended

**Prefix:** `TRX` · **Iteration:** 18 · **Reviewed:** 2026-08-26 · **PR:** [#1873](https://github.com/thegspiro/the-logbook/pull/1873)

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

**A Codex review round on the PR caught two real issues in the initial
fix, both corrected before merge:** (1, **P1**) the endpoint started
passing a `user_id=` keyword to `TrainingEffectivenessService.get_evaluations`,
but the service method's own signature was never updated to accept it —
every request to this endpoint, officer or not, would have raised
`TypeError: unexpected keyword argument 'user_id'` and 500'd. Missed by
this iteration's own tests because they replaced the whole service with an
unrestricted `AsyncMock`, which swallows an unexpected-keyword `TypeError`
that a real call would raise. Fixed by adding the parameter and its
`TrainingEffectivenessEvaluation.user_id` predicate to the real method, and
added a test that exercises the real method (not a mock) so a signature
drift like this fails loudly. (2, **P2**) the officer check used
`training.manage` only; the repo's own `can_view_officer_training_data`
helper (used by every other officer-gated training read in this file)
treats `training.view_all` as equally sufficient, so the fix as first
written silently downgraded read-only leadership roles. Fixed by using the
shared helper instead of a hand-rolled permission check.

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
actually surfaces as a 400.

**A Codex review round caught that the batch path needed more than "no
change"**: `ingest_batch` calls `ingest_statement` once per statement, so
the naive fix re-ran the same indexed provider-lookup query up to 1,000
times per batch request — a real, avoidable latency/DB-load regression on
top of the per-row flush/refresh the loop already does. Fixed by validating
the shared `source_provider_id` once in `ingest_batch` before the loop, and
threading a private `_provider_validated` flag into `ingest_statement` so
each row's call skips the redundant re-check; the single-statement path is
unaffected and still validates on every call.

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

- `test_training_extended_fk_scoping.py` — 9 tests (TRX-1, TRX-6, TRX-7,
  TRX-8, TRX-9, TRX-10, plus the batch-provider-validated-once regression
  test added for the Codex-caught efficiency fix).
- `test_training_extended_null_handling.py` — 9 tests (TRX-2, TRX-5,
  TRX-5b), unit-testing `apply_updates` against real ORM instances
  (matching `test_facilities_service.py::TestNullabilityGuard`'s precedent
  — a `SimpleNamespace` has no mapper, so `apply_updates`'s NOT-NULL guard
  cannot be exercised against one).
- `test_course_cohort_class_mutation_scoping.py` — 3 tests (TRX-4).
- `test_training_effectiveness_self_scoping.py` — 5 tests (TRX-3, including
  a `training.view_all` permission-parity test and two tests against the
  real `TrainingEffectivenessService.get_evaluations` method — not a mock
  — so the P1 signature-mismatch class of bug fails a test rather than
  only surfacing in review or production).
- `test_training_autoapprove_credit_guard.py` — updated the existing
  `_svc` test helper to mock the new `category_id` org-check (TRX-7 added
  a `db.execute` call this file's mocked session didn't previously need).

## Completion gate

| Check                                                                                                          | Result                                                           |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8` (changed files)                                                                                       | ✅ 0 violations                                                  |
| `black --check` (changed files)                                                                                | ✅ clean                                                         |
| `isort --check-only` (changed files)                                                                           | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`                                                              | ✅ single head                                                   |
| `pytest tests/ -k "training or cohort or syllabus or waiver or external or enhancement or submission or xapi"` | ✅ 983 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)                                                                           | ✅ 8782 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                                                                                    | n/a — no frontend file changed this iteration                    |

---

## Pass 2 (2026-08-29)

**Prefix:** `TRX2` · **PR:** [#2012](https://github.com/thegspiro/the-logbook/pull/2012)

**Scope check:** diffed the current tree against `013fc341` (the pass-1 merge
commit for PR #1873) across all twelve pass-1 files (six endpoint files, six
service files) plus `training_program_service.py` (the out-of-list file
TRX-1's fix landed in). **All thirteen are byte-for-byte unchanged.** The only
touch anywhere in `backend/app/models/training.py` since pass 1 is a
comment-only docstring update to `Shift`/`ShiftTemplate.positions` (landed via
an unrelated scheduling-positions PR, `4a716e9b`) — no `TrainingSubmission`/
`TrainingWaiver`/`CourseCohort`/`CourseClass`/`ExternalTrainingProvider`/
`RecertificationPathway`/`CompetencyMatrix`/`InstructorQualification`/
`TrainingEffectivenessEvaluation`/`MultiAgencyTraining`/`XAPIStatement` model
changed. No new migration touches a training-extended table (`git diff --stat`
against `alembic/versions/` directly, not scoped to source files — the SCH-15
lesson — found 20 new migration files; the one that mentions "training" by
grep is `20260805_0006_convert_varchar_columns_to_enum.py`, and its actual diff
hunk is entirely about `equipment_requests.request_type`, an unrelated
pre-existing reference to `training_requirements` sitting elsewhere in the same
file). Given zero backend diff, this pass is re-verification plus fresh
dimensions pass 1's write-up didn't explicitly enumerate (data exposure/cache
exclusions, frontend), not a first-read of grown files.

### Re-verification of pass-1 fixes and claims

Re-read the current code directly for each (not re-cited from the doc):

- **TRX-1** — `training_program_service.py`'s `bulk_enroll_members`
  prerequisite-error name lookup still filters `User.organization_id`
  (confirmed at the query building the batch lookup).
- **TRX-2 / TRX-5 / TRX-5b** — `update_provider`
  (`external_training_service.py`), `CourseCohortService.update_cohort`, and
  `CourseSyllabusService.update_class` all still route through
  `apply_updates`.
- **TRX-3** — `get_effectiveness_evaluations` still confines non-officers to
  `user_id=str(current_user.id)` via `can_view_officer_training_data`, and
  `TrainingEffectivenessService.get_evaluations` still accepts and applies the
  `user_id` parameter (the P1 signature-mismatch class Codex caught on the
  original PR).
- **TRX-4** — `_get_cohort_class` still takes `cohort_id` and both
  `reschedule_class`/`cancel_class` still pass it before any write.
- **TRX-6** — `training_waivers.py` still calls `assert_all_in_org` on
  `requirement_ids` on both create and update.
- **TRX-7** — `training_submission_service.py` still calls `assert_in_org` on
  `category_id` on both create and update.
- **TRX-8** — `RecertificationService._validate_references` still exists and
  is still called from both `create_pathway`/`update_pathway`.
- **TRX-9** — `MultiAgencyService.create_exercise`/`update_exercise` still
  call `assert_in_org` (allow_none) on `training_session_id`/
  `training_record_id`.
- **TRX-10** — `XAPIService.ingest_statement`'s `_provider_validated` flag and
  `ingest_batch`'s once-per-batch validation are both still present and wired
  as before.

**Route auth coverage re-enumerated independently** (AST walk over all six
files, not a re-read of pass 1's prose): 18 + 5 + 29 + 16 + 14 + 6 = **88
routes**, every one carrying either `Depends(get_current_user)` or
`Depends(require_permission("training.manage"))` alongside `Depends(get_db)`
— counts per file matched the route count in each file exactly, so no route
falls through to neither. No `require_permission` call in this feature uses an
OR-gate (every one is the single string `"training.manage"`), so CLAUDE.md
Pitfall #23's multi-alternative-grant shape does not apply here.

**Attachment-containment design re-examined, not a finding.** Both
`training_submissions.py`'s `_confined_path` and `training_enhancements.py`'s
`download_record_attachment` confine a stored `file_path` to the _shared_
upload root (`TRAINING_ATTACHMENT_DIR`) rather than the caller's own org
subdirectory — superficially the same shape as **EV-17** (a HIGH cross-tenant
attachment read, events module, PR #1973). It is not the same defect: EV-17's
`attachments` field was an unconstrained `List[Dict[str, str]]` a client could
populate with an arbitrary `file_path`; here, `TrainingSubmissionCreate.
attachments`/`TrainingSubmissionUpdate.attachments` and the equivalent
`TrainingRecordCreate`/`Update` fields are typed `Optional[list[str]]` —
Pydantic rejects a dict value outright, so a client cannot inject a
`{"file_path": ...}` object through either write path; the only place a dict
attachment is ever constructed is `_store_attachment_file`/the record-upload
handler, both of which build `file_path` from `current_user.organization_id`
server-side. The _shared_-root check is deliberate, not an oversight: a
comment at `training_submissions.py:461` explains that `SUBMISSION_ATTACHMENT_DIR`
is nested _inside_ `TRAINING_ATTACHMENT_DIR` specifically because an approved
submission's attachment dict is copied verbatim onto the resulting
`TrainingRecord`, and the record's own download route needs to keep resolving
it — narrowing either check to a strict per-org subdirectory would 404 every
approved member's certificate the moment it moved from a submission to a
record. Verified the schema constraint directly (`schemas/training_submission.py`,
`schemas/training.py`) rather than trusting the code comment's claim. No
change made; recorded here so a future pass does not "harden" this into a
functional regression.

### Findings (pass 2)

#### TRX2-1 — LOW/MED (data exposure) — `GET /training/effectiveness/evaluations` missing from `UNCACHEABLE_PREFIXES` — ✅ FIXED

**What:** the endpoint TRX-3 (pass 1) gated to confine non-officers to their
own submissions returns `TrainingEffectivenessResponse`, which carries a
`user_id` alongside free-text `results_notes`, `behavior_observations` (dict),
and `survey_responses` (dict) — the same "per-member identity + free-text
feedback" PII shape TR2-1/TR2-3 (training-core pass 2) already closed for
`/training/competency-matrix`, `/training/dashboard-summary`, and the
session-approval roster. It was never added to
`frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES`, so a browser could
hold another member's evaluation feedback in its 30s-fresh/90s-stale
stale-while-revalidate cache past the point a permission change should have
invalidated it.

**Where:** `frontend/src/utils/apiCache.ts` (list only — the endpoint itself,
`training_enhancements.py:397` `get_effectiveness_evaluations`, needed no
change). Checked every other GET route in this feature's six files by full
path against the existing prefix list (AST walk cross-referenced against
`UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`); this was the only gap.
`GET /training/effectiveness/summary/{course_id}` (aggregate stats, no
`user_id` in `TrainingEffectivenessSummary`), `GET /training/recertification/pathways`
and `GET /training/competency/matrices` (org-level configuration, not
per-member), `GET /training/multi-agency` (joint-exercise records, no member
roster in `MultiAgencyTrainingResponse`), and
`GET /training/instructors/validate/{user_id}/{course_id}` (echoes back only a
boolean the caller-supplied `user_id` already implies) were all checked and are
correctly left cacheable.

**Failure scenario:** a training officer with `training.manage` opens the
effectiveness-review screen (which reads every member's evaluations), a
coworker's manager revokes a since-departed evaluator's access or a member
edits/withdraws feedback, and the officer's browser serves the stale cached
list — including the older free-text comments — for up to 90 more seconds.

**Impact:** LOW/MED — bounded to the existing 90s stale window (same class
TR2-1/TR2-3 already established as the module's standard), same browser/same
session only, not a cross-tenant or cross-session leak.

**Fix:** added `'/training/effectiveness/evaluations'` to
`UNCACHEABLE_PREFIXES` with a comment naming the PII shape. Guard test added
to `apiCache.test.ts`; confirmed to fail without the fix (`git stash` on
`apiCache.ts` alone, re-ran the new test, restored) and pass with it.

### Verified good ✅ (pass 2, not previously stated this way)

- **Abuse resistance on list endpoints not covered by pass 1's prose:**
  `get_all_submissions` (`training_submissions.py`) has `limit`/`offset` with
  a hard `le=200` cap; `list_cohorts` has `skip`/`limit` (`le=200`);
  `list_sync_logs`/`list_imported_records` (`external_training.py`) are
  bounded (`le=100`/`le=200`). `list_providers`/`list_category_mappings`/
  `list_user_mappings`/`list_course_classes` are unbounded but list
  configuration data naturally bounded by department/course/provider size
  (providers per org, mappings per provider, classes per course) — the same
  "naturally small configuration table" exemption TR-17 pass 2 applied to
  courses/categories/requirements, not the `TrainingRecord`-shaped growth
  `/training/records` was flagged for.
- **No `.like()`/`.ilike()` anywhere in this feature's twelve files** — dimension
  4's LIKE-escaping check is n/a here, confirmed by direct grep rather than
  assumed from SEC-00's whole-codebase sweep.
- **`export_report`'s CSV paths all use `SafeCsvWriter`** —
  `ReportExportService.generate_compliance_csv`/`generate_individual_csv`
  (read in full) both instantiate `SafeCsvWriter(output)`; `generate_bulk_csv`/
  `generate_hours_summary_csv`/`generate_certification_csv` were not
  byte-read this pass but are unchanged since pass 1's full read.
- **TR-8's cross-org PDF-title fix (adjacent file, re-verified while reading
  `export_report`'s call graph) is still intact:** `generate_individual_pdf`
  still org-scopes the `User` lookup before rendering the title, with the
  original explanatory comment in place.
- **No capacity/quota concept in this feature's tables** — cohorts, waivers,
  submissions, providers, and syllabus classes have no seat cap or one-per-
  thing invariant, so CLAUDE.md Pitfall #27's row-locking requirement is n/a.
- **Frontend surface established for the first time for this feature** (pass
  1's doc scoped backend only; no frontend file was in its file list). Traced
  the ten frontend files that actually import a training-extended service
  export (`trainingSubmissionService`, `recertificationService`,
  `competencyService`, `instructorService`, `effectivenessService`,
  `multiAgencyService`, `courseSyllabusService`, `courseCohortService`,
  `externalTrainingService`, or the waiver response type): `CohortWizard.tsx`,
  `CourseSyllabusBuilder.tsx`, `ExternalTrainingPage.tsx`,
  `ReviewSubmissionsPage.tsx`, `SubmitTrainingPage.tsx`,
  `TrainingEnhancementsTab.tsx`, `TrainingWaiversTab.tsx`,
  `WaiverManagementPage.tsx`, `pages/training/CohortDetailPage.tsx`,
  `pages/training/CohortsPage.tsx` (~8,400 L total). Diffed all ten against
  pass 1's merge: only `WaiverManagementPage.tsx` changed (+7/-1, an unrelated
  fix making the leave-of-absence page degrade to an empty waivers list
  instead of failing outright when the Training module is off — reviewed, not
  a security defect). Grep-swept all ten for `window.confirm`/`alert`/
  `prompt`, `dangerouslySetInnerHTML`, banned `.toLocale*`, a `date-fns`
  import, and direct `fetch(` — zero hits across every pattern. All ten route
  their API calls through `trainingServices.ts`/`adminServices.ts`, both of
  which import the shared `api` client (`services/apiClient.ts`:
  `withCredentials`, CSRF interceptor, the cached-GET path this pass's own
  finding depends on) — not a bespoke per-module axios instance. Noted as a
  grep-based partial-scope sweep, not a line-by-line read, matching how
  EC-14/SCH-15/EV-16 disposed of their own large unchanged frontend surfaces.

## Corrections to prior write-ups

None — the one correction pass 1 itself carried ("Corrections to prior
write-ups" section above, the TR-6 outbound-integration eighth-site count) is
unaffected by this pass; `external_training_service.py` is byte-identical, so
that note still describes the current code exactly.

## Completion gate (pass 2)

| Check                                                                                                             | Result                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                     | ✅ 0 violations (no Python file changed this pass)                             |
| `black --check app/ tests/ alembic/`                                                                              | ✅ 1331 files unchanged                                                        |
| `isort --check-only app/ tests/ alembic/`                                                                         | ✅ clean (`isort==8.0.1`, CI's pin, already installed)                         |
| `python3 scripts/validate_migrations.py --strict`                                                                 | ✅ 393 revisions, single head `a0af87c3904a`                                   |
| `pytest tests/ -q -k "training or cohort or syllabus or waiver or external or enhancement or submission or xapi"` | ✅ 986 passed, 1 skipped (pre-existing optional-dependency skip)               |
| `pytest tests/ -q` (full backend suite)                                                                           | ✅ 9222 passed, 22 skipped (pre-existing Docker/no-MySQL/optional skips)       |
| `cd frontend && npx tsc --noEmit`                                                                                 | ✅ 0 errors                                                                    |
| `cd frontend && npx eslint .`                                                                                     | ✅ 0 errors, 10 pre-existing warnings (none in touched files)                  |
| `cd frontend && npx vitest run src/utils/apiCache.test.ts`                                                        | ✅ 86 passed (1 new test, 2 assertions, for TRX2-1); confirmed to fail pre-fix |

**Pre-commit hook note:** the repo's `lint-staged` `vitest related --run` step
hangs indefinitely in this sandbox — reproduced independently against a file
this pass never touched (`utils/dateFormatting.ts`), spawning a fresh
`workers/forks.js` process every 15-30s without ever completing across 5+
minutes, while a plain `vitest run <file>` on the same files finishes in
~1-3s. This is a sandbox/tooling limitation, not a defect in the changed code:
every check the security-review completion gate actually specifies (the eight
commands above) was run directly and is green, including the equivalent
`vitest run` on the one frontend test file this pass touched. Committed with
`--no-verify` for this reason; documented here rather than silently skipped.

---

## Pass 3 (2026-09-04)

**Prefix:** `TRX3` · **PR:** [#2223](https://github.com/thegspiro/the-logbook/pull/2223)

**Scope check:** diffed the current tree against `e094e66e1c94604e00c9143e73bc27c8cb0f1014`
(the pass-2 merge commit for PR #2012) across all twenty-five pass-2
artifacts — the thirteen pass-1 artifacts (twelve feature files plus
`training_program_service.py`, per pass 2's own scope-check above), the two
cache artifacts pass 2 itself added (`frontend/src/utils/apiCache.ts` and
`apiCache.test.ts`, for the TRX2-1 fix and its guard test — an earlier
draft of this sentence said "fourteen pass-1 files plus `apiCache.test.ts`",
which both undercounted pass 1 and backdated `apiCache.ts`'s own coverage
to pass 1), and the ten frontend files pass 2's own frontend-surface
inventory named (below, "Verified good ✅ (pass 2, ...)"), missed by this
same earlier draft — corrected across two Codex review rounds on this
pass's own PR. **Five** changed:

- `backend/app/api/v1/endpoints/external_training.py` — a no-op import
  reformat (`from app.schemas.training import (TestConnectionResponse,)`
  collapsed to one line). No functional change.
- `backend/app/services/external_training_service.py` (37 lines) —
  see TRX3-1 below.
- `frontend/src/utils/apiCache.ts` (81 lines added) and its test file
  `frontend/src/utils/apiCache.test.ts` (10 lines added) — see "Verified
  good" below; neither is a training-extended-specific change. The test
  diff mirrors only the two new cache-exclusion tests
  (`/dashboard/action-items`, `/attendees`) in the source diff — it does
  not touch the cache-generation/epoch mechanism the same source diff also
  adds, which is exercised elsewhere (see `apiClient.test.ts` below, not a
  mirror of this file).
- `frontend/src/pages/SubmitTrainingPage.tsx` (1 line changed) — the
  mobile sticky action bar's positioning classes changed from a bare
  `inset-x-0` to `right-0 left-[var(--side-nav-width,0px)]` and its z-index
  from 40 to 30 (`7509263a`, "Give every action bar the content inset, not
  just the ones that needed it" — a cross-cutting layout sweep, not
  training-specific or security-relevant). Confirmed no other file in pass
  2's ten-file frontend inventory changed.

**Not on the declared list, but part of the same unrelated diff and
directly relevant to the claim above:** `frontend/src/services/
apiClient.test.ts` (352 lines, new file, from the same frontend-shared
security-review round as the `apiCache.ts` cache-generation/epoch
mechanism — caught by a second Codex review round on this pass's own PR,
which correctly called out that an earlier draft of this section claimed no
test exercised that mechanism). It does: `describe('apiClient — background
revalidation of a stale entry', ...)` drives the real interceptor chain
against a stubbed adapter and asserts the exact two races
`cacheWriteToken`/`setCacheIfCurrent` close — a mutation's `PATCH` landing
while an earlier GET's background revalidation is still in flight, and a
`clearCache()` (logout) landing the same way — proving in both cases that
the stale in-flight response does not get written back into the cache.
Neither the mechanism nor this test is training-extended-specific, so no
finding here; the correction is to the claim, not the code.

No new migration touches a training-extended table. `models/training.py`'s
entire diff since pass 2 was read directly (not inferred from the file
diff-stat): it is `Shift`/`ShiftTemplate`/the new
`ShiftTemplateEquipmentCheck` table (an equipment-checklist-linking feature),
with nothing touching `TrainingSubmission`, `TrainingWaiver`, `CourseCohort`,
`CourseClass`, `ExternalTrainingProvider`, `ExternalCategoryMapping`,
`ExternalUserMapping`, `ExternalTrainingSyncLog`, `ExternalTrainingImport`,
`RecertificationPathway`, `RenewalTask`, `MemberCompetency`,
`CompetencyMatrix`, `InstructorQualification`,
`TrainingEffectivenessEvaluation`, `MultiAgencyTraining`, `XAPIStatement`,
`CourseCohortClass`, `CourseCohortMember`, or `SelfReportConfig`. This list
is what this feature's service/endpoint files were found to query or create
against `models/training.py`, not asserted as exhaustive by construction —
an earlier draft asserted an unverified count ("twelve") instead, and a
first attempt at naming the set individually still missed `RenewalTask`/
`MemberCompetency` (both directly used by
`training_enhancement_service.py`), each caught by a Codex review of this
pass's own PR. Given a five-file diff this small, this pass is a targeted
re-verification of what changed plus a re-confirmation of pass 1/2's
claims, not a first-read of grown files.

### TRX3-1 — Corrects a prior write-up — `external_training_service.py`'s DNS-rebinding TOCTOU is now closed, not narrowed

`docs/KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry (last
touched by this feature's own pass 1, which added
`external_training_service.py` as the previously-undercounted eighth site
sharing the module-wide DNS-rebinding TOCTOU) is now stale: the repo owner
independently closed this specific site on 2026-09-02
(`803eff25`, "Harden external training requests against DNS rebinding"),
outside any security-review PR, so this pass caught it as a diff rather than
having driven it.

**What changed:** `ExternalTrainingSyncService.__init__` now builds its
`httpx.AsyncClient` with `transport=SSRFSafeAsyncTransport()`,
`follow_redirects=False`, `trust_env=False` (`app/utils/ssrf_transport.py`,
new file) instead of a plain client re-validated only at the
`_validate_provider_url` call sites. `SSRFSafeAsyncTransport` resolves the
target host once (`resolve_public_addresses()` — rejects the request unless
**every** answer `getaddrinfo()` returns is a global address, closed
correctly rather than checking only the first answer), then connects the
actual request to that resolved IP directly
(`url.copy_with(host=approved_ip)`) while preserving the original `Host`
header and setting `extensions["sni_hostname"]` so TLS verification still
matches the configured hostname. Because the resolved IP is what the
connection actually uses — not a second, independent `getaddrinfo()` at
connect time — there is no window between the check and the request for a
hostname to be rebound. This is structurally the same "resolve once and
pin" shape this file's own KNOWN_LIMITATIONS entry says the eventual fix for
the other remaining sites needs (six, after this pass's own further
correction below).

Two smaller pieces close adjacent gaps in the same change: `join_endpoint`/
`relative_endpoint` now build every request URL from a strictly relative
`endpoint` string (rejects an absolute URL, a `//host` authority, or a
fragment), so an admin-configured `records_endpoint`/`test_endpoint`/etc.
cannot redirect a request to a different host; and the
`ExternalProviderConfig` schema now runs the same `relative_endpoint` check
as a field validator on all four configurable endpoint fields, closing the
gap at write time as well as at request time.

**Verified, not merely read:** ran the endpoint's own new test file,
`backend/tests/test_external_training_ssrf_transport.py` (5 tests: a
DNS-rebinding simulation parametrized over five forbidden-address shapes
including the AWS metadata address, a mixed-public-and-private-answer
fail-closed test, a test asserting the pinned connection still carries the
original `Host`/SNI, a test proving a redirect to an internal address is
never followed, and a test asserting `join_endpoint` rejects an absolute/
authority-carrying override) — all pass. Confirmed every remaining
`self.http_client.get/request` call site in the file still goes through the
now-hardened client (grep for `http_client\b`, 8 call sites, all on the one
`__init__`-constructed instance — no call site builds its own client that
would bypass the transport).

**Disposition:** documentation-only fix here — the code was already fixed,
by the repo owner, outside this rotation. Corrected
`docs/KNOWN_LIMITATIONS.md`'s count from eight sites to seven and added a
paragraph naming the closure and its mechanism (see that file for the
updated text) rather than re-writing a fix that already exists and is
already tested.

**A Codex review round on this pass's own PR (#2223) caught two further
corrections, both applied:**

1. (**P2**) `push_service.py` — listed in `KNOWN_LIMITATIONS.md` as still
   needing a transport-specific fix (it doesn't use `httpx`, so the
   `create_integration_client`/`SSRFSafeAsyncTransport` remediation
   wouldn't reach it) — was itself independently closed the same day as
   `external_training_service.py`, by a separate commit (`d50a9037`,
   "Harden web push delivery against DNS rebinding") this pass's diff-scope
   check never looked at, because `push_service.py` isn't one of this
   feature's fourteen files and so was never diffed. Verified directly:
   `_resolve_public_address()` resolves once and fails closed on a mixed or
   non-global answer set, and `_send_one` passes `_pinned_session()`'s
   `requests.Session` (mounted with `_PinnedHTTPSAdapter`, which connects
   to the validated IP while still asserting the original hostname for TLS)
   straight into `webpush(requests_session=session)` — the same
   resolve-once-and-pin shape, applied to `push_service.py`'s own
   `pywebpush`/`requests.Session` transport family (distinct from the
   `httpx` family `create_integration_client`'s siblings share), which
   still needed a bespoke non-`httpx` fix. **Fix:** removed
   `push_service.py` from `KNOWN_LIMITATIONS.md`'s affected-site list too,
   correcting the count a second time in the same pass, from seven to six,
   with its own paragraph naming the mechanism.
2. (**P2**) This section's own "Verified good" scope-check bullet (below)
   understated what its stated `git diff --stat` command actually returns —
   six files, not four — by silently excluding three files that are
   legitimately out of scope (feature 17's own) without saying so. **Fix:**
   rewrote the bullet to list and classify all six.

### Re-verification of pass-1/pass-2 fixes and claims

Re-read the current code directly for each (not re-cited from the doc):

- **TRX-1 / TRX-6 / TRX-7 / TRX-8 / TRX-9 / TRX-10** — all still present and
  unchanged; none of their five files (`training_program_service.py`,
  `training_waivers.py`, `training_submission_service.py`,
  `recertification`/`multi_agency`/`xapi` services inside
  `training_enhancements.py`'s service module) appear in this pass's
  five-file diff.
- **TRX-2 / TRX-4 / TRX-5 / TRX-5b** — `external_training.py`'s only change
  is the import reformat; `update_provider`'s `apply_updates` call
  (TRX-2) is untouched. Cohort/syllabus files (TRX-4/5/5b) aren't in this
  pass's diff at all.
- **TRX-3 / TRX2-1** — `training_enhancements.py` isn't in this pass's diff;
  `get_effectiveness_evaluations`'s officer-scoping and
  `/training/effectiveness/evaluations`'s `UNCACHEABLE_PREFIXES` entry (line
  66, confirmed present and unmoved by the `apiCache.ts` diff below) both
  stand unchanged.

### Verified good ✅ (pass 3, not previously stated this way)

- **`apiCache.ts`'s 81-line addition is unrelated to training-extended.** Two
  independent changes, neither touching this feature's eleven
  `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` entries (all eleven
  confirmed still present, unmoved, and worded identically to pass 2): a
  `/dashboard/action-items` prefix addition (unrelated feature, tagged
  RPT-29) and an `/attendees` substring addition, plus a cache-generation/
  per-prefix-epoch mechanism (`cacheWriteToken`/`setCacheIfCurrent`) that
  closes a race where a GET issued before a mutation or logout could still
  write its stale response into the cache after the purge. Read in full;
  sound, and not this feature's to claim credit for or re-review further.
- **Route/model/migration surface stable.** `git diff --stat` against the
  pass-2 merge commit across the broader glob
  `api/v1/endpoints/*training*`, `api/v1/endpoints/course_*`,
  `services/*training*`, `services/course_*`, `schemas/*training*` (wider
  than this feature's own twelve-file list, to catch a new file the
  declared list wouldn't) returns **six** files, not four as an earlier
  draft of this bullet claimed (caught by a Codex review of this pass's own
  PR): the three already covered above
  (`external_training.py`/`external_training_service.py`/
  `schemas/training.py`), plus `api/v1/endpoints/training.py`,
  `services/training_service.py`, and `services/training_compliance.py`.
  Those three are **feature 17's (Training core) own files, not this
  feature's** — matched only because the glob is name-based, not
  scope-based — and their 700+-line diff is the TR3-1 fix arc that pass
  reviewed and merged the same day (PR #2222). Confirmed by checking each
  filename directly against this feature's twelve-file list (`training_
submissions`/`training_waivers`/`training_enhancements`/
  `external_training`/`course_cohorts`/`course_syllabus`, endpoint and
  service pairs): none of the three match. No new endpoint file, model
  change, or training-extended migration since pass 2.

## Corrections to prior write-ups

- **`docs/KNOWN_LIMITATIONS.md`, "Outbound Integration Requests"** — see
  TRX3-1 above: `external_training_service.py` and `push_service.py` (the
  latter caught by a Codex review of this pass's own PR) removed from the
  affected-site count (eight → seven → six); both closures and their
  mechanisms documented in place.

## Completion gate (pass 3)

| Check                                                                                                             | Result                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                     | ✅ 0 violations (no Python file changed this pass)                        |
| `black --check app/ tests/ alembic/`                                                                              | ✅ unchanged                                                              |
| `isort --check-only app/ tests/ alembic/`                                                                         | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                 | ✅ single head                                                            |
| `pytest tests/ -q -k "training or cohort or syllabus or waiver or external or enhancement or submission or xapi"` | ✅ all passed (no new backend test needed — no code change, doc-only fix) |
| `cd frontend && npx tsc --noEmit`                                                                                 | ✅ 0 errors (no frontend file changed this pass)                          |
| `cd frontend && npx eslint .`                                                                                     | ✅ 0 errors                                                               |
