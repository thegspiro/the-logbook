# Equipment Check System — Implementation Plan

## Overview

Enhance the existing equipment check system with serialized/dated item tracking,
a phone-first hybrid check form, failure notifications with apparatus deficiency
flags, inline template management in settings, a 3-tab reports page with
PDF/CSV export, full drag-and-drop template reordering, and vehicle/mechanical
pre-trip check support.

---

## Phase 1: Data Model Enhancements

### 1a. Expanded Check Types + Serial/Lot Tracking

The current model only supports `pass_fail | quantity | reading`. Expand to cover
all real-world check scenarios:

| Check Type | Use Case | User Input | Fail Condition |
|---|---|---|---|
| `pass_fail` | Tools, PPE, general equipment | Pass / Fail toggle | Marked fail |
| `present` | Is the item physically there? | Present / Missing toggle | Missing |
| `functional` | Does it work / turn on? | Functional / Non-functional | Non-functional |
| `quantity` | Disposables, meds, supplies | Number stepper (found vs expected) | found < expected |
| `level` | SCBA bottles, fuel, O2 tanks | Numeric (PSI, %, gal) + min threshold | reading < min |
| `date_lot` | Medications, perishables | Serial, lot, expiration date | Expired or expiring |
| `reading` | Gauges, meters, odometers | Free-text or numeric value | Manual fail only |

**Backend model changes** (`backend/app/models/apparatus.py`):
- Change `CheckTemplateItem.check_type` enum to include all 7 types
- Add to `CheckTemplateItem`:
  - `serial_number: Column(String(100), nullable=True)` — expected serial
  - `lot_number: Column(String(100), nullable=True)` — expected lot number
  - `expected_quantity: Column(Integer, nullable=True)` — how many should be present
  - `min_level: Column(Float, nullable=True)` — minimum acceptable level/reading
  - `level_unit: Column(String(20), nullable=True)` — unit label (PSI, %, gallons)

**Backend schema changes** (`backend/app/schemas/equipment_check.py`):
- Add new fields to Create/Update/Response schemas
- Add `CheckType` enum with all 7 values

**Frontend type changes** (`frontend/src/modules/scheduling/types/equipmentCheck.ts`):
- Add `serialNumber?`, `lotNumber?`, `expectedQuantity?`, `minLevel?`, `levelUnit?`
- Update `CheckType` union type

**Alembic migration**: Add nullable columns + update check_type enum.

### 1b. Template Type: Equipment, Vehicle, or Combined

Templates should support different use cases. A department may want a single
combined checklist per apparatus, or separate equipment and vehicle checks
assigned to different positions.

**Backend model changes** (`backend/app/models/apparatus.py`):
- Add to `EquipmentCheckTemplate`:
  - `template_type: Column(String(20), default='equipment', nullable=False)`
    Values: `equipment`, `vehicle`, `combined`

**What each type means:**

| Type | Purpose | Typical Assignee | Example |
|---|---|---|---|
| `equipment` | Inventory/supply check of compartment contents | All crew or specific positions | SCBA, tools, medical supplies |
| `vehicle` | Mechanical/operational pre-trip inspection | Driver position | Lights, tires, fluids, brakes, pump, aerial |
| `combined` | Single template covering both equipment and vehicle | All crew (driver does vehicle compartments) | Everything in one checklist |

**Vehicle check compartments** — common pre-built sections that admins can
select from when creating a vehicle-type template:

- **Exterior Walkaround**: body damage, tires (tread/pressure), mirrors, lights
  (headlights, tail, turn, emergency), reflective striping
- **Cab Interior**: seatbelts, horn, wipers, defroster, gauges, radio, MDT/laptop
- **Engine Compartment**: oil level, coolant level, belt condition, leaks
- **Brakes & Drivetrain**: brake pedal feel, parking brake, air brake system
  (PSI build-up, governor cut-in/out), transmission fluid
- **Warning Systems**: siren (wail, yelp, air horn), emergency lights (all modes),
  PA system, backup alarm
- **Pump Panel** (engine/quint): pump engagement, primer, gauges, intake/discharge
  valves, tank-to-pump, tank water level
- **Aerial** (ladder/tower): hydraulic fluid, outrigger pads, turntable rotation,
  ladder extension/retraction, bucket controls
- **Generator/Lighting** (rescue): generator start, scene lights, power outlets
- **Patient Compartment** (ambulance): suction, O2 system, power outlets, stretcher
  lock, climate control, sharps container

These are offered as **pre-built compartment templates** when creating a new
vehicle or combined template. The admin can select which ones apply and customize
items within each.

