# Workflow Review — W25 Courses and Requirements

**Driven:** 2026-09-29 · **As:** `training_officer`, with `member` refused · **Viewports:** 1280×900
**Commit:** `c784ffd07` plus this run's changes · **Database:** continued from W24

---

## What was driven

1. As `training_officer`, `/training/courses` (which sends an officer to
   Training Administration → Setup → Course Library), then Add Course:
   - pressed Create Course with the form empty;
   - then created "Hazmat Operations", HMO-1, Certification, 24 hours, 24 credit hours, instructor Capt. Lee, expiring after 24 months, with a double-click.
2. Edit on that course: cleared Instructor and Expires After, then pressed
   Update Course and reloaded.
3. The course's trash button, then the confirmation.
4. `/training/requirements` (Setup → Requirements), then Create Requirement:
   - "Annual Hazmat Hours" with Required Hours left empty;
   - then 8 hours, Refresher, annual, with a double-click.
5. Deleted the duplicate that step 4 made, then created "Quarterly SCBA Drill
   Hours" (2 hours, quarterly) with a double-click.
6. Edit on "Annual Hazmat Hours": added a description and saved; then cleared
   it and changed the hours to 6.
7. Deactivate on a requirement.
8. As `member`:
   - `POST /training/courses`, `POST /training/requirements`, `DELETE` on a requirement;
   - `/training/courses`;
   - `/training/requirements`.

Not driven at 390×844: this is an officer's setup screen. The phone check for
Training Administration was part of W24's review queue.

## Held up ✅

- **Courses:**
  - An empty course name was refused by the browser ("Please fill out this field").
  - A double-clicked Create Course made **one** course, with every value stored.
- **Requirements:**
  - Required Hours left empty sent nothing, and the modal's own check explained why.
  - Clearing a requirement's description saved `null`, and its hours changed from 8 to 6.
  - Deactivate kept the requirement on the list with an Activate action.
  - Delete asked first ("Permanently delete this requirement? This cannot be undone.") and removed only the one.
- **Refusals:**
  - `member` got 403 creating a course, creating a requirement and deleting one.
  - `/training/courses` gave `member` a read-only library with no Add, Edit or Deactivate.
  - `/training/requirements` rendered Access Denied.

## Findings

### W25-1 — MED — A double-clicked Create Requirement made two requirements — ✅ FIXED

**Did:** `training_officer`, Create Requirement, filled, double-clicked the button.
**Saw:** two identical "Annual Hazmat Hours" rows. Both counted against every
member, so each member owed the hours twice until an officer noticed the
duplicate and deleted it.
**Why:**

- `RequirementModal` set `saving` around a call to `onSave`, which returned before the request did.
- So the button re-enabled at once, and the second click saved again.

**Where:** `frontend/src/components/training/RequirementModal.tsx:148`, `:204`.
**Fix:**

- `onSave` returns its promise, and the modal awaits it.
- A ref refuses a second submit while one is in flight.
- Both callers (`TrainingRequirementsPage`, `TrainingProgramsPage`) pass their async handler straight through.

Covered by the new `RequirementModal.test.tsx` (two saves against the old
modal). Re-driven: a double-click made one.

### W25-2 — LOW — Clearing a course's optional fields did not save — ✅ FIXED

**Did:** `training_officer`, Edit on a course, emptied Instructor and Expires
After, and pressed Update Course.
**Saw:** "Course updated successfully". After a reload both values were back,
and the API still returned `Capt. Lee` / `24`.
**Why:** the form omitted every blank optional field, and on an update an
omitted key means "leave it alone" (CLAUDE.md pitfall 1). Only
`grants_qualification` had been converted.
**Where:** `frontend/src/pages/CourseLibraryPage.tsx:106`.
**Fix:**

- Code, description, hours, credit hours, instructor, participants and expiry go through `formCoercions(isEdit)`: `null` on an edit, omitted on a create.
- Categories and materials send an empty list on an edit.
- `TrainingCourseUpdate` accepts `null` for those fields; every column is nullable.

Covered by a new case in `CourseLibraryPage.test.tsx` (fails against the old
page). Re-driven: both read `null`.

### W25-3 — LOW — The course form's fields had no accessible names — ✅ FIXED

**Did:** `training_officer`, Add Course.
**Saw:**

- Nine of the eleven controls were named only by a placeholder.
- Training Type had no name at all.
- The two filter selects on the library had none either.
- The category chips were buttons with no pressed state, so a screen reader could not tell which categories were chosen.

**Where:** `frontend/src/pages/CourseLibraryPage.tsx:190` and the fields after it.
**Fix:**

- Each label has `htmlFor` and its control an `id`.
- The chips are a group named "Training Categories", with `aria-pressed`.

Covered by a new case in `CourseLibraryPage.test.tsx`. Re-driven: every field
found by its label.

### W25-4 — LOW — A deactivated course cannot be brought back — FLAGGED

**Did:** `training_officer`, the course's trash button, then Deactivate.
**Saw:**

- The dialog was accurate ("It will no longer be available for new training records").
- But the course left the library, which reads "(0 courses)".
- The library loads active courses only (`getCourses()`), so its "Inactive" badge can never render.
- Nothing offers Reactivate, and there is no delete, so a course deactivated by mistake can be restored only through the API.

**Where:** `frontend/src/pages/CourseLibraryPage.tsx:496`.
**Not fixed because:** whether inactive courses are listed, and whether
reactivating one is an officer's action, is a product decision. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### W25-5 — NIT — Action buttons named the wrong action, or no row — ✅ FIXED

**Saw:**

- The course's trash button was announced "Delete Hazmat Operations" although it deactivates.
- Every requirement's buttons were "Edit requirement", "Delete requirement" and "Deactivate requirement" on every row.

**Where:** `frontend/src/pages/CourseLibraryPage.tsx:744`,
`frontend/src/pages/TrainingRequirementsPage.tsx:597`.
**Fix:** "Deactivate Hazmat Operations"; "Edit / Delete / Deactivate
<requirement name>". Covered by the updated `CourseLibraryPage.test.tsx` and a
new case in `TrainingRequirementsPage.test.tsx`.

## Checklist

| Section                 | Result                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 1. The job gets done    | ✅ create, edit, deactivate, delete for both                        |
| 2. The right people     | ✅ `member` 403 on every write; read-only library; Access Denied    |
| 3. Wrong input, failure | Fixed W25-1 (double submit), W25-2 (clearing); empty fields refused |
| 4. Browser signals      | ✅ clean `events` throughout                                        |
| 5. Coming back to it    | Flagged W25-4 — a deactivated course cannot be restored             |
| 6. On a phone           | n/a — officer setup; see W24                                        |
| 7. Everyone can use it  | Fixed W25-3, W25-5                                                  |
| 8. What happens around  | ✅ a duplicate no longer doubles members' owed hours                |

## Completion gate

| Check                    | Result                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                          |
| npm run lint             | clean                                                                                                                                          |
| flake8 (changed files)   | no Python changed                                                                                                                              |
| black --check            | no Python changed                                                                                                                              |
| frontend tests (touched) | `TrainingRequirementsPage`, `TrainingProgramsPage`, `components/training`, `CourseLibraryPage`, `TrainingAdminPage` — 16 files, 181 tests pass |
| backend tests (touched)  | none touched                                                                                                                                   |
