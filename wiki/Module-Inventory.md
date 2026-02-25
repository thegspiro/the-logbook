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

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/inventory` | Inventory Browse | Authenticated |
| `/inventory/admin` | Inventory Admin Hub | `inventory.manage` |

### Admin Tabs

| Tab | Description |
|-----|-------------|
| Items | Full item CRUD, bulk actions, label printing, CSV export |
| Categories | Category CRUD with maintenance/assignment/serial requirements |
| Members | Per-member inventory with expandable details, barcode assign/return |

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

### Key Enums

| Enum | Values |
|------|--------|
| ItemStatus | available, assigned, checked_out, in_maintenance, lost, stolen, retired |
| ItemCondition | excellent, good, fair, poor, damaged, out_of_service, retired |
| TrackingType | individual, pool |
| MaintenanceType | inspection, repair, cleaning, testing, calibration, replacement, preventive |
| ClearanceLineDisposition | pending, returned, returned_damaged, written_off, waived |
| WriteOffStatus | pending, approved, denied |

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

**See also:** [Apparatus Module](Module-Apparatus) | [Training Module](Module-Training)
