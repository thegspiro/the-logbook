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
14. [Troubleshooting](#troubleshooting)

---

## Inventory Overview

Navigate to **Inventory** in the sidebar. The inventory page has two tabs:

| Tab | Description |
|-----|-------------|
| **Items** | Browse and manage all equipment and supplies |
| **Categories** | View and manage inventory categories |

> **Screenshot placeholder:**
> _[Screenshot of the Inventory page showing the Items tab active, with a search bar, category filter dropdown, status filter, and a grid/list of inventory items showing item name, category, condition, and status badges]_

---

## Browsing Items

The **Items** tab lists all inventory items. You can:

- **Search** by item name, serial number, or asset tag
- **Filter** by category, status (available, assigned, checked out, maintenance, retired)
- **Sort** by name, category, or date added

Click on any item to view its details including:
- Full description
- Serial number and asset tag
- Current condition
- Assignment history
- Maintenance records
- Photos (if uploaded)

> **Screenshot placeholder:**
> _[Screenshot of an item detail view showing the item name, photo, description, serial number, asset tag, condition, current assignment (member name), and tabs for history and maintenance records]_

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
3. Note the condition upon return.
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
3. Choose the label size:
   - **Standard** (2×1″) — general-purpose adhesive labels
   - **Dymo** (2.25×1.25″) — for Dymo thermal printers
   - **Rollo** (4×6″) — for Rollo shipping-label printers
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
   - **Returned** — item received back in inventory
   - **Written Off** — item cannot be recovered (lost, destroyed)
   - **Waived** — item return requirement waived by an officer
5. When all items are accounted for, click **Complete Clearance**.

### Clearance Lifecycle

| Status | Description |
|--------|-------------|
| **Initiated** | Clearance created, items pending resolution |
| **In Progress** | Some items resolved, others still pending |
| **Completed** | All items resolved, clearance finalized |

> **Screenshot placeholder:**
> _[Screenshot of a departure clearance record showing the member's name, departure date, a checklist of outstanding items with disposition dropdowns, and resolve/complete buttons]_

> **Hint:** Departure clearances integrate with the Member Status workflow. When a member is dropped, a property return report is automatically generated. See [Membership > Property Return Process](./01-membership.md#member-status-management).

> **Hint:** When an item is resolved, any pending notification for that item is automatically cancelled (notification netting). This prevents duplicate or stale notifications from being sent.

---

## Members Inventory View (Admin)

**Required Permission:** `inventory.manage`

Navigate to **Inventory Admin > Members** to see a per-member view of all equipment assignments across the department.

This view shows:
- Each member and their assigned items
- Checkout history
- Outstanding returns

> **Screenshot placeholder:**
> _[Screenshot of the Members inventory tab showing a list of members with their assigned item counts, expandable to show individual items with assignment dates and conditions]_

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