**Frontend changes:**
- Template builder: add template_type selector at the top (equipment / vehicle /
  combined) with descriptions
- When vehicle or combined is selected, show a "Add Pre-built Compartment" button
  that opens a picker of common vehicle compartments
- On the shift detail panel and check form, show distinct icons:
  equipment (clipboard), vehicle (truck), combined (clipboard+truck)

**Backend schema changes:**
- Add `template_type` to Create/Update/Response schemas
- Add `PrebuiltCompartment` config (can be a static dict in the service, not a
  DB table — these are just starter templates)

### 1c. Inline Serial Update During Checks

Allow members to update serial/lot/expiration during a check when items are swapped:

**Backend model changes** (`backend/app/models/training.py`):
- Add to `ShiftEquipmentCheckItem`:
  - `serial_found: Column(String(100), nullable=True)` — what was actually found
  - `lot_found: Column(String(100), nullable=True)`
  - `level_reading: Column(Float, nullable=True)` — recorded level (PSI, %, etc.)
  - `updated_serial: Column(Boolean, default=False)` — flag that serial was changed

**Backend service changes** (`backend/app/services/equipment_check_service.py`):
- In `submit_check()`: if an item result includes a new serial/lot/expiration that
  differs from the template, update the template item automatically and set
  `updated_serial=True` on the check item record for audit trail.

### 1c. Photo Attachments on Check Items

**Backend model changes** (`backend/app/models/training.py`):
- Add to `ShiftEquipmentCheckItem`:
  - `photo_urls: Column(JSON, nullable=True)` — list of MinIO/S3 URLs

**New endpoint** (`backend/app/api/v1/endpoints/equipment_check.py`):
- `POST /checks/{check_id}/items/{item_id}/photos` — upload photo(s) via multipart
  form. Stores in MinIO under `equipment-checks/{org_id}/{check_id}/{item_id}/`.
  Returns the URL. Accepts up to 3 photos per item.

**Frontend**: Add camera/upload button to the check form for failed items.

### 1d. Apparatus Deficiency Flag

**Backend model changes** (`backend/app/models/apparatus.py` — `BasicApparatus` or
the full `Apparatus` model if the module is enabled):
- Add `has_open_deficiency: Column(Boolean, default=False, nullable=False)`
- Add `deficiency_since: Column(DateTime(timezone=True), nullable=True)`

**Backend service logic**:
- On check submission: if any item fails → set `has_open_deficiency=True`,
  `deficiency_since=now()` on the apparatus.
- On check submission: if ALL items pass → auto-clear the flag
  (`has_open_deficiency=False`, `deficiency_since=None`).
- Keep a permanent log entry in a new `apparatus_deficiency_log` table:
  `id, apparatus_id, opened_at, closed_at, opened_by_check_id, closed_by_check_id,
  failed_item_names (JSON)`.

**Frontend**: Show a red badge/banner on apparatus cards in the inventory,
scheduling apparatus picker, and compliance dashboard.

---

## Phase 2: Phone-First Hybrid Check Form

Replace the existing `EquipmentCheckForm.tsx` with a new flow:

### 2a. Compartment Overview Grid

Entry point when a member starts a check. Shows all compartments as color-coded
tappable cards in a 2-column grid:

- **Gray** — not started (0 items checked)
- **Amber/blue** — in progress (partially checked)
- **Green** — all items pass
- **Red** — has at least one failure

Each card shows: compartment name, progress fraction (e.g., "4/6"), and a status
icon (checkmark, X, or dash).

Overall progress bar at the top with percentage.

On tablet: 3-column grid with slightly larger cards.

### 2b. Compartment Detail View

Tapping a compartment card transitions to a full-screen item list for that
compartment. Layout:

- **Header**: compartment name, back button (returns to grid), progress (e.g., "2/6")
- **Item list**: scrollable, large touch targets (min 48px height per row).
  Each item renders differently based on `check_type`:

  - **pass_fail**: Two large tap targets — Pass (green) / Fail (red).
  - **present**: Two large tap targets — Present (green) / Missing (red).
  - **functional**: Two large tap targets — Functional (green) / Non-functional (red).
  - **quantity**: Number stepper (+/−) showing found vs expected (e.g., "3 / 4").
    Auto-fails if found < expected. Shows expected_quantity from template.
  - **level**: Numeric input with unit label (e.g., "__ PSI", "__ %").
    Shows min threshold. Auto-fails if reading < min_level.
    Common for SCBA bottles (4500 PSI), O2 tanks (>50%), fuel levels.
  - **date_lot**: Shows expected serial + lot + expiration. Green/amber/red badge
    for expiration status. "Update" button expands inline fields to enter new
    serial/lot/expiration when an item has been swapped. Template auto-updates.
  - **reading**: Free-text or numeric input. No auto-fail — manual fail only.
    Used for odometers, gauge readings, etc.

  **All types** (when failed/missing/non-functional):
  - Expand to show a note textarea + camera button for photo documentation.
  - **Expiration badges** (on items with `has_expiration`):
    red (expired), amber (within warning window), green (OK).

