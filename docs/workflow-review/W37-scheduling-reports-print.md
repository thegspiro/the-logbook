# Workflow Review — W37 Scheduling Reports, and the Printed Check-In Sheet and Shift Report

**Driven:** 2026-09-29 · **As:** `scheduling_officer`, with `member` and `member2` refused · **Viewports:** 1280×900, print media
**Commit:** `fd862d52a` (main, after #2814) plus this run's changes · **Database:** continued from W36

---

## What was driven

1. As `scheduling_officer`, `/scheduling/admin/reports`, using the default range Sep 1–29:
   - Member Hours;
   - Coverage, Call Volume and Availability, each generated;
   - Shift Compliance, then Check Compliance.
2. The apparatus check-in sheet,
   `/scheduling/checkin/print?apparatus=<E-1>&name=Engine 1`, under print media.
3. The printed shift report, `/scheduling/shift-reports/print?id=<Sep 28 report>`, under print media.
4. Refusals:
   - As `member`: all four report endpoints and the reports page.
   - As `member2`: another member's printed shift report.

## Held up ✅

- **Member Hours reconciles with W34:**
  - Jordan Avery shows 1 finalized shift and 12 h worked, against 24 h scheduled (Sep 28 plus today's still-open shift), so the difference reads −12.
  - The page explains that worked hours count only finalized attendance.
- **Coverage:** shows the two September shifts on Sep 28 and 29, each understaffed at 1 of 4.
- **Availability:** lists the 27 active members, with Jordan's 2 assignments.
- **Call Volume:** says there is no call data rather than showing zeros.
- **The check-in sheet:**
  - It prints the rig's name and a QR code.
  - The QR's link is printed underneath: `…/scheduling/checkin?apparatus=<id>`, the link W34 drove.
- **The shift report:** prints the member, shift date, hours, calls, filing officer and a signature line.
- **Refusals:**
  - `member` got 403 on every report endpoint and Access Denied on the page.
  - `member2` got 404 for another member's report, and the page said "Failed to load report".

## Findings

### W37-1 — LOW — A requirement nobody is held to read "0% · 0/0 compliant" in red — ✅ FIXED

**Did:** `scheduling_officer`, Shift Compliance → Check Compliance.
**Saw:** "Supervised Driving Hours" (a program requirement no member is held to
department-wide) read "0%", "0/0 compliant", in red. That's an empty set shown
as a failure: the "an empty set is not a passing set" corollary of CLAUDE.md
pitfall 29, as with W29-4.
**Where:** `frontend/src/pages/SchedulingReportsPage.tsx:1084`.
**Fix:** "Not applicable" when `total_members` is 0. Covered by the new
`SchedulingReportsPage.test.tsx` (fails against the old page).

### W37-2 — MED — Shift Compliance grades training hours requirements from shift attendance alone — FLAGGED

**Did:** as above, "Annual Hazmat Hours" (6 h a year).
**Saw:**

- The report counts Jordan Avery compliant at 100%, with 12 hours: the Sep 28 shift.
- The training side puts the same member at 4 of 6 hours, not compliant: the W29 matrix, My Training, and `GET /training/requirements/progress`.
- **Why:** `get_shift_compliance` takes every active requirement of type HOURS or SHIFTS and counts only shift attendance against it. A training hours requirement is therefore satisfied by ordinary shifts on this screen and by training records on the others (CLAUDE.md pitfall 29).

**Where:** `backend/app/services/scheduling_service.py:7679`.
**Not fixed because:** which requirements shift hours may satisfy is a grading
decision, and changing it moves reported compliance for every department. The
options are all HOURS requirements, only ones marked as shift-credited, or none
the training side grades. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W37-3 — NIT — The app footer prints on the check-in sheet and the shift report — OPEN

Under print media both pages end with the app's footer: "© 2026 Review Valley
Fire Department … Powered by The Logbook · End-to-end encrypted · Self-hosted ·
HIPAA-aware". On a sticker meant for an apparatus, that's clutter. It comes
from the app shell rather than either page, so it likely affects every print
page. Left for a run that touches the app shell. Added to the PROGRESS leads.

## Checklist

| Section                 | Result                                                          |
| ----------------------- | --------------------------------------------------------------- |
| 1. The job gets done    | ✅ five reports, the check-in sheet and the shift report        |
| 2. The right people     | ✅ member 403 and Access Denied; another member 404 on a report |
| 3. Wrong input, failure | ✅ an empty call-volume period says so                          |
| 4. Browser signals      | ✅ clean apart from the expected 404 driven on purpose          |
| 5. Coming back to it    | ✅ figures match the attendance W34 recorded                    |
| 6. On a phone           | not driven (officer reports and print pages)                    |
| 7. Everyone can use it  | ✅ report tabs carry `aria-selected`; date fields named         |
| 8. What happens around  | Fixed W37-1; flagged W37-2; W37-3 open                          |

## Completion gate

| Check                    | Result                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                         |
| npm run lint             | clean on the changed files, after four `no-node-access` warnings in the new test were removed |
| flake8 (changed files)   | no Python changed                                                                             |
| black --check            | no Python changed                                                                             |
| frontend tests (touched) | `SchedulingReportsPage`, `pages/scheduling`, `modules/scheduling` — 59 files, 789 passed      |
| backend tests (touched)  | none touched                                                                                  |
