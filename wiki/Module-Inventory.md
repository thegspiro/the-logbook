# Inventory Module

The Inventory module tracks department equipment, member assignments, pool/quantity items, batch operations, departure clearance, write-off approval, and thermal label printing.

---

## Key Features

- **Individual & Pool Items** — Track individual items (assigned to one person) and pool/quantity items (shared stock)
- **Item Issuances** — Full lifecycle for pool item issue/return with user, quantity, reason, and condition tracking
- **Batch Operations** — `batch_checkout` and `batch_return` for multiple items in a single request
- **Live Search** — Real-time item lookup by name, barcode, serial number, or asset tag during scan operations
- **Departure Clearance** — Full lifecycle (initiate → resolve line items → complete) for tracking property return when members depart
- **Write-Off Approval** — Supervisor-reviewed workflow for lost, stolen, damaged, or obsolete items before they are removed from inventory
- **Notification Netting** — Offsetting actions (assign→unassign) automatically cancel pending notifications
- **Barcode & QR Scanning** — Camera-based scanning for check-in/check-out operations via BarcodeDetector API
- **Thermal Label Printing** — Dymo (2.25×1.25″), Rollo (4×6″), and sheet (8.5×11″) label generation with Code128 barcodes
- **Category Management** — Organize items by category with low-stock thresholds and maintenance requirements
- **Equipment Requests** — Members can request checkouts, issuances, or purchases; admins approve/deny
- **Org-Scoped Uniqueness** — Serial numbers, barcodes, and asset tags are unique per organization
- **Row-Level Locking** — `SELECT FOR UPDATE` on mutation operations to prevent race conditions
- **Overdue Tracking** — Computed at read time; scheduled task for reporting
- **CSV Export** — Export filtered inventory data to CSV
- **Sort & Filter** — Members tab supports sort by name, total items, overdue, or most assigned
- **Mobile Member ID Scanning** — Camera-based member ID scanning for quick member lookup during checkout (scan QR/barcode from member ID card)
- **Charges & Cost Recovery** — *(2026-03-05)* Attach damage fees or replacement costs to return/write-off events. Pool items support per-unit replacement cost tracking with automatic cost recovery calculation
- **Return Requests** — *(2026-03-05)* Members can submit return requests that require admin approval before processing
- **Stock Alerts & Quarantine** — *(2026-03-05)* Configurable low-stock email alerts. Quarantine status for items pending inspection before re-issue
- **Pool Item Enhancements** — *(2026-03-05)* Size variants (S/M/L/XL with per-size stock), bulk issuance to multiple members, per-member issuance allowances with override capability
- **Mobile Card Views & FAB** — *(2026-03-05)* Responsive card layouts on mobile with floating action button for quick actions (add item, scan barcode, import CSV)
- **CSV Import** — *(2026-03-02)* Bulk import items via CSV upload with downloadable template, header validation, duplicate serial detection
- **Variant Groups** — *(2026-03-07)* Link related items that differ by size/style (e.g., coat in S/M/L/XL). Each variant tracks its own stock while sharing a base product description
- **Equipment Kits** — *(2026-03-07)* Named bundles of items (e.g., "New Recruit PPE Kit") for single-operation issuance with per-component tracking
- **Member Size Preferences** — *(2026-03-07)* Members record preferred sizes (coat, pants, gloves, boots, helmet) for auto-selection during kit issuance and ordering
- **Reorder Requests** — *(2026-03-07)* Full workflow (pending → approved → ordered → received) with vendor/PO tracking and audit logging
- **Item Reorder Points** — *(2026-03-07)* Per-item threshold for low-stock alerts. Triggers email and SMS (Twilio) notifications
- **Low Stock SMS Alerts** — *(2026-03-07)* Twilio SMS notifications for low-stock items alongside existing email alerts
- **Location Filter Dashboard** — *(2026-03-07)* Cascading Facility → Room → Storage Area filter on inventory dashboard
- **Item Detail Page** — *(2026-03-06)* Dedicated detail page (`/inventory/items/:id`) with two-column layout: barcode sidebar + tabbed content (overview, history, maintenance, NFPA)
- **Cost Data** — *(2026-03-06)* Purchase cost, replacement cost, and cost recovery tracking in item views and admin dashboard
- **Size/Style Auto-Generation** — *(2026-03-14)* When creating a new uniform or PPE item, toggle "Generate Sizes & Styles" to select multiple standard sizes and garment styles. Backend creates one pool item per `size × color × style` combination, sets `standard_size` and `style` enum fields, and groups under a new `ItemVariantGroup`. Frontend includes chip-based multi-select for sizes and styles, comma-separated colors input, and live item count preview

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/inventory` | Inventory Items List | Authenticated |
| `/inventory/my-equipment` | My Equipment | Authenticated |
| `/inventory/items/:id` | Item Detail | Authenticated |
| `/inventory/storage-areas` | Storage Areas | Authenticated |
| `/inventory/admin` | Admin Dashboard | `inventory.manage` |
| `/inventory/admin/items` | Manage Items | `inventory.manage` |
| `/inventory/admin/pool` | Pool Items | `inventory.manage` |
| `/inventory/admin/categories` | Categories | `inventory.manage` |
| `/inventory/admin/maintenance` | Maintenance Records | `inventory.manage` |
| `/inventory/admin/members` | Members Inventory | `inventory.manage` |
| `/inventory/admin/charges` | Charges & Fees | `inventory.manage` |
| `/inventory/admin/returns` | Return Requests | `inventory.manage` |
| `/inventory/admin/requests` | Equipment Requests | `inventory.manage` |
| `/inventory/admin/write-offs` | Write-Off Requests | `inventory.manage` |
| `/inventory/admin/reorder` | Reorder Requests | `inventory.manage` |
| `/inventory/checkouts` | Active Checkouts | `inventory.manage` |
| `/inventory/import` | CSV Import | `inventory.manage` |
| `/inventory/print-labels` | Barcode Label Printing | Authenticated |

---

## Data Model

### Core Tables

| Table | Purpose |
|-------|---------|
| `inventory_categories` | Item categories with type, requirements, low-stock thresholds |
| `inventory_items` | Items with serial/barcode/asset tag, condition, status, tracking type |
| `item_assignments` | Permanent/temporary assignments of individual items to members |
| `item_issuances` | Pool item issuance records (quantity tracking) |
| `checkout_records` | Temporary checkout records with expected return dates |
| `maintenance_records` | Maintenance history (inspection, repair, calibration, etc.) |

### Workflow Tables

| Table | Purpose |
|-------|---------|
| `departure_clearances` | Member departure property return pipeline |
| `departure_clearance_items` | Per-item resolution within a clearance |
| `equipment_requests` | Member equipment request/approval workflow |
| `inventory_write_offs` | Write-off request/approval workflow for lost/damaged items |
| `inventory_notification_queue` | Delayed notification consolidation queue |
| `property_return_reminders` | Tracks reminder notices sent to departed members |

### Variant & Kit Tables *(2026-03-07)*

| Table | Purpose |
|-------|---------|
| `variant_groups` | Groups related items that differ by size/style |
| `equipment_kits` | Named bundles of items for single-operation issuance |
| `equipment_kit_items` | Component items within a kit with per-component quantity |
| `member_size_preferences` | Member garment size preferences (coat, pants, gloves, boots, helmet) |
| `reorder_requests` | Reorder request workflow with status lifecycle |

### Key Enums

| Enum | Values |
|------|--------|
| ItemStatus | available, assigned, checked_out, in_maintenance, lost, stolen, retired |
| ItemCondition | excellent, good, fair, poor, damaged, out_of_service, retired |
| TrackingType | individual, pool |
| MaintenanceType | inspection, repair, cleaning, testing, calibration, replacement, preventive |
| ClearanceLineDisposition | pending, returned, returned_damaged, written_off, waived |
| WriteOffStatus | pending, approved, denied |
| StandardSize | xs, s, m, l, xl, 2xl, 3xl, 4xl, 5xl |
| GarmentStyle | regular, long, short, tall |
| ReorderRequestStatus | pending, approved, ordered, received |

---

## API Endpoints

### Category Management

```
GET    /api/v1/inventory/categories                      # List categories
POST   /api/v1/inventory/categories                      # Create category
GET    /api/v1/inventory/categories/{id}                 # Get category
PATCH  /api/v1/inventory/categories/{id}                 # Update category
```

### Item Management

```
GET    /api/v1/inventory/items                           # List items (with filters)
POST   /api/v1/inventory/items                           # Create item
GET    /api/v1/inventory/items/{id}                      # Get item details
PATCH  /api/v1/inventory/items/{id}                      # Update item
POST   /api/v1/inventory/items/{id}/retire               # Retire item
GET    /api/v1/inventory/items/export                    # Export items as CSV
```

### Assignments & Issuances

```
POST   /api/v1/inventory/items/{id}/assign               # Assign to member
POST   /api/v1/inventory/items/{id}/unassign              # Unassign from member
POST   /api/v1/inventory/items/{id}/issue                 # Issue from pool
POST   /api/v1/inventory/issuances/{id}/return            # Return to pool
GET    /api/v1/inventory/items/{id}/issuances             # Item's issuance records
GET    /api/v1/inventory/users/{id}/assignments           # User's assignments
GET    /api/v1/inventory/users/{id}/issuances             # User's issuances
```

### Checkout / Check-in

```
POST   /api/v1/inventory/checkout                        # Check out item
POST   /api/v1/inventory/checkout/{id}/checkin            # Check in item
PATCH  /api/v1/inventory/checkout/{id}/extend             # Extend return date
GET    /api/v1/inventory/checkout/active                  # Active checkouts
GET    /api/v1/inventory/checkout/overdue                 # Overdue checkouts
```

### Batch & Scan Operations

```
GET    /api/v1/inventory/lookup                          # Search by code/name
POST   /api/v1/inventory/batch-checkout                  # Batch checkout
POST   /api/v1/inventory/batch-return                    # Batch return
```

### Label Generation

```
GET    /api/v1/inventory/labels/formats                  # Available formats
POST   /api/v1/inventory/labels/generate                 # Generate PDF labels
```

### Maintenance

```
POST   /api/v1/inventory/maintenance                     # Create record
PATCH  /api/v1/inventory/items/{id}/maintenance/{rid}    # Update record
GET    /api/v1/inventory/items/{id}/maintenance           # Item history
GET    /api/v1/inventory/maintenance/due                  # Items due
```

### Reporting & Analytics

```
GET    /api/v1/inventory/summary                         # Dashboard stats
GET    /api/v1/inventory/low-stock                       # Low-stock alerts
GET    /api/v1/inventory/members-summary                 # Per-member summary
GET    /api/v1/inventory/users/{id}/inventory             # User's full inventory
```

### Departure Clearance

```
POST   /api/v1/inventory/clearances                      # Initiate clearance
GET    /api/v1/inventory/clearances                      # List clearances
GET    /api/v1/inventory/clearances/{id}                 # Get clearance details
GET    /api/v1/inventory/users/{id}/clearance             # User's clearance
POST   /api/v1/inventory/clearances/{id}/items/{iid}/resolve  # Resolve line item
POST   /api/v1/inventory/clearances/{id}/complete         # Complete clearance
```

### Equipment Requests

```
POST   /api/v1/inventory/requests                        # Create request
GET    /api/v1/inventory/requests                        # List requests
PUT    /api/v1/inventory/requests/{id}/review             # Approve/deny request
```

### Storage Areas

```
GET    /api/v1/inventory/storage-areas                   # List storage areas (tree or flat)
POST   /api/v1/inventory/storage-areas                   # Create storage area
PUT    /api/v1/inventory/storage-areas/{id}              # Update storage area
DELETE /api/v1/inventory/storage-areas/{id}              # Delete (deactivate) storage area
```

### Write-Off Requests

```
POST   /api/v1/inventory/write-offs                      # Create write-off request
GET    /api/v1/inventory/write-offs                      # List write-off requests
PUT    /api/v1/inventory/write-offs/{id}/review           # Approve/deny write-off
```

### Variant Groups & Equipment Kits *(2026-03-07)*

```
GET    /api/v1/inventory/variant-groups                    # List variant groups
POST   /api/v1/inventory/variant-groups                    # Create variant group
GET    /api/v1/inventory/variant-groups/{id}               # Get variant group
PATCH  /api/v1/inventory/variant-groups/{id}               # Update variant group

