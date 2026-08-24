# Apparatus Module

The Apparatus module manages department vehicles, equipment assignments, maintenance tracking, and crew positions. It offers both a full module and a lightweight "Basic" alternative.

---

## Key Features

### Full Apparatus Module

- **Vehicle Management** — Complete CRUD for department apparatus (engines, ladders, rescues, ambulances, etc.)
- **Crew Positions** — Define crew positions per vehicle type with minimum staffing requirements
- **Maintenance Tracking** — Schedule and track vehicle maintenance, inspections, and repairs
- **Equipment Assignments** — Track what equipment is assigned to each vehicle
- **Status Tracking** — In-service, out-of-service, maintenance, reserve statuses
- **NFPA Compliance** — Track compliance with NFPA standards for apparatus
- **Equipment Checks** — Structured checklist system for shift-based vehicle and equipment inspections (see below)
- **Deficiency Tracking** — Automatic deficiency flagging when equipment check items fail, with auto-clear on passing checks

### Apparatus Basic (Lightweight)

- **Simple Vehicle List** — Unit numbers, names, and types
- **Crew Positions** — Define crew positions per vehicle
- **Shift Integration** — Vehicles appear in shift creation dropdown
- **No Full Module Required** — Available when the full Apparatus module is disabled

---

## Pages

| URL                   | Page             | Permission    |
| --------------------- | ---------------- | ------------- |
| `/apparatus`          | Apparatus List   | Authenticated |
| `/apparatus/new`      | Add Apparatus    | Authenticated |
| `/apparatus/:id`      | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus   | Authenticated |
| `/apparatus-basic`    | Apparatus Basic  | Authenticated |

> `/apparatus-basic` is the lightweight alternative used when the full Apparatus module is disabled. The side navigation automatically shows the correct link.

---

## API Endpoints

### Full Module

```
GET    /api/v1/apparatus                     # List apparatus
POST   /api/v1/apparatus                     # Create apparatus
GET    /api/v1/apparatus/{id}                # Get details
PATCH  /api/v1/apparatus/{id}                # Update
DELETE /api/v1/apparatus/{id}                # Delete
```

### Basic (Scheduling Integration)

```
GET    /api/v1/scheduling/apparatus          # List basic apparatus
POST   /api/v1/scheduling/apparatus          # Create basic apparatus
PATCH  /api/v1/scheduling/apparatus/{id}     # Update basic apparatus
DELETE /api/v1/scheduling/apparatus/{id}     # Delete basic apparatus
```

---

## Equipment Check System (2026-03-19)

The Equipment Check system provides structured vehicle and equipment inspections tied to shift operations.

### Key Features

- **Template Builder** — Admin UI for creating checklist templates with nested compartments and items. Supports 7 check types: pass/fail, present, functional, quantity, level, date/lot, reading
- **Vehicle Check Presets** — Pre-built templates for common apparatus types (engine, ladder, ambulance) that can be imported into the builder
- **Per-Apparatus or Per-Type Templates** — Templates can target a specific apparatus or apply to all apparatus of a type
- **Position-Based Assignment** — Templates can be assigned to specific positions (e.g., Driver/Operator checks)
- **Phone-First Check Form** — Hybrid mobile/desktop form for submitting checks with pass/fail, quantities, readings, serial/lot numbers, expiration dates, and photo attachments (up to 3 per item)
- **Auto-Fail Logic** — Expired items and items below required quantity automatically fail regardless of submitted result
- **Deficiency Flag** — Failed checks auto-set `has_deficiency` and `deficiency_since` on the apparatus; passing checks auto-clear the flag
- **Failure Notifications** — In-app and optional email alerts to shift officers and configurable roles on check failures
- **Reports** — Compliance dashboard, failure log, and item trend history with CSV and PDF export
- **Catalog Linking** — _(2026-08-10)_ The quick-add bar searches the inventory catalog as you type, so adding a position and linking it are one act; picking a result inherits the catalog's name, counted-vs-serialized setting and dated-stock flag. A reviewed bulk pass proposes a link for every unlinked position on an existing template, and the toolbar shows a linked/unlinked count. Everything below hangs off `inventory_item_id`
- **Live On-Truck Counts** — _(2026-08-10)_ A position records `quantity_on_truck` against its target. **NULL means never counted**, and the target stands in
- **Restock Reports** — _(2026-08-10)_ A crew reports an item used or pulled _at the time they use it_, rather than leaving the gap for the next morning's check. Behind `equipment_check.submit`, the default member position. _(2026-08-11)_ Withdrawing a restock report and swapping lots are corrections of record and require `equipment_check.manage` / `inventory.manage`
- **Deployed Lots** — _(2026-08-10)_ `check_item_deployed_lots` records each lot aboard a position separately, so a four-slot bracket holding three lots with three dates reports its **soonest** date rather than whichever was restocked last
- **Standing Apparatus View** — _(2026-08-10)_ `/scheduling/apparatus-inventory` shows what a truck is carrying outside any check, with the ready stock behind each position

