# Apparatus & Facilities

The Apparatus module tracks department vehicles, their maintenance, fuel logs, equipment, and NFPA compliance. The Facilities module manages stations, buildings, maintenance schedules, inspections, utility tracking, and capital projects.

---

## Table of Contents

### Apparatus
1. [Apparatus Overview](#apparatus-overview)
2. [Viewing Apparatus Details](#viewing-apparatus-details)
3. [Maintenance Scheduling](#maintenance-scheduling)
4. [Fuel and Mileage Logs](#fuel-and-mileage-logs)
5. [Equipment Tracking](#equipment-tracking)
6. [NFPA Compliance](#nfpa-compliance)

### Facilities
7. [Facilities Overview](#facilities-overview)
8. [Facility Details](#facility-details)
9. [Facility Maintenance](#facility-maintenance)
10. [Inspections](#inspections)
11. [Building Systems and Utilities](#building-systems-and-utilities)
12. [Capital Projects](#capital-projects)

### Worked Examples
13. [Realistic Example: Annual Pump Test and Maintenance for Engine 3](#realistic-example-annual-pump-test-and-maintenance-for-engine-3)
14. [Realistic Example: Managing a Facility Inspection Cycle](#realistic-example-managing-a-facility-inspection-cycle)
15. [Troubleshooting](#troubleshooting)

---

## Apparatus Overview

Navigate to **Apparatus** in the sidebar to view your department's vehicle fleet.

The apparatus list shows all vehicles with:
- Unit number and name
- Type (Engine, Ladder, Rescue, Ambulance, etc.)
- Status (In Service, Out of Service, Reserve, Retired)
- Station assignment
- Year and make/model

> **Screenshot placeholder:**
> _[Screenshot of the Apparatus listing page showing a grid or list of vehicles with unit number, photo thumbnail, type badge, status badge (green for In Service, red for Out of Service), and station assignment]_

> **Hint:** If your department has the full Apparatus module disabled, you will see a simplified **Apparatus Basic** view that provides a lightweight list of apparatus for shift scheduling purposes.

---

## Viewing Apparatus Details

Click on any apparatus to view its complete record:

- **Overview** - Unit info, status, VIN, license plate
- **Photos** - Vehicle photos and documentation images
- **Documents** - Attached documents (registrations, insurance, etc.)
- **Maintenance** - Service history and upcoming maintenance
- **Fuel Logs** - Fuel purchases and mileage tracking
- **Equipment** - Equipment stored on/in the vehicle
- **Operators** - Certified operators for this apparatus
- **NFPA Compliance** - Compliance tracking against NFPA standards
- **Status History** - Timeline of status changes
- **Custom Fields** - Department-defined additional fields

> **Screenshot placeholder:**
> _[Screenshot of an apparatus detail page showing the unit header (photo, name, status), tabbed sections for maintenance, fuel, equipment, etc., and the overview card with VIN, plate, year, make, model]_

---

## Maintenance Scheduling

Track preventive and corrective maintenance for each apparatus:

### Viewing Maintenance

Each apparatus has a maintenance section showing:
- **Upcoming** maintenance based on schedules (date or mileage triggers)
- **Completed** maintenance history

### Logging Maintenance

**Required Permission:** `apparatus.manage`

1. Open the apparatus detail page.
2. Navigate to the **Maintenance** tab.
3. Click **Add Maintenance**.
4. Select the maintenance type (e.g., Oil Change, Pump Test, Annual Inspection).
5. Enter the date, description, cost, and vendor.
6. Save.

> **Screenshot placeholder:**
> _[Screenshot of the maintenance tab showing a timeline of past maintenance entries and an "Add Maintenance" form with type dropdown, date, description, cost, and vendor fields]_

---

## Fuel and Mileage Logs

Track fuel purchases and mileage readings:

1. Open the apparatus detail page.
2. Navigate to the **Fuel Logs** tab.
3. Click **Add Fuel Log**.
4. Enter the date, gallons, cost, mileage reading, and fuel type.
5. Save.

The system calculates fuel efficiency (miles per gallon) automatically.

> **Screenshot placeholder:**
> _[Screenshot of the fuel logs tab showing a table of fuel entries with date, gallons, cost, mileage, and calculated MPG, plus a chart of fuel efficiency over time]_

---

## Equipment Tracking

Track equipment stored on each apparatus (tools, medical supplies, SCBA, etc.):

1. Open the apparatus detail page.
2. Navigate to the **Equipment** tab.
3. Add or remove equipment items.
4. Track equipment condition and last inspection date.

> **Screenshot placeholder:**
> _[Screenshot of the equipment tab showing a list of items on the apparatus with name, quantity, condition, and last checked date]_

---

## NFPA Compliance

Track compliance with NFPA standards for each apparatus:

- NFPA 1901 (Automotive Fire Apparatus)
- NFPA 1911 (Inspection, Maintenance, Testing)
- NFPA 1912 (Refurbishing)

The compliance section shows which standards apply and whether the apparatus is compliant, with dates of last assessment.

> **Screenshot placeholder:**
> _[Screenshot of the NFPA Compliance tab showing applicable standards with compliance status (green check or red X), last assessment date, and next due date]_

---

## Facilities Overview

Navigate to **Facilities** in the sidebar. The facilities module has a dashboard landing page and dedicated detail pages:

| Page | URL | Description |
|------|-----|-------------|
| **Dashboard** | `/facilities` | Summary statistics, recent activity, and searchable facility card grid |
| **Facility Detail** | `/facilities/:id` | Full-page detail with sidebar navigation to all sections |
| **Maintenance** | `/facilities/maintenance` | Cross-facility maintenance records and work orders |
| **Inspections** | `/facilities/inspections` | Cross-facility inspection records and scheduling |

### Dashboard

The facilities dashboard shows:
- **Summary cards**: Total facilities, pending maintenance work orders, upcoming inspections, overdue items
- **Recent activity feed**: Latest maintenance completions, inspection results, and status changes
- **Facility card grid**: Searchable and filterable cards showing each facility's name, type, address, and status

> **Screenshot needed:**
> _[Screenshot of the Facilities Dashboard showing four summary statistic cards at the top (Total Facilities: 3, Pending Maintenance: 2, Upcoming Inspections: 1, Overdue: 0), a recent activity feed in the left column, and a grid of facility cards on the right showing station names, types (Fire Station, Admin Building), addresses, and status badges (Operational in green)]_

> **Hint:** If your department has the Facilities module disabled, you will see a simplified **Locations** page that provides basic location management for events and meetings.

---

## Facility Details

Click on any facility from the dashboard to open its full-page detail view at `/facilities/:id`. The page uses a **sidebar navigation** layout with the following sections:

| Section | Description |
|---------|-------------|
| **Overview** | Name, type, status, address, phone, email, fax, county, founded year |
| **Rooms** | Room inventory with purpose, capacity, NFPA 1500/1585 zone classification (hot/transition/cold), and linked Location records for Events and QR check-in |
| **Building Systems** | HVAC, electrical, plumbing, fire suppression, and 8 fire-critical system types (exhaust extraction, cascade air, decontamination, bay door, air quality monitor, PPE cleaning, alerting system, shore power). Each system tracks model, install date, warranty, and condition |
| **Maintenance** | Maintenance history and work orders with 16 NFPA-aligned maintenance types. Priority badges (low/medium/high/critical) |
| **Inspections** | Inspection records with inspector name, license number, agency, pass/fail status, deficiency tracking, and corrective action dates |
| **Utilities** | Utility accounts (electric, gas, water, internet) with monthly usage readings and cost tracking |
| **Emergency Contacts** | Building-specific emergency contacts with phone, role, and priority |
| **Access Keys** | Key and access card tracking with assignment history |
| **Shutoff Locations** | Gas, water, and electrical shutoff location descriptions and photos |
| **Capital Projects** | Building improvement projects with budget, timeline, status, and contractor info |
| **Insurance** | Insurance policy tracking with provider, policy number, coverage, and renewal dates |
| **Occupants** | Organizations or units housed in the facility |
| **Compliance** | Compliance checklists for fire code, ADA, and other standards |

> **Screenshot needed:**
> _[Screenshot of the Facility Detail page showing the sidebar navigation on the left (Overview, Rooms, Systems, Maintenance, etc. with the Rooms section highlighted) and the main content area on the right showing a list of rooms with name, purpose, capacity, and NFPA zone classification badges (Hot Zone in red, Transition Zone in yellow, Cold Zone in green)]_

> **Edge case:** If a facility was created during onboarding, it is automatically linked to a Location record so it appears in the Events location picker. Rooms added later also auto-create Location records. If you delete a room, its linked Location record is preserved (with a note that the room was removed) to avoid breaking existing event references.

### Facilities Module Architecture *(2026-04-11)*

The facilities module was refactored for maintainability:

- **Shared constants**: Status colors, priority colors, maintenance types, inspection types, room types, and NFPA zone options are centralized in `modules/facilities/constants.ts` and used consistently across all section components
- **Custom hooks**: Form state management for inspections (`useInspectionForm`) and maintenance records (`useMaintenanceForm`) is extracted into dedicated hooks, supporting create/edit/delete operations with search and status filtering
- **Type consolidation**: All facilities TypeScript types live in `modules/facilities/types/` with a barrel export

> **[SCREENSHOT NEEDED]:** _Screenshot of the maintenance form showing the type dropdown (with 16 NFPA-aligned options), priority selector (low/medium/high/critical with color badges), date fields, and vendor/cost inputs._

> **[SCREENSHOT NEEDED]:** _Screenshot of the inspections list with the result filter dropdown (All/Passed/Failed/Pending) showing filtered results with inspector name, organization, and pass/fail status badges._

---

## Facility Maintenance

The **Maintenance** tab (at the facility level or the department-wide view) tracks:

- Routine maintenance schedules
- Work orders
- Completed maintenance history
- Maintenance types: HVAC, plumbing, electrical, structural, grounds, etc.

### Creating a Maintenance Record

1. Open the facility or use the department-wide Maintenance tab.
2. Click **Add Maintenance**.
3. Select the facility, maintenance type, priority, and description.
4. Set the scheduled or completed date.
5. Save.

> **Screenshot placeholder:**
> _[Screenshot of the facility maintenance tab showing upcoming maintenance items as cards with priority badges (green/yellow/red), and a completed maintenance timeline below]_

---

## Inspections

The **Inspections** tab tracks scheduled and completed facility inspections:

- Fire code inspections
- Health and safety inspections
- ADA compliance checks
- Insurance inspections
- Custom inspection types

### Recording an Inspection

1. Navigate to the **Inspections** tab.
2. Click **Add Inspection**.
3. Select the facility, inspection type, and date.
4. Record the findings, pass/fail status, and any deficiencies.
5. Upload inspection reports or photos.
6. Save.

> **Screenshot placeholder:**
> _[Screenshot of the Inspections tab showing a table of inspections with facility name, type, date, inspector, and result (Pass in green, Fail in red, Pending in yellow)]_

---

## Building Systems and Utilities

### Systems

Track major building systems for each facility:
- HVAC systems (with model, install date, warranty)
- Fire suppression systems
- Electrical systems
- Plumbing
- Security/alarm systems

### Utilities

Track utility accounts and monitor usage:

1. Navigate to a facility's **Utilities** section.
2. Add utility accounts (electric, gas, water, internet, etc.).
3. Record monthly readings to track consumption trends.

> **Screenshot placeholder:**
> _[Screenshot of the utilities section showing utility accounts (Electric, Gas, Water) with the most recent reading, monthly cost, and a small usage trend chart]_

---

## Capital Projects

Track building improvement and capital projects:

- Project name and description
- Budget and actual cost
- Timeline (start/end dates)
- Status (Planning, In Progress, Completed)
- Contractor information

> **Screenshot placeholder:**
> _[Screenshot of the capital projects section showing a list of projects with name, budget, status badge, and timeline bar]_

---

## Realistic Example: Annual Pump Test and Maintenance for Engine 3

This walkthrough demonstrates how to record a major annual service on an apparatus — from scheduling through completion — including fuel logs, maintenance records, and NFPA compliance updates.

### Background

**Clearwater Fire Department** runs three engines. **Driver/Operator Chris Jennings** is responsible for apparatus maintenance records. **Engine 3** is due for its annual pump test and service per NFPA 1911.

Engine 3 details:
- **Unit:** Engine 3
- **Year/Make/Model:** 2019 Pierce Enforcer
- **VIN:** 4P1CD01H4KA001234
- **Current Mileage:** 28,450 miles
- **Status:** In Service
- **Station:** Station 2

---

### Step 1: Logging the Fuel Stop Before Service

Before taking Engine 3 to the service shop, D/O Jennings fuels up. He navigates to **Apparatus > Engine 3 > Fuel Logs** and clicks **Add Fuel Log**:

| Field | Value |
|-------|-------|
| **Date** | March 10, 2026 |
| **Fuel Type** | Diesel |
| **Gallons** | 42.5 |
| **Cost** | $148.75 |
| **Mileage Reading** | 28,450 |
| **Station/Location** | Shell — Main St |

The system calculates fuel efficiency from the previous fill-up:
- Previous reading: 28,120 miles at 40.0 gallons
- Miles since last fill: 330
- **Fuel efficiency: 7.8 MPG** (typical for a fire engine)

---

### Step 2: Changing Status to Out of Service

D/O Jennings changes Engine 3's status to **Out of Service** while it's at the shop:

1. Opens **Apparatus > Engine 3**
2. Clicks the status badge
3. Selects **Out of Service**
4. Reason: "Annual pump test and service — Apex Fire Equipment"
5. Saves

The calendar and scheduling module now show Engine 3 as unavailable. Any shifts that had Engine 3 assigned will display a warning.

---

### Step 3: Recording the Pump Test

After the annual pump test is completed by Apex Fire Equipment, D/O Jennings records the results. He navigates to **Apparatus > Engine 3 > Maintenance** and clicks **Add Maintenance**:

| Field | Value |
|-------|-------|
| **Maintenance Type** | Annual Pump Test (NFPA 1911) |
| **Date** | March 12, 2026 |
| **Vendor** | Apex Fire Equipment |
| **Cost** | $1,850.00 |
| **Description** | Annual service pump test per NFPA 1911. All flows within spec. Pump rated at 1,500 GPM — tested at 1,520 GPM (101%). Pressure governor tested and calibrated. Primer tested — achieved prime in 8 seconds. Relief valve tested at 200 PSI. |
| **Mileage at Service** | 28,465 |
| **Result** | Pass |

He attaches the pump test certificate PDF from Apex.

---

### Step 4: Recording Additional Service Items

During the annual service, Apex also performed routine maintenance. D/O Jennings adds additional maintenance records:

**Oil and Filter Change:**

| Field | Value |
|-------|-------|
| **Maintenance Type** | Oil Change |
| **Date** | March 12, 2026 |
| **Cost** | $285.00 |
| **Description** | Full synthetic 15W-40, 12 quarts. Oil filter, fuel filters (2), and air filter replaced. |
| **Next Due** | 30,000 miles or March 2027 |

**Brake Inspection:**

| Field | Value |
|-------|-------|
| **Maintenance Type** | Brake Inspection |
| **Date** | March 12, 2026 |
| **Cost** | $0 (included in annual service) |
| **Description** | Front pads at 60%, rear pads at 45%. No replacement needed. All brake lines inspected — no leaks. Parking brake tested and holding. |
| **Next Due** | March 2027 |

---

### Step 5: Updating NFPA Compliance

D/O Jennings navigates to **Apparatus > Engine 3 > NFPA Compliance** and updates the compliance records:

| Standard | Assessment Date | Result | Next Due |
|----------|----------------|--------|----------|
| NFPA 1911 — Pump Test | March 12, 2026 | Pass | March 2027 |
| NFPA 1911 — Aerial (N/A) | — | — | — |
| NFPA 1911 — Ground Ladder | January 8, 2026 | Pass | January 2027 |
| NFPA 1901 — General Condition | March 12, 2026 | Pass | March 2027 |

All compliance items show green checkmarks. Engine 3 is fully compliant.

---

### Step 6: Returning to Service

Engine 3 is back from the shop. D/O Jennings:

1. Changes status back to **In Service**
2. Reason: "Annual service complete — all tests passed"
3. Updates mileage to 28,470 (drive back from shop)

The status history timeline now shows:
```
March 10 — Out of Service (Annual pump test and service)
March 13 — In Service (Annual service complete — all tests passed)
```

Engine 3 reappears as available for shift scheduling.

---

## Realistic Example: Managing a Facility Inspection Cycle

This walkthrough demonstrates how to track the annual inspection cycle for a fire station, including recording findings, tracking deficiencies, and managing follow-up work orders.

### Background

**Station 1** of **Maplewood Fire Department** is due for its annual fire code inspection and building assessment. Facilities Manager **Lt. Jim Walsh** coordinates inspections and maintenance for all three department stations.

Station 1 details:
- **Type:** Fire Station
- **Built:** 1998 (28 years old)
- **Bays:** 3 apparatus bays
- **Living Quarters:** Yes (6 beds)
- **Systems:** HVAC (2 units), fire suppression (wet sprinkler), generator (Generac 48kW)

---

### Step 1: Recording the Annual Fire Code Inspection

The county fire marshal conducts the annual fire code inspection on April 5. Lt. Walsh navigates to **Facilities > Station 1 > Inspections** and clicks **Add Inspection**:

| Field | Value |
|-------|-------|
| **Inspection Type** | Fire Code Inspection |
| **Date** | April 5, 2026 |
| **Inspector** | County Fire Marshal — Inspector Daniels |
| **Result** | Conditional Pass |

**Findings:**

| Item | Status | Details |
|------|--------|---------|
| Sprinkler system | Pass | All heads clear, FDC accessible, inspection tag current |
| Fire extinguishers | Pass | All units inspected, tags current |
| Emergency lighting | **Deficiency** | Battery backup on bay 2 exit sign failed — unit not illuminating on battery test |
| Smoke/CO detectors | Pass | All units tested and functional |
| Electrical panels | **Deficiency** | Panel C in mechanical room has obstructed clearance (36" required, storage within 24") |
| Kitchen hood suppression | Pass | Ansul system inspected, nozzles clear |

Lt. Walsh uploads the inspector's report PDF and notes the two deficiencies that need correction within 30 days.

---

### Step 2: Creating Follow-Up Maintenance Work Orders

For each deficiency, Lt. Walsh creates a maintenance record in **Facilities > Station 1 > Maintenance**:

**Work Order 1 — Exit Sign Replacement:**

| Field | Value |
|-------|-------|
| **Type** | Electrical |
| **Priority** | High |
| **Description** | Replace battery backup exit sign unit above bay 2 personnel door. Unit failed battery illumination test during fire code inspection (April 5). Must be corrected within 30 days. |
| **Due Date** | May 5, 2026 |
| **Assigned To** | Lt. Walsh |

**Work Order 2 — Clear Panel C Obstruction:**

| Field | Value |
|-------|-------|
| **Type** | General / Safety |
| **Priority** | High |
| **Description** | Remove storage items blocking 36-inch clearance in front of electrical panel C in mechanical room. Cited in fire code inspection (April 5). |
| **Due Date** | April 12, 2026 |
| **Assigned To** | A Platoon (next shift) |

---

### Step 3: Completing Repairs and Re-Inspection

**Panel clearance (April 8):** A Platoon clears the storage items during their shift. Lt. Walsh updates the work order status to **Completed** and adds a note: "Storage relocated to supply closet B. 36-inch clearance restored. Photo taken for records."

**Exit sign replacement (April 15):** Lt. Walsh purchases and installs a new battery backup exit sign. He updates the work order to **Completed** and adds: "Installed Lithonia LHQM LED exit sign. Battery test confirmed — 90-minute runtime. Receipt attached."

---

### Step 4: Recording the Building Systems Check

While addressing the deficiencies, Lt. Walsh also performs the quarterly building systems check. He navigates to **Facilities > Station 1 > Systems** and updates each system:

| System | Check Date | Status | Notes |
|--------|-----------|--------|-------|
| HVAC Unit 1 (bays) | April 8 | Operational | Filter replaced. Refrigerant levels normal. |
| HVAC Unit 2 (living quarters) | April 8 | Operational | Filter replaced. Thermostat calibrated. |
| Generator (Generac 48kW) | April 8 | Operational | Weekly auto-test running. Last full-load test: Feb 2026. Next due: Aug 2026. |
| Fire Suppression (sprinkler) | April 5 | Operational | Per fire marshal inspection — all clear. |
| Kitchen Hood (Ansul) | April 5 | Operational | Per fire marshal inspection — annual service due October 2026. |

---

### Step 5: Logging Utility Readings

Lt. Walsh records the monthly utility readings for Station 1 under **Facilities > Station 1 > Utilities**:

| Utility | April Reading | Cost | vs. Last Month |
|---------|--------------|------|---------------|
| Electric | 4,850 kWh | $582.00 | +12% (bay heaters running) |
| Natural Gas | 180 therms | $234.00 | -8% (warming trend) |
| Water | 6,200 gal | $48.00 | Normal |
| Internet | — | $89.99/mo | Fixed |

Over time, these readings build a usage trend that helps identify anomalies (e.g., a spike in water usage could indicate a leak) and support budget planning.

> **Hint:** Recording utility readings monthly creates the data needed for the annual budget report. The system can show year-over-year trends and flag months where usage exceeds the historical average by more than 20%.

---

## Equipment Checks (2026-03-19)

The Equipment Check system provides structured vehicle and equipment inspections tied to shift operations. For detailed documentation including template building, check submission, and reporting, see [Shifts & Scheduling > Equipment Check System](./03-scheduling.md#equipment-check-system).

### Key Points for Apparatus & Facilities Users

- **Deficiency tracking**: When any equipment check item fails, the apparatus is automatically flagged as deficient (`has_deficiency = true`, `deficiency_since` records the date). The deficiency badge appears on the apparatus list and detail pages
- **Auto-clear**: When a subsequent full check passes all items, the deficiency flag is automatically cleared
- **Failure notifications**: Failed check items trigger in-app notifications to shift officers and configurable roles (e.g., apparatus maintenance officer)
- **Cross-reference**: Equipment check reports are accessible from both the Scheduling module (`/scheduling/equipment-check-reports`) and the apparatus detail page

> **Screenshot needed:**
> _[Screenshot of the Apparatus List page showing an apparatus card with a red "Deficient" badge and the deficiency date, alongside a healthy apparatus with a green "OK" badge]_

> **Screenshot needed:**
> _[Screenshot of the Apparatus Detail page showing the deficiency alert banner at the top with the date and a link to view the failed equipment check]_

### Edge Cases — Equipment Checks

| Scenario | Behavior |
|----------|----------|
| Apparatus with no template assigned | No checklist appears for shifts using this apparatus |
| Single failed item | Marks entire apparatus as deficient |
| Passing check after deficiency | Clears flag only when ALL items pass |
| Expired item (past expiration date) | Auto-fails regardless of submitted result |
| Item below required quantity | Auto-fails |
| Equipment check status: `incomplete` vs `fail` | If not all items are completed, overall status is `incomplete` (overrides `fail`). An incomplete check is distinct from a failed check in reports. |
| Template resolution fallback | System first looks for templates tied to the specific apparatus ID, then falls back to templates matching the apparatus type. |

---

## Facilities System Edge Cases

### System Defaults & Protected Records

| Scenario | Behavior |
|----------|----------|
| Modify system facility type (e.g., "Fire Station") | Returns "Cannot modify system facility types." System-defined types are immutable. |
| Delete system facility type | Returns "Cannot delete system facility types." |
| Delete facility type in use | Returns "Cannot delete type. N facilities use this type." Remove or reassign facilities first. |
| Modify system facility status (e.g., "Operational") | Returns "Cannot modify system facility statuses." |
| Delete system facility status | Returns "Cannot delete system facility statuses." |
| System defaults missing (partial migration) | `_ensure_system_defaults` runs on each Facilities module access and inserts missing system types/statuses at runtime as a recovery mechanism. |

### Facility Lifecycle

| Scenario | Behavior |
|----------|----------|
| Archive an already-archived facility | Returns "Facility is already archived." |
| Unarchive a non-archived facility | Returns "Facility is not archived." |
| Create historic maintenance entry without date | Returns "occurred_date is required for historic entries." Scheduled maintenance does not require this field. |
| Facility type/status lookup with no records | Service first searches by name (e.g., "Fire Station"), then falls back to any active record. If none exist and auto-seeding fails, facility creation will fail. |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Apparatus status not updating | Verify you have `apparatus.manage` permission. Status changes are logged in the status history. |
| Fuel efficiency showing incorrect values | Check that mileage readings are entered in the correct order (each reading should be higher than the last). |
| Setup checklist showing 0 apparatus | Fixed in March 2026 — the checklist was counting the wrong table when the Apparatus module was enabled. Pull latest and restart. |
| Shift scheduling not showing min staffing | Fixed in March 2026 — the apparatus list endpoint was not returning the full `min_staffing` field. Pull latest and restart. Understaffing badges (amber triangle) now appear on shift cards when `attendee_count < min_staffing`. |
| Cannot see Facilities module | Facilities is an optional module. Your administrator must enable it in Settings > Modules. You may see the simplified Locations page instead. |
| Inspection past due but no alert | Inspection alerts depend on notification rules being configured. Check Settings > Notifications. |
| Room not showing on facility | Rooms must be added individually to each facility from the Rooms section of the facility detail page. |
| Facility address fields showing as blank | Fixed in March 2026 — frontend types were using snake_case (`address_line1`, `zip_code`) but the API returns camelCase (`addressLine1`, `zipCode`). Pull latest and rebuild. |
| Apparatus list page gradient looks wrong in light mode | Fixed in March 2026 — hardcoded `via-red-900` gradient replaced with theme-aware CSS variables. Pull latest and rebuild. |
| Physical address not showing in Organization Settings | As of 2026-03-04, a Physical Address section is now available in Organization Settings > General with a "Same as mailing address" toggle. |
| Facility creation fails with "No facility types available" | As of 2026-03-06, system types/statuses are auto-seeded on first use if migration data was missing. Run `alembic upgrade head` for the backfill migration. |
| Backend won't start after enabling facilities | Fixed in March 2026 — cascading issues with FK references, nullable columns, and seed data. Pull latest and restart. See [Troubleshooting](../../docs/TROUBLESHOOTING.md#facilities-container-startup-crash-chain). |
| Facility rooms don't appear in Events location picker | As of 2026-03-06, rooms auto-sync a linked Location record. Existing rooms will get locations on next update. |
| Maintenance routes returning 404 | Fixed in March 2026 — route ordering issue where `GET /{facility_id}` matched before static routes like `/maintenance`. Pull latest and restart. |
| NFPA zone classification not visible on rooms | As of 2026-03-06, rooms support NFPA 1500/1585 zone classification (hot/transition/cold). Check the Rooms tab in facility detail for zone badges. |
| Facility detail only shows Rooms tab | As of 2026-03-06, the FacilityDetailPanel has tabbed sub-sections: Rooms, Building Systems, and Emergency Contacts. Pull latest and rebuild. |
| Apparatus deficiency badge won't clear | A subsequent full check must pass ALL items. Partial checks or checks with any failure won't clear the flag. |
| Equipment check template not appearing for shift | Verify the template is assigned to the shift's apparatus (or apparatus type) and that your position matches the template's assigned positions. |
| Photo upload fails on equipment check | Photos must be JPEG, PNG, or WebP and under 10 MB. Max 3 photos per item. |
| Apparatus type/status dropdowns missing defaults | Fixed 2026-03-19 — list schemas were missing default enum fields. Pull latest. |
| Dark mode colors look wrong on apparatus page | Fixed 2026-03-18 — dark mode and high-contrast variants added across 25+ files. Pull latest. |

---

## Apparatus Badge Fix & EVOC Integration (2026-03-25)

### Badge Rendering Fix

Apparatus type badges (Engine, Ladder, Rescue, Ambulance) and status badges (In Service, Out of Service, Reserve) now display the correct icons. Previously, badge icons were rendering as text (e.g., showing the word "Truck" instead of a truck icon).

> **Screenshot needed:**
> _[Screenshot of the apparatus list showing apparatus cards with correct icon rendering — a truck icon next to "Engine 1", an ambulance icon next to "Medic 3", with status badges showing colored dots and icons]_

### EVOC Certification Level on Apparatus

Each apparatus can now specify a minimum EVOC (Emergency Vehicle Operations Course) certification level required for its operators:

1. Navigate to **Apparatus > [Vehicle] > Edit**
2. Set the **Required EVOC Level** field to Basic, Intermediate, or Advanced
3. Save

When scheduling assigns a member to a Driver/Operator position on this apparatus, the system validates their EVOC certification level against this requirement.

> **Screenshot needed:**
> _[Screenshot of the apparatus edit form showing the "Required EVOC Level" dropdown set to "Intermediate" among other apparatus fields]_

### Standalone Equipment Checks

Equipment checks can now be performed on any apparatus at any time, independent of active shifts. Navigate to **Scheduling > Equipment Checks** to see available apparatus and start a check.

See [Shifts & Scheduling > Standalone Equipment Checks](./03-scheduling.md#standalone-equipment-checks) for the full workflow.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Apparatus with no EVOC level set | No validation on driver/operator assignments |
| Badge with unrecognized apparatus type | Falls back to generic vehicle icon |
| Ad-hoc equipment check on out-of-service apparatus | Allowed — check is recorded normally |

---

**Previous:** [Inventory Management](./05-inventory.md) | **Next:** [Documents & Forms](./07-documents-forms.md)
