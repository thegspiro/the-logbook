# Workflow Review — W50 An Election: Create, Nominate, Vote by Ballot Link, Close, Results

**Driven:** 2026-09-30 · **As:** `secretary`, then `member` and a signed-out voter · **Viewports:** 1280×900, 390×844
**Commit:** `99ef6f293` (the W46–W49 branch) plus this run's changes · **Database:** continued from W49

---

## What was driven

1. As `secretary`, `/elections` → Create Election:
   - submitted empty;
   - then "W50 Officer Election", 9/30 9:00 AM to 10/7 9:00 PM, positions Captain and Lieutenant, with Create double-clicked.
2. Nominations:
   - Open Nominations;
   - as `member` at 390×844, a self-nomination for Captain (Nominate double-clicked) and Alex Brooks nominated for Lieutenant.
3. As `secretary`:
   - Close Nominations;
   - Candidates → Add Candidate "Blair Carter" for Lieutenant, double-clicked;
   - Open Election, with Alex's nomination still pending.
4. As `member` at 390×844: Cast Vote, with Submit tried empty and then double-clicked.
5. The emailed ballot:
   - The officer election's Send Ballot Emails was disabled.
   - A second election, "W50 Bylaw Amendment", got a General Resolution ballot item (Add to Ballot double-clicked) and was opened.
   - Send Ballot Emails, with email off here.
   - A check-in after opening, then a voter override for Alex Brooks.
   - Resend.
6. `/ballot` as a signed-out voter at 390×844. Email is off, so a token was minted for Alex the way the send path mints one; only its hash is stored.
   - voted Approve, with Cast Ballot double-clicked;
   - then the same link again, a bad token and no token.
7. Close Election on the officer election, then its Results as `secretary` and as `member`.
8. As `member`:
   - the settings page and the create button;
   - create, close, add a candidate, send ballots, add an override and read settings through the API.

## Held up ✅

- **Validation:** an empty create was refused by the browser, and nothing was saved.
- **Double-clicks:** each of these made **one** row: Create Election, the self-nomination, Add Candidate, Add to Ballot, the member's vote, the override and the ballot link's vote.
- **Times:** 9:00 AM and 9:00 PM were stored as 14:00Z and 02:00Z the next day, and read back in the department's timezone.
- **Candidates:** a nomination still pending acceptance was left off the ballot.
- **The in-app vote:** Submit with nothing selected did nothing. The chosen candidate was marked pressed. Afterwards the position read "Vote submitted".
- **The ballot link:**
  - it asked for confirmation before casting, and gave a receipt;
  - the same link again read "already been fully submitted";
  - a bad token and no token were refused;
  - no horizontal scroll at 390×844.
- **Closing:** Close Election asked first.
- **`member`:**
  - saw no create or manage controls, and got Access Denied on settings;
  - got 403 on every write and on settings;
  - no horizontal scroll at 390×844.

## Findings

### W50-1 — LOW — Clicking Add after typing a position did nothing — ✅ FIXED

**Did:** Create Election, typed "Captain" in Positions, clicked Add.
**Saw:** the click did not reach Add. While the suggestions were open, a full-screen, invisible click-away layer covered the whole dialog. The first click only closed the list and the typed position was not added; any other control clicked first was lost the same way.
**Where:** `frontend/src/pages/ElectionsPage.tsx:840`.
**Fix:** the layer is removed, and the list closes when the field loses focus. The options already commit on mousedown and prevent the blur, so a pick is not lost. Covered by new cases in `ElectionsPage.createForm.test.tsx`.

### W50-2 — LOW — The start and end times had the same names — ✅ FIXED

**Did:** read the create form's accessibility tree.
**Saw:** both time pickers announced "Time hour", "Time minute" and "Time AM/PM". The same was true of Edit Dates and Extend Time.
**Where:** `ElectionsPage.tsx:698`, `EditDatesModal.tsx`, `ExtendElectionModal.tsx`.
**Fix:** the pickers already accept a `timeLabel`, which none of these passed. They now read "Start time hour", "End time hour", "Voting opens time hour" and so on. The create form also passes the department timezone. Covered by a new case.

### W50-3 — LOW — A plurality election was described as "Simple Majority" — ✅ FIXED

**Did:** created the election with "Most Votes Wins (Plurality)", then opened its page.
**Saw:**

