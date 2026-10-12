# Inventory Module — Developer Reference

Routes, API endpoints, data model and frontend architecture for the
inventory module. What the module does and how departments use it is on
[Inventory Module](Module-Inventory).

## Pages

| URL                                        | Page                               | Permission                                                          |
| ------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------- |
| `/inventory`                               | Inventory Items List               | `inventory.manage`                                                  |
| `/inventory/items`                         | Inventory Items List (breadcrumb)  | `inventory.manage`                                                  |
| `/inventory/my-equipment`                  | My Issued Gear                     | Authenticated                                                       |
| `/inventory/items/:id`                     | Item Detail                        | Authenticated                                                       |
| `/inventory/storage-areas`                 | Storage Areas                      | `inventory.manage`                                                  |
| `/inventory/storage-areas/print-labels`    | Storage Area Labels                | `inventory.manage`                                                  |
| `/inventory/checkouts`                     | Temporary Loans (active checkouts) | `inventory.manage`                                                  |
| `/inventory/import`                        | CSV Import                         | `inventory.manage`                                                  |
| `/inventory/print-labels`                  | Barcode Label Printing             | `inventory.manage`                                                  |
| `/inventory/admin`                         | Inventory Administration (hub)     | `inventory.manage`, `inventory.check_manage` or `storefront.manage` |
| `/inventory/admin/setup`                   | Setup Guide                        | `inventory.manage`                                                  |
| `/inventory/admin/items`                   | Manage Items                       | `inventory.manage`                                                  |
| `/inventory/admin/pool`                    | Pool Items                         | `inventory.manage`                                                  |
| `/inventory/admin/categories`              | Categories                         | `inventory.manage`                                                  |
| `/inventory/admin/maintenance`             | Maintenance Records                | `inventory.manage`                                                  |
| `/inventory/admin/members`                 | Member Equipment                   | `inventory.manage`                                                  |
| `/inventory/admin/charges`                 | Charges & Fees                     | `inventory.manage`                                                  |
| `/inventory/admin/returns`                 | Return Requests                    | `inventory.manage`                                                  |
| `/inventory/admin/requests`                | Gear Requests                      | `inventory.manage`                                                  |
| `/inventory/admin/clearances/:clearanceId` | Departure Clearance                | `inventory.manage`                                                  |
| `/inventory/admin/write-offs`              | Write-Off Requests                 | `inventory.manage`                                                  |
| `/inventory/admin/reorder`                 | Reorder Requests                   | `inventory.manage`                                                  |
| `/inventory/admin/vendors`                 | Vendors                            | `inventory.manage`                                                  |
| `/inventory/admin/allowances`              | Issuance Allowances                | `inventory.manage`                                                  |
| `/inventory/admin/impact-planner`          | Impact Planner                     | `inventory.manage`                                                  |
| `/inventory/admin/kits`                    | Gear Kits Management               | `inventory.manage`                                                  |
| `/inventory/admin/variant-groups`          | Variant Groups Management          | `inventory.manage`                                                  |
| `/inventory/admin/store`                   | Department Store console (`?tab=`) | `storefront.manage` (Department Store module)                       |
| `/inventory/admin/nfc`                     | NFC Tag Settings                   | `settings.manage` or `organization.update_settings`                 |
| `/inventory/admin/nfc/enroll`              | Tag Items in Bulk                  | `inventory.manage`                                                  |
| `/inventory/admin/not-seen`                | Items Not Seen                     | `inventory.manage`                                                  |
| `/inventory/put-away`                      | Put Away by NFC                    | `inventory.manage`                                                  |
| `/inventory/shelf-audit`                   | Shelf Audit                        | `inventory.manage`                                                  |
| `/inventory/kiosk`                         | Self-Service Kiosk                 | `inventory.kiosk`                                                   |
| `/inventory/tag/:code`                     | NFC tag link (redirect)            | `inventory.view`                                                    |

