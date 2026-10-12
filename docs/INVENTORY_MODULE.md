# Inventory Module

Quartermaster records: what gear the department owns, who holds it, what has to
come back, what needs reordering, and what was written off.

## Overview

The Inventory module is the largest in the repository — 148 HTTP routes plus a
WebSocket, ~22,000 lines of backend code, 208 frontend files. It covers the full
life of a piece of gear: catalogued, stocked, given to a member, maintained,
returned, and eventually written off or disposed of.

Three things make it harder to read than a stock list. **An item is tracked one
of two ways** — serialized (one row, one physical thing, assigned to one person)
or pooled (one row, a quantity, issued in units). **Lots are authoritative when
they exist**, so a lot-tracked item's real stock is the lot ledger rather than
its `quantity` column. And **the vocabulary is specific**: assignment, issuance,
checkout and loan are four different things that all look like "a member has
some gear".

### Related documentation

This page is the **structured reference**: data shapes, gates, invariants, edge
cases. It is not the only inventory document, and it deliberately does not
duplicate the others.

| Document                                                        | What it is for                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [wiki/Module-Inventory.md](../wiki/Module-Inventory.md)         | The fuller page: exhaustive endpoint paths, per-page walkthroughs, and the dated change narrative |
| [wiki/Inventory-NFC-Tags.md](../wiki/Inventory-NFC-Tags.md)     | NFC tagging in depth                                                                              |
| [docs/MEDICAL_SUPPLIES_MODULE.md](./MEDICAL_SUPPLIES_MODULE.md) | EMS consumables, which are a separate supply line with their own permissions                      |
| [docs/DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)                 | Generated, authoritative column-level schema                                                      |
| [docs/app-review/inventory.md](./app-review/inventory.md)       | Review findings, verified claims, and each pass's explicit scope                                  |

### Terminology

This is the module's canonical vocabulary, defined in
`frontend/src/modules/inventory/terminology.ts`. API payload values are
deliberately stable and sometimes differ from the display term.

| Term               | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| **Assignment**     | Serialized gear held on an ongoing basis                                   |
| **Temporary loan** | Serialized gear expected back by a date                                    |
| **Issuance**       | Quantity-tracked (pool) stock given to a member                            |
| **Return**         | Physically receiving assigned or issued gear                               |
| **Check-in**       | Closing a temporary loan when the gear is received                         |
| **Transfer**       | Moving serialized gear between holders                                     |
| **Distribution**   | One mixed batch that may create assignments, temporary loans and issuances |

### Key Capabilities

- **Catalog** — items with categories, vendors, storage areas, variant groups
  (size/style axes), pins, barcodes and labels
- **Two tracking models** — serialized items (assignment / loan / transfer) and
  pool items (issuance by quantity), plus a lot ledger for consumables with
  expiry
- **Member-facing self-service** — my equipment, my size preferences, equipment
  requests, return requests
- **Issuance allowances** — per-category caps ("3 polos per year") with a
  quartermaster override
- **Departure clearance** — what a leaving member must return, line by line,
  with dispositions and charges
- **Write-offs** — a request/approve workflow for lost, damaged, obsolete or
  stolen gear
- **Reordering** — reorder requests with urgency, receipts, and generation from
  a stock plan
- **NFPA gear compliance** — inspection levels, contamination, exposure records
  and a pass/repair/clean/retire recommendation
- **Equipment kits** — named bundles of items and categories, with optional lines
- **NFC** — tag enrollment, scanning (lookup, put-away, audit), shelf audits and
  digests
- **Impact planner** — model the cost and coverage impact of a purchase plan
- **Kiosk** — a standalone station view for check-out and check-in

---

## Architecture

### Frontend Module Structure

208 files. Summarized by area rather than listed:

```
frontend/src/modules/inventory/
├── index.ts · routes.tsx · terminology.ts   # barrel, routes, canonical language
├── types/        (6 files)                  # domain types
├── services/     (3 files)                  # module axios instance + API layer
├── hooks/        (2 files)
├── utils/        (20 files)
├── components/  (47 files)
└── pages/      (125 files, incl. tests and page-local models)
    ├── Catalog & admin:    InventoryItemsPage · ItemDetailPage · InventoryCategoriesPage
    │                       VendorsPage · StorageAreasPage · VariantGroupsPage
    │                       InventorySetupPage · InventoryAdminHub
    ├── Stock & movement:   PoolItemsPage · InventoryPutAwayPage · InventoryNotSeenPage
    │                       InventoryMaintenancePage · SupplyExpiringPage
    ├── Member-facing:      MyEquipmentPage · MyChecklistsPage · EquipmentRequestsPage
    │                       ReturnRequestsPage · AllowancesPage
    ├── Quartermaster flow: InventoryMembersPage · ChargesPage · WriteOffsPage
    │                       ReorderRequestsPage · EquipmentKitsPage
    ├── Equipment check:    EquipmentCheckForm · CheckSweep · CheckJumpSheet · CheckLogPage
    │                       EquipmentCheckTemplateBuilder · ChecklistsAdminPage
    ├── NFC:                InventoryNfcEnrollPage · InventoryNfcTagPage
    │                       InventoryNfcSettingsPage · InventoryShelfAuditPage
    ├── Labels:             InventoryBarcodePrintPage · StorageAreaLabelPrintPage
    └── Other:              InventoryKioskPage · ImpactPlannerPage · FleetBoardPage
```

### Backend Files

| File                                               | Role                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `app/api/v1/endpoints/inventory.py`                | 7,387 L — 148 HTTP routes + 1 WebSocket, at `/api/v1/inventory` |
| `app/services/inventory_service.py`                | 11,627 L — the bulk of the module's logic                       |
| `app/services/departure_clearance_service.py`      | Clearance lifecycle                                             |
| `app/services/inventory_nfc_service.py`            | Tag enrollment, scans, audits                                   |
| `app/services/inventory_last_seen_service.py`      | "Not seen since" tracking                                       |
| `app/services/inventory_audit_schedule_service.py` | Shelf-audit scheduling                                          |
| `app/models/inventory.py`                          | 35 tables                                                       |
| `app/schemas/inventory.py`                         | 2,909 L — **snake_case on the wire** (see below)                |

> **Response casing — note the contrast with apparatus.**
> `schemas/inventory.py` declares **no** `alias_generator`, so this module
> serializes **snake_case** (`organization_id`, `item_type`). The apparatus
> module next door uses `to_camel` and serializes camelCase. Both are valid
> per-module choices in this repository and there is no repo-wide rule; a
> frontend interface written in the wrong casing type-checks, passes lint, and
> reads every field as `undefined` at runtime. Check before writing one:
> `grep alias_generator=to_camel backend/app/schemas/<module>.py`.
> See CLAUDE.md pitfall #5.

### Enums

`models/inventory.py` declares 31 enums — the largest enum surface in the
codebase. All are lowercase-valued. Grouped by what they describe:

**The item**

| Enum             | Values                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `ItemType`       | `uniform`, `ppe`, `tool`, `equipment`, `vehicle`, `electronics`, `consumable`, `other`, `medical` |
| `ItemCondition`  | `excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`                       |
| `ItemStatus`     | `available`, `assigned`, `checked_out`, `in_maintenance`, `lost`, `stolen`, `retired`             |
| `TrackingType`   | `pool` — the serialized case is the absence of this value, not a second member                    |
| `AssignmentType` | `permanent`, `temporary`                                                                          |

**Sizing**

| Enum           | Values                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `StandardSize` | `xxs`–`xxxxl`, numeric shoe/waist sizes (`6`…`46`), `one_size`, `custom`                                               |
| `GarmentStyle` | `short_sleeve`, `long_sleeve`, `mens`, `womens`, `unisex`, `v_neck`, `crew_neck`, `polo`, `button_down`, `quarter_zip` |

**Maintenance and NFPA gear compliance**

