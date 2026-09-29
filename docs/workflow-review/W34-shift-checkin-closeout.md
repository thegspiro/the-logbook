# Workflow Review — W34 Check In to a Shift by Apparatus QR, and Close the Shift Out

**Driven:** 2026-09-29 · **As:** `member` → `scheduling_officer`, with `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `e061ccc02` (main, after #2788) plus this run's changes · **Database:** continued from W33

---

## What was driven

1. As `scheduling_officer`, two shifts on E-1 (Engine 1), each with Jordan
   Avery (`member`) assigned as firefighter:
   - one running now, 9:28 AM to 9:28 PM Central;
   - one that ended yesterday, 7:00 AM to 6:59 PM on Sep 28.
2. As `member` at 390×844, the apparatus QR's link,
   `/scheduling/checkin?apparatus=<E-1>`:
   - Check In, double-clicked, then a reload;
   - Check Out, double-clicked.
3. As `member2` at 390×844: the same link, Check In, then Check Out.
4. As `scheduling_officer`: `/scheduling/admin/closeout` → "Open the shift to
   close it" → Close out shift. Jordan had not checked in, so 12 hours were
   entered for him; Close out shift was double-clicked.
5. As `member`:
   - `POST /shifts/{id}/finalize` and `GET /shifts/needing-closeout`;
   - the close-out page;
   - the attendance history.

## Held up ✅

- **Scanning:** the QR link found the running shift on E-1 and named the rig, date and times in the department's zone.
- **Checking in and out:**
  - A double-clicked Check In made **one** attendance record at 10:28 AM, and it survived a reload.
  - A double-clicked Check Out closed it **once**.
- **The close-out queue:**
  - It listed only the ended shift ("1 shift waiting", "waiting 15 hours").
  - Its settings summary says what close-out asks for and where each rule is set.
- **Closing out:**
  - It named the member who never checked in and offered hours for him.
  - It noted "ran understaffed — 1 of 4 positions filled" as a recorded, non-blocking warning.
  - A double-clicked Close out shift finalized the shift **once**, with Jordan's 720 minutes, and the queue emptied.
- **What `member` sees and is refused:**
  - The 12 hours appear in the attendance history.
  - Finalize and the close-out queue returned 403, and the page showed Access Denied.

## Findings

### W34-1 — MED — One tap on Check Out ended a 12-hour shift 11 hours early, for good — ✅ FIXED

**Did:** `member` at 390×844, one hour into a 12-hour shift, tapped Check Out.
**Saw:**

- It checked out at once, with no question. The toast read "Checked out - 0 hours recorded" and the card "Shift complete. Thank you!".
- It cannot be undone by the member. `member_check_in` refuses a second check-in on the same shift ("Already checked in"), so a stray tap from a phone in a pocket or a gloved hand leaves the member off the shift until an officer fixes the record.

**Where:** `frontend/src/pages/scheduling/ShiftCheckInPage.tsx:139`.
**Fix:**

- Before the scheduled end, Check Out asks first. Title: "Check out early?". Message: "Your shift runs until 9:28 PM. Checking out now records your hours up to now, and you cannot check back in to this shift."
- The buttons are "Stay checked in" and "Check out now".
- At or after the scheduled end, it checks out without asking.

Covered by the new `ShiftCheckInPage.test.tsx`: a confirmed check-out, a backed-out one, and one after the end. The first two fail against the old page. Re-driven as `member2`: "Stay checked in" kept the member on shift.

### W34-2 — LOW — A check-out in the first minute read a bare "hours" — ✅ FIXED

**Did:** as above.
**Saw:** the result card said "hours" with no figure. The duration was 0, and the
page tested it for truthiness, so it dropped the number.
**Where:** `frontend/src/pages/scheduling/ShiftCheckInPage.tsx:227`, `:319`.
**Fix:** the figure shows whenever the server sent one, so 0 reads "0 hours".
Covered by the same test file.

### W34-3 — LOW — Close-out's per-member hours and the queue's row buttons had no distinguishing names — ✅ FIXED

**Did:** `scheduling_officer`, the queue, then Close out shift.
**Saw:**

- **Hours boxes:** each member who never checked in gets an hours box named by nothing (placeholder "hrs"). With a crew of several, a screen reader cannot tell whose hours it is entering.
- **Queue buttons:** each row's "Open the shift to close it" (or "Close out") button reads the same on every row.

**Where:**

- `frontend/src/pages/scheduling/ShiftDetailPanel.tsx:1787`;
- `frontend/src/pages/scheduling/admin/closeout/CloseoutQueueSection.tsx:386`.

**Fix:**

- The boxes are named "Hours for <member>".
- The row buttons carry the shift, e.g. "Open the shift to close it: Mon, Sep 28, 7:00 AM, E-1".

Covered by new cases in `ShiftDetailPanel.test.tsx` and
`CloseoutQueueSection.test.tsx`, both failing against the old code.

### W34-4 — NIT — Opening the check-in page logs two 404s — OPEN

`GET /shifts/{id}/my-attendance` answers 404 for a member who has not checked
in. The page reads that as "not yet", but it is requested twice (load, then the
visibility refresh), and the browser logs both as failures. This is the same
contract question as W31-4, and was left for the same reason: changing it to a
200 with no body is a response change.

### W34-5 — NIT — A member not on the shift can check in to it — OPEN (setting)

`member2`, not assigned, checked in to the E-1 shift from its QR. That is the
department setting `restrict_checkin_to_assigned`, off by default, and it is
deliberate for volunteer departments where whoever turns up rides. Noted, not
changed.

## Checklist

| Section                 | Result                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ scan → check in → check out; officer closes out with hours for a no-show  |
| 2. The right people     | ✅ member 403 on finalize and the queue; Access Denied on the page           |
| 3. Wrong input, failure | ✅ double check-in, check-out, close-out acted once; fixed W34-1 (stray tap) |
| 4. Browser signals      | W34-4 (expected 404s logged)                                                 |
| 5. Coming back to it    | ✅ attendance survives reload; closed shift leaves the queue                 |
| 6. On a phone           | ✅ the check-in page at 390×844                                              |
| 7. Everyone can use it  | Fixed W34-3                                                                  |
| 8. What happens around  | ✅ hours reach the member's history; fixed W34-2                             |

## Completion gate

| Check                    | Result                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                              |
| npm run lint             | clean on the changed files                                                                                                         |
| flake8 (changed files)   | no Python changed                                                                                                                  |
| black --check            | no Python changed                                                                                                                  |
| frontend tests (touched) | `pages/scheduling`, `modules/scheduling`, `SchedulingPage` — 56 files, 783 passed; top-level integrity tests — 13 files, 93 passed |
| backend tests (touched)  | none touched                                                                                                                       |
