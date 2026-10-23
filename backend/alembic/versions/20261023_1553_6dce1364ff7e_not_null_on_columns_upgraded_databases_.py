"""NOT NULL on the 99 columns upgraded databases already enforce.

Revision ID: 6dce1364ff7e
Revises: f938324f8081
Create Date: 2026-10-23 15:53:00

These columns were created ``NOT NULL`` with a default by the migration chain,
but the models declared them nullable, so the two kinds of database disagreed:

- An **upgraded** database (the chain) rejected an explicit NULL with MySQL
  1048. ``apply_updates`` reads nullability from the models, so it let the
  null through, and the request failed at flush with a 500 or a generic 400.
- A **fresh install** (``create_all``) stored the NULL. A NULL "show training
  hours" or inventory ``quantity`` means nothing to the code that reads it.

The models now declare ``nullable=False`` with the upgraded databases'
defaults, so ``apply_updates`` refuses the null with a ValueError (400) on
both. This revision brings fresh installs into line:

- a table or column that is absent is skipped (pitfall #26);
- a column that is already ``NOT NULL`` (every upgraded database) is skipped;
- otherwise any stored NULL is set to the column's default, and the column is
  made ``NOT NULL`` with that default, one ``ALTER`` per table so each table is
  rebuilt at most once.

The type, character set, collation and comment are read from the live column
so the ``MODIFY`` changes nothing else. The defaults are frozen here rather
than read from the models, so the revision transforms rows the same way on
every run (CLAUDE.md pitfall #20).

Downgrade is a deliberate no-op. Upgraded databases had these constraints from
their first revision, so dropping them would make the two shapes disagree
again; and the NULLs this revision replaced carried no meaning to restore.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6dce1364ff7e"
down_revision: Union[str, None] = "f938324f8081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# table -> [(column, SQL default literal)], as upgraded databases define them.
_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "checkout_records": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("is_overdue", "0"),
        ("is_returned", "0"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "department_messages": [
        ("is_persistent", "0"),
    ],
    "document_folders": [
        ("is_system", "0"),
        ("sort_order", "0"),
    ],
    "documents": [
        ("document_type", "'uploaded'"),
    ],
    "equipment_kit_items": [
        ("size_selectable", "0"),
        ("sort_order", "0"),
    ],
    "equipment_kits": [
        ("active", "1"),
    ],
    "inventory_categories": [
        ("active", "1"),
        ("created_at", "CURRENT_TIMESTAMP"),
        ("requires_assignment", "0"),
        ("requires_maintenance", "0"),
        ("requires_serial_number", "0"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "inventory_items": [
        ("active", "1"),
        ("created_at", "CURRENT_TIMESTAMP"),
        ("quantity", "1"),
        ("quantity_issued", "0"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "item_assignments": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("is_active", "1"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "item_issuances": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("is_returned", "0"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "item_variant_groups": [
        ("active", "1"),
    ],
    "maintenance_records": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("is_completed", "0"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "membership_pipeline_steps": [
        ("notify_prospect_on_completion", "0"),
        ("public_visible", "1"),
    ],
    "membership_pipelines": [
        ("public_status_enabled", "0"),
    ],
    "nfpa_exposure_records": [
        ("decon_completed", "0"),
        ("decon_required", "0"),
    ],
    "nfpa_item_compliance": [
        ("is_retired_by_age", "0"),
    ],
    "notification_logs": [
        ("pinned", "0"),
    ],
    "program_enrollments": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("status", "'active'"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "program_milestones": [
        ("created_at", "CURRENT_TIMESTAMP"),
    ],
    "program_phases": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "program_requirements": [
        ("created_at", "CURRENT_TIMESTAMP"),
    ],
    "requirement_progress": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("status", "'not_started'"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "self_report_configs": [
        ("approval_deadline_days", "14"),
        ("notify_member_on_decision", "1"),
        ("notify_officer_on_submit", "1"),
        ("require_approval", "1"),
    ],
    "shift_attendance": [
        ("created_at", "CURRENT_TIMESTAMP"),
    ],
    "shift_calls": [
        ("created_at", "CURRENT_TIMESTAMP"),
    ],
    "shift_completion_reports": [
        ("calls_responded", "0"),
        ("review_status", "'approved'"),
        ("trainee_acknowledged", "0"),
    ],
    "shift_patterns": [
        ("is_active", "1"),
    ],
    "shift_templates": [
        ("is_active", "1"),
        ("is_default", "0"),
        ("min_staffing", "1"),
    ],
    "shifts": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "skill_checkoffs": [
        ("created_at", "CURRENT_TIMESTAMP"),
    ],
    "skill_evaluations": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "training_approvals": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "training_module_configs": [
        ("allow_member_report_export", "0"),
        ("form_show_areas_for_improvement", "1"),
        ("form_show_areas_of_strength", "1"),
        ("form_show_call_types", "1"),
        ("form_show_officer_narrative", "1"),
        ("form_show_performance_rating", "1"),
        ("form_show_skills_observed", "1"),
        ("form_show_tasks_performed", "1"),
        ("rating_label", "'Performance Rating'"),
        ("rating_scale_type", "'stars'"),
        ("report_review_required", "0"),
        ("report_review_role", "'training_officer'"),
        ("show_areas_for_improvement", "1"),
        ("show_areas_of_strength", "1"),
        ("show_certification_status", "1"),
        ("show_officer_narrative", "0"),
        ("show_performance_rating", "1"),
        ("show_pipeline_progress", "1"),
        ("show_requirement_details", "1"),
        ("show_shift_reports", "1"),
        ("show_shift_stats", "1"),
        ("show_skills_observed", "1"),
        ("show_submission_history", "1"),
        ("show_training_history", "1"),
        ("show_training_hours", "1"),
    ],
    "training_programs": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "training_sessions": [
        ("created_at", "CURRENT_TIMESTAMP"),
        ("updated_at", "CURRENT_TIMESTAMP"),
    ],
    "users": [
        ("status", "'active'"),
    ],
}


def _live_column(table: str, column: str):
    return (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT column_type, is_nullable, character_set_name, "
                "collation_name, column_comment "
                "FROM information_schema.columns "
                "WHERE table_schema = DATABASE() "
                "AND table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        )
        .fetchone()
    )


def _quote_comment(comment: str) -> str:
    """A string literal for COMMENT. Backslash only escapes without
    NO_BACKSLASH_ESCAPES, so it is doubled only when the server reads it so."""
    mode = op.get_bind().execute(sa.text("SELECT @@SESSION.sql_mode")).scalar() or ""
    if "NO_BACKSLASH_ESCAPES" not in mode:
        comment = comment.replace("\\", "\\\\")
    return "'" + comment.replace("'", "''") + "'"


def upgrade() -> None:
    bind = op.get_bind()
    for table, columns in _COLUMNS.items():
        clauses = []
        for column, default in columns:
            live = _live_column(table, column)
            if live is None or live.is_nullable == "NO":
                continue
            bind.execute(
                sa.text(
                    f"UPDATE `{table}` SET `{column}` = {default} "
                    f"WHERE `{column}` IS NULL"
                )
            )
            charset = (
                f" CHARACTER SET {live.character_set_name} COLLATE {live.collation_name}"
                if live.character_set_name
                else ""
            )
            comment = (
                " COMMENT " + _quote_comment(live.column_comment)
                if live.column_comment
                else ""
            )
            clauses.append(
                f"MODIFY `{column}` {live.column_type}{charset} "
                f"NOT NULL DEFAULT {default}{comment}"
            )
        if clauses:
            bind.execute(sa.text(f"ALTER TABLE `{table}` " + ", ".join(clauses)))


def downgrade() -> None:
    """Deliberately irreversible; see the module docstring.

    Upgraded databases carried these constraints from the start, and the NULLs
    the upgrade replaced held no meaning to put back.
    """
    return
