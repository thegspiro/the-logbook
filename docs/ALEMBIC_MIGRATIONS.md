# Alembic Migration Tracking

> **Purpose:** Prevent revision-ID collisions and broken `down_revision` chains when
> generating new migration files. Always consult this document before creating a new
> migration.

## Conventions

| Rule | Detail |
|------|--------|
| **File naming** | `YYYYMMDD_SSSS_short_description.py` where `SSSS` is a zero-padded sequence within that date (e.g., `0100`, `0200`). Use increments of `0100` to leave room for insertions (`0050`, `0150`, etc.). |
| **Revision ID** | Must match the `YYYYMMDD_SSSS` prefix of the filename. |
| **down_revision** | Must point to the revision ID of the **immediately preceding** migration in the chain. |
| **No hex/random IDs** | Do not use Alembic auto-generated hex hashes. Always use the date-based scheme. |
| **One stale file** | `20260216_0100_add_pipeline_features_and_tables.py.stale` is intentionally excluded from the chain. |

## Current Head

| Field | Value |
|-------|-------|
| **Head revision** | `20260223_0200` |
| **Head file** | `20260223_0200_add_storage_areas.py` |
| **Head down_revision** | `20260223_0100` |

**To add a new migration**, use the next available sequence for today's date. For
example, if today is 2026-02-23, the next file would be:

```
20260223_0300_your_description.py
revision = "20260223_0300"
down_revision = "20260223_0200"
```

## Full Revision Chain

