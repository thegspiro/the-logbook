# Inventory Module

> **Structured reference:** data shapes, the route groups with their gates,
> the self-scoping rules, invariants, edge cases and troubleshooting live in
> [docs/INVENTORY_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/INVENTORY_MODULE.md).
> This page carries the exhaustive endpoint paths and the per-feature
> walkthroughs.

The Inventory module tracks department equipment, member assignments,
pool/quantity stock, dated consumable lots, batch operations, departure
clearance, write-off approval, vendors, NFC tags, label printing and the
apparatus equipment checklists.

---

> **Developers:** routes, API endpoints, the data model and the frontend
> architecture are on [Inventory Module — Developer Reference](Module-Inventory-Developer).

## Quartermaster Vocabulary

The canonical terms live in one place
(`frontend/src/modules/inventory/terminology.ts`), which supplies a glossary
(`INVENTORY_TERMS`) and a request-type helper (`equipmentRequestTypeLabel`):

| Term               | Means                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| **Assignment**     | Serialized gear held on an ongoing basis                                   |
| **Temporary loan** | Serialized gear expected back by a date                                    |
| **Issuance**       | Quantity-tracked stock given to a member                                   |
| **Return**         | Physically receiving assigned or issued gear                               |
| **Check-in**       | Closing a temporary loan when the gear is received                         |
| **Transfer**       | Moving serialized gear between holders                                     |
| **Distribution**   | One mixed batch that may create assignments, temporary loans and issuances |

The glossary is the target vocabulary, not a description of every label on
every screen. Some screens still use older wording: the expanded row on
**Member Equipment** says **Active Checkouts**, and the equipment-request
fulfilment selector offers **Checkout — returnable individual item**. The
batch scanner is titled **Distribute Items**.

**API payload values use the older names** (`checkout`, `assignment`,
`issuance`); integrations send and receive those.

---

## Key Features

### Tracking and stock

- **Individual & Pool Items** — individual items (serialized, assigned to one
  person) and pool/quantity items (shared stock), selected by `tracking_type`
- **Item Issuances** — full lifecycle for pool issue/return with user,
  quantity, reason and condition. Issuing more than is on hand, or returning
  more than was issued, is refused with the counts rather than silently
  lowered
- **Dated Stock Lots** — consumables are held as dated lots (`inventory_lots`)
  rather than one flat count. **On-hand comes from in-date lots** for any item
  that has them and from `InventoryItem.quantity` for the rest; expired lots
  count as zero, because the equipment-check swap refuses them and counting
  them would hide the shortage most in need of ordering. One shared helper
  backs the reorder alert, the items grid, the CSV export and the item detail
  page, so they cannot disagree
- **Receive Stock (bulk lots)** — record a whole delivery in one pass: item,
  lot number, expiration and quantity per line, one received date for the lot
  of it. `POST /inventory/lots/bulk` validates every item is in the caller's
  org and **applies all lines or none**
- **Add Several (bulk item create)** — paste a list of catalog items. Names
  already in the catalog are **skipped and reported, not rejected**, so a list
  can be re-pasted after it grows; any validation failure writes nothing
