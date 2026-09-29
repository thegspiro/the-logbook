# Workflow Review — W32 Shift Templates and Patterns, then Generate a Month of Shifts

**Driven:** 2026-09-29 · **As:** `scheduling_officer`, with `member` refused and reading the result · **Viewports:** 1280×900, 390×844
**Commit:** `2076e3b34` plus this run's changes · **Database:** continued from W31

---

## What was driven

1. As `scheduling_officer`, `/scheduling/admin/planning/templates` → New
   Template:
   - "Day Shift A", Standard, vehicle E-1 (Engine 1), which loaded its four seats;
   - 7:00 AM to 7:00 PM, smallest crew 3;
   - Save Template, double-clicked.
2. `/scheduling/admin/planning/patterns` → New Pattern → Fire Dept Presets →
   "24-Hour On / 48-Hour Off":
   - named "A-Shift 24/48", on Day Shift A, starting Oct 1, 2026;
   - Create Pattern, double-clicked.
3. On the pattern:
   - Generate shifts for Oct 1–31, with Generate double-clicked;
   - then the same range again.
4. As `member`:
   - `POST /scheduling/templates`;
   - the patterns page;
   - `GET /scheduling/patterns` and `/scheduling?tab=open-shifts`.
5. At 390×844:
   - the patterns page: generating, then New Pattern → Manual Setup;
   - the template form.

## Held up ✅

- **Creating:**
  - A double-clicked Save Template made **one** template, with the vehicle's four seats (officer, driver, two firefighters).
  - A double-clicked Create Pattern made **one** pattern: platoon, 1 on / 2 off, 3-day rotation.
- **Generating:**
  - A double-clicked Generate made **11** shifts: Oct 1, 4, 7 … 31, every third day as the rotation says.
  - Each runs 7:00 AM Central (12:00 UTC) to 7:00 PM, on E-1, with the template's four seats.
  - Running the same range again created none: duplicates are skipped.
- **What `member` sees:**
  - The 11 shifts appear as open shifts ("0 / 4 filled", Sign Up).
  - `member` got 403 creating a template, and Access Denied on the planning pages.
  - Reading patterns is allowed (200), as the schedule needs it.
- **Layout:** the patterns page and the template form fit 390px.

## Findings

### W32-1 — MED — Unfilled driver seats from generation were never shown — ✅ FIXED

**Read from code, then covered by tests.** When generation assigns a platoon's
members, it leaves a driver seat empty rather than seat a member without the
vehicle's EVOC level, and returns each one in `driver_warnings`. The endpoint's
own comment says an unfilled seat the officer does not know about is worse
than the assignment it prevented.

Neither generate screen read the field. The Patterns section and the templates
page's Generate modal both showed only "Generated N shifts", and the
`PatternGenerateResponse` type did not declare it.

**Where:**

- `frontend/src/pages/scheduling/PatternsTab.tsx:336`;
- `frontend/src/modules/scheduling/components/GenerateShiftsModal.tsx:40`;
- the endpoint at `backend/app/api/v1/endpoints/scheduling.py:2073`.

**Fix:**

- Both screens report through one helper, `modules/scheduling/utils/patternGeneration.ts`.
- The helper adds an 8-second error toast naming every unfilled seat, the app's existing pattern for a partial result.
- The type declares `driver_warnings` as optional.

Covered by `patternGeneration.test.ts` and a case in the new
`PatternsTab.test.tsx`, which fails against the old tab.

**Not driven in the browser:** it needs a platoon rotation with members and a
driver lacking EVOC, and the seeded department has neither.

### W32-2 — LOW — Re-running a range said "Generated 0 shifts" — ✅ FIXED

**Did:** generated Oct 1–31 a second time.
**Saw:** "Generated 0 shifts", read as success but explaining nothing. Zero is
the normal answer when every date is already on the schedule, or falls
outside the pattern's own start and end.
**Where:** the same two call sites.
**Fix:** the toast now reads "No new shifts. Dates already on the schedule are
skipped, as are dates outside the pattern's own start and end."

Covered by a case in `PatternsTab.test.tsx`. Re-driven at 390×844: the new
message was shown.

### W32-3 — LOW — The pattern form's fields had no names, and its choices no state — ✅ FIXED

