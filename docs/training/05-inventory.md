# Inventory Management

The Inventory module tracks department equipment, supplies, and gear. It supports permanent item assignments, temporary checkouts, pool issuances, maintenance scheduling, barcode/QR scanning, low-stock alerts, and departure clearance for departing members.

---

## Table of Contents

1. [Inventory Overview](#inventory-overview)
2. [Browsing Items](#browsing-items)
3. [Categories](#categories)
4. [Item Assignments](#item-assignments)
5. [Checkout and Return](#checkout-and-return)
6. [Barcode and QR Scanning](#barcode-and-qr-scanning)
7. [Maintenance Tracking](#maintenance-tracking)
8. [Low Stock Alerts](#low-stock-alerts)
9. [Departure Clearance](#departure-clearance)
10. [Members Inventory View (Admin)](#members-inventory-view-admin)
11. [Troubleshooting](#troubleshooting)

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

### Batch Checkout

For events or training sessions where multiple items need to go out at once:

1. Navigate to **Inventory Admin**.
2. Use **Batch Checkout** to select multiple items and a single borrower.
3. Confirm all items at once.

> **Screenshot placeholder:**
> _[Screenshot of the checkout form showing the item being checked out, the member selector, expected return date, and a condition notes field. Below, show the batch checkout interface with multiple item checkboxes]_

---

## Barcode and QR Scanning

Items can be looked up by scanning their barcode or QR code:

1. Navigate to **Inventory**.
2. Click the **Scan** button.
3. Use your device's camera to scan the barcode or QR code.
4. The system looks up the item and displays its details.

From the scan result, you can check out, return, or view the item's full details.

> **Screenshot placeholder:**
> _[Screenshot of the barcode scan interface showing the camera viewfinder and a recently scanned item result with quick action buttons (Check Out, Return, View Details)]_

> **Hint:** Barcode scanning works best with a device that has a camera. On desktop, you can use a USB barcode scanner, which types the code into the search field.

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
4. As items are returned, mark them as resolved.
5. When all items are accounted for, complete the clearance.

> **Screenshot placeholder:**
> _[Screenshot of a departure clearance record showing the member's name, departure date, a checklist of outstanding items with checkboxes, and resolve/complete buttons]_

> **Hint:** Departure clearances integrate with the Member Status workflow. When a member is dropped, a property return report is automatically generated. See [Membership > Property Return Process](./01-membership.md#member-status-management).

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
| Item not found when scanning | Verify the barcode/QR code matches the item's serial number or asset tag. The item must exist in the system. |
| Cannot assign item - "already assigned" | An item can only be assigned to one member at a time. Return or unassign it from the current member first. |
| Checkout button not available | The item may already be checked out or in maintenance status. Check the item's current status. |
| Departure clearance not generating items | The member must have active assignments or checkouts. If all items were already returned, the clearance will be empty. |
| Cannot see Inventory module | Inventory is a recommended module but can be disabled. Contact your administrator to enable it in Settings. |

---

**Previous:** [Events & Meetings](./04-events-meetings.md) | **Next:** [Apparatus & Facilities](./06-apparatus-facilities.md)