| # | Revision ID | Down Revision | Filename | Description |
|---|-------------|---------------|----------|-------------|
| 1 | `20260118_0001` | `None` | `20260118_0001_initial_schema.py` | Initial schema setup |
| 2 | `20260118_0002` | `20260118_0001` | `20260118_0002_add_notification_preferences.py` | Add notification preferences to users |
| 3 | `20260118_0003` | `20260118_0002` | `20260118_0003_add_training_tables.py` | Add training tables |
| 4 | `20260118_0004` | `20260118_0003` | `20260118_0004_add_election_tables.py` | Add election tables |
| 5 | `20260118_0005` | `20260118_0004` | `20260118_0005_add_ballot_eligibility_and_email.py` | Add ballot item eligibility and email notifications |
| 6 | `20260119_0006` | `20260118_0005` | `20260119_0006_add_voting_tokens.py` | Add voting tokens for secure anonymous ballot access |
| 7 | `20260119_0007` | `20260119_0006` | `20260119_0007_add_voting_methods_and_victory_conditions.py` | Add voting methods and victory conditions to elections |
| 8 | `20260119_0008` | `20260119_0007` | `20260119_0008_add_runoff_configuration.py` | Add runoff configuration to elections |
| 9 | `20260119_0009` | `20260119_0008` | `20260119_0009_add_rollback_history.py` | Add rollback history to elections |
| 10 | `20260119_0010` | `20260119_0009` | `20260119_0010_create_events_tables.py` | Create events tables |
| 11 | `20260119_0011` | `20260119_0010` | `20260119_0011_add_allowed_rsvp_statuses.py` | Add allowed RSVP statuses |
| 12 | `20260119_0012` | `20260119_0011` | `20260119_0012_add_actual_event_times.py` | Add actual event times |
| 13 | `20260120_0013` | `20260119_0012` | `20260120_0013_add_locations_table.py` | Add locations table and event location_id |
| 14 | `20260120_0013b` | `20260120_0013` | `20260120_0013b_create_inventory_tables.py` | Create inventory tables |
| 15 | `20260122_0014` | `20260120_0013b` | `20260122_0014_add_training_session_enhancements.py` | Add training session enhancements |
| 16 | `20260122_0015` | `20260122_0014` | `20260122_0015_add_training_programs_and_requirements.py` | Add training programs and requirements system |
| 17 | `20260122_0030` | `20260122_0015` | `20260122_0030_add_enhanced_training_program_features.py` | Add enhanced training program features |
| 18 | `20260201_0016` | `20260122_0030` | `20260201_0016_create_compliance_tables.py` | Create compliance module tables |
| 19 | `20260201_0017` | `20260201_0016` | `20260201_0017_create_fundraising_tables.py` | Create fundraising module tables |
| 20 | `20260201_0018` | `20260201_0017` | `20260201_0018_create_onboarding_tables.py` | Create onboarding tables |
| 21 | `20260202_0019` | `20260201_0018` | `20260202_0019_create_ip_security_tables.py` | Create IP security tables with approval workflow |
| 22 | `20260202_0020` | `20260202_0019` | `20260202_0020_add_organization_fields.py` | Add comprehensive organization fields |
| 23 | `20260202_0021` | `20260202_0020` | `20260202_0021_add_user_roles_indexes.py` | Add missing indexes to user_roles table |
| 24 | `20260203_0022` | `20260202_0021` | `20260203_0022_create_apparatus_tables.py` | Create apparatus module tables |
| 25 | `20260203_0023` | `20260203_0022` | `20260203_0023_seed_apparatus_data.py` | Seed apparatus system data |
| 26 | `20260205_0024` | `20260203_0023` | `20260205_0024_add_user_contact_fields.py` | Add user contact and profile fields |
| 27 | `20260205_0100` | `20260205_0024` | `20260205_0100_add_training_categories_and_due_date_type.py` | Add training categories and due date type |
| 28 | `20260205_0200` | `20260205_0100` | `20260205_0200_add_external_training_integration.py` | Add external training integration tables |
| 29 | `20260206_0300` | `20260205_0200` | `20260206_0300_fix_training_program_schema_mismatches.py` | Fix training program schema mismatches |
| 30 | `20260206_0301` | `20260206_0300` | `20260206_0301_add_missing_training_tables.py` | Add missing training tables (shifts, skill evaluations) |
| 31 | `20260206_0302` | `20260206_0301` | `20260206_0302_create_email_templates_tables.py` | Create email templates and attachments tables |
| 32 | `20260206_0303` | `20260206_0302` | `20260206_0303_add_password_reset_fields.py` | Add password reset token fields and seed template |
| 33 | `20260207_0400` | `20260206_0303` | `20260207_0400_fix_logo_column_size.py` | Fix logo column size to support base64 images |
| 34 | `20260207_0401` | `20260207_0400` | `20260207_0401_fix_program_requirements_column_rename.py` | Fix program_requirements column rename (idempotent) |
| 35 | `20260207_0500` | `20260207_0401` | `20260207_0500_fix_organization_type_enum_case.py` | Fix organization_type enum values case mismatch |
| 36 | `20260207_0501` | `20260207_0500` | `20260207_0501_create_public_portal_tables.py` | Create public portal tables |
| 37 | `20260208_1934` | `20260207_0501` | `20260208_1934_fix_organization_type_enum_mysql.py` | Fix organization_type enum using raw MySQL commands |
| 38 | `20260209_0600` | `20260208_1934` | `20260209_0600_ensure_logo_column_longtext.py` | Ensure logo column is LONGTEXT |
| 39 | `20260210_0600` | `20260209_0600` | `20260210_0600_fix_user_roles_composite_primary_key.py` | Fix user_roles table to use composite primary key |
| 40 | `20260210_0023` | `20260210_0600` | `20260210_0023_add_vote_unique_constraints.py` | Add vote unique constraints for ballot integrity |
| 41 | `20260212_0100` | `20260210_0023` | `20260212_0100_create_forms_tables.py` | Create forms tables |
| 42 | `20260212_0200` | `20260212_0100` | `20260212_0200_add_public_forms_and_integrations.py` | Add public forms and integrations |
| 43 | `20260212_0300` | `20260212_0200` | `20260212_0300_create_documents_meetings_notifications.py` | Create documents, meetings, and notifications tables |
| 44 | `20260212_0400` | `20260212_0300` | `20260212_0400_create_membership_pipeline_tables.py` | Create membership pipeline tables |
| 45 | `20260212_0500` | `20260212_0400` | `20260212_0500_add_vote_signatures_softdelete_rank.py` | Add vote signatures, soft-delete, rank column |
| 46 | `20260212_0600` | `20260212_0500` | `20260212_0600_add_election_attendees.py` | Add election attendees column for meeting attendance |
| 47 | `add_meeting_minutes` | `20260212_0600` | `20260212_1200_add_meeting_minutes_tables.py` | Add meeting minutes tables *(non-standard ID)* |
| 48 | `20260213_0800` | `add_meeting_minutes` | `20260213_0800_add_templates_documents_dynamic_sections.py` | Add minutes templates, documents module, dynamic sections |
| 49 | `a7f3e2d91b04` | `20260213_0800` | `20260213_1400_add_trustee_executive_annual_meeting_types.py` | Add trustee, executive, and annual meeting types *(non-standard ID)* |
| 50 | `20260213_1500` | `a7f3e2d91b04` | `20260213_1500_add_password_history_table.py` | Add password history table for HIPAA compliance |
| 51 | `20260214_0100` | `20260213_1500` | `20260214_0100_add_training_session_program_linkage.py` | Add program and category linkage to training_sessions |
| 52 | `20260214_0200` | `20260214_0100` | `20260214_0200_add_self_reported_training.py` | Add self-reported training tables |
| 53 | `20260214_0300` | `20260214_0200` | `20260214_0300_add_shift_completion_reports.py` | Add shift completion reports table |
| 54 | `20260214_0400` | `20260214_0300` | `20260214_0400_add_training_module_config.py` | Add training module config table |
| 55 | `20260214_0500` | `20260214_0400` | `20260214_0500_add_dropped_statuses_and_property_return.py` | Add dropped member statuses and enums |
| 56 | `20260214_0600` | `20260214_0500` | `20260214_0600_add_status_changed_at_and_reminders.py` | Add status_changed_at and property_return_reminders |
| 57 | `20260214_0700` | `20260214_0600` | `20260214_0700_add_archived_status_and_archived_at.py` | Add archived status and archived_at column |
| 58 | `20260214_0800` | `20260214_0700` | `20260214_0800_add_personal_email_and_drop_notif_config.py` | Add personal_email column to users table |
| 59 | `20260214_0900` | `20260214_0800` | `20260214_0900_add_membership_type_and_tiers.py` | Add membership_type to users table |
| 60 | `20260214_1000` | `20260214_0900` | `20260214_1000_add_voter_overrides_to_elections.py` | Add voter_overrides column to elections |
| 61 | `20260214_1100` | `20260214_1000` | `20260214_1100_add_proxy_voting_to_elections.py` | Add proxy voting support to elections |
| 62 | `20260214_1200` | `20260214_1100` | `20260214_1200_add_quorum_peer_eval_cert_alerts.py` | Add quorum config, peer eval, cert alerts, training-event link |
| 63 | `20260214_1300` | `20260214_1200` | `20260214_1300_add_waiver_fields_cron_config.py` | Add meeting attendance waiver fields |
| 64 | `20260214_1400` | `20260214_1300` | `20260214_1400_add_org_id_to_child_tables.py` | Add organization_id FK to child tables |
| 65 | `20260214_1500` | `20260214_1400` | `20260214_1500_add_granular_apparatus_permissions.py` | Add granular apparatus permissions to roles |
| 66 | `20260214_1600` | `20260214_1500` | `20260214_1600_add_service_providers_components_notes.py` | Add service providers, components, and notes tables |
| 67 | `20260214_1700` | `20260214_1600` | `20260214_1700_apparatus_module_hardening.py` | Apparatus module hardening: soft-delete, FK, indexes |
| 68 | `20260214_1800` | `20260214_1700` | `20260214_1800_add_maintenance_attachments_and_history.py` | Add maintenance attachments and historic repair support |
| 69 | `20260214_1900` | `20260214_1800` | `20260214_1900_add_facilities_module.py` | Add facilities module tables |
| 70 | `20260214_2000` | `20260214_1900` | `20260214_2000_seed_facilities_data.py` | Seed facilities system data |
| 71 | `20260214_2100` | `20260214_2000` | `20260214_2100_add_facilities_extended_tables.py` | Add facilities extended tables |
| 72 | `20260214_2200` | `20260214_2100` | `20260214_2200_add_shift_scheduling_tables.py` | Add shift scheduling tables |
| 73 | `20260215_0100` | `20260214_2200` | `20260215_0100_add_folder_access_control.py` | Add folder access control columns |
| 74 | `20260215_0200` | `20260215_0100` | `20260215_0200_add_apparatus_system_folder.py` | Add system folders for apparatus, facilities, events |
| 75 | `20260216_0100` | `20260215_0200` | `20260216_0100_add_membership_id_to_users.py` | Add membership_id column to users table |
| 76 | `20260216_0200` | `20260216_0100` | `20260216_0200_add_location_address_fields.py` | Add address fields to locations table |
| 77 | `20260216_0300` | `20260216_0200` | `20260216_0300_add_membership_number.py` | Add membership_number column to users table |
| 78 | `20260218_0100` | `20260216_0300` | `20260218_0100_add_training_requirement_knowledge_test.py` | Add passing_score and max_attempts to training_requirements |
| 79 | `20260218_0200` | `20260218_0100` | `20260218_0200_add_basic_apparatus_table.py` | Add basic_apparatus table for lightweight vehicle management |
| 80 | `20260218_0300` | `20260218_0200` | `20260218_0300_add_missing_model_columns_and_tables.py` | Add missing model columns and tables across the application |
| 81 | `20260218_0400` | `20260218_0300` | `20260218_0400_add_cross_module_fks_and_external_attendees.py` | Add cross-module FKs and event_external_attendees table |
| 82 | `20260218_0500` | `20260218_0400` | `20260218_0500_add_department_messages.py` | Add department_messages and reads tables |
| 83 | `20260218_0600` | `20260218_0500` | `20260218_0600_add_training_waivers.py` | Add training_waivers table for LOA tracking |
| 84 | `20260218_0700` | `20260218_0600` | `20260218_0700_add_form_field_conditions.py` | Add conditional visibility to form_fields |
| 85 | `20260218_0800` | `20260218_0700` | `20260218_0800_unify_locations_facilities_bridge.py` | Unify locations and facilities with bridge FK |
| 86 | `20260218_0900` | `20260218_0800` | `20260218_0900_add_location_display_code.py` | Add display_code to locations for public kiosk URLs |
| 87 | `dc01a` | `20260218_0900` | `20260219_0100_add_departure_clearance_tables.py` | Add departure clearance tables *(non-standard ID)* |
| 88 | `20260219_0200` | `dc01a` | `20260219_0200_add_inventory_notification_queue.py` | Add inventory notification queue table |
| 89 | `20260219_0300` | `20260219_0200` | `20260219_0300_add_badge_number_unique_index.py` | Add unique index on organization_id + badge_number |
| 90 | `20260220_0100` | `20260219_0300` | `20260220_0100_add_must_change_password.py` | Add must_change_password column to users table |
| 91 | `20260220_0200` | `20260220_0100` | `20260220_0200_align_training_enum_values.py` | Align training ENUM values between frontend and backend |
| 92 | `20260220_0300` | `20260220_0200` | `20260220_0300_add_member_leaves_of_absence.py` | Add member_leaves_of_absence table |
| 93 | `20260221_0100` | `20260220_0300` | `20260221_0100_fix_column_type_consistency.py` | Fix column type consistency |
| 94 | `20260221_0200` | `20260221_0100` | `20260221_0200_consolidate_badge_into_membership_number.py` | Consolidate badge_number into membership_number |
| 95 | `20260221_0300` | `20260221_0200` | `20260221_0300_add_facility_room_audit_fields.py` | Add created_by and updated_by to facility_rooms |
| 96 | `20260221_0400` | `20260221_0300` | `20260221_0400_add_event_audit_fields.py` | Add updated_by audit fields to events and templates |
| 97 | `20260221_0500` | `20260221_0400` | `20260221_0500_remove_eligible_roles.py` | Remove eligible_roles from events and event_templates |
| 98 | `20260221_0600` | `20260221_0500` | `20260221_0600_rename_reminder_hours_to_schedule.py` | Replace reminder_hours_before with reminder_schedule JSON |
| 99 | `20260221_0700` | `20260221_0600` | `20260221_0700_add_notification_expiry_and_category.py` | Add expires_at and category to notification_logs |
| 100 | `20260221_0800` | `20260221_0700` | `20260221_0800_add_notification_action_url.py` | Add action_url column to notification_logs |
| 101 | `20260222_0100` | `20260221_0800` | `20260222_0100_add_inventory_issuances_and_pool_columns.py` | Add item_issuances table, tracking_type/quantity columns |
| 102 | `20260222_0200` | `20260222_0100` | `20260222_0200_scope_barcode_asset_tag_unique_per_org.py` | Scope barcode/asset_tag unique constraints per org |
| 103 | `20260222_0300` | `20260222_0200` | `20260222_0300_add_training_indexes_and_constraints.py` | Add training index and unique constraint |
| 104 | `20260222_0350` | `20260222_0300` | `20260222_0350_add_inventory_location_id_fk.py` | Add location_id FK to inventory_items |
| 105 | `20260222_0400` | `20260222_0350` | `20260222_0400_ensure_notification_logs_columns.py` | Ensure notification_logs has category, expires_at, action_url |
| 106 | `20260222_0450` | `20260222_0400` | `20260222_0450_create_equipment_requests_table.py` | Create equipment_requests table |
| 107 | `20260222_0500` | `20260222_0450` | `20260222_0500_create_operational_ranks_table.py` | Create operational_ranks table |
| 108 | `20260222_0600` | `20260222_0500` | `20260222_0600_add_on_hold_inactive_prospect_status.py` | Add on_hold and inactive to prospect status enum |
| 109 | `20260222_0700` | `20260222_0600` | `20260222_0700_add_referral_fields_and_status_token.py` | Add referral fields and status_token to prospective_members |
| 110 | `20260222_0800` | `20260222_0700` | `20260222_0800_add_step_visibility_and_notification_flags.py` | Add per-step notification and visibility flags |
| 111 | `20260222_0900` | `20260222_0800` | `20260222_0900_add_shift_report_review_and_rating_config.py` | Add shift report review workflow and rating config |
| 112 | `20260222_1000` | `20260222_0900` | `20260222_1000_encrypt_sensitive_report_fields.py` | Encrypt sensitive shift report fields at rest |
| 113 | `20260223_0100` | `20260222_1000` | `20260223_0100_add_training_rank_station_and_loa_waiver_link.py` | Add rank/station to training records, LOA-waiver link |
| 114 | `20260223_0200` | `20260223_0100` | `20260223_0200_add_storage_areas.py` | Add storage_areas table and storage_area_id FK |

## Known Non-Standard Revision IDs

These three migrations use IDs that don't follow the `YYYYMMDD_SSSS` convention.
They are functional but should not be used as a pattern for new migrations:

| Revision ID | File | Note |
|-------------|------|------|
| `add_meeting_minutes` | `20260212_1200_add_meeting_minutes_tables.py` | Human-readable slug |
| `a7f3e2d91b04` | `20260213_1400_add_trustee_executive_annual_meeting_types.py` | Alembic auto-generated hex |
| `dc01a` | `20260219_0100_add_departure_clearance_tables.py` | Truncated hex |

## Template for New Migrations

```python
"""Short description of what this migration does

Revision ID: YYYYMMDD_SSSS
Revises: <previous_revision_id>
Create Date: YYYY-MM-DD HH:MM:SS.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "YYYYMMDD_SSSS"
down_revision = "<previous_revision_id>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ... your schema changes ...
    pass


def downgrade() -> None:
    # ... reverse of upgrade ...
    pass
```
