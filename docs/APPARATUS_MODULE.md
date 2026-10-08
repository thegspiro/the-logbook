# Apparatus Module

Fleet records for a fire department's vehicles — identity, status, maintenance,
components, equipment, fuel, NFPA compliance, and who is qualified to drive
what.

## Overview

The Apparatus module is the department's vehicle register. Each apparatus row
carries identity (unit number, VIN, plate, radio ID, asset tag), a type and a
status, and hangs a set of sub-resources off itself: maintenance records,
components and their notes, equipment, fuel logs, photos, documents, NFPA
compliance items, and operators.

Two things make it more than a vehicle list. **EVOC gating** decides who may
drive: an apparatus can require a certification level, and the scheduling module
asks this module whether a given member qualifies on the day of a given shift.
**Driver exceptions** are the documented way around that gate for a parade or a
non-emergency transport, with a request-and-approve workflow of their own.

By endpoint count this is the second-largest module in the repository (90
routes; inventory has 148 plus a WebSocket).

### Related documentation

This page is the **structured reference**: data shapes, gates, invariants, edge
cases. It is not the only apparatus document.

| Document                                                  | What it is for                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [wiki/Module-Apparatus.md](../wiki/Module-Apparatus.md)   | Feature narrative and the dated change history (NFC on the fleet, NFPA per department, the officer-only fleet record, equipment-check item types) |
| [docs/DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)           | Generated, authoritative column-level schema                                                                                                      |
| [docs/app-review/apparatus.md](./app-review/apparatus.md) | Review findings and verified-good claims across five passes                                                                                       |
| [docs/KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)       | **AP2-4**, the open EVOC fail-open decision                                                                                                       |

The equipment-check feature shares `models/apparatus.py` but is its own
surface; the wiki page above covers it.

### Key Capabilities

- **Fleet register** — apparatus with configurable types and statuses, custom
  fields, photos and documents, pagination and filtering, plus an archive for
  previously-owned vehicles
- **Maintenance** — typed maintenance records (preventive, repair, inspection,
  certification, fluid, cleaning), a due/overdue view, and per-apparatus service
  reports
- **Components and notes** — track an apparatus's pump, aerial, chassis and the
  rest as individual components, each with a condition and a running note log
  (observation, issue, repair, inspection, update) with severity and status
- **Equipment and fuel** — equipment carried on the vehicle; fuel log entries
- **NFPA compliance** — per-apparatus compliance items and a standing summary,
  behind a department-level switch
- **Operators and EVOC** — a cumulative certification ladder, operator records
  with certification dates and expiry, and a live eligibility check consumed by
  shift scheduling
- **Driver exceptions** — request, approve, deny and revoke a time-boxed
  exception to the EVOC requirement
- **Service providers** — the outside garages maintenance records point at, with
  archive and restore

---

## Architecture

### Frontend Module Structure

```
frontend/src/modules/apparatus/          (39 files)
├── index.ts                             # Module barrel export
├── routes.tsx                           # Route definitions
├── types/index.ts                       # TypeScript types and enums
├── services/api.ts                      # Module axios instance + API layer
├── store/apparatusStore.ts              # Zustand store
├── hooks/useApparatusNfpaSettings.ts    # Department NFPA switch
├── utils/iconMap.ts                     # Apparatus-type iconography
├── pages/
│   ├── ApparatusListPage.tsx            # Fleet list
│   ├── ApparatusDetailPage.tsx          # One apparatus, tabbed
│   ├── ApparatusFormPage.tsx            # Create / edit
│   └── ApparatusLabelPrintPage.tsx      # Label printing entry point
└── components/
    ├── ApparatusDetailHeader.tsx        # Identity + status header
    ├── ApparatusOverviewTab.tsx
    ├── MaintenanceTab.tsx / MaintenanceRecordModal.tsx
    ├── EquipmentTab.tsx / EquipmentModal.tsx
    ├── FuelLogsTab.tsx / FuelLogModal.tsx
    ├── OperatorsTab.tsx / OperatorModal.tsx
    ├── NfpaComplianceTab.tsx / NfpaItemModal.tsx / NfpaDepartmentSwitch.tsx
    ├── DocumentsTab.tsx
    ├── ArchiveApparatusModal.tsx
    └── ApparatusTypeBadge.tsx / StatusBadge.tsx
```