### Pages

| URL                                                 | Page                                    | Permission                                                                |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `/scheduling/equipment-check-templates/new`         | Template Builder                        | `equipment_check.manage`                                                  |
| `/scheduling/equipment-check-templates/:templateId` | Edit Template                           | `equipment_check.manage`                                                  |
| `/scheduling/equipment-check-reports`               | Reports Dashboard                       | `scheduling.manage`                                                       |
| `/scheduling/supply/expiring`                       | Expiring on Apparatus (supply worklist) | any of `scheduling.manage`, `equipment_check.view`, `inventory.view`      |
| `/scheduling/apparatus-inventory`                   | Apparatus Inventory _(2026-08-10)_      | any of `equipment_check.submit`, `equipment_check.view`, `inventory.view` |

### API Endpoints — Equipment Checks

```
POST   /api/v1/equipment-checks/templates                        # Create template
GET    /api/v1/equipment-checks/templates                        # List templates
GET    /api/v1/equipment-checks/templates/{id}                   # Get template with compartments
PUT    /api/v1/equipment-checks/templates/{id}                   # Update template
DELETE /api/v1/equipment-checks/templates/{id}                   # Delete template
POST   /api/v1/equipment-checks/templates/{id}/clone             # Clone template
POST   /api/v1/equipment-checks/templates/{id}/compartments      # Add compartment
PUT    /api/v1/equipment-checks/compartments/{id}                # Update compartment
DELETE /api/v1/equipment-checks/compartments/{id}                # Delete compartment
PUT    /api/v1/equipment-checks/templates/{id}/compartments/reorder  # Reorder
POST   /api/v1/equipment-checks/compartments/{id}/items          # Add item
PUT    /api/v1/equipment-checks/items/{id}                       # Update item
DELETE /api/v1/equipment-checks/items/{id}                       # Delete item
GET    /api/v1/equipment-checks/shifts/{shift_id}/checklists     # Applicable checklists
POST   /api/v1/equipment-checks/shifts/{shift_id}/checks         # Submit check
GET    /api/v1/equipment-checks/shifts/{shift_id}/checks         # Completed checks
GET    /api/v1/equipment-checks/checks/{id}                      # Single check detail
GET    /api/v1/equipment-checks/items/{id}/history               # Item history
GET    /api/v1/equipment-checks/my-checklists                    # Member pending checklists
GET    /api/v1/equipment-checks/my-checklists/history            # Member check history
POST   /api/v1/equipment-checks/checks/{id}/items/{item_id}/photos  # Upload photos
GET    /api/v1/equipment-checks/supply/expiring-items             # Supply worklist (2026-08-10)
GET    /api/v1/equipment-checks/supply/item-deployments/{item_id} # Which trucks carry this item
GET    /api/v1/equipment-checks/apparatus/{id}/inventory          # Standing view of one truck
POST   /api/v1/equipment-checks/items/{id}/used                   # Report used  → restock report
DELETE /api/v1/equipment-checks/items/{id}/used                   # Withdraw the report
PUT    /api/v1/equipment-checks/items/{id}/quantity               # Recount the position
POST   /api/v1/equipment-checks/items/{id}/swap                   # Swap a ready lot onto the truck
GET    /api/v1/equipment-checks/items/{id}/deployed-lots          # Lots aboard, soonest first
PUT    /api/v1/equipment-checks/items/{id}/deployed-lots/{lot_id} # Correct count + number + date
GET    /api/v1/equipment-checks/templates/{id}/inventory-matches  # Propose catalog links
POST   /api/v1/equipment-checks/templates/{id}/inventory-links    # Apply reviewed links
GET    /api/v1/equipment-checks/reports/compliance               # Compliance stats
GET    /api/v1/equipment-checks/reports/failures                 # Failure log
GET    /api/v1/equipment-checks/reports/item-trends              # Item trends
GET    /api/v1/equipment-checks/reports/export/csv               # CSV export
GET    /api/v1/equipment-checks/reports/export/pdf               # PDF export
```

### Data Model

