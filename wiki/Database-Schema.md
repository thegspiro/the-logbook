# Database Schema

The Logbook uses MySQL 8.0+ (MariaDB 10.11+ for ARM) with SQLAlchemy ORM and Alembic migrations.

---

## Core Tables

### Users & Authentication

| Table | Description |
|-------|-------------|
| `users` | Member profiles (name, email, rank, station, membership_number, status). `oauth_provider` (String(50), nullable) and `oauth_subject` (String(255), nullable, indexed `ix_users_oauth_subject`) bind an external IdP identity for OAuth sign-in *(2026-05-29)* |
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
| `notification_rules` | Notification rule definitions with trigger, category, channel, and config *(2026-03-23)* |
| `notification_logs` | In-app and email notification records with action_url, expiry, and `metadata` JSON column for structured context (shift_id, shift_date, checklist_count, etc.) *(updated 2026-03-26)* |
| `department_messages` | Internal department messages with targeting, priority, and `is_persistent` flag *(2026-03-23)* |
| `department_message_reads` | Per-user read/acknowledged tracking for department messages *(2026-03-23)* |
| `security_alerts` | Intrusion detection and security event alerts |

---

## Module Tables

### Training

| Table | Description |
|-------|-------------|
| `training_records` | Individual training completions (with `rank_at_completion`, `station_at_completion`) |
| `training_categories` | Course categories with optional `registry_code` for NREMT NCCR linkage *(2026-04-11)* |
| `training_courses` | Course definitions and categories |
| `training_requirements` | Department training requirements (hours, shifts, calls, certs). `include_current_month` (Bool, nullable) is a per-requirement evaluation-period override — `NULL` inherits the org default, `true`/`false` explicit *(2026-05-29)* |
| `training_programs` | Structured multi-phase training curricula |
| `program_phases` | Phases within a training program |
| `program_enrollments` | Member enrollments in training programs |
| `training_waivers` | Training requirement waivers (auto-linked from LOA or manual) |
| `training_submissions` | Self-reported training pending review |
| `shift_completion_reports` | Post-shift training reports with encrypted evaluation fields, review workflow (`draft`/`pending_review`/`approved`/`flagged`), trainee acknowledgment, skills observed, tasks performed, call type tracking, pipeline progress linkage, and audit trail (`data_sources`) *(updated 2026-03-28)* |
| `training_module_configs` | Module configuration including trainee visibility settings (`show_*`), report form section toggles (`form_show_*`), per-apparatus-type skills/tasks mappings, rating scale customization, shift review defaults, and manual entry settings (`manual_entry_enabled`, `manual_entry_apparatus_types`) *(updated 2026-04-11)* |
| `external_training_imports` | Individual import records with status and `credit_hours` for CE credit preservation *(updated 2026-04-11)* |
| `compliance_configs` | Per-org compliance configuration. `include_current_month` (Bool, NOT NULL, default `true`) controls whether the in-progress month counts toward compliance windows *(2026-05-29)* |

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
| `shifts` | Shift definitions with date, time, location, finalization state (`is_finalized`, `finalized_at`, `finalized_by`), and aggregate snapshots (`call_count`, `total_hours`) *(updated 2026-03-28)* |
| `shift_attendance` | Member attendance records with clock-in/out times, duration, and per-member `call_count` snapshot *(updated 2026-03-28)* |
| `shift_calls` | Incident/call records linked to shifts with `responding_members` JSON array |
| `shift_assignments` | Member assignments to shifts with positions |
| `shift_templates` | Reusable shift configurations |
| `shift_patterns` | Patterns for bulk shift generation |
| `swap_requests` | Shift swap requests |
| `time_off_requests` | Time-off requests |
| `basic_apparatus` | Lightweight vehicle records for scheduling |
| `equipment_check_templates` | Master equipment check templates with timing and position assignment *(2026-03-19)* |
| `check_template_compartments` | Named sections within a template, nested via `parent_compartment_id` *(2026-03-19)* |
| `check_template_items` | Individual check items with type, expiration, serial/lot tracking *(2026-03-19)* |
| `shift_equipment_checks` | Submitted check records linked to shifts; `shift_id` nullable for standalone ad-hoc checks; composite indexes on `(shift_id, template_id)` *(updated 2026-04-04)* |
| `shift_equipment_check_items` | Individual item results within a submitted check *(2026-03-19)* |