### Backend Files

| File                                       | Role                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `app/api/v1/endpoints/apparatus.py`        | 90 routes, mounted at `/api/v1/apparatus`                        |
| `app/services/apparatus_service.py`        | Fleet, maintenance, components, equipment, fuel, NFPA, reports   |
| `app/services/evoc_level_service.py`       | EVOC ladder, seeding, and `check_driver_evoc_eligibility`        |
| `app/services/driver_exception_service.py` | Exception request/review workflow and the approver list          |
| `app/models/apparatus.py`                  | 27 tables (the fleet plus the equipment-check template tables)   |
| `app/schemas/apparatus.py`                 | Request/response schemas — **camelCase on the wire** (see below) |

> **Response casing.** `schemas/apparatus.py` sets
> `alias_generator=to_camel`, so this module serializes **camelCase**
> (`unitNumber`, `organizationId`). That is a per-module choice in this
> repository, not a repo-wide rule — roughly a third of schema modules do it and
> the rest are snake_case. Check the module before writing a frontend type
> against it: `grep alias_generator=to_camel backend/app/schemas/<module>.py`.
> See CLAUDE.md pitfall #5.

### Enums

All are `(str, Enum)` with lowercase values, per the repo convention.

| Enum                      | Values                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApparatusCategory`       | `fire`, `ems`, `rescue`, `support`, `command`, `marine`, `aircraft`, `admin`, `other`                                                                                                                                                   |
| `DefaultApparatusType`    | `engine`, `ladder`, `quint`, `rescue`, `ambulance`, `squad`, `tanker`, `brush`, `hazmat`, `command`, `utility`, `boat`, `atv`, `staff`, `reserve`, `other`                                                                              |
| `DefaultApparatusStatus`  | `in_service`, `out_of_service`, `in_maintenance`, `reserve`, `on_order`, `sold`, `disposed`                                                                                                                                             |
| `FuelType`                | `gasoline`, `diesel`, `electric`, `hybrid`, `propane`, `cng`, `other`                                                                                                                                                                   |
| `CustomFieldType`         | `text`, `number`, `decimal`, `date`, `datetime`, `boolean`, `select`, `multi_select`, `url`, `email`                                                                                                                                    |
| `MaintenanceCategory`     | `preventive`, `repair`, `inspection`, `certification`, `fluid`, `cleaning`, `other`                                                                                                                                                     |
| `MaintenanceIntervalUnit` | `days`, `weeks`, `months`, `years`, `miles`, `kilometers`, `hours`                                                                                                                                                                      |
| `ComponentType`           | `engine`, `pump`, `aerial`, `chassis`, `drivetrain`, `brakes`, `electrical`, `hydraulic`, `body`, `cab`, `tank`, `foam_system`, `cooling`, `exhaust`, `lighting`, `communications`, `safety_equipment`, `hvac`, `tires_wheels`, `other` |
| `ComponentCondition`      | `excellent`, `good`, `fair`, `poor`, `critical`                                                                                                                                                                                         |
| `NoteType`                | `observation`, `repair`, `issue`, `inspection`, `update`                                                                                                                                                                                |
| `NoteSeverity`            | `info`, `low`, `medium`, `high`, `critical`                                                                                                                                                                                             |
| `NoteStatus`              | `open`, `in_progress`, `resolved`, `deferred`                                                                                                                                                                                           |
| `DriverExceptionStatus`   | `pending`, `approved`, `denied`, `revoked`                                                                                                                                                                                              |
| `DriverExceptionReason`   | `parade`, `special_event`, `non_emergency_transport`, `mutual_aid`, `other`                                                                                                                                                             |

`DefaultApparatusType` and `DefaultApparatusStatus` are the **seeded defaults**,
not a closed set: types and statuses are rows (`apparatus_types`,
`apparatus_statuses`) that a department can add to, rename or delete, which is
why the apparatus row carries `apparatus_type_id` / `status_id` rather than an
enum column.

---

## Data Models

`app/models/apparatus.py` declares 27 tables. The fleet's own are below; the
seven `equipment_check_*` / `check_template_*` / `template_change_logs` tables
live in the same file but belong to the **equipment-check** feature and are
documented with it.

| Table                         | What it holds                                                                |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `apparatus`                   | The vehicle register — identity, type, status, specs, expiry dates, disposal |
| `apparatus_types`             | Per-org type rows (seeded from `DefaultApparatusType`)                       |
| `apparatus_statuses`          | Per-org status rows (seeded from `DefaultApparatusStatus`)                   |
| `apparatus_custom_fields`     | Per-org custom field definitions, typed by `CustomFieldType`                 |
| `apparatus_photos`            | Photos attached to an apparatus                                              |
| `apparatus_documents`         | Documents attached to an apparatus                                           |
| `apparatus_maintenance_types` | Per-org maintenance type definitions, with default intervals                 |
| `apparatus_maintenance`       | Maintenance records — scheduled, completed and historic                      |
| `apparatus_fuel_logs`         | Fuel purchases / fills                                                       |
| `apparatus_components`        | Components of an apparatus (pump, aerial, …) with condition                  |
| `apparatus_component_notes`   | Note log against a component, typed and severity-ranked                      |
| `apparatus_equipment`         | Equipment carried on the apparatus                                           |
| `apparatus_service_providers` | Outside garages; archivable                                                  |
| `apparatus_location_history`  | Station/location assignment history                                          |
| `apparatus_status_history`    | Status change history with reason and actor                                  |
| `apparatus_nfpa_compliance`   | NFPA compliance items per apparatus                                          |
| `apparatus_report_configs`    | Saved report configurations                                                  |
| `evoc_levels`                 | The EVOC certification ladder, per org                                       |
| `apparatus_operators`         | Operator records — member, level, certification dates and expiry             |
| `driver_exceptions`           | Time-boxed exceptions to the EVOC requirement, with review chain             |

### `apparatus` — selected columns

| Column                                             | Type            | Notes                                                           |
| -------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| `id`                                               | `String(36)`    | UUID primary key                                                |
| `organization_id`                                  | `String(36)`    | FK to organizations; every query filters on it                  |
| `unit_number`                                      | `String`        | Unique per organization; the department's name for the truck    |
| `name`                                             | `String`        | Display name                                                    |
| `vin`                                              | `String(17)`    | Vehicle Identification Number                                   |
| `license_plate`                                    | `String(20)`    |                                                                 |
| `radio_id`                                         | `String(50)`    | Radio call sign                                                 |
| `asset_tag`                                        | `String(50)`    | Internal asset tracking number                                  |
| `apparatus_type_id`                                | `String(36)`    | FK to `apparatus_types`                                         |
| `status_id`                                        | `String(36)`    | FK to `apparatus_statuses`                                      |
| `status_reason`                                    | `String`        | Why the status was last changed                                 |
| `status_changed_at` / `_by`                        | `DateTime` / FK | Stamped on every status change; `_by` FKs `users.id`            |
| `year` / `make` / `model`                          | mixed           | Vehicle identity                                                |
| `fuel_type`                                        | `FuelType`      | Enum-typed on the schema too, so a bad value is a 422 not a 500 |
| `required_evoc_level_id`                           | `String(36)`    | FK to `evoc_levels` — NULL means anyone may drive it            |
| `registration_expiration`                          | `Date`          | Fed into the 30-day expiry counts on the fleet summary          |
| `inspection_expiration`                            | `Date`          | ditto                                                           |
| `insurance_expiration`                             | `Date`          | ditto                                                           |
| `is_archived`                                      | `Boolean`       | Previously-owned apparatus; excluded from the active fleet      |
| `disposal_date` / `_method` / `_reason` / `_notes` | mixed           | Set when archiving a sold or disposed vehicle                   |

> **Schema note.** [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) is the generated,
> authoritative column-level reference for all 27 tables. It is regenerated by
> `cd backend && python scripts/generate_schema_docs.py` and checked in CI, so
> prefer it over this summary when the exact column list matters.

---

## API Endpoints

All paths below are relative to `/api/v1/apparatus`. Permission columns list the
permissions that **satisfy** the gate (OR semantics) — holding any one is
enough.

**Counts in this document were generated on 2026-10-08** from
`apparatus.router.routes` and the decorator/signature pairs in
`endpoints/apparatus.py`. Re-derive rather than trust them if the module has
moved on:
`grep -cE '@router\.(get|post|put|patch|delete)\(' backend/app/api/v1/endpoints/apparatus.py`.

### Fleet

| Method   | Path                      | Permission                     | Description                                |
| -------- | ------------------------- | ------------------------------ | ------------------------------------------ |
| `GET`    | `` (root)                 | `apparatus.view` / `.manage`   | List apparatus with filtering + pagination |
| `POST`   | `` (root)                 | `apparatus.create` / `.manage` | Create a new apparatus                     |
| `GET`    | `/{apparatus_id}`         | `apparatus.view` / `.manage`   | Get one apparatus                          |
| `PATCH`  | `/{apparatus_id}`         | `apparatus.edit` / `.manage`   | Update an apparatus                        |
| `DELETE` | `/{apparatus_id}`         | `apparatus.manage`             | **Hard delete** — see Edge Cases           |
| `POST`   | `/{apparatus_id}/archive` | `apparatus.manage`             | Archive (sold / disposed)                  |
| `POST`   | `/{apparatus_id}/status`  | `apparatus.edit` / `.manage`   | Change status, with reason                 |
| `GET`    | `/archived`               | `apparatus.view` / `.manage`   | List previously-owned apparatus            |
| `GET`    | `/summary`                | `apparatus.view` / `.manage`   | Fleet summary for the dashboard            |

### Types, statuses and custom fields

| Method             | Path                        | Permission                   | Description                   |
| ------------------ | --------------------------- | ---------------------------- | ----------------------------- |
| `GET`              | `/types`                    | `apparatus.view` / `.manage` | List apparatus types          |
| `GET`              | `/types/{type_id}`          | `apparatus.view` / `.manage` | Get one type                  |
| `POST`             | `/types`                    | `apparatus.manage`           | Create a type                 |
| `PATCH` / `DELETE` | `/types/{type_id}`          | `apparatus.manage`           | Update / delete a type        |
| `GET`              | `/statuses`                 | `apparatus.view` / `.manage` | List statuses                 |
| `GET`              | `/statuses/{status_id}`     | `apparatus.view` / `.manage` | Get one status                |
| `POST`             | `/statuses`                 | `apparatus.manage`           | Create a status               |
| `PATCH` / `DELETE` | `/statuses/{status_id}`     | `apparatus.manage`           | Update / delete a status      |
| `GET`              | `/custom-fields`            | `apparatus.view` / `.manage` | List custom field definitions |
| `POST`             | `/custom-fields`            | `apparatus.manage`           | Create a definition           |
| `PATCH` / `DELETE` | `/custom-fields/{field_id}` | `apparatus.manage`           | Update / delete a definition  |

### Maintenance

| Method             | Path                             | Permission                                    | Description                    |
| ------------------ | -------------------------------- | --------------------------------------------- | ------------------------------ |
| `GET`              | `/maintenance`                   | `apparatus.view` / `.manage`                  | List maintenance records       |
| `GET`              | `/maintenance/{record_id}`       | `apparatus.view` / `.manage`                  | Get one record                 |
| `GET`              | `/maintenance/due`               | `apparatus.view` / `.manage`                  | Due within N days (+ overdue)  |
| `POST`             | `/maintenance`                   | `apparatus.maintenance` / `.edit` / `.manage` | Create a record                |
| `PATCH`            | `/maintenance/{record_id}`       | `apparatus.maintenance` / `.edit` / `.manage` | Update a record                |
| `DELETE`           | `/maintenance/{record_id}`       | `apparatus.manage`                            | Delete a record                |
| `GET`              | `/maintenance-types`             | `apparatus.view` / `.manage`                  | List maintenance types         |
| `POST`             | `/maintenance-types`             | `apparatus.manage`                            | Create a type                  |
| `PATCH` / `DELETE` | `/maintenance-types/{type_id}`   | `apparatus.manage`                            | Update / delete a type         |
| `GET`              | `/{apparatus_id}/service-report` | `apparatus.view` / `.manage`                  | Service report for one vehicle |

### Components and notes

| Method   | Path                         | Permission                                    | Description                |
| -------- | ---------------------------- | --------------------------------------------- | -------------------------- |
| `GET`    | `/components`                | `apparatus.view` / `.manage`                  | List components            |
| `GET`    | `/components/{component_id}` | `apparatus.view` / `.manage`                  | Get one component          |
| `POST`   | `/components`                | `apparatus.edit` / `.manage`                  | Create a component         |
| `PATCH`  | `/components/{component_id}` | `apparatus.edit` / `.manage`                  | Update a component         |
| `DELETE` | `/components/{component_id}` | `apparatus.manage`                            | **Archive** (soft-delete)  |
| `GET`    | `/component-notes`           | `apparatus.view` / `.manage`                  | List notes, with filtering |
| `GET`    | `/component-notes/{note_id}` | `apparatus.view` / `.manage`                  | Get one note               |
| `POST`   | `/component-notes`           | `apparatus.maintenance` / `.edit` / `.manage` | Create a note              |
| `PATCH`  | `/component-notes/{note_id}` | `apparatus.maintenance` / `.edit` / `.manage` | Update a note              |
| `DELETE` | `/component-notes/{note_id}` | `apparatus.manage`                            | Delete a note              |

### Equipment, fuel, photos and documents

| Method   | Path                                      | Permission                                    | Description               |
| -------- | ----------------------------------------- | --------------------------------------------- | ------------------------- |
| `GET`    | `/equipment`                              | `apparatus.view` / `.manage`                  | List equipment            |
| `POST`   | `/equipment`                              | `apparatus.edit` / `.manage`                  | Add equipment             |
| `PATCH`  | `/equipment/{equipment_id}`               | `apparatus.edit` / `.manage`                  | Update equipment          |
| `DELETE` | `/equipment/{equipment_id}`               | `apparatus.manage`                            | Remove equipment          |
| `GET`    | `/fuel-logs`                              | `apparatus.view` / `.manage`                  | List fuel entries         |
| `POST`   | `/fuel-logs`                              | `apparatus.maintenance` / `.edit` / `.manage` | Create a fuel entry       |
| `GET`    | `/{apparatus_id}/photos`                  | `apparatus.view` / `.manage`                  | List photos               |
| `POST`   | `/{apparatus_id}/photos`                  | `apparatus.edit` / `.manage`                  | Add a photo               |
| `DELETE` | `/{apparatus_id}/photos/{photo_id}`       | `apparatus.manage`                            | Delete a photo            |
| `GET`    | `/{apparatus_id}/documents`               | `apparatus.view` / `.manage`                  | List documents            |
| `POST`   | `/{apparatus_id}/documents`               | `apparatus.edit` / `.manage`                  | Add a document            |
| `DELETE` | `/{apparatus_id}/documents/{document_id}` | `apparatus.manage`                            | Delete a document         |
| `GET`    | `/{apparatus_id}/folders`                 | `apparatus.view` / `.manage`                  | Document folder structure |

### NFPA compliance

| Method   | Path                               | Permission                   | Description                                |
| -------- | ---------------------------------- | ---------------------------- | ------------------------------------------ |
| `GET`    | `/nfpa-settings`                   | `apparatus.view` / `.manage` | Whether this department tracks NFPA        |
| `GET`    | `/nfpa-compliance`                 | `apparatus.view` / `.manage` | List compliance records                    |
| `GET`    | `/nfpa-compliance/{compliance_id}` | `apparatus.view` / `.manage` | Get one record                             |
| `POST`   | `/nfpa-compliance`                 | `apparatus.edit` / `.manage` | Create a record                            |
| `PATCH`  | `/nfpa-compliance/{compliance_id}` | `apparatus.edit` / `.manage` | Update a record                            |
| `DELETE` | `/nfpa-compliance/{compliance_id}` | `apparatus.manage`           | Delete a record                            |
| `GET`    | `/{apparatus_id}/nfpa-summary`     | `apparatus.view` / `.manage` | Required tests and items for one apparatus |

### Operators, EVOC and driver exceptions

| Method             | Path                                       | Permission                                                             | Description                           |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------- |
| `GET`              | `/operators`                               | `apparatus.view` / `.manage`                                           | List operators                        |
| `POST`             | `/operators`                               | `apparatus.manage`                                                     | Add an operator                       |
| `PATCH` / `DELETE` | `/operators/{operator_id}`                 | `apparatus.manage`                                                     | Update / remove an operator           |
| `GET`              | `/evoc-levels`                             | `apparatus.view` / `.manage`                                           | List the EVOC ladder                  |
| `GET`              | `/evoc-levels/{level_id}`                  | `apparatus.view` / `.manage`                                           | Get one level                         |
| `POST`             | `/evoc-levels`                             | `apparatus.manage`                                                     | Create a level                        |
| `PATCH` / `DELETE` | `/evoc-levels/{level_id}`                  | `apparatus.manage`                                                     | Update / delete a level               |
| `GET`              | `/evoc-check/{apparatus_id}/{user_id}`     | `apparatus.view` / `scheduling.view`                                   | Does this member qualify to drive it? |
| `GET`              | `/driver-exceptions`                       | `apparatus.view` / `.manage` / `scheduling.view` / `scheduling.manage` | List exceptions                       |
| `POST`             | `/driver-exceptions`                       | `scheduling.assign` / `scheduling.manage` / `apparatus.manage`         | Request an exception                  |
| `GET`              | `/driver-exceptions/approvers`             | **authenticated**                                                      | Who can approve one — see Edge Cases  |
| `POST`             | `/driver-exceptions/{exception_id}/review` | `apparatus.approve_driver_exception`                                   | Approve or deny                       |
| `POST`             | `/driver-exceptions/{exception_id}/revoke` | `apparatus.approve_driver_exception`                                   | Revoke an approved exception          |

### Service providers and report configs

| Method             | Path                                       | Permission                   | Description                     |
| ------------------ | ------------------------------------------ | ---------------------------- | ------------------------------- |
| `GET`              | `/service-providers`                       | `apparatus.view` / `.manage` | List providers                  |
| `GET`              | `/service-providers/{provider_id}`         | `apparatus.view` / `.manage` | Get one provider                |
| `POST`             | `/service-providers`                       | `apparatus.edit` / `.manage` | Create a provider               |
| `PATCH`            | `/service-providers/{provider_id}`         | `apparatus.edit` / `.manage` | Update a provider               |
| `POST`             | `/service-providers/{provider_id}/archive` | `apparatus.manage`           | Archive (soft-delete)           |
| `POST`             | `/service-providers/{provider_id}/restore` | `apparatus.manage`           | Restore an archived provider    |
| `GET`              | `/report-configs`                          | `apparatus.view` / `.manage` | List report configurations      |
| `GET`              | `/report-configs/{config_id}`              | `apparatus.view` / `.manage` | Get one configuration           |
| `POST`             | `/report-configs`                          | `apparatus.manage`           | Create a configuration          |
| `PATCH` / `DELETE` | `/report-configs/{config_id}`              | `apparatus.manage`           | Update / delete a configuration |

---

## Permissions

| Permission                           | Who is expected to hold it   | What it allows                                                            |
| ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `apparatus.view`                     | Any member                   | Read the fleet and its sub-resources                                      |
| `apparatus.create`                   | Fleet officers               | Create an apparatus (`apparatus.manage` also satisfies it)                |
| `apparatus.edit`                     | Fleet officers               | Update an apparatus and add sub-resources (equipment, photos, NFPA items) |
| `apparatus.maintenance`              | Mechanics, apparatus crew    | Create and update maintenance records, component notes and fuel logs      |
| `apparatus.manage`                   | Fleet administrators         | Everything, including every delete and all configuration tables           |
| `apparatus.approve_driver_exception` | Chiefs / designated officers | Approve, deny and revoke driver exceptions                                |

Two scheduling permissions also appear as alternatives on the cross-module
routes: `scheduling.view` (read the EVOC check and the exception list),
`scheduling.assign` / `scheduling.manage` (request an exception while filling a
shift).

**Deletes are consistently `apparatus.manage`.** The split between
`.maintenance`, `.edit` and `.manage` is about who may _add and amend_
day-to-day records versus who may remove them or reshape the configuration
tables; a mechanic can log work without being able to delete the vehicle.

---

## Data Flows

### Maintenance lifecycle

```
Maintenance type defined (with default intervals)
  → Record created (due_date, or occurred_date for a historic entry)
  → is_overdue stamped at write time if already past due
  → Daily task re-stamps it as the due date passes   (see Edge Cases)
  → Completed (completed_by, completed_date; is_overdue cleared)
  → Appears in /maintenance/due until completed
