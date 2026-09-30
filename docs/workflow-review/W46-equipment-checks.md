# Workflow Review — W46 Equipment Checks: Build a Checklist, Perform a Check, Fleet Board, Check Log

**Driven:** 2026-09-30 · **As:** `chief` (building), `member` (performing), with `quartermaster` and `member` refused where they should be · **Viewports:** 1280×900, 390×844
**Commit:** `9ad217a0c` (the W45 branch) plus this run's changes · **Database:** continued from W45

---

## What was driven

1. As `quartermaster`: `/inventory/admin/checklists`, which returned Access Denied (W46-5). The build was therefore driven as `chief`, who holds `inventory.check_manage`.
2. As `chief`, New Template "W46 Engine 1 Daily":
   - Build from scratch;
   - location "Cab" with "Portable radio" and "Flashlight";
   - Publish double-clicked.
3. Details:
   - Specific Apparatus "E-1 — Engine 1", then Save draft (W46-3);
   - then "Where will it be used?" set to Engine, and Publish.
4. As `member` at 390×844:
   - My Equipment Checklists → Unscheduled checklist → the template;
   - Pass on the radio, Fail on the flashlight, an overall note, and Submit Report double-clicked;
   - then Completed checklists.
5. As `chief`: the fleet board, the check log (grid and API), and Reports.
6. As `member`: the admin, fleet and reports pages and the log; `POST` and `DELETE` on templates; `GET /fleet`.

## Held up ✅

- **Publishing:**
  - A double-clicked Publish made **one** template, with both items required.
  - The builder listed what was left to fix, and held Publish until there was an item.
- **Performing a check:**
  - A double-clicked Submit Report recorded **one** check: overall status fail, both item results, and the note.
  - The member's history lists it at 9:52 PM in the department's time zone.
  - Pass All, the progress bar ("2 of 2 items checked") and the per-location status ("Has Failures") are all named.
  - Fail revealed "Not on truck" and "Out of service".
- **The fleet board and log:**
  - Assigned to the Engine type, the checklist reached E-1 on the fleet board and in the log.
  - Reports showed the check under Jordan Avery at 0% pass.
- **Refusals:**
  - `member` got Access Denied on the admin, fleet and reports pages, and 403 on template create and delete and on `GET /fleet`.
  - `member`'s log is scoped to "Checks you performed", with no grid.

## Findings

### W46-1 — MED — Every location and item row in the checklist builder was one button, disabled until saved — ✅ FIXED

**Did:** `chief`, New Template → Build from scratch, then read the page's accessibility tree.
**Saw:**

- The whole location row was `role="button"`, `tabindex="0"` and `aria-disabled="true"`: dnd-kit's sortable attributes, spread on the row.
- A screen reader therefore met the location name, storage type, Sealed, Add items, nest, delete and the item box as the contents of one disabled button.
- Automation refused to type into "Location name", as an assistive-technology user would be told it was unavailable.
- Each item row carried the same `role="button"` and an extra tab stop.
- The drag handles, which hold the listeners that start a keyboard drag, had none of the attributes that explain one.

**Where:** `frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx:416` (`SortableItemWrapper`) and `:5670` (the compartment rows).
**Fix:** the sortable attributes move onto the drag handle, next to the
listeners, and off the rows. Covered by a new case in
`EquipmentCheckTemplateBuilder.test.tsx`: no button contains a field or another
button, and each handle is the sortable. It fails against the old builder.
Re-driven: the row reads as its separate controls, and the name field takes
typing.

### W46-2 — LOW — A check's Pass and Fail buttons did not say which item they answered, or which was chosen — ✅ FIXED

**Did:** `member`, performing the check.
**Saw:**

- Every item offered "Pass", "Fail" (and after a failure "Not on truck", "Out of service") with nothing tying them to the item.
- The chosen answer differed only by its fill colour; no button carried a pressed state.
- The sweep mode already marks its answers pressed. The default accordion form did not.

**Where:** `frontend/src/modules/inventory/pages/EquipmentCheckForm.tsx:2039`.
**Fix:** each item's answers form a group named after the item, and each
answer carries `aria-pressed`. Covered by a new case in
`EquipmentCheckFormCounts.test.tsx`. Re-driven: "Portable radio" → Pass pressed,
"Flashlight" → Fail pressed.

### W46-3 — LOW — The builder offered apparatus the server always refused — ✅ FIXED

