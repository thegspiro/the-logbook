# Workflow Review — W52 Action Items: Assign, Work, Close

**Driven:** 2026-10-04 (00:50 UTC, which is 7:50 PM on 3 Oct in Chicago) · **As:** `secretary`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `80a4ec3` plus this run's changes · **Database:** continued from W51

---

## What was driven

1. As `secretary`: More → **Action Items** is in the navigation. On the draft
   October minutes from W51, two action items were added:
   - "Order replacement hose", assigned to "Jordan Avery" (the `member`
     account's name), due 4 Oct;
   - "Schedule pump test", assigned to "Quartermaster", due 10 Oct.
2. `/action-items`: the list, the tiles, the status filter (Open, Pending), and
   whether a row can be reached by keyboard.
3. **Working an item:** the status control on the minutes page set "Order
   replacement hose" to In Progress, and the list was read back.
4. As `member`:
   - `/action-items`, then "Assigned to me";
   - a `PUT` marking an item on approved minutes complete;
   - the minutes page's controls.
5. After the fixes, steps 2–3 again, the Minutes page's open-items tile, and
   `/action-items` at 390×844.

The page's own scope: Action Items is a read-only list. An item is created and
worked on the minutes page, which W51 drove. Meeting action items have a
service but no screen anywhere, so none were driven.

## Held up ✅

- **Working an item:** a status change on the minutes page showed on Action
  Items after a reload.
- **Member visibility:** `member` saw only items on approved, non-executive
  minutes. The draft's items, one of them assigned to them by name, were
  correctly withheld.
- **Phone:** no sideways overflow at 390px, and each row is a 104px-tall
  target.
- **Browser signals:** no console errors and no failed requests apart from the
  deliberate 403 below.

## Findings

### W52-1 — MED — Every due date read a day early — ✅ FIXED

**Saw:** items due 4, 10 and 15 Oct read 10/3, 10/9 and 10/14. Minutes items
arrive as `2026-10-04T00:00:00+00:00`, and `formatDate(…, tz)` converted that
to Chicago time. This is the W51-5 bug on a second screen, as the lead
predicted.
**Where:** `ActionItemsPage.tsx`, the due-date cell.
**Fix:** `formatCalendarDate`, which reads the date part for both shapes (a
minutes item's UTC midnight, and a meeting item's bare `DATE`). Re-driven:
"Oct 4 / Oct 10 / Oct 15, 2026".

### W52-2 — MED — An item counted as overdue the evening before its due day — ✅ FIXED

**Saw:** at 7:50 PM on 3 Oct, the item due 4 Oct counted in Overdue (1) and
was coloured red. `new Date(due) < new Date()` compared UTC midnight with the
clock.
**Fix:**

- "Overdue" and "due within 3 days" now compare the calendar day with today on
  the department's calendar (`calendarDaysFromToday`).
- Closed means completed or cancelled for both counts.
- Re-driven: Overdue 0.

### W52-3 — MED — The "Open" filter showed nothing beside an Open tile of 3 — ✅ FIXED

**Saw:** "Open" sent `status_filter=open`, which only meeting items carry.
Minutes items are `pending`, `in_progress` or `overdue`, so the filter returned
0 rows while the Open tile beside it counted 3.
**Fix:**

- "Open (not done)" fetches everything and keeps what is not completed or
  cancelled. That is the same rule the tile uses.
- The other status options still filter on the server.
- Re-driven: 3 items.

### W52-4 — MED — Rows could not be reached by keyboard — ✅ FIXED

**Saw:** each row was a `div` with an `onClick`. It was not focusable and not
announced as a link: the nearest focusable ancestor was `<main>`.
**Fix:** each row is a `Link` to its minutes. Meeting items go to `/minutes`,
as before. Re-driven: focused, Enter opened the minutes.

### W52-5 — LOW — The Minutes page's "Open action items" tile left out minutes items — ✅ FIXED

This was the lead from W51. The tile read the meetings summary only, so open
minutes items left it at 0. It now adds the minutes stats' own open count;
each figure is still computed by its service. Re-driven: 3.

### W52-6 — MED — Nothing can be assigned to a member, so "Assigned to me" never matches — FLAGGED

**Saw:**

- The only screen that creates action items (the minutes page) takes a typed
  assignee name. `assignee_id` stays null, so "Assigned to me" showed 0 for
  `member` although an item named them.
- Meeting action items, which carry `assigned_to`, have no screen at all.

**Why flagged:** the fix is a member picker on the minutes form, which sets
`assignee_id` alongside the name. Who may be assigned (any member, or only
officers), and what happens to items already assigned by name, are product
decisions. In `KNOWN_LIMITATIONS.md`.

### W52-7 — MED — An assignee cannot mark their own item done — FLAGGED

**Saw:** `member`'s `PUT …/action-items/{id}` with `status: completed` got 403.
Every action-item update needs `minutes.manage`, and the member is offered no
status control. So "assign → work → close" ends with a secretary closing every
item on the assignee's behalf.
**Why flagged:** this widens a write permission, so it is the owner's call.
One option: let the assignee change status and completion notes only, keyed on
`assignee_id`, which needs W52-6 first. In `KNOWN_LIMITATIONS.md`.

## Checklist

| Section                 | Result                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Partly: items are created and worked by the secretary. Members cannot be assigned or close items (W52-6, W52-7, flagged). |
| 2. The right people     | Held: the member sees approved minutes' items only, and gets a 403 on writes.                                             |
| 3. Wrong input, failure | n/a: the page is read-only. Item validation was covered by W51.                                                           |
| 4. Browser signals      | Clean.                                                                                                                    |
| 5. Coming back to it    | Held: a status change survived a reload.                                                                                  |
| 6. On a phone           | Held.                                                                                                                     |
| 7. Everyone can use it  | Fixed W52-4.                                                                                                              |
| 8. What happens around  | Dates fixed (W52-1, W52-2). No notifications are involved.                                                                |

## Completion gate

| Check                    | Result                                                  |
| ------------------------ | ------------------------------------------------------- |
| npm run typecheck        | clean                                                   |
| npm run lint             | clean                                                   |
| flake8 / black           | n/a: no Python changed                                  |
| frontend tests (touched) | `ActionItemsPage*` and `src/modules/minutes`: 44 passed |
| frontend tests (full)    | 715 files, 9051 tests passed                            |
| backend tests            | n/a: no backend change                                  |