### Inventory

| Table | Description |
|-------|-------------|
| `inventory_items` | Equipment items (individual or pool, with `tracking_type`). Barcodes are per-organization sequential numbers (`INV-000001` …) assigned at creation time; the prefix/counter live in `organizations.settings["barcode"]` *(2026-06-10)* |
| `inventory_categories` | Item categories |
| `item_assignments` | Member ↔ item assignments |
| `item_issuances` | Pool item issue/return records |
| `issuance_allowances` | Per-category issue caps by role and period (`max_quantity`, `period_type` annual/career/one_time; `role_id` NULL = all members). Unique `(organization_id, category_id, role_id)`. Surfaced via the Allowances admin page *(wired 2026-06-09; table since 20260304_0300)* |
| `inventory_checkouts` | Checkout/return tracking with `expected_return_at` |
| `departure_clearances` | Departure clearance records |
| `clearance_line_items` | Individual items in a departure clearance |
| `maintenance_records` | Equipment maintenance history |
| `nfpa_inspection_details` | Structured NFPA 1851 inspection results, one-to-one with a `maintenance_record` (assessment booleans, contamination level, SCBA fields, recommendation) |
| `equipment_requests` | Member equipment request/approval workflow. Terminal `fulfilled` state added via `fulfilled_by` / `fulfilled_at` / `fulfillment_type` / `fulfillment_reference_id` *(2026-06-09)* |
| `inventory_write_offs` | Write-off request/approval workflow |
| `inventory_notification_queue` | Delayed notification consolidation queue. `attempt_count` (Integer, NOT NULL, default `0`) and `last_attempt_at` (DateTime(tz), nullable) track delivery retries *(2026-05-29)* |
| `property_return_reminders` | Tracks reminder notices sent to departed members |
| `storage_areas` | Hierarchical storage locations (linked to facility rooms) |
| `variant_groups` | Groups related items by size/style *(2026-03-07)* |
| `equipment_kits` | Named item bundles for single-operation issuance *(2026-03-07)* |
| `equipment_kit_items` | Component items within a kit *(2026-03-07)* |
| `member_size_preferences` | Garment size preferences per member *(2026-03-07)* |
| `reorder_requests` | Reorder request lifecycle (pending → received) *(2026-03-07)* |

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
| `pipelines` | Application pipeline configurations. FK indexes added on `created_by` *(2026-04-11)* |
| `pipeline_stages` | Stages within pipelines. FK index added on `email_template_id` *(2026-04-11)* |
| `applicants` | Prospective member records |
| `prospect_documents` | Applicant documents. FK index added on `uploaded_by` *(2026-04-11)* |

### Facilities

| Table | Description |
|-------|-------------|
| `facilities` | Building/facility records with type, status, NFPA fields |
| `facility_types` | Facility type definitions (Fire Station, EMS Station, etc.) |
| `facility_statuses` | Facility status definitions (Operational, Under Construction, etc.) |
| `facility_rooms` | Rooms within facilities with NFPA 1500/1585 zone classification |
| `facility_systems` | Building systems (HVAC, fire suppression, 8 fire-critical types) |
| `facility_inspections` | Inspection records with inspector, findings, corrective actions |
| `facility_maintenance` | Maintenance work orders with 16 NFPA-aligned types |
| `facility_utilities` | Utility accounts and monthly usage readings |
| `facility_emergency_contacts` | Building-specific emergency contacts |
| `facility_compliance_items` | Compliance checklists (fire code, ADA, etc.) |
| `locations` | Stations, rooms, addresses (auto-synced from facility rooms) |

