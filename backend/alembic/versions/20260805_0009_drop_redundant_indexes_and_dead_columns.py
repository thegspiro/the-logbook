"""Drop 136 redundant duplicate indexes and two dead columns

**Duplicate indexes.** 136 columns carried both ``index=True`` on the column and
an identical explicit ``Index(...)`` in ``__table_args__``, so the schema held
two byte-identical single-column B-trees per column. Every insert, update and
delete maintained both for no benefit — no query plan can prefer one over an
identical twin. The concentration is heaviest in ``training`` (46),
``apparatus`` (26) and ``facilities`` (22).

The models now keep only the explicitly named index, because that name is the
one the migrations created and the one anyone reading ``__table_args__`` sees.
This revision drops the auto-generated ``ix_<table>_<column>`` twin from
databases that already have both.

Each drop is guarded: the twin is removed only when another index with the same
leading column survives. That matters because most of these columns are foreign
keys, and MySQL refuses to drop the last index backing a foreign key
(error 1553). Checking first means the revision degrades to a no-op rather than
failing if a database's index set differs from what is expected.

**Dead columns.** ``users.membership_id`` and ``prospective_members.active_email``
exist only on chain-built databases — neither is in ``Base.metadata`` and nothing
in the codebase reads or writes either. (The ``membership_id`` hits in
``organization_service`` are a key inside the organization settings JSON, not
this column.)

Revision ID: 20260805_0009
Revises: 20260805_0008
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0009"
down_revision = "20260805_0008"
branch_labels = None
depends_on = None


# (table, redundant_index, index_that_must_survive)
_REDUNDANT_INDEXES = [
    (
        "apparatus_component_notes",
        "ix_apparatus_component_notes_apparatus_id",
        "idx_component_notes_apparatus",
    ),
    (
        "apparatus_component_notes",
        "ix_apparatus_component_notes_component_id",
        "idx_component_notes_component",
    ),
    (
        "apparatus_components",
        "ix_apparatus_components_apparatus_id",
        "idx_apparatus_components_apparatus",
    ),
    (
        "apparatus_documents",
        "ix_apparatus_documents_apparatus_id",
        "idx_apparatus_documents_apparatus",
    ),
    (
        "apparatus_equipment",
        "ix_apparatus_equipment_apparatus_id",
        "idx_apparatus_equipment_apparatus",
    ),
    (
        "apparatus_fuel_logs",
        "ix_apparatus_fuel_logs_apparatus_id",
        "idx_apparatus_fuel_apparatus",
    ),
    (
        "apparatus_location_history",
        "ix_apparatus_location_history_apparatus_id",
        "idx_apparatus_loc_hist_apparatus",
    ),
    (
        "apparatus_location_history",
        "ix_apparatus_location_history_location_id",
        "idx_apparatus_loc_hist_location",
    ),
    (
        "apparatus_maintenance",
        "ix_apparatus_maintenance_apparatus_id",
        "idx_apparatus_maint_apparatus",
    ),
    (
        "apparatus_maintenance",
        "ix_apparatus_maintenance_component_id",
        "idx_apparatus_maint_component",
    ),
    (
        "apparatus_maintenance",
        "ix_apparatus_maintenance_maintenance_type_id",
        "idx_apparatus_maint_type",
    ),
    (
        "apparatus_maintenance",
        "ix_apparatus_maintenance_service_provider_id",
        "idx_apparatus_maint_provider",
    ),
    (
        "apparatus_nfpa_compliance",
        "ix_apparatus_nfpa_compliance_apparatus_id",
        "idx_apparatus_nfpa_apparatus",
    ),
    (
        "apparatus_operators",
        "ix_apparatus_operators_apparatus_id",
        "idx_apparatus_operators_apparatus",
    ),
    (
        "apparatus_operators",
        "ix_apparatus_operators_user_id",
        "idx_apparatus_operators_user",
    ),
    (
        "apparatus_photos",
        "ix_apparatus_photos_apparatus_id",
        "idx_apparatus_photos_apparatus",
    ),
    (
        "apparatus_report_configs",
        "ix_apparatus_report_configs_organization_id",
        "idx_apparatus_report_configs_org",
    ),
    (
        "apparatus_service_providers",
        "ix_apparatus_service_providers_organization_id",
        "idx_service_providers_org",
    ),
    (
        "apparatus_status_history",
        "ix_apparatus_status_history_apparatus_id",
        "idx_apparatus_status_hist_apparatus",
    ),
    (
        "apparatus_status_history",
        "ix_apparatus_status_history_status_id",
        "idx_apparatus_status_hist_status",
    ),
    ("audit_logs", "ix_audit_logs_current_hash", "idx_audit_current_hash"),
    ("audit_logs", "ix_audit_logs_event_type", "idx_audit_event_type"),
    ("audit_logs", "ix_audit_logs_user_id", "idx_audit_user_id"),
    (
        "basic_apparatus",
        "ix_basic_apparatus_organization_id",
        "idx_basic_apparatus_org",
    ),
    (
        "blocked_access_attempts",
        "ix_blocked_access_attempts_user_id",
        "idx_blocked_user",
    ),
    (
        "check_template_compartments",
        "ix_check_template_compartments_template_id",
        "idx_check_compartment_template",
    ),
    (
        "check_template_items",
        "ix_check_template_items_compartment_id",
        "idx_check_item_compartment",
    ),
    (
        "department_messages",
        "ix_department_messages_organization_id",
        "idx_dept_msg_org",
    ),
    ("document_folders", "ix_document_folders_organization_id", "idx_doc_folders_org"),
    ("documents", "ix_documents_folder_id", "idx_documents_folder"),
    ("documents", "ix_documents_organization_id", "idx_documents_org"),
    (
        "equipment_check_templates",
        "ix_equipment_check_templates_apparatus_id",
        "idx_equip_check_tmpl_apparatus",
    ),
    (
        "equipment_check_templates",
        "ix_equipment_check_templates_organization_id",
        "idx_equip_check_tmpl_org",
    ),
    ("equipment_kits", "ix_equipment_kits_organization_id", "idx_kits_org"),
    (
        "event_request_activity",
        "ix_event_request_activity_request_id",
        "idx_event_req_activity_request",
    ),
    (
        "event_request_email_templates",
        "ix_event_request_email_templates_organization_id",
        "idx_email_tpl_org",
    ),
    (
        "external_category_mappings",
        "ix_external_category_mappings_provider_id",
        "idx_ext_mapping_provider",
    ),
    (
        "external_training_imports",
        "ix_external_training_imports_user_id",
        "idx_ext_import_user",
    ),
    (
        "external_user_mappings",
        "ix_external_user_mappings_provider_id",
        "idx_ext_user_provider",
    ),
    ("facilities", "ix_facilities_organization_id", "idx_facilities_org"),
    (
        "facility_access_keys",
        "ix_facility_access_keys_facility_id",
        "idx_facility_access_keys_facility",
    ),
    (
        "facility_capital_projects",
        "ix_facility_capital_projects_facility_id",
        "idx_facility_capital_facility",
    ),
    (
        "facility_compliance_checklists",
        "ix_facility_compliance_checklists_facility_id",
        "idx_facility_compliance_facility",
    ),
    (
        "facility_compliance_items",
        "ix_facility_compliance_items_checklist_id",
        "idx_facility_compliance_items_checklist",
    ),
    (
        "facility_documents",
        "ix_facility_documents_facility_id",
        "idx_facility_documents_facility",
    ),
    (
        "facility_emergency_contacts",
        "ix_facility_emergency_contacts_facility_id",
        "idx_facility_emerg_contacts_facility",
    ),
    (
        "facility_inspections",
        "ix_facility_inspections_facility_id",
        "idx_facility_inspections_facility",
    ),
    (
        "facility_insurance_policies",
        "ix_facility_insurance_policies_facility_id",
        "idx_facility_insurance_facility",
    ),
    (
        "facility_maintenance",
        "ix_facility_maintenance_facility_id",
        "idx_facility_maint_facility",
    ),
    (
        "facility_maintenance",
        "ix_facility_maintenance_maintenance_type_id",
        "idx_facility_maint_type",
    ),
    (
        "facility_maintenance",
        "ix_facility_maintenance_system_id",
        "idx_facility_maint_system",
    ),
    (
        "facility_maintenance_types",
        "ix_facility_maintenance_types_organization_id",
        "idx_facility_maint_types_org",
    ),
    (
        "facility_occupants",
        "ix_facility_occupants_facility_id",
        "idx_facility_occupants_facility",
    ),
    (
        "facility_photos",
        "ix_facility_photos_facility_id",
        "idx_facility_photos_facility",
    ),
    ("facility_rooms", "ix_facility_rooms_facility_id", "idx_facility_rooms_facility"),
    (
        "facility_shutoff_locations",
        "ix_facility_shutoff_locations_facility_id",
        "idx_facility_shutoffs_facility",
    ),
    (
        "facility_statuses",
        "ix_facility_statuses_organization_id",
        "idx_facility_statuses_org",
    ),
    (
        "facility_systems",
        "ix_facility_systems_facility_id",
        "idx_facility_systems_facility",
    ),
    ("facility_types", "ix_facility_types_organization_id", "idx_facility_types_org"),
    (
        "facility_utility_accounts",
        "ix_facility_utility_accounts_facility_id",
        "idx_facility_utility_facility",
    ),
    (
        "facility_utility_readings",
        "ix_facility_utility_readings_utility_account_id",
        "idx_facility_utility_readings_account",
    ),
    ("form_integrations", "ix_form_integrations_form_id", "idx_form_integrations_form"),
    (
        "instructor_qualifications",
        "ix_instructor_qualifications_course_id",
        "idx_instructor_qual_course",
    ),
    (
        "instructor_qualifications",
        "ix_instructor_qualifications_expiration_date",
        "idx_instructor_qual_expiration",
    ),
    (
        "instructor_qualifications",
        "ix_instructor_qualifications_skill_evaluation_id",
        "idx_instructor_qual_skill",
    ),
    (
        "inventory_impact_plans",
        "ix_inventory_impact_plans_organization_id",
        "idx_impact_plans_org",
    ),
    (
        "inventory_items",
        "ix_inventory_items_variant_group_id",
        "idx_inventory_items_variant_group",
    ),
    (
        "ip_exception_audit_log",
        "ix_ip_exception_audit_log_action",
        "idx_exception_audit_action",
    ),
    (
        "ip_exception_audit_log",
        "ix_ip_exception_audit_log_exception_id",
        "idx_exception_audit_exception",
    ),
    (
        "ip_exception_audit_log",
        "ix_ip_exception_audit_log_performed_at",
        "idx_exception_audit_time",
    ),
    ("ip_exceptions", "ix_ip_exceptions_approval_status", "idx_ip_exception_approval"),
    ("ip_exceptions", "ix_ip_exceptions_ip_address", "idx_ip_exception_ip"),
    ("ip_exceptions", "ix_ip_exceptions_organization_id", "idx_ip_exception_org"),
    ("ip_exceptions", "ix_ip_exceptions_user_id", "idx_ip_exception_user"),
    (
        "issuance_allowances",
        "ix_issuance_allowances_organization_id",
        "idx_allowances_org",
    ),
    (
        "item_variant_groups",
        "ix_item_variant_groups_organization_id",
        "idx_variant_groups_org",
    ),
    (
        "meeting_action_items",
        "ix_meeting_action_items_meeting_id",
        "idx_action_items_meeting",
    ),
    (
        "meeting_attendees",
        "ix_meeting_attendees_meeting_id",
        "idx_meeting_attendees_meeting",
    ),
    (
        "meeting_attendees",
        "ix_meeting_attendees_organization_id",
        "idx_meeting_attendees_organization",
    ),
    ("meeting_attendees", "ix_meeting_attendees_user_id", "idx_meeting_attendees_user"),
    (
        "member_competencies",
        "ix_member_competencies_organization_id",
        "idx_member_comp_org",
    ),
    (
        "multi_agency_trainings",
        "ix_multi_agency_trainings_organization_id",
        "idx_multi_agency_org",
    ),
    (
        "multi_agency_trainings",
        "ix_multi_agency_trainings_training_session_id",
        "idx_multi_agency_session",
    ),
    (
        "nfpa_item_compliance",
        "ix_nfpa_item_compliance_organization_id",
        "idx_nfpa_compliance_org",
    ),
    ("notification_logs", "ix_notification_logs_organization_id", "idx_notif_logs_org"),
    (
        "notification_logs",
        "ix_notification_logs_recipient_id",
        "idx_notif_logs_recipient",
    ),
    (
        "notification_rules",
        "ix_notification_rules_organization_id",
        "idx_notif_rules_org",
    ),
    ("program_milestones", "ix_program_milestones_program_id", "idx_milestone_program"),
    ("program_requirements", "ix_program_requirements_phase_id", "idx_prog_req_phase"),
    (
        "program_requirements",
        "ix_program_requirements_program_id",
        "idx_prog_req_program",
    ),
    (
        "prospect_activity_log",
        "ix_prospect_activity_log_prospect_id",
        "idx_activity_log_prospect",
    ),
    (
        "prospect_documents",
        "ix_prospect_documents_prospect_id",
        "idx_prospect_doc_prospect",
    ),
    (
        "prospect_election_packages",
        "ix_prospect_election_packages_prospect_id",
        "idx_election_pkg_prospect",
    ),
    (
        "prospect_interviews",
        "ix_prospect_interviews_interviewer_id",
        "idx_interview_interviewer",
    ),
    (
        "prospect_interviews",
        "ix_prospect_interviews_prospect_id",
        "idx_interview_prospect",
    ),
    (
        "public_portal_access_log",
        "ix_public_portal_access_log_ip_address",
        "idx_access_log_ip",
    ),
    (
        "public_portal_data_whitelist",
        "ix_public_portal_data_whitelist_data_category",
        "idx_whitelist_category",
    ),
    (
        "recertification_pathways",
        "ix_recertification_pathways_source_requirement_id",
        "idx_recert_pathway_source",
    ),
    ("renewal_tasks", "ix_renewal_tasks_pathway_id", "idx_renewal_task_pathway"),
    (
        "requirement_progress",
        "ix_requirement_progress_requirement_id",
        "idx_progress_requirement",
    ),
    (
        "requirement_progress_credits",
        "ix_requirement_progress_credits_progress_id",
        "idx_progress_credit_progress",
    ),
    ("saved_reports", "ix_saved_reports_organization_id", "ix_saved_reports_org"),
    (
        "shift_assignments",
        "ix_shift_assignments_organization_id",
        "idx_shift_assign_org",
    ),
    ("shift_assignments", "ix_shift_assignments_shift_id", "idx_shift_assign_shift"),
    ("shift_assignments", "ix_shift_assignments_user_id", "idx_shift_assign_user"),
    ("shift_attendance", "ix_shift_attendance_shift_id", "idx_shift_att_shift"),
    ("shift_attendance", "ix_shift_attendance_user_id", "idx_shift_att_user"),
    ("shift_calls", "ix_shift_calls_incident_type", "idx_call_type"),
    ("shift_calls", "ix_shift_calls_shift_id", "idx_call_shift"),
    (
        "shift_completion_reports",
        "ix_shift_completion_reports_officer_id",
        "idx_shift_report_officer",
    ),
    (
        "shift_equipment_check_items",
        "ix_shift_equipment_check_items_check_id",
        "idx_shift_equip_check_item_check",
    ),
    (
        "shift_equipment_checks",
        "ix_shift_equipment_checks_organization_id",
        "idx_shift_equip_check_org",
    ),
    (
        "shift_equipment_checks",
        "ix_shift_equipment_checks_shift_id",
        "idx_shift_equip_check_shift",
    ),
    ("shift_patterns", "ix_shift_patterns_organization_id", "idx_shift_pattern_org"),
    (
        "shift_swap_requests",
        "ix_shift_swap_requests_organization_id",
        "idx_swap_req_org",
    ),
    ("shift_templates", "ix_shift_templates_organization_id", "idx_shift_template_org"),
    ("shift_time_off", "ix_shift_time_off_organization_id", "idx_timeoff_org"),
    ("shift_time_off", "ix_shift_time_off_user_id", "idx_timeoff_user"),
    ("skill_checkoffs", "ix_skill_checkoffs_skill_evaluation_id", "idx_checkoff_skill"),
    ("skill_checkoffs", "ix_skill_checkoffs_user_id", "idx_checkoff_user"),
    ("storage_areas", "ix_storage_areas_location_id", "idx_storage_areas_location"),
    ("storage_areas", "ix_storage_areas_organization_id", "idx_storage_areas_org"),
    ("storage_areas", "ix_storage_areas_parent_id", "idx_storage_areas_parent"),
    (
        "template_change_logs",
        "ix_template_change_logs_organization_id",
        "idx_tmpl_changelog_org",
    ),
    (
        "template_change_logs",
        "ix_template_change_logs_template_id",
        "idx_tmpl_changelog_template",
    ),
    ("training_approvals", "ix_training_approvals_status", "idx_approval_status"),
    (
        "training_approvals",
        "ix_training_approvals_training_session_id",
        "idx_approval_session",
    ),
    (
        "training_effectiveness_evaluations",
        "ix_training_effectiveness_evaluations_organization_id",
        "idx_effectiveness_org",
    ),
    (
        "training_effectiveness_evaluations",
        "ix_training_effectiveness_evaluations_training_record_id",
        "idx_effectiveness_record",
    ),
    (
        "training_effectiveness_evaluations",
        "ix_training_effectiveness_evaluations_user_id",
        "idx_effectiveness_user",
    ),
    ("training_records", "ix_training_records_category_id", "idx_record_category"),
    ("training_records", "ix_training_records_location_id", "idx_record_location"),
    (
        "training_sessions",
        "ix_training_sessions_organization_id",
        "idx_training_session_org",
    ),
    ("xapi_statements", "ix_xapi_statements_actor_email", "idx_xapi_actor"),
    ("xapi_statements", "ix_xapi_statements_organization_id", "idx_xapi_org"),
    ("xapi_statements", "ix_xapi_statements_processed", "idx_xapi_processed"),
]

# (table, column) — present only on chain-built databases, referenced nowhere.
_DEAD_COLUMNS = [
    ("users", "membership_id"),
    ("prospective_members", "active_email"),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    dropped = 0
    for table, redundant, survivor in _REDUNDANT_INDEXES:
        if table not in tables:
            continue
        names = {ix["name"] for ix in inspector.get_indexes(table)}
        # Only drop the twin when its replacement is actually present — MySQL
        # rejects dropping the last index backing a foreign key (error 1553).
        if redundant in names and survivor in names:
            op.drop_index(redundant, table_name=table)
            dropped += 1

    removed = 0
    for table, column in _DEAD_COLUMNS:
        if table not in tables:
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue

        # A column that participates in a composite index cannot be dropped
        # while that index exists — MySQL raises 1072 rather than rebuilding
        # the index for you. users.membership_id is the second column of
        # idx_user_org_membership_id, so the index goes first.
        for ix in inspector.get_indexes(table):
            if column in ix["column_names"]:
                op.drop_index(ix["name"], table_name=table)

        op.drop_column(table, column)
        removed += 1

    print(f"Dropped {dropped} redundant index(es), {removed} dead column(s)")


def downgrade() -> None:
    # Recreating identical duplicate indexes and unused columns would restore
    # only the write overhead they cost.
    pass