A member without `inventory.manage` reaches the catalogue only through
**Request Equipment** on My Issued Gear. `/store/admin` redirects to
`/inventory/admin/store`. The equipment-checklist pages are listed under
[Equipment Checklists](Module-Inventory#equipment-checklists).

### My Issued Gear

`/inventory/my-equipment` shows a member everything they hold:

- **Issued to Me** — assignments (one serialized unit, from
  `item_assignments`) and issuances (N units from bulk stock, from
  `item_issuances`) in one list sorted by when the gear was received. Each row
  shows what its record type carries: serial, asset tag and condition for an
  assignment; quantity and size for an issuance.
- **Active Temporary Loans** — its own section, because a due date is the one
  distinction a member has to act on, and it carries the overdue badge.
- Three quick-stat tiles: **Issued to me**, **Temporary loans** and **Pending
  requests** (open equipment requests and return notices).
- **Request Equipment** opens the request form; each held row has **Notify
  quartermaster of return**, which posts a return request with
  `return_type: assignment` or `issuance` against the right reference id.

The dashboard gear widget uses the same labels and counts entries, matching
the page.

### Inventory Administration hub

`/inventory/admin` opens on the three supply lines a department staffs —
**PPE & Turnout Gear**, **Uniforms** and **EMS Supplies** — which share one
catalog partitioned by `inventory_categories.item_type`. Below them the cards
are grouped by task: **Catalog**, **Issuance & Members**, **Requests &
Approvals**, **Readiness & Compliance**, **Department Store** and **Setup &
Tools** (`inventoryHubCards.ts`).

- **Every card carries the gate of the route it targets**, and a section with
  no visible cards is not rendered. `checkPermission` is exact match plus
  module wildcard, so `inventory.manage` implies neither
  `inventory.view_medical` nor `inventory.check_*`.
- The hub admits checklist officers and store managers, whose consoles it
  links to; each card still resolves its own permission.
- The attention queue reads ten sources. Each carries a shape check, and a
  source that fails or returns a malformed body is named in a "Some inventory
  services did not respond" banner rather than crashing the page. Open return
  notices are read with `status=requested`; departure clearances are fetched
  in every status and filtered to the two open ones (`initiated`,
  `in_progress`), named by `member_name`.
- Screens that are about gear keep the quartermaster's vocabulary: My Issued
  Gear, Gear Requests, Gear Kits.

The **Department Store** console (`/inventory/admin/store`) renders inside
the hub's shared administration frame (header, metrics row, attention queue).
Its tabs are selected by `?tab=`, so the hub links straight to Catalog,
Orders or Payments. Its route belongs to the storefront module and carries
that module's own gate.

### Storage Areas page

`/inventory/storage-areas` manages the facility → room → storage-area tree:

- **All areas show by default**; each area expands inline to list the items
  stored there (name, serial number, status, condition) with links to their
  detail pages, or an empty-state message.
- **Scan shelf label** resolves a scanned `SA-…` code against the barcodes the
  page has loaded, jumps to that area and writes `?area=<id>` so the view can
  be linked. **Put away** and **Check contents** start from an area.
- **Delete waits until the area is empty.** **Delete** is refused while the
  area holds items or has active nested areas; deleting only deactivates.
- Shelf labels print from `/inventory/storage-areas/print-labels`, through
  the `storage_areas` label module.

---

## Data Model

### Core Tables

| Table                         | Purpose                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_categories`        | Item categories with item type, requirements, low-stock thresholds, `allow_self_checkout` / `self_checkout_loan_days` for the kiosk                                                                                                                                                         |
| `inventory_items`             | Items with serial/barcode/asset tag, condition, status, tracking type, `reorder_point`, `standard_size` / `size`, `style` / `style_attributes`, `vendor_id`. `label_printed_at` / `label_printed_by` record the latest confirmed label print and are cleared when the printed value changes |
| `inventory_lots`              | A dated batch of a consumable held as ready stock: lot number, expiration, quantity, received date. **The source of "on hand" for any item that has lots**                                                                                                                                  |
| `item_assignments`            | Permanent/temporary assignments of individual items to members                                                                                                                                                                                                                              |
| `item_issuances`              | Pool item issuance records (quantity tracking, replacement-cost snapshot)                                                                                                                                                                                                                   |
| `checkout_records`            | Temporary loan records with expected return dates                                                                                                                                                                                                                                           |
| `maintenance_records`         | Maintenance history (inspection, repair, calibration, etc.)                                                                                                                                                                                                                                 |
| `storage_areas`               | Hierarchical storage areas with `SA-` barcodes and `audit_frequency`                                                                                                                                                                                                                        |
| `inventory_vendors`           | Suppliers: name (unique per organization), account number, phone/email/fax/website, address, payment terms, preferred and active flags                                                                                                                                                      |
| `inventory_vendor_contacts`   | Named people at a vendor (rep, service desk, AR) with title, email, phone/extension and a single primary flag                                                                                                                                                                               |
| `inventory_item_pins`         | Per-member pinned items, unique on `(user_id, item_id)`                                                                                                                                                                                                                                     |
| `inventory_label_prints`      | One row per confirmed label print                                                                                                                                                                                                                                                           |
| `inventory_nfc_tags`          | NFC tags on items, storage areas or equipment-check compartments (`check_compartment_id`): hashed identifier, last-four preview, written or serial, label, active/lost. Unique per organization                                                                                             |
| `inventory_nfc_scans`         | Staff NFC taps on items (lookups, put-aways, audits): who, when, which tag, to and from which storage area                                                                                                                                                                                  |
| `inventory_nfc_audits`        | Shelf audits: the storage area (name snapshotted), who ran it, expected / found / missing / unexpected counts, who confirmed moving items, `client_submission_id` for offline resends                                                                                                       |
| `inventory_nfc_audit_items`   | One line per item a shelf audit judged: found, missing or unexpected, where it was recorded, whether it was moved                                                                                                                                                                           |
| `inventory_nfc_audit_digests` | One row per weekly "shelf audits overdue" email sent: when, how many areas, how many recipients                                                                                                                                                                                             |

### Workflow Tables

| Table                          | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `departure_clearances`         | Member departure property return pipeline                  |
| `departure_clearance_items`    | Per-item resolution within a clearance                     |
| `equipment_requests`           | Member equipment request/approval workflow                 |
| `return_requests`              | Member-initiated return notices awaiting review            |
| `inventory_write_offs`         | Write-off request/approval workflow for lost/damaged items |
| `inventory_notification_queue` | Delayed notification consolidation queue                   |
| `property_return_reminders`    | Tracks reminder notices sent to departed members           |
| `issuance_allowances`          | Per-category issue caps by role and period                 |
| `inventory_impact_plans`       | Saved impact-planner scenarios (named filter sets)         |

### Variant, Kit & Purchasing Tables

| Table                     | Purpose                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `item_variant_groups`     | Groups related items that differ by size/colour/style                                |
| `equipment_kits`          | Named bundles of items for single-operation issuance                                 |
| `equipment_kit_items`     | Component items within a kit with per-component quantity and `optional`              |
| `member_size_preferences` | Member garment sizes (shirt, garment fit, pants, jacket, boots, gloves, hat, custom) |
| `reorder_requests`        | Reorder request workflow with status lifecycle                                       |
| `reorder_receipts`        | Stock received against a reorder request                                             |

### NFPA Tables

| Table                     | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `nfpa_item_compliance`    | Per-item NFPA 1851/1852 compliance record  |
| `nfpa_inspection_details` | Structured NFPA Ch. 6–8 inspection results |
| `nfpa_exposure_records`   | Exposure events logged against an item     |

### Key Enums

| Enum                     | Values                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ItemType                 | uniform, ppe, tool, equipment, vehicle, electronics, consumable, other, medical                                                                                                  |
| ItemStatus               | available, assigned, checked_out, in_maintenance, lost, stolen, retired                                                                                                          |
| ItemCondition            | excellent, good, fair, poor, damaged, out_of_service, retired                                                                                                                    |
| TrackingType             | individual, pool                                                                                                                                                                 |
| MaintenanceType          | inspection, repair, cleaning, testing, calibration, replacement, preventive, routine_inspection, advanced_inspection, independent_inspection, advanced_cleaning, decontamination |
| ClearanceStatus          | initiated, in_progress, completed, closed_incomplete                                                                                                                             |
| ClearanceLineDisposition | pending, returned, returned_damaged, written_off, waived                                                                                                                         |
| RequestType              | checkout, issuance, purchase, return                                                                                                                                             |
| RequestStatus            | pending, approved, denied, fulfilled                                                                                                                                             |
| ReturnRequestStatus      | requested, received, inspected, denied, completed                                                                                                                                |
| WriteOffStatus           | pending, approved, denied                                                                                                                                                        |
| StandardSize             | xxs–xxxxl, one_size, custom, boot/glove sizes 6–15 (half sizes to 12.5), waist sizes 28–46                                                                                       |
| GarmentStyle             | short_sleeve, long_sleeve, mens, womens, unisex, v_neck, crew_neck, polo, button_down, quarter_zip                                                                               |
| ReorderStatus            | pending, approved, ordered, partially_received, received, cancelled                                                                                                              |
| InventoryAuditFrequency  | weekly, monthly, quarterly, yearly                                                                                                                                               |

---

## API Endpoints

All paths are under `/api/v1`. The inventory routers are gated on the
**Inventory** module. Unless noted, reads take `inventory.view` and writes
take `inventory.manage`.

### Category Management

```
GET    /api/v1/inventory/categories                      # List categories
POST   /api/v1/inventory/categories                      # Create category
GET    /api/v1/inventory/categories/{id}                 # Get category
PATCH  /api/v1/inventory/categories/{id}                 # Update category
DELETE /api/v1/inventory/categories/{id}                 # Soft-delete; refused while active items reference it
```

### Setup

```
GET    /api/v1/inventory/setup/status                    # Setup guide progress (inventory.manage)
GET    /api/v1/inventory/setup/category-presets          # Starter categories
POST   /api/v1/inventory/setup/category-presets          # Create the ticked starter categories
```

### Item Management

```
GET    /api/v1/inventory/items                           # List items (filters, sort, group_by, label_printed, vendor_id, unassigned_location, size/color/style)
GET    /api/v1/inventory/items/colors                    # Distinct colours in use
POST   /api/v1/inventory/items                           # Create item
POST   /api/v1/inventory/items/bulk                      # Create many items; existing names skipped + reported
POST   /api/v1/inventory/items/create-if-absent          # Create unless a matching item exists
POST   /api/v1/inventory/items/create-variants           # Generate size × colour × style variants
GET    /api/v1/inventory/items/{id}                      # Get item details
GET    /api/v1/inventory/items/{id}/history              # Item history (inventory.manage)
PATCH  /api/v1/inventory/items/{id}                      # Update item (cannot deactivate)
POST   /api/v1/inventory/items/{id}/retire               # Retire item
GET    /api/v1/inventory/items/export                    # CSV export (inventory.manage; carries a Ready Lot Stock column)
GET    /api/v1/inventory/items/import-template           # CSV import template (inventory.manage)
POST   /api/v1/inventory/items/import                    # CSV import (inventory.manage)
GET    /api/v1/inventory/items/pins                      # Caller's pinned items
PUT    /api/v1/inventory/items/pins/order                # Reorder pins
POST   /api/v1/inventory/items/{id}/pin                  # Pin (max 25)
DELETE /api/v1/inventory/items/{id}/pin                  # Unpin
```

Pin endpoints take `inventory.view`: pins are per member.

### Stock Lots

```
GET    /api/v1/inventory/items/{item_id}/lots            # Lots held for an item
POST   /api/v1/inventory/items/{item_id}/lots            # Add one dated lot
POST   /api/v1/inventory/lots/bulk                       # Receive a delivery — all lines or none
PATCH  /api/v1/inventory/lots/{lot_id}                   # Correct a lot
DELETE /api/v1/inventory/lots/{lot_id}                   # Remove a lot
GET    /api/v1/inventory/lots/expiring                   # Shelf lots nearing their date
```

> **Expired lots are not ready stock.** They are excluded from the on-hand
> count, flagged in the payload, struck through in the UI and **refused by the
> equipment-check swap** — putting expired supplies in service would fail the
> item on the next check.

### Assignments & Issuances

```
POST   /api/v1/inventory/items/{id}/assign               # Assign to member
POST   /api/v1/inventory/items/{id}/unassign             # Unassign from member
POST   /api/v1/inventory/items/{id}/issue                # Issue from pool
POST   /api/v1/inventory/items/{id}/bulk-issue           # Issue from pool to several members
POST   /api/v1/inventory/issuances/{id}/return           # Return to pool
PUT    /api/v1/inventory/issuances/{id}/charge           # Set a charge on an issuance
GET    /api/v1/inventory/items/{id}/issuances            # Item's issuance records (inventory.manage)
GET    /api/v1/inventory/users/{id}/assignments          # User's assignments (self or inventory.manage)
GET    /api/v1/inventory/users/{id}/issuances            # User's issuances (self or inventory.manage)
GET    /api/v1/inventory/users/{id}/issuance-history     # User's issuance history (self or inventory.manage)
```

### Checkout / Check-in (temporary loans)

```
POST   /api/v1/inventory/checkout                        # Check out item
POST   /api/v1/inventory/checkout/{id}/checkin           # Check in item
PATCH  /api/v1/inventory/checkout/{id}/extend            # Extend return date (own loan or inventory.manage)
GET    /api/v1/inventory/checkout/active                 # Active checkouts (inventory.manage)
GET    /api/v1/inventory/checkout/overdue                # Overdue checkouts (inventory.manage)
```

An extended loan is due at the end of the chosen day in the department's
time zone.

### Batch & Scan Operations

```
GET    /api/v1/inventory/lookup                          # Search by code/name
POST   /api/v1/inventory/distribute-items                # Item distribution
POST   /api/v1/inventory/transfer                        # Transfer serialized gear between holders
POST   /api/v1/inventory/batch-return                    # Batch return
```

### Allowances, Charges & Returns

```
GET    /api/v1/inventory/allowances                      # List allowance rules (inventory.manage)
POST   /api/v1/inventory/allowances                      # Create rule
PUT    /api/v1/inventory/allowances/{id}                 # Update rule
DELETE /api/v1/inventory/allowances/{id}                 # Delete rule
GET    /api/v1/inventory/allowances/check/{user_id}/{category_id}  # Usage vs cap (self or inventory.manage)
GET    /api/v1/inventory/charges                         # Charges & fees (inventory.manage)
POST   /api/v1/inventory/return-requests                 # Member submits a return notice
GET    /api/v1/inventory/return-requests                 # List return notices (?status=requested|...)
PUT    /api/v1/inventory/return-requests/{id}/review     # Review a return notice (inventory.manage)
```

`GET /return-requests` types `status` as `ReturnRequestStatus`; an unknown
value is a 422 naming the valid values. A return notice's received count
starts empty and must match what the member reported.

### NFC Tags

**Setting it up:** see [Inventory NFC Tags](Inventory-NFC-Tags) for which tags
to buy, which phones can do what, linking, put-away and troubleshooting. This
section is the technical reference.

Off until an administrator turns it on at **Inventory → Administration → NFC
Tags** (`/inventory/admin/nfc`, which needs `settings.manage` or
`organization.update_settings`). The switch is stored as
`inventory.nfc_tracking_enabled` in the organization settings. While it is
off, every endpoint below except `GET /nfc/settings` answers 403, and NFC
pages such as **Tag Items in Bulk** say that an administrator can turn it on.
The not-seen report is the exception: it lives outside the NFC router and
works with the switch off.

```
GET    /api/v1/inventory/nfc/settings                    # Is it on? (inventory.view, check_submit or check_manage)
POST   /api/v1/inventory/nfc/resolve                     # Tapped tag -> item, exact match (inventory.view)
GET    /api/v1/inventory/items/{id}/nfc-tags             # Tags on an item (inventory.manage)
POST   /api/v1/inventory/items/{id}/nfc-tags             # Link a tag (inventory.manage)
PATCH  /api/v1/inventory/nfc-tags/{tag_id}               # Relabel, mark lost/found (inventory.manage; check_manage for a compartment tag)
DELETE /api/v1/inventory/nfc-tags/{tag_id}               # Unlink (inventory.manage; check_manage for a compartment tag)
POST   /api/v1/inventory/nfc/resolve-any                 # Tapped tag -> item or storage area (inventory.view)
POST   /api/v1/inventory/nfc/put-away                    # Move an item onto a storage area (inventory.manage)
GET    /api/v1/inventory/items/{id}/nfc-scans            # Tap log, newest first (inventory.manage)
GET    /api/v1/inventory/storage-areas/{id}/nfc-tags     # Tags on a storage area (inventory.manage)
POST   /api/v1/inventory/storage-areas/{id}/nfc-tags     # Link a tag to a storage area (inventory.manage)
POST   /api/v1/inventory/nfc/audits                      # Save a shelf audit: shelf + items tapped, <= 500 (inventory.manage)
GET    /api/v1/inventory/nfc/audits                      # Audits, newest first; ?storage_area_id= (inventory.manage)
GET    /api/v1/inventory/nfc/audits/{id}                 # One audit with its lines (inventory.manage)
POST   /api/v1/inventory/nfc/audits/{id}/apply           # Move chosen unexpected items onto the shelf (inventory.manage)
POST   /api/v1/inventory/nfc/resolve-member              # Tapped member ID card -> member; needs NFC ID Cards too (inventory.manage)
GET    /api/v1/inventory/nfc/untagged                    # Active items with no working tag; ?search=&category_id= (inventory.manage)
GET    /api/v1/inventory/nfc/audit-schedule              # Scheduled areas, overdue first; ?due_only= (inventory.manage)
PUT    /api/v1/inventory/storage-areas/{id}/audit-schedule # {"audit_frequency": "weekly"|...|null} (inventory.manage)
POST   /api/v1/inventory/nfc/put-away/replay             # Put-away taps made offline, applied in order; per-tap outcome (inventory.manage)
POST   /api/v1/inventory/nfc/audits/replay               # Shelf audit finished offline; resend-safe by client_submission_id (inventory.manage)
GET    /api/v1/inventory/check-compartments/{id}/nfc-tags # Tags on a checklist compartment (inventory.check_manage)
POST   /api/v1/inventory/check-compartments/{id}/nfc-tags # Link a tag to a checklist compartment (inventory.check_manage)
POST   /api/v1/inventory/nfc/resolve-check               # Tap during a check of template_id -> compartment or checklist rows (check_submit or check_manage)
POST   /api/v1/inventory/kiosk/identify                  # Card -> member + open loans (inventory.kiosk)
POST   /api/v1/inventory/kiosk/preview                   # Card + item -> checkout or return, or 409 why not (inventory.kiosk)
POST   /api/v1/inventory/kiosk/checkout                  # Borrow (inventory.kiosk)
POST   /api/v1/inventory/kiosk/return                    # Return; damaged + note marks the item damaged (inventory.kiosk)
GET    /api/v1/inventory/not-seen                        # Items not seen in ?days= (default 180) (inventory.manage; not NFC-gated)
GET    /api/v1/inventory/not-seen/export                 # The same as CSV, up to 5,000 rows (inventory.manage; not NFC-gated)
```

- **Two ways to link a tag.** _Write a link_: the phone writes
  `/inventory/tag/<code>` onto a blank tag, and any phone that taps it,
  iPhones included, opens the item. _Read the serial_: for tags that cannot be
  written; only the app on Android can use these. A USB reader or a typed
  serial works from a desktop.
- **Where a tap is used.** In the distribute and return scanner (**Tap NFC**,
  next to the camera), and from a phone's home screen for written tags.
- **Identifiers are stored hashed** (`inventory_nfc_tags.uid_hash`), using the
  same peppered hash as member ID cards. The phone that links equipment tags
  also reads ID cards, and a card tapped here by mistake must not leave its
  serial on record.
- **A lost tag resolves to nothing** until it is marked found, and a tag on a
  retired item resolves to nothing.
- **Browser support.** Web NFC exists only in Chrome on Android, over HTTPS.
  That is the browser's limit, not the app's.
- **Shelves carry tags too** (linked from the storage area editor), and so do
  **equipment-check compartments** (linked from the checklist builder). A tag
  names exactly one item, one storage area or one compartment; the database
  enforces it (`ck_inventory_nfc_tags_one_target`). A compartment tag is read
  only during a check of its own template (`/nfc/resolve-check`); the item and
  put-away lookups refuse it. Deleting a compartment deletes its tags, and so
  does replacing a template's contents from a vehicle preset, JSON or CSV
  import, because that recreates every compartment.
- **Offline taps** (put-away and shelf audits only). The phone keeps raw reads
  in the generic offline queue (`genericOfflineQueue.ts`, purged at sign-out)
  and never what a tag names; the `/replay` routes resolve them on arrival and
  apply the online rules in order. A put-away session is one queue entry,
  marked held while the screen adds to it and sent once it is released (or
  after 30 minutes idle). An offline audit carries a `client_submission_id`,
  unique per organization (`inventory_nfc_audits.client_submission_id`), so a
  resend after a lost response returns the audit already saved.
- **Put away** (`/inventory/put-away`). Tapping a shelf first _opens_ it:
  every item tapped afterwards goes onto it. Tapping an item first holds it
  until a shelf is tapped, moves it there, and leaves no shelf open. The move
  is the barcode put-away's own (`InventoryService.put_away_items`), so both
  ways follow one rule (see [Storage Areas](#storage-areas)).
- **The tap log** (`inventory_nfc_scans`) records taps by `inventory.manage`
  holders only: lookups in the scanner or through a written tag, and every
  put-away with where the item came from. A member opening a written tag from
  their own phone is not recorded. The item page shows the most recent taps
  as **Last Seen (NFC)**.
- **Shelf audits** (`/inventory/shelf-audit`). The expected set is the active
  items recorded on exactly that storage area (not its children) whose status
  does not already place them elsewhere (assigned, checked out, lost, stolen,
  retired). Saving an audit moves nothing. **Missing** items are only listed;
  an audit never marks an item lost. **Unexpected** items move onto the shelf
  only when ticked and confirmed (`/apply`), through `put_away_items`, so an
  assigned item is skipped with the reason. Every tapped item is logged in
  the tap log as `audit`, on the audited shelf.
- **Audit schedules.** `storage_areas.audit_frequency` (weekly, monthly,
  quarterly, yearly; null = not scheduled). The next audit is due one
  calendar period (`relativedelta`) after the area's latest saved audit, or
  now if it has none; this is computed on read, never stored. The
  `inventory_audit_digest` scheduled task checks daily and emails
  `inventory.manage` holders the overdue areas at most once a week per
  department, measured from `inventory_nfc_audit_digests` because the
  in-process scheduler forgets its run times on restart. It sends nothing
  when nothing is overdue or NFC is off, and a failed send is retried the
  next day.
- **Self-service kiosk** (`/inventory/kiosk`, `inventory.kiosk`, seeded to
  no position). Needs the NFC switch and the NFC ID Cards integration,
  checked on every kiosk route. Every request carries the card read, and the
  server re-reads it: the kiosk never sends a member id. Items qualify only
  when their category has `allow_self_checkout` (default false); pool items,
  items not `available`, and items failing the rank/position restriction
  (`InventoryService.member_clears_restrictions`, the request catalog's rule)
  are refused with a 409 and the reason, shown without a support code. A
  refused item tap is retried as a member card, so the next member does not
  have to wait for **Done**; a suspended card is named as such. A checkout is
  `InventoryService.checkout_item`, with the member as `user_id`, the kiosk
  officer as `checked_out_by`, reason "Self-service kiosk", and
  `expected_return_at` = now + the category's `self_checkout_loan_days` (none
  when blank). A return is accepted only from the member the item is checked
  out to. Damaged requires a note and sets the item's condition to `damaged`;
  otherwise the condition is unchanged. Audit events:
  `inventory_kiosk_checkout`, and `inventory_kiosk_return` (a warning when
  damaged).
- **Member ID card lookup.** With the NFC ID Cards integration connected, the
  member scanner on the inventory screens (distribute, return, member lookup)
  shows **Or tap their ID card**. The card resolves through the same hash and
  rules as the check-in station: a lost card or an inactive member is refused
  with the reason. Card taps are not written to the equipment tap log.
- **Bulk enrollment** (`/inventory/admin/nfc/enroll`) lists active items with
  no working tag (an item whose only tag is lost counts as untagged) and
  links one after another, by written link or by serial.
- **Not seen** (`/inventory/admin/not-seen`). An item's last-seen time is the
  latest of a staff tap (any action), an assignment or its return, a checkout
  or check-in, and a pool issuance or its return. Editing the item record
  does not count. A barcode put-away does not count either: it is recorded
  only as an audit-log event, with no per-item row to read. Retired items are
  left out; lost and stolen items are listed, since not seeing them is the
  point.

### Labels

```
GET    /api/v1/inventory/labels/formats                  # Available formats (inventory.view)
POST   /api/v1/inventory/labels/generate                 # Generate PDF labels (inventory.manage)
POST   /api/v1/inventory/labels/mark-printed             # Record a confirmed print (inventory.manage; 1–500 ids)
GET    /api/v1/inventory/items?label_printed=true|false  # Filter by label status (also on /items/export)
GET    /api/v1/inventory/label-preset                    # Caller's label preset (inventory.view)
PUT    /api/v1/inventory/label-preset                    # Save the caller's label preset (inventory.view)
GET    /api/v1/inventory/label-setups                    # Saved print setups, department-wide (inventory.manage)
POST   /api/v1/inventory/label-setups                    # Save (same name, any case, replaces; max 20)
DELETE /api/v1/inventory/label-setups/{id}               # Delete for everyone
POST   /api/v1/labels/print  {module: "inventory", ...}  # Send to a registered network printer (shared endpoint)
```

`/inventory/labels/generate` takes a format (`letter` for Avery 5160 sheets,
a Dymo/Rollo/Zebra/thermal roll preset, or `custom` with width and height),
`auto_rotate` (defaults per format: on for Rollo/generic rolls, off for
Dymo), `symbology` (`code128` default, or `qr`), `start_position` (1–30,
Avery 5160 only, ignored on rolls) and `extra_lines`, whose keys add a line
(`location`, `storage_area`, `category`, `size`, `condition`, or
`custom:<text>`) or drop a default one (`no_name`, `no_asset_tag`,
`no_serial_number`). Each confirmed print writes an `inventory_label_prints`
row beside the latest-only `label_printed_at`.

The print page (`/inventory/print-labels`):

- Opened with nothing selected, it offers a category / location /
  storage-area picker (`LabelScopePicker`) with a live match count.
- It loads up to 5,000 items for one run; a print job holds at most 500
  labels, so a larger run prints in parts, each confirmed in turn.
- Saved setups are shared by the department, up to 20.

Details in
[`docs/LABEL_PRINTING_MODULE.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/LABEL_PRINTING_MODULE.md).