Bottom of compartment: "Next Compartment →" button (auto-advances to next
incomplete compartment) or "Back to Overview" if this was the last.

### 2c. Submission Screen

After all compartments are visited (not necessarily all items checked):

- Summary card: X/Y items checked, Z failures, W not checked
- Required items validation: cannot submit if any required items are unchecked
- Notes textarea (overall)
- Signature field (if enabled in settings)
- Submit button → POST to API → success screen with pass/fail result

### 2d. Shift Start Blocking

When `blockShiftStartOnFail` is enabled in settings:

- On the shift detail panel, if the shift's start-of-shift check is incomplete or
  has failures, show a prominent warning banner:
  "Equipment check incomplete — X items need attention"
- The check-in button shows a warning tooltip but does NOT hard-block (soft warning).
  Hard-blocking could be a future toggle.

---

## Phase 3: Failure Notifications

### 3a. Backend Notification on Check Failure

In `equipment_check_service.py` `submit_check()`:

- If `overall_status == 'fail'`:
  1. Create in-app notification to shift officer (if assigned)
  2. Create in-app notification to configurable roles (reuse the scheduling
     notification settings pattern — add `equipment_check` section to org settings)
  3. Include: apparatus name, template name, number of failures, link to check detail
  4. Optionally send email if `send_email` is enabled in settings

### 3b. Notification Settings UI

Add an "Equipment Alerts" section to the Notifications tab in shift settings:
- Toggle: notify on check failure
- Role selector (which roles get notified)
- Notify shift officer toggle
- Email toggle + CC addresses

---

## Phase 4: Settings — Inline Template Management

### 4a. Template List in Equipment Tab

Replace the current "Manage Equipment Check Templates →" link with an inline
template management experience:

- **Template list**: cards showing each template with:
  - Name, apparatus type/name, check timing badge (start/end of shift)
  - Item count, compartment count
  - Active/inactive toggle
  - Edit button → navigates to existing EquipmentCheckTemplateBuilder
  - Delete button with confirmation
  - Clone button (duplicate to another apparatus)
- **Create button**: "Create Template" → navigates to builder
- **Filter/search**: by apparatus type, timing, active status

### 4b. Template Builder — Drag-and-Drop Reordering

The backend already supports `reorder_compartments` and `reorder_items` endpoints.
The builder UI has grip handles imported but no DnD wired up. Implement full
drag-and-drop using `@dnd-kit/core` + `@dnd-kit/sortable`:

**Within a compartment:**
- Drag items up/down to reorder. On drop, call `reorderItems(compartmentId, orderedIds)`.
- Large grip handle on the left of each item row (touch-friendly, min 44px target).

**Across compartments:**
- Drag an item from one compartment to another. On drop:
  1. Call `deleteCheckItem(itemId)` from the source compartment
  2. Call `addCheckItem(targetCompartmentId, itemData)` to recreate in the target
  3. Call `reorderItems()` on both compartments to update sort_order
- Visual indicator: when dragging over a different compartment, highlight the
  drop zone with a dashed border.

**Compartment reordering:**
- Drag compartments up/down to reorder their position in the template.
- On drop, call `reorderCompartments(templateId, orderedIds)`.

**Compartment nesting:**
- Drag a compartment onto another compartment to make it a sub-compartment.
  The backend already supports `parent_compartment_id`.
- On drop onto a compartment: call `updateCompartment(id, { parent_compartment_id })`.
- Nested compartments render indented with a tree-line visual.
- Drag a nested compartment to the top level to un-nest it
  (`parent_compartment_id: null`).

**Touch considerations (phone-first):**
- Use `@dnd-kit`'s touch sensor with a 200ms delay to distinguish scroll from drag.
- Drag handle is explicit (grip icon) — not the whole row — to prevent accidental
  drags while scrolling.
- On phones, the template builder uses a single-column layout with collapsible
  compartments. Drag-and-drop works the same way but within the narrower viewport.

### 4c. Template Builder — New Item Fields

