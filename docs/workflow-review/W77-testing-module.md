# Workflow Review — W77 The Testing Module and Its Printed Report

**Driven:** 2026-10-22 · **As:** `admin`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-22 plus this run's changes · **Database:** continued from W76

---

## What was driven

1. As `admin`, Testing home (`/testing`):
   - Start a new run, accepting the suggested label;
   - in the Core section, Dashboard marked Pass (double-clicked), Org Chart
     marked Fail with a note, Learning Path marked Blocked, then a reload;
   - `j` then `p` from the keyboard.
2. As `member`:
   - the same page, and the admin-only actions through the API (read every
     tester, start a run, clear everyone);
   - `/admin/audit-log` opened in a new tab, then that page's card marked,
     first Pass and then Blocked;
   - Org Chart marked Pass with a note.
3. As `admin`:
   - the combined run, and the other tester's mark and note;
   - Print report, Download CSV, Download Markdown;
   - a second run, "W77 second pass", then the first run opened from the
     picker;
   - Clear my marks and Clear everyone, each cancelled, then Clear everyone
     confirmed, then the audit log.
4. At 390×844, as `member` and `admin`: the testing home with every section
   expanded, and the printed report.

Not driven: Copy Markdown (clipboard), the permission-matrix export, the
module switched off (the router's `module_gate` was read from code), and
parameterised pages with a sample id.

## Held up ✅

- **Gates:**
  - a member sees no Start a new run or Clear everyone, and gets 403 for
    reading every tester, starting a run and clearing everyone;
  - `/admin/audit-log` refused the member, as the card predicted.
- **Marks:**
  - each mark and note survived a reload;
  - a second press on an active result clears it (a toggle, with
    `aria-pressed`);
  - `j` then `p` marked the focused card.
- **The combined view:** "Across 2 testers, 3 of 287 pages", "1 gate refusal
  verified · 1 to confirm", and the other tester's seat (Member, firefighter).
- **Report and exports:** the printed report, the CSV and the Markdown agree
  with the page. A page one tester passed and another failed counts as
  failed, and every mark is a CSV row with its tester, seats, build and time.
- **History:** the first run reads "archived", says marking is disabled, and
  every control is disabled; Back to the current run returns.
- **Clearing:** both clears ask first. Clear everyone deleted both marks and
  wrote `testing_checklist_cleared` (`deleted: 2`) under `review_admin`.

## Findings

### W77-1 — MED — Recording a correct refusal as Pass was reported as a permissions defect — ✅ FIXED

**Did:** as `member`, met Access Denied on the audit log, exactly as the
card said ("this page should refuse with Access Denied"), and marked the card
Pass.
**Saw:** the card turned red: "Opened when it should have refused — worth
reporting as a permissions defect." The verdict reads Blocked as "it refused"
and Pass as "it opened" (`gateVerdict.ts`). Nothing on the card, the page or
TESTING_CHECKLIST.md said so, so the natural mark produced a false gate
finding, counted in the report's "Gate mismatches".
**Fix:** the card for a page that should refuse now ends "Mark Blocked if it
refuses; Pass means it opened." A switched-off module's card says the same,
and the page's instructions add "Mark a refusal Blocked and a page that opened
Pass." The stored statuses and the verdict are unchanged.
**Where:** `components/TestPageCard.tsx`, `pages/TestingChecklistPage.tsx`.
`TestPageCard.w77.test.tsx`.

### W77-2 — LOW — Another tester's note could not be read on a phone — ✅ FIXED

**Saw:** the member's note on Org Chart reached the admin only as a `title`
tooltip on the member's badge. A tooltip never appears on a touch screen and
is not reliably read out.
**Fix:** the note is shown under the badge. Re-driven at 390×844: "Chief card
text clips at 390px".

### W77-3 — LOW — The Markdown summary disagreed with the report — ✅ FIXED

**Saw:** "Gates: 1 refusal(s) verified, 0 mismatch(es)". The page and the
printed report also gave "1 to confirm", and the Markdown left it out, so the
summary pasted into an issue disagreed with the report.
**Fix:** "Gates: 1 refusal verified, 0 mismatches, 1 to confirm", with real
plurals there and in "… marks made against an earlier build".
**Where:** `useTestingChecklist.ts` `toMarkdown`.

### W77-4 — LOW — Clear everyone counted 0 testers — ✅ FIXED

**Saw:** after the first mark of a new run, Clear everyone read "deletes every
mark and note from 0 testers". Clear my marks read "your 1 marks".
**Where:** `testerCount` was held from the last load, and the server reported
0 before the first mark.
**Fix:** the count is derived from the marks on screen, the way the server
counts them: distinct authors of the rows. Plurals fixed. Re-driven: "from 1
tester".

### W77-5 — LOW — Both pages scrolled sideways on a phone — ✅ FIXED

**Saw:** at 390×844 the testing home was 398px wide and the printed report
485px wide.

- **Testing home:** a card's URL (`truncate`, so unbreakable) widened its
  grid item, because a single implicit grid column sizes to content.
- **Report:** the "Coverage by area" table needs about 440px.

**Fix:**

- The card grid is `grid-cols-1` below `sm`.
- The report's tables sit in labelled, focusable scroll regions
  (`data-mobile-scroll-region`), which does not affect printing.

Re-driven: both pages are 375px wide (the viewport without its scrollbar).

## Checklist

| Section                 | Result                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ runs, marks, history, report, CSV and Markdown                               |
| 2. The right people     | ✅ member refused on screen and through the API; the gate predicted held        |
| 3. Wrong input, failure | ❌ → ✅ the expected mark for a refusal produced a false defect; guidance added |
| 4. Browser signals      | ✅ clean                                                                        |
| 5. Coming back to it    | ✅ marks after a reload and from the other account; archived run read-only      |
| 6. On a phone           | ❌ → ✅ sideways scroll on both pages; fixed                                    |
| 7. Everyone can use it  | ❌ → ✅ another tester's note was tooltip-only                                  |
| 8. What happens around  | ❌ → ✅ Markdown and dialog counts disagreed with the page; clear audited       |

## Completion gate

| Check                    | Result                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                                                                                                                           |
| npm run lint             | ✅ clean, run with `NODE_OPTIONS=--max-old-space-size=8192`. With this container's 2 GB default heap ESLint aborts (out of memory, exit 134) before reporting; it needs about 3.5 GB across 2,350 files. See the lead in PROGRESS. |
| flake8 / black           | n/a: no backend change                                                                                                                                                                                                             |
| frontend tests (touched) | ✅ `src/modules/testing` 110 passed; the 5 new tests fail without the fixes                                                                                                                                                        |
