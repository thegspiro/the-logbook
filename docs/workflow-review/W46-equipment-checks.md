# Workflow Review — W46 Equipment Checks: Build a Checklist, Perform a Check, Fleet Board, Check Log

**Driven:** 2026-09-30 · **As:** `scheduling_officer` (author and fleet), `member` and `member2` (crew), with `member` and `quartermaster` checked for refusals · **Viewports:** 1280×900, 390×844
**Commit:** `d0c3836` (main, after #2847) plus this run's changes · **Database:** fresh (`start.sh --reset` and seed). The new session's container had no review database.

---

## What was driven

The row names `quartermaster`, but the seeded Quartermaster holds none of the
checklist grants (`inventory.check_manage`, `check_view` or `check_submit`,
read from `DEFAULT_POSITIONS`). The hub shows them no checklist card. Authoring
was driven as `scheduling_officer`, which holds all three and `scheduling.manage`,
as the Apparatus Officer and line officers do. See W46-14.

1. As `scheduling_officer`, from More → Inventory Admin → Equipment Checklists → Create Template:
   - "Engine Daily Check": start of shift, type Engine, whole crew.
   - Build from scratch: location "Cab", four items pasted in the item box.
   - "SCBA" switched to Count with par 4.
   - Save draft double-clicked, then Publish.
2. The review install has no apparatus, so Engine 1 was added as a basic
   apparatus through the API. W48 drives that form. Two shifts on it, each with
   `member` (firefighter) and `member2` (driver) assigned:
   - tomorrow's, in department time;
   - one starting today.
3. As `member`:
   - The dashboard, and its assignment notice.
   - More → My Checklists → Open checklist on tomorrow's shift.
   - Radio Pass, thermal camera Fail, SCBA 3 of 4, flashlights Pass, then Submit double-clicked.
   - Open checklist on the card again.
4. As `member2` at 390×844, on today's shift:
   - Pass one item, Go back → Leave, reopen.
   - Thermal camera Fail → Out of service, SCBA topped up to 4, Submit.
   - Then Open checklist on the submitted card, answer everything, and Submit.
5. As `scheduling_officer`: the fleet board, the check log and check reports
   after each submission. Then a probe of "Specific Apparatus" with a basic
   apparatus chosen, through the builder and through `POST /templates`.
6. As `member`:
   - the four officer screens by URL;
   - `POST /equipment-checks/templates` and `GET /fleet`;
   - the check log.
7. At 390×844: the fleet board and the builder, as `scheduling_officer`.

Not driven:

- Seals, NFC and lots aboard (W44 covered the NFC side).
- The sweep mode.
- Supply expiring (driven in W43).
- Standalone checks, beyond opening one to confirm W46-7.
- End-of-shift reminders, which are scheduled tasks.
- Shift-template checklist links (W32 territory).

## Held up ✅

- **Authoring:**
  - A double-clicked Save draft created **one** template.
  - Publish flipped it to active with no error.
  - The list shows it with its timing, type and counts.
- **Reaching the crew:** once shifts existed on an Engine-type apparatus, the
  type-level checklist reached both members' shifts. The assignment
  notification named it ("Equipment checklists to complete: Engine Daily
  Check").
- **Performing a check:**
  - Submit stays disabled until every required item is answered.
  - A double-clicked Submit filed **one** check.
  - Below par reads "Below required (4)".
  - Leave keeps a draft that reopens at 1 of 4.
  - The last count carries over ("Last: 3").
  - At 390×844 nothing scrolls sideways and Submit is reachable (52px tall).
- **Fleet board after today's check:**
  - E1 went to **Out of service**, "1 item marked out of service on the last check."
  - The last check was named with its time in America/Chicago and by Alex Brooks.
- **Refusals:**
  - `member` got Access Denied on the checklist admin, builder, fleet board and reports pages.
  - The API returned 403 on create and on the fleet board.
  - The member's check log is scoped to their own checks (`scope: "own"`).

## Findings

### W46-1 — MED — Creating a checklist stored any apparatus id: a basic apparatus 500'd, and a foreign one was stored — ✅ FIXED

**Did:** `POST /equipment-checks/templates` with Engine 1's id (a basic apparatus), as `scheduling_officer`.
**Saw:**

- 500 `LB-SYS-001`: the foreign key to `apparatus.id` failed.
- `create_template` checked nothing. `update_template`'s comment claims create validates the apparatus as the department's own, and it did not.
- Any `apparatus` row passes the foreign key, another department's included, and the checklist listings resolve that id to a **name**. This is the XC-1 shape (CLAUDE.md pitfall 14c).

**Where:** `backend/app/services/equipment_check_service.py`, `create_template`.
**Fix:**

- The same `is_in_org(Apparatus, …)` guard `update_template` uses, so create returns 400 "Invalid apparatus".
- `TestCreateTemplateApparatusValidation` in `test_equipment_check_service.py` fails against the old service.
- Re-driven: 400.

### W46-2 — MED — A submitted check still said "Open checklist", then refused at Submit — ✅ FIXED

**Did:** As `member2`, Open checklist on today's card after the check was filed. Every item answered, then Submit.
**Saw:**

- The card read "Failed" beside an "Open checklist" button.
- It opened a blank check. After every item was answered, Submit showed "A check for this template has already been submitted for this shift (Error code: LB-API-409)".
- One check per shift and checklist is the server's rule. The card offered a second anyway, to whoever on the crew had not filed the first.

**Where:** `frontend/src/modules/inventory/pages/MyChecklistsPage.tsx`, the card's action.
**Fix:**

- A submitted card (pass, fail, out of service) reads "Submitted for this shift" and offers no button. The completed check is in Completed checklists.
- Covered by `MyChecklistsPage.submitted.test.tsx`; three of its four cases fail against the old page.
- Re-driven as `member2`.

### W46-3 — MED — A check that took an item out of service counted as neither expected nor completed — ✅ FIXED

**Did:** `member2` filed today's check with the thermal camera Out of service, and `scheduling_officer` opened the check log.
**Saw:**

- "Checks completed —", "Expected in window 0" and "Found a problem 1".
- The fleet row read "— completed".
- `_status_for_check` collapses such a check to `out_of_service`, the same status a rig in the shop gets. `_rate_parts` then dropped it from both halves of the rate as "not owed".
- So the crew that found the worst thing a check can find got no credit for doing the check at all.

**Where:** `backend/app/services/equipment_readiness_service.py`, `_rate_parts`.
**Fix:**

- An occasion with a submitted check is owed. It is done unless the check is incomplete.
- A shop day with no check is still excluded.
- Two cases in `TestCompletionRate`, both failing against the old service.
- Re-driven: "100% Checks completed", "1 Expected in window".

### W46-4 — LOW — The fleet board said "No check templates configured" for a rig a published checklist applied to — ✅ FIXED

**Did:** Published the Engine checklist while the only shift on Engine 1 was tomorrow's, then opened the fleet board.
**Saw:**

- E1: pill "No checks set up", reason "No check templates configured for this apparatus."
- That is false. The board counts only shifts dated today or earlier, so "nothing has come due" and "nothing is configured" read the same.
- It is the screen an officer opens right after publishing, to see whether the checklist reached the trucks.

**Where:** `equipment_readiness_service.py`, `_verdict`; `frontend/src/modules/inventory/types/equipmentCheck.ts`, `READINESS_LABELS`.
**Fix:**

- A new `_configured_units` works out which units an apparatus or type checklist reaches.
- Those read "A checklist applies to this apparatus, but no shift on it has come due yet." A unit with none keeps the old sentence.
- The pill reads "No checks yet", which is true of both.
- Shift-template links are not counted: which unit they reach depends on the shifts.
- Two new `TestVerdict` cases. Re-driven with a second engine (E2) and no shifts.

### W46-5 — LOW — The hub card promised fleet readiness and the check log; the page it opened linked to neither — ✅ FIXED

**Did:** Inventory Admin → "Equipment Checklists — The checklists themselves, plus fleet readiness and the check log".
**Saw:** the page linked to Check reports and Expiring on apparatus only.
**Where:** `ChecklistsAdminPage.tsx`, `RELATED`.
**Fix:**

- "Fleet readiness" and "Check log" links, each gated on the permissions its route admits.
- Two new cases in `ChecklistsAdminPage.test.tsx`, and the "own grant only" case now asserts both stay hidden.
- Re-driven.

### W46-6 — LOW — The member's check log offered "← Fleet", which refuses them — ✅ FIXED

**Did:** As `member`, opened `/inventory/checklists/log`.
**Saw:** "Checks you performed" and a "← Fleet" link to a page that shows them Access Denied.
**Where:** `CheckLogPage.tsx`, the header link.
**Fix:**

- The link shows only when the server reports `scope: "fleet"`. That is the scope decision the page already reads, not a second permission check (pitfall 29).
- New case in `CheckLogPage.test.tsx`. Re-driven: no link for `member2`.

### W46-7 — LOW — On the check form, which answer was chosen was shown by colour only, and the count box had no name — ✅ FIXED

**Did:** Read the accessibility tree after answering items as `member`.
**Saw:**

- Every item's buttons were a bare "Pass", "Fail", "Note", with no item named and no pressed state. After Fail, nothing a screen reader reads had changed.
- The SCBA quantity was an unnamed `spinbutton`.

**Where:** `EquipmentCheckForm.tsx`, `renderItemControls`.
**Fix:**

- Each item's answers are a `group` named after the item.
- Pass, Fail, Not on truck and Out of service carry `aria-pressed`.
- The count box is "SCBA quantity found".
- `EquipmentCheckFormA11y.test.tsx`, which fails against the old form. Re-driven: `group "Portable radio"`, `button "Fail" [pressed]`.

### W46-8 — MED — "Specific Apparatus" offered basic apparatus, and saving one failed — ✅ FIXED

**Did:** As `scheduling_officer`, Details → Specific Apparatus showed "E1 — Engine 1". Chose it and saved the draft.
**Saw:** "Invalid apparatus (Error code: LB-API-400)" on edit. W46-1 was the 500 on create.

- The column is a foreign key to the full `apparatus` table.
- The builder listed `/scheduling/apparatus-options`, which falls back to basic apparatus and onboarding defaults.

**Where:** `EquipmentCheckTemplateBuilder.tsx`, `loadApparatusOptions`.
**Fix:**

- Options are listed only when their source is `apparatus`. A department on basic apparatus sees "All of type", which is what the data model supports for it (see W46-11).
- New cases in `EquipmentCheckTemplateBuilder.test.tsx`. Re-driven.

### W46-9 — LOW — "Who completes it?" printed raw seat tokens and had no Paramedic — ✅ FIXED

**Saw:**

- Chips read "Ems" (the token through CSS `capitalize`), where the schedule calls the seat "EMT", and "Driver" where it says "Driver/Operator".
- `paramedic`, a stored shift seat, was not offered, so a checklist could not be limited to the medic seat.

**Where:** `equipmentCheckPresets.ts` `POSITIONS`; the builder's details panel.
**Fix:** `paramedic` added, and chips labelled through `POSITION_LABELS`. New builder case. Re-driven.

### W46-10 — LOW — Every location in the builder was one big "button" to a screen reader — ✅ FIXED

**Did:** Filled the new location's name field.
**Saw:**

- The row carried dnd-kit's `role="button" tabindex="0" aria-disabled="true" aria-roledescription="sortable"`.
- The browser exposed it as `button "Save before dragging this compartment Collapse Cab Cab Compartment Sealed Add…"`.
- A button's children are presentational under ARIA, so the name field and the item box sat inside something announced as one disabled button. Each row was also an extra Tab stop.
- Items had the same wrapper.

**Where:** `EquipmentCheckTemplateBuilder.tsx`, `SortableItemWrapper`, `SortableCompartmentWrapper` and `renderCompartment`.
**Fix:**

- The attributes go on the drag handle with the listeners (`handleProps`).
- New builder case. Re-driven: the field is no longer inside a `role="button"`.

### W46-11 — MED — Checks on basic apparatus are stored with no apparatus, so check reports show nothing by truck — FLAGGED

**Did:** Two checks filed on Engine 1 (a basic apparatus). Then Check reports as `scheduling_officer`.
**Saw:**

- "Apparatus Compliance — No apparatus data available." Both checks had `apparatusId: null`.
- The fleet board and log key by the _shift's_ apparatus and were right. Reports and the apparatus filters key by the check's own column.
- `submit_check` stores `resolve_apparatus_ref(...).full_id`, and its comment says the column is a foreign key to `apparatus.id`.
- That key was dropped on 2026-08-08 (`20260808_0003`). The model now calls the column polymorphic and "copied from Shift.apparatus_id".

**Why not fixed here:**

- Storing the basic id changes what every reader of that column receives.
- The reports resolve names from `apparatus` only.
- Rows already stored would need a backfill from their shift.
- A department on basic apparatus also cannot write a truck-specific checklist (W46-8).

Whether basic apparatus should become first-class for checks, or reports should resolve through the shift, is the owner's call. Mirrored in `KNOWN_LIMITATIONS.md`.

### W46-12 — MED — A check filed before its shift's date is invisible on the fleet board and log until that date — FLAGGED

**Did:** `member` filed tomorrow's check at 23:09 Chicago time, with a failed camera and SCBA at 3 of 4. Then opened the fleet board as `scheduling_officer`.
**Saw:**

- My Checklists lists shifts from today onward and accepts the check.
- The board and log read only shifts dated today or earlier. The failed check appeared nowhere an officer looks until the date turned.

**Why flagged:** whether a check may be filed ahead of its shift is a product rule. The two options:

- refuse it;
- or let the board read shifts up to the start of the next one.

Mirrored in `KNOWN_LIMITATIONS.md`.

### W46-13 — LOW — Fail and Out of service need no note — FLAGGED

The thermal camera went Fail, then Out of service, with nothing written. That
took Engine 1 out of service on the board, with no word on why. A note field
exists per item. Requiring it is a product decision (crews on a call-out may
skip it), so it is flagged rather than changed.

### W46-14 — LOW — The seeded Quartermaster can build no checklist and see no fleet board — FLAGGED

The Quartermaster sees "Expiring on Apparatus", but holds none of
`inventory.check_*`. The hub shows no checklist card. Authoring belongs to
Apparatus and Scheduling Officers and line officers, which may well be the
intent. Changing a seeded grant needs a migration (pitfall 23). The W46 row
named the wrong role; corrected in `PROGRESS.md`.

### W46-15 — LOW — Publishing a checklist says nothing about where it will run — OPEN

"Engine Daily Check" published for "all engines" with no engine in the
department. No count, no warning. The builder knows the type and could say
"reaches 0 apparatus", or name them. With W46-4 fixed, the fleet board now
reports it, but only after the officer thinks to look there.

### W46-16 — NIT — The assignment notice names the checklist but opens the schedule, and prints an ISO date — OPEN

"You have been assigned to the Firefighter position on the 2026-09-30 shift
(starts 07:00). Equipment checklists to complete: Engine Daily Check." It
opens `/scheduling?view=week…`, not My Checklists. Belongs to the scheduling
notification sender; left for W33/W34's owner.

### W46-17 — NIT — A draft in progress shows "Not Started 0/4" on its card — OPEN

After Leave, the card read Not Started until reopened, when 1 of 4 came back.
The draft is kept on the device, and the list reads the server.

### W46-18 — NIT — Small things in the builder — OPEN

- "Build from scratch" leaves focus on the page, not the new location's name.
- At 390×844 the header and chip controls are 30–40px tall, and the drag handle 20px. A lead for W79.
- `GET /equipment-checks/shifts/{id}/checks` returns `checkedByName: null`.

## Checklist

| Section                 | Result                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ build, publish, perform, board; fixed W46-2, W46-4, W46-5; W46-12 flagged         |
| 2. The right people     | ✅ member refused on page and API; fixed W46-6; W46-14 flagged                       |
| 3. Wrong input, failure | ✅ three double-clicks acted once; fixed W46-1, W46-8; W46-13 flagged                |
| 4. Browser signals      | ✅ only the 409 (W46-2) and the 400/500 probes (W46-1, W46-8), all driven on purpose |
| 5. Coming back to it    | ✅ draft resumed; results read from the officer's session; W46-17 open               |
| 6. On a phone           | ✅ member check and fleet board at 390×844, no sideways scroll; W46-18 small targets |
| 7. Everyone can use it  | Fixed W46-7, W46-9, W46-10                                                           |
| 8. What happens around  | Fixed W46-3; W46-11 flagged; W46-16 open; times shown in America/Chicago             |

Left in the review database for later runs:

- Engine 1 and Engine 2 (basic);
- two shifts on Engine 1 with their checks;
- the published "Engine Daily Check".

## Completion gate

| Check                    | Result                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                     |
| npm run lint             | clean                                                                                                     |
| prettier (changed files) | clean                                                                                                     |
| flake8 (changed files)   | clean                                                                                                     |
| black --check / isort    | clean                                                                                                     |
| frontend tests (touched) | `modules/inventory`: 100 files, 1530 passed                                                               |
| backend tests (touched)  | `test_equipment_check*`, `test_equipment_readiness_service`, shift-template and ISO readiness: 404 passed |
