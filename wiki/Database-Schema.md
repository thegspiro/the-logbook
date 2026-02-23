# Database Schema

The Logbook uses MySQL 8.0+ (MariaDB 10.11+ for ARM) with SQLAlchemy ORM and Alembic migrations.

---

## Core Tables

### Users & Authentication

| Table | Description |
|-------|-------------|
| `users` | Member profiles (name, email, rank, station, membership_number, status) |
| `roles` | System roles and custom positions |
| `user_roles` | Many-to-many: user ↔ role mapping |
| `permissions` | Granular permission definitions |
| `role_permissions` | Many-to-many: role ↔ permission mapping |
| `organizations` | Multi-tenant organization records |
| `refresh_tokens` | JWT refresh token storage |

### Audit & Security

| Table | Description |
|-------|-------------|
| `audit_logs` | Tamper-proof audit trail with SHA-256 hash chain |
| `notification_logs` | In-app and email notification records |
| `security_alerts` | Intrusion detection and security event alerts |

---

## Module Tables

### Training

| Table | Description |
|-------|-------------|
| `training_records` | Individual training completions (with `rank_at_completion`, `station_at_completion`) |
| `training_courses` | Course definitions and categories |
| `training_requirements` | Department training requirements (hours, shifts, calls, certs) |
| `training_programs` | Structured multi-phase training curricula |
| `program_phases` | Phases within a training program |
| `program_enrollments` | Member enrollments in training programs |
| `training_waivers` | Training requirement waivers (auto-linked from LOA or manual) |
| `training_submissions` | Self-reported training pending review |
| `shift_completion_reports` | Post-shift training reports filed by officers |

### Membership

| Table | Description |
|-------|-------------|
| `member_leaves_of_absence` | Leave records with `exempt_from_training_waiver` and `linked_training_waiver_id` |
| `membership_tiers` | Tier definitions with benefits and advancement rules |

### Events

| Table | Description |
|-------|-------------|
| `events` | Event records with recurrence, reminders, and location |
| `event_attendees` | RSVP and attendance tracking |
| `event_attachments` | Files attached to events |

### Scheduling

| Table | Description |
|-------|-------------|
| `shifts` | Shift definitions with date, time, and location |
| `shift_assignments` | Member assignments to shifts with positions |
| `shift_templates` | Reusable shift configurations |
| `shift_patterns` | Patterns for bulk shift generation |
| `swap_requests` | Shift swap requests |
| `time_off_requests` | Time-off requests |
| `basic_apparatus` | Lightweight vehicle records for scheduling |

### Inventory

| Table | Description |
|-------|-------------|
| `inventory_items` | Equipment items (individual or pool, with `tracking_type`) |
| `inventory_categories` | Item categories |
| `item_assignments` | Member ↔ item assignments |
| `item_issuances` | Pool item issue/return records |
| `inventory_checkouts` | Checkout/return tracking with `expected_return_at` |
| `departure_clearances` | Departure clearance records |
| `clearance_line_items` | Individual items in a departure clearance |
| `maintenance_records` | Equipment maintenance history |

### Elections

| Table | Description |
|-------|-------------|
| `elections` | Election definitions with voting period |
| `candidates` | Election candidates |
| `ballots` | Encrypted ballot records |
| `election_packages` | Auto-generated from prospective member pipeline |

### Meeting Minutes & Documents

| Table | Description |
|-------|-------------|
| `meeting_minutes` | Minutes records with status workflow |
| `minute_sections` | Content sections within minutes |
| `minute_templates` | Meeting type templates |
| `documents` | File storage with metadata |
| `document_folders` | Folder hierarchy |

### Forms

| Table | Description |
|-------|-------------|
| `forms` | Form definitions with status and category |
| `form_fields` | Field definitions with type and validation |
| `form_submissions` | Submitted form data |

### Prospective Members

| Table | Description |
|-------|-------------|
| `pipelines` | Application pipeline configurations |
| `pipeline_stages` | Stages within pipelines |
| `applicants` | Prospective member records |

### Facilities

| Table | Description |
|-------|-------------|
| `facilities` | Building/facility records |
| `locations` | Stations, rooms, addresses |
| `maintenance_schedules` | Facility maintenance scheduling |

---

## Migrations

Migrations are managed by Alembic. Migration files are in `backend/alembic/versions/`.

### Running Migrations
```bash
docker-compose exec backend alembic upgrade head
```

### Checking Current Version
```bash
docker-compose exec backend alembic current
```

### Migration Naming Convention
Files follow the pattern: `YYYYMMDD_HHMM_description.py`

---

## Multi-Tenancy

All data is scoped by `organization_id`. Key constraints:
- Unique constraints are org-scoped (e.g., `UniqueConstraint("organization_id", "barcode")`)
- All queries filter by the current user's organization
- Cross-org data access is prevented at the service layer

---

**See also:** [Backend Development](Development-Backend) | [API Reference](API-Reference)