```

### EVOC driver eligibility

```
evoc_levels seeded per org (NFPA 1451-style ladder, levels 1-4, cumulative)
  → Apparatus optionally sets required_evoc_level_id
  → Member holds apparatus_operators rows (level, certified, expiry)
  → Scheduling asks check_driver_evoc_eligibility(user, apparatus, on_date)
      · on_date is the SHIFT's date, not today — a card that lapses before
        the shift does not qualify anyone to drive it
      · every level held is considered, not just the highest: a cumulative
        level 3 covers a level 2 apparatus even if the member also holds a
        non-cumulative 4
      · the lowest qualifying level is reported, since that is the one relied on
  → Not eligible → warning on the shift, and a driver exception is the way round
```

### Driver exception workflow

```
Request (scheduling.assign / scheduling.manage / apparatus.manage)
  → status: pending, with a reason (parade, special_event, …) and a date range
  → Approver list is readable by any member — a blocked member needs to know
    who to ask
  → Review (apparatus.approve_driver_exception) → approved | denied
  → Revoke (apparatus.approve_driver_exception) → revoked, before the end date
```

### Cross-module integration

| Module          | Integration                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Scheduling      | Consumes `check_driver_evoc_eligibility` when seating a driver; requests driver exceptions                           |
| Equipment-check | Check templates and compartments live in `models/apparatus.py` and attach to an apparatus                            |
| Training        | `evoc_levels.training_program_id` links a level to the program that confers it; completing it can auto-add operators |
| Scheduled tasks | `run_mark_overdue_maintenance` re-stamps overdue maintenance daily, per organization                                 |
| Labels          | `ApparatusLabelPrintPage` feeds the shared label-printing module                                                     |
| Inventory / NFC | Apparatus is one of the scan targets for NFC tags                                                                    |

---

## Configuration

### Module availability

Controlled per organization at runtime via the organization's `enabled_modules`
setting (**Organization/Admin Settings → Modules**). There is no
deployment-level environment flag; the API routers register unconditionally.

### NFPA tracking

`GET /nfpa-settings` reports whether the department tracks NFPA apparatus
compliance. The frontend's `NfpaDepartmentSwitch` toggles it, and the NFPA tab
hides itself when it is off.

### Dates are the department's, not the server's

Every calendar-day decision in this module — the disposal date, the overdue
comparison, maintenance completion dates, the 30-day registration / inspection /
insurance expiry windows, the 12-month service-report cutoff and the EVOC
`as_of` date — resolves through `resolve_org_today(db, organization_id)`, so a
department's day ends on its own clock. Timestamps (`status_changed_at`,
`archived_at`, …) remain UTC `datetime.now(timezone.utc)`. Do not reintroduce a
bare `date.today()` here.

---

## Edge Cases

| Scenario                                              | Behavior                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /{apparatus_id}`                              | **Hard delete.** Use `POST /{apparatus_id}/archive` for a retired vehicle. See the warning below — a hard delete has a live consequence.                             |
| Apparatus with no `required_evoc_level_id`            | Everyone is eligible to drive it; the EVOC check returns eligible with no required level                                                                             |
| EVOC check on an apparatus that cannot be resolved    | Returns **eligible** and logs a warning. This is the open **AP2-4** decision — see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)                                    |
| Member's EVOC certification expired                   | Not eligible — `is_certified` and `certification_expiration >= as_of` are both required                                                                              |
| Member holds a higher non-cumulative level only       | Not eligible for a lower-level apparatus unless they also hold a cumulative level that covers it, or an exact match                                                  |
| Maintenance entered with a future due date            | `is_overdue` is `False` at write time and re-stamped by the daily task once the date passes; the due list keys off `due_date` regardless                             |
| Historic maintenance record                           | `occurred_date` is required; a completed historic record is never flagged overdue                                                                                    |
| `GET /driver-exceptions/approvers` with no permission | Readable by **any** authenticated member, deliberately: a member refused the driver seat needs to know who to ask. Returns names and ranks only — no contact details |
| Deleting an apparatus type or status still in use     | Refused with a 400 naming the number of apparatus using it                                                                                                           |
| Component deleted                                     | Archived (soft-delete), not removed — its note history survives                                                                                                      |
| Service provider archived                             | Hidden from pickers but restorable; existing maintenance records keep pointing at it                                                                                 |
| A foreign-organization id in any FK                   | Refused with a 400 (`Invalid EVOC level`, `Invalid component`, …) — every client-supplied FK is validated in-org before storage                                      |
| `MaintenanceType.default_interval_*` set              | **Stored, not read.** Completing a maintenance record does not schedule the next one; recurrence is manual. See Known Gaps                                           |

