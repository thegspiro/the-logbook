# Workflow Review — W71 Medical Screening

**Driven:** 2026-10-16 · **As:** `admin`, with `member`, `chief`, `membership_coordinator`, `training_officer`, `secretary` for access · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-15 plus this run's changes · **Database:** continued from W70

---

## What was driven

1. As `admin`, Medical Screening → Add Requirement: "Annual Physical (NFPA
   1582)", Physical Exam, recurring every 12 months, Add double-clicked; then
   "Pre-membership Drug Screen", one-time.
2. Records → Add Record:
   - Jordan Avery: Annual Physical, Passed, completed 20 October 2025, no
     expiration date, Add double-clicked;
   - after the fix, Alex Brooks: Annual Physical, Passed, completed
     30 November 2025, then corrected to 10 November, then an expiration
     typed by hand, then the completed date changed again.
3. Compliance: the department roster, the tiles and "Screenings Expiring
   Within 60 Days".
4. At 390×844, Records → Edit on Jordan's physical: an expiration of
   20 October 2026, saved, then a reload.
5. Access: `member`, `chief`, `membership_coordinator`, `training_officer`
   and `secretary` on the page and `GET /medical-screening/records`; `member`
   on the dashboard and `GET /compliance/me`.

Not driven: prospects (none open in this database), deleting a record, and
the self-recorded flow (no member holds the permission to record their own).

## Held up ✅

- Fields are labelled; the two inert requirement settings (roles, grace
  period) say "Not enforced yet".
- Double-clicks created one requirement and one record.
- A record linked to a requirement takes its screening type.
- The roster grades each member against both requirements ("1 of 2 met · 1
  not met"), and the Expiring list names Alex's physical at 16 days.
- The "Expiring soon" tile counts people whose every requirement is met with
  one lapsing soon, so Alex, still missing the drug screen, is under Not
  compliant — as `get_compliance_roster` documents.
- Access:
  - only `admin` holds `medical_screening.view`;
  - every other role sees Access Denied and gets 403;
  - `member` sees "1 screening overdue" on the dashboard from their own
    `compliance/me`.
- 390×844: no sideways scroll.

## Findings

### W71-1 — MED — A recurring screening recorded without an expiration never fell due — ✅ FIXED (form, 2026-10-16; grading, 2026-10-25)

Grading half fixed by owner decision: a record with no expiration date falls due
`frequency_months` after its completed date, using its linked requirement's frequency,
else the graded requirement's (`_effective_expiration`). The expiring list applies the
same rule, and both screens label such a date "by frequency". Original finding below.

**Did:** recorded Jordan's annual physical, completed 20 October 2025, with
the expiration left blank.
**Saw:**

- stored with `expiration_date: null`;
- graded as met;
- absent from "Expiring Within 60 Days", though by its 12-month frequency it
  lapses in four days.

`_grade` treats "No expiration = compliant indefinitely", and nothing reads
`frequency_months`. The requirement card says "Every 12 months" regardless.
**Where:** `medical_screening_service.py` `_grade`; `ScreeningRecordForm.tsx`.
**Fix:** the record form fills in the expiration the linked requirement's
frequency implies (completed date + 12 months), with a note saying where it
came from. It follows a corrected completed date while still the suggestion,
and never overwrites a date the officer typed; one-time requirements get
nothing. The requirement form's Frequency field now says what it does and
does not do. New helper `addCalendarMonths` (clamps 31 January + 1 month to
February's last day). Re-driven: 30 November → 30 November 2026; corrected to
the 10th → 10 November 2026; a typed 1 November 2026 survived a later change.
`ScreeningRecordForm.expiration.test.tsx` (2 of 4 fail on the old form) and
`dateFormatting.test.ts`.
**Flagged:** whether grading should use the frequency when a record has no
expiration. That changes the standing of records already saved, and the rule
matches records by screening _type_, not by requirement. Mirrored to
KNOWN_LIMITATIONS.

### W71-2 — MED — Editing a record or requirement said it failed, after saving — ✅ FIXED

**Did:** at 390×844, Records → Edit Jordan's physical, expiration
20 October 2026, Save.
**Saw:** `events`: `500 PUT /medical-screening/records/{id}`; after a reload
the expiration was there. The log: `ResponseValidationError … updated_at …
MissingGreenlet`. The endpoint commits before it returns, so the write lands
and the officer is told it did not, which invites entering it again.
**Where:** `update_record` and `update_requirement` flushed without the
refresh their create paths do.
**Fix:** refresh after the flush.
`tests/test_medical_screening_update_response.py` (2 of 2 fail without it).

### W71-3 — LOW — Smaller defects — ✅ FIXED

- **Dates.** The Records list printed ISO dates ("Expires: 2026-11-01") and no
  completed date at all; the Expiring list printed "Expires 2026-11-01". Both
  now read "Nov 1, 2026", and the Records list shows Completed.
- **Record buttons.** Named only by type ("Edit Physical Exam record"), the
  same for every member; they now include the member ("Edit Jordan Avery
  Physical Exam record").
- **Touch targets.** The requirement and record Edit / Delete buttons were
  16px tall.

## Checklist

| Section                 | Result                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 1. The job gets done    | ⚠️ → ✅ recurring screenings now get an expiration; grading flagged |
| 2. The right people     | ✅ admin only; five other roles refused on page and API             |
| 3. Wrong input, failure | ❌ → ✅ a saved edit reported as a failure                          |
| 4. Browser signals      | ❌ → ✅ one 500; clean after                                        |
| 5. Coming back to it    | ✅ every write checked after a reload                               |
| 6. On a phone           | ✅ no sideways scroll; touch targets fixed                          |
| 7. Everyone can use it  | ✅ labelled; record buttons now name the member                     |
| 8. What happens around  | ✅ the member's dashboard reflects their standing                   |

## Completion gate

| Check                    | Result                                                                      |
| ------------------------ | --------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                    |
| npm run lint             | ✅ clean                                                                    |
| flake8 (changed files)   | ✅ clean                                                                    |
| black --check            | ✅ clean                                                                    |
| frontend tests (touched) | ✅ `src/modules/medical-screening` and `dateFormatting.test.ts`: 166 passed |
| backend tests (touched)  | ✅ `-k medical_screening` 88 passed                                         |
