# Workflow Review — W38 Set Up Inventory: Categories, then Add Items of Each Tracking Kind

**Driven:** 2026-09-29 · **As:** `quartermaster`, with `member` refused · **Viewports:** 1280×900
**Commit:** `98a18c816` (main, after #2816) plus this run's changes · **Database:** continued from W37

---

## What was driven

1. As `quartermaster` (who holds `inventory.manage`), the `/inventory/admin/setup` wizard:
   - **Rooms:** "Gear Room", Station 1, Add room double-clicked.
   - **Storage:** "Turnout Rack A" (Rack / Closet), Add storage area double-clicked.
   - **Categories:** Turnout Gear, SCBA, EMS Supplies and Boots, Gloves & Hoods, with "Add 4 categories" double-clicked.
   - **First items:** Turnout Gear on Turnout Rack A → Add an item → "Structural Coat", serial TC-1001, size L, Create double-clicked.
   - Then EMS Supplies → Add an item → Pool, "Nitrile Gloves", 20 box, reorder point 5, Create double-clicked.
2. `/inventory/admin/items` with both items.
3. As `member`: `POST /inventory/items`, `POST /inventory/categories` and the setup page.

## Held up ✅

- **Storage and categories:**
  - A double-clicked Add storage area made **one** storage area.
  - A double-clicked "Add 4 categories" made **four**, each with its preset type (PPE ×3, Consumable).
- **Items:**
  - The item form opens with the category, room and storage area already chosen, as the wizard promises, and every field is labelled.
  - A double-clicked Create made **one** item each time.
  - An individual item was saved with its serial, size and 365-day interval.
  - A pool item was saved with quantity 20, unit "box" and reorder point 5.
- **The items page** lists the three items with the new categories as filters.
- **Refusals:** `member` got 403 on both writes and Access Denied on the page.

## Findings

### W38-1 — LOW — The wizard's first step offered the quartermaster a form it could not submit — ✅ FIXED, permission FLAGGED

**Did:** `quartermaster`, Rooms → Add room.
**Saw:** "Insufficient permissions (Error code: LB-PERM-001)":

- The wizard is gated on `inventory.manage`.
- A room is a location, and `POST /locations` requires `locations.create` or `locations.manage`, which the seeded quartermaster position lacks.
- So the first of four steps, "this comes first", presented a form that could only fail.

**Where:** `frontend/src/modules/inventory/pages/InventorySetupPage.tsx:148`.
**Fix:** the Add room form follows the location grant. Without it, the step
says: "Adding a room needs permission to create locations, which your position
does not have. Use a room listed above, or ask someone who manages locations to
add the one you need." Nothing about who may do what changed.

Covered by a new case in `InventorySetupPage.test.tsx` (fails against the old
page). The existing room test now runs as a viewer holding `locations.create`.
**Flagged:** whether a quartermaster should be able to create rooms is a
permission decision:

- grant `locations.create` to the position;
- or let the wizard create rooms under `inventory.manage`.

The activity didn't need it answered, since the later steps work from existing
rooms. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W38-2 — LOW — The item form didn't say which fields the category requires — ✅ FIXED

**Did:** `quartermaster`, Turnout Gear → Add an item, with no inspection interval.
**Saw:** "Category 'Turnout Gear' requires an inspection interval" (400) after
Create. The server refuses an item that lacks a serial number or inspection
interval its category requires (`_validate_category_requirements`). The form
marked neither field, and gave no interval default, so the requirement surfaced
only as a failed save.
**Where:** `frontend/src/modules/inventory/components/ItemFormModal.tsx:258`.
**Fix:** when the chosen category requires them, "Serial #" and "Inspection
Interval (days)" gain a "_" and `required`, the way Name already is, and the
interval must be at least 1. Covered by two cases in `ItemFormModal.test.tsx`;
the first fails against the old form. Re-driven: both labels read "_", and the
coat saved on the first Create.

### W38-3 — NIT — A consumable category's item defaults to Individual tracking — OPEN

EMS Supplies is described as "Consumables restocked by quantity and
expiration", but Add an item under it opens with Tracking Type "Individual". The
quartermaster has to switch it to Pool by hand. Left: a default derived from the
category's type is a small design choice.

### W38-4 — NIT — A room's name repeats in the storage step's room picker — OPEN

The Storage step's Room select read "Training Room A — Review Valley Fire
Department — Review Valley Fire Department". The department name appears twice
where the other pickers show it once.

## Checklist

| Section                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ storage, categories, an individual and a pool item                       |
| 2. The right people     | ✅ member 403 and Access Denied; fixed W38-1 (a form the role can't submit) |
| 3. Wrong input, failure | ✅ four double-clicks acted once each; fixed W38-2                          |
| 4. Browser signals      | Fixed W38-1 (403), W38-2 (400)                                              |
| 5. Coming back to it    | ✅ everything created is listed on the items page                           |
| 6. On a phone           | not driven (quartermaster setup)                                            |
| 7. Everyone can use it  | ✅ wizard and item form fully labelled                                      |
| 8. What happens around  | W38-3, W38-4 open                                                           |

## Completion gate

| Check                    | Result                                      |
| ------------------------ | ------------------------------------------- |
| npm run typecheck        | clean                                       |
| npm run lint             | clean on the changed files                  |
| flake8 (changed files)   | no Python changed                           |
| black --check            | no Python changed                           |
| frontend tests (touched) | `modules/inventory` — 98 files, 1482 passed |
| backend tests (touched)  | none touched                                |
