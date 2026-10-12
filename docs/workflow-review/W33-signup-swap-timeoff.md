# Workflow Review — W33 Sign Up for a Shift, Swap It, Request Time Off

**Driven:** 2026-09-29 · **As:** `member`, `member2` → `scheduling_officer` · **Viewports:** 1280×900, 390×844
**Commit:** `0b94e0bd6` plus this run's changes · **Database:** continued from W32 (its 11 October shifts)

---

## What was driven

1. As `member`: Scheduling → Open Shifts → Oct 1 → Sign Up. Firefighter was the
   only seat offered; Confirm Sign Up was double-clicked.
2. My Shifts → Swap on Oct 1 → Open Swap, with a reason. Submit Request was
   double-clicked.
3. As `member2`:
   - the Requests tab, Open Shifts and the swap list, looking for the open swap;
   - reviewing and cancelling `member`'s requests through the API.
4. As `scheduling_officer`: Requests → the swap → Approve, double-clicked.
5. As `member`: Request Time Off for Oct 1–2 with a reason. Submit Request was
   double-clicked.
6. As `scheduling_officer`: Requests → Time Off → Approve, double-clicked.
7. As `member` at 390×844:
   - Requests;
   - My Shifts;
   - a second sign-up (Oct 4) and its swap dialog.

## Held up ✅

- **Signing up:**
  - A double-clicked Confirm Sign Up made **one** assignment ("1 / 4 filled").
  - Only the seat the member is cleared for was offered.
- **Requests:** a double-clicked Submit made **one** swap request and **one** time-off request.
- **Approving time off:**
  - It cancelled the member's Oct 1 seat and emptied their My Shifts.
  - The member was notified: "Your time-off request for 2026-10-01 to 2026-10-02 has been approved."
- **`member2` was refused:**
  - 403 reviewing either request;
  - 404 reading them;
  - 400 cancelling the (already answered) time-off request.
- **Layout:** the member's screens fit 390px.

## Findings

### W33-1 — LOW — Every row's actions had the same name — ✅ FIXED

**Did:** `member`, Open Shifts and My Shifts; `scheduling_officer`, Requests.
**Saw:**

- **Open Shifts:** ten "Sign up for this shift" and ten "View shift details".
- **My Shifts:** each row's actions were "Confirm shift assignment", "Decline shift assignment", "Request shift swap" and "View shift details".
- **Requests:** "Approve swap" and "Approve time off" for every member.

A screen reader heard the same list for every row, with no date or person.
**Where:**

- `frontend/src/pages/scheduling/OpenShiftsTab.tsx:262`;
- `MyShiftsTab.tsx:508`;
- `RequestsTab.tsx`, the quick-review buttons.

**Fix:** each name carries its shift or member, and starts with the visible
word:

- "Sign up for shift on Sun, Oct 4, 7:00 AM (E-1)";
- "Swap shift on Thu, Oct 1, 7:00 AM";
- "Approve swap for Jordan Avery".

Covered by new cases in `OpenShiftsTab.test.tsx`, `MyShiftsTab.test.tsx` and
`RequestsTab.test.tsx`, all failing against the old tabs. Existing queries now
use the per-row names.

### W33-2 — LOW — Signing up promised an officer review that does not exist — ✅ FIXED

**Did:** `member`, Confirm Sign Up.
**Saw:**

- The toast said "Signed up for shift — an officer will confirm your assignment".
- The tab's intro said "A scheduling officer will review and confirm your signup".
- What happened instead:
  - The signup is written straight to the roster as `assigned`.
  - `POST /assignments/{id}/confirm` is the member's own action ("Confirm own shift assignment").
  - No officer queue receives it.
  - My Shifts showed the member a Confirm button.

**Where:** `frontend/src/pages/scheduling/OpenShiftsTab.tsx`, the sign-up toast and the intro.
**Fix:**