GET    /api/v1/inventory/equipment-kits                    # List equipment kits
POST   /api/v1/inventory/equipment-kits                    # Create equipment kit
GET    /api/v1/inventory/equipment-kits/{id}               # Get equipment kit
PATCH  /api/v1/inventory/equipment-kits/{id}               # Update equipment kit
POST   /api/v1/inventory/equipment-kits/{id}/issue         # Issue kit to member

GET    /api/v1/inventory/users/{id}/size-preferences       # Get member size preferences
PUT    /api/v1/inventory/users/{id}/size-preferences       # Upsert member size preferences
```

### Reorder Requests *(2026-03-07)*

```
POST   /api/v1/inventory/reorder-requests                  # Create reorder request
GET    /api/v1/inventory/reorder-requests                  # List reorder requests
PATCH  /api/v1/inventory/reorder-requests/{id}             # Update request status
GET    /api/v1/inventory/reorder-requests/{id}/history     # Request status history
```

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

---

## Real-Time Updates (WebSocket)

Inventory changes are broadcast in real time so that all connected users see updates without manual refresh.

### Architecture

```
Browser  ←  WebSocket  ←  FastAPI endpoint  ←  Redis pub/sub  ←  API mutation endpoints
```

- **Backend**: `ConnectionManager` in `app/core/websocket_manager.py` manages per-org WebSocket connections and a Redis pub/sub listener
- **Endpoint**: `WS /api/v1/inventory/ws` — authenticates via httpOnly `access_token` cookie (preferred for browsers) or `?token=<jwt>` query parameter (fallback for non-browser clients), subscribes to org-scoped events
- **Publishing**: Each mutation endpoint (create, update, assign, checkout, batch, write-off review, etc.) publishes an event after the audit log entry
- **Frontend**: `useInventoryWebSocket` hook auto-connects with exponential-backoff reconnect

### Event Format

```json
{ "type": "inventory_changed", "action": "<action>", "data": { ... } }
```

Actions: `item_created`, `item_updated`, `item_assigned`, `item_unassigned`, `item_checked_out`, `item_checked_in`, `batch_checkout`, `batch_return`, `pool_issued`, `pool_returned`, `item_retired`, `write_off_reviewed`

### Graceful Degradation

If Redis is unavailable, events are broadcast to local connections only (single-worker mode). The WebSocket connection retries with exponential backoff (1s → 30s cap).

---

## Frontend Architecture

### Shared Constants

Condition options are centralized in `frontend/src/constants/enums.ts`:
- `ITEM_CONDITION_OPTIONS` — All conditions including out_of_service (for admin forms)
- `RETURN_CONDITION_OPTIONS` — Return-safe conditions (excludes out_of_service)

### Key Components

| Component | Purpose |
|-----------|---------|
| `InventoryPage` | Main inventory management page with items/categories tabs |
| `InventoryMembersTab` | Per-member inventory view with sorting and expandable details |
| `MemberIdScannerModal` | Camera-based member ID scanning for quick member lookup |
| `InventoryScanModal` | Barcode scanning + live search for batch checkout/return |
| `ReturnItemsModal` | List-based return workflow for a member's held items |
| `useInventoryWebSocket` | Hook for real-time WebSocket updates with auto-reconnect |

### Test Coverage

Frontend tests in `src/pages/InventoryMembersTab.test.tsx` and `src/constants/enums.test.ts` cover:
- Loading, empty, and error states
- Sort by name, total items, overdue, and assigned
- Search filtering with debounce
- Condition constant consistency

---

## Recent Changes (2026-03-07)

- **Variant Groups** — Items can be grouped as variants of a base product (e.g., coat in sizes S/M/L/XL). Each variant has independent stock, serials, and assignments
- **Equipment Kits** — Named bundles for single-operation issuance with per-component tracking
- **Member Size Preferences** — Record preferred garment sizes for auto-selection during kit issuance
- **Reorder Requests** — Full lifecycle (pending → approved → ordered → received) with audit logging
- **Item Reorder Points** — Per-pool-item threshold triggers low-stock dashboard alerts, email, and SMS notifications
- **Low Stock SMS via Twilio** — SMS alerts for low-stock items when `TWILIO_ENABLED=True`
- **Location Filter Dashboard** — Cascading Facility → Room → Storage Area filter on inventory views
- **Item Detail Page** — `/inventory/items/:id` with two-column layout (barcode sidebar + tabbed content)
- **Cost Data** — Purchase cost, replacement cost, and cost recovery in item views and dashboard
- **Module Rewrite** — Individual focused pages replace monolithic admin hub: items, pool, categories, maintenance, members, charges, returns, requests, write-offs, reorder
- **Barcode Race Condition Fix** — SVG barcodes fully rendered via `requestAnimationFrame` before print
- **Storage Areas Room Filter** — Filters by `facility_room_id` to prevent station rooms leaking into pickers

## Recent Changes (2026-03-04)

- **WebSocket CSRF Fix** — The inventory WebSocket endpoint (`/api/v1/inventory/ws`) no longer fails with a 500 error. The global CSRF middleware now correctly handles WebSocket connections by using `HTTPConnection` instead of `Request` and returning early for WebSocket scope
- **StorageArea Relationship Fix** — Self-referential `parent`/`children` relationship on `StorageArea` now has proper `back_populates`, eliminating SQLAlchemy warnings at startup

---

**See also:** [Apparatus Module](Module-Apparatus) | [Training Module](Module-Training)
