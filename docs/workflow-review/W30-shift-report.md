# Workflow Review — W30 Log a Shift and File a Shift Report

**Driven:** 2026-09-29 · **As:** `training_officer` → `member`, with `member` and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `617e1d424` plus this run's changes · **Database:** continued from W29

---

## Who does what

The tracker listed `member` for this activity. The code says otherwise:

- `/training/log-shift` and every write under `/training/shift-reports` need `training.manage`, because an officer files a report about a crew member.
- The member reads their own reports and acknowledges them (`/my-reports`, `POST /{id}/acknowledge`).

The run was driven that way: the officer files, the member acknowledges.

## What was driven

1. As `training_officer`, `/training/log-shift`:
   - it refused to go on with "No apparatus configured. Contact an administrator.";
   - as `admin`, `/apparatus-basic` → Add Apparatus "Engine 1" (E-1), then back to the page.
2. Filed the report:
   - Engine 1, Sep 28 07:00–19:00, 2 calls, Structure Fire and EMS/Medical, a narrative;
   - crew member Jordan Avery (`member`), with Evaluate opened;
   - Submit Report, double-clicked.
3. As `member` at 390×844:
   - My Training → Shift Statistics and Shift Completion Reports;
   - then Scheduling → Shift Reports ("Shift reports about you") → the report → Acknowledge Report, confirmed with a double-click.
4. As `member`:
   - `POST /training/shift-reports` and `GET /all`;
   - `/training/log-shift`.
5. As `member2`: `member`'s report, and acknowledging it.

## Held up ✅

- **Filing:** a double-clicked Submit filed **one** report (12 h, 2 calls, 2026-09-28), approved on filing because an officer wrote it.
- **The member's view:**
  - My Training showed "Shifts Completed 1 · Hours Reported 12 · Calls Responded 2" and the report.
  - Scheduling → Shift Reports showed it as "Needs Acknowledgment", with the call types.
  - A double-clicked acknowledgement recorded **one** acknowledgement, with its time.
- **Refusals:**
  - `member` got 403 filing a report and listing all of them, and Access Denied on the page.
  - `member2` got 404 reading `member`'s report and acknowledging it ("not your report").
- **Layout:** the member's screens fit 390px.

## Findings

### W30-1 — LOW — The shift report form's fields had no accessible names — ✅ FIXED

**Did:** `training_officer`, `/training/log-shift`.
**Saw:**

- **Unnamed:** Apparatus, start and end date and time, Calls Responded, the narrative and the member search were named by placeholders or nothing, as were each crew member's Strengths, Areas for Improvement and Remarks.
- **The crew checkbox:** it had no name, so a screen reader said "checkbox".
- **Call types:** the ten toggles showed which were chosen by colour alone.

**Where:** `frontend/src/pages/training/ManualShiftReportPage.tsx:304`, `:412` and
the labels around them.
**Fix:**

- Each label is tied to its control; crew fields are keyed to the member.
- The checkbox reads "Include <name> in the report".
- The call types carry `aria-pressed`.

Covered by the new `ManualShiftReportPage.test.tsx` (fails against the old
page). Re-driven: every field found by its label.

### W30-2 — NIT — The acknowledgment comment box had no name — ✅ FIXED

**Where:** `frontend/src/pages/scheduling/ShiftReportsTab.tsx`, the Acknowledge
Report form. "Comments (optional)" is now tied to its textarea. Covered by a new
case in `ShiftReportsTab.test.tsx`.

### Lead for W48 — the basic apparatus form is unlabelled

`/apparatus-basic` → Add Apparatus: unit number, name, type, crew size and
every position select are named by placeholders or nothing. Added to the
PROGRESS leads for W48 rather than fixed here, since W48 drives that screen.

## Checklist

| Section                 | Result                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ file → member reads → member acknowledges (after adding an apparatus)       |
| 2. The right people     | ✅ officer-only filing; another member gets 404                                |
| 3. Wrong input, failure | ✅ the apparatus requirement stops an unfiled shift; double submits acted once |
| 4. Browser signals      | ✅ clean `events`                                                              |
| 5. Coming back to it    | ✅ report and acknowledgement survive reload                                   |
| 6. On a phone           | ✅ the member's screens at 390×844                                             |
| 7. Everyone can use it  | Fixed W30-1, W30-2                                                             |
| 8. What happens around  | ✅ the member's stats update from the report                                   |

## Completion gate

| Check                    | Result                                                        |
| ------------------------ | ------------------------------------------------------------- |
| npm run typecheck        | clean                                                         |
| npm run lint             | clean on the changed files                                    |
| flake8 (changed files)   | no Python changed                                             |
| black --check            | no Python changed                                             |
| frontend tests (touched) | `pages/training` and `ShiftReportsTab` — 11 files, 152 passed |
| backend tests (touched)  | none touched                                                  |