### Maintenance

```
POST   /api/v1/inventory/maintenance                     # Create record
PATCH  /api/v1/inventory/items/{id}/maintenance/{rid}    # Update record
GET    /api/v1/inventory/items/{id}/maintenance          # Item history
GET    /api/v1/inventory/maintenance/due                 # Items due
```

Maintenance dates default to the department's today.

### Reporting & Analytics

```
GET    /api/v1/inventory/summary                         # Dashboard stats (items_by_type, non_medical_items)
GET    /api/v1/inventory/summary/by-location             # Per-location counts, medical stock excluded
GET    /api/v1/inventory/low-stock                       # Low-stock alerts
GET    /api/v1/inventory/members-summary                 # Per-member summary (inventory.manage; ?userId=)
GET    /api/v1/inventory/users/{id}/inventory            # User's full inventory (self or inventory.manage)
```

- `GET /inventory/summary` reports `items_by_type` and `non_medical_items`
  counted as **rows**, unlike `total_items`, which sums quantities — so a
  supply-line card matches the list it opens.
- `GET /inventory/members-summary?userId=` keeps a named member in the
  result whatever their status; a departure clearance is created after the
  member is dropped and made inactive, and the list is otherwise active-only.

### Departure Clearance

```
POST   /api/v1/inventory/clearances                      # Initiate clearance
GET    /api/v1/inventory/clearances                      # List clearances
GET    /api/v1/inventory/clearances/{id}                 # Get clearance details
GET    /api/v1/inventory/users/{id}/clearance            # User's clearance (self or inventory.manage)
POST   /api/v1/inventory/clearances/{id}/items/{iid}/resolve  # Resolve line item
POST   /api/v1/inventory/clearances/{id}/complete        # Complete clearance
```

