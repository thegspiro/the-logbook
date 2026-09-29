# Workflow Review — W31 The Learning Center Orientation

**Driven:** 2026-09-29 · **As:** `member`, with `member2` for isolation · **Viewports:** 1280×900, 390×844
**Commit:** `d3b553000` plus this run's changes · **Database:** continued from W30

---

## What was driven

1. As `member`, `/learning`: the six lessons and "0 of 19 tasks".
2. Every screen a lesson step links to:
   - `/dashboard` and `/account?tab=account`;
   - `/notifications?tab=inbox`;
   - `/account?tab=app` and `/account?tab=notifications`;
   - the three scheduling tabs, `/inventory/my-equipment` and `/training/my-training`.

   Each lesson's "How to do it" was read against what the screen renders.

3. At 390×844:
   - `/learning/getting-started`: marked two steps complete, reloaded, then read the index;
   - Reset progress;
   - `/learning/gear` → My Sizes, where Shirt Size and Pant Waist were entered and Save Sizes was double-clicked.
4. As `member2`:
   - the dashboard's orientation prompt → Start;
   - then `/learning`.

## Held up ✅

- **Progress:**
  - It survives a reload: "2 of 4 complete" in the lesson and "2 of 19 tasks" on the index.
  - It is stored per member (`logbook.learning-progress.v2.<user id>`).
  - `member2` saw "0 of 19 tasks".
- **Links:**
  - The orientation prompt's Start opens `/learning/getting-started`.
  - Every "Open the screen" destination resolved to a real page for a member.
- **Accessibility:** step checkboxes and "Open the screen" links are named per step. The progress bar has a value text.
- **Layout:** the index and a lesson fit 390px (no horizontal overflow).
- **Sizes:** a double-clicked Save Sizes stored one record (`shirt_size m`, `pant_waist 34`).

## Findings

### W31-1 — LOW — Lessons named controls the screens do not have — ✅ FIXED

**Did:** `member`, each lesson against its screen.
**Saw:** the lessons promise to name controls "exactly as they appear on
screen", but several did not.

| Lesson step                     | The lesson said                                      | The screen shows                                                                                           |
| ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Getting Started → dashboard     | "Next 7 days list"                                   | "Next 30 Days"                                                                                             |
| Getting Started → notifications | "your Inbox"                                         | "My Notifications"                                                                                         |
| Phone → push                    | "Enable push notifications"                          | "Push Notifications on This Device", absent when the server has no push keys, which the lesson did not say |
| Scheduling → my shifts          | "confirmed or still tentative"                       | "Assigned" with a Confirm button; the lesson never said to press it                                        |
| Scheduling → open shifts        | "Claim one"; "a shift you cannot claim will say why" | "Sign Up" → "Confirm Sign Up"; the dialog says "not eligible", not why                                     |
| Gear → request                  | "Open My Requests and submit a request"              | My Requests only lists; the control is "Request Equipment"                                                 |
| Gear → sizes                    | "where the screen asks for them"                     | behind "My Sizes", saved with "Save Sizes"                                                                 |

**Where:** `frontend/src/pages/learning/learningPaths.ts:68`, `:92`, `:151`,
`:269`, `:280`, `:326`, `:337`.
**Fix:** each instruction now quotes the control as rendered.

- Dashboard and notifications carry this run's wording.
- The push, scheduling and gear steps were corrected independently on `main` while this run was open, so the merge keeps `main`'s wording there.

Covered by a new case in `learningPaths.test.ts`. It ties each quoted label
to the source file that renders it, so renaming either side fails, and it
fails against the old text. Re-driven: the gear lesson reads "Press My Sizes,
enter what you know, and Save Sizes."

### W31-2 — LOW — "Reset progress" discarded every tick in one tap — ✅ FIXED

**Did:** `member` at 390×844, with two tasks complete, pressed Reset progress.
**Saw:** "0 of 19 tasks" at once, with no confirmation and no undo. The
progress lives only in this browser, so there is no copy to restore.
**Where:** `frontend/src/pages/learning/LearningCenterPage.tsx:14`.
**Fix:** it asks first through `useConfirm()`:

- title "Reset your progress?";
- message "This clears the 1 task you have completed, in every lesson. It cannot be undone.";
- buttons "Keep my progress" and "Reset progress".

Covered by two cases in `LearningCenterPage.test.tsx`, confirm and back out,
both failing against the old page. Re-driven: backing out kept "1 of 19 tasks".

### W31-3 — LOW — The My Sizes dialog's fields had no accessible names — ✅ FIXED

**Did:** `member`, the gear lesson → My Sizes.
**Saw:** only Fit was labelled. Shirt, Jacket and Boot Size, Pant Waist and
Inseam, Boot Width, Glove Size and Hat Size were named by placeholders or
nothing. `getByLabel("Shirt Size")` found no control.
**Where:** `frontend/src/modules/inventory/components/SizePreferencesModal.tsx:213`
and the fields after it.
**Fix:** each label is tied to its control (`size-prefs-<field>`, matching
the existing `size-prefs-garment-fit`). Covered by a new case in
`SizePreferencesModal.test.tsx` (fails against the old dialog). Re-driven:
the sizes were entered by label.

### W31-4 — NIT — Opening My Sizes before any are saved logs a 404 — OPEN

`GET /inventory/my/size-preferences` answers 404 "Size preferences not set"
for a member with none. The dialog treats it as an empty form, as its test
documents, but the browser logs a failed request on a normal first visit.
Left: answering 200 with an empty body changes a response contract that the
admin variant shares.

## Checklist

| Section                 | Result                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| 1. The job gets done    | Fixed W31-1 (instructions that pointed at missing controls)       |
| 2. The right people     | ✅ progress per member; `member2` starts at 0                     |
| 3. Wrong input, failure | Fixed W31-2 (unconfirmed reset); double Save Sizes stored one row |
| 4. Browser signals      | W31-4 (an expected 404 logged); otherwise clean `events`          |
| 5. Coming back to it    | ✅ progress survives reload                                       |
| 6. On a phone           | ✅ index and lessons at 390×844                                   |
| 7. Everyone can use it  | ✅ lesson controls named per step; fixed W31-3                    |
| 8. What happens around  | ✅ the dashboard prompt opens the first lesson                    |

## Completion gate

| Check                    | Result                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                  |
| npm run lint             | clean on the changed files                                                             |
| flake8 (changed files)   | no Python changed                                                                      |
| black --check            | no Python changed                                                                      |
| frontend tests (touched) | `modules/inventory`, `pages/learning`, `components/dashboard` — 111 files, 1535 passed |
| backend tests (touched)  | none touched                                                                           |