- The page read "Voting Method: Simple Majority".
- The create form stores every one-choice rule as `voting_method: simple_majority` and puts the actual rule in `victory_condition`, which the page did not show.
- A secretary checking the rule saw the wrong one.

**Where:** `frontend/src/pages/ElectionDetailPage.tsx:1123`.
**Fix:** Voting Method reads "One choice per voter", "Ranked choice" or "Approval". A new Winner row uses the existing `getVictoryDescription` ("Most Votes (Plurality)"). Covered by the new `ElectionDetailPage.loaded.test.tsx`.

### W50-4 — MED — Only the selected election tab could be reached by keyboard — ✅ FIXED

**Did:** the election page's tabs (Ballot, Nominations, Candidates, Eligibility, Attendance, Overrides, Proxy Voting, Cast Vote, Results).
**Saw:**

- Every tab but the selected one was `tabIndex=-1`, with no arrow-key handling, so a keyboard could not reach Candidates, Overrides or Results.
- Each tab's `aria-controls` pointed at a panel id that did not exist.

**Where:** `frontend/src/modules/elections/components/ElectionWorkflowTabs.tsx:122` and the panels in `ElectionDetailPage.tsx`.
**Fix:**

- The Left and Right arrows, Home and End move between tabs and take focus with them (the WAI-ARIA tabs pattern).
- The panels sit in a `tabpanel` labelled by its tab.

Covered by new cases in `ElectionWorkflowTabs.test.tsx` and `ElectionDetailPage.loaded.test.tsx`. Re-driven: ArrowLeft from Results focused and selected Proxy Voting.

### W50-5 — LOW — The lifecycle stepper read as bare numbers on a phone — ✅ FIXED

**Did:** the election page at 390×844.
**Saw:**

- The stepper read "2 3 4". Its labels are hidden under 640px, and nothing marked the current step.
- In nominations the Draft step shows a check mark rather than a number, so the numbering started at 2.

**Where:** `ElectionDetailPage.tsx:952`.
**Fix:**

- The stepper is a list named "Election progress", with the current step marked `aria-current="step"`.
- The labels stay visually hidden on a phone but are kept for a screen reader.
- The circles and connectors are hidden from assistive technology.

Covered by the new test.

### W50-6 — MED — A voter override needed the member's user ID — ✅ FIXED

**Did:** Overrides → + Add Override.
**Saw:**

- The form asked for "Member User ID", a UUID that no screen shows a secretary.
- Once an override was added, it was listed by that UUID. The server sends the name as `member_name`; the screen read `user_name`.

**Where:** `frontend/src/components/VoterOverrideManagement.tsx:139`; `frontend/src/types/election.ts`, `VoterOverride`.
**Fix:**

- The member is chosen from a list of active and probationary members, as the candidate picker lists them. Members who already have an override are left out.
- The type now matches the server, so the list and the remove buttons name the member.

Covered by the new `VoterOverrideManagement.test.tsx`. Re-driven: Alex Brooks picked by name, and listed by name.

### W50-7 — LOW — The candidate form, the ballot builder and the attendance list named nothing — ✅ FIXED

**Did:** Add Candidate; Ballot → Use Template → General Resolution; Attendance.
**Saw:**

- The candidate form's Position select had no name. Member search, Name and Statement were announced by their placeholders.
- The template's Title / Topic field, and all 13 fields of the ballot item and custom item forms, were named by placeholder or not at all.
- Every attendance row's button read "Check In", and the search box had no name.

**Where:**

- `frontend/src/components/CandidateManagement.tsx:265`;
- `frontend/src/components/BallotBuilder.tsx:341`, `:984`, `:1211`;
- `frontend/src/components/MeetingAttendance.tsx:223`.

**Fix:** each label is tied to its field, and each button reads "Check in Alex Brooks". Covered by the new `ElectionPanels.test.tsx`.

### W50-8 — LOW — The ballot-email controls did not tell the secretary what was happening — ✅ FIXED

**Did:** the open officer election; then Send Ballots on the bylaw election with email off.
**Saw:**

- Send Ballot Emails was disabled, and the only reason was a hover `title`. A phone, a keyboard or a screen reader never shows one.
- The locked ballot tab still said "Add items from a template…" with no buttons.
- The send reported "eligibility summary emailed to you" although email is off and no summary went. The endpoint ignored what the summary send returned.