**Did:** `scheduling_officer`, New Pattern in each mode, then Generate.
**Saw:**

- **Unnamed fields:**
  - Pattern Type, Days On, Days Off and Rotation Cycle;
  - Pattern Name and Description;
  - the shift, day and night template selects;
  - both create dates, and the generate panel's Start and End Date.
- **State by colour alone:**
  - the three mode buttons (Fire Dept Presets, Custom Builder, Manual Setup);
  - the eleven preset cards;
  - the weekday toggles.
- **Duplicate names:** on a phone, the per-pattern "Generate shifts" button reads just "Generate", beside the form's own Generate. With several patterns, every header button had the same name.

**Where:** `frontend/src/pages/scheduling/PatternsTab.tsx:432`, `:472` and
the labels after them, `:947`; `PresetPatterns.tsx:85`.
**Fix:**

- Each label is tied to its field; the generate dates are keyed to the pattern.
- The mode buttons, preset cards and weekdays carry `aria-pressed`, and the weekdays sit in a group named "Active Days".
- The header button is named "Generate shifts from <pattern>".

Covered by `PatternsTab.test.tsx` (fails against the old tab). Re-driven at
390×844: every field was found by its label.

### W32-4 — LOW — The template form's time pickers and crew seats were indistinguishable — ✅ FIXED

**Did:** `scheduling_officer`, New Template.
**Saw:**

- **Time pickers:** Starts at and Ends at both announced "Time hour", "Time minute" and "Time AM/PM"; the `TimeQuarterHour` picker's `aria-label` was not passed.
- **Crew seats:** each seat's position select had no name, and every seat's checkbox read "Administrative access".
- **Category:** Standard, Specialty Vehicle and Event / Special showed the choice by colour alone.

**Where:** `frontend/src/modules/scheduling/components/TemplateFormModal.tsx:354`,
`:747`, `:895`.
**Fix:**

- The pickers are named "Starts at" and "Ends at".
- Seats are named "Position 1", "Position 2", …, and each checkbox reads "Administrative access, position N".
- The category is a named group with `aria-pressed`.

Covered by a new case in `TemplateFormModal.test.tsx` (fails against the old
form). The existing administrative-access test now queries the per-seat name.

### W32-5 — NIT — A 24/48 preset accepts a 12-hour template without comment — OPEN

The preset says "On duty for 24 consecutive hours". Built on Day Shift A (7 AM
to 7 PM), it generated 12-hour shifts every third day, and nothing on the form
pointed out the mismatch. Left: whether the form should warn, or pick a
24-hour template for a 24-hour preset, is a design choice. Some departments
staff a 24/48 as two 12-hour halves.

### W32-6 — NIT — Patterns can be made from two places — OPEN

The Templates section carries its own "Templates / Patterns" tabs, with a
second pattern form (`PatternFormModal`) and generate modal beside the
Patterns section's. Both now report generation the same way (W32-1). Merging
them is a restructure, not a repair.

## Checklist

| Section                 | Result                                                               |
| ----------------------- | -------------------------------------------------------------------- |
| 1. The job gets done    | ✅ template → pattern → a month of shifts members can sign up for    |
| 2. The right people     | ✅ member 403 on writes, Access Denied on the pages                  |
| 3. Wrong input, failure | ✅ three double-clicks acted once; fixed W32-2 (an unexplained zero) |
| 4. Browser signals      | ✅ clean `events`                                                    |
| 5. Coming back to it    | ✅ template, pattern and shifts persist; a re-run adds no duplicates |
| 6. On a phone           | ✅ both screens at 390×844; fixed W32-3's duplicate "Generate"       |
| 7. Everyone can use it  | Fixed W32-3, W32-4                                                   |
| 8. What happens around  | Fixed W32-1 (driver warnings dropped); W32-5, W32-6 open             |

## Completion gate

| Check                    | Result                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                            |
| npm run lint             | clean on the changed files                                                                                       |
| flake8 (changed files)   | no Python changed                                                                                                |
| black --check            | no Python changed                                                                                                |
| frontend tests (touched) | `pages/scheduling`, `modules/scheduling` — 55 files, 773 passed; top-level integrity tests — 13 files, 93 passed |
| backend tests (touched)  | none touched                                                                                                     |