### Grants & Fundraising

| Table | Description |
|-------|-------------|
| `grants` | Grant application records (AFG, SAFER, FP&S, USDA) |
| `grant_notes` | Notes attached to grants |
| `fundraising_campaigns` | Campaign records with goal tracking |
| `donors` | Donor management mini-CRM |

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

## Organization Settings JSON Structure (email_service)

The `organizations.settings` JSON column stores email platform configuration under the `email_service` key. No database migration is needed when adding new email platforms — the JSON structure is flexible. Secret fields are AES-256 encrypted (prefixed with `enc:`).

| Field | Type | Platforms | Description |
|-------|------|-----------|-------------|
| `enabled` | boolean | all | Whether org-specific email config is active |
| `platform` | string | all | `gmail`, `microsoft`, `selfhosted`, `cloudflare`, or `other` |
| `from_email` | string | all | Sender email address |
| `from_name` | string | all | Sender display name |
| `smtp_host` | string | gmail, microsoft, selfhosted | SMTP server hostname |
| `smtp_port` | integer | gmail, microsoft, selfhosted | SMTP server port |
| `smtp_user` | string | gmail, microsoft, selfhosted | SMTP username |
| `smtp_password` | string (encrypted) | gmail, microsoft, selfhosted | SMTP password |
| `smtp_encryption` | string | gmail, microsoft, selfhosted | `tls`, `ssl`, or `none` |
| `google_client_id` | string | gmail | Google OAuth Client ID |
| `google_client_secret` | string (encrypted) | gmail | Google OAuth Client Secret |
| `google_app_password` | string (encrypted) | gmail | Google App Password (alternative to OAuth) |
| `microsoft_tenant_id` | string | microsoft | Azure AD Tenant ID |
| `microsoft_client_id` | string | microsoft | Azure AD Client ID |
| `microsoft_client_secret` | string (encrypted) | microsoft | Azure AD Client Secret |
| `cloudflare_account_id` | string | cloudflare | Cloudflare Account ID (32-char hex) |
| `cloudflare_api_token` | string (encrypted) | cloudflare | Cloudflare API token with email sending permission |

---

## Recent Schema Changes (2026-04-04)

### New Columns

| Table | Column | Type | Migration | Description |
|-------|--------|------|-----------|-------------|
| `training_module_configs` | `form_show_performance_rating` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle performance rating section on report creation form |
| `training_module_configs` | `form_show_areas_of_strength` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle strengths section on report creation form |
| `training_module_configs` | `form_show_areas_for_improvement` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle improvement section on report creation form |
| `training_module_configs` | `form_show_officer_narrative` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle narrative section on report creation form |
| `training_module_configs` | `form_show_skills_observed` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle skills section on report creation form |
| `training_module_configs` | `form_show_tasks_performed` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle tasks section on report creation form |
| `training_module_configs` | `form_show_call_types` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle call types section on report creation form |
| `training_module_configs` | `apparatus_type_skills` | JSON (nullable) | `20260404_0300` | Per-apparatus-type skill lists for shift reports |
| `training_module_configs` | `apparatus_type_tasks` | JSON (nullable) | `20260404_0300` | Per-apparatus-type task lists for shift reports |
| `requirement_progress` | `started_at` | DateTime(tz, nullable) | `20260404_0500` | Timestamp when requirement transitions to IN_PROGRESS |

### Column Modifications

| Table | Column | Change | Migration | Reason |
|-------|--------|--------|-----------|--------|
| `shift_equipment_checks` | `shift_id` | Made nullable | `20260404_0100` | Support standalone ad-hoc equipment checks without an active shift |

### New Indexes

