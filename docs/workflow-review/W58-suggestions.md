# Workflow Review — W58 Suggestion Boxes and Suggestions

**Driven:** 2026-10-13 · **As:** `admin`, `member`, `secretary`, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-13 plus this run's changes · **Database:** continued from W57

---

## What was driven

1. As `admin`, Communications → Suggestion boxes:
   - created "W58 Station Ideas" with the idea board on, reviewer Sam Ortiz
     (`secretary`), and no intake questions; "Save box" double-clicked;
   - Edit, with follow-up switched on;
   - a new box with only a name, to see whether Save allows it;
   - Delete on the box once it held submissions, then cancelled.
2. As `member`, Suggestions from the navigation:
   - a named submission, with Submit double-clicked;
   - an anonymous one, keeping its follow-up key.
3. As `secretary`:
   - the Review tab;
   - the named submission set to Accepted, with a response and an internal
     note; Save double-clicked;
   - a reply on the anonymous submission;
   - that submission published to the idea board in the reviewer's own
     words.
4. As `member`:
   - My submissions;
   - "Follow up with a key" with the saved key;
   - the notifications.
5. As `member2`:
   - the idea board, and a vote;
   - with `wr.api`, the named submission by id, the review endpoints and the
     box admin.
6. As `admin`, who manages boxes but reviews none: the review list, and the
   named submission by id.
7. At 390×844: the board and the submit form.

## Held up ✅

- **Double-clicks:** Save box, Submit and the reviewer's Save each acted
  once.
- **Anonymous submissions:**
  - the follow-up key is shown once, with a warning that it cannot be
    recovered;
  - the submission is not listed under My submissions;
  - in review it reads "Anonymous" with the date only;
  - the key opened the reviewer's reply, with no name anywhere.
- **What the submitter sees:** "Accepted" and the response. The internal note
  "Budget line 4.2" is not shown.
- **The idea board:**
  - it shows the reviewer's rewritten title and summary, not the
    submission;
  - one vote, named "Vote for Move morning rig checks earlier, 0 votes", is
    a toggle and survived a reload ("Remove your vote …, 1 vote").
- **Only reviewers read a box:**
  - `admin`, who manages boxes, got an empty review list and 404 on the
    submission;
  - `member2` got 404 on someone else's submission, an empty review list and
    403 on box admin.
- **Deleting a box that holds submissions:**
  - it says "This box holds 2 submissions";
  - it offers "Archive instead";
  - it requires typing the box name.
- **Notifications:** the reviewer had a notice per submission, and the
  submitter one when the status changed. Email is off in this install.
- **Phone:** no sideways overflow, and no small tap targets on the board or
  the submit form.

## Findings

### W58-1 — HIGH — Reviewers of a new box got no Review tab: the summary returned 500 — ✅ FIXED

**Did:** created a box on the admin screen with no intake questions (the
default), submitted to it as `member`, then opened Suggestions as
`secretary`, its only reviewer.
**Saw:**

- No Review tab.
- `GET /suggestions/review/summary` answered 500 twice. The log showed a
  `ResponseValidationError` on `boxes.0.intake_questions`: "Input should be a
  valid list", input `None`.
- A box that asks nothing stores NULL. `review_summary` returns the stored
  box rows directly, and `SuggestionBoxPublic.intake_questions` is a required
  list.
- The seeded Compliance box carries questions, which is why it never showed
  this.
- So every box made on this screen without questions was unreviewable: its
  reviewers were never shown the tab where submissions wait.

**Where:** `app/schemas/suggestion.py`, `SuggestionBoxPublic`.
**Fix:** a NULL question list reads as an empty one in that schema, so every
response that serialises a box is covered, not only the summary.
**Re-driven:** the Review tab appeared as "Review 2", and both submissions
were listed.

## Checklist

| Section                 | Result                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held end to end once fixed: create box, submit, review, reply, publish, vote. Fixed W58-1.                       |
| 2. The right people     | Held: only reviewers read; a box manager cannot; other members get 404.                                          |
| 3. Wrong input, failure | Held: Save and Submit stay disabled until required fields are filled; delete asks for the box name.              |
| 4. Browser signals      | One 500 (W58-1), fixed. No console errors.                                                                       |
| 5. Coming back to it    | Held: disposition, reply, publish and vote survive a reload; `?tab=` deep links open the right tab.              |
| 6. On a phone           | Held.                                                                                                            |
| 7. Everyone can use it  | Held: fields labelled; the vote button names the idea and its count; the screenshot drop zone is a named button. |
| 8. What happens around  | Held: reviewer and submitter notices (in-app; email off in this install).                                        |

## Completion gate

| Check                  | Result                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run typecheck      | clean (no frontend change)                                                                                                                                                                       |
| npm run lint           | clean (no frontend change)                                                                                                                                                                       |
| flake8 / black / isort | clean on `schemas/suggestion.py` and `tests/test_suggestion_summary_schema.py`                                                                                                                   |
| backend tests          | the suggestion suites (`test_suggestion_*`), 142 passed: 2 new, of which 1 fails on old code                                                                                                     |
| test database          | it predated a migration from today's merge (`audit_logs.chain_seq`), so 2 suggestion tests failed with and without this change; `alembic upgrade head` and `repair_schema.py` brought it current |
