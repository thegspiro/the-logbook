# Apparatus Module

The Apparatus module manages department vehicles, their equipment, maintenance,
operators and crew positions. It offers both a full module and a lightweight
"Basic" alternative.

> **Structured reference:** data models, the full endpoint-and-permission
> tables, data flows, edge cases and troubleshooting live in
> [docs/APPARATUS_MODULE.md](../docs/APPARATUS_MODULE.md). This page is the
> feature overview.

---

## Key Features

### Full Apparatus Module

- **Vehicle Management** — Complete CRUD for department apparatus (engines, ladders, rescues, ambulances, etc.), with configurable types, statuses and custom fields
- **Crew Positions** — Define crew positions per vehicle with minimum staffing requirements
- **Maintenance Tracking** — Schedule and track vehicle maintenance, inspections, and repairs, with configurable maintenance types and service providers
- **Equipment, Components, Fuel, Photos and Documents** — Per-vehicle equipment lists, components and component notes, fuel logs, photos and documents
- **Operators and EVOC levels** — Record who may drive each vehicle and the EVOC level a driver needs (see [EVOC driver levels](#evoc-driver-levels))
- **Status Tracking** — In-service, out-of-service, maintenance, reserve statuses, with status history
- **NFPA Compliance** — A department-wide switch (default on for fire and combined departments, off for EMS-only); when on, each tracked apparatus gets an NFPA tab grading its required NFPA tests from maintenance records, plus a hand-kept list of compliance items (see [NFPA compliance](#nfpa-compliance))
- **Equipment Checks** — Structured checklists for shift-based and standalone vehicle and equipment inspections, part of the Inventory module (see [Equipment checks](#equipment-checks))
- **Deficiency Tracking** — Automatic deficiency flagging when equipment check items fail, cleared when a later check passes

### Apparatus Basic (Lightweight)

- **Simple Vehicle List** — Unit numbers, names, and types
- **Crew Positions** — Define crew positions per vehicle
- **Shift Integration** — Vehicles appear in the shift creation dropdown
- **No Full Module Required** — Available when the full Apparatus module is disabled

---

## Pages

Every `/apparatus*` page also requires the Apparatus module to be enabled.

| URL                       | Page             | Permission (any one)                   |
| ------------------------- | ---------------- | -------------------------------------- |
| `/apparatus`              | Apparatus List   | `apparatus.view`, `apparatus.manage`   |
| `/apparatus/new`          | Add Apparatus    | `apparatus.create`, `apparatus.manage` |
| `/apparatus/:id`          | Apparatus Detail | `apparatus.view`, `apparatus.manage`   |
| `/apparatus/:id/edit`     | Edit Apparatus   | `apparatus.edit`, `apparatus.manage`   |
| `/apparatus/print-labels` | Print Labels     | `apparatus.view`, `apparatus.manage`   |
| `/apparatus-basic`        | Apparatus Basic  | Any signed-in member                   |

`/apparatus-basic` is the lightweight alternative used when the full Apparatus
module is disabled. The side navigation shows the correct link, and the
Apparatus entry is gated on the same permissions as the route, so a member
without them does not see it.

### Who sees the fleet

The apparatus pages are a maintenance and compliance workspace — inspection
expirations, out-of-service status, deficiency flags and driver
qualifications — so `apparatus.view` is **not** part of the baseline Member,
Firefighter or EMT grants. Officers, chiefs and administrators hold it, as does
the **Engineer** (driver/operator) rank and position, beside
`apparatus.maintenance`. A department that wants every member to see the fleet
can add `apparatus.view` to its Member position on the positions screen.

The crew-level **Apparatus Inventory** page
(`/inventory/checklists/apparatus-inventory`) fills its apparatus picker from
the scheduling roster rather than the Apparatus module, so members without
`apparatus.view` can still record a used item.

---

## API Endpoints

### Full Module

All under `/api/v1/apparatus`, gated on the Apparatus module. Reads accept
`apparatus.view` or `apparatus.manage`; most writes need `apparatus.manage`,
and record edits accept `apparatus.edit`.

```
GET    /api/v1/apparatus                     # List apparatus
POST   /api/v1/apparatus                     # Create apparatus
GET    /api/v1/apparatus/summary             # Fleet summary
GET    /api/v1/apparatus/archived            # Archived apparatus
GET    /api/v1/apparatus/{id}                # Get details
PATCH  /api/v1/apparatus/{id}                # Update
DELETE /api/v1/apparatus/{id}                # Delete
POST   /api/v1/apparatus/{id}/status         # Change status
POST   /api/v1/apparatus/{id}/archive        # Archive with a disposal record
```

Sub-resources follow the same pattern: `/types`, `/statuses`,
`/custom-fields`, `/maintenance-types`, `/maintenance` (and
`/maintenance/due`), `/fuel-logs`, `/operators`, `/equipment`, `/components`,
`/component-notes`, `/service-providers`, `/report-configs`,
`/{id}/photos`, `/{id}/documents`, `/{id}/folders`, `/{id}/service-report`,
`/nfpa-compliance`, `/nfpa-settings`, `/{id}/nfpa-summary`, `/evoc-levels`,
`/evoc-check/{apparatus_id}/{user_id}` and `/driver-exceptions`. The full
table, with each endpoint's permission, is in
[docs/APPARATUS_MODULE.md](../docs/APPARATUS_MODULE.md).

### Basic (Scheduling Integration)

```
GET    /api/v1/scheduling/apparatus          # List basic apparatus
POST   /api/v1/scheduling/apparatus          # Create basic apparatus
PATCH  /api/v1/scheduling/apparatus/{id}     # Update basic apparatus
DELETE /api/v1/scheduling/apparatus/{id}     # Delete basic apparatus
```

---

## Editing and archiving a unit

- **Clearing a field on edit persists.** The update endpoint applies
  `exclude_unset`, so the form sends emptied text, dates and numbers as
  explicit `null`. The four `NOT NULL` columns (`unitNumber`,
  `apparatusTypeId`, `statusId`, `minStaffing`) are never sent empty.
- **`fuel_type` has no default.** A unit nobody chose a fuel for is stored with
  no fuel type.
- **Archiving takes a disposal record** — method (sold, traded, donated,
  scrapped), date, reason and notes, plus buyer details for a sale. Archive
  from the apparatus page; the list row has no Archive button.
- **Apparatus document sub-folders** (Maintenance, Manuals, Inspections) are
  gated on apparatus and document permissions, not facilities permissions.

---

## NFPA compliance

Whether a department wants NFPA tracking depends on what it is, so it is a
switch:

- **Stored** as `apparatus.nfpa_compliance_enabled` in the organization
  settings, written with `PATCH /organization/settings` (`settings.manage`).
  Unset, it follows `organization_type`: on for `fire_department` and
  `fire_ems_combined`, off otherwise. `app/utils/apparatus_nfpa.py` is the one
  reader.
- **Enforced on the server.** Every NFPA endpoint answers 403 while the switch
  is off. Nothing is deleted; turning it back on restores the records.
- **Graded on the server.** `GET /apparatus/{id}/nfpa-summary` returns the
  NFPA-required maintenance types that apply to the vehicle's type, each with
  its last completed test, next due date and status (`current`, `due_soon`
  within 30 days, `overdue`, `scheduled`, `never_performed`), and the
  compliance items with an effective status (a past next due date reads
  `overdue`).

| Endpoint                                  | Purpose                                |
| ----------------------------------------- | -------------------------------------- |
| `GET /api/v1/apparatus/nfpa-settings`     | Effective switch, type default, choice |
| `GET /api/v1/apparatus/{id}/nfpa-summary` | Required tests and items, graded       |

The NFPA tab appears when the switch is on **and** the apparatus has
`nfpa_tracking_enabled`; the edit form offers that checkbox only while the
switch is on, and it is off by default for each new vehicle.

---

## EVOC driver levels

EVOC (Emergency Vehicle Operator Course) levels are organization-configurable
rows in `evoc_levels` — a level number, name, code and description, cumulative
by default (a higher level implies the lower ones) and optionally tied to a
training program. They are managed through `/api/v1/apparatus/evoc-levels`.

- **`apparatus.required_evoc_level_id`** is a nullable foreign key to
  `evoc_levels` (`ON DELETE SET NULL`): the minimum level needed to drive that
  vehicle.
- **`apparatus_operators.evoc_level_id`** records the level an operator holds.
- `GET /apparatus/evoc-check/{apparatus_id}/{user_id}` answers whether a member
  meets a vehicle's requirement (`apparatus.view` or `scheduling.view`).
- **Driver exceptions** — a member can request an exception to the EVOC
  requirement (`POST /apparatus/driver-exceptions`). It confers nothing until
  someone else holding `apparatus.approve_driver_exception` approves it, and it
  can be revoked.

---

## Equipment checks

Equipment checklists belong to the Inventory module (a checklist is a list of
inventory items) and are documented in full in
[Inventory → Authoring and performing a check](Module-Inventory#authoring-and-performing-a-check).
In brief:

- **Template Builder** — checklist templates with nested compartments and
  items, targeting a specific apparatus or every apparatus of a type, and
  optionally assigned to positions (e.g. Driver/Operator checks). Presets exist
  for common apparatus types.
- **Item types** — four kinds of answer: `level` (a number against a
  threshold), `function` (pass/fail), `count` (a quantity; short of par is a
  restock line, not a failure) and `expiry` (a date). `header` and `text` are
  layout. `app/utils/check_types.py` is the write-side authority; the request
  schema still accepts legacy type names and normalizes them before storing.
- **Sealed containers** — a compartment can carry a numbered tamper seal
  (`check_template_compartments.is_sealed`). Confirming an intact seal whose
  number matches the last check carries the previous counts forward; it never
  clears expiry dates or readings, and it does not write counts up to par.
  Nested sealed containers get their own card.
- **Performing a check** — on a shift or standalone, with photos (up to 3 per
  item). Expired items and items below required quantity fail regardless of
  the submitted result.
- **Deficiency flag** — a failed check sets `has_deficiency` and
  `deficiency_since` on the apparatus; a later check in which every item passes
  clears it. Failures notify shift officers and configured roles in-app and,
  optionally, by email.
- **Catalog linking, on-truck counts, restock reports and deployed lots** —
  positions link to inventory items (`inventory_item_id`), record
  `quantity_on_truck` (NULL means never counted), take used-item reports at
  the time of use (`inventory.check_submit`), and track each lot aboard
  separately (`check_item_deployed_lots`) so the soonest expiry shows.
  Withdrawing a restock report or swapping lots needs `inventory.check_manage` /
  `inventory.manage`; a swap by a crew member without `inventory.manage` is
  capped at the deployed quantity it replaces and requires the replaced lot to
  be aboard.

### Pages

| URL                                                 | Page                                    | Permission (any one)                                               |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `/inventory/admin/checklists/templates/new`         | Template Builder                        | `inventory.check_manage`                                           |
| `/inventory/admin/checklists/templates/:templateId` | Edit Template                           | `inventory.check_manage`                                           |
| `/inventory/admin/checklists/reports`               | Reports Dashboard                       | `inventory.check_view`                                             |
| `/inventory/admin/checklists/supply`                | Expiring on Apparatus (supply worklist) | `inventory.check_view`, `inventory.manage`                         |
| `/inventory/checklists/apparatus-inventory`         | Apparatus Inventory                     | `inventory.check_submit`, `inventory.check_view`, `inventory.view` |

All require the Inventory module to be enabled.

### API

Under `/api/v1/equipment-checks`: templates (`/templates`, `/templates/{id}`,
`/templates/{id}/clone`, `/templates/{id}/last-results`,
`/templates/{id}/last-seals`, `/templates/{id}/inventory-matches`,
`/templates/{id}/inventory-links`), compartments and items, checks
(`/shifts/{shift_id}/checklists`, `/shifts/{shift_id}/checks`, `/checks`,
`/checks/{id}`, `/checks/{id}/complete`, photo upload), the member's own
checklists (`/my-checklists`), reports (`/reports/compliance`,
`/reports/failures`, `/reports/item-trends`, CSV and PDF export) and the
on-truck stock endpoints (`/apparatus/{id}/inventory`,
`/supply/expiring-items`, `/items/{id}/used`, `/items/{id}/quantity`,
`/items/{id}/swap`, `/items/{id}/deployed-lots`).

### Data Model

| Table                         | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `equipment_check_templates`   | Master template (name, timing, type, assigned positions) |
| `check_template_compartments` | Named sections, nested via `parent_compartment_id`       |
| `check_template_items`        | Items with check type, expiration, serial/lot, quantity  |
| `check_item_deployed_lots`    | Each lot aboard a position                               |
| `shift_equipment_checks`      | Submitted check records                                  |
| `shift_equipment_check_items` | Individual item results                                  |
| `shift_equipment_check_seals` | Seal readings recorded on a check                        |

---

## NFC Tags on the Fleet

**Check-In QR Codes** (`/locations/qr-codes`) is the department's directory of
every check-in code, one card per apparatus, so it is where a box of tags gets
written for a fleet in one sitting. **Write NFC tag** sits beside Copy URL /
Download PNG / Regenerate in each card's action row.

**Prefer an apparatus-keyed tag for anything physically mounted.** The URL is
`/scheduling/checkin?apparatus=<id>`, which resolves to whichever shift is
running when the tag is tapped — the shift whose start and end times span the
tap, else one that ended within two hours, else the next upcoming. Cancelled and
finalized shifts are skipped. One tag on the truck therefore serves every
shift. A shift-keyed tag is dead the moment that shift ends.

The member lands on the shift check-in page, which names the unit, date and
hours on screen so they can see which truck they were matched to before they
confirm. Whether a non-rostered member may check in is the
`restrict_checkin_to_assigned` setting (off by default, under Scheduling →
Settings).

- **Who is offered the writer.** `apparatus.manage_nfc_tags` gates **Write NFC
  tag** on the apparatus cards and in the shift detail panel's QR block. It is
  seeded on the President, Vice President, Chief, Deputy Chief, Assistant Chief
  and the Apparatus Officer. It gates the client only: writing never reaches
  the server, and the tag carries no secret.
- **Room cards write a different link.** The room kiosk cards encode
  `/display/{code}`, a public unauthenticated screen keyed by a non-guessable
  code, and that code is never written to a tag. A room card's writer (gated on
  `locations.manage_nfc_tags`, seeded on the same leadership plus the
  Facilities Manager) writes `/locations/{id}/check-in` instead — a signed-in
  page that forwards to the event open in that room. One rule
  (`parseNfcTagPath` with the `TAG_TARGETS` spec) governs both what the button
  offers and what a scan will accept. See
  [Training 06 — Room door tags](https://github.com/thegspiro/the-logbook/blob/main/docs/training/06-apparatus-facilities.md#room-door-tags).
- **A failed write raises a toast, not a silent no-op.** A silent failure looks
  exactly like a tag that was written — the member finds out by tapping a dead
  sticker.
- **Chrome on Android, over HTTPS.** Web NFC exists nowhere else and browsers
  expose it only in a secure context, so the button renders nothing on iOS,
  desktop, or a plain-`http://` LAN deployment. QR remains the universal path.

---

**See also:** [Scheduling Module](Module-Scheduling) | [Inventory Module](Module-Inventory) | [Role System](Role-System)
