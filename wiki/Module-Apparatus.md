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

| URL | Page | Permission |
|-----|------|------------|
| `/apparatus` | Apparatus List | Authenticated |
| `/apparatus/new` | Add Apparatus | Authenticated |
| `/apparatus/:id` | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus | Authenticated |
| `/apparatus-basic` | Apparatus Basic | Authenticated |

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

### Pages

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling/equipment-check-templates/new` | Template Builder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | Edit Template | `equipment_check.manage` |
| `/scheduling/equipment-check-reports` | Reports Dashboard | `equipment_check.manage` |

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
GET    /api/v1/equipment-checks/reports/compliance               # Compliance stats
GET    /api/v1/equipment-checks/reports/failures                 # Failure log
GET    /api/v1/equipment-checks/reports/item-trends              # Item trends
GET    /api/v1/equipment-checks/reports/export/csv               # CSV export
GET    /api/v1/equipment-checks/reports/export/pdf               # PDF export
```

### Data Model

| Table | Description |
|-------|-------------|
| `equipment_check_templates` | Master template (name, timing, type, assigned positions) |
| `check_template_compartments` | Named sections, nested via `parent_compartment_id` |
| `check_template_items` | Items with check type, expiration, serial/lot, quantity |
| `shift_equipment_checks` | Submitted check records linked to shifts |
| `shift_equipment_check_items` | Individual item results |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Expired item submitted as pass | Auto-fails regardless of submitted result |
| Item below required quantity | Auto-fails |
| Single failed item on apparatus | Sets `has_deficiency` on the apparatus record |
| Subsequent passing check | Clears deficiency flag only when ALL items pass |
| Position-based assignment | Only members assigned to those positions see the checklist |
| Photo upload limit | Max 3 photos per item, max 10 MB each, auto-converted to WebP |
| Template cloning | Deep clones all compartments and items to the target apparatus |

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

**See also:** [Scheduling Module](Module-Scheduling) | [Inventory Module](Module-Inventory)
