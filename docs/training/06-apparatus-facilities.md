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

Navigate to **Facilities** in the sidebar. The facilities page has three tabs:

| Tab | Description |
|-----|-------------|
| **Facilities** | List of all stations and buildings |
| **Maintenance** | Department-wide facility maintenance tracking |
| **Inspections** | Scheduled and completed facility inspections |

> **Screenshot placeholder:**
> _[Screenshot of the Facilities page showing the three tabs and the Facilities list tab active, displaying station cards with name, address, type (Fire Station, Admin Building, Training Center), and status]_

> **Hint:** If your department has the Facilities module disabled, you will see a simplified **Locations** page that provides basic location management for events and meetings.

---

## Facility Details

Click on any facility to view its full record:

- **Overview** - Name, type, status, address, contact info
- **Photos** - Building photos
- **Documents** - Floor plans, leases, permits
- **Systems** - HVAC, electrical, plumbing, fire suppression
- **Rooms** - Room inventory with purpose and capacity
- **Maintenance** - Maintenance history and schedules
- **Inspections** - Inspection records and schedules
- **Utilities** - Utility accounts and usage readings
- **Access Keys** - Key and access card tracking
- **Emergency Contacts** - Building-specific emergency contacts
- **Shutoff Locations** - Gas, water, electrical shutoff locations
- **Capital Projects** - Building improvement projects
- **Insurance** - Insurance policy tracking
- **Occupants** - Organizations or units housed in the facility
- **Compliance** - Compliance checklists (fire code, ADA, etc.)

> **Screenshot placeholder:**
> _[Screenshot of a facility detail page showing the building header (photo, name, type), an overview card with address and contact info, and navigation to sub-sections (Rooms, Systems, Maintenance, etc.)]_

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

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Apparatus status not updating | Verify you have `apparatus.manage` permission. Status changes are logged in the status history. |
| Fuel efficiency showing incorrect values | Check that mileage readings are entered in the correct order (each reading should be higher than the last). |
| Cannot see Facilities module | Facilities is an optional module. Your administrator must enable it in Settings > Modules. You may see the simplified Locations page instead. |
| Inspection past due but no alert | Inspection alerts depend on notification rules being configured. Check Settings > Notifications. |
| Room not showing on facility | Rooms must be added individually to each facility from the Rooms section of the facility detail page. |

---

**Previous:** [Inventory Management](./05-inventory.md) | **Next:** [Documents & Forms](./07-documents-forms.md)