| Table | Index | Columns | Migration |
|-------|-------|---------|-----------|
| `shift_equipment_checks` | Composite | `(shift_id, template_id)` | `20260404_0400` |
| `shift_equipment_check_items` | Composite | `(check_id, template_item_id)` | `20260404_0400` |
| `shift_assignments` | `idx_shift_assign_shift_status` | `(shift_id, assignment_status)` | `20260604_0001` |

---

## Recent Schema Changes (2026-06-10)

### New Columns

| Table | Column | Type | Migration | Description |
|-------|--------|------|-----------|-------------|
| `positions` | `settings` | JSON (nullable) | `20260610_0002` | Per-position UI preferences; holds `label_presets` keyed by module (the label printer/size a role uses in each module, e.g. inventory) |

---

## Recent Schema Changes (2026-06-09)

### New Columns

| Table | Column | Type | Migration | Description |
|-------|--------|------|-----------|-------------|
| `equipment_requests` | `fulfilled_by` | String(36), FK users (SET NULL, nullable) | `20260604_0100` | Quartermaster who fulfilled the approved request |
| `equipment_requests` | `fulfilled_at` | DateTime(tz, nullable) | `20260604_0100` | When the request was fulfilled |
| `equipment_requests` | `fulfillment_type` | String(20, nullable) | `20260604_0100` | `issuance` \| `checkout` \| `assignment` |
| `equipment_requests` | `fulfillment_reference_id` | String(36, nullable) | `20260604_0100` | ID of the created `ItemIssuance` / `CheckOutRecord` / `ItemAssignment` |

### New Indexes

| Table | Index | Columns | Migration |
|-------|-------|---------|-----------|
| `shift_assignments` | `idx_shift_assign_shift_status` | `(shift_id, assignment_status)` | `20260604_0001` |

### Data Backfills

| Table | Change | Migration | Reason |
|-------|--------|-----------|--------|
| `inventory_items` | Backfill barcodes for legacy rows | `20260604_0200` | Removes a write-on-read in the list endpoint (superseded by `20260610_0001`) |
| `inventory_items` / `organizations` | Reassign sequential `INV-000001` barcodes; seed per-org counter in `settings["barcode"]` | `20260610_0001` | Single sequential barcode scheme; also merges the two open heads |

---

## Recent Schema Changes (2026-05-29)

### New Columns

| Table | Column | Type | Migration | Description |
|-------|--------|------|-----------|-------------|
| `users` | `oauth_provider` | String(50) (nullable) | `20260528_0002` | IdP that owns this identity (`google` / `microsoft`); `NULL` for password-only accounts |
| `users` | `oauth_subject` | String(255) (nullable, indexed) | `20260528_0002` | Provider's stable subject identifier (index `ix_users_oauth_subject`) |
| `compliance_configs` | `include_current_month` | Boolean (NOT NULL, server_default `1`) | `20260503_0001` | Org default: whether the in-progress month counts toward compliance |
| `training_requirements` | `include_current_month` | Boolean (nullable) | `20260503_0002` | Per-requirement override; `NULL` inherits the org default |
| `inventory_notification_queue` | `attempt_count` | Integer (NOT NULL, server_default `0`) | `20260502_0002` | Delivery retry counter |
| `inventory_notification_queue` | `last_attempt_at` | DateTime(tz, nullable) | `20260502_0002` | Timestamp of the last delivery attempt |

### Column Modifications

| Table | Change | Migration | Reason |
|-------|--------|-----------|--------|
| `training_module_configs` | Added `server_default` to the boolean toggle columns; backfilled NULLs to defaults | `20260502_0001` / `20260502_0003` | Ensure non-NULL booleans on fresh inserts and existing rows (config response also coerces NULL `manual_entry_*` booleans to defaults) |
| `training_sessions` | Dropped dead `approval_required` column | `20260502_0004` | Unused — finalize sign-off is governed solely by `require_completion_confirmation` |

---

**See also:** [Backend Development](Development-Backend) | [API Reference](API-Reference)