| Enum                  | Values                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MaintenanceType`     | `inspection`, `repair`, `cleaning`, `testing`, `calibration`, `replacement`, `preventive`, `routine_inspection`, `advanced_inspection`, `independent_inspection`, `advanced_cleaning`, `decontamination` |
| `NFPAInspectionLevel` | `routine`, `advanced`, `independent`                                                                                                                                                                     |
| `ContaminationLevel`  | `none`, `light`, `moderate`, `heavy`, `gross`                                                                                                                                                            |
| `ExposureType`        | `structure_fire`, `vehicle_fire`, `wildland_fire`, `hazmat`, `bloodborne_pathogen`, `chemical`, `smoke`, `other`                                                                                         |
| `NFPARecommendation`  | `pass`, `repair`, `advanced_cleaning`, `retire`                                                                                                                                                          |

**Workflows**

| Enum                       | Values                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `RequestType`              | `checkout`, `issuance`, `purchase`, `return`                                           |
| `RequestStatus`            | `pending`, `approved`, `denied`, `fulfilled`                                           |
| `RequestPriority`          | `low`, `normal`, `high`                                                                |
| `ReturnRequestType`        | `assignment`, `issuance`, `checkout`                                                   |
| `ReturnRequestStatus`      | `requested`, `received`, `inspected`, `denied`, `completed`                            |
| `WriteOffReason`           | `lost`, `damaged_beyond_repair`, `obsolete`, `stolen`, `other`                         |
| `WriteOffStatus`           | `pending`, `approved`, `denied`                                                        |
| `ReorderStatus`            | `pending`, `approved`, `ordered`, `partially_received`, `received`, `cancelled`        |
| `ReorderUrgency`           | `low`, `normal`, `high`, `critical`                                                    |
| `ChargeStatus`             | `none`, `pending`, `charged`, `waived`                                                 |
| `DepartureType`            | `dropped_voluntary`, `dropped_involuntary`, `retired`                                  |
| `ClearanceStatus`          | `initiated`, `in_progress`, `completed`, `closed_incomplete`                           |
| `ClearanceLineDisposition` | `pending`, `returned`, `returned_damaged`, `written_off`, `waived`                     |
| `InventoryActionType`      | `assigned`, `unassigned`, `issued`, `returned`, `checked_out`, `checked_in`, `retired` |

**Storage, audits and NFC**

| Enum                      | Values                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `StorageLocationType`     | `rack`, `shelf`, `box`, `cabinet`, `drawer`, `bin`, `other` |
| `InventoryAuditFrequency` | `weekly`, `monthly`, `quarterly`, `yearly`                  |
| `InventoryNfcTagStatus`   | `active`, `lost`                                            |
| `InventoryNfcScanAction`  | `lookup`, `put_away`, `audit`                               |
| `InventoryNfcAuditResult` | `found`, `missing`, `unexpected`                            |

---

## Data Models

35 tables. Grouped by area; see
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for the generated, authoritative
column-level reference.

| Area                   | Tables                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Catalog**            | `inventory_items`, `inventory_categories`, `item_variant_groups`, `inventory_item_pins`, `storage_areas`                        |
| **Vendors**            | `inventory_vendors`, `inventory_vendor_contacts`                                                                                |
| **Stock**              | `inventory_lots`                                                                                                                |
| **Holding**            | `item_assignments`, `item_issuances`, `checkout_records`, `issuance_allowances`                                                 |
| **Maintenance / NFPA** | `maintenance_records`, `nfpa_item_compliance`, `nfpa_inspection_details`, `nfpa_exposure_records`                               |
| **Departure**          | `departure_clearances`, `departure_clearance_items`, `property_return_reminders`                                                |
| **Requests**           | `equipment_requests`, `return_requests`, `reorder_requests`, `reorder_receipts`, `inventory_write_offs`                         |
| **Kits**               | `equipment_kits`, `equipment_kit_items`                                                                                         |
| **Member data**        | `member_size_preferences`                                                                                                       |
| **Labels**             | `inventory_label_prints`                                                                                                        |
| **Planning**           | `inventory_impact_plans`                                                                                                        |
| **NFC**                | `inventory_nfc_tags`, `inventory_nfc_scans`, `inventory_nfc_audits`, `inventory_nfc_audit_items`, `inventory_nfc_audit_digests` |
| **Notifications**      | `inventory_notification_queue`                                                                                                  |

### Quantity columns, and which one is authoritative

`inventory_items` carries `quantity` (on-hand / available) and
`quantity_issued` (currently out to members). For an item with **lots**, those
columns are not the truth: `_in_date_lot_totals` is, because the lot ledger is
what receives writes and what the equipment-check swap consumes. Membership in
the lot-totals map is what marks an item as lot-stocked, so an item whose lots
have all expired reads as **zero** ready units rather than falling back to a
`quantity` column no lot bookkeeping maintains.

Every `quantity` field on a `*Create` / `*Update` schema is bounded (`ge=0` or
`ge=1`), so a client cannot send a negative; the decrement paths check
sufficiency first; and migration `7d2e4f6a8b13` clamped the historical negatives
that used to 500 the item list.

---

## API Endpoints

All paths relative to `/api/v1/inventory`. **148 HTTP routes and one WebSocket**,
counted on 2026-10-08 from `inventory.router.routes`; re-derive rather than
trust that figure if the module has moved on.

**This section deliberately does not restate the exhaustive path list.**
[wiki/Module-Inventory.md](../wiki/Module-Inventory.md#api-endpoints) already
carries one, and a second copy would be a second thing to go stale — the
failure this module's own review pass kept finding in prose counts. What
follows is the shape the wiki page does not give: every route group with its
size and the gate that gets you in. For an exact path, use the wiki page,
`endpoints/inventory.py`, or `/docs` (the live OpenAPI schema, when
`ENABLE_DOCS` is on).

| Group                                                                                                                                                                | Routes | Typical gate                      | What it covers                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | --------------------------------- | ------------------------------------------------------------------ |
| `/items…`                                                                                                                                                            |     32 | `inventory.view` / `.manage`      | Catalog CRUD, search, assign, unassign, transfer, history, pins    |
| `/vendors…`                                                                                                                                                          |     11 | `inventory.manage` (money fields) | Vendor directory and contacts; CSV import                          |
| `/impact-planner…`                                                                                                                                                   |     10 | `inventory.manage`                | Purchase-plan modelling and PDF export                             |
| `/reorder-requests…`                                                                                                                                                 |      8 | `inventory.manage`                | Reorder lifecycle and receipts                                     |
| `/kits…`                                                                                                                                                             |      6 | `inventory.manage`                | Equipment kits and their lines                                     |
| `/variant-groups…`                                                                                                                                                   |      5 | `inventory.manage`                | Size/style axes and generated variants                             |
| `/users/{user_id}/…`                                                                                                                                                 |      5 | **self or `inventory.manage`**    | One member's assignments, issuances, inventory, clearance, history |
| `/storage-areas…`                                                                                                                                                    |      5 | `inventory.view` / `.manage`      | Storage tree and labels                                            |
| `/requests…`                                                                                                                                                         |      5 | **authenticated** / `.manage`     | Equipment requests — members create and list their own             |
| `/clearances…`                                                                                                                                                       |      5 | `inventory.manage`                | Departure clearance lifecycle                                      |
| `/checkout…`                                                                                                                                                         |      5 | mixed                             | Check-out, check-in, extend (extend is self-or-manage)             |
| `/categories…`                                                                                                                                                       |      5 | `inventory.view` / `.manage`      | Category tree and requirements                                     |
| `/allowances…`                                                                                                                                                       |      5 | `inventory.manage`                | Per-category issuance caps                                         |
| `/lots…`                                                                                                                                                             |      4 | `inventory.manage`                | Lot ledger and expiry                                              |
| `/write-offs…`                                                                                                                                                       |      3 | `inventory.manage`                | Request, approve, deny                                             |
| `/return-requests…`                                                                                                                                                  |      3 | **authenticated** / `.manage`     | Members request a return; quartermaster reviews                    |
| `/setup…`, `/labels…`, `/label-setups…`, `/label-preset…`                                                                                                            |     10 | `inventory.manage`                | First-run setup; label rendering and presets                       |
| `/my/…`                                                                                                                                                              |      2 | **self (no id accepted)**         | My size preferences — read and upsert                              |
| `/members…`, `/members-summary`                                                                                                                                      |      3 | `inventory.manage`                | Quartermaster's per-member views                                   |
| `/summary`, `/low-stock`, `/charges`, `/nfpa…`, `/maintenance…`, `/issuances…`, `/transfer`, `/lookup`, `/distribute-items`, `/batch-return`, `/requestable-catalog` |     15 | mixed                             | Dashboards, lookups and batch operations                           |

### The WebSocket

`@router.websocket("/ws")` publishes `inventory_changed` events so open
inventory screens refresh without polling. It checks the organization's
`enabled_modules` itself, because the HTTP module gate does not apply to a
WebSocket handshake. Publishing is best-effort: failures are logged with the
organization and action, never raised into the request that triggered them.

---

## Permissions

| Permission         | Who is expected to hold it | What it allows                                                        |
| ------------------ | -------------------------- | --------------------------------------------------------------------- |
| `inventory.view`   | **Any member** (baseline)  | Browse the catalog and read their own gear                            |
| `inventory.manage` | Quartermasters             | Everything: catalog, stock, other members' holdings, money, workflows |

Only two permissions, which makes the self-scoping below load-bearing rather
than incidental.

### Why `inventory.view` cannot gate a per-member read

`inventory.view` is part of the baseline Member position — every member holds it
so they can browse the catalog and see their own kit. It therefore says nothing
about whether a caller may read a _colleague's_ gear. Which turnout coat, radio
or SCBA mask a named member carries, and in what condition, is quartermaster
business.

**Twelve routes are gated on authentication alone**, and every one of them is
self-scoped in code rather than by permission:

- The five `users/{user_id}/…` reads go through
  `_require_self_or_quartermaster(user_id, current_user)`: it returns early for
  self, allows `inventory.manage`, and otherwise raises **403**. No
  fall-through — it fails closed.
- `PATCH /checkout/{id}/extend` resolves the checkout org-scoped first, then
  applies the same own-or-manage test.
- `GET /requests` and `GET /return-requests` **force** the requester filter to
  the caller for non-managers, regardless of the `mine_only` flag, so the flag
  cannot be used to widen a read.
- `POST /requests` and `POST /return-requests` create against the caller.
- `GET` / `PUT /my/size-preferences` accept no id at all.

`_redact_holder` closes the matching catalog-side disclosure: the item catalog
stays open to every member, but the holder's identity is stripped from an item
the caller may not trace — otherwise `GET /items?assigned_to=<uuid>` would
reconstruct a colleague's kit from the catalog. A member always sees their own
name on their own gear.

---

## Data Flows

### Serialized gear

```
Item created (no tracking_type)
  → Assigned to a member        (item_assignments, type: permanent)
     or loaned                  (item_assignments, type: temporary, due date)
     or checked out             (checkout_records, extendable)
  → Transferred between holders
  → Returned / checked in       (status back to available)
  → Retired or written off
