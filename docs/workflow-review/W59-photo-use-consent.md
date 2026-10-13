# Workflow Review — W59 Photo-Use Consent

**Driven:** 2026-10-13 · **As:** `member`, `member2`, `admin`, plus an access probe of seven officer roles · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-13 plus this run's changes · **Database:** continued from W58

---

## What was driven

1. Bringing the harness up on today's `main` (W59-1).
2. As `member`: My Account → Privacy → Privacy Choices. Ticked "Photo use",
   then reloaded.
3. As `member2`: the same box from "not answered". The only way to record a
   "no" is to tick it and untick it, so that is what was done. Then reloaded.
4. As `admin`, from the Admin menu → Photo Use Consent:
   - the tiles, the coverage bar and both members' rows;
   - the Declined tile as a filter, its chip, and "Clear all";
   - search, with a match and with no match, and "Clear filters";
   - sorting by the Photo use column;
   - "Include inactive members".
5. With `wr.api`, `GET /users/consents/photo-use` as `member`, `chief`,
   `secretary`, `membership_coordinator`, `training_officer`,
   `scheduling_officer`, `quartermaster` and `treasurer`. Then the page as
   `member`, and the menu link as three roles.
6. At 390×844: the roster with a status filter and a search, the sort
   control, the chips, and keyboard focus after a chip is removed.

## Held up ✅

- **The member's choice reaches the roster.** Jordan Avery read "Agreed" and
  Alex Brooks "Declined", each dated 10/13/2026. The tiles read 1 / 1 / 18,
  and "2 of 20 answered". Both choices survived a reload on the member's
  side.
- **Read-only:** the page offers no way to change a member's choice.
- **Who can see it:**
  - the API gave 200 to `chief`, `secretary`, `membership_coordinator` and
    `training_officer`, and 403 to `member`, `scheduling_officer`,
    `quartermaster` and `treasurer`;
  - the menu link shows for `training_officer` and is absent for
    `scheduling_officer` and `member`;
  - `member` typing the URL got "Access Denied" with "Return to Dashboard".
- **Filters:**
  - a tile filters and shows a chip;
  - a search with no match shows "No members match these filters", and
    "Clear filters" brings the roster back.
- **Phone:**
  - no sideways overflow, and the table reflows to cards;
  - the "Sort members" select drives the same ordering as the column
    headers.
- **Browser signals:** no console errors and no failed requests.
- **Focus:** removing a chip drops focus to the page body, but the next Tab
  lands on "Clear all", so a keyboard user keeps their place.

## Findings

### W59-1 — HIGH — `main` had two Alembic heads, so no install could upgrade — ✅ FIXED

**Did:** ran `scripts/workflow-review/start.sh` after merging today's `main`.
**Saw:**

- "Multiple head revisions are present for given argument 'head'". The
  schema did not build, and nothing started.
- The same two heads on a clean checkout of `origin/main`:
  - `cc91959dbaff` (crew-recorded training submissions);
  - `05ec84735fcf`, an empty merge.
- Both name `3decd3ff6ce5` and `5b2e9c7d4a18` as their parents: two pull
  requests merged the same fork independently.
- `test_alembic_migrations.py`'s two single-head tests fail on that tree.

**Where:** `backend/alembic/versions/`.
**Fix:** `20261013_2044_7a6684f8b975`, an empty merge of the two heads.
Published revisions are frozen, so neither was edited. Committed and pushed
on its own (`51e8aff3b`) ahead of the rest of this run.
**Re-checked:**

- `alembic heads` lists one;
- the review and test databases upgraded;
- the harness started;
- the two tests fail with the file moved away and pass with it.

### W59-2 — MED — The roster sent members to the wrong place to answer — ✅ FIXED

**Did:** read the page's introduction, then looked for the choice as
`member`.
**Saw:**

- The page says members answer "under Settings → Security → Privacy
  Choices".
- Security is the two-factor section, with nothing about photos.
- The choice is under My Account (the menu's name for the page) → Privacy.
- The page's own guidance is that a PIO can still ask the 18 who have not
  answered. Sending them to the wrong section is what they would be told.

**Where:** `PhotoUseConsentPage.tsx`, the introduction.
**Fix:** the sentence now reads "under My Account → Privacy → Privacy
Choices".
**Re-driven:** the new wording shows at both widths.

### W59-3 — MED — A member cannot record "no" without first saying "yes" — 🚩 FLAGGED

**Did:** as `member2`, opened Privacy Choices with photo use unanswered.
**Saw:**

- The choice is one checkbox, unticked and marked "(not answered)".
- Leaving it unticked records nothing. The only way to reach "Declined" is
  to tick it, which records an agreement, and then untick it.
- The audit ledger therefore shows a member who agreed before declining,
  which they never did.
- A member who means "no" and does not know the trick stays "Not answered".
  The roster's tile says those members "can still be asked", so the PIO keeps
  asking somebody who has already refused.

**Where:** `UserSettingsPage.tsx`, the Privacy Choices list. The same
control carries "Public roster listing" and the SMS consent.
**Why flagged, not fixed:** an explicit Yes / No choice is the obvious shape,
but it changes the consent screen for all three choices. One of them is a
TCPA record, and its switch also drives the SMS preference through a shared
handler. How a recorded "no" is offered, and whether the SMS one changes
with it, is the owner's decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W59-4 — LOW — The filter controls were 16–20px tap targets on a phone — ✅ FIXED

**Saw at 390×844:**

| Control                    | Height |
| -------------------------- | ------ |
| Each chip's clear button   | 18px   |
| "Clear all"                | 16px   |
| "Include inactive members" | 20px   |
| Each member's name link    | 20px   |

**Fix:**

- These are 44px on a phone or touch screen.
- The chip's circle is drawn inside its button, so the chip stays 30px tall.

**Re-driven:** no control in the page body is under 44px at 390×844.

## Checklist

| Section                 | Result                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1. The job gets done    | Held: members' choices reach the roster. Fixed W59-2 (the page sent members to the wrong section). Flagged W59-3.                    |
| 2. The right people     | Held: API, page and menu agree for every role tried.                                                                                 |
| 3. Wrong input, failure | n/a on the roster (read-only). On the member side, see W59-3.                                                                        |
| 4. Browser signals      | Held: none.                                                                                                                          |
| 5. Coming back to it    | Held: the member's choice survives a reload. The roster's filters are page state, not in the address, which suits a read-only check. |
| 6. On a phone           | No overflow; cards reflow; sort works. Fixed W59-4.                                                                                  |
| 7. Everyone can use it  | Held: tiles are pressed-state buttons, the bar has a spoken summary, and every filter is labelled.                                   |
| 8. What happens around  | Held: each choice is dated on the roster.                                                                                            |

## Completion gate

| Check                    | Result                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| npm run typecheck        | clean                                                                                                        |
| npm run lint             | clean                                                                                                        |
| flake8 / black / isort   | clean on the new migration                                                                                   |
| frontend tests (touched) | `src/modules/communications`: 261 passed (2 new, both failing on old code); `touchTargetIntegrity` passed    |
| backend tests            | `test_alembic_migrations.py`: 21 passed; its 2 single-head tests fail without the new merge revision (W59-1) |
