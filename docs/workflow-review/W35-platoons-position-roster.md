# Workflow Review — W35 Platoons and the Position Qualification Roster

**Driven:** 2026-09-29 · **As:** `scheduling_officer`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `91286cee1` plus this run's changes · **Database:** continued from W34

---

## What was driven

1. As `scheduling_officer`, `/scheduling/admin/platoons`:
   - The page read "Platoon scheduling is turned off for your department", with one member on Platoon A and 26 unassigned.
   - Selected Jordan Avery and Alex Brooks, chose Platoon B and double-clicked Assign to platoon, then reloaded.
   - At 390×844, selected Alex Brooks and pressed Clear platoon.
2. `/scheduling/admin/positions` ("Who Can Fill What"):
   - Driver/Operator, then Firefighter, at 1280×900 and 390×844;
   - the Driver exceptions tab.
3. As `member`:
   - `GET /scheduling/platoons/overview` and `POST /platoons/bulk-assign`;
   - `GET /scheduling/eligibility/roster`;
   - both pages.

## Held up ✅

- **Assigning platoons:**
  - Assign to platoon stays disabled with nothing selected.
  - A double-clicked Assign moved the two members to Platoon B, and they were still there after a reload. Toast: "Assigned 2 members to B".
  - Clear platoon moved Alex Brooks back to Unassigned (A:1, B:1, unassigned 25).
- **The switched-off feature:** the page says platoon scheduling is off and where to turn it on, instead of hiding the roster.
- **Only active members are offered:**
  - The overview filters out inactive and deleted users.
  - "Pat Applicant" and "Quinn Prospect" are active probationary members, so listing them is right.
- **The roster:**
  - It lists who is cleared for each position and flags the gap that matters: 6 drivers cleared by rank with no EVOC certification on file, none of them an operator on any apparatus.
  - The exceptions tab explains that a request grants nothing until a different chief approves it.
- **`member` was refused:** 403 on both platoon endpoints, 404 on the roster, and Access Denied on both pages.
- **Layout:** both pages fit 390px.

## Findings

### W35-1 — LOW — The roster said _who_ is cleared but not _why_, except by colour and icon — ✅ FIXED

**Did:** `scheduling_officer`, Who Can Fill What → Driver/Operator.
**Saw:**

- Each member's eligibility sources are shown as badges: rank, held position, qualification, completed training, or an open position.
- They are told apart only by an icon and a colour, both hidden from assistive technology.
- A screen reader heard "Emery Foster, Engineer, Engineer": the rank, then a rank badge with nothing to say what it meant. The page's subtitle promises "who is cleared … and why".

**Where:** `frontend/src/pages/scheduling/PositionRosterPage.tsx:167` and
`SOURCE_STYLES`.
**Fix:** each badge carries a screen-reader reason: "By rank:", "By held
position:", "By qualification:", "By completed training:" or "Open to
everyone:". Covered by a new case in `PositionRosterPage.test.tsx` (fails
against the old page). Re-driven: "By rank: Firefighter" on every row of the
Firefighter roster.

### W35-2 — LOW — The platoon picker had no name — ✅ FIXED

**Did:** `scheduling_officer`, the bulk-assign toolbar.
**Saw:** the select choosing the target platoon was named by nothing. It sits
beside "0 selected", so a screen reader announced a bare combobox.
**Where:** `frontend/src/pages/scheduling/SchedulingPlatoonsPage.tsx:120`.
**Fix:** named "Platoon to assign". The existing bulk-assign test now finds it
by that name, and fails against the old page.

## Checklist

| Section                 | Result                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ assign, clear, read the roster for two positions                       |
| 2. The right people     | ✅ member 403/404 on the API, Access Denied on both pages                 |
| 3. Wrong input, failure | ✅ assign disabled with none selected; a double assign acted once         |
| 4. Browser signals      | ✅ clean `events`                                                         |
| 5. Coming back to it    | ✅ platoon changes survive reload                                         |
| 6. On a phone           | ✅ both pages at 390×844                                                  |
| 7. Everyone can use it  | Fixed W35-1, W35-2; member checkboxes and the roster tabs already named   |
| 8. What happens around  | ✅ the roster surfaces drivers without EVOC; the disabled feature says so |

## Completion gate

| Check                    | Result                                                          |
| ------------------------ | --------------------------------------------------------------- |
| npm run typecheck        | clean                                                           |
| npm run lint             | clean on the changed files                                      |
| flake8 (changed files)   | no Python changed                                               |
| black --check            | no Python changed                                               |
| frontend tests (touched) | `pages/scheduling`, `modules/scheduling` — 56 files, 784 passed |
| backend tests (touched)  | none touched                                                    |
