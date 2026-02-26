# Inventory Management

The Inventory module tracks department equipment, supplies, and gear. It supports permanent item assignments, temporary checkouts, pool issuances, maintenance scheduling, barcode/QR scanning, thermal label printing, low-stock alerts, batch operations, and departure clearance for departing members.

---

## Table of Contents

1. [Inventory Overview](#inventory-overview)
2. [Browsing Items](#browsing-items)
3. [Categories](#categories)
4. [Individual vs Pool Items](#individual-vs-pool-items)
5. [Item Assignments](#item-assignments)
6. [Checkout and Return](#checkout-and-return)
7. [Batch Operations](#batch-operations)
8. [Barcode and QR Scanning](#barcode-and-qr-scanning)
9. [Label Printing](#label-printing)
10. [Maintenance Tracking](#maintenance-tracking)
11. [Low Stock Alerts](#low-stock-alerts)
12. [Departure Clearance](#departure-clearance)
13. [Members Inventory View (Admin)](#members-inventory-view-admin)
14. [Realistic Example: Departure Clearance for a Retiring Member](#realistic-example-departure-clearance-for-a-retiring-member)
15. [Realistic Example: NFPA 1851 PPE Lifecycle Tracking](#realistic-example-nfpa-1851-ppe-lifecycle-tracking)
16. [Troubleshooting](#troubleshooting)

---

## Inventory Overview

Navigate to **Inventory** in the sidebar. The inventory page has three tabs:

| Tab | Description |
|-----|-------------|
| **Items** | Browse and manage all equipment and supplies |
| **Categories** | View and manage inventory categories |
| **Maintenance** | View items due for maintenance and manage maintenance records |

> **Screenshot placeholder:**
> _[Screenshot of the Inventory page showing the Items tab active, with a search bar, category filter dropdown, status filter, and a grid/list of inventory items showing item name, category, condition, and status badges]_

---

## Browsing Items

The **Items** tab lists all inventory items. You can:

- **Search** by item name, serial number, or asset tag
- **Filter** by category, status (available, assigned, checked out, in maintenance, lost, stolen, retired)

Click on any item to open its edit form, where you can view and modify:
- Full description
- Serial number and asset tag
- Current condition and status
- Storage location
- Purchase and warranty information
- Notes

> **Screenshot placeholder:**
> _[Screenshot of the item edit modal showing form fields for name, description, category, serial number, asset tag, condition, status, and other item properties]_

---

## Categories

The **Categories** tab organizes items into groups. Common categories include:

- Personal Protective Equipment (PPE)
- Communications Equipment
- Tools
- Uniforms
- Office Supplies
- Medical Equipment

**Creating Categories (Admin):**

1. Navigate to **Inventory Admin > Manage Inventory**.
2. Click **Add Category**.
3. Enter the category name and description.
4. Save.

> **Screenshot placeholder:**
> _[Screenshot of the Categories tab showing a list of categories with item counts, and the Add Category form/modal]_

---

## Individual vs Pool Items

The inventory system supports two tracking modes:

| Tracking Type | Description | Use Case |
|---------------|-------------|----------|
| **Individual** | One-to-one tracking with serial numbers. Each item is a unique, trackable unit. | Radios, PPE, tools, uniforms |
| **Pool** | Quantity-based tracking. Items are issued and returned by quantity rather than individually. | Batteries, gloves, cleaning supplies, disposable items |

### Individual Items
- Tracked by serial number, barcode, or asset tag
- Assigned to one member at a time
- Full assignment and checkout history
- Condition tracked per unit

### Pool Items
- Tracked by total quantity on hand and quantity currently issued
- Members receive issuances (e.g., "3 pairs of gloves")
- Returns increase the on-hand count
- Pool items must have a quantity of at least 1 when created

> **Hint:** Set the tracking type when creating an item. It determines whether the item appears in the assignment workflow (individual) or the issue/return workflow (pool).

---

## Item Assignments

Items can be permanently assigned to members. Assigned items appear on the member's profile page.

### Assigning an Item

**Required Permission:** `inventory.manage`

1. Open the item detail view.
2. Click **Assign to Member**.
3. Select the member from the dropdown.
4. Set the assignment date and any notes.
5. Save.

### Viewing Your Assignments

Your assigned items appear in two places:
- **Your Member Profile** - Under the "Assigned Inventory" section
- **Inventory > Items** - Items assigned to you are marked with your name

> **Screenshot placeholder:**
> _[Screenshot of the item assignment form showing the member selector dropdown, assignment date, condition selector, notes field, and save button]_

---

## Checkout and Return

For items that are temporarily loaned (not permanently assigned), use the checkout system.

### Checking Out Items

1. Navigate to the item or use **barcode scanning**.
2. Click **Check Out**.
3. Select the member borrowing the item.
4. Set the expected return date.
5. Confirm the checkout.

### Returning Items

1. Open the item or scan its barcode.
2. Click **Return**.
3. Set the return condition:
   - **Excellent** — like new
   - **Good** — normal wear
   - **Fair** — noticeable wear but functional
   - **Poor** — significant wear, may need repair
   - **Damaged** — needs repair or replacement
4. Confirm.

> **Screenshot placeholder:**
> _[Screenshot of the checkout form showing the item being checked out, the member selector, expected return date, and a condition notes field]_

---

## Batch Operations

For events or training sessions where multiple items need to be processed at once, use batch operations.

### Batch Checkout

1. Navigate to **Inventory Admin**.
2. Use **Batch Checkout** to select multiple items and a single borrower.
3. Set the expected return date.
4. Confirm all items at once.

Each item is processed individually — if one item fails (e.g., already checked out), the others still succeed. The results screen shows per-item success/failure status.

### Batch Return

1. Navigate to **Inventory Admin**.
2. Use **Batch Return** to process multiple returns at once.
3. For each item, set the return condition (excellent, good, fair, poor, damaged).
4. Invalid conditions are rejected — the system does not silently fall back to a default.

> **Screenshot placeholder:**
> _[Screenshot of the batch checkout interface with multiple item checkboxes, a member selector, and per-item status results]_

> **Hint:** Batch operations validate each item independently. If an item is assigned to a different user than expected (e.g., due to a concurrent change), that item's return will fail with a clear error message while the rest succeed.

---

## Barcode and QR Scanning

Items can be looked up by scanning their barcode or QR code:

1. Navigate to **Inventory**.
2. Click the **Scan** button.
3. Use your device's camera to scan the barcode or QR code.
4. The system looks up the item and displays its details.

From the scan result, you can check out, return, or view the item's full details. If a code matches multiple items (e.g., the same serial number in different categories), all matches are displayed.

> **Screenshot placeholder:**
> _[Screenshot of the barcode scan interface showing the camera viewfinder and a recently scanned item result with quick action buttons (Check Out, Return, View Details)]_

> **Hint:** Barcode scanning works best with a device that has a camera. On desktop, you can use a USB barcode scanner, which types the code into the search field. If scanning fails, check that the barcode is clean and well-lit; a specific error message will indicate whether the item was not found or a network error occurred.

---

## Label Printing

Generate barcode labels for inventory items to attach to equipment.

### Generating Labels

**Required Permission:** `inventory.manage`

1. Select one or more items from the inventory list.
2. Click **Print Labels**.
3. Choose the label format:
   - **Letter (8.5×11)** — Standard letter sheet with 2×5 grid of labels
   - **Dymo 30252** (1.125×3.5″) — Dymo address labels
   - **Dymo 30256** (2.3125×4″) — Dymo shipping labels
   - **Dymo 30334** (1.25×2.25″) — Dymo multi-purpose labels
   - **Rollo 4×6** (4×6″) — Rollo shipping-label printers
   - **Custom** — Specify your own width and height in inches
4. Click **Generate** to download the PDF.
5. Print the PDF on your label printer.

Labels include a Code128 barcode, the item name, and the asset tag or serial number.

> **Screenshot placeholder:**
> _[Screenshot of the label generation dialog showing item selection checkboxes, label size dropdown, and a preview of a generated barcode label]_

---

## Maintenance Tracking

Track maintenance schedules and history for equipment:

### Viewing Maintenance Due

Navigate to **Inventory Admin** and check the **Maintenance Due** section for items that need servicing.

### Creating a Maintenance Record

1. Open an item's detail view.
2. Navigate to the maintenance section.
3. Click **Add Maintenance Record**.
4. Enter the maintenance type, date, description, and cost.
5. Save.

> **Screenshot placeholder:**
> _[Screenshot of the maintenance section on an item detail page, showing past maintenance records in a timeline and the "Add Maintenance Record" form with type dropdown, date, description, and cost fields]_

---

## Low Stock Alerts

For consumable items with quantity tracking, the system alerts when stock falls below the minimum threshold.

The **Inventory Summary** (available from the inventory dashboard) shows:
- Items at or below minimum stock
- Items with overdue maintenance
- Items currently checked out and overdue for return

> **Screenshot placeholder:**
> _[Screenshot of the inventory summary/dashboard showing alert cards for low stock items (red), overdue maintenance (yellow), and overdue returns (orange)]_

---

## Departure Clearance

When a member departs the department (dropped, retired, etc.), a **Departure Clearance** is created to track the return of all assigned equipment.

### Creating a Clearance

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory Admin**.
2. Click **Create Departure Clearance** for the departing member.
3. The system generates a list of all items assigned to or checked out by the member.
4. For each line item, choose a **disposition**:
   - **Returned** — item received back in acceptable condition
   - **Returned Damaged** — item received back but in damaged condition
   - **Written Off** — item cannot be recovered (lost, destroyed)
   - **Waived** — department chose not to require return
5. When all items are accounted for, click **Complete Clearance**.

### Clearance Lifecycle

| Status | Description |
|--------|-------------|
| **Initiated** | Clearance created, items pending resolution |
| **In Progress** | Some items resolved, others still pending |
| **Completed** | All items resolved, clearance finalized |
| **Closed Incomplete** | Closed by an administrator with some items still outstanding (write-off) |

> **Screenshot placeholder:**
> _[Screenshot of a departure clearance record showing the member's name, departure date, a checklist of outstanding items with disposition dropdowns, and resolve/complete buttons]_

> **Hint:** Departure clearances integrate with the Member Status workflow. When a member is dropped, a property return report is automatically generated. See [Membership > Property Return Process](./01-membership.md#member-status-management).

> **Hint:** When an item is resolved, any pending notification for that item is automatically cancelled (notification netting). This prevents duplicate or stale notifications from being sent.

---

## Equipment Requests

Members can request equipment checkouts, pool issuances, or new purchases through the equipment request workflow.

### Submitting a Request

1. Navigate to **Inventory**.
2. Click **Request Equipment**.
3. Fill in the request form:
   - **Item Name** — the item you need
   - **Request Type** — checkout, issuance, or purchase
   - **Priority** — low, normal, high, or urgent
   - **Reason** — why you need the item
4. Submit the request.

### Reviewing Requests (Admin)

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory** and open the **Pending Requests** panel.
2. Review the request details including the requester's name, item, and reason.
3. Click **Approve** or **Deny** and optionally add review notes.

> **Hint:** Items with a minimum rank restriction will prevent lower-ranked members from submitting requests for those items.

---

## Write-Off Requests

When an item is lost, stolen, damaged beyond repair, or obsolete, a write-off request can be submitted for supervisor approval before the item is removed from active inventory.

### Submitting a Write-Off Request

1. Navigate to the item in **Inventory**.
2. Click **Request Write-Off**.
3. Select a reason: lost, damaged beyond repair, obsolete, stolen, or other.
4. Add a description explaining the circumstances.
5. Submit the request.

### Reviewing Write-Off Requests (Admin)

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory** and open the **Write-Off Requests** panel.
2. Review the request details including the item, reason, and description.
3. Click **Approve** or **Deny** and optionally add review notes.
4. On approval, the item is automatically marked as lost/stolen or retired depending on the reason.

---

## NFPA 1851/1852 Compliance Tracking

Categories can be configured with **NFPA compliance tracking** enabled (e.g., PPE, SCBA). When enabled, items in that category gain lifecycle tracking, ensemble grouping, inspection assessments, and exposure logging as required by NFPA 1851 and 1852.

### Enabling NFPA Tracking

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory > Categories**.
2. Edit the category (e.g., "PPE" or "SCBA").
3. Check **NFPA 1851/1852 compliance tracking**.
4. Save the category.

### Item Detail — NFPA Tabs

When you click on an item in an NFPA-enabled category, the detail modal shows additional tabs:

| Tab | Purpose |
|-----|---------|
| **General** | Standard item info (name, serial, condition, etc.) |
| **NFPA Compliance** | Manufacture date, first in-service date, expected retirement date, ensemble assignment, SCBA cylinder/test dates |
| **Inspections** | Maintenance and inspection history with pass/fail results |
| **Exposures** | Hazardous exposure log (fire, hazmat, bloodborne pathogen) with decontamination tracking |

### Lifecycle Dates (NFPA 1851 §10.1.2)

NFPA 1851 requires tracking:
- **Manufacture date** — the 10-year retirement clock starts here
- **First in-service date** — when the item was placed in active use
- **Expected retirement date** — automatically flags items approaching the 10-year limit

Items within 180 days of retirement display a warning banner in the detail view.

### Ensemble Tracking

PPE components (coat, pants, helmet, gloves, boots, hood) can be grouped into ensembles using a shared **Ensemble ID** and **Role**. This allows tracking the complete protective ensemble per NFPA 1851.

### Exposure Logging (NFPA 1851 §6.2)

After a fire, hazmat, or bloodborne pathogen event, log the exposure against affected PPE items. The system tracks:
- Exposure type and date
- Incident number
- Whether decontamination is required and completed

### SCBA Fields (NFPA 1852)

For SCBA items, additional fields track:
- Cylinder manufacture and expiration dates
- Hydrostatic test dates and due dates
- Flow test dates and due dates

---

## Members Inventory View (Admin)

**Required Permission:** `inventory.manage`

Navigate to **Inventory Admin > Members** to see a per-member view of all equipment assignments across the department.

This view shows:
- Each member with summary counts (permanent assignments, active checkouts, issued items, overdue count)
- Expandable rows showing detailed inventory per member
- **Assign Items** and **Return Items** buttons per member

### Assigning Items from the Members Tab

1. Click the **Assign** button next to a member's name.
2. In the modal, type a name, barcode, serial number, or asset tag into the search field.
3. Matching items appear in a **live dropdown** as you type — click an item to add it.
4. You can also scan barcodes with your device camera (if supported).
5. Repeat for all items to assign.
6. Click **Assign X Items** and confirm.

### Returning Items from the Members Tab

1. Click the **Return** button next to a member's name.
2. The modal shows all items currently held by that member.
3. Select items to return using the checkboxes.
4. Set a return condition for each item.
5. Click **Return Selected Items**.

> **Screenshot placeholder:**
> _[Screenshot of the Members inventory tab showing a list of members with their assigned item counts, expandable to show individual items with assignment dates and conditions]_

---

## Realistic Example: Departure Clearance for a Retiring Member

This walkthrough follows the departure clearance process from start to finish when a member retires and must return all assigned equipment.

### Background

**FF Tom Garcia** is retiring from **Hillside Fire Department** after 25 years of service. Quartermaster **Lt. Rachel Park** needs to account for all equipment assigned to him before his departure is finalized.

FF Garcia currently has the following items assigned:

| Item | Type | Serial / Asset Tag | Condition |
|------|------|-------------------|-----------|
| Turnout Coat | Individual | PPE-2019-042 | Good |
| Turnout Pants | Individual | PPE-2019-043 | Good |
| Portable Radio | Individual | RAD-0187 | Good |
| Leather Helmet | Individual | HLM-0092 | Fair |
| Pager | Individual | PGR-0341 | Good |
| Station Boots | Individual | — (no tag) | Poor |
| Work Gloves (3 pairs) | Pool | — | — |

---

### Step 1: Initiating the Clearance

When FF Garcia's status is changed to **Retired** by the membership officer, the system automatically generates a property return report. Lt. Park also manually creates the departure clearance:

1. Navigates to **Inventory Admin**
2. Clicks **Create Departure Clearance**
3. Selects **Tom Garcia** from the member dropdown
4. The system populates the clearance with all 7 items/issuances currently held by FF Garcia

The clearance status is set to **Initiated**.

---

### Step 2: Processing Returns

FF Garcia comes to the station with his gear. Lt. Park opens the clearance and resolves each item:

**Item 1 — Turnout Coat (PPE-2019-042):**
- FF Garcia hands over the coat
- Lt. Park selects disposition: **Returned**
- Condition on return: **Fair** (25 years of use)
- The item is unassigned from FF Garcia and returned to inventory

**Item 2 — Turnout Pants (PPE-2019-043):**
- FF Garcia hands over the pants
- Lt. Park selects disposition: **Returned**
- Condition on return: **Fair**

**Item 3 — Portable Radio (RAD-0187):**
- FF Garcia returns the radio
- Lt. Park selects disposition: **Returned**
- Condition on return: **Good** — ready to reassign

**Item 4 — Leather Helmet (HLM-0092):**
- FF Garcia returns the helmet
- Lt. Park selects disposition: **Returned Damaged** — the face shield is cracked
- She adds a note: "Face shield cracked, suspension worn. Needs inspection before reissue."
- The item is returned to inventory with condition set to **Damaged**

**Item 5 — Pager (PGR-0341):**
- FF Garcia says the pager was lost during a wildland deployment 6 months ago
- Lt. Park selects disposition: **Written Off**
- Reason: Lost
- She adds a note: "Lost during Willow Creek deployment, August 2025. Incident report #WC-2025-087."
- The pager is marked as **Lost** in inventory

**Item 6 — Station Boots:**
- The boots are heavily worn after 5+ years
- Lt. Park selects disposition: **Written Off**
- Reason: Obsolete / worn beyond use
- She adds a note: "Worn out, scheduled for disposal."

**Item 7 — Work Gloves (3 pairs, pool item):**
- FF Garcia returns 2 pairs; 1 pair was used up
- Lt. Park resolves: **Returned** for 2 pairs (pool quantity increases by 2)
- The remaining 1 pair is resolved as **Written Off** (consumed)

The clearance status automatically moves to **In Progress** as items are resolved.

---

### Step 3: Completing the Clearance

All 7 line items are now resolved. Lt. Park reviews the summary:

| Item | Disposition | Notes |
|------|------------|-------|
| Turnout Coat | Returned (Fair) | |
| Turnout Pants | Returned (Fair) | |
| Portable Radio | Returned (Good) | |
| Leather Helmet | Returned Damaged | Face shield cracked |
| Pager | Written Off (Lost) | Lost during Willow Creek deployment |
| Station Boots | Written Off (Worn) | Scheduled for disposal |
| Work Gloves (2 of 3) | Returned | |
| Work Gloves (1 of 3) | Written Off (Consumed) | |

Lt. Park clicks **Complete Clearance**. The clearance status changes to **Completed**.

The system automatically:
- Cancels any pending property return reminder notifications for FF Garcia
- Updates the Member Lifecycle page — FF Garcia's "Overdue Returns" count drops to zero
- Logs the clearance completion in the audit trail

> **Hint:** If Lt. Park needed to close the clearance with outstanding items (e.g., FF Garcia is unreachable and has items that will never be returned), she could use **Close Incomplete** instead. This requires administrator permission and logs which items were left unresolved.

---

## Realistic Example: NFPA 1851 PPE Lifecycle Tracking

This walkthrough demonstrates how to track a set of turnout gear through its lifecycle using NFPA 1851 compliance features — from receipt through inspection, exposure logging, and eventual retirement.

### Background

**Westbrook Fire District** has enabled NFPA 1851/1852 compliance tracking on their "PPE" and "SCBA" inventory categories. Safety Officer **Capt. Elena Torres** manages the compliance program.

A new set of turnout gear arrives for **FF David Park**:
- Globe ATHLETIX turnout coat (manufactured January 2026)
- Globe ATHLETIX turnout pants (manufactured January 2026)

---

### Step 1: Adding Items with NFPA Data

Capt. Torres navigates to **Inventory > Items** and clicks **Add Item** for each piece.

**Turnout Coat:**

| Field | Value |
|-------|-------|
| **Name** | Turnout Coat — Globe ATHLETIX |
| **Category** | PPE (NFPA tracking enabled) |
| **Serial Number** | GA-2026-00451 |
| **Asset Tag** | PPE-2026-101 |
| **Condition** | Excellent |

On the **NFPA Compliance** tab:

| Field | Value |
|-------|-------|
| **Manufacture Date** | January 15, 2026 |
| **First In-Service Date** | March 1, 2026 |
| **Expected Retirement Date** | January 15, 2036 (auto-calculated: manufacture + 10 years) |
| **Ensemble ID** | ENS-PARK-001 |
| **Ensemble Role** | Coat |

She repeats for the pants with the same ensemble ID but role set to **Pants**.

---

### Step 2: Routine Inspection (Year 1)

Six months later, Capt. Torres conducts a routine advanced cleaning and inspection per NFPA 1851 §6.3.

She navigates to the coat's detail page, opens the **Inspections** tab, and clicks **Add Inspection**:

| Field | Value |
|-------|-------|
| **Inspection Type** | Advanced Cleaning & Inspection |
| **Date** | September 15, 2026 |
| **Result** | Pass |
| **Inspector** | Capt. Elena Torres |
| **Findings** | All seams intact. Moisture barrier tested — no leaks. Reflective trim in good condition. Thermal liner shows no damage. |

The inspection is recorded in the item's history. The next inspection due date is calculated based on department policy (typically annual).

---

### Step 3: Logging a Fire Exposure

On November 3, FF Park responds to a structure fire. Afterward, his turnout gear must be documented for exposure per NFPA 1851 §6.2.

Capt. Torres navigates to the coat's **Exposures** tab and clicks **Add Exposure**:

| Field | Value |
|-------|-------|
| **Exposure Type** | Fire (structural) |
| **Date** | November 3, 2026 |
| **Incident Number** | INC-2026-0892 |
| **Decontamination Required** | Yes |
| **Decontamination Completed** | No (pending) |

She does the same for the pants. Both items now show a warning: "Decontamination pending."

After the gear is professionally cleaned, she updates each exposure record:

| Field | Value |
|-------|-------|
| **Decontamination Completed** | Yes |
| **Decontamination Date** | November 8, 2026 |
| **Decontamination Method** | Professional ISP cleaning |

The warning clears.

---

### Step 4: Approaching Retirement (Year 9)

In July 2035, the coat is within 180 days of its expected retirement date (January 15, 2036). The system automatically:

- Displays a **warning banner** on the item detail page: "This item is approaching its 10-year retirement date (January 15, 2036). Plan for replacement."
- Flags the item in the **Inventory Summary** under "Items Approaching Retirement"
- Notifies Capt. Torres via her configured notification preferences

### Lifecycle Summary

Over the coat's 10-year life, the system tracked:

| Data Point | Count |
|-----------|-------|
| Routine inspections | 10 (annual) |
| Fire exposures | 14 |
| Hazmat exposures | 2 |
| Decontamination events | 16 |
| Repairs | 3 (reflective trim replacement, zipper repair, patch) |
| Condition changes | Excellent → Good (Year 3) → Fair (Year 7) |

This complete history is available for audit, insurance claims, and NFPA compliance reporting — all in one place, replacing the paper logbook taped inside the locker.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Item not found when scanning | Verify the barcode/QR code matches the item's serial number or asset tag. The item must exist in the system. A "not found" message means no match; a "network error" message means connectivity issues. |
| Cannot assign item - "already assigned" | An item can only be assigned to one member at a time. Return or unassign it from the current member first. |
| Checkout button not available | The item may already be checked out or in maintenance status. Check the item's current status. |
| Batch return fails for one item | Each item in a batch is processed independently. If one fails (e.g., "Item is not assigned to the expected user"), the others still succeed. Check if the item was concurrently reassigned. |
| Departure clearance not generating items | The member must have active assignments or checkouts. If all items were already returned, the clearance will be empty. |
| Cannot resolve clearance line item | The line item must belong to the specified clearance. If it returns an error, verify you are resolving items within the correct clearance record. |
| Duplicate barcode error | Barcodes and asset tags must be unique within your organization. Different organizations can reuse the same codes. |
| Pool item quantity below zero | Pool item quantity cannot go below zero. If a return fails, check that the issuance record exists and hasn't already been returned. |
| Cannot see Inventory module | Inventory is a recommended module but can be disabled. Contact your administrator to enable it in Settings. |
| Label PDF not generating | Ensure you have selected at least one item. Labels require the item to have a barcode or asset tag assigned. |

---

**Previous:** [Events & Meetings](./04-events-meetings.md) | **Next:** [Apparatus & Facilities](./06-apparatus-facilities.md)
