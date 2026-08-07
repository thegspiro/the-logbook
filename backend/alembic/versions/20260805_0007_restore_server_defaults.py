"""Restore server defaults on NOT NULL columns of create_all-built databases

Across the models, 283 NOT NULL columns declared a Python-side ``default=`` but
no ``server_default=``. SQLAlchemy applies ``default=`` at flush time, so ORM
writes were unaffected — but the generated DDL carried no ``DEFAULT`` clause, so
any **raw SQL insert** omitting the column failed with
``(1364, "Field 'x' doesn't have a default value")``.

The migrations that created these columns did specify a server default, so a
chain-built database was always correct. Only databases built by
``_fast_path_init``'s ``create_all()`` were affected — which is every install
created since the fast path landed. The symptom was invisible in normal use and
loud in the test suite: 372 backend tests errored on exactly this when run
against a model-built database, and passed against a chain-built one.

The models now declare ``server_default`` alongside ``default``, which fixes
future installs. This revision fixes the ones already out there, by setting the
default on any listed column that currently has none. It is metadata-only —
``ALTER TABLE ... ALTER COLUMN ... SET DEFAULT`` does not rebuild the table —
and it never overwrites a default that is already present, so it is a no-op on a
chain-built database and safe to re-run.

``training_requirements.requirement_type`` is deliberately absent. Its migration
invented a ``'hours'`` default, but the model treats the column as mandatory:
silently typing a requirement as "hours" is worse than rejecting the insert.

Revision ID: 20260805_0007
Revises: 20260805_0006
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0007"
down_revision = "20260805_0006"
branch_labels = None
depends_on = None


# (table, column, default) — mirrors the server_default declared on each
# NOT NULL column in app/models/. Values are rendered as SQL literals.
_DEFAULTS = [
    ("admin_hours_categories", "require_approval", "1"),
    ("admin_hours_categories", "is_active", "1"),
    ("admin_hours_categories", "sort_order", "0"),
    ("admin_hours_entries", "status", "active"),
    ("apparatus", "min_staffing", "1"),
    ("apparatus", "is_archived", "0"),
    ("apparatus", "nfpa_tracking_enabled", "0"),
    ("apparatus", "has_deficiency", "0"),
    ("apparatus_component_notes", "note_type", "observation"),
    ("apparatus_component_notes", "severity", "info"),
    ("apparatus_component_notes", "status", "open"),
    ("apparatus_components", "component_type", "other"),
    ("apparatus_components", "condition", "good"),
    ("apparatus_components", "is_active", "1"),
    ("apparatus_custom_fields", "field_type", "text"),
    ("apparatus_custom_fields", "is_required", "0"),
    ("apparatus_custom_fields", "show_in_list", "0"),
    ("apparatus_custom_fields", "show_in_detail", "1"),
    ("apparatus_custom_fields", "is_active", "1"),
    ("apparatus_equipment", "quantity", "1"),
    ("apparatus_equipment", "is_mounted", "0"),
    ("apparatus_equipment", "is_required", "0"),
    ("apparatus_equipment", "is_present", "1"),
    ("apparatus_fuel_logs", "is_full_tank", "1"),
    ("apparatus_maintenance", "is_completed", "0"),
    ("apparatus_maintenance", "is_overdue", "0"),
    ("apparatus_maintenance", "is_historic", "0"),
    ("apparatus_maintenance_types", "category", "preventive"),
    ("apparatus_maintenance_types", "is_system", "0"),
    ("apparatus_maintenance_types", "is_nfpa_required", "0"),
    ("apparatus_maintenance_types", "is_active", "1"),
    ("apparatus_nfpa_compliance", "is_compliant", "0"),
    ("apparatus_operators", "is_certified", "1"),
    ("apparatus_operators", "license_verified", "0"),
    ("apparatus_operators", "has_restrictions", "0"),
    ("apparatus_operators", "is_active", "1"),
    ("apparatus_photos", "is_primary", "0"),
    ("apparatus_report_configs", "is_scheduled", "0"),
    ("apparatus_report_configs", "include_archived", "0"),
    ("apparatus_report_configs", "is_active", "1"),
    ("apparatus_service_providers", "is_emergency_service", "0"),
    ("apparatus_service_providers", "is_preferred", "0"),
    ("apparatus_service_providers", "is_active", "1"),
    ("apparatus_statuses", "is_system", "0"),
    ("apparatus_statuses", "is_available", "1"),
    ("apparatus_statuses", "is_operational", "1"),
    ("apparatus_statuses", "requires_reason", "0"),
    ("apparatus_statuses", "is_archived_status", "0"),
    ("apparatus_statuses", "is_active", "1"),
    ("apparatus_types", "category", "fire"),
    ("apparatus_types", "is_system", "0"),
    ("apparatus_types", "is_active", "1"),
    ("audit_ship_state", "last_shipped_id", "0"),
    ("basic_apparatus", "apparatus_type", "engine"),
    ("check_template_compartments", "is_header", "0"),
    ("check_template_compartments", "container_type", "compartment"),
    ("compliance_configs", "threshold_type", "percentage"),
    ("compliance_configs", "compliant_threshold", "100.0"),
    ("compliance_configs", "at_risk_threshold", "75.0"),
    ("compliance_configs", "grace_period_days", "0"),
    ("compliance_configs", "include_current_month", "1"),
    ("compliance_configs", "auto_report_frequency", "none"),
    ("compliance_configs", "notify_non_compliant_members", "0"),
    ("compliance_profiles", "is_active", "1"),
    ("compliance_profiles", "priority", "0"),
    ("compliance_reports", "status", "pending"),
    ("department_messages", "priority", "normal"),
    ("department_messages", "target_type", "all"),
    ("departure_clearance_items", "quantity", "1"),
    ("departure_clearance_items", "disposition", "pending"),
    ("departure_clearances", "status", "initiated"),
    ("departure_clearances", "total_items", "0"),
    ("departure_clearances", "items_cleared", "0"),
    ("departure_clearances", "items_outstanding", "0"),
    ("departure_clearances", "total_value", "0"),
    ("departure_clearances", "value_outstanding", "0"),
    ("document_folders", "visibility", "organization"),
    ("documents", "status", "active"),
    ("donations", "currency", "USD"),
    ("donations", "payment_status", "completed"),
    ("donations", "is_recurring", "0"),
    ("donations", "is_anonymous", "0"),
    ("donations", "receipt_sent", "0"),
    ("donations", "thank_you_sent", "0"),
    ("donations", "tax_deductible", "1"),
    ("donors", "donor_type", "individual"),
    ("donors", "total_donated", "0.00"),
    ("donors", "donation_count", "0"),
    ("donors", "is_anonymous", "0"),
    ("donors", "active", "1"),
    ("elections", "email_sent", "0"),
    ("elections", "auto_open", "0"),
    ("elections", "voting_method", "simple_majority"),
    ("elections", "victory_condition", "most_votes"),
    ("elections", "tie_policy", "co_winners"),
    ("elections", "enable_runoffs", "0"),
    ("elections", "runoff_type", "top_two"),
    ("elections", "max_runoff_rounds", "3"),
    ("elections", "is_runoff", "0"),
    ("elections", "runoff_round", "0"),
    ("elections", "quorum_type", "none"),
    ("email_templates", "is_active", "1"),
    ("email_templates", "allow_attachments", "0"),
    ("equipment_check_templates", "template_type", "equipment"),
    ("equipment_kit_items", "quantity", "1"),
    ("equipment_requests", "quantity", "1"),
    ("event_external_attendees", "checked_in", "0"),
    ("event_hour_mappings", "percentage", "100"),
    ("event_hour_mappings", "is_active", "1"),
    ("event_rsvps", "status", "going"),
    ("event_rsvps", "guest_count", "0"),
    ("event_rsvps", "checked_in", "0"),
    ("event_templates", "event_type", "other"),
    ("event_templates", "requires_rsvp", "0"),
    ("event_templates", "is_mandatory", "0"),
    ("event_templates", "allow_guests", "0"),
    ("event_templates", "require_checkout", "0"),
    ("event_templates", "send_reminders", "1"),
    ("event_templates", "is_active", "1"),
    ("events", "event_type", "other"),
    ("events", "requires_rsvp", "0"),
    ("events", "is_mandatory", "0"),
    ("events", "allow_guests", "0"),
    ("events", "send_reminders", "1"),
    ("events", "check_in_window_type", "flexible"),
    ("events", "require_checkout", "0"),
    ("events", "is_recurring", "0"),
    ("events", "rolling_recurrence", "0"),
    ("events", "is_cancelled", "0"),
    ("evoc_levels", "is_cumulative", "1"),
    ("evoc_levels", "is_system", "0"),
    ("evoc_levels", "sort_order", "0"),
    ("evoc_levels", "is_active", "1"),
    ("facilities", "is_owned", "1"),
    ("facilities", "is_archived", "0"),
    ("facility_access_keys", "is_active", "1"),
    ("facility_compliance_checklists", "is_completed", "0"),
    ("facility_compliance_items", "corrective_action_completed", "0"),
    ("facility_emergency_contacts", "priority", "1"),
    ("facility_emergency_contacts", "is_active", "1"),
    ("facility_inspections", "corrective_action_completed", "0"),
    ("facility_insurance_policies", "is_active", "1"),
    ("facility_maintenance", "is_completed", "0"),
    ("facility_maintenance", "is_overdue", "0"),
    ("facility_maintenance", "is_historic", "0"),
    ("facility_maintenance_types", "is_system", "0"),
    ("facility_maintenance_types", "is_active", "1"),
    ("facility_occupants", "is_active", "1"),
    ("facility_photos", "is_primary", "0"),
    ("facility_rooms", "zone_classification", "unclassified"),
    ("facility_rooms", "is_active", "1"),
    ("facility_statuses", "is_operational", "1"),
    ("facility_statuses", "is_system", "0"),
    ("facility_statuses", "is_active", "1"),
    ("facility_systems", "is_active", "1"),
    ("facility_types", "is_system", "0"),
    ("facility_types", "is_active", "1"),
    ("facility_utility_accounts", "is_active", "1"),
    ("form_fields", "sort_order", "0"),
    ("forms", "category", "operations"),
    ("forms", "status", "draft"),
    ("fundraising_campaigns", "current_amount", "0.00"),
    ("fundraising_campaigns", "status", "draft"),
    ("fundraising_campaigns", "public_page_enabled", "0"),
    ("fundraising_campaigns", "allow_anonymous", "1"),
    ("fundraising_campaigns", "active", "1"),
    ("fundraising_events", "current_attendees", "0"),
    ("fundraising_events", "actual_revenue", "0.00"),
    ("fundraising_events", "expenses", "0.00"),
    ("fundraising_events", "status", "planning"),
    ("grant_applications", "application_status", "researching"),
    ("grant_applications", "priority", "medium"),
    ("grant_budget_items", "amount_spent", "0"),
    ("grant_budget_items", "sort_order", "0"),
    ("grant_compliance_tasks", "status", "pending"),
    ("grant_compliance_tasks", "priority", "medium"),
    ("grant_compliance_tasks", "reminder_days_before", "14"),
    ("grant_notes", "note_type", "general"),
    ("grant_opportunities", "match_required", "0"),
    ("grant_opportunities", "is_active", "1"),
    ("inventory_categories", "nfpa_tracking_enabled", "0"),
    ("inventory_items", "condition", "good"),
    ("inventory_items", "status", "available"),
    ("inventory_items", "tracking_type", "individual"),
    ("inventory_lots", "quantity", "0"),
    ("inventory_notification_queue", "quantity", "1"),
    ("inventory_notification_queue", "processed", "0"),
    ("inventory_notification_queue", "attempt_count", "0"),
    ("inventory_write_offs", "status", "pending"),
    ("item_assignments", "assignment_type", "permanent"),
    ("item_issuances", "quantity_issued", "1"),
    ("locations", "is_active", "1"),
    ("manual_ballot_batches", "status", "pending"),
    ("manual_ballot_batches", "required_attestations", "0"),
    ("meeting_action_items", "status", "open"),
    ("meeting_minutes", "meeting_type", "business"),
    ("meeting_minutes", "status", "draft"),
    ("meeting_motions", "order", "0"),
    ("meeting_motions", "status", "passed"),
    ("meetings", "meeting_type", "business"),
    ("meetings", "status", "draft"),
    ("member_leaves_of_absence", "leave_type", "leave_of_absence"),
    ("member_leaves_of_absence", "active", "1"),
    ("member_leaves_of_absence", "exempt_from_training_waiver", "0"),
    ("membership_pipeline_steps", "step_type", "checkbox"),
    ("membership_pipeline_steps", "sort_order", "0"),
    ("message_history", "status", "sent"),
    ("message_history", "recipient_count", "1"),
    ("minutes_action_items", "priority", "medium"),
    ("minutes_action_items", "status", "pending"),
    ("minutes_templates", "meeting_type", "business"),
    ("minutes_templates", "is_default", "0"),
    ("notification_rules", "category", "general"),
    ("notification_rules", "channel", "in_app"),
    ("onboarding_status", "is_completed", "0"),
    ("operational_ranks", "sort_order", "0"),
    ("operational_ranks", "is_active", "1"),
    ("organizations", "organization_type", "fire_department"),
    ("organizations", "identifier_type", "department_id"),
    ("pledges", "fulfilled_amount", "0.00"),
    ("pledges", "status", "pending"),
    ("pledges", "reminder_enabled", "1"),
    ("property_return_reminders", "items_outstanding", "0"),
    ("property_return_reminders", "total_value_outstanding", "0"),
    ("property_return_reminders", "sent_to_member", "1"),
    ("property_return_reminders", "sent_to_admin", "1"),
    ("prospect_election_packages", "status", "draft"),
    ("prospect_step_progress", "status", "pending"),
    ("prospective_members", "status", "active"),
    ("public_portal_access_log", "flagged_suspicious", "0"),
    ("public_portal_api_keys", "is_active", "1"),
    ("public_portal_config", "enabled", "0"),
    ("public_portal_config", "default_rate_limit", "1000"),
    ("public_portal_config", "cache_ttl_seconds", "300"),
    ("public_portal_data_whitelist", "is_enabled", "0"),
    ("reorder_requests", "quantity_requested", "1"),
    ("reorder_requests", "status", "pending"),
    ("reorder_requests", "urgency", "normal"),
    ("requirement_progress_credits", "units", "0.0"),
    ("scheduled_emails", "status", "pending"),
    ("screening_records", "status", "scheduled"),
    ("screening_requirements", "is_active", "1"),
    ("screening_requirements", "grace_period_days", "30"),
    ("security_alerts", "acknowledged", "0"),
    ("security_alerts", "resolved", "0"),
    ("shift_assignments", "position", "firefighter"),
    ("shift_assignments", "assignment_status", "assigned"),
    ("shift_assignments", "is_training", "0"),
    ("shift_equipment_check_items", "updated_serial", "0"),
    ("shift_equipment_checks", "check_context", "shift_based"),
    ("shift_swap_requests", "status", "pending"),
    ("shift_templates", "open_to_all_members", "0"),
    ("shift_time_off", "status", "pending"),
    ("shifts", "open_to_all_members", "0"),
    ("shifts", "is_finalized", "0"),
    ("shifts", "status", "scheduled"),
    ("store_order_events", "is_member_visible", "1"),
    ("store_order_events", "notified", "0"),
    ("store_order_items", "unit_price", "0"),
    ("store_order_items", "quantity", "1"),
    ("store_order_items", "line_total", "0"),
    ("store_order_items", "fulfilled_quantity", "0"),
    ("store_order_windows", "status", "draft"),
    ("store_order_windows", "auto_open", "1"),
    ("store_order_windows", "auto_close", "1"),
    ("store_order_windows", "include_all_products", "1"),
    ("store_order_windows", "notify_on_open", "1"),
    ("store_orders", "status", "submitted"),
    ("store_orders", "payment_status", "unpaid"),
    ("store_orders", "subtotal", "0"),
    ("store_orders", "tax_amount", "0"),
    ("store_orders", "shipping_amount", "0"),
    ("store_orders", "discount_amount", "0"),
    ("store_orders", "total", "0"),
    ("store_orders", "amount_paid", "0"),
    ("store_orders", "fulfillment_method", "pickup"),
    ("store_payment_events", "provider", "paypal"),
    ("store_payment_events", "amount", "0"),
    ("store_payment_events", "currency", "USD"),
    ("store_payment_events", "status", "unmatched"),
    ("store_product_images", "content_type", "image/webp"),
    ("store_product_images", "byte_size", "0"),
    ("store_product_variants", "price_delta", "0"),
    ("store_product_variants", "is_active", "1"),
    ("store_product_variants", "sort_order", "0"),
    ("store_products", "price", "0"),
    ("store_products", "is_taxable", "0"),
    ("store_products", "status", "draft"),
    ("store_products", "personalization_enabled", "0"),
    ("store_products", "personalization_required", "0"),
    ("store_products", "personalization_max_length", "30"),
    ("store_products", "personalization_price", "0"),
    ("store_products", "track_stock", "0"),
    ("store_products", "requires_variant", "0"),
    ("store_products", "sort_order", "0"),
    ("store_settings", "is_enabled", "0"),
    ("store_settings", "store_name", "Department Store"),
    ("store_settings", "currency", "USD"),
    ("store_settings", "payment_policy", "none"),
    ("store_settings", "tax_rate", "0"),
    ("store_settings", "allow_pickup", "1"),
    ("store_settings", "allow_shipping", "0"),
    ("store_settings", "notify_admins_on_order", "1"),
    ("store_settings", "send_order_confirmation", "1"),
    ("store_settings", "send_status_updates", "1"),
    ("store_settings", "send_payment_reminders", "1"),
    ("store_settings", "send_payment_receipts", "1"),
    ("store_settings", "send_window_opened", "1"),
    ("store_settings", "send_window_closing_reminder", "1"),
    ("store_settings", "send_window_closed", "1"),
    ("store_settings", "send_vendor_order_updates", "1"),
    ("store_settings", "payment_reminder_days", "3"),
    ("store_settings", "window_reminder_hours", "48"),
    ("store_window_products", "sort_order", "0"),
    ("training_programs", "structure_type", "flexible"),
    ("training_programs", "recert_enabled", "0"),
    ("training_requirements", "source", "department"),
    ("training_requirements", "allows_external_credit", "0"),
    ("training_sessions", "counts_toward_certification", "1"),
    ("training_submissions", "status", "pending_review"),
    ("training_waivers", "waiver_type", "leave_of_absence"),
    ("training_waivers", "active", "1"),
    ("users", "compliance_exempt", "0"),
    ("users", "must_change_password", "0"),
    ("votes", "is_test", "0"),
    ("votes", "is_manual", "0"),
    ("votes", "is_proxy_vote", "0"),
    ("voting_tokens", "used", "0"),
    ("voting_tokens", "is_test", "0"),
    ("voting_tokens", "access_count", "0"),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_tables = set(inspector.get_table_names())
    restored = 0

    for table, column, default in _DEFAULTS:
        if table not in existing_tables:
            continue

        columns = {c["name"]: c for c in inspector.get_columns(table)}
        col = columns.get(column)
        if col is None:
            continue
        # Never overwrite a default that is already set — a chain-built
        # database already has the right one.
        if col.get("default") is not None:
            continue

        op.execute(
            sa.text(
                f"ALTER TABLE `{table}` ALTER COLUMN `{column}` " f"SET DEFAULT :value"
            ).bindparams(value=default)
        )
        restored += 1

    print(f"Restored server defaults on {restored} column(s)")


def downgrade() -> None:
    # Dropping these defaults would reinstate the failing raw inserts this
    # revision exists to fix.
    pass