- **Shelf-to-Truck Link** — an item's **Stock Lots** tab lists the apparatus
  checklist positions it fills and what each truck is carrying now
  (`GET /equipment-checks/supply/item-deployments/{id}`) — the direction a
  recall or an expiring lot is worked from, because the officer is holding the
  item. The forward direction is the
  [Expiring on Apparatus](#equipment-checklists) worklist
- **Org-Scoped Uniqueness** — serial numbers, barcodes and asset tags are
  unique per organization
- **Row-Level Locking** — `SELECT FOR UPDATE` on mutation operations to
  prevent race conditions
- **Unissuable stock** — pool stock whose status is `in_maintenance`,
  `retired`, `lost` or `stolen`, or whose condition is unsafe (poor, damaged,
  out of service, retired), cannot be issued; every issuance path funnels
  through `issue_from_pool`, which holds that gate
- **Category Management** — items organized by category with low-stock
  thresholds and maintenance requirements; a category's low-stock alert fires
  when stock is **at or below** its threshold (`<=`)
- **Item Reorder Points** — a per-item `reorder_point` threshold drives the
  low-stock dashboard line and the low-stock **email** alert. Low-stock and
  reorder notices are email-only (see
  [notification policy](#cross-module-connections))
- **Cost Data** — purchase price, replacement cost and cost recovery in item
  views and the admin dashboard
- **Charges & Cost Recovery** — damage fees or replacement costs attached to
  return/write-off events; pool items snapshot a per-unit replacement cost on
  each issuance. **Apply Charge** requires an amount above $0
- **Overdue Tracking** — computed at read time; the
  `inventory_overdue_alerts` scheduled task reports it daily
- **Notification Netting** — offsetting actions (assign → unassign) cancel
  each other's pending notifications in `inventory_notification_queue`

### Members and issuance

- **Batch Operations** — `distribute-items` and `batch-return` handle
  multiple items in a single request
- **Gear Requests** — members request temporary loans, issuances or
  purchases; quartermasters approve, decline and fulfil (see
  [Gear Requests](#gear-requests))
- **Return Requests** — members submit return notices from My Issued Gear;
  a quartermaster reviews them before processing
- **Gear Kits** — named bundles (e.g. "New Recruit PPE Kit") issued in one
  operation with per-component tracking. A component can be flagged
  **optional** (`equipment_kit_items.optional`), and an optional component
  that is out of stock does not block issuing the rest of the kit. Issuing a
  kit asks for confirmation, naming the member
- **Bulk issuance** — one pool item issued to several members at once
  (`POST /items/{id}/bulk-issue`)
- **Issuance Allowances** — `/inventory/admin/allowances` configures
  per-category issue caps by role and period (`annual` / `career` /
  `one_time`). `role_id` NULL applies to all members; the most specific match
  (highest-priority position) wins. Enforced on pool issuance unless an admin
  sets `override_allowance`; all mutations are audit-logged. A category with
  no rule is unlimited, and the UI says so in words
- **Member Size Preferences** — `SizePreferencesModal` lets members edit
  their own sizes (`/inventory/my/size-preferences`) and quartermasters edit
  any member's (`/inventory/members/{user_id}/size-preferences`). Nine fields
  (shirt size, garment fit, pant waist/inseam, jacket, boot size/width, glove,
  hat) plus a `custom_sizes` JSON column. Unset sizes return 404 and open the
  form blank. Used for auto-selection during kit issuance, the request form
  and the impact planner
- **Departure Clearance** — full lifecycle (initiate → resolve line items →
  complete) for tracking property return when members depart; each clearance
  has its own page at `/inventory/admin/clearances/:clearanceId`
- **Property return reminders** — dropped members still holding property get
  a 30-day and then a 90-day reminder (see
  [Scheduled tasks](#scheduled-tasks))
- **Write-Off Approval** — supervisor-reviewed workflow for lost, stolen,
  damaged or obsolete items before they are removed from inventory
- **Retirement** — the retire action is the only way to deactivate an item
  (see [Retiring an item](#retiring-an-item))

### Scanning, labels and NFC

- **Barcode & QR Scanning** — camera scanning for distribution and return via
  the BarcodeDetector API (Chrome/Edge) with an html5-qrcode fallback
  (Firefox/Safari/desktop), through the shared `useHtml5Scanner` hook.
  Desktop webcams work via an environment → user `facingMode` fallback. A
  camera error stays on screen, and manual entry remains available
- **Live Search** — real-time item lookup by name, barcode, serial number,
  asset tag, size or colour during scan operations (`GET /inventory/lookup`)
- **Mobile Member ID Scanning** — camera scanning of a member ID card for
  quick lookup during distribution. The scanner sends what it reads to
  `POST /member-badges/resolve`, which answers only within the caller's
  organization, so the QR on a card names a member only if it is a badge code
  the server issued. Older membership-number and member-id badges resolve
  until an officer turns off **Accept old badges** on the ID card print page.
  With the NFC ID Cards integration connected, the scanner also offers **Or
  tap their ID card**
- **Sequential barcodes** — item barcodes use one per-organization sequential
  scheme, `<prefix><zero-padded number>` with a 6-digit minimum (default
  `INV-000001`). The prefix and counter live in
  `organizations.settings["barcode"]`; the org row is locked `FOR UPDATE` for
  the read-increment so concurrent creates get distinct numbers. Assigned at
  item creation by `_next_sequential_barcode()`, which item creation, variant
  generation and label backfill share. Item detail always shows the barcode
  and asset tag fields, with `--` when empty
- **Thermal Label Printing** — Avery 5160 sheets (8.5×11″, 3×10) and roll
  formats for Dymo (30252, 30256, 30334, 30336), Rollo (4×6″, 2×1″), Zebra
  (2×1″, 3×1″, 4×2″, 4×6″), a 1×1″ thermal square and a custom size, with
  Code128 or QR codes (see [Labels](Module-Inventory-Developer#labels))
- **Label print tracking** — every item records when its label was confirmed
  printed; the items list filters on **Needs a Label** / **Label Printed**
- **NFC tags** — items, shelves and checklist compartments can carry NFC tags
  for lookup, put-away, shelf audits and a self-service kiosk (see
  [NFC Tags](Module-Inventory-Developer#nfc-tags))

### Catalog, variants and the items list

- **CSV Import** — bulk import via CSV upload with a downloadable template,
  header validation and duplicate-serial detection. The parser is RFC 4180
  (`"Gauze Pads, 4x4 Sterile"` is one field), so the preview and the import
  agree. Negative quantities and purchase prices are refused per row. An
  import whose `Vendor` cell names an unknown supplier still imports the row
  and lists the name for attaching afterwards (see [Vendors](Module-Inventory-Developer#vendors))
  The downloadable sample includes common medical supplies (no medications);
  its `Category` cells are names matched against categories you have already
  created, and a row that matches none imports uncategorized, which reads as gear
  (see [Importing supplies from a CSV](Module-Medical-Supplies#importing-supplies-from-a-csv))
- **CSV Export** — export of the filtered list to CSV (see
  [Item Management](Module-Inventory-Developer#item-management))
- **Variant Groups, sizes and styles** — see
  [Variants, Sizes & Styles](#variants-sizes--styles)
- **Pinned working set** — a member can pin items, which hoist to a
  **Pinned** section above the list (see
  [The items list](#the-items-list))
- **Group by any attribute** — the items list regroups by category, item
  type, colour, size, condition, style, location or vendor
- **Location Filter** — cascading Facility → Room → Storage Area filter, plus
  per-location summary cards
- **Item Detail Page** — `/inventory/items/:id`, two-column layout: barcode
  sidebar plus tabs for **History** (`inventory.manage` only), **Stock Lots**,
  **NFPA Compliance** and **Exposures** (NFPA-tracked items) and
  **Inspections** (items with maintenance requirements). The storage area is
  shown by name
- **Mobile Card Views & FAB** — responsive card layouts on mobile, and a
  floating action button offering **Add Item** and **Distribute Items** to
  quartermasters
- **Sort & Filter on Member Equipment** — sort by name, total items, overdue
  first or most assigned
- **Taxonomy Soft-Delete** — `DELETE` on categories (blocked while active
  items reference them), variant groups and kits sets `active = False` and
  audit-logs rather than hard-deleting

### Planning, compliance and suppliers

- **Inventory Impact Planner** — scoping tool for a prospective new issue
  (see [Impact Planner](#impact-planner))
- **Reorder Requests** — workflow (pending → approved → ordered → partially
  received → received, or cancelled) with vendor/PO tracking, stock receipts
  (`reorder_receipts`) and audit logging
- **Vendor Tracking & Cleanup** — suppliers as rows with contacts, merge and
  attach tools (see [Vendors](Module-Inventory-Developer#vendors))
- **NFPA 1851/1852 Compliance** — per-item compliance records, exposure
  logging, a compliance dashboard and 10-year retirement tracking.
  Maintenance records can persist structured NFPA Ch. 6–8 inspection results
  (assessment booleans, contamination level, SCBA fields, recommendation) to
  `nfpa_inspection_details` when supplied

---

## The Items List

`/inventory` (also `/inventory/admin/items`):

- **Filters.** Search plus nine dropdowns: category, status, condition, item
  type, location, size, colour, style and label status. Below 640px the
  dropdowns sit behind a **Filters** toggle that reports how many are active;
  search stays visible.
- **Location panel.** Summary cards per location
  (`GET /inventory/summary/by-location`) use the same medical-stock carve-out
  as the list, so a location holding only medical stock gets no card. The
  **Unassigned** card filters to items with no location
  (`unassigned_location=true` on `GET /items`); a second click clears it. The
  header count reads `non_medical_items`, which counts rows, matching the
  list.
- **Pinned working set.** Pins are **per member, not per department**
  (`inventory_item_pins`, unique on `(user_id, item_id)`, which also keeps the
  outer join at most 1:1 so hoisting cannot inflate the list's total).
  Reorder by dragging, or with up/down arrows on a phone. **Capped at 25
  items**, enforced server-side with a message naming the cap.
- **Group by.** Category, item type, colour, size, condition, style,
  location or vendor (`InventoryService.GROUPABLE`), each group in its own
  `<tbody>`. The grouped attribute drops out of the rows, and the **Size**
  column is shown in its place. Grouping is keyed server-side.
- **Size variants fold into one row.** A product's sizes collapse into a
  single expandable row.
- **Label selection.** **Select all N matching** selects a whole filtered set
  of up to 500 items (the cap shared with bulk status changes and
  retirement). Above 500, **Print labels for all N matching** sends the
  filters (up to 5,000 items) to the print page instead.
- **Export** follows the list's filters and sort; pinning and grouping are
  not applied to the file.

---

## Variants, Sizes & Styles

- **Variant Groups** link related items that differ by size, colour or style
  (`item_variant_groups`). Each variant has its own stock, serials and
  assignments while sharing a base product description.
- **Size/style auto-generation.** Creating a uniform or PPE item offers a
  **Generate Sizes & Styles** toggle: chip-based multi-select for sizes and
  styles, a comma-separated colours input and a live item-count preview.
  `POST /inventory/items/create-variants` creates one pool item per
  combination and groups them under a new variant group. Styles on different
  axes combine onto one item; only styles on the same axis (short **and**
  long sleeve) multiply.
- **Style is four axes.** `GarmentStyle` values describe sleeve
  (`short_sleeve`, `long_sleeve`), fit (`mens`, `womens`, `unisex`), neckline
  (`v_neck`, `crew_neck`) and closure/cut (`polo`, `button_down`,
  `quarter_zip`). `inventory_items.style_attributes` holds the full list for
  one garment; `style` carries the derived primary, which filters, badges and
  the requestable catalog read.
- **A member's fit.** `member_size_preferences.garment_fit` holds the one
  axis that belongs to the person rather than the stock, and the requestable
  catalog reads it to preselect the right variant. `shirt_style` is a
  deprecated column kept only to preserve stored values.
- **Size picker.** The Edit Item dialog edits size through a picker over the
  standard-size vocabulary (garment, boot/glove and waist) with a
  **Custom...** option for a boot width or a chest measurement. One control
  writes both the structured `standard_size` and the free-text `size`.
  `one_size` and `xxxl` render as **One Size** and **3XL**.
- **Variant capsules.** `VariantCapsules` renders size (blue), colour
  (purple) and style (amber) pills on InventoryItemsPage, ItemDetailPage,
  MyEquipmentPage, PoolItemsPage and VariantGroupsPage, and renders nothing
  for an item with no variant attributes. `getDisplayName()` strips the
  ` — size [— color] [— style]` suffix for lists and cards.
- **Stock matrix.** VariantGroupsPage shows each group's on-hand quantity by
  size × colour (or style); a zero cell is highlighted red.
- **Filters.** `GET /api/v1/inventory/items` accepts `size`, `color` and
  `style`, offered as dropdowns on the items list.

---

## Gear Requests

The request form (`RequestEquipmentModal`, opened from My Issued Gear):

- **Browses.** The department's gear loads when the form opens, with the real
  category names as filters. Search matches category and product-group names
  as well as the item's own.
- **One row per product.** A shirt kept in seven sizes and two colours is one
  line, with sizes as a step after the product is chosen; serialized gear
  collapses the same way ("Portable Radio — 7 on hand").
- **The size step starts from the member's sizes on file**, matched through
  the same alias table the impact planner uses, so "Large" selects a row
  stored as "L".
- **Out-of-stock and uncatalogued gear can be requested.** Out-of-stock sizes
  stay selectable and are labelled; a free-text line covers gear that is not
  in the catalog. `equipment_requests.requested_size` carries the size as its
  own field.
- **Rank- and position-restricted gear is filtered by the server**
  (`GET /inventory/requestable-catalog`), so restricted items are never
  listed to a member who could not request them.

Review and fulfilment:

- `PUT /inventory/requests/{id}/fulfill` turns an approved request into a
  real issuance, temporary loan or assignment (routed by tracking type) and
  records `fulfilled_by` / `fulfilled_at` / `fulfillment_type` /
  `fulfillment_reference_id`. Only `approved` requests can be fulfilled; the
  call is not idempotent.
- **Fulfilment resolves the request to its variant.** The catalog sums
  availability across rows that share a product and size/colour/style, so
  `GET /inventory/requests/{id}/fulfillment-options` offers every sibling row
  of that variant, matching what the member was shown. Rows of a different
  size, colour, style, product or organization are excluded. The product and
  variant identity is one definition (`_product_key` / `_variant_key` /
  `_variant_identity` in `InventoryService`), used by both the catalog
  grouping and the fulfilment narrowing. Whether anything is on hand in the
  requested size is decided by the server. Fulfilling pool stock opens on
  issuance.
- **The requester is told the outcome.** Review and fulfil queue a background
  notice (`app/services/equipment_request_notifications.py`): an in-app bell
  entry linking to `/inventory/my-equipment`, a web push where configured,
  and an email from the editable `equipment_request_update` template carrying
  the review note. **Never SMS.** The notice sits behind the
  `equipment_request_update` notification-rule trigger, enforced and on unless
  a department switches it off; the email is the optional `inventory_updates`
  kind in `app/services/email_policy.py` ("Equipment and inventory updates",
  default on).
- **Approve & fulfill now** sends `notify_member=false` on the approval so the
  member hears once, when the item is issued.
- Both sides show one status vocabulary, `EQUIPMENT_REQUEST_STATUS_LABELS`:
  pending → **Awaiting review**, approved → **Approved**, denied →
  **Declined**, fulfilled → **Issued**. Filter values sent to the API use the
  stored values. The member's request list shows `review_notes`
  ("Quartermaster: …").

---

## Retiring an Item

The retire action (`POST /inventory/items/{id}/retire`) is the only way to
deactivate an item. It blocks while the item is assigned, checked out or (for
pool stock) carries an unreturned issuance, re-checks the current holder
immediately before deactivating, and keeps the item's other fields consistent
with being retired. A generic item edit (`PATCH /items/{id}`) refuses to
deactivate an item, directly or by setting its status and condition to
retired ("Use the item's retire action to deactivate it").

- Medical supplies have their own retire action,
  `POST /medical-supplies/items/{id}/retire` (`inventory.manage_medical` or
  `inventory.manage`).
- **Maintenance cannot be completed as Retired**: the maintenance form does
  not offer Retired as the condition after maintenance; retire the item with
  the retire action, which takes the lock, checks the blockers and writes the
  audit event.

---

## Equipment Checklists

An equipment checklist is the pass a crew makes over an apparatus — every
compartment, every position, what should be aboard and what actually is. It
belongs to Inventory because a checklist is a list of **inventory items**: a
checklist position carries an `inventory_item_id` into the catalog, the lots
aboard a truck are snapshots of `inventory_lots` rows, and the supply
worklist is a stock-room job.

**Inventory owns the whole feature** — authoring a checklist, performing it,
and reporting on it. Scheduling contributes the shift's own business: a
"Start checklist" link on shift check-in and on the shift detail panel (both
open `/inventory/checklists/my?shift=<id>`), the finalize gate on outstanding
end-of-shift checks, and the picker that lets a shift template name the
checklists its shifts carry.

Members reach their own checklists from the **My Checklists** nav row, which
is ungated — walking a truck is the one thing every member does, and the API
narrows `/my-checklists` to the caller. **Fleet Readiness** sits beside it for
officers.

| Page                                             | URL                                          | Permission                                                              |
| ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| My checklists (the checks you owe)               | `/inventory/checklists/my`                   | none — every member                                                     |
| Fleet readiness board                            | `/inventory/checklists`                      | `inventory.check_view` or `scheduling.manage`                           |
| Check log (expected vs. actual)                  | `/inventory/checklists/log`                  | `inventory.check_submit`, `inventory.check_view` or `scheduling.manage` |
| One apparatus's checks                           | `/inventory/checklists/apparatus/{id}`       | `inventory.check_view` or `scheduling.manage`                           |
| Apparatus inventory (standing view of one truck) | `/inventory/checklists/apparatus-inventory`  | `inventory.check_submit`, `inventory.check_view` or `inventory.view`    |
| Checklists admin (the list itself)               | `/inventory/admin/checklists`                | `inventory.check_manage`                                                |
| Checklist builder (new)                          | `/inventory/admin/checklists/templates/new`  | `inventory.check_manage`                                                |
| Checklist builder                                | `/inventory/admin/checklists/templates/{id}` | `inventory.check_manage`                                                |
| Check reports                                    | `/inventory/admin/checklists/reports`        | `inventory.check_view`                                                  |
| Expiring on apparatus                            | `/inventory/admin/checklists/supply`         | `inventory.check_view` or `inventory.manage`                            |
| Checklist settings                               | `/inventory/admin/checklists/settings`       | `settings.manage` or `organization.update_settings`                     |

The API lives under `/api/v1/equipment-checks` and is gated on the
**Inventory** module.

### Which checklists a shift carries

Two routes, and the first one wins outright.

**A shift template can name them.** `shift_template_equipment_checks` links a
shift template to the checklists its shifts carry, in the order an officer
arranged them. Edited on the shift template itself, under the vehicle picker.

**Otherwise, the apparatus decides**: checklists assigned to that specific
apparatus, and failing that, ones written for its apparatus type.

Naming checklists **replaces** apparatus resolution rather than adding to it —
the officer said what this shift carries, and the apparatus-type default is
not a second opinion to be merged in. Naming none falls back to apparatus
resolution, so clearing every checklist on a template is a real instruction:
it restores apparatus resolution.

One case is easy to get backwards: a template whose links all point at
**deactivated** checklists resolves to **nothing**, not to the apparatus
default. The fallback is decided by whether the template named any
checklists, not by whether the lookup returned rows — falling back there
would report a crew as missing a check nobody asked them for.

Resolution happens in three places and they must agree, or a reminder names
one set of checklists and the crew is shown another:
`EquipmentCheckService._resolve_templates` (what the crew is offered),
`scheduled_tasks.resolve_check_templates` (what the reminders name) and
`EquipmentReadinessService` (what the fleet board scores against).

**`shifts.template_id`** records which shift template a shift came from, which
is what makes template naming resolvable. A shift with no `template_id`
resolves by apparatus.

### Authoring and performing a check

- **Builder apparatus.** A checklist can be pinned to an apparatus from the
  Apparatus module only; the server rejects an apparatus id outside the
  caller's organization ("Invalid apparatus"). A department running on basic
  apparatus assigns checklists by apparatus type. The vehicle-type list
  follows the backend's `DefaultApparatusType` plus custom types and saved
  values, and the builder names which vehicles a checklist reaches and warns
  when it reaches none.
- **Editing a live checklist unpublishes it**; the builder shows a banner
  with **Publish now** and asks before leaving.
- **Failure notes.** A **Fail** or **Out of service** the member chose
  requires a note before submit (one a count, reading or expiry already
  explains is exempt). Overall Notes is not pinned with Submit.
- **Submitted state.** My Checklists and Fleet Readiness share one
  `isChecklistSubmitted` rule; a filed check does not offer **Open
  checklist**, and a check that took an item out of service counts as
  expected and completed.
- **Navigation.** The checklists admin page links to **Fleet readiness** and
  **Check log**; a member's log links back to My Checklists.
- **Missed checks.** My Checklists also lists a shift from the last seven
  days while one of its checks is unfiled (`MY_CHECKLISTS_OVERDUE_DAYS`), so
  the check can still be filed; older misses leave the member's list but stay
  on the fleet board and in the report. A check is **overdue** once its shift
  has ended unfiled (`isOverdue` on `/my-checklists`, falling back to the
  shift's date when it has no end time), so an overnight shift is not flagged
  at midnight. My Checklists and the fleet board both show that flag.
- **Early checks.** My Checklists offers shifts from today onward. The fleet
  board and check log also read a shift up to seven days ahead when a check
  has already been filed against it, so its findings count on the board at
  once.
- **Failure log.** `get_failure_log` counts its own rows within the caller's
  organization.
- **Reports** attribute a check to the shift's apparatus
  (`shifts.apparatus_id`), falling back to the check's own column only for a
  standalone check.

### Matching checklist items to the catalog

A checklist is typed by hand, so the name on the rig and the name in the
catalog rarely agree — "4 x 4 gauze" against "Gauze Pads, 4x4 Sterile", or "BVM"
against "Bag Valve Mask". Both ways of linking a position to an inventory item
are tolerant of that:

- **The picker** (searching the catalog from a checklist row) asks for fuzzy
  results: the exact substring matches come first, as they always did, and
  near-name matches follow. Plurals, a dimension spaced differently and a
  near-spelling all count; only the **name** (and "Also called" names) is
  compared, not the manufacturer or description.
- **The review screens** (**Link to inventory** in the builder, and the
  catalog-links report) propose a catalog item per position with a confidence.
  Only an identical-words match is pre-selected; anything fuzzier is offered for
  a person to confirm.
- **Also called.** An item carries up to 10 alternate names ("BVM", "Ambu bag"),
  entered as a comma-separated list on the item form for gear and for medical
  supplies. Both of the above look through them, and a suggestion made through
  one says so. An alias match is never pre-selected, because two items can share
  an alias and a person typed it.
- **What stays apart.** A word containing a number or size must match exactly
  ("4x4" never matches "4x8", "Size 3" never "Size 4"), and "Adult" does not
  match "Pediatric".

Fuzzy search is opt-in per request (`fuzzy=true` on `GET /inventory/items` and
`GET /medical-supplies/items`), runs inside the same organization and
medical/gear bounds as the exact search, and is only a first-page feature:
results beyond the exact ones are ordered by match quality.

### Checklist settings

`/inventory/admin/checklists/settings` edits four values stored in
`org.settings["shift_reports"]["checklist_timing"]` and written through
`PATCH /organizations/settings` — which is why the page is gated on
`settings.manage` or `organization.update_settings`, not `check_manage`:

| Setting                      | Default | Range |
| ---------------------------- | ------- | ----- |
| `start_of_shift_enabled`     | true    | —     |
| `end_of_shift_enabled`       | true    | —     |
| `checkin_opens_hours_before` | 2       | 0–24  |
| `checkin_closes_hours_after` | 12      | 0–72  |

Absence means the defaults, never "off".

### Permissions

| Permission               | Grants                                                |
| ------------------------ | ----------------------------------------------------- |
| `inventory.check_view`   | Read templates, results, reports and the fleet board  |
| `inventory.check_manage` | Create and edit checklists                            |
| `inventory.check_submit` | Perform a check (held by the default member position) |

**The Quartermaster holds `inventory.check_manage`**
(`DEFAULT_POSITIONS["quartermaster"]`), so the position that manages a
checklist's stock also authors it. Authoring only: `check_view` is not
included, and the checklist screens hide the report links from a holder of
`check_manage` alone.

`app.core.permissions.LEGACY_PERMISSION_ALIASES` maps the older
`equipment_check.view` / `.manage` / `.submit` names onto these for any stored
row that still carries them. Being in the inventory namespace, all three are
granted by the `inventory.*` module wildcard, as `view_medical` /
`manage_medical` are.

---

## Impact Planner

`/inventory/admin/impact-planner` (`inventory.manage`) scopes a prospective
new issue end to end and acts on the result. Saved plans live in
`inventory_impact_plans`.

### Core workflow

1. **Filter the roster** — status, membership type, rank, station and
   corporate position.
2. **Choose the item category and size field** — e.g. "Job Shirts" +
   "Shirt Size".
3. **Analyze** — who needs the item, the size each needs (from
   `member_size_preferences`), whether they already hold a comparable item
   (an active assignment or pool issuance in the chosen category), and gated
   contact details.
4. **Act** — reorder, bulk-issue, request sizes, export, save.

### Capabilities

| Capability                      | Description                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stock-aware shortfall**       | Per-size demand netted against available on-hand stock (pool `quantity − quantity_issued` and available individual units). Sizes match by a normalized key (drops boot-width/parenthetical notes; canonicalizes aliases like `3XL`↔`XXXL`) |
| **Cost estimation**             | Per-size and total purchase cost from the stock category's item prices (`replacement_cost`, then `purchase_price`; category-average fallback)                                                                                              |
| **One-click reorder**           | One pending, pre-priced `ReorderRequest` per size with a shortfall                                                                                                                                                                         |
| **Replacement-aware targeting** | Members whose only held items are worn (poor/damaged/out of service) or past NFPA retirement count as needing a replacement                                                                                                                |
| **Bulk-issue**                  | Issues matching on-hand pool stock through `issue_from_pool`; skips are reported with reasons; respects allowances; publishes a WebSocket event                                                                                            |
| **Allowance-aware warnings**    | Flags members at or over their per-category `issuance_allowances` cap (a role-specific allowance beats an org-wide one); bulk-issue skips them                                                                                             |
| **Request sizes**               | In-app notification to members with no size on file, linking to self-service preferences                                                                                                                                                   |
| **PDF / CSV**                   | Print-ready PDF summary (ReportLab; organization name, filter parameters, member names and contact strings are XML-escaped) and client-side CSV export                                                                                     |
| **Saved plans**                 | Named filter sets for reuse (annual refresh, seasonal cycles)                                                                                                                                                                              |

Member contact details follow the org's `contact_info_visibility` settings
(enabled + per-field), matching the member list.

### Saved plan columns

| Column                     | Type                | Description                  |
| -------------------------- | ------------------- | ---------------------------- |
| `id`                       | UUID                | Primary key                  |
| `organization_id`          | UUID (FK)           | Organization scope           |
| `name`                     | String(255)         | Human-readable scenario name |
| `description`              | Text                | Optional narrative           |
| `filters`                  | JSON                | Persisted filter set         |
| `created_by`               | UUID (FK, nullable) | Who created the plan         |
| `created_at`, `updated_at` | DateTime(tz)        | Timestamps                   |

### Edge cases

| Scenario                             | Behavior                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| Member with no size preference       | Bucketed as "Unknown"; skipped by bulk-issue and reorder       |
| Stock exhausted during bulk-issue    | Issues what's available; remaining members skipped with reason |
| All shortfalls are zero              | Reorder generates nothing; returns `created_count: 0`          |
| Contact visibility set to "hidden"   | Email/phone columns omitted from PDF                           |
| Allowance exceeded for a member      | Bulk-issue skips with "Allowance exceeded" reason              |
| Plan filters reference deleted rank  | Deleted values silently ignored; remaining filters applied     |
| Replacement-aware with NFPA tracking | Uses NFPA retirement dates for serviceability                  |
| Multiple items at different costs    | Average unit cost used for estimation                          |

---

## Network Label Printers

Barcode labels print **straight to the printer**, with no browser print
dialog. A department registers each physical printer once — name, location,
host, port, resolution, loaded label stock, darkness, and the command language
it speaks — instead of typing the host at every print.

### Two command languages

| Language | Printers                                                                    | Note                                  |
| -------- | --------------------------------------------------------------------------- | ------------------------------------- |
| `zpl`    | Zebra, and the many printers with ZPL emulation                             | The default for the `language` column |
| `escpos` | Receipt-class thermal printers, several of which take linerless label media | —                                     |

**The choice changes more than the bytes**: the renderer, the stock sizes
offered, and the status query all branch on it. A ZPL-emulating printer
should be registered as ZPL.

### The server opens the socket

This is the single most useful thing to know when a print fails. The backend
connects to the printer's host and port itself, so **reachability is the
backend container's, not the operator's browser's**. A printer an operator
can ping from their laptop may be unreachable from the server. Registration
succeeds regardless — nothing validates the address at save time — and the
failure surfaces at print or status time.

### Status

`GET /label-printers/{id}/status` asks the printer to identify itself and
report its current faults. **It is not tied to a print job and is not proof
that anything printed** — on firmware that does not answer, all a successful
send confirms is that the bytes were accepted. Treat a successful print as
"sent", not as "printed", and check the tray. Status is **best-effort and per
printer**: one printer failing to answer does not suppress the answers from
the others.

Other printer endpoints: `GET/POST /label-printers`,
`PUT/DELETE /label-printers/{id}`, `POST /label-printers/{id}/test` and
`POST /label-printers/probe`.

### What else prints

Beyond inventory labels, `POST /station-documents/print` renders the **shift
roster** and the **equipment check sheet** to the watch-desk printer. The
check sheet is gated on the same permission as the check itself, and a
pass-down stays with its own crew. A label can also carry a QR code.

Reference:
[`docs/LABEL_PRINTING_MODULE.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/LABEL_PRINTING_MODULE.md).

---

## Who Can See a Member's Gear

A member profile is a directory card. Which turnout coat, radio or SCBA mask
somebody signed for, and its condition, is quartermaster business.

- The profile's **Assigned Inventory** section and its Quick Stats line
  require **`inventory.manage`**, or that the profile is the viewer's own. A
  viewer without the permission issues no request, and items are cleared when
  navigating to a profile whose gear is not visible.
- The per-member endpoints (`/users/{id}/assignments`, `/issuances`,
  `/issuance-history`, `/inventory`, `/clearance`, and the allowance and
  size-preference reads) answer for the caller's own record or for an
  `inventory.manage` holder.
- **`inventory.view` is not a gate for this.** It is part of the baseline
  Member position — every member holds it so they can browse the request
  catalog and their own kit. A test asserts the baseline Member position
  holds `inventory.view` but not `inventory.manage`, so the fact the guard
  rests on cannot drift unnoticed.
- `GET /dashboard/asset-widgets` includes its inventory section (item counts,
  low-stock lines, overdue-loan totals) only for `inventory.manage` holders.

---

## Scheduled Tasks

| Task                         | Frequency                 | Does                                                                                                                                                                      |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_low_stock_alerts` | daily                     | Emails low-stock and reorder-point alerts                                                                                                                                 |
| `inventory_overdue_alerts`   | daily                     | Reports overdue temporary loans                                                                                                                                           |
| `inventory_audit_digest`     | daily check, weekly send  | Emails overdue shelf audits (see [NFC Tags](Module-Inventory-Developer#nfc-tags))                                                                                         |
| `property_return_reminders`  | daily (cron `45 7 * * *`) | Emails dropped members still holding property a 30-day and then a 90-day reminder, copying the notify roles; one reminder per member per run, the latest threshold passed |

All four run in the in-process scheduler (86400 s) per organization through
`_for_each_org`; the cron expressions serve an external scheduler. Property
return reminders can also be run on demand with
`POST /users/property-return-reminders/process`.

---

## Cross-Module Connections

- **Scheduling** — shift check-in and the shift detail panel link to My
  Checklists; shift templates name the checklists their shifts carry;
  outstanding end-of-shift checks gate finalizing a shift.
- **Apparatus** — checklists are pinned to Apparatus-module units or to an
  apparatus type; see [Apparatus Module](Module-Apparatus).
- **Medical Supplies** — EMS stock shares the catalog
  (`item_type = medical`) but has its own screens, permission
  (`inventory.view_medical` / `inventory.manage_medical`) and retire action;
  the inventory list, location cards and header count exclude it.
- **Department Store** — the store console lives at `/inventory/admin/store`
  under its own module and gate.
- **Member ID cards** — badge codes resolve through `/member-badges/resolve`;
  NFC ID cards resolve through the NFC member lookup.
- **Notifications** — email is the channel of record. Low-stock, reorder,
  overdue and audit-digest notices are email-only; equipment-request outcomes
  add a bell entry and web push; no inventory notice is sent by SMS.
- **Dashboard** — the asset widgets read `GET /inventory/summary` and the
  low-stock list for `inventory.manage` holders; the member gear widget
  matches My Issued Gear.

---

## Known Limitations

Open items, each tracked in
[KNOWN_LIMITATIONS](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md):

- The setup guide's first step adds rooms, which needs a locations grant the
  seeded Quartermaster does not hold; the wizard hides **Add room** without
  `locations.create` / `locations.manage` and says who can add one.
- Receiving gear back directly does not close the member's open return
  notice.
- A variant group created on the Variant Groups page cannot be filled from
  any screen.
- A reorder request made in the app cannot be received until an inventory
  item is linked to it.
- A write-off raised for one returned unit of pool stock retires the whole
  item.
- The check log and fleet board count a checklist as missed on days before it
  existed.
- A department on basic apparatus cannot pin a checklist to one unit.
- The generic scan lookup does not resolve storage-area `SA-` codes (INV-8).

---

**See also:** [Apparatus Module](Module-Apparatus) |
[Training Module](Module-Training) |
[Inventory NFC Tags](Inventory-NFC-Tags)