| Table                         | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `equipment_check_templates`   | Master template (name, timing, type, assigned positions) |
| `check_template_compartments` | Named sections, nested via `parent_compartment_id`       |
| `check_template_items`        | Items with check type, expiration, serial/lot, quantity  |
| `shift_equipment_checks`      | Submitted check records linked to shifts                 |
| `shift_equipment_check_items` | Individual item results                                  |

### Edge Cases

| Scenario                        | Behavior                                                       |
| ------------------------------- | -------------------------------------------------------------- |
| Expired item submitted as pass  | Auto-fails regardless of submitted result                      |
| Item below required quantity    | Auto-fails                                                     |
| Single failed item on apparatus | Sets `has_deficiency` on the apparatus record                  |
| Subsequent passing check        | Clears deficiency flag only when ALL items pass                |
| Position-based assignment       | Only members assigned to those positions see the checklist     |
| Photo upload limit              | Max 3 photos per item, max 10 MB each, auto-converted to WebP  |
| Template cloning                | Deep clones all compartments and items to the target apparatus |

### Cross-Module Data Sharing

```
Equipment Check Templates
    ↓ (resolved per shift by apparatus + apparatus type + user position)
Shift Equipment Checks
    ↓ (deficiency flag)
Apparatus.has_deficiency / Apparatus.deficiency_since
    ↓ (failure notifications)
In-App Notifications + Email Alerts
    ↓ (reports)
Compliance Dashboard / Failure Log / Item Trends
```

---

## Recent Improvements (2026-03-19)

- **Apparatus type/status list schemas**: Fixed missing default enum fields in apparatus type and status list response schemas
- **Deficiency tracking fields**: Added `has_deficiency` (Boolean) and `deficiency_since` (DateTime) columns to apparatus table
- **MissingGreenlet fix**: Fixed `MissingGreenlet` error in compartment CRUD endpoints caused by lazy-loaded relationships accessed outside async context

---

## Recent Fixes (2026-03-06)

- **`min_staffing` field missing from list endpoint**: The apparatus list API was returning partial data that excluded `min_staffing`, causing shift scheduling to show incorrect staffing calculations. Fixed serialization to include the full Apparatus record
- **Setup checklist showing 0 apparatus**: When the Apparatus module was enabled, the setup checklist was counting the wrong table. Fixed to count the correct apparatus records
- **geoip2 dependency**: Added `geoip2` package to resolve missing-package warning at backend startup

---

---

## Apparatus Badge Fix & EVOC Integration (2026-03-25)

- **Badge icon rendering fix**: Apparatus type and status badges now render actual Lucide icon components instead of displaying icon component names as text (e.g., a truck icon instead of the word "Truck")
- **EVOC certification level**: New `required_evoc_level` field on apparatus records defines the minimum EVOC certification required for driver/operator position assignments
- **Standalone equipment checks**: Equipment checks can now be performed on apparatus at any time, not just during active shifts

### Data Model Changes

| Field                           | Type              | Description                                                      |
| ------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `apparatus.required_evoc_level` | String (nullable) | Minimum EVOC level (basic, intermediate, advanced) for operators |

---

**See also:** [Scheduling Module](Module-Scheduling) | [Inventory Module](Module-Inventory)

---

## NFC Tags on the Fleet _(2026-08-18)_

**Check-In QR Codes** (`/locations/qr-codes`) is already the department's
directory of every check-in code, one card per apparatus, so it is where a box
of tags gets written for a fleet in one sitting. **Write NFC tag** joins Copy
URL / Download PNG / Regenerate in each card's existing action row.

**Prefer an apparatus-keyed tag for anything physically mounted.** The URL is
`/scheduling/checkin?apparatus=<id>`, which resolves to whichever shift is
running when the tag is tapped — today's non-finalized shift, else one that
ended within two hours, else the next upcoming. One tag on the truck therefore
serves every shift. A shift-keyed tag is dead the moment that shift ends.

The member lands on the shift check-in page, which names the unit, date and
hours on screen so they can see which truck they were matched to before they
confirm. Whether a non-rostered member may check in is the existing
`restrict_checkin_to_assigned` setting (off by default, under Scheduling →
Settings); nothing about NFC changes it.

> **The button does not appear on the room kiosk cards beside the apparatus
> ones.** Those encode `/display/{code}`, a public unauthenticated screen keyed
> by a non-guessable code — writing that code to a tag anyone can read hands it
> to whoever walks past, and sending a member's phone to a wall display is not a
> check-in. One rule (`parseNfcTagPath`) governs both what the button offers and
> what a scan will accept.