**Did:** `chief`, Details → Specific Apparatus "E-1 — Engine 1" → Save draft.
**Saw:** "Invalid apparatus (Error code: LB-API-400)". E-1 is a `basic_apparatus`
unit from onboarding. `equipment_check_templates.apparatus_id` is a foreign key
to the Apparatus module's `apparatus` table, and the update validates against
that table only. The picker takes the scheduling apparatus options, which serve
both tables. So every unit it offered this department failed on save.
**Where:** `EquipmentCheckTemplateBuilder.tsx:652`.
**Fix:** the picker offers only Apparatus-module units. A basic-apparatus
department sees "All of type", which works (see What held up). Covered by a new
case. Re-driven: only "All of type (default)" is offered. The schema question
is W46-6.

### W46-4 — MED — The log and fleet board counted a checklist missed on a day before it existed — 🚩 FLAGGED

**Did:** `chief`, published the Engine-type checklist at 9:54 PM on 9/29 (department time), then opened the fleet board and the log.
**Saw:** E-1 "Needs attention — 1 check missed". The log's 9/28 cell was
"missed" against "W46 Engine 1 Daily", a checklist created the next day.
`EquipmentReadinessService` pairs today's active templates with every shift
in its look-back window, so a new or re-scoped checklist starts every rig with
misses already recorded.
**Where:** `backend/app/services/equipment_readiness_service.py`, `_build_occasions` / `_load_templates`.
**Flagged:** the bound is a definition to choose: from creation, from the last
publish (not recorded), or from when the apparatus assignment changed. It is a
compliance number departments read (CLAUDE.md pitfall 29). Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### W46-5 — decision — The seeded Quartermaster cannot build equipment checklists — 🚩 FLAGGED

**Did:** `quartermaster`, `/inventory/admin/checklists`.
**Saw:** Access Denied. The seeded position holds `inventory.manage` and both
medical-supply grants, but not `inventory.check_manage`. That grant is seeded to
the chief, captain, lieutenant and EMS supply officer. The EMS supply officer's
comment in `permissions.py` says stock is only useful if the officer who manages
it can put it on the apparatus checklist.
**Where:** `backend/app/core/permissions.py:2064`, the quartermaster position.
**Flagged:** a permissions decision. It would also need a migration for
installations already seeded (pitfall 23). Mirrored into `KNOWN_LIMITATIONS.md`.
Per the rotation's rule, the rotation stops here for the owner.

### W46-6 — LOW — A basic-apparatus department cannot pin a checklist to one unit — 🚩 FLAGGED

The schema half of W46-3: the template's apparatus reference is a foreign key to
`apparatus.id`. Supporting per-unit checklists for `basic_apparatus` needs a
polymorphic reference like the one `utils/apparatus_ref` resolves for shifts.
That is a schema change. Mirrored into `KNOWN_LIMITATIONS.md`.

### W46-7 — LOW — The member's check log sent them to the fleet board they cannot open — ✅ FIXED

**Did:** `member`, `/inventory/checklists/log`.
**Saw:** "Checks you performed", with "← Fleet" linking to
`/inventory/checklists`, which takes `inventory.check_view` and showed the
member Access Denied.
**Where:** `frontend/src/modules/inventory/pages/CheckLogPage.tsx:202`.
**Fix:** a member-scoped log links "← My checklists" to
`/inventory/checklists/my`. The fleet-wide log keeps "← Fleet". Covered by two
new cases in `CheckLogPage.test.tsx`. Re-driven at 390×844.

### W46-8 — NIT — The member's completed-check history does not name the checklist — OPEN

A completed entry reads "9/29/2026 9:52 PM · Start of Shift · 2/2 items ·
Failed". With more than one checklist a member cannot tell which one it was.

## Checklist

| Section                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ built, published, performed, seen on board and log; fixed W46-3          |
| 2. The right people     | ✅ member refused on every write and admin page; fixed W46-7; W46-5 flagged |
| 3. Wrong input, failure | ✅ two double-clicks acted once; Publish held until an item existed         |
| 4. Browser signals      | Fixed W46-3 (the 400); nothing else                                         |
| 5. Coming back to it    | ✅ template, items and check read back from the API and database            |
| 6. On a phone           | ✅ check performed at 390×844, no horizontal scroll                         |
| 7. Everyone can use it  | Fixed W46-1, W46-2                                                          |
| 8. What happens around  | W46-4, W46-6 flagged; W46-8 open                                            |

Afterwards: "W46 Engine 1 Daily" set back to a draft so it does not mark E-1
missed every day for later runs. Its one standalone check stays.

## Completion gate

| Check                    | Result                                                       |
| ------------------------ | ------------------------------------------------------------ |
| npm run typecheck        | clean                                                        |
| npm run lint             | clean                                                        |
| flake8 (changed files)   | no Python changed                                            |
| black --check            | no Python changed                                            |
| frontend tests (touched) | `modules/inventory` — 98 files, 1518 passed, no local server |
| backend tests (touched)  | none touched                                                 |
