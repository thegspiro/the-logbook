# Database Schema

The Logbook stores its data in MySQL 8.0 (MariaDB 10.11 in the ARM compose
file, `docker-compose.arm.yml`), accessed through SQLAlchemy 2 (async) and
versioned with Alembic.

> **The authoritative, table-by-table reference is
> [`docs/DATABASE_SCHEMA.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/DATABASE_SCHEMA.md)**
> — every table, column, key and index, generated from the models by
> `backend/scripts/generate_schema_docs.py` and checked in CI, so it cannot
> drift. This page is an orientation: how the schema is organised, the
> conventions every table follows, and how migrations work. It deliberately
> does not list columns.

---

## How the schema is organised

The models live in `backend/app/models/`, roughly one file per domain, and the
schema has a little over 300 tables. The table below names a handful of real
tables per domain as a starting point; the generated reference groups every
table by model file.

| Domain                         | Model file(s)                                                                                                                    | Representative tables                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizations, members, access | `user.py`, `operational_rank.py`, `organization_officer.py`                                                                      | `organizations`, `users`, `positions`, `user_positions`, `sessions`, `password_history`, `operational_ranks`, `member_service_periods`, `member_leaves_of_absence`                        |
| Audit and security             | `audit.py`, `security_alert.py`, `ip_security.py`, `consent.py`, `error_log.py`                                                  | `audit_logs`, `audit_log_checkpoints`, `security_alerts`, `ip_exceptions`, `blocked_access_attempts`, `user_consents`, `error_logs`                                                       |
| Training                       | `training.py`, `skills_testing.py`, `knowledge_test.py`, `qualification.py`                                                      | `training_courses`, `training_records`, `training_requirements`, `training_programs`, `program_enrollments`, `requirement_progress`, `training_waivers`, `skill_tests`, `knowledge_tests` |
| Scheduling                     | `training.py` (the shift tables), `scheduling_module_config.py`, `shift_history_import.py`, `external_shift_hours.py`            | `shifts`, `shift_templates`, `shift_assignments`, `shift_swap_requests`, `shift_time_off`, `shift_patterns`, `shift_equipment_checks`, `scheduling_module_configs`                        |
| Events                         | `event.py`, `event_request.py`                                                                                                   | `events`, `event_rsvps`, `event_templates`, `event_external_attendees`, `event_requests`                                                                                                  |
| Meetings and minutes           | `meeting.py`, `minute.py`                                                                                                        | `meetings`, `meeting_attendees`, `meeting_minutes`, `meeting_motions`, `minutes_templates`, `minutes_action_items`                                                                        |
| Elections                      | `election.py`                                                                                                                    | `elections`, `candidates`, `votes`, `voting_tokens`                                                                                                                                       |
| Membership pipeline            | `membership_pipeline.py`                                                                                                         | `prospective_members`, `membership_pipelines`, `membership_pipeline_steps`, `prospect_step_progress`, `prospect_interviews`                                                               |
| Apparatus                      | `apparatus.py`                                                                                                                   | `apparatus`, `apparatus_types`, `apparatus_statuses`, `apparatus_maintenance`, `apparatus_operators`, `evoc_levels`, `equipment_check_templates`                                          |
| Inventory                      | `inventory.py`, `nfc_tag.py`, `label_printer.py`                                                                                 | `inventory_items`, `inventory_categories`, `item_assignments`, `item_issuances`, `checkout_records`, `item_variant_groups`, `inventory_lots`, `storage_areas`, `inventory_nfc_tags`       |
| Facilities and locations       | `facilities.py`, `location.py`                                                                                                   | `facilities`, `facility_rooms`, `facility_maintenance`, `facility_inspections`, `facility_utility_accounts`, `facility_utility_readings`, `locations`                                     |
| Finance                        | `finance.py`                                                                                                                     | `fiscal_years`, `budgets`, `budget_categories`, `purchase_requests`, `expense_reports`, `check_requests`, `dues_schedules`, `member_dues`, `approval_chains`                              |
| Grants and fundraising         | `grant.py`                                                                                                                       | `grant_opportunities`, `grant_applications`, `grant_expenditures`, `fundraising_campaigns`, `donors`, `donations`, `pledges`                                                              |
| Forms and documents            | `forms.py`, `document.py`, `legal.py`                                                                                            | `forms`, `form_fields`, `form_submissions`, `documents`, `document_folders`, `legal_document_revisions`                                                                                   |
| Communications                 | `notification.py`, `email_template.py`                                                                                           | `department_messages`, `notification_rules`, `notification_logs`, `push_subscriptions`, `email_templates`, `scheduled_emails`                                                             |
| Storefront                     | `storefront.py`                                                                                                                  | `store_products`, `store_product_variants`, `store_orders`, `store_order_items`, `store_order_windows`                                                                                    |
| Other modules                  | `suggestion.py`, `org_chart.py`, `public_portal.py`, `medical_screening.py`, `admin_hours.py`, `integration.py`, `onboarding.py` | `suggestions`, `org_chart_nodes`, `public_portal_config`, `screening_records`, `admin_hours_entries`, `integrations`, `onboarding_sessions`                                               |

---

## Conventions

| Aspect                  | Convention                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys            | `id VARCHAR(36)`, an application-generated UUID string (`default=generate_uuid`). No auto-increment integers.                                                                                                                                                                               |
| Tenancy                 | Most tables carry `organization_id` → `organizations.id`, usually `ON DELETE CASCADE`. Child tables without the column (candidates, form fields, approval-chain steps, grant budget items, …) are scoped through their parent.                                                              |
| Timestamps              | `DateTime(timezone=True)`, stored in **UTC**. Conversion to the member's or organization's timezone happens in the frontend.                                                                                                                                                                |
| Actor columns           | `created_by`, `recorded_by` and similar point at `users.id`.                                                                                                                                                                                                                                |
| Enums                   | Python `(str, Enum)` classes with **lowercase** values.                                                                                                                                                                                                                                     |
| `SET NULL` foreign keys | Always `nullable=True` — MySQL rejects `ON DELETE SET NULL` on a `NOT NULL` column (error 1830).                                                                                                                                                                                            |
| Naming                  | `plural_snake_case` tables, `snake_case` columns.                                                                                                                                                                                                                                           |
| JSON columns            | `JSON` columns hold settings and structured lists. `organizations.settings` uses `MutableDict`, which tracks top-level key changes only; code changing nested keys uses `copy.deepcopy()` or `flag_modified()`. Each JSON column has one canonical stored shape, normalized on every write. |
| Encrypted fields        | Sensitive values are encrypted by the application (AES-256-GCM, keyed by `ENCRYPTION_KEY` / `ENCRYPTION_SALT`) before they are stored.                                                                                                                                                      |

### Multi-tenancy

All organization data is scoped by `organization_id`:

- Unique constraints are org-scoped (for example
  `UniqueConstraint("organization_id", "barcode")`), so two departments can use
  the same values.
- Every by-id read, update and delete filters on the caller's organization, or
  resolves the row through a parent that was already org-scoped.
- Client-supplied foreign keys are checked to belong to the caller's
  organization before they are stored.

The rules and their enforcement are in
[docs/rules/tenancy.md](../docs/rules/tenancy.md).

### Example: `organizations.settings.email_service`

The `organizations.settings` JSON column stores email platform configuration under the `email_service` key. No database migration is needed when adding new email platforms — the JSON structure is flexible. Secret fields are AES-256-GCM encrypted (legacy Fernet values still readable).

| Field                              | Type               | Platforms  | Description                                                                                   |
| ---------------------------------- | ------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| `enabled`                          | boolean            | all        | Whether org-specific email config is active                                                   |
| `platform`                         | string             | all        | `gmail`, `microsoft`, `selfhosted`, `cloudflare`, or `other`                                  |
| `from_email`                       | string             | all        | Sender email address                                                                          |
| `from_name`                        | string             | all        | Sender display name                                                                           |
| `smtp_host`                        | string             | selfhosted | SMTP server hostname                                                                          |
| `smtp_port`                        | integer            | selfhosted | SMTP server port                                                                              |
| `smtp_user`                        | string             | selfhosted | SMTP username                                                                                 |
| `smtp_password`                    | string (encrypted) | selfhosted | SMTP password                                                                                 |
| `smtp_encryption`                  | string             | selfhosted | `tls`, `ssl`, or `none`                                                                       |
| `google_auth_method`               | string             | gmail      | `app_password` (default; absent means this) or `service_account`                              |
| `google_app_password`              | string (encrypted) | gmail      | Google App Password; signs in to smtp.gmail.com as `from_email`                               |
| `google_service_account_key`       | string (encrypted) | gmail      | Service account JSON key with domain-wide delegation for `gmail.send`; `service_account` only |
| `google_service_account_client_id` | string             | gmail      | Read-only; the saved key's client ID, derived on read, for the Admin console                  |
| `microsoft_auth_method`            | string             | microsoft  | `app_password` (default; absent means this) or `oauth`                                        |
| `microsoft_app_password`           | string (encrypted) | microsoft  | Microsoft 365 App Password; signs in to smtp.office365.com as `from_email`                    |
| `microsoft_tenant_id`              | string             | microsoft  | Entra ID directory (tenant) ID; `oauth` only                                                  |
| `microsoft_client_id`              | string             | microsoft  | Entra ID application (client) ID; `oauth` only                                                |
| `microsoft_client_secret`          | string (encrypted) | microsoft  | Entra ID client secret; `oauth` only                                                          |
| `cloudflare_account_id`            | string             | cloudflare | Cloudflare Account ID (32-char hex)                                                           |
| `cloudflare_api_token`             | string (encrypted) | cloudflare | Cloudflare API token with email sending permission                                            |

---

## Recent Schema Changes (2026-10-05 → 10-06)

---

## Migrations

Migrations are managed by Alembic and live in `backend/alembic/versions/`.
Files are named `YYYYMMDD_HHMM_<description>.py`, with the revision id often
included after the timestamp.

### How a database gets its schema

- **A fresh install does not replay the migration chain.** On first start,
  `backend/main.py`'s `_fast_path_init()` creates every table from the models
  (`create_all`), runs the few migration-only and seed-data files
  (`MIGRATION_ONLY_FILES`, `SEED_DATA_FILES`), and stamps Alembic at head. The
  models in `app/models/` are therefore the schema a new deployment receives.
- **An existing database is upgraded** to head with Alembic, which the backend
  runs at startup.

Two consequences follow. A model change alone changes the schema of every new
install, so a schema change needs both a model change and a migration. And
some tables are built only by `create_all` — no migration ever creates them —
so a migration that reflects or alters one must first check that the table
exists, or `alembic upgrade head` against an empty database fails. CI enforces
this (`tests/test_migration_create_all_tables.py`); see
[docs/rules/migrations.md](../docs/rules/migrations.md#a-migration-must-tolerate-a-table-only-create_all-builds).

### Commands

```bash
# Apply migrations (from the repo root)
npm run db:migrate

# Or inside the Docker stack
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current
```

### Regenerating the reference

A change under `backend/app/models/` that alters the schema must regenerate
the generated reference, or the Backend Unit Tests job fails:

```bash
cd backend && python scripts/generate_schema_docs.py
```
