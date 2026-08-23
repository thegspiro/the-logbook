# Database Schema

The Logbook uses MySQL 8.0+ (MariaDB 10.11+ for ARM) with SQLAlchemy ORM and Alembic migrations.

---

## Core Tables

### Users & Authentication

| Table              | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | Member profiles (name, email, rank, station, membership*number, status). `anonymized_at` (DateTime, nullable) records when a departed member's PII was scrubbed by the anonymization workflow *(2026-07-31)_. `oauth_provider` (String(50), nullable) and `oauth_subject` (String(255), nullable, indexed `ix_users_oauth_subject`) bind an external IdP identity for OAuth sign-in _(2026-05-29)\_ |
| `roles`            | System roles and custom positions                                                                                                                                                                                                                                                                                                                                                                   |
| `user_roles`       | Many-to-many: user ↔ role mapping                                                                                                                                                                                                                                                                                                                                                                   |
| `permissions`      | Granular permission definitions                                                                                                                                                                                                                                                                                                                                                                     |
| `role_permissions` | Many-to-many: role ↔ permission mapping                                                                                                                                                                                                                                                                                                                                                             |
| `organizations`    | Multi-tenant organization records                                                                                                                                                                                                                                                                                                                                                                   |
| `refresh_tokens`   | JWT refresh token storage                                                                                                                                                                                                                                                                                                                                                                           |

### Audit & Security

