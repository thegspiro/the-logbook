# Apparatus Module

The Apparatus module manages department vehicles, equipment assignments, maintenance tracking, and crew positions. It offers both a full module and a lightweight "Basic" alternative.

---

## Key Features

### Full Apparatus Module
- **Vehicle Management** — Complete CRUD for department apparatus (engines, ladders, rescues, ambulances, etc.)
- **Crew Positions** — Define crew positions per vehicle type with minimum staffing requirements
- **Maintenance Tracking** — Schedule and track vehicle maintenance, inspections, and repairs
- **Equipment Assignments** — Track what equipment is assigned to each vehicle
- **Status Tracking** — In-service, out-of-service, maintenance, reserve statuses
- **NFPA Compliance** — Track compliance with NFPA standards for apparatus

### Apparatus Basic (Lightweight)
- **Simple Vehicle List** — Unit numbers, names, and types
- **Crew Positions** — Define crew positions per vehicle
- **Shift Integration** — Vehicles appear in shift creation dropdown
- **No Full Module Required** — Available when the full Apparatus module is disabled

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/apparatus` | Apparatus List | Authenticated |
| `/apparatus/new` | Add Apparatus | Authenticated |
| `/apparatus/:id` | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus | Authenticated |
| `/apparatus-basic` | Apparatus Basic | Authenticated |

> `/apparatus-basic` is the lightweight alternative used when the full Apparatus module is disabled. The side navigation automatically shows the correct link.

---

## API Endpoints

### Full Module
```
GET    /api/v1/apparatus                     # List apparatus
POST   /api/v1/apparatus                     # Create apparatus
GET    /api/v1/apparatus/{id}                # Get details
PATCH  /api/v1/apparatus/{id}                # Update
DELETE /api/v1/apparatus/{id}                # Delete
```

### Basic (Scheduling Integration)
```
GET    /api/v1/scheduling/apparatus          # List basic apparatus
POST   /api/v1/scheduling/apparatus          # Create basic apparatus
PATCH  /api/v1/scheduling/apparatus/{id}     # Update basic apparatus
DELETE /api/v1/scheduling/apparatus/{id}     # Delete basic apparatus
```

---

**See also:** [Scheduling Module](Module-Scheduling) | [Inventory Module](Module-Inventory)
