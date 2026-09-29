# Workflow Review — W24 Submit a Training Record, and the Officer Approves or Returns It

**Driven:** 2026-09-29 · **As:** `member`, `training_officer`, with `member` and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `ab12fe82c` plus this run's changes · **Database:** continued from W23

---

## What was driven

1. As `member` at 390×844, Training → Submit Training (`/training/submit`):
   - pressed Submit with the form empty;
   - then filled "Hazmat Awareness Refresher", Refresher, Sep 27, 9:00 AM, 4h, instructor Capt. Lee and a description;
   - double-tapped Submit.
2. As `training_officer`, Training → Review queue
   (`/training/admin?page=records&tab=submissions`; `/training/submissions`
   redirects there): opened the submission and chose Request Revision. First
   Confirm was tried with no reason, then the note "Please attach the
   certificate of completion." was entered and Confirm double-clicked.
3. As `member` at 390×844, Submit Training: read the returned notice, then Fix
   and Resubmit, edited the description, and pressed Update.
4. As `training_officer`: opened it again, then Approve → Confirm Approval,
   double-clicked.
5. As `member`: My Training (`/training/my-training`).
6. As `member`:
   - `GET /training/submissions/pending` and `/all`;
   - `POST …/review`;
   - `PATCH` and `DELETE` on the approved submission;
   - the review page.
7. As `member2`: `GET` and `PATCH` on `member`'s submission.

## Held up ✅

- **Submitting:**
  - A double-tapped Submit made **one** submission (`pending_review`, 4 hours, start time kept), with a receipt.
  - The form fits 390px, with 44px fields, duration chips and certification row.
  - "Submitted: 9/28/2026" on the officer's side is the department date for a 03:50 UTC submission.
- **The review queue:**
  - It counted the submission ("1 training submission awaiting approval") and listed it for the officer.
  - Request Revision stayed disabled until a reason was typed.
  - A double-clicked Confirm moved it to `revision_requested` once, with the note stored.
- **Returning it to the member:**
  - `member` saw the note at the top of Submit Training, with Fix and Resubmit and Withdraw.
  - Fix and Resubmit reopened the form with every value filled.
  - Update returned the same submission to `pending_review`, and the officer then saw "Previous reviewer notes".
- **Approval:**
  - A double-clicked Confirm Approval made **one** training record (checked in the review database).
  - `member`'s My Training showed it: 1 course and 4 hours.
- **Refusals:**
  - `member` got 403 on `/pending`, `/all` and `/review`, and Access Denied on the review page.
  - An approved submission refused `PATCH` and `DELETE` with a readable 400.
  - `member2` got 403 reading or editing `member`'s submission.

## Findings

### W24-1 — LOW — The member's "Returned" date was the UTC day — ✅ FIXED

**Did:** `training_officer` returned the submission at 04:55 UTC, which was 11:55 PM
on Sep 28 in the department's zone; `member` opened Submit Training.
**Saw:** "Returned Sep 29 · Your hours are not counted yet".
**Where:** `frontend/src/components/training/submit/RevisionNotice.tsx:38`,
which sliced the date off the UTC timestamp `reviewed_at`.
**Fix:** `formatDateCustom(reviewed_at, …, tz)` with the department zone. Covered
by the new `RevisionNotice.test.tsx` (fails with the slice). Re-driven: "Returned
Sep 28".

### W24-2 — LOW — Missing fields were marked only in red — ✅ FIXED

**Did:** `member` pressed Submit with the form empty.
**Saw:**

- Focus moved to Course / Class Name, and each missing field turned red.
- Nothing exposed which fields were invalid to assistive technology.
- There was no message beside the field; the side checklist's "not filled in" is the only text.

**Where:** `frontend/src/pages/SubmitTrainingPage.tsx:599` and the nine fields after it.
**Fix:** each field carries `aria-invalid` from the same rule that paints it red,
so it clears as the member types. Covered by a new case in
`SubmitTrainingPage.test.tsx` (fails without it).

### W24-3 — LOW — The officer's review showed raw ISO dates, and an unnamed notes box — ✅ FIXED

**Did:** `training_officer` opened the submission.
**Saw:**

- The completion date read "2026-09-27", and an expiry date is printed the same way.
- The notes box and the Settings "Member Instructions" box were named only by their placeholders.

**Where:** `frontend/src/pages/ReviewSubmissionsPage.tsx:350`, `:639`.
**Fix:**

- The dates go through `formatCalendarDate` ("Sep 27, 2026").
- The notes box is named for what it asks: "Notes for the member", or "Reason for the member (required)" on a return or rejection.
- The instructions box is named.

Covered by the new `ReviewSubmissionsPage.test.tsx` (fails against the old page).
Re-driven: All Submissions shows "Sep 27, 2026".

### W24-4 — NIT — The receipt promises review "within a week" — OPEN

**Where:** `frontend/src/components/training/submit/SubmissionReceipt.tsx:37`.
The department's configured approval deadline is 14 days. The sentence is
advice, not a deadline the member can hold the department to, so it is left.

## Checklist

| Section                 | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ submit → return → resubmit → approve → on the record                    |
| 2. The right people     | ✅ 403 for `member` on officer routes, and for `member2` on another's      |
| 3. Wrong input, failure | ✅ empty form blocked, reason required, double submits single; fixed W24-2 |
| 4. Browser signals      | ✅ clean `events`; fixed W24-3 (raw ISO)                                   |
| 5. Coming back to it    | ✅ approved submission is locked; record survives reload                   |
| 6. On a phone           | ✅ submit and revision flow at 390×844                                     |
| 7. Everyone can use it  | Fixed W24-2, W24-3                                                         |
| 8. What happens around  | ✅ hours counted after approval; fixed W24-1                               |

## Completion gate

| Check                    | Result                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck        | clean                                                                                                                          |
| npm run lint             | clean                                                                                                                          |
| flake8 (changed files)   | no Python changed                                                                                                              |
| black --check            | no Python changed                                                                                                              |
| frontend tests (touched) | `SubmitTrainingPage`, `ReviewSubmissionsPage`, `components/training` (13 files, 147 tests) and `TrainingAdminPage` (20) — pass |
| backend tests (touched)  | none touched                                                                                                                   |