| Table                      | Description                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_logs`               | Tamper-proof audit trail with keyed (HMAC) hash chain. `organization_id` (nullable — platform-level events have no tenant; indexed, no FK, backfilled from `user_id`; migration `20260801_0009`) scopes every read path directly; hash-chain **v3** includes it in the signed input, so tenant attribution on new rows is tamper-evident _(updated 2026-07-30)_ |
| `notification_rules`       | Notification rule definitions with trigger, category, channel, and config _(2026-03-23)_                                                                                                                                                                                                                                                                        |
| `notification_logs`        | In-app and email notification records with action*url, expiry, and `metadata` JSON column for structured context (shift_id, shift_date, checklist_count, etc.) *(updated 2026-03-26)\_                                                                                                                                                                          |
| `department_messages`      | Internal department messages with targeting (roles by id, statuses, or member ids), priority, `is_persistent`, `requires_acknowledgment`, `expires_at`, `deleted_at` (soft delete), and `scheduled_at` (deferred publish) _(updated 2026-07-17)_                                                                                                                |
| `department_message_reads` | Per-user read/acknowledged tracking for department messages (preserved on soft delete as compliance evidence) _(updated 2026-07-17)_                                                                                                                                                                                                                            |
| `security_alerts`          | Intrusion detection and security event alerts. `organization_id` scopes each alert to its owning department (nullable for platform-level pre-auth/IP-only alerts); an org admin only sees/acknowledges/resolves their own org's alerts _(updated 2026-07)_                                                                                                      |
| `audit_ship_state`         | Single-row high-water mark for off-host audit shipping — `last_shipped_id` advances only when the collector acknowledges a batch _(2026-07-31)_                                                                                                                                                                                                                 |
| `user_consents`            | Current consent state per (member, type): `photo_use`, `public_roster_listing`, `sms_notifications`. Unique on (user*id, consent_type); the change history lives in `audit_logs` as `consent_updated` events *(2026-07-31)\_                                                                                                                                    |

---

## Module Tables

### Training

| Table                       | Description                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_records`          | Individual training completions (with `rank_at_completion`, `station_at_completion`)                                                                                                                                                                                                                                                                                       |
| `training_categories`       | Course categories with optional `registry_code` for NREMT NCCR linkage _(2026-04-11)_                                                                                                                                                                                                                                                                                      |
| `training_courses`          | Course definitions and categories. `program_id` (String(36), nullable, FK `training_programs` `SET NULL`) records the pipeline this course's cohorts enrol into _(2026-08-05)_                                                                                                                                                                                             |
| `course_classes`            | Syllabus of a multi-class course — ordered classes, each with a required `class_course_id` (FK `training_courses`, `CASCADE`: the column is NOT NULL so `SET NULL` is illegal) and _relative_ timing (`day_offset`, local `start_time`, `duration_minutes`). Unique `uq_course_class_sequence` on (`course_id`, `sequence`) _(2026-08-05)_                                 |
| `course_cohorts`            | One scheduled run of a multi-class course: `start_date`, `meeting_days` (JSON), `date_roll_policy` (enum), `blackout_dates` (JSON), `program_id` _(2026-08-05)_                                                                                                                                                                                                            |
| `course_cohort_classes`     | A syllabus row materialized onto real UTC datetimes. `event_id` is `SET NULL` + unique (deleting an event must not erase the cohort's record of the class) and `course_class_id` is nullable (ad-hoc classes, and syllabus rows deleted later). Unique `uq_cohort_class_source` on (`cohort_id`, `course_class_id`) is the idempotency key for regeneration _(2026-08-05)_ |
| `course_cohort_members`     | Cohort roster; `enrollment_id` (FK `program_enrollments`, `SET NULL`) ties a member to the ProgramEnrollment tracking their progress. Unique `uq_cohort_member_user` on (`cohort_id`, `user_id`) _(2026-08-05)_                                                                                                                                                            |
| `training_requirements`     | Department training requirements (hours, shifts, calls, certs). `include_current_month` (Bool, nullable) is a per-requirement evaluation-period override — `NULL` inherits the org default, `true`/`false` explicit _(2026-05-29)_                                                                                                                                         |
| `training_programs`         | Structured multi-phase training curricula                                                                                                                                                                                                                                                                                                                                  |
| `program_phases`            | Phases within a training program                                                                                                                                                                                                                                                                                                                                           |
| `program_enrollments`       | Member enrollments in training programs                                                                                                                                                                                                                                                                                                                                    |
| `training_waivers`          | Training requirement waivers (auto-linked from LOA or manual)                                                                                                                                                                                                                                                                                                              |
| `skill_templates`           | Reusable skill-sheet templates (NREMT-style psychomotor sheets). `requirement_id` (String(36), nullable, FK `training_requirements` SET NULL, indexed `idx_skill_template_requirement`) is the default training-pipeline requirement a passing test satisfies _(2026-07-14)_                                                                                               |
| `skill_tests`               | Individual skill-test administrations to a candidate. `requirement_id` (String(36), nullable, FK `training_requirements` SET NULL, indexed `idx_skill_test_requirement`) inherits the template default at creation (overridable per test); a passing non-practice test marks it COMPLETE on the candidate's active enrollment _(2026-07-14)_                               |
| `training_submissions`      | Self-reported training pending review                                                                                                                                                                                                                                                                                                                                      |
| `shift_completion_reports`  | Post-shift training reports with encrypted evaluation fields, review workflow (`draft`/`pending_review`/`approved`/`flagged`), trainee acknowledgment, skills observed, tasks performed, call type tracking, pipeline progress linkage, and audit trail (`data_sources`) _(updated 2026-03-28)_                                                                            |
| `training_module_configs`   | Module configuration including trainee visibility settings (`show_*`), report form section toggles (`form_show_*`), per-apparatus-type skills/tasks mappings, rating scale customization, shift review defaults, and manual entry settings (`manual_entry_enabled`, `manual_entry_apparatus_types`) _(updated 2026-04-11)_                                                 |
| `external_training_imports` | Individual import records with status and `credit_hours` for CE credit preservation _(updated 2026-04-11)_                                                                                                                                                                                                                                                                 |
| `compliance_configs`        | Per-org compliance configuration. `include_current_month` (Bool, NOT NULL, default `true`) controls whether the in-progress month counts toward compliance windows _(2026-05-29)_                                                                                                                                                                                          |

### Membership

| Table                      | Description                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| `member_leaves_of_absence` | Leave records with `exempt_from_training_waiver` and `linked_training_waiver_id` |
| `membership_tiers`         | Tier definitions with benefits and advancement rules                             |

### Events

| Table               | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `events`            | Event records with recurrence, reminders, and location |
| `event_attendees`   | RSVP and attendance tracking                           |
| `event_attachments` | Files attached to events                               |

### Scheduling

| Table                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifts`                      | Shift definitions with date, time, location, finalization state (`is_finalized`, `finalized_at`, `finalized_by`), aggregate snapshots (`call_count`, `total_hours`) _(updated 2026-03-28)_, and `closeout_step` — the close-out wizard's resume point, carrying no entered data _(2026-08-19)_                                                                                                                                                                                |
| `org_calls`                   | **One call the department ran**, counted once however many units rolled _(2026-08-18)_. Date-only `call_date`, org-defined `call_type` slug, `source`, `external_ref` (unique per org, for idempotent dispatch re-sync). Deliberately holds no address, patient identity, narrative, response times, or displayed CAD number                                                                                                                                                  |
| `org_call_responses`          | **One apparatus on one call** _(2026-08-18)_ — the join that makes deduplication work. `shift_id` is **SET NULL** so deleting a shift cannot reduce historical call volume; `apparatus_id` is polymorphic with no FK, exactly like `shifts.apparatus_id`. Unique on (`call_id`, `apparatus_id`)                                                                                                                                                                               |
| `shift_attendance`            | Member attendance records with clock-in/out times, duration, and per-member `call_count` snapshot _(updated 2026-03-28)_                                                                                                                                                                                                                                                                                                                                                      |
| `shift_calls`                 | Incident/call records linked to shifts with `responding_members` JSON array                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shift_assignments`           | Member assignments to shifts with positions                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shift_templates`             | Reusable shift configurations                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `shift_patterns`              | Patterns for bulk shift generation                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `swap_requests`               | Shift swap requests                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `time_off_requests`           | Time-off requests                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `basic_apparatus`             | Lightweight vehicle records for scheduling                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `equipment_check_templates`   | Master equipment check templates with timing and position assignment _(2026-03-19)_                                                                                                                                                                                                                                                                                                                                                                                           |
| `check_template_compartments` | Named sections within a template, nested via `parent_compartment_id` _(2026-03-19)_                                                                                                                                                                                                                                                                                                                                                                                           |
| `check_template_items`        | Individual check items with type, expiration, serial/lot tracking _(2026-03-19)_. Now also the **live** state of a position: `quantity_on_truck` (NULL = never counted, target stands in), `restock_needed` + `restock_reported_by`/`_at`/`_note`, and the `inventory_item_id` catalog link everything hangs off _(2026-08-10)_                                                                                                                                               |
| `check_item_deployed_lots`    | **One row per lot's presence on one position** _(2026-08-10)_. A position's count is the sum of these and its expiration the earliest; lot number and date are snapshotted so a deleted shelf lot does not erase the truck's record                                                                                                                                                                                                                                           |
| `shift_equipment_checks`      | Submitted check records linked to shifts; `shift_id` nullable for standalone ad-hoc checks; composite indexes on `(shift_id, template_id)` _(updated 2026-04-04)_                                                                                                                                                                                                                                                                                                             |
| `shift_equipment_check_items` | Individual item results within a submitted check _(2026-03-19)_. `expiration_found` is the counterpart to `serial_found`/`lot_found` — what the crew read off a replacement unit. _(2026-08-11)_ It is recorded on the check but **no longer written back onto the template item on submit** — a submitter asserting a fresh date could otherwise clear an expired-item auto-fail; the template's authoritative expiration changes only through the manage-level supply flows |

### Inventory

| Table                          | Description                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_items`              | Equipment items (individual or pool, with `tracking_type`). Barcodes are per-organization sequential numbers (`INV-000001` …) assigned at creation time; the prefix/counter live in `organizations.settings["barcode"]` _(2026-06-10)_                                                                     |
| `inventory_lots`               | A dated batch of a consumable held as ready stock (lot number, expiration, quantity, received date). **The source of "on hand" for any item that has lots**; expired lots count as zero, because the equipment-check swap refuses them and counting them would hide the shortage _(documented 2026-08-10)_ |
| `inventory_categories`         | Item categories                                                                                                                                                                                                                                                                                            |
| `item_assignments`             | Member ↔ item assignments                                                                                                                                                                                                                                                                                  |
| `item_issuances`               | Pool item issue/return records                                                                                                                                                                                                                                                                             |
| `issuance_allowances`          | Per-category issue caps by role and period (`max_quantity`, `period_type` annual/career/one*time; `role_id` NULL = all members). Unique `(organization_id, category_id, role_id)`. Surfaced via the Allowances admin page *(wired 2026-06-09; table since 20260304*0300)*                                  |
| `inventory_checkouts`          | Checkout/return tracking with `expected_return_at`                                                                                                                                                                                                                                                         |
| `departure_clearances`         | Departure clearance records                                                                                                                                                                                                                                                                                |
| `clearance_line_items`         | Individual items in a departure clearance                                                                                                                                                                                                                                                                  |
| `maintenance_records`          | Equipment maintenance history                                                                                                                                                                                                                                                                              |
| `nfpa_inspection_details`      | Structured NFPA 1851 inspection results, one-to-one with a `maintenance_record` (assessment booleans, contamination level, SCBA fields, recommendation)                                                                                                                                                    |
| `equipment_requests`           | Member equipment request/approval workflow. Terminal `fulfilled` state added via `fulfilled_by` / `fulfilled_at` / `fulfillment_type` / `fulfillment_reference_id` _(2026-06-09)_                                                                                                                          |
| `inventory_write_offs`         | Write-off request/approval workflow                                                                                                                                                                                                                                                                        |
| `inventory_notification_queue` | Delayed notification consolidation queue. `attempt_count` (Integer, NOT NULL, default `0`) and `last_attempt_at` (DateTime(tz), nullable) track delivery retries _(2026-05-29)_                                                                                                                            |
| `property_return_reminders`    | Tracks reminder notices sent to departed members                                                                                                                                                                                                                                                           |
| `storage_areas`                | Hierarchical storage locations (linked to facility rooms)                                                                                                                                                                                                                                                  |
| `variant_groups`               | Groups related items by size/style _(2026-03-07)_                                                                                                                                                                                                                                                          |
| `equipment_kits`               | Named item bundles for single-operation issuance _(2026-03-07)_                                                                                                                                                                                                                                            |
| `equipment_kit_items`          | Component items within a kit _(2026-03-07)_                                                                                                                                                                                                                                                                |
| `member_size_preferences`      | Garment size preferences per member _(2026-03-07)_                                                                                                                                                                                                                                                         |
| `reorder_requests`             | Reorder request lifecycle (pending → received) _(2026-03-07)_                                                                                                                                                                                                                                              |
| `inventory_impact_plans`       | Saved impact-planner scenarios: `name`, optional `description`, the filter set as `filters` (JSON), `created_by`. Migration `20260622_0001` _(2026-06-23)_                                                                                                                                                 |

### Elections

| Table                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elections`                  | Election definitions: voting period, method, victory condition, runoff/quorum config, per-election anonymity salt (destroyed at close), rollback history. Status ENUM includes the `nominations` phase (`nomination_deadline` auto-closes it); lifecycle automation fields `auto_open`, `reminder_hours_before_close`, `reminder_sent_at` (migration `20260801_0004`/`0005`); `tie_policy` (`co_winners` \| `runoff` \| `revote` \| `chair_decides`) and `eligible_roster_snapshot` (voter roll frozen at open; NULL = legacy live evaluation) via migration `20260801_0008` _(2026-07-29)_ |
| `candidates`                 | Election candidates (member-linked or write-in). Pending third-party nominations are stored as `accepted=False` rows until the nominee accepts; `merged_into_candidate_id` aliases a write-in variant to its consolidation target without mutating signed vote rows (migration `20260801_0008`) _(2026-07-29)_                                                                                                                                                                                                                                                                              |
| `votes`                      | Vote records: HMAC signature, sequential chain hash, unique dedup hash, voter receipt hash, `is_test` flag, soft-delete audit fields. Anonymous votes store only a salted `voter_hash`, never `voter_id`. Paper-tally votes carry `is_manual` + `recorded_by` + `manual_batch_id` (no voter identity or dedup hash; signature covers `is_manual`, so a paper vote can't be re-labeled electronic) — migrations `20260801_0005`/`0006` _(2026-07-29)_                                                                                                                                        |
| `voting_tokens`              | Per-voter email ballot tokens, stored as **SHA-256 hashes** (raw token lives only in the emailed link's URL fragment; migration `20260731_0001`): expiry, usage/access tracking, `is_test` flag, and the voter's eligibility snapshotted at issue time — eligible ballot items (`eligible_item_ids`, migration `20260730_0001`) and eligible positions (`eligible_positions`, migration `20260801_0001`) _(2026-07-29)_                                                                                                                                                                     |
| `manual_ballot_batches`      | One row per recorded paper-ballot tally: recorder, status (`pending` \| `confirmed` \| `voided`), notes, and the attestation requirement **snapshotted at record time** (later setting changes never re-judge old batches). Pending batches' votes are excluded from results/stats. Migration `20260801_0007` _(2026-07-29)_                                                                                                                                                                                                                                                                |
| `manual_ballot_attestations` | Officer attestations of a paper batch; unique `(batch_id, attested_by)` — each officer counts once, and the recorder can never attest their own batch. Migration `20260801_0007` _(2026-07-29)_                                                                                                                                                                                                                                                                                                                                                                                             |
| `saved_ballot_templates`     | Org-scoped reusable ballot snapshots: `name` (display), `name_key` (SHA-256 of the NFKC-casefolded name; unique per org via `uq_saved_ballot_template_org_name_key`, so duplicate names collide case-insensitively), optional `description`, `ballot_items` (JSON — **configuration only, never candidates, voters, votes, tokens, or attendance**), `created_by` (SET NULL so templates outlive their author). Migration `20260812_0001` _(2026-08-12)_                                                                                                                                    |
| `prospect_election_packages` | Auto-generated from prospective member pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Meeting Minutes & Documents

| Table              | Description                          |
| ------------------ | ------------------------------------ |
| `meeting_minutes`  | Minutes records with status workflow |
| `minute_sections`  | Content sections within minutes      |
| `minute_templates` | Meeting type templates               |
| `documents`        | File storage with metadata           |
| `document_folders` | Folder hierarchy                     |

### Forms

| Table              | Description                                |
| ------------------ | ------------------------------------------ |
| `forms`            | Form definitions with status and category  |
| `form_fields`      | Field definitions with type and validation |
| `form_submissions` | Submitted form data                        |

### Prospective Members

| Table                | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `pipelines`          | Application pipeline configurations. FK indexes added on `created_by` _(2026-04-11)_ |
| `pipeline_stages`    | Stages within pipelines. FK index added on `email_template_id` _(2026-04-11)_        |
| `applicants`         | Prospective member records                                                           |
| `prospect_documents` | Applicant documents. FK index added on `uploaded_by` _(2026-04-11)_                  |

### Facilities

| Table                         | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `facilities`                  | Building/facility records with type, status, NFPA fields            |
| `facility_types`              | Facility type definitions (Fire Station, EMS Station, etc.)         |
| `facility_statuses`           | Facility status definitions (Operational, Under Construction, etc.) |
| `facility_rooms`              | Rooms within facilities with NFPA 1500/1585 zone classification     |
| `facility_systems`            | Building systems (HVAC, fire suppression, 8 fire-critical types)    |
| `facility_inspections`        | Inspection records with inspector, findings, corrective actions     |
| `facility_maintenance`        | Maintenance work orders with 16 NFPA-aligned types                  |
| `facility_utilities`          | Utility accounts and monthly usage readings                         |
| `facility_emergency_contacts` | Building-specific emergency contacts                                |
| `facility_compliance_items`   | Compliance checklists (fire code, ADA, etc.)                        |
| `locations`                   | Stations, rooms, addresses (auto-synced from facility rooms)        |

### Grants & Fundraising

| Table                   | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `grants`                | Grant application records (AFG, SAFER, FP&S, USDA) |
| `grant_notes`           | Notes attached to grants                           |
| `fundraising_campaigns` | Campaign records with goal tracking                |
| `donors`                | Donor management mini-CRM                          |

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

The `organizations.settings` JSON column stores email platform configuration under the `email_service` key. No database migration is needed when adding new email platforms — the JSON structure is flexible. Secret fields are AES-256-GCM encrypted (legacy Fernet values still readable).

| Field                     | Type               | Platforms                    | Description                                                  |
| ------------------------- | ------------------ | ---------------------------- | ------------------------------------------------------------ |
| `enabled`                 | boolean            | all                          | Whether org-specific email config is active                  |
| `platform`                | string             | all                          | `gmail`, `microsoft`, `selfhosted`, `cloudflare`, or `other` |
| `from_email`              | string             | all                          | Sender email address                                         |
| `from_name`               | string             | all                          | Sender display name                                          |
| `smtp_host`               | string             | gmail, microsoft, selfhosted | SMTP server hostname                                         |
| `smtp_port`               | integer            | gmail, microsoft, selfhosted | SMTP server port                                             |
| `smtp_user`               | string             | gmail, microsoft, selfhosted | SMTP username                                                |
| `smtp_password`           | string (encrypted) | gmail, microsoft, selfhosted | SMTP password                                                |
| `smtp_encryption`         | string             | gmail, microsoft, selfhosted | `tls`, `ssl`, or `none`                                      |
| `google_client_id`        | string             | gmail                        | Google OAuth Client ID                                       |
| `google_client_secret`    | string (encrypted) | gmail                        | Google OAuth Client Secret                                   |
| `google_app_password`     | string (encrypted) | gmail                        | Google App Password (alternative to OAuth)                   |
| `microsoft_tenant_id`     | string             | microsoft                    | Azure AD Tenant ID                                           |
| `microsoft_client_id`     | string             | microsoft                    | Azure AD Client ID                                           |
| `microsoft_client_secret` | string (encrypted) | microsoft                    | Azure AD Client Secret                                       |
| `cloudflare_account_id`   | string             | cloudflare                   | Cloudflare Account ID (32-char hex)                          |
| `cloudflare_api_token`    | string (encrypted) | cloudflare                   | Cloudflare API token with email sending permission           |

---

## Recent Schema Changes (2026-08-19 → 08-23)

### New Tables

| Table                           | Migration                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legal_document_revisions`      | `20260820_0135_06adc68a8b84` | Governance record for the public `/privacy` and `/terms` wording. `organization_id` (CASCADE), `document_type` (`privacy_policy`/`terms_of_service`), `status` (`draft`/`published`/`archived`), `body`, `change_note` (**NOT NULL** — the reason for a wording change is required at the schema layer, because the point of proposing rather than editing in place is that somebody later can see it), free-text `effective_date` (displayed as "Last updated", **never parsed**), `created_by` and `published_by` (both **SET NULL** — the wording published on a date is a department record and outlives the account that drafted it), `published_at`. Index `ix_legal_revisions_org_type_status` on (`organization_id`, `document_type`, `status`). **The live text is not here** — it stays in `organizations.settings["legal"]`, which is what the anonymous public endpoint reads with no join |
| `equipment_check_bulk_requests` | `20260821_8a4f2d1c9b30`      | Idempotency ledger for bulk check-item creation. `organization_id` (CASCADE), `compartment_id` → `check_template_compartments.id` (CASCADE), `idempotency_key`, `payload_hash`, `item_ids` (JSON). Unique on (`compartment_id`, `idempotency_key`). A retry with the same key **and** the same payload replays `item_ids`; the same key with a _different_ payload is **rejected** rather than quietly creating a second set of items                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### New Columns

| Table                    | Column                 | Type                  | Migration                    | Description                                                                                                                                                                                                           |
| ------------------------ | ---------------------- | --------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shift_equipment_checks` | `client_submission_id` | String(100), nullable | `20260822_1200_a17c4e9d2b61` | Minted **on the client before the request leaves the phone**, which is what makes a queued offline submission safe to retry: the retry resolves to the row the first attempt created instead of adding a second check |

### New Constraints

| Table                    | Constraint                                                                                  | Migration                    | Description                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `shift_equipment_checks` | `uq_shift_equipment_check_shift_template` on (`shift_id`, `template_id`)                    | `20260822_1200_a17c4e9d2b61` | One check per shift per template, as a **database** rule rather than a UI convention |
| `shift_equipment_checks` | `uq_shift_equipment_check_client_submission` on (`organization_id`, `client_submission_id`) | `20260822_1200_a17c4e9d2b61` | Makes a retried offline submission idempotent                                        |

### Column Modifications

| Table               | Change                                     | Migration                             | Reason                                                                                                                                                                  |
| ------------------- | ------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_items`       | `compartment_path` `VARCHAR(200)` → `TEXT` | `d6f4a13c9e20` **and** `4c8d7e2a91b3` | Deep nested storage paths did not fit. **Applied by two separate migrations** (see note below)                                                                          |
| `documents`         | `file_name`, `file_path` → nullable        | `9f6d1c2a4b70`                        | Generated documents have no uploaded file. Repeats a correction that already-upgraded databases would never execute                                                     |
| `events.event_type` | ENUM gains `recruitment`                   | `5223a69474b8`                        | Appended **after** `other`, not inserted mid-list: MySQL stores an ENUM as the member's **ordinal**, so inserting would reassign the type of every event already stored |

### Data-only migrations

| Migration      | What it does                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1eeb053d59b7` | Normalizes `shifts.positions`, `shift_templates.positions`, `basic_apparatus.positions` to `[{"position", "required"}]`. **Not reversible** — it expands a legacy `count` into that many seats, and collapsing it would permanently cut a three-firefighter template to one |
| `7ed8593bc904` | Repeats the storage-area barcode backfill and series counter                                                                                                                                                                                                                |
| `5c2f6a8b1d34` | Creates `push_subscriptions` where it is absent                                                                                                                                                                                                                             |

### Three migrations repair databases that believe they are up to date

`7ed8593bc904`, `5c2f6a8b1d34` and `9f6d1c2a4b70` all exist for the same
reason: an earlier migration was released under one revision id and later
renumbered, so that id now belongs to a **different** migration. A database
upgraded during that window carries a valid Alembic stamp for work that never
ran, and the stamp cannot distinguish the two histories.

The fix repeats the idempotent work downstream under schema inspection. On a
healthy database all three are no-ops.

> **`compartment_path` is widened twice.** `d6f4a13c9e20` and `4c8d7e2a91b3`
> are the same migration on two different parents, and both are reachable.
> Re-application is a no-op, but each `downgrade()` narrows the column back to
> `VARCHAR(200)` — **downgrading past both will truncate deep compartment
> paths.** Tracked as SCHEMA-1 in `docs/KNOWN_LIMITATIONS.md`.

`a17c4e9d2b61` is the head at the time of writing — confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting this
line.

## Recent Schema Changes (2026-08-18 → 08-19)

### New Tables

| Table                | Migration                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_calls`          | `20260818_1200_82bdcb3b1e64` | PII-free call volume. `organization_id` (CASCADE), date-only `call_date`, nullable `call_type` slug, `source` (`manual`/`dispatch`/`derived`, a plain string so a new dispatch vendor needs no migration), nullable `external_ref`, `created_by` (**SET NULL**). Indexes `ix_org_calls_organization_id`, `ix_org_calls_call_date`, `idx_org_call_org_date`; unique `uq_org_call_external_ref` on (`organization_id`, `external_ref`) — org-scoped because two departments on the same CAD share its numbering, and the constraint is what makes a dispatch re-sync idempotent instead of duplicating the day's calls on every poll |
| `org_call_responses` | `20260818_1200_82bdcb3b1e64` | One apparatus's response to one call. `call_id` (CASCADE), `shift_id` (**SET NULL** — deleting a shift must not silently reduce the department's historical volume), polymorphic `apparatus_id` with **no FK** (a department on `basic_apparatus` has no `apparatus.id` to point at, and constraining to one table locks the other out). Unique `uq_call_response_apparatus` on (`call_id`, `apparatus_id`): a unit responds to a given call once, or re-finalizing a shift adds a second run to the tally every time an officer corrects a number                                                                                 |

