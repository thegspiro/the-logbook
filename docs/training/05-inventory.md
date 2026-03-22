# Inventory Management

The Inventory module tracks department equipment, supplies, and gear. It supports permanent item assignments, temporary checkouts, pool issuances, maintenance scheduling, barcode/QR scanning, thermal label printing, low-stock alerts, batch operations, and departure clearance for departing members.

---

## Table of Contents

1. [Inventory Overview](#inventory-overview)
2. [Browsing Items](#browsing-items)
3. [Categories](#categories)
4. [Individual vs Pool Items](#individual-vs-pool-items)
5. [Variant Groups](#variant-groups)
6. [Equipment Kits](#equipment-kits)
7. [Member Size Preferences](#member-size-preferences)
8. [Reorder Requests](#reorder-requests)
9. [Item Detail Page](#item-detail-page)
10. [Item Assignments](#item-assignments)
11. [Checkout and Return](#checkout-and-return)
12. [Batch Operations](#batch-operations)
13. [Barcode and QR Scanning](#barcode-and-qr-scanning)
14. [Label Printing](#label-printing)
15. [Maintenance Tracking](#maintenance-tracking)
16. [Low Stock Alerts](#low-stock-alerts)
17. [Departure Clearance](#departure-clearance)
18. [Members Inventory View (Admin)](#members-inventory-view-admin)
19. [Realistic Example: Departure Clearance for a Retiring Member](#realistic-example-departure-clearance-for-a-retiring-member)
20. [Realistic Example: NFPA 1851 PPE Lifecycle Tracking](#realistic-example-nfpa-1851-ppe-lifecycle-tracking)
21. [Troubleshooting](#troubleshooting)

---

## Inventory Overview

Navigate to **Inventory** in the sidebar. The inventory landing page shows all items with search, category filters, status filters, and location filters.

Key pages in the inventory module:

| Page | URL | Description |
|------|-----|-------------|
| **Items List** | `/inventory` | Browse all equipment and supplies with search, filters, and sorting |
| **My Equipment** | `/inventory/my-equipment` | View your personally assigned items and active checkouts |
| **Item Detail** | `/inventory/items/:id` | Full item record with barcode, history, maintenance, and NFPA compliance |
| **Storage Areas** | `/inventory/storage-areas` | Hierarchical storage location management (Facility → Room → Area) |
| **Admin Dashboard** | `/inventory/admin` | Summary statistics, low-stock alerts, and navigation to admin sub-pages |

> **Screenshot needed:**
> _[Screenshot of the Inventory Items List page showing the search bar, category filter dropdown, status filter pills, location filter cascading selectors (Facility → Room → Storage Area), and a grid of inventory item cards with name, category badge, condition indicator, and status badge]_

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

## Variant Groups

Variant groups link related items that differ only in size or style — for example, a turnout coat available in sizes S, M, L, XL.

### Creating a Variant Group

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory Admin > Items**.
2. Click **Create Variant Group**.
3. Enter the base product name (e.g., "Globe ATHLETIX Turnout Coat").
4. Add variants with their sizes and styles:
   - **Size**: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL
   - **Style**: Regular, Long, Short, Tall
5. Each variant is created as an individual inventory item with its own stock, serial numbers, and assignments.

### How Variant Groups Work

- All variants share the same category, description, and base product name
- Each variant tracks its own quantity and assignments independently
- The variant group view shows aggregate stock across all sizes/styles
- When issuing from a variant group, the system prompts for size selection based on the member's size preferences (if recorded)

> **Screenshot needed:**
> _[Screenshot of the Variant Group creation form showing the base product name field, a table of variants with Size dropdown (XS–5XL), Style dropdown (Regular/Long/Short/Tall), and per-variant stock quantity fields. Show the "Add Variant" button at the bottom]_

> **Edge case:** If a variant group has zero total stock across all sizes, it still appears in the inventory list but is marked as "Out of Stock." Individual variants with zero stock are dimmed but not hidden, so administrators can see which sizes need reordering.

---

## Equipment Kits

Equipment kits bundle multiple inventory items into a named package for streamlined issuance — for example, a "New Recruit PPE Kit" containing a coat, pants, helmet, gloves, and boots.

### Creating a Kit

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory Admin > Items**.
2. Click **Create Equipment Kit**.
3. Enter the kit name and description.
4. Add component items by searching for existing inventory items.
5. Set the quantity of each component (e.g., 1 coat, 1 pants, 2 pairs of gloves).
6. Save the kit.

### Issuing a Kit

1. Open the kit from the inventory list.
2. Click **Issue Kit to Member**.
3. Select the member.
4. For variant group components, the system prompts for size selection — pre-filled from the member's size preferences if available.
5. Confirm the issuance.
6. Each component item is individually assigned/issued to the member with its own tracking record.

> **Screenshot needed:**
> _[Screenshot of the Equipment Kit detail view showing the kit name, description, a table of component items with name, category, and quantity columns, and the "Issue Kit to Member" button. Show a member's size preferences being applied to a coat variant selection]_

> **Hint:** Issuing a kit creates individual assignment/issuance records for each component. Returning kit components is done individually — there is no "return entire kit" operation, since components may be returned at different times or in different conditions.

> **Edge case:** If a kit component is out of stock when issuing, the system issues all available components and flags the unavailable ones. The admin receives a notification about the partial issuance.

---

## Member Size Preferences

Members can record their preferred sizes for different garment categories, making equipment ordering and kit issuance faster and more accurate.

### Recording Size Preferences

1. Navigate to your **Member Profile** or have an admin navigate to the member's profile.
2. Open the **Size Preferences** section.
3. Record sizes for applicable categories:
   - Coat (e.g., L Regular)
   - Pants (e.g., 34×32)
   - Gloves (e.g., XL)
   - Boots (e.g., 11 Wide)
   - Helmet (e.g., Standard)
4. Save.

### How Size Preferences Are Used

- **Kit issuance**: When issuing a kit with variant group components, the member's sizes are pre-selected in the variant picker
- **Reorder requests**: Size preferences are included in reorder request details so quartermasters know what to order
- **Reports**: Size distribution reports help with bulk ordering (e.g., "12 members need L coats, 8 need XL")

> **Screenshot needed:**
> _[Screenshot of the Member Size Preferences panel showing dropdown selectors for Coat Size, Coat Style, Pants Size, Pants Style, Glove Size, Boot Size, and Helmet Size, with Save button]_

---

## Auto-Generate Size & Style Variants (2026-03-14)

When creating a new uniform or PPE item that comes in multiple sizes and styles, you can auto-generate all variants at once instead of creating each one individually.

### How to Use

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory Admin > Items** and click **Add Item**
2. Fill in the base item details (name, category, description)
3. Toggle **Generate Sizes & Styles** to enable variant generation

> **Screenshot needed:**
> _[Screenshot of the ItemFormModal showing the "Generate Sizes & Styles" toggle enabled, with chip-based multi-select fields for Sizes (showing XS, S, M, L, XL, 2XL chips) and Styles (showing Regular, Long, Short chips), a colors text input with "Black, Navy" entered, and a live preview badge showing "12 items will be created"]_

4. Select **sizes** from the chip-based multi-select (e.g., S, M, L, XL, 2XL)
5. Select **styles** from the chip-based multi-select (e.g., Regular, Long, Short)
6. Enter **colors** as a comma-separated list (e.g., "Black, Navy, Red")
7. Review the live preview showing the total count: `sizes × colors × styles`
8. Click **Create** — the system generates all combinations as individual pool items grouped under a new `ItemVariantGroup`

### Example

For a turnout coat with:
- 4 sizes: S, M, L, XL
- 2 styles: Regular, Long
- 2 colors: Black, Tan

The system creates `4 × 2 × 2 = 16` pool items:
- Turnout Coat - S / Regular / Black
- Turnout Coat - S / Regular / Tan
- Turnout Coat - S / Long / Black
- ... (16 total)

All 16 items are linked under a single variant group and share the base description and category.

> **Screenshot needed:**
> _[Screenshot of the inventory items list showing a variant group expanded to display individual size/style/color variants with their stock levels]_

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty styles list | Defaults to `['regular']` — at least one variant per size/color |
| Empty colors list | Defaults to `['default']` — at least one variant per size/style |
| Duplicate variant group name | System prevents creation; choose a unique base item name |
| Changing variants after creation | Edit individual items normally; the variant group remains intact |

---

## Reorder Requests

When stock falls below an item's reorder point, the system generates alerts and supports a formal reorder request workflow.

### Setting Reorder Points

**Required Permission:** `inventory.manage`

1. Open any pool item's edit form.
2. Set the **Reorder Point** — the stock level at which a reorder alert triggers.
3. Save.

When available stock drops to or below the reorder point, the item appears on the low-stock dashboard and triggers email and/or SMS notifications (if Twilio is enabled).

### Creating a Reorder Request

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory Admin > Reorder** (`/inventory/admin/reorder`).
2. Click **Create Reorder Request**.
3. Select the item to reorder.
4. Enter the requested quantity and any notes.
5. Submit the request.

### Reorder Request Workflow

| Status | Description |
|--------|-------------|
| **Pending** | Request submitted, awaiting approval |
| **Approved** | Approved by a supervisor |
| **Ordered** | Purchase order placed with vendor (vendor name, PO number, expected delivery tracked) |
| **Received** | Items received and stock quantities reconciled |

Each status transition is audit-logged with the user, timestamp, and any notes.

> **Screenshot needed:**
> _[Screenshot of the Reorder Requests page showing a table of reorder requests with columns for item name, requested quantity, status badge (Pending in yellow, Approved in blue, Ordered in purple, Received in green), requested by, and date. Show the Create Reorder Request button in the toolbar]_

> **Edge case:** If an item's stock is replenished through a regular return or issuance reversal (not through the reorder workflow), the reorder request remains open. Admins should manually close or cancel outdated requests.

### Low Stock SMS Alerts

When `TWILIO_ENABLED=True` in the environment configuration, low-stock alerts are sent via SMS to configured recipients in addition to email notifications.

SMS alerts include:
- Item name
- Current stock level
- Reorder point threshold
- Direct link to the reorder request page

Configure SMS recipients in **Settings > Notifications > Inventory Alerts**.

> **Edge case:** SMS alerts are rate-limited to one per item per 24-hour period to prevent alert fatigue. If stock continues to drop, the initial alert covers it. A new alert is sent only if stock was replenished and then dropped again.

---

## Item Detail Page

Each inventory item has a dedicated detail page at `/inventory/items/:id` with a two-column layout:

### Left Sidebar
- **Barcode**: Visual barcode (Code128) with print button
- **Quick Info**: Status, condition, category, tracking type, location
- **Assignment/Issuance History**: Who has/had this item and when

### Main Content (Tabbed)
- **Overview**: Full item details, photos, purchase info, warranty
- **History**: Chronological log of all status changes, assignments, checkouts, and returns
- **Maintenance**: Maintenance records and upcoming scheduled maintenance
- **NFPA Compliance**: (If NFPA tracking enabled) Lifecycle dates, ensemble info, exposures, inspections

> **Screenshot needed:**
> _[Screenshot of the Item Detail page showing the two-column layout. Left sidebar shows a Code128 barcode, quick info card (status: Available, condition: Good, category: PPE), and assignment history timeline. Right side shows tabbed content with the Overview tab active displaying item name, description, serial number, purchase date, warranty info, and storage location]_

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

### Scanning a Member's ID Card

Instead of searching by name, you can scan a member's QR code or barcode ID card to quickly select them:

1. Click the **Scan Member ID** button in the toolbar.
2. Your device camera activates.
3. Point at the member's ID card QR code or barcode.
4. The member is instantly selected and their inventory loads.

This is especially useful on mobile during equipment distribution events where you need to process many members quickly.

> **Hint:** Member ID scanning requires the member to have a `membership_number` and an ID card generated by The Logbook's Member ID Card feature. If the scan fails, fall back to name search.

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

## CSV Import

You can bulk import inventory items from a CSV file instead of adding them individually.

### Importing Items

**Required Permission:** `inventory.manage`

1. Navigate to **Inventory**.
2. Click **Import** in the toolbar (or navigate to `/inventory/import`).
3. **Download the sample template** to see the expected CSV format.
4. Prepare your CSV file with the required columns:
   - **name** (required) — Item name
   - **category** (required) — Must match an existing category name
   - **description** — Item description
   - **serial_number** — Must be unique within your organization
   - **asset_tag** — Asset tag identifier
   - **condition** — Item condition (excellent, good, fair, poor)
   - **status** — Item status (available, assigned, in_maintenance, retired)
   - **storage_location** — Where the item is stored
   - Additional fields for purchase info, warranty, notes, etc.
5. Upload the CSV file.
6. Review the preview showing parsed items and any validation errors.
7. Click **Import** to create all valid items.

### Validation

The import validates:
- Required columns are present (`name`, `category`)
- Category names match existing categories
- Serial numbers are unique (no duplicates in file or existing inventory)
- Data types are correct (numbers, dates, enum values)

Items that fail validation are skipped with error details. Successfully validated items are imported.

> **Hint:** Start with a small test import (5–10 items) to verify your CSV format before importing a large batch. The sample template includes all supported columns with example data.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CSV import fails | Download the sample template and verify your CSV matches the format. Check that category names match existing categories. Serial numbers must be unique. |
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
| Thermal label blank or no barcode | Use Chrome/Edge (Safari has limited iframe print support). Verify Dymo (2.25×1.25″) or Rollo (4×6″) paper size in printer dialog. Check that inline SVG is not blocked by your Content Security Policy. Batch print ≤30 labels to avoid browser hangs. |
| Organization logo missing on labels | Logo is loaded from organization profile URL. If the URL returns 404 or CORS error, the label prints without logo silently. Verify the logo URL in Settings > Organization. |
| Form field cleared but value not resetting | The nullish coalescing operator (`??`) treats empty strings as truthy. This was fixed; pull latest code. If you see this in custom code, use `\|\|` instead of `??` when empty string should fall back to a default. |
| 422 error on item create/update | Optional fields (notes, description) must be omitted from the payload when empty, not sent as `""`. Pull latest frontend code. |
| WebSocket 403 on inventory page | The WebSocket connection needs the auth cookie. Pull latest; `withCredentials` is now set on the WebSocket connection. |
| Charges not appearing on returned items | Verify `inventory.manage` permission. Charges are tied to return/write-off events. Quarantine items cannot have charges until inspection completes. |
| Pool item cost recovery amount wrong | Check the item's `replacement_cost_per_unit` field. Cost recovery = (units not returned) × replacement cost per unit. |
| Return request stuck in pending | Admin must approve return requests in Inventory Admin > Items. Check that the admin has `inventory.manage` permission. |
| Quarantine item cannot be re-issued | Items in quarantine status must be inspected and cleared before re-issue. Change status from quarantine to available after inspection. |
| Size variant stock not matching total | Each size variant tracks its own stock independently. The total shown is the sum of all variants. Verify per-size quantities in the item detail modal. |
| Reorder request not triggering alerts | Verify the item's `reorder_point` is set (pool items only). Stock must drop to or below the threshold. Email alerts require `EMAIL_ENABLED=True`; SMS alerts require `TWILIO_ENABLED=True`. |
| SMS alerts not sending | Verify `TWILIO_ENABLED=True`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` are configured. Check that SMS recipients are configured in Settings > Notifications. |
| Kit issuance partially failed | If some kit components are out of stock, available items are still issued. Check the issuance result for per-component success/failure status. Reorder the missing components. |
| Member size preferences not showing during issuance | The member must have size preferences recorded in their profile. If blank, the variant picker shows all sizes without pre-selection. |
| Item detail page shows "Item not found" | Verify the item ID in the URL. The item may have been retired or deleted. Check that you are in the correct organization context. |
| Barcode not printing on labels | Ensure the item has a barcode, serial number, or asset tag assigned. SVG barcodes require a modern browser (Chrome/Edge recommended). Wait for the "Ready to print" indicator before printing. |
| Location filter shows no results | Verify that storage areas are linked to facility rooms. The cascading filter requires Facility → Room → Storage Area hierarchy to be configured. |
| Size/style variant generation creates too many items | The count is `sizes × colors × styles`. Remove unnecessary sizes or styles before generating. Preview shows the exact count before creation. |
| Variant group not created after generation | Verify that `create_variant_group` is enabled (toggled on by default). Check that at least one size and one style are selected. |
| Admin hub layout changed | Fixed 2026-03-22 — admin hub redesigned with grouped card sections. Pull latest. |
| Barcode labels not ISO compliant | Fixed 2026-03-22 — labels now follow ISO/IEC 15417 with correct quiet zones and bar widths. |
| Labels printing sideways on thermal printer | Fixed 2026-03-22 — auto-rotation detects roll-fed printers and rotates labels to maximize print area. |
| Label format mismatch between preview and PDF | Fixed 2026-03-22 — frontend and backend now share unified label format definitions. |
| Non-admin sees all equipment on dashboard | Fixed 2026-03-22 — non-admins now see only their own assigned equipment. |
| Mobile FAB shows Export CSV for non-admin | Fixed 2026-03-22 — FAB now shows "Assign Items" for non-admin users. |
| Barcode scan not working on desktop | Fixed 2026-03-22 — scanning now falls back to user-facing camera on desktop browsers. |

---

## Inventory Admin Hub Redesign (2026-03-22)

The inventory admin dashboard has been redesigned with **grouped card sections** and prominent navigation cards, replacing the previous flat list layout.

### New Layout

The admin hub now organizes pages into logical groups:

| Group | Pages |
|-------|-------|
| **Items & Stock** | Manage Items, Pool Items, Categories, Variant Groups |
| **Equipment Kits** | Equipment Kits management |
| **Member Equipment** | Members Inventory, Active Checkouts |
| **Requests & Workflows** | Equipment Requests, Return Requests, Write-Off Requests, Reorder Requests |
| **Maintenance & Reports** | Maintenance Records, Charges & Fees |
| **Import & Labels** | CSV Import, Barcode Label Printing |

> **Screenshot needed:**
> _[Screenshot of the redesigned Inventory Admin Hub showing grouped card sections — "Items & Stock" group with Manage Items, Pool Items, Categories, and Variant Groups cards, each with an icon, title, and item count badge]_

### New Admin Pages

Two new dedicated admin pages have been added:

**Equipment Kits** (`/inventory/admin/kits`):
- Create, edit, and delete equipment kits
- View kit components and their quantities
- Issue kits to members with size preference auto-selection

> **Screenshot needed:**
> _[Screenshot of the Equipment Kits admin page showing a list of kits with name, component count, and actions (Edit, Issue, Delete)]_

**Variant Groups** (`/inventory/admin/variant-groups`):
- View and manage variant groups with aggregate stock across all sizes
- Edit individual variants within a group
- Link to auto-generation for new variant groups

> **Screenshot needed:**
> _[Screenshot of the Variant Groups admin page showing variant groups with base product name, total stock across sizes, and expandable variant details]_

### Barcode Label Printing Improvements

Label generation has been significantly improved:

- **ISO/IEC 15417 compliance**: Correct quiet zones, minimum bar widths, and aspect ratios for reliable scanner readability
- **Auto-rotation for thermal printers**: Roll-fed labels auto-rotate to maximize print area
- **Test print**: New "Test Print" button generates a sample label for verifying printer alignment
- **Unified formats**: Frontend and backend share the same label format catalog, preventing size mismatches
- **Batch limit**: Maximum batch size enforced to prevent browser memory issues

> **Screenshot needed:**
> _[Screenshot of the label printing page showing the format dropdown (Letter, Dymo 30252, Dymo 30256, Dymo 30334, Rollo 4×6, Custom), the "Test Print" button, and a label preview with ISO-compliant barcode]_

### Inventory Dashboard Scoping

Non-admin users now see only their own assigned equipment on the inventory dashboard. This prevents information overload for regular members and aligns with role-based access principles.

> **Screenshot needed:**
> _[Screenshot comparison: left shows admin view with full department inventory summary, right shows member view with only "My Equipment" counts and items]_

> **Edge case:** Users with `inventory.manage` permission continue to see the full department inventory. The scoping applies only to users without admin permissions.

### Desktop Camera Scanning

Camera-based scanning (QR codes, barcodes, member IDs) now works on desktop browsers:

- **InventoryScanModal**: Barcode scanning for check-in/check-out works on all browsers via the shared `useHtml5Scanner` hook
- **MemberIdScannerModal**: Member ID card scanning works on desktop with user-facing camera fallback
- Both modals share the same camera initialization, resolution selection, and error handling logic

> **Screenshot needed:**
> _[Screenshot of the InventoryScanModal running on a desktop browser, showing the camera viewport with a barcode being detected and the item search results appearing below]_

> **Edge case:** If no camera is available, the scanner shows an error message and the user can fall back to manual text entry (barcode/serial number input field).

---

**Previous:** [Events & Meetings](./04-events-meetings.md) | **Next:** [Apparatus & Facilities](./06-apparatus-facilities.md)
