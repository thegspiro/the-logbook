# Workflow Review — W26 A Training Program: Build It, Enroll a Member, the Member's Progress

**Driven:** 2026-09-29 · **As:** `training_officer`, `member`, with `member` and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `0a5ba28a1` plus this run's changes · **Database:** continued from W25

---

## What was driven

1. As `training_officer`, from Training → Programs → New Pipeline (the wizard
   at Training Administration → Setup → Pipelines):
   - "Driver Candidate Program", DRV-1, target Driver Candidate, "One list", a 180-day limit;
   - Requirements: Link Existing → "Annual Hazmat Hours" (the department requirement from W25), then New Requirement "Supervised Driving Hours", 20 hours;
   - Milestones skipped; Review; Create Pipeline, double-clicked.
2. On the program: Enroll → picked Jordan Avery (`member`) → "Enroll 1 Member",
   double-clicked.
3. As `member` at 390×844: My Training → Pipeline Progress → "View full progress".
4. As `member`:
   - `PATCH /training/programs/progress/{id}` on their own "Supervised Driving Hours", with `status: completed`.
5. As `member2`:
   - `member`'s enrollment progress and a `PATCH` on its progress;
   - `POST /training/programs/enrollments` and `PATCH` on the program;
   - the program page.

## Held up ✅

- **Creating and enrolling:**
  - A double-clicked Create Pipeline made **one** program with both requirements.
  - A double-clicked Enroll made **one** enrollment, with a target date 180 days out.
- **Self-certification is refused:**
  - `member` cannot set their own progress. The reply is "Only a training officer can set requirement progress. Submit your training for review instead." (400), and nothing changed.
- **Other members are refused:**
  - `member2` got 403 reading `member`'s enrollment, editing its progress, enrolling anyone and editing the program.
- **The member's full view:**
  - "My Progress" fits 390px.
  - It lists each requirement with its target ("0 / 20 hrs") and the days left.

## Findings

### W26-1 — MED — A linked requirement starts at zero, contradicting the department's own figure — ✅ FIXED (2026-10-06)

**Did:**

- `training_officer` linked "Annual Hazmat Hours" (6 h a year) into the program and enrolled `member`.
- `member` had an approved 4-hour Hazmat refresher from W24.

**Saw:**

- The wizard promises: "The program then reads the same records the department does, so a member who already holds it starts out credited."
- The enrollment's progress for that requirement was 0.
- `member`'s My Training shows both on one screen:
  - "Annual Hazmat Hours 4/6 hrs" under Training Requirements;
  - "Annual Hazmat Hours · 0%, not started" under Pipeline Progress.
- "My Progress" reads "0 / 6 hrs".
- `GET /training/requirements/progress/{user}` answers 4 of 6 (66.67%).

**Why:** `enroll_member` creates every requirement's progress row at
`NOT_STARTED` / 0. Nothing credits records that predate the enrollment, and
program progress is a separate tally from the compliance calculation
(CLAUDE.md pitfall 29).
**Where:**

- `backend/app/services/training_program_service.py:2210`;
- the promise at `frontend/src/pages/CreatePipelinePage.tsx:617`.

**Not fixed because:** it needs product decisions:

- whether a linked requirement should read the compliance result or seed from existing records at enrollment;
- which records and window count;
- what happens to enrollments already made.

Changing the sentence alone would hide the gap rather than close it.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Fixed (2026-10-06).** The owner chose to read the compliance result live,
not to seed at enrollment. A linked requirement's progress row is now a
projection of `evaluate_member_requirement_detail` — the compliance matrix's
grader, with the member's records, shifts worked, waivers and catch-up —
written by `TrainingProgramService.refresh_linked_progress` whenever program
progress is shown, so "Annual Hazmat Hours" reads 4 of 6 under Training
Requirements and under Pipeline Progress. Enrollments already made read live
from their next view; completed, withdrawn, failed and expired enrollments
keep what they finished with. Feeds accrue nothing on a linked row, and an
officer may only waive it for the program. The wizard's sentence now says
that. Covered by
`tests/test_program_linked_requirement_reads_compliance.py`.