### New Columns

| Table    | Column          | Type              | Migration                    | Description                                                                                                                                                                                                                        |
| -------- | --------------- | ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifts` | `closeout_step` | Integer, nullable | `20260819_0900_2827079fd66c` | Close-out resume point: `0`/NULL not started, `1` attendance saved, `2` calls saved. **Carries no entered data** — the wizard writes real records as it advances, so this only says which screen to reopen on. Cleared on finalize |

Both revisions are introspection-guarded and additive; neither backfills. An
organization that has never used count-only tracking gets two empty tables and
a NULL column, and every report keeps reading the source it already read.

`2827079fd66c` is the head at the time of writing — confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting this
line.

## Recent Schema Changes (2026-08-10)

### New Tables

| Table                      | Migration       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_item_deployed_lots` | `20260810_0008` | One lot's presence on one checklist position: `template_item_id` (CASCADE), `inventory_lot_id` (**SET NULL** — a depleted shelf lot may be deleted while its units are still on a truck), snapshotted `lot_number` / `expiration_date`, `quantity`, `deployed_at` / `deployed_by`. Indexed `idx_deployed_lot_item_exp` on (`template_item_id`, `expiration_date`), which serves both the drill-in and the first-expiring-first-out consumption order. **Existing single-lot data is migrated across**, so nothing already recorded is lost and every derived count matches what the item reported before |