Update `EquipmentCheckTemplateBuilder.tsx` to support new fields:
- Template type selector (equipment / vehicle / combined) with descriptions
- Pre-built compartment picker for vehicle/combined templates
- Serial number field on items (for `date_lot` type)
- Lot number field on items (for `date_lot` type)
- Expected quantity field on items (for `quantity` type)
- Min level + unit fields on items (for `level` type)
- Photo reference (optional image of the item for identification)

---

## Phase 5: Reports Page

New page: `EquipmentCheckReportsPage.tsx` with 3 tabs.

### 5a. Compliance Dashboard Tab

- **Date range picker** (default: last 30 days)
- **Apparatus compliance cards**: one card per apparatus showing:
  - Last check date, who checked, pass/fail status
  - Checks completed vs expected in the period
  - Open deficiency flag (red badge)
- **Summary stats row**: total checks, pass rate %, overdue count, avg items per check
- **Member completion table**: who has done how many checks, their pass rate
- **Export**: PDF (formatted dashboard) and CSV (raw data)

### 5b. Failure / Deficiency Log Tab

- **Filterable table** of all failed items:
  - Columns: date, apparatus, compartment, item name, checker, status, notes
  - Filters: apparatus, date range, item name search, resolved/open
- **Grouping toggle**: group by apparatus OR by item name
  - By apparatus: see all failures for Engine 1 together
  - By item: see "SCBA Bottle" failures across all apparatus
- **Deficiency history**: link to the deficiency log showing open/close timeline
- **Export**: CSV of failure records, PDF of deficiency summary

### 5c. Item Trend History Tab

- **Template/item selector**: pick a template, then an item within it
- **Bar chart or line chart**: pass/fail counts per week over selected date range
- **Table below chart**: individual check results with date, checker, status, notes
- **Expiration timeline**: for dated items, show when items were swapped and their
  remaining shelf life at each check
- **Export**: CSV of item history

### 5d. Backend Report Endpoints

New endpoints in `equipment_check.py`:

- `GET /reports/compliance` — aggregated stats by apparatus + date range
  - Returns: per-apparatus pass/fail counts, last check date, deficiency status,
    member completion counts
- `GET /reports/failures` — paginated failure log with filters
  - Params: apparatus_id, date_from, date_to, item_name, group_by
- `GET /reports/item-trends` — per-item pass/fail over time
  - Params: template_item_id, date_from, date_to, interval (daily/weekly/monthly)
- `GET /reports/export/pdf` — server-side PDF generation (using reportlab or weasyprint)
- `GET /reports/export/csv` — CSV download with report_type param

---

## Phase 6: PDF & CSV Export

### 6a. CSV Export

Straightforward — serialize report data as CSV with appropriate headers.
Use Python's `csv` module in a streaming response.

### 6b. PDF Export

Use `weasyprint` (HTML-to-PDF) or `reportlab`:
- Template the report as HTML with inline CSS
- Render to PDF on the server
- Return as a downloadable file

PDF templates needed:
- Compliance summary (one page per apparatus with stats)
- Deficiency log (table format)
- Individual check report (compartment-by-compartment results — useful for filing)

---

## Build Order

| Order | Phase | Scope | Depends On |
|-------|-------|-------|------------|
| 1 | 4a | Settings inline template list | Nothing (UI only, uses existing API) |
| 2 | 1a | Expanded check types + serial/lot/qty model + migration | Nothing |
| 3 | 1b | Template type (equipment/vehicle/combined) + pre-built compartments | Nothing |
| 4 | 4b | Template builder drag-and-drop (within, across, nesting) | Nothing |
| 5 | 4c | Template builder new item fields + vehicle template picker | Phases 1a, 1b |
| 6 | 1d | Photo attachments model + endpoint | Nothing |
| 7 | 2a-2d | Phone-first hybrid check form (all 7 check types) | Phases 1a, 1b, 1d |
| 8 | 1c | Inline serial update during checks | Phases 1a, 7 |
| 9 | 1e | Apparatus deficiency flag + auto-clear | Phase 7 |
| 10 | 3 | Failure notifications + apparatus flagging | Phase 1e |
| 11 | 5d | Report backend endpoints | Phase 1e |
| 12 | 5a-5c | Reports frontend (3 tabs) | Phase 5d |
| 13 | 6 | PDF/CSV export | Phase 5d |

Estimated: ~13 distinct implementation steps, each independently committable.

---

## Dependency: New npm Package

Drag-and-drop requires `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`.
These are lightweight, accessible, and touch-friendly — the standard choice for
React DnD. Install in the frontend workspace:

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