> ⚠️ **A hard-deleted apparatus leaves dangling references.**
> `shifts.apparatus_id` is an unconstrained `String(36)` with no foreign key, so
> deleting an apparatus does not clear it from the shifts that referenced it.
> Those shifts then reach the EVOC check with an id that resolves to nothing,
> and the requirement stops being enforced — currently with a logged warning and
> no user-visible signal. Prefer **archive** over delete. Tracked as **AP2-4** in
> [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

---

## Known Gaps

| Gap                                                     | Detail                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **AP2-4** — EVOC gate fails open on a missing apparatus | Owner decision pending: fail closed, or give `shifts.apparatus_id` a real `SET NULL` foreign key. See KNOWN_LIMITATIONS.md |
| Maintenance intervals are not scheduled                 | `default_interval_value` / `_unit` / `_miles` / `_hours` exist on `apparatus_maintenance_types` and nothing reads them     |
| Sub-resource business logic is unreviewed               | Fuel logs, equipment, photos/documents and custom fields have verified tenancy invariants but no depth review              |

---

## Troubleshooting

| Issue                                              | Cause                                                                       | Fix                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Module not visible in navigation                   | Module not enabled for the organization                                     | Enable Apparatus in Organization/Admin Settings → Modules (`enabled_modules`)                                     |
| A member cannot be seated as a driver              | Apparatus requires an EVOC level the member does not hold or has let expire | Check `GET /evoc-check/{apparatus_id}/{user_id}`; add or renew the operator record, or request a driver exception |
| EVOC requirement seems not to apply at all         | The shift points at a deleted apparatus (AP2-4)                             | Search the logs for `EVOC eligibility: apparatus … not found`; re-point or clear the shift's apparatus            |
| Overdue maintenance count reads low                | `is_overdue` is stamped at write time                                       | `run_mark_overdue_maintenance` re-stamps daily; the due list itself keys off `due_date` and is correct meanwhile  |
| NFPA tab missing                                   | Department NFPA tracking is off                                             | Toggle it with `NfpaDepartmentSwitch`, backed by `GET /nfpa-settings`                                             |
| "Invalid EVOC level" / "Invalid component" on save | A client-supplied FK does not belong to the caller's organization           | Re-select the value from the in-app dropdown rather than passing an id directly                                   |
| Cannot delete a type or status                     | Apparatus still reference it                                                | Reassign those apparatus first; the error names the count                                                         |
| Frontend field reads `undefined`                   | This module serializes **camelCase**                                        | Match the alias (`unitNumber`, not `unit_number`) — see the casing note under Architecture                        |

---

## Review History

Reviewed by the application-review rotation as **B2** (prefix `AP2`): passes 1–2
(2026-08-06), 3–4 (2026-08-09), 5 (2026-10-05). Findings and verified-good
claims are in [docs/app-review/apparatus.md](./app-review/apparatus.md); the
original security audit is in
[docs/module-audit/apparatus.md](./module-audit/apparatus.md).