### New Columns

| Table                         | Column                | Type                                          | Migration       | Description                                                                                                                                                                                                       |
| ----------------------------- | --------------------- | --------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_templates`             | `footer_key`          | String(32), nullable                          | `20260810_0004` | Which named footer this template closes with. **NULL means the department's default**, so changing the default reaches every template that has not overridden it without a data migration                         |
| `shift_equipment_check_items` | `expiration_found`    | Date, nullable                                | `20260810_0005` | What the crew read off a replacement unit. Without it, a field-replaced item kept the old date, was force-failed on every submission, held its apparatus in a deficiency state and never left the supply worklist |
| `check_template_items`        | `restock_needed`      | Boolean, NOT NULL, default `0`                | `20260810_0006` | Raised by whoever used the unit, at the time they used it                                                                                                                                                         |
| `check_template_items`        | `restock_reported_at` | DateTime(tz), nullable                        | `20260810_0006` |                                                                                                                                                                                                                   |
| `check_template_items`        | `restock_reported_by` | String(36), nullable, FK `users` **SET NULL** | `20260810_0006` |                                                                                                                                                                                                                   |
| `check_template_items`        | `restock_note`        | Text, nullable                                | `20260810_0006` |                                                                                                                                                                                                                   |
| `check_template_items`        | `quantity_on_truck`   | Integer, **nullable**                         | `20260810_0007` | The live count. **NULL means nobody has counted since the item was defined** and the target stands in — reading NULL as zero would report every untouched truck as stripped                                       |

### New Indexes

| Table                      | Index                       | Columns                               | Migration       |
| -------------------------- | --------------------------- | ------------------------------------- | --------------- |
| `check_template_items`     | `idx_check_item_restock`    | `restock_needed`                      | `20260810_0006` |
| `check_item_deployed_lots` | `idx_deployed_lot_org`      | `organization_id`                     | `20260810_0008` |
| `check_item_deployed_lots` | `idx_deployed_lot_item`     | `template_item_id`                    | `20260810_0008` |
| `check_item_deployed_lots` | `idx_deployed_lot_item_exp` | `template_item_id`, `expiration_date` | `20260810_0008` |

### Data-only migrations

| Migration       | Effect                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260810_0003` | NULLs `email_templates.css_styles` on rows still holding a **verbatim** copy of one of the two stylesheets ever shipped as a default, so untouched templates start tracking the built-in stylesheet. A department that edited its CSS matches neither string and is left alone. Downgrade re-fills NULLs, so the column is never left NULL for code that predates the fallback |