### W26-2 — LOW — The member's pipeline card named neither the program nor its requirements — ✅ FIXED

**Did:** `member` at 390×844, My Training → Pipeline Progress.
**Saw:** "active · 0% · Enrolled … · 0% not started · 0% not started". There
was no program name and no requirement names, so a member in two programs
saw two anonymous bars.
**Where:** `frontend/src/pages/MyTrainingPage.tsx:965`, `:997`, and
`backend/app/api/v1/endpoints/training_module_config.py:412`.
**Fix:**

- The summary endpoint now returns `program_name` per enrollment. It is an additive field, fetched in one query.
- The card shows it as a heading and prefixes each row with the `requirement_name` the API already sent.

Covered by:

- `test_pipeline_progress_names_the_program_and_its_requirements` (integration, fails with a `KeyError` against the old endpoint);
- a new case in `MyTrainingPage.test.tsx`.

Re-driven: "Driver Candidate Program", "Supervised Driving Hours · 0%".

### W26-3 — LOW — The program page sent a member two refused requests and offered Duplicate — ✅ FIXED

**Did:** `member2` opened the program.
**Saw:**

- `GET …/programs/{id}/enrollments` fired twice, and both returned **403**.
- The page read the 403 as an empty list, so an Enrollments tab and an "Enrolled 0" count described a program with a member in it.
- It offered Duplicate, which requires `training.manage`.

**Where:** `frontend/src/pages/PipelineDetailPage.tsx:1245`.
**Fix:** the enrollment fetch, the Enrolled count and the Enrollments tab now
follow `training.view_all` or `training.manage`, the endpoint's own gate.
Duplicate follows `training.manage`. Covered by a new case in
`PipelineDetailPage.test.tsx` (fails against the old page). Re-driven:
`member2` sees no officer controls and `events` is clean.

### W26-4 — LOW — The wizard's New Requirement fields had no accessible names, and the review showed a raw slug — ✅ FIXED

**Did:** `training_officer`, New Requirement, then Review.
**Saw:**

- Requirement Name, Type, Description and Required Hours were named only by placeholders, as were the phase fields and the milestone fields.
- The milestone's remove button had no name.
- The review read "driver_candidate".

**Where:** `frontend/src/pages/CreatePipelinePage.tsx:703` and the fields
around it; `:103`.
**Fix:**

- Every label is tied to its control by an id keyed to its row.
- The remove button is named.
- The target positions are one list, which feeds both the select and the review's label.

Covered by a new case in `CreatePipelinePage.test.tsx`. Re-driven: every
field found by its label.

### W26-5 — NIT — The enroll picker's rows did not say which were selected — ✅ FIXED

**Where:** `frontend/src/pages/PipelineDetailPage.tsx:544`. A selected row only
changed its tint. It now carries `aria-pressed`, asserted in the updated
"enrolls the selected eligible member" test.

## Checklist

| Section                 | Result                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ build, enroll, member sees the program; ⚠ W26-1 progress misses credit |
| 2. The right people     | ✅ self-certification and other-member access refused; fixed W26-3        |
| 3. Wrong input, failure | ✅ double create and double enroll made one each                          |
| 4. Browser signals      | Fixed W26-3 (two 403s per visit)                                          |
| 5. Coming back to it    | ✅ enrollment and progress survive reload                                 |
| 6. On a phone           | ✅ My Training and My Progress at 390×844                                 |
| 7. Everyone can use it  | Fixed W26-4, W26-5                                                        |
| 8. What happens around  | Flagged W26-1; fixed W26-2                                                |

## Completion gate

| Check                    | Result                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                 |
| npm run lint             | clean                                                                                                                 |
| flake8 (changed files)   | clean                                                                                                                 |
| black --check / isort    | clean                                                                                                                 |
| frontend tests (touched) | `PipelineDetailPage`, `CreatePipelinePage`, `MyTrainingPage`, `TrainingProgramsPage`, `TrainingAdminPage` — 96 passed |
| backend tests (touched)  | `test_training_member_visibility.py` — 20 passed; the new case is marked `integration`                                |