- This run changed the toast and the intro so neither promises an officer review.
- `main` corrected both independently while this run was open (the scheduling module review, #2780), so the merge keeps `main`'s wording: "Signed up for shift", and "Sign up for one and it goes straight onto your schedule".

Covered by the new `OpenShiftsTab.test.tsx` case, which now asserts `main`'s toast. Re-driven before the merge.

### W33-3 — LOW — A double-clicked Approve reviewed twice and showed an error — ✅ FIXED

**Did:** `scheduling_officer`, Approve on the swap, double-clicked.
**Saw:** "Request approved", then "Unable to review swap request. Swap request
is no longer pending". Both clicks sent a review, and the second was refused
(400). The quick Approve and Deny buttons had no in-flight guard.
**Where:** `frontend/src/pages/scheduling/RequestsTab.tsx:196`.
**Fix:**

- A ref-held set of in-flight ids drops the second click.
- The row's buttons disable while it is pending.

Covered by a new `RequestsTab.test.tsx` case. It holds the first review open,
and fails with two calls when the guard is removed. Re-driven: a double-clicked
time-off Approve showed one "Request approved" and no error.

### W33-4 — MED — An open swap cannot be picked up, and approving it moves nothing — ✅ FIXED (2026-10-05, owner decision)

**Did:**

- `member` offered Oct 1 as an Open Swap, "Any member can pick it up".
- `member2` looked for it; `scheduling_officer` approved it.

**Saw:**

- **Nobody else can see it:** `member2` found it nowhere. The swap list returns a member's own requests, and `respond` accepts only a named target.
- **Approval moves nothing:** it "records the review without moving the offering assignment" (`review_swap_request`). Jordan Avery stayed `assigned` to Oct 1.
- **The notice misleads:** the member was notified "Your shift swap request for the 2026-10-01 shift has been approved", which reads as released.

**Where:**

- `backend/app/services/scheduling_service.py`, `review_swap_request` and `respond_to_swap_offer`;
- the promise at `frontend/src/pages/scheduling/MyShiftsTab.tsx:731`.

**Fixed here:**

- The Open Swap choice now reads "An officer finds cover; it stays yours until then", which is what happens.
- The Open Swap / Specific Shift choice carries `aria-pressed` in a group named "Swap Type" (covered by a `MyShiftsTab.test.tsx` case).

**Not fixed because:** two decisions are the owner's:

- whether other members should see an open swap, and which ones: the same position, the same platoon, or anyone cleared for the seat;
- whether approval should release the seat.

The first is a visibility decision about other members' requests. Mirrored
into `docs/KNOWN_LIMITATIONS.md`.

**Owner decision and fix (2026-10-05):** offer an open swap to the members
eligible for the seat; a pickup moves the assignment.

- `GET /scheduling/swap-requests/open` lists pending open swaps the caller is
  cleared for, by the signup eligibility rule the two-way exchange check uses
  (`get_eligible_positions` through `_seat_in`); the Requests tab shows them
  under **Open shifts you can pick up**.
- `POST /scheduling/swap-requests/{id}/pick-up` moves the seat to the caller
  after the member signup window and the full `_validate_assignment_candidate`
  checks — eligibility, leave, overlap, EVOC and the seat cap. There is no
  override on this path.
- Officer approval of an open swap is refused and the Requests tab no longer
  offers it; deny still works. The dialog reads "Offered to members cleared for
  your seat; it stays yours until one picks it up".
- Covered by `backend/tests/test_open_swap_pickup.py`,
  `OpenSwapPickups.test.tsx` and `RequestsTab.test.tsx`.

### W33-5 — LOW — An answered request vanished and the list said "No requests" — ✅ FIXED

**Did:** `member` at 390×844, Requests, after both requests were approved.
**Saw:** "No swap requests" and "No time-off requests", with "Your swap
requests will appear here". The status filter defaults to Pending, so the
member's two approved requests were filtered out, and nothing said so. That
defeats the Learning Center's "track a request through to the answer" step.
**Where:** `frontend/src/pages/scheduling/RequestsTab.tsx:302`, `:456`.
**Fix:** a filtered empty list adds "Showing pending requests only. Choose All
Statuses to see the rest." Covered by a new `RequestsTab.test.tsx` case.
Re-driven at 390×844.

## Checklist

| Section                 | Result                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ sign up, request swap and time off, officer approves; open swap fixed W33-4 |
| 2. The right people     | ✅ `member2` 403/404 on another member's requests                              |
| 3. Wrong input, failure | ✅ double sign-up and double submits acted once; fixed W33-3 (double approve)  |
| 4. Browser signals      | Fixed W33-3 (a 400 from the second review); otherwise clean                    |
| 5. Coming back to it    | ✅ requests and assignments persist; fixed W33-5 (answered requests hidden)    |
| 6. On a phone           | ✅ Requests, My Shifts and the swap dialog at 390×844                          |
| 7. Everyone can use it  | Fixed W33-1; swap type state (W33-4)                                           |
| 8. What happens around  | ✅ approval notices, time off cancels the seat; fixed W33-2 and W33-4          |

## Completion gate

| Check                    | Result                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                            |
| npm run lint             | clean on the changed files                                                                                       |
| flake8 (changed files)   | no Python changed                                                                                                |
| black --check            | no Python changed                                                                                                |
| frontend tests (touched) | `pages/scheduling`, `modules/scheduling` — 54 files, 776 passed; top-level integrity tests — 13 files, 93 passed |
| backend tests (touched)  | none touched                                                                                                     |
