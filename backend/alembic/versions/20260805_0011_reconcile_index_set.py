"""Reconcile the index set: same indexes on both build paths, no redundancy

``20260805_0009`` removed 136 *exact* duplicate indexes. Two further kinds of
redundancy survived it, and the two build paths still disagreed:

* **Leftmost-prefix duplicates.** A composite index on ``(a, b)`` already serves
  every query that filters or sorts on ``a`` alone, so a separate index on
  ``(a)`` costs writes and returns nothing. Most were an ``index=True`` on a
  column some composite in ``__table_args__`` already covered.
* **Non-unique indexes shadowed by a unique one** over the same column — a
  unique index answers everything its non-unique twin could.
* **Path disagreement.** 82 indexes existed only on chain-built databases and
  37 only on ``create_all``-built ones.

The models are now the single source of truth. Redundant entries are gone, and
the indexes only the migration chain had were adopted into the models where
nothing already covered them: an overdue-checkout composite on
``checkout_records``, the reporting-period composite on ``compliance_reports``,
``documents(source_type, source_id)``, ``item_assignments(item_id, is_active)``,
``training_categories(organization_id, registry_code)``,
``training_requirements(organization_id, year)`` and ``votes(is_proxy_vote)``.
Nothing was dropped that a query might want — only indexes another index
already answers.

This revision brings existing databases to that same set. Creates run before
drops so a foreign key is never transiently left without a backing index, and
every operation is guarded on current state, so the revision is a no-op against
a database already in the target shape.

Eight foreign keys are added here too. Five are declared by the models and were
never created on chain-built databases (``events.updated_by``,
``event_templates.updated_by``, ``event_external_attendees.updated_by`` and both
actor columns on ``facility_rooms``). The other three are the reverse case:
``training_records``, ``training_sessions`` and ``skill_checkoffs`` each carry an
``apparatus_id`` that ``20260218_0400`` wires to ``apparatus.id`` on chain-built
databases while the model left it an unconstrained column — so fresh installs
had no referential integrity there at all. The models now declare all eight;
MySQL creates their backing indexes as a side effect, which is why they are
absent from the index list below.

``inventory_items.uq_item_org_serial_number`` is unique and cannot be built over
data that already violates it. Duplicates are reported up front, naming the
organization and serial number, rather than surfacing as a bare 1062 part-way
through.

Renumbered from 20260805_0010 to 0011. This revision and
``drop_onboarding_checklist_table`` were authored on separate branches that both
claimed 0010 off the same parent, so merging them left two heads with one id —
the collision ``20260805_0101`` documents escaping, recreated. Sequenced after
the drop rather than before it; the two touch disjoint tables, so only the label
and the parent pointer moved.

Revision ID: 20260805_0011
Revises: 20260805_0010
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0011"
down_revision = "20260805_0010"
branch_labels = None
depends_on = None


# (table, column, referred_table, referred_column, ondelete)
_MISSING_FKS = [
    ("event_external_attendees", "updated_by", "users", "id", "SET NULL"),
    ("event_templates", "updated_by", "users", "id", None),
    ("events", "updated_by", "users", "id", None),
    ("facility_rooms", "created_by", "users", "id", "SET NULL"),
    ("facility_rooms", "updated_by", "users", "id", "SET NULL"),
    ("skill_checkoffs", "apparatus_id", "apparatus", "id", "SET NULL"),
    ("training_records", "apparatus_id", "apparatus", "id", "SET NULL"),
    ("training_sessions", "apparatus_id", "apparatus", "id", "SET NULL"),
]

# (table, index_name, columns, unique)
_CREATE = [
    ("audit_logs", "ix_audit_logs_event_category", ["event_category"], False),
    ("checkout_records", "ix_checkout_records_is_overdue", ["is_overdue"], False),
    ("checkout_records", "ix_checkout_records_is_returned", ["is_returned"], False),
    ("equipment_requests", "ix_equipment_requests_status", ["status"], False),
    ("forms", "ix_forms_is_template", ["is_template"], False),
    ("forms", "ix_forms_status", ["status"], False),
    ("inventory_categories", "ix_inventory_categories_active", ["active"], False),
    ("inventory_items", "ix_inventory_items_active", ["active"], False),
    ("inventory_items", "ix_inventory_items_status", ["status"], False),
    (
        "inventory_items",
        "uq_item_org_serial_number",
        ["organization_id", "serial_number"],
        True,
    ),
    ("item_assignments", "ix_item_assignments_is_active", ["is_active"], False),
    ("item_issuances", "ix_item_issuances_is_returned", ["is_returned"], False),
    ("item_variant_groups", "ix_item_variant_groups_active", ["active"], False),
    (
        "maintenance_records",
        "ix_maintenance_records_completed_date",
        ["completed_date"],
        False,
    ),
    (
        "maintenance_records",
        "ix_maintenance_records_is_completed",
        ["is_completed"],
        False,
    ),
    (
        "maintenance_records",
        "ix_maintenance_records_next_due_date",
        ["next_due_date"],
        False,
    ),
    (
        "maintenance_records",
        "ix_maintenance_records_scheduled_date",
        ["scheduled_date"],
        False,
    ),
    ("meetings", "ix_meetings_meeting_date", ["meeting_date"], False),
    (
        "membership_pipelines",
        "ix_membership_pipelines_is_template",
        ["is_template"],
        False,
    ),
    (
        "nfpa_item_compliance",
        "ix_nfpa_item_compliance_ensemble_id",
        ["ensemble_id"],
        False,
    ),
    ("program_enrollments", "ix_program_enrollments_status", ["status"], False),
    ("prospective_members", "ix_prospective_members_status", ["status"], False),
    ("reorder_requests", "ix_reorder_requests_status", ["status"], False),
    ("requirement_progress", "ix_requirement_progress_status", ["status"], False),
    ("shifts", "ix_shifts_shift_date", ["shift_date"], False),
    ("skill_evaluations", "ix_skill_evaluations_active", ["active"], False),
    ("training_programs", "ix_training_programs_active", ["active"], False),
    ("training_records", "ix_training_records_status", ["status"], False),
    ("training_submissions", "ix_training_submissions_status", ["status"], False),
    ("users", "idx_user_created_at", ["created_at"], False),
    ("users", "idx_user_last_login_at", ["last_login_at"], False),
    (
        "users",
        "idx_user_org_status_deleted",
        ["organization_id", "status", "deleted_at"],
        False,
    ),
]

# (table, index_name, columns, unique) — redundant, see the module docstring.
_DROP = [
    (
        "admin_hours_categories",
        "ix_admin_hours_categories_org_id",
        ["organization_id"],
        False,
    ),
    (
        "admin_hours_entries",
        "ix_admin_hours_entries_org_id",
        ["organization_id"],
        False,
    ),
    ("admin_hours_entries", "ix_admin_hours_entries_user_id", ["user_id"], False),
    (
        "apparatus_components",
        "idx_apparatus_components_apparatus",
        ["apparatus_id"],
        False,
    ),
    (
        "apparatus_documents",
        "idx_apparatus_documents_apparatus",
        ["apparatus_id"],
        False,
    ),
    (
        "apparatus_operators",
        "idx_apparatus_operators_apparatus",
        ["apparatus_id"],
        False,
    ),
    ("apparatus_photos", "idx_apparatus_photos_apparatus", ["apparatus_id"], False),
    (
        "apparatus_service_providers",
        "idx_service_providers_org",
        ["organization_id"],
        False,
    ),
    (
        "blocked_access_attempts",
        "ix_blocked_access_attempts_country_code",
        ["country_code"],
        False,
    ),
    (
        "blocked_access_attempts",
        "ix_blocked_access_attempts_ip_address",
        ["ip_address"],
        False,
    ),
    (
        "checkout_records",
        "idx_checkout_records_org_returned",
        ["organization_id", "is_returned"],
        False,
    ),
    ("country_block_rules", "idx_country_rule_code", ["country_code"], False),
    ("department_message_reads", "idx_dept_msg_read_msg", ["message_id"], False),
    ("department_messages", "idx_dept_msg_org", ["organization_id"], False),
    (
        "department_messages",
        "idx_dept_msg_org_active",
        ["organization_id", "is_active"],
        False,
    ),
    (
        "departure_clearance_items",
        "idx_clearance_item_clearance",
        ["clearance_id"],
        False,
    ),
    ("documents", "idx_documents_org", ["organization_id"], False),
    ("donations", "idx_donations_org", ["organization_id"], False),
    ("donors", "idx_donors_org", ["organization_id"], False),
    ("equipment_kits", "ix_equipment_kits_organization_id", ["organization_id"], False),
    (
        "event_hour_mappings",
        "ix_event_hour_mappings_org_event_type",
        ["organization_id", "event_type"],
        False,
    ),
    (
        "event_hour_mappings",
        "ix_event_hour_mappings_org_id",
        ["organization_id"],
        False,
    ),
    ("event_rsvps", "ix_event_rsvps_event_id", ["event_id"], False),
    ("external_category_mappings", "idx_ext_mapping_provider", ["provider_id"], False),
    (
        "external_training_imports",
        "ix_external_training_imports_provider_id",
        ["provider_id"],
        False,
    ),
    (
        "external_training_providers",
        "ix_external_training_providers_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "external_training_sync_logs",
        "ix_external_training_sync_logs_provider_id",
        ["provider_id"],
        False,
    ),
    ("external_user_mappings", "idx_ext_user_provider", ["provider_id"], False),
    ("facilities", "idx_facilities_org", ["organization_id"], False),
    (
        "facility_maintenance_types",
        "idx_facility_maint_types_org",
        ["organization_id"],
        False,
    ),
    ("facility_rooms", "idx_facility_rooms_facility", ["facility_id"], False),
    ("facility_statuses", "idx_facility_statuses_org", ["organization_id"], False),
    ("facility_systems", "idx_facility_systems_facility", ["facility_id"], False),
    ("facility_types", "idx_facility_types_org", ["organization_id"], False),
    (
        "facility_utility_accounts",
        "idx_facility_utility_facility",
        ["facility_id"],
        False,
    ),
    ("form_integrations", "idx_form_integrations_form", ["form_id"], False),
    (
        "fundraising_campaigns",
        "idx_fundraising_campaigns_org",
        ["organization_id"],
        False,
    ),
    ("fundraising_events", "idx_fundraising_events_org", ["organization_id"], False),
    ("inventory_lots", "ix_inventory_lots_organization_id", ["organization_id"], False),
    (
        "inventory_write_offs",
        "ix_inventory_write_offs_organization_id",
        ["organization_id"],
        False,
    ),
    ("ip_exceptions", "ix_ip_exceptions_exception_type", ["exception_type"], False),
    ("issuance_allowances", "idx_allowances_org", ["organization_id"], False),
    (
        "item_variant_groups",
        "ix_item_variant_groups_organization_id",
        ["organization_id"],
        False,
    ),
    ("locations", "ix_locations_facility_room_id", ["facility_room_id"], False),
    (
        "manual_ballot_attestations",
        "ix_manual_ballot_attestations_batch_id",
        ["batch_id"],
        False,
    ),
    ("nfpa_item_compliance", "idx_nfpa_compliance_org", ["organization_id"], False),
    ("notification_logs", "idx_notif_logs_org", ["organization_id"], False),
    ("notification_rules", "idx_notif_rules_org", ["organization_id"], False),
    ("operational_ranks", "ix_operational_ranks_org", ["organization_id"], False),
    ("password_history", "ix_password_history_user_id", ["user_id"], False),
    ("pledges", "idx_pledges_org", ["organization_id"], False),
    ("positions", "idx_role_org_id", ["organization_id"], False),
    ("program_phases", "idx_phase_program", ["program_id", "phase_number"], False),
    (
        "prospect_event_links",
        "idx_prospect_event_link_prospect",
        ["prospect_id"],
        False,
    ),
    ("prospect_interviews", "idx_interview_prospect", ["prospect_id"], False),
    (
        "public_portal_access_log",
        "ix_public_portal_access_log_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "public_portal_config",
        "ix_public_portal_config_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "public_portal_data_whitelist",
        "ix_public_portal_data_whitelist_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "requirement_progress_credits",
        "idx_progress_credit_progress",
        ["progress_id"],
        False,
    ),
    (
        "scheduled_emails",
        "ix_scheduled_emails_organization_id",
        ["organization_id"],
        False,
    ),
    ("screening_records", "idx_screening_rec_org", ["organization_id"], False),
    ("screening_requirements", "idx_screening_req_org", ["organization_id"], False),
    ("security_alerts", "ix_security_alerts_alert_type", ["alert_type"], False),
    (
        "security_alerts",
        "ix_security_alerts_organization_id",
        ["organization_id"],
        False,
    ),
    ("self_report_configs", "idx_self_report_config_org", ["organization_id"], False),
    ("shift_assignments", "idx_shift_assign_shift", ["shift_id"], False),
    (
        "shift_equipment_checks",
        "ix_shift_equipment_checks_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "shift_equipment_checks",
        "ix_shift_equipment_checks_shift_id",
        ["shift_id"],
        False,
    ),
    (
        "store_order_windows",
        "ix_store_order_windows_organization_id",
        ["organization_id"],
        False,
    ),
    ("store_orders", "ix_store_orders_organization_id", ["organization_id"], False),
    (
        "store_payment_events",
        "ix_store_payment_events_organization_id",
        ["organization_id"],
        False,
    ),
    (
        "store_product_variants",
        "ix_store_product_variants_product_id",
        ["product_id"],
        False,
    ),
    ("store_products", "ix_store_products_organization_id", ["organization_id"], False),
    (
        "store_window_products",
        "ix_store_window_products_window_id",
        ["window_id"],
        False,
    ),
    (
        "training_categories",
        "ix_training_categories_organization_id",
        ["organization_id"],
        False,
    ),
    ("training_courses", "idx_course_org", ["organization_id"], False),
    ("training_module_configs", "idx_training_config_org", ["organization_id"], False),
    ("training_records", "idx_record_user", ["user_id"], False),
    ("training_requirements", "idx_requirement_org", ["organization_id"], False),
    ("user_consents", "ix_user_consents_user_id", ["user_id"], False),
    ("users", "idx_user_org_id", ["organization_id"], False),
    ("voting_tokens", "ix_voting_tokens_token", ["token"], False),
]


def _duplicate_check(bind) -> None:
    """Refuse to build the unique index if existing rows already collide."""
    inspector = sa.inspect(bind)
    if not inspector.has_table("inventory_items"):
        return
    if "uq_item_org_serial_number" in {
        ix["name"] for ix in inspector.get_indexes("inventory_items")
    }:
        return

    rows = bind.execute(
        sa.text(
            "SELECT organization_id, serial_number, COUNT(*) AS n "
            "FROM inventory_items "
            "WHERE serial_number IS NOT NULL AND serial_number <> '' "
            "GROUP BY organization_id, serial_number HAVING n > 1 LIMIT 20"
        )
    ).fetchall()
    if rows:
        listed = "\n".join(
            f"  org {r.organization_id}: serial {r.serial_number!r} x{r.n}"
            for r in rows
        )
        raise RuntimeError(
            "Cannot add uq_item_org_serial_number — these serial numbers are "
            "already duplicated within an organization:\n"
            + listed
            + "\n\nResolve the duplicates and re-run. Nothing has been changed."
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    _duplicate_check(bind)

    added_fks = 0
    for table, column, ref_table, ref_col, ondelete in _MISSING_FKS:
        if table not in tables or ref_table not in tables:
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        held = {
            (fk["constrained_columns"] or [None])[0]
            for fk in inspector.get_foreign_keys(table)
        }
        if column in held:
            continue
        op.create_foreign_key(
            f"fk_{table}_{column}_{ref_table}",
            table,
            ref_table,
            [column],
            [ref_col],
            ondelete=ondelete,
        )
        added_fks += 1

    # Create before dropping: a foreign key must never be momentarily left
    # without an index MySQL can use to enforce it.
    created = 0
    for table, name, columns, unique in _CREATE:
        if table not in tables:
            continue
        if name in {ix["name"] for ix in inspector.get_indexes(table)}:
            continue
        if not set(columns).issubset({c["name"] for c in inspector.get_columns(table)}):
            continue
        op.create_index(name, table, list(columns), unique=unique)
        created += 1

    dropped = 0
    for table, name, columns, _unique in _DROP:
        if table not in tables:
            continue
        indexes = {
            ix["name"]: ix["column_names"] for ix in inspector.get_indexes(table)
        }
        if name not in indexes:
            continue
        # Only drop when another index still leads with the same column, so an
        # FK is never left without a usable index (MySQL error 1553).
        lead = columns[0]
        if not any(
            other != name and cols and cols[0] == lead
            for other, cols in indexes.items()
        ):
            continue
        op.drop_index(name, table_name=table)
        dropped += 1

    print(
        f"Index reconcile: +{added_fks} foreign key(s), "
        f"+{created} index(es), -{dropped} redundant index(es)"
    )


def downgrade() -> None:
    # Recreating redundant indexes would restore only their write cost.
    pass
