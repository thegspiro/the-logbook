# Workflow Review — W27 A Course Cohort: Schedule Classes, Roster, Attendance

**Driven:** 2026-09-29 · **As:** `training_officer`, `member`, with `quartermaster` refused · **Viewports:** 1280×900, 390×844
**Commit:** `34e546fd5` plus this run's changes · **Database:** continued from W26

---

## What was driven

1. As `training_officer`, `/training/cohorts` → New cohort. The course list
   was empty: the only course was deactivated in W25, and a cohort needs a
   course with classes.
2. Course Library → Add Course "Driver Operator Course" (DO-1). Then Manage
   classes → Add class, where the "Course taught" list was empty, then "Create a
   new course".
3. After the fixes below:
   - Add class "Vehicle Familiarization" (day 0);
   - "Create a new course" → "Pump Operations", then Add class on day 7.
4. New cohort:
   - Driver Operator Course, named "Driver Operator — Fall 2026";
   - starting Oct 5, 2026, with the preview;
   - roster Jordan Avery (`member`) and Alex Brooks (`member2`);
   - "Generate 2 classes", double-clicked.
5. On the cohort:
   - Roster → Remove Alex Brooks;
   - Shift remaining by 7 days, Apply double-clicked.
6. As `member` at 390×844:
   - `GET /training/cohorts/mine` and the cohort's detail;
   - `/training/cohorts`;
   - My Training.
7. As `quartermaster` (`training.view` only): the cohort's detail.

Not driven: taking attendance. The generated classes fall on Oct 12 and
Oct 19, so their check-in windows are closed, and cohort classes are
ordinary events whose check-in W20 drove.

## Held up ✅

- **Generating:**
  - The preview showed both classes with times "in America/Chicago" and flagged the Oct 12 holiday.
  - A double-clicked Generate made **one** cohort, with two events on the calendar, both roster members signed up to each, and a matching pipeline.
- **Removing a member:**
  - Remove said what it keeps ("pipeline enrollment, training records, and any class they already attended").
  - Alex Brooks became `withdrawn` and left the upcoming class's RSVPs.
- **Shift remaining:** a double-clicked Apply moved the classes once, by 7 days and not 14, keeping 7:00 PM local.
- **`member`'s view:**
  - The cohort's schedule is visible without the roster: members are withheld.
  - Access Denied on `/training/cohorts`.
  - The cohort's pipeline appears on My Training with its classes by name (W26's fix).
- **Access for others:** `quartermaster`, who is on no roster and not an officer, got **404** for the cohort.

## Findings

### W27-1 — HIGH — "Create a new course" opened beneath the syllabus, where it took no clicks — ✅ FIXED

**Did:** `training_officer`, Manage classes → Add class → "Create a new course".
**Saw:**

- The Add New Course form opened behind the syllabus dialog: visible at the edges, but under it.
- Clicking Create Course hit the syllabus dialog ("intercepts pointer events"), and the element at the button's centre belonged to the syllabus.
- With no other active course, which is every department's first syllabus, this was the only way to a first class. So a department could not build a cohort at all.

**Why:** both overlays are `modal-overlay z-50`, and the page rendered the
course form before the syllabus. At equal z-index the later element paints
on top.
**Where:** `frontend/src/pages/CourseLibraryPage.tsx:866`.
**Fix:** the course form is rendered after the syllabus dialog, with a comment
saying why. Covered by a new case in `CourseLibraryPage.test.tsx` (fails
against the old order). Re-driven: the form opened on top and created the
course.

### W27-2 — MED — A course created from the syllabus was not listed, so it could not be picked — ✅ FIXED

**Did:** as above, once the form could be used. Created "Vehicle Familiarization".
**Saw:**

- The course was saved, but "Course taught" still read "Select a course…".
- The builder loads its catalog once, so the form had selected an id with no option behind it, and Add class refused with "Pick the course this class teaches".

**Where:** `frontend/src/components/training/CourseSyllabusBuilder.tsx:323`.
**Fix:** the builder adds a course created from its form to the catalog before
the form selects it. Covered by a new case in `CourseSyllabusBuilder.test.tsx`
(fails without it). Re-driven: "Pump Operations" was created and selected
in one step.

### W27-3 — MED — A cohort's roster cannot be added to after generation — FLAGGED

**Did:** `training_officer`, the cohort's Roster tab.
**Saw:**

- Each member has Remove, but nothing adds one.
- The roster's empty state tells the officer to "Add members so they see the classes on their calendar".
- `POST /training/cohorts/{id}/members` and `courseCohortService.addMembers` exist, but no screen calls them. A member who joins the course late cannot be put on it from the app.

**Where:** `frontend/src/pages/training/CohortDetailPage.tsx:435`,
`frontend/src/services/trainingServices.ts:2108` (no caller).
**Not fixed because:** it is a new control, not a repair. What a late joiner
receives is a product decision: sign-ups for past classes, pipeline
enrollment, credit for classes already held. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### W27-4 — NIT — The cohort's course list offers courses with no classes — OPEN

`Pump Operations` and `Vehicle Familiarization`, component courses with empty
syllabi, are offered beside "Driver Operator Course", while the hint says "The
course must already have classes on its syllabus". Left: choosing one fails
at the preview with a message rather than silently.

## Checklist

| Section                 | Result                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| 1. The job gets done    | Fixed W27-1, W27-2, which blocked a first syllabus; ✅ generate, remove, shift    |
| 2. The right people     | ✅ officers only for the list; roster members see a redacted schedule; others 404 |
| 3. Wrong input, failure | ✅ double generate and double shift acted once                                    |
| 4. Browser signals      | ✅ clean `events` throughout                                                      |
| 5. Coming back to it    | ✅ roster, shifted dates and sign-ups survive reload                              |
| 6. On a phone           | ✅ the member's view at 390×844                                                   |
| 7. Everyone can use it  | ✅ wizard and class form labelled; meeting days carry `aria-pressed`              |
| 8. What happens around  | Flagged W27-3 — no way to add a late joiner                                       |

## Completion gate

| Check                    | Result                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                    |
| npm run lint             | clean after replacing an `.at(-1)` the linter's TypeScript could not type                                |
| flake8 (changed files)   | no Python changed                                                                                        |
| black --check            | no Python changed                                                                                        |
| frontend tests (touched) | `CourseLibraryPage`, `components/training`, `pages/training`, `TrainingAdminPage` — 21 files, 269 passed |
| backend tests (touched)  | none touched                                                                                             |
