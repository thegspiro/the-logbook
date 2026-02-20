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
13. [Troubleshooting](#troubleshooting)

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