> **A failed write raises a toast, not a silent no-op.** The directory is a
> print-oriented grid of fixed-size cards with no inline slot to report into,
> and a silent failure looks exactly like a tag that was written — the member
> finds out by tapping a dead sticker.

> **Chrome on Android, over HTTPS.** Web NFC exists nowhere else and browsers
> expose it only in a secure context, so the button renders nothing on iOS,
> desktop, or a plain-`http://` LAN deployment. QR remains the universal path.

## Equipment Checks — Four Item Types and Sealed Containers _(2026-08-23)_

### Nine item types became four

`check_type` carried nine values, seven of which were checks — and between them
they only ever stored **four kinds of answer**: a number, a pass/fail, a
quantity, a date. The extra values were layout decisions wearing a type's
clothing. `present` and `functional` both store pass/fail and differ only in
what the crew is asked to do — a sentence on the item, not a column — and
`reading` and `level` both store a number against a threshold. An admin had to
choose between near-synonyms, and the same question rendered two ways depending
on which name somebody had picked years earlier.

| Type       | Stores            | Pass rule                                                                                                                                                                               |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`    | The number itself | Against a threshold. The trend is the useful part, so the reading is kept rather than reduced to a tick. An emptied box reads as "not read yet", not zero                               |
| `function` | Pass / fail       | A fail opens a note and a photo, and **neither blocks the walk** — a crew held at a textarea at 07:00 abandons the check, so an unwritten note is flagged on the finished check instead |
| `count`    | A quantity        | Short of par is a **restock line, not a failure**                                                                                                                                       |
| `expiry`   | A date            | Confirms the date already on record rather than asking for it again; stays amber on every shift inside the pull window                                                                  |

`header` and `text` are untouched — they are the layout, and the point of
naming the four is that a type is no longer allowed to be a layout choice.

`app/utils/check_types.py` is the write-side authority. The request schema
still **accepts** the legacy names — an older client should not break over a
rename it never asked for — but normalizes before storing. It is deliberately
stricter than the reader: an unknown value at a request boundary is the
caller's mistake and is rejected, where the same value read back from a column
falls back to `function`.

The template builder now names **what each type stores** beside its label, so
the choice reads as "what is being asked" rather than as a list of layouts.

### Sealed containers

A compartment can be marked as carrying a **numbered tamper seal** — a drug
bag, a trauma kit, a sealed pack (`check_template_compartments.is_sealed`, set
in the template builder). On the check form that compartment gets a seal panel:
read the number, confirm it matches the last check, and the contents count is
cleared in one tap instead of counted by hand.

Three rules are load-bearing, and each exists because the obvious alternative
is a safety defect:

1. **A seal clears counting only.** It never clears expiry dates or pressure
   readings, which move on their own while the bag sits shut — so an
   out-of-date vial cannot hide behind an intact tag.
2. **A seal proves unchanged, not full.** Confirming carries the previous
   counts forward; it does **not** write each quantity up to its required
   figure. A drug bag that was three morphine short at its last count is still
   three short, and that carried shortfall still files as a failure. Writing
   quantities to par would be the "Set All to Par" trap, on the one control
   whose entire purpose is that nobody opened the bag.
3. **The shortcut is offered only when it is earned.** Clearing requires a
   prior **intact** seal whose normalized number matches. Otherwise the primary
   action reads _Record seal_, the seal is still filed for the audit record,
   and the contents are counted by hand.

**Nested sealed containers get their own card** — a broken outer seal says
nothing about an intact inner one, which previously had nowhere to be recorded.

`GET /equipment-checks/templates/{id}/last-seals` supplies the previous reading
so the tag number prefills; it lands when the response does, without
overwriting anything the crew has already typed.

### Not yet available

**Walking a check as a lap** — stops in walking order, the current one open in
place, finished ones collapsed to a line — is built and tested, and is **not
connected to the live check screen**, which still renders the previous flat
compartment list. Swapping it rewrites that screen and the tests pinning its
markup, which is a deliberate follow-up. Do not expect the lap after this
upgrade.

### Who can swap stock onto a truck _(2026-08-24)_

The lot-swap endpoint let a crew member **without** `inventory.manage` deploy
any quantity from ready stock and dispose of lots that were never aboard.
Submitter-scope swaps are now bounded by what is actually being replaced: the
disposition path requires the replaced lot to be aboard the item, and the
quantity is capped at the deployed quantity it replaces. The template-item row
is selected `FOR UPDATE`, so two concurrent swaps cannot both pass the cap.
