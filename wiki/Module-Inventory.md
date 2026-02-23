# Inventory Module

The Inventory module tracks department equipment, member assignments, pool/quantity items, batch operations, departure clearance, and thermal label printing.

---

## Key Features

- **Individual & Pool Items** — Track individual items (assigned to one person) and pool/quantity items (shared stock)
- **Item Issuances** — Full lifecycle for pool item issue/return with user, quantity, reason, and condition tracking
- **Batch Operations** — `batch_checkout` and `batch_return` for multiple items in a single request
- **Departure Clearance** — Full lifecycle (initiate → resolve line items → complete) for tracking property return when members depart
- **Notification Netting** — Offsetting actions (assign→unassign) automatically cancel pending notifications
- **Barcode & QR Scanning** — Camera-based scanning for check-in/check-out operations
- **Thermal Label Printing** — Dymo (2.25×1.25″) and Rollo (4×6″) label generation with Code128 barcodes
- **Category Management** — Organize items by category with CRUD operations
- **Org-Scoped Uniqueness** — Barcodes and asset tags are unique per organization (not globally)
- **Row-Level Locking** — `SELECT FOR UPDATE` on all mutation operations to prevent race conditions
- **Overdue Tracking** — Computed at read time; scheduled task for reporting

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/inventory` | Inventory Browse | Authenticated |
| `/inventory/admin` | Inventory Admin Hub | `inventory.manage` |

### Admin Tabs

| Tab | Description |
|-----|-------------|
| Manage Inventory | Full item/category CRUD |
| Members | Per-member inventory assignments with barcode check-out/return |

---

## API Endpoints

```
GET    /api/v1/inventory/items               # List items
POST   /api/v1/inventory/items               # Create item
GET    /api/v1/inventory/items/{id}          # Get item details
PATCH  /api/v1/inventory/items/{id}          # Update item
POST   /api/v1/inventory/items/{id}/assign   # Assign to member
POST   /api/v1/inventory/items/{id}/unassign # Unassign from member
POST   /api/v1/inventory/items/{id}/checkout # Check out item
POST   /api/v1/inventory/items/{id}/checkin  # Check in item
POST   /api/v1/inventory/items/{id}/issue-from-pool  # Issue pool item
POST   /api/v1/inventory/items/{id}/return-to-pool   # Return pool item
POST   /api/v1/inventory/batch-checkout      # Batch checkout
POST   /api/v1/inventory/batch-return        # Batch return
GET    /api/v1/inventory/lookup              # Lookup by barcode/serial/asset tag
GET    /api/v1/inventory/categories          # List categories
POST   /api/v1/inventory/categories          # Create category
PATCH  /api/v1/inventory/categories/{id}     # Update category
POST   /api/v1/inventory/labels/generate     # Generate thermal labels
POST   /api/v1/inventory/clearance/initiate  # Initiate departure clearance
POST   /api/v1/inventory/clearance/{id}/resolve-line-item  # Resolve line item
POST   /api/v1/inventory/clearance/{id}/complete  # Complete clearance
```

---

**See also:** [Apparatus Module](Module-Apparatus) | [Training Module](Module-Training)