> **These four check migrations were renumbered from `0003`–`0006` to
> `0005`–`0008`.** `main` landed the email-template pair at `20260810_0003` /
> `_0004` while the branch was open, and both branches had numbered from
> `20260810_0002`. Two revision IDs with two files each is **not a merge conflict
> git can see** — it is a chain Alembic refuses to load, and the backend crashes
> on startup rather than at review. Run `alembic heads` after merging main rather
> than assuming a documented head is current.

**Current head: `20260810_0008`.**

---

## Recent Schema Changes (2026-08-05)

### New Tables

| Table                   | Migration       | Description                                                                                                                                                                                    |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course_classes`        | `20260805_0001` | Multi-class course syllabus. `class_course_id` NOT NULL (`CASCADE`, since `SET NULL` on a NOT NULL column is MySQL error 1830); unique `uq_course_class_sequence` on (`course_id`, `sequence`) |
| `course_cohorts`        | `20260805_0001` | One scheduled run of a multi-class course; enums `cohortstatus` and `daterollpolicy`                                                                                                           |
| `course_cohort_classes` | `20260805_0001` | Materialized class with UTC `scheduled_start`/`scheduled_end`; `event_id` unique + `SET NULL`; unique `uq_cohort_class_source` on (`cohort_id`, `course_class_id`); enum `cohortclassstatus`   |
| `course_cohort_members` | `20260805_0001` | Cohort roster; unique `uq_cohort_member_user` on (`cohort_id`, `user_id`); enum `cohortmemberstatus`                                                                                           |

### New Columns

| Table              | Column       | Type                                                    | Migration       | Description                                                                                                      |
| ------------------ | ------------ | ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `training_courses` | `program_id` | String(36), nullable, FK `training_programs` `SET NULL` | `20260805_0001` | Pipeline this course's cohorts enrol into; set by the first cohort that generates one, so later cohorts reuse it |

### New Indexes

| Table                   | Index                          | Columns                              | Migration       |
| ----------------------- | ------------------------------ | ------------------------------------ | --------------- |
| `course_classes`        | `idx_course_class_org_course`  | `organization_id`, `course_id`       | `20260805_0001` |
| `course_cohorts`        | `idx_course_cohort_org_course` | `organization_id`, `course_id`       | `20260805_0001` |
| `course_cohort_classes` | `idx_cohort_class_start`       | `organization_id`, `scheduled_start` | `20260805_0001` |

> **`20260805_0001` chains off `20260802_0010`** (the storefront email-template
> revision), which is the head it landed on. It was drafted as a merge of the
> two heads that existed at the time (`20260801_0020` storefront and
> `20260802_0001` dues ledger), but `20260802_0002` had already merged those on
> main, so it is a plain linear revision.

---

## Recent Schema Changes (2026-07-31)

### New Tables

| Table              | Migration       | Description                                                                                     |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------- |
| `audit_ship_state` | `20260801_0011` | Off-host audit-shipping watermark (`last_shipped_id`, `last_shipped_at`)                        |
| `user_consents`    | `20260801_0014` | Per-member consent state; unique index `idx_user_consent_unique` on (`user_id`, `consent_type`) |

### New Columns

| Table                   | Column                | Type                         | Migration       | Description                                                                                       |
| ----------------------- | --------------------- | ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `audit_log_checkpoints` | `archived_at`         | DateTime(timezone), nullable | `20260801_0010` | Set when this checkpoint's rows were exported and purged by retention                             |
| `audit_log_checkpoints` | `last_log_hash`       | String(64), nullable         | `20260801_0010` | Chain hash of the final purged row; the surviving chain head anchors to it                        |
| `audit_log_checkpoints` | `archive_attestation` | String(64), nullable         | `20260801_0010` | Keyed HMAC over the archived range — a DB-only attacker cannot forge a "sanctioned" head deletion |
| `users`                 | `anonymized_at`       | DateTime(timezone), nullable | `20260801_0012` | When the member's PII was scrubbed; NULL = not anonymized                                         |

### Column Modifications

| Table                      | Column     | Change                | Migration       | Description                                                                                                                                                                                                 |
| -------------------------- | ---------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `member_leaves_of_absence` | `end_date` | `NOT NULL` → nullable | `20260801_0013` | **Bug fix.** The model documents `NULL` as "permanent leave", but the original migration created the column `NOT NULL`, so recording a permanent leave failed with IntegrityError 1048 on any real database |

---

## Recent Schema Changes (2026-07-14)

### New Columns

| Table             | Column           | Type                                                        | Migration       | Description                                                                                    |
| ----------------- | ---------------- | ----------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `skill_templates` | `requirement_id` | String(36), FK `training_requirements` (SET NULL, nullable) | `20260714_0001` | Default training-pipeline requirement this skill sheet satisfies                               |
| `skill_tests`     | `requirement_id` | String(36), FK `training_requirements` (SET NULL, nullable) | `20260714_0001` | Requirement this test satisfies; inherited from the template at creation, overridable per test |

### New Indexes

| Table             | Index                            | Columns            | Migration       |
| ----------------- | -------------------------------- | ------------------ | --------------- |
| `skill_templates` | `idx_skill_template_requirement` | `(requirement_id)` | `20260714_0001` |
| `skill_tests`     | `idx_skill_test_requirement`     | `(requirement_id)` | `20260714_0001` |

---

## Recent Schema Changes (2026-04-04)

### New Columns

| Table                     | Column                            | Type                          | Migration       | Description                                               |
| ------------------------- | --------------------------------- | ----------------------------- | --------------- | --------------------------------------------------------- |
| `training_module_configs` | `form_show_performance_rating`    | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle performance rating section on report creation form |
| `training_module_configs` | `form_show_areas_of_strength`     | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle strengths section on report creation form          |
| `training_module_configs` | `form_show_areas_for_improvement` | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle improvement section on report creation form        |
| `training_module_configs` | `form_show_officer_narrative`     | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle narrative section on report creation form          |
| `training_module_configs` | `form_show_skills_observed`       | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle skills section on report creation form             |
| `training_module_configs` | `form_show_tasks_performed`       | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle tasks section on report creation form              |
| `training_module_configs` | `form_show_call_types`            | Boolean (NOT NULL, default 1) | `20260404_0200` | Toggle call types section on report creation form         |
| `training_module_configs` | `apparatus_type_skills`           | JSON (nullable)               | `20260404_0300` | Per-apparatus-type skill lists for shift reports          |
| `training_module_configs` | `apparatus_type_tasks`            | JSON (nullable)               | `20260404_0300` | Per-apparatus-type task lists for shift reports           |
| `requirement_progress`    | `started_at`                      | DateTime(tz, nullable)        | `20260404_0500` | Timestamp when requirement transitions to IN_PROGRESS     |

### Column Modifications

| Table                    | Column     | Change        | Migration       | Reason                                                             |
| ------------------------ | ---------- | ------------- | --------------- | ------------------------------------------------------------------ |
| `shift_equipment_checks` | `shift_id` | Made nullable | `20260404_0100` | Support standalone ad-hoc equipment checks without an active shift |

### New Indexes

| Table                         | Index                           | Columns                         | Migration       |
| ----------------------------- | ------------------------------- | ------------------------------- | --------------- |
| `shift_equipment_checks`      | Composite                       | `(shift_id, template_id)`       | `20260404_0400` |
| `shift_equipment_check_items` | Composite                       | `(check_id, template_item_id)`  | `20260404_0400` |
| `shift_assignments`           | `idx_shift_assign_shift_status` | `(shift_id, assignment_status)` | `20260604_0001` |

---

## Recent Schema Changes (2026-06-10)

### New Columns

| Table       | Column     | Type            | Migration       | Description                                                                                                                            |
| ----------- | ---------- | --------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `positions` | `settings` | JSON (nullable) | `20260610_0002` | Per-position UI preferences; holds `label_presets` keyed by module (the label printer/size a role uses in each module, e.g. inventory) |

---

## Recent Schema Changes (2026-06-09)

### New Columns

| Table                | Column                     | Type                                      | Migration       | Description                                                            |
| -------------------- | -------------------------- | ----------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `equipment_requests` | `fulfilled_by`             | String(36), FK users (SET NULL, nullable) | `20260604_0100` | Quartermaster who fulfilled the approved request                       |
| `equipment_requests` | `fulfilled_at`             | DateTime(tz, nullable)                    | `20260604_0100` | When the request was fulfilled                                         |
| `equipment_requests` | `fulfillment_type`         | String(20, nullable)                      | `20260604_0100` | `issuance` \| `checkout` \| `assignment`                               |
| `equipment_requests` | `fulfillment_reference_id` | String(36, nullable)                      | `20260604_0100` | ID of the created `ItemIssuance` / `CheckOutRecord` / `ItemAssignment` |

### New Indexes

| Table               | Index                           | Columns                         | Migration       |
| ------------------- | ------------------------------- | ------------------------------- | --------------- |
| `shift_assignments` | `idx_shift_assign_shift_status` | `(shift_id, assignment_status)` | `20260604_0001` |

### Data Backfills

| Table                               | Change                                                                                   | Migration       | Reason                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `inventory_items`                   | Backfill barcodes for legacy rows                                                        | `20260604_0200` | Removes a write-on-read in the list endpoint (superseded by `20260610_0001`) |
| `inventory_items` / `organizations` | Reassign sequential `INV-000001` barcodes; seed per-org counter in `settings["barcode"]` | `20260610_0001` | Single sequential barcode scheme; also merges the two open heads             |

---

## Recent Schema Changes (2026-05-29)

### New Columns

| Table                          | Column                  | Type                                   | Migration       | Description                                                                             |
| ------------------------------ | ----------------------- | -------------------------------------- | --------------- | --------------------------------------------------------------------------------------- |
| `users`                        | `oauth_provider`        | String(50) (nullable)                  | `20260528_0002` | IdP that owns this identity (`google` / `microsoft`); `NULL` for password-only accounts |
| `users`                        | `oauth_subject`         | String(255) (nullable, indexed)        | `20260528_0002` | Provider's stable subject identifier (index `ix_users_oauth_subject`)                   |
| `compliance_configs`           | `include_current_month` | Boolean (NOT NULL, server_default `1`) | `20260503_0001` | Org default: whether the in-progress month counts toward compliance                     |
| `training_requirements`        | `include_current_month` | Boolean (nullable)                     | `20260503_0002` | Per-requirement override; `NULL` inherits the org default                               |
| `inventory_notification_queue` | `attempt_count`         | Integer (NOT NULL, server_default `0`) | `20260502_0002` | Delivery retry counter                                                                  |
| `inventory_notification_queue` | `last_attempt_at`       | DateTime(tz, nullable)                 | `20260502_0002` | Timestamp of the last delivery attempt                                                  |

### Column Modifications

| Table                     | Change                                                                             | Migration                         | Reason                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `training_module_configs` | Added `server_default` to the boolean toggle columns; backfilled NULLs to defaults | `20260502_0001` / `20260502_0003` | Ensure non-NULL booleans on fresh inserts and existing rows (config response also coerces NULL `manual_entry_*` booleans to defaults) |
| `training_sessions`       | Dropped dead `approval_required` column                                            | `20260502_0004`                   | Unused — finalize sign-off is governed solely by `require_completion_confirmation`                                                    |

---

**See also:** [Backend Development](Development-Backend) | [API Reference](API-Reference)