A clearance opens as `initiated` and becomes `in_progress` once something
comes back.

### Gear Request Endpoints

```
GET    /api/v1/inventory/requestable-catalog             # What a member may ask for (server-filtered for rank/position)
POST   /api/v1/inventory/requests                        # Create request
GET    /api/v1/inventory/requests                        # List requests
GET    /api/v1/inventory/requests/{id}/fulfillment-options  # Rows that can fulfil it (inventory.manage)
PUT    /api/v1/inventory/requests/{id}/review            # Approve/deny; body may carry notify_member (default true)
PUT    /api/v1/inventory/requests/{id}/fulfill           # Fulfil an approved request
```

Behaviour is described under [Gear Requests](Module-Inventory#gear-requests).

### Storage Areas

```
GET    /api/v1/inventory/storage-areas                   # List storage areas (tree or flat)
POST   /api/v1/inventory/storage-areas                   # Create storage area
PUT    /api/v1/inventory/storage-areas/{id}              # Update storage area
DELETE /api/v1/inventory/storage-areas/{id}              # Delete (deactivate) storage area
POST   /api/v1/inventory/storage-areas/{id}/put-away     # File 1–500 items onto the area (inventory.manage)
```

**Put-away.** `InventoryService.put_away_items` is the single rule for
shelving, shared by the barcode **Put away** panel and NFC put-away (audit
event `inventory_items_put_away`, `method=nfc` on a tap). The area is
resolved in the caller's org (404 otherwise); item ids from another org are
counted, never touched. A moved item takes the area and the room of the
nearest ancestor that has one. Items assigned, checked out, lost, stolen or
retired are skipped with a reason; items already there are reported.

**Every storage area has a barcode.** Creation assigns one when the caller
does not supply it — the next code in a per-org sequential series (default
prefix `SA-`, counter in `organization.settings["storage_area_barcode"]`,
manually-taken codes skipped). A blank barcode in an update does not strip a
code already printed on the shelf, and an area without one picks a code up on
its next edit.

The Storage Areas page resolves a scanned `SA-…` code itself (see
[Storage Areas page](#storage-areas-page)). The generic `/inventory/lookup`
(`InventoryService.search_by_code`) searches items only —
`barcode` / `serial_number` / `asset_tag` / `name` / `size` / `color` — and
does not map an `SA-` code to its area, so scanning a shelf label in the
distribute/return scanner finds nothing. Tracked as **INV-8** in
[KNOWN_LIMITATIONS](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).

### Vendors

```
GET    /api/v1/inventory/vendors                         # List vendors (search, active_only) — inventory.view
GET    /api/v1/inventory/vendors/{id}                    # Vendor with contacts and purchasing totals — inventory.view
POST   /api/v1/inventory/vendors                         # Create vendor (contacts optional, in one pass)
PATCH  /api/v1/inventory/vendors/{id}                    # Update vendor
DELETE /api/v1/inventory/vendors/{id}                    # Deactivate (items/reorders keep their link)

POST   /api/v1/inventory/vendors/{id}/contacts               # Add a contact
PATCH  /api/v1/inventory/vendors/{id}/contacts/{contact_id}  # Update a contact
DELETE /api/v1/inventory/vendors/{id}/contacts/{contact_id}  # Remove a contact

GET    /api/v1/inventory/vendors/unlinked-names          # Typed-in names with nothing behind them (inventory.manage)
POST   /api/v1/inventory/vendors/{id}/attach-name        # Link every row carrying a typed-in name
POST   /api/v1/inventory/vendors/{id}/merge              # Fold a duplicate in; it is then removed
```

- **Vendors are rows** (`inventory_vendors`), not a hand-typed name on each
  item. A vendor carries the company's own details (main line, orders inbox,
  remit-to address, account number, payment terms) plus a contact list
  (`inventory_vendor_contacts`) with as many named people as it needs,
  exactly one flagged primary. Items and reorder requests link to a vendor
  (`vendor_id`), so a vendor card shows live purchasing history — items
  bought, open reorders, total purchased — and an item's detail page names
  the supplier to call. The free-text `vendor` column remains as a fallback
  for rows nobody has linked. Deactivating a vendor keeps those links.
- **Merge** folds a duplicate into another vendor — items, reorder requests
  and contacts move across and the duplicate is removed, freeing its name;
  the target's own details are never overwritten.
- **Attach** works from the other end: the vendors screen counts supplier
  names typed onto rows that were never linked ("Supplier names not on the
  list") and offers each one as a new vendor or an attachment to an existing
  one, linking every row carrying that name in one pass. Names match
  case-insensitively, and rows already linked to another vendor are left
  alone.
- **CSV import** lists unmatched supplier names once their row has actually
  imported, folding spelling variants (`Gals`/`gals`/`GALS`) into one entry.
  A name matching a **deactivated** vendor links to it rather than being
  reported.
- `unlinked-names` is declared before `/vendors/{id}` on purpose — routes
  match in order, and the id route would otherwise reject "unlinked-names" as
  a malformed UUID.
- The two read endpoints take `inventory.view`; everything that writes takes
  `inventory.manage`. The screen sits behind `inventory.manage`, like every
  page under `/inventory/admin`; the read permission on the API serves
  surfaces that only need to name a vendor. `GET /api/v1/inventory/items?vendor_id=…`
  filters the catalog to one vendor — the link behind the item count on a
  vendor card.
- `inventory.view` gets the directory, not the commercial terms:
  `account_number`, `payment_terms` and `total_purchase_value` come back
  blank unless the caller also holds `inventory.manage`. Name, phone, email,
  fax, website, address, contacts and the item/reorder counts are returned.

### Write-Off Requests

```
POST   /api/v1/inventory/write-offs                      # Create write-off request
GET    /api/v1/inventory/write-offs                      # List write-off requests
PUT    /api/v1/inventory/write-offs/{id}/review          # Approve/deny write-off
```

All three take `inventory.manage`.

### Variant Groups, Gear Kits & Size Preferences

```
GET    /api/v1/inventory/variant-groups                  # List variant groups
POST   /api/v1/inventory/variant-groups                  # Create variant group
GET    /api/v1/inventory/variant-groups/{id}             # Get variant group
PATCH  /api/v1/inventory/variant-groups/{id}             # Update variant group
DELETE /api/v1/inventory/variant-groups/{id}             # Soft-delete variant group

GET    /api/v1/inventory/kits                            # List equipment kits
POST   /api/v1/inventory/kits                            # Create equipment kit
GET    /api/v1/inventory/kits/{id}                       # Get equipment kit
PATCH  /api/v1/inventory/kits/{id}                       # Update equipment kit
DELETE /api/v1/inventory/kits/{id}                       # Soft-delete equipment kit
POST   /api/v1/inventory/kits/{id}/issue/{user_id}       # Issue kit to member

GET    /api/v1/inventory/my/size-preferences             # Caller's sizes (404 when unset)
PUT    /api/v1/inventory/my/size-preferences             # Upsert caller's sizes
GET    /api/v1/inventory/members/{user_id}/size-preferences  # A member's sizes (self or inventory.manage)
PUT    /api/v1/inventory/members/{user_id}/size-preferences  # Upsert a member's sizes (inventory.manage)
```

### Reorder Requests

```
GET    /api/v1/inventory/reorder-requests                # List reorder requests
GET    /api/v1/inventory/reorder-requests/{id}           # Get one request
POST   /api/v1/inventory/reorder-requests                # Create reorder request
PATCH  /api/v1/inventory/reorder-requests/{id}           # Update request details
POST   /api/v1/inventory/reorder-requests/{id}/transition    # Move to the next status
POST   /api/v1/inventory/reorder-requests/{id}/correct-status # Correct a status set in error
POST   /api/v1/inventory/reorder-requests/{id}/receipts  # Receive stock against the request
DELETE /api/v1/inventory/reorder-requests/{id}           # Delete request
```

All reorder endpoints take `inventory.manage`. Receiving requires a linked
inventory item; an unlinked request's **Receive stock** says it cannot be
received there. Reorder statuses display as readable labels.

### NFPA 1851/1852 Compliance

```
GET    /api/v1/inventory/items/{id}/nfpa-compliance      # Get NFPA compliance record
POST   /api/v1/inventory/items/{id}/nfpa-compliance      # Create NFPA compliance record
PATCH  /api/v1/inventory/items/{id}/nfpa-compliance      # Update NFPA compliance record
DELETE /api/v1/inventory/items/{id}/nfpa-compliance      # Remove NFPA compliance record
GET    /api/v1/inventory/items/{id}/exposures            # List exposure records
POST   /api/v1/inventory/items/{id}/exposures            # Log exposure event
GET    /api/v1/inventory/nfpa/summary                    # NFPA compliance dashboard
GET    /api/v1/inventory/nfpa/retirement-due             # Items nearing 10-year retirement
```

A missing NFPA record reads as "none started" on the item page.

### Impact Planner Endpoints

All endpoints require `inventory.manage`.

```
GET    /api/v1/inventory/impact-planner/options          # Filter options (ranks, stations, positions, statuses, membership types, categories, size fields)
POST   /api/v1/inventory/impact-planner                  # Analyze impact for a filter set → matched members, per-size breakdown, counts
POST   /api/v1/inventory/impact-planner/reorder          # Create one pending reorder request per size with a shortfall (pre-priced)
POST   /api/v1/inventory/impact-planner/issue            # Bulk-issue matching on-hand pool stock to members who need it
POST   /api/v1/inventory/impact-planner/request-sizes    # Notify (in-app) members who need the item but have no size on file
POST   /api/v1/inventory/impact-planner/pdf              # Stream a print-ready PDF summary
GET    /api/v1/inventory/impact-planner/plans            # List saved plans
POST   /api/v1/inventory/impact-planner/plans            # Save a named plan (filter set)
PATCH  /api/v1/inventory/impact-planner/plans/{plan_id}  # Update a saved plan
DELETE /api/v1/inventory/impact-planner/plans/{plan_id}  # Delete a saved plan
```

The analyze request is reused (and extended) by reorder/issue/pdf/plans.
Optional layers — `stock_category_id` (+`size_field`) for on-hand netting and
cost, `replacement_aware`, and `allowance_aware` — gate the extra computation
so a basic query stays cheap. `analyze`/`pdf` include member contact details
only per the org's `contact_info_visibility` settings; `reorder`/`issue` are
audit-logged and `issue` publishes an `inventory_changed` WebSocket event.
Behaviour is described under [Impact Planner](Module-Inventory#impact-planner).

### Equipment Checks

The checklist API is mounted at `/api/v1/equipment-checks` (Inventory module
gate). The main groups:

```
POST/GET/PUT/DELETE /api/v1/equipment-checks/templates[/{id}]     # Checklists (write: inventory.check_manage)
POST   /api/v1/equipment-checks/templates/{id}/clone              # Clone a checklist
GET    /api/v1/equipment-checks/templates/{id}/changelog          # Edit history (inventory.check_manage)
...    /api/v1/equipment-checks/templates/{id}/compartments[...]  # Compartments: add, replace, reorder, clone
...    /api/v1/equipment-checks/compartments/{id}/items[...]      # Checklist rows: add, bulk add/delete, reorder
GET    /api/v1/equipment-checks/shifts/{shift_id}/checklists      # What a shift carries
POST   /api/v1/equipment-checks/shifts/{shift_id}/checks          # Start a check (check_submit or check_manage)
POST   /api/v1/equipment-checks/checks                            # Standalone check
PUT    /api/v1/equipment-checks/checks/{id}/complete              # Submit a check
GET    /api/v1/equipment-checks/my-checklists                     # Caller's owed checks (any member)
GET    /api/v1/equipment-checks/my-checklists/history             # Caller's filed checks
GET    /api/v1/equipment-checks/fleet                             # Fleet readiness (inventory.check_view)
GET    /api/v1/equipment-checks/log                               # Check log (narrowed to own checks without check_view)
GET    /api/v1/equipment-checks/reports/{compliance|failures|item-trends}  # Reports (inventory.check_view)
GET    /api/v1/equipment-checks/reports/export/{csv|pdf}          # Report exports (inventory.check_view)
GET    /api/v1/equipment-checks/supply/expiring-items             # Expiring on apparatus (check_view or inventory.manage)
GET    /api/v1/equipment-checks/supply/item-deployments/{inventory_item_id}  # Where an item is carried (check_view or inventory.view)
GET    /api/v1/equipment-checks/apparatus/{apparatus_id}/inventory  # Standing view of one truck
POST   /api/v1/equipment-checks/items/{template_item_id}/swap     # Swap a lot aboard (expired lots refused)
```

---

## Real-Time Updates (WebSocket)

Inventory changes are broadcast in real time so that all connected users see
updates without manual refresh.

### Architecture

```
Browser  ←  WebSocket  ←  FastAPI endpoint  ←  Redis pub/sub  ←  API mutation endpoints
```

- **Backend**: `ConnectionManager` in `app/core/websocket_manager.py` manages
  per-org WebSocket connections and a Redis pub/sub listener. A
  `client_state` guard prevents a second `accept()` on a connection already
  accepted during early authentication
- **Endpoint**: `WS /api/v1/inventory/ws` — authenticates via the httpOnly
  `access_token` cookie (preferred for browsers) or a `?token=<jwt>` query
  parameter (fallback for non-browser clients), subscribes to org-scoped
  events. The global CSRF middleware returns early for WebSocket scope
- **Publishing**: each mutation endpoint publishes an event after the audit
  log entry
- **Frontend**: the `useInventoryWebSocket` hook auto-connects with
  exponential-backoff reconnect, and does not reconnect after a normal close
  (1000) or an auth failure (4001/4003)

### Event Format

```json
{ "type": "inventory_changed", "action": "<action>", "data": { ... } }
```

Actions: `item_created`, `items_bulk_created`, `items_imported`,
`item_updated`, `item_retired`, `item_assigned`, `item_unassigned`,
`item_checked_out`, `item_checked_in`, `checkout_extended`,
`distribute_items`, `batch_return`, `pool_issued`, `pool_returned`,
`bulk_issued`, `bulk_issued_from_plan`, `write_off_reviewed`,
`return_request_reviewed`

### Graceful Degradation

If Redis is unavailable, events are broadcast to local connections only
(single-worker mode). The WebSocket connection retries with exponential
backoff (1s → 30s cap).

---

## Frontend Architecture

### Shared Constants

Condition options are centralized in `frontend/src/constants/enums.ts`:

- `ITEM_CONDITION_OPTIONS` — all conditions including out_of_service and
  retired (for admin forms)
- `RETURN_CONDITION_OPTIONS` — return-safe conditions (excludes
  out_of_service and retired)

Request status labels are `EQUIPMENT_REQUEST_STATUS_LABELS` in
`modules/inventory/types/index.ts`; the glossary is
`modules/inventory/terminology.ts`.

### Key Components

| Component               | Purpose                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `InventoryItemsPage`    | Items list: filters, location cards, pins, grouping, bulk actions, label selection                                             |
| `InventoryAdminHub`     | Inventory Administration hub (cards in `inventoryHubCards.ts`)                                                                 |
| `InventoryMembersPage`  | Per-member inventory view with sorting and expandable details                                                                  |
| `ItemDetailPage`        | Item detail with barcode sidebar and tabs                                                                                      |
| `MyEquipmentPage`       | My Issued Gear                                                                                                                 |
| `RequestEquipmentModal` | Member request form over the requestable catalog                                                                               |
| `MemberIdScannerModal`  | Camera-based member ID scanning, resolved through `POST /member-badges/resolve`                                                |
| `InventoryScanModal`    | Barcode/QR scanning + live search for distribution and return (native BarcodeDetector with html5-qrcode fallback, **Tap NFC**) |
| `ReturnItemsModal`      | List-based return workflow for a member's held items                                                                           |
| `VariantCapsules`       | Size/colour/style pills                                                                                                        |
| `LabelScopePicker`      | Choose a label batch by filter                                                                                                 |
| `useInventoryWebSocket` | Hook for real-time WebSocket updates with auto-reconnect                                                                       |

### Test Coverage

Inventory pages and components carry co-located tests under
`src/modules/inventory/**` (for example
`pages/InventoryMembersPage.test.tsx`, which covers loading, empty and error
states, sorting by name, total items, overdue and assigned, and debounced
search), plus `src/constants/enums.test.ts` for condition-constant
consistency. Route gates are checked by `routes.test.tsx` and
`routes.authorization.test.tsx`.

---