```

### Pool stock

```
Item created (tracking_type: pool, quantity N)
  → issue_from_pool: locks the item row, checks the allowance,
    decrements whichever ledger holds the stock (lots if lot-stocked,
    else item.quantity), increments quantity_issued, snapshots the
    replacement cost for later cost recovery
  → Returned → return_to_pool restores units to the same ledger
```

### Departure clearance

```
Member departs (dropped_voluntary | dropped_involuntary | retired)
  → Clearance initiated — one line per item the member holds
  → Each line dispositioned: returned | returned_damaged | written_off | waived
  → Charges raised for unreturned value (ChargeStatus)
  → Completed, or closed_incomplete if something never came back
```

### Requests and reordering

```
Member requests equipment (checkout | issuance | purchase | return)
  → pending → approved | denied → fulfilled

Stock falls below reorder_point / low_stock_threshold
  → Reorder request (urgency: low … critical)
  → approved → ordered → partially_received → received
  → Receipts recorded against the request
```

### Cross-module integration

| Module           | Integration                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| Member lifecycle | Departure clearance is driven by the offboarding flow; write-offs reference a clearance |
| Apparatus        | Equipment-check templates consume inventory lots; apparatus is an NFC scan target       |
| Finance          | Charges for unreturned gear feed cost recovery                                          |
| Notifications    | `inventory_notification_queue`, low-stock and overdue-property digests (email-only)     |
| Labels           | Barcode and storage-area label printing via the shared label module                     |
| Scheduled tasks  | Overdue-property reminders, NFC audit digests, shelf-audit scheduling                   |

---

## Configuration

### Module availability

Per organization at runtime via `enabled_modules` (**Organization/Admin
Settings → Modules**). No deployment-level environment flag. The WebSocket
checks the same setting independently — see above.

### Upload limits

`MAX_INVENTORY_CSV_BYTES` is a module constant: **10 MB**, hardcoded in
`endpoints/inventory.py`. It is not an environment variable, so an operator
cannot raise it without a code change. This module reads no environment
variables of its own.

### Notifications are email-first

Low-stock alerts, reorder notices and overdue-property digests are
**email-only** by design — they are operational notices whose recipient acts on
them during business hours, and CLAUDE.md pitfall #18 limits SMS to the
allowlist in `SmsAlert`. A quartermaster does not need a 2am text to learn the
department is low on gloves, and a text could carry neither the item list nor
the quantities.

---

## Edge Cases

| Scenario                                                     | Behavior                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Item has lots, and all of them expired                       | Reads as **zero** ready units — it does not fall back to the `quantity` column                       |
| Issuing more than available                                  | Refused: "Insufficient stock: N available, M requested"                                              |
| Issuing beyond a member's category allowance                 | Refused, unless the caller passes the quartermaster override                                         |
| Two members issued the same last unit at once                | Serialized by a row lock (`_get_item_locked`, `SELECT … FOR UPDATE` with `populate_existing=True`)   |
| Item retired, inactive, or in an unissuable status/condition | Refused with a message naming the status or condition                                                |
| `GET /items?assigned_to=<uuid>` by a non-manager             | Holder identity redacted by `_redact_holder`; the member still sees their own name on their own gear |
| `mine_only=false` sent by a non-manager                      | Ignored — the requester filter is forced to the caller                                               |
| Reading another member's gear without `inventory.manage`     | **403**, from `_require_self_or_quartermaster`                                                       |
| A foreign-organization id in any FK                          | Refused with a 400 — every client-supplied FK is validated in-org (INV-4, closed pass 4)             |
| Negative quantity submitted                                  | Rejected at the schema (422) — every quantity field is `ge=0` or `ge=1`                              |
| Equipment-kit line marked optional and missing               | Skipped; required lines still fail the kit                                                           |
| WebSocket publish fails                                      | Logged with organization and action; never raised into the triggering request                        |
| CSV upload over 10 MB                                        | Refused by `read_upload_limited` before the body is parsed                                           |

---

## Known Gaps

| Gap                                    | Detail                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Large unreviewed surface               | The lots/ledger internals, NFC, kiosk, labels, import/export, impact planner and vendors have verified tenancy invariants but no business-logic review. See app-review pass 5's scope note |
| `MAX_INVENTORY_CSV_BYTES` not tunable  | A fixed 10 MB cap; arguably the safer design, but it is the one operational knob an operator cannot change                                                                                 |
| No integration test for the lot ledger | It is the authoritative stock record for lot-tracked items and was checked only for locking                                                                                                |

---

## Troubleshooting

| Issue                                               | Cause                                                   | Fix                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Module not visible in navigation                    | Not enabled for the organization                        | Enable Inventory in Organization/Admin Settings → Modules (`enabled_modules`)                       |
| Inventory screens do not live-update                | WebSocket blocked, or module disabled for the org       | The `/ws` handshake checks `enabled_modules` itself; check the proxy allows WebSocket upgrades      |
| An item shows 0 available but stock is on the shelf | It is lot-tracked and every lot has expired             | Receive a new lot, or correct the lot expiry — the `quantity` column is not consulted for lot items |
| "Insufficient stock" when the count looks fine      | The lot ledger, not `quantity`, is authoritative        | Check in-date lot totals for the item                                                               |
| A member cannot see a colleague's gear              | Working as intended — `inventory.view` is baseline      | Grant `inventory.manage` only if they are genuinely a quartermaster                                 |
| Issuance refused for an eligible member             | Per-category allowance exhausted                        | Check `/allowances`; use the quartermaster override if exceeding it is intended                     |
| Frontend field reads `undefined`                    | This module serializes **snake_case**, unlike apparatus | Match the Python attribute name — see the casing note under Architecture                            |
| Overdue property not chasing anyone                 | Reminders are email-only and run from a scheduled task  | Verify `EMAIL_ENABLED` and the task's last run; SMS is deliberately not used                        |

---

## Review History

Reviewed by the application-review rotation as **B3** (prefix `INV2`): passes
1–2 (2026-08-06), 3–4 (2026-08-09), a follow-up (2026-08-11) and pass 5
(2026-10-06). The module carries **no open code findings**. Findings, verified
claims and the explicit scope of each pass are in
[docs/app-review/inventory.md](./app-review/inventory.md); the original security
audit is in [docs/module-audit/inventory.md](./module-audit/inventory.md).