**Where:** `ElectionDetailPage.tsx:1448`; `BallotBuilder.tsx:1119`; `backend/app/api/v1/endpoints/elections.py:2500`.
**Fix:**

- The reason is shown on the page and describes the button.
- The locked empty ballot says it cannot change and that members vote in the app.
- The summary line reports whether the email actually went, through a new `ballot_send_message`.

Covered by `ElectionDetailPage.loaded.test.tsx` and the new `test_ballot_send_message.py` (unit). Re-driven: "The eligibility summary email could not be sent" (capitalised since the re-drive).

### W50-9 — MED — A member checked in after the election opens cannot vote — 🚩 FLAGGED

**Did:** on the open bylaw election (attendance required), checked in Jordan Avery; then Cast Vote as `member`.
**Saw:**

- Refused: "You are not on the voter roll that was frozen when this election opened".
- Send Ballots skipped all 27 members for the same reason, because nobody was checked in when it opened.
- The Attendance tab offers Check In throughout voting.

**Where:** `backend/app/services/election_service.py:5142` (the roll is frozen at opening) and `:6203`.
**Flagged:** whether a late arrival may vote is a question of who is authorized to vote. The Attendance tab now says a check-in after opening does not add a voter, and points to the override. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W50-10 — MED — Results of an election closed early stay hidden until its scheduled end — 🚩 FLAGGED

**Did:** closed the officer election on 9/30, whose scheduled end is 10/7 9:00 PM. Opened Results as `secretary` and as `member`.
**Saw:**

- `GET /results` returned 403 "Results not available yet" for both, and the tab showed that with an error code.
- Results require the closed status **and** the scheduled end to have passed. Closing does not move the end date.

**Where:** `backend/app/services/election_service.py:2517`.
**Flagged:** whether an early close should release results, and to whom, is a visibility decision. The tab now says "Voting is closed. Results will be available after the scheduled end, Wednesday, October 7, 2026 at 9:00 PM." Mirrored into `KNOWN_LIMITATIONS.md`.

### W50-11 — LOW — An election on positions alone cannot email ballots, found out only after opening — 🚩 FLAGGED

**Did:** the officer election, built from positions and candidates as the create form offers, and then opened.
**Saw:**

- Members could vote in the app.
- Ballot emails need ballot items: `/ballot` renders items only. The ballot is locked once voting opens, so this election can never be emailed.
- Nothing said so before Open.

**Flagged:** whether Open should warn, or positions should become ballot items, is a product choice. The page now says it (W50-8). Mirrored into `KNOWN_LIMITATIONS.md`.

### W50-12 — NIT — The lifecycle buttons disagree about undoing — OPEN

Open Nominations, Close Nominations and Open Election each act on one click, with no confirmation. Close Election asks first and says "this cannot be undone", although Roll Back reopens a closed election.

### W50-13 — NIT — Reopening a used ballot link reads as a failure — OPEN

The link after voting shows "Unable to Load Ballot — This ballot has already been fully submitted (Error code: LB-API-400)". The voter has done nothing wrong.

## Checklist

| Section                 | Result                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 1. The job gets done    | Create, nominate, candidates, open, vote in app and by link, close; W50-11 flagged  |
| 2. The right people     | ✅ member refused every manage call and page; W50-9 flagged                         |
| 3. Wrong input, failure | ✅ empty create refused; seven double-clicks acted once; bad and used links refused |
| 4. Browser signals      | 403 on results after close (W50-10)                                                 |
| 5. Coming back to it    | ✅ votes, overrides and attendance read back from the API                           |
| 6. On a phone           | Fixed W50-5; no horizontal scroll on any page                                       |
| 7. Everyone can use it  | Fixed W50-1, W50-2, W50-4, W50-6, W50-7                                             |
| 8. What happens around  | Fixed W50-3, W50-8; W50-10 flagged; W50-12, W50-13 open                             |

Afterwards, both W50 elections are left in the review database: the officer election closed, the bylaw election open with one override and one vote.

## Completion gate

| Check                    | Result                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                           |
| npm run lint             | clean                                                                                                           |
| flake8 / black / isort   | clean on the changed Python                                                                                     |
| frontend tests (touched) | election pages and components, `modules/elections`, the date-time pickers: 19 files, 81 passed, no local server |
| backend tests (touched)  | `-k "ballot or election"`: 598 passed, 1 skipped (py_vapid not installed)                                       |
