"""Add server-side defaults to training_module_configs boolean columns

Adds DB-level DEFAULT clauses to every boolean visibility/feature flag on
training_module_configs so that rows created outside the ORM (and any
boolean columns added in future migrations) start with the correct value
instead of NULL. Also backfills any pre-existing NULL values to the
schema-default so subsequent NOT NULL tightening is safe.

This complements migration 20260502_0001 (which backfilled the known
NULL bools) by applying defaults at the column-definition level so the
Pydantic ``coerce_null_booleans`` validator becomes a strictly defensive
fallback rather than load-bearing logic.

Revision ID: 20260502_0003
Revises: 20260502_0002
Create Date: 2026-05-02
"""

from alembic import op


revision = "20260502_0003"
down_revision = "20260502_0002"
branch_labels = None
depends_on = None


# Mirrors the SQLAlchemy model in app.models.training.TrainingModuleConfig.
# Order: (column_name, default_bool).
_COLUMNS = [
    ("show_training_history", True),
    ("show_training_hours", True),
    ("show_certification_status", True),
    ("show_pipeline_progress", True),
    ("show_requirement_details", True),
    ("show_shift_reports", True),
    ("show_shift_stats", True),
    ("show_officer_narrative", False),
    ("show_performance_rating", True),
    ("show_areas_of_strength", True),
    ("show_areas_for_improvement", True),
    ("show_skills_observed", True),
    ("show_submission_history", True),
    ("allow_member_report_export", False),
    ("report_review_required", False),
    ("form_show_performance_rating", True),
    ("form_show_areas_of_strength", True),
    ("form_show_areas_for_improvement", True),
    ("form_show_officer_narrative", True),
    ("form_show_skills_observed", True),
    ("form_show_tasks_performed", True),
    ("form_show_call_types", True),
    ("shift_reports_enabled", True),
    ("shift_reports_include_training", True),
    ("manual_entry_enabled", False),
    ("manual_entry_require_apparatus", True),
]


def upgrade() -> None:
    for column, default in _COLUMNS:
        default_value = 1 if default else 0
        # Backfill any rows where this column is currently NULL.
        op.execute(
            f"UPDATE training_module_configs "
            f"SET {column} = {default_value} "
            f"WHERE {column} IS NULL"
        )
        # Apply the column default at the database level so future inserts
        # that omit the column don't end up as NULL.
        op.execute(
            f"ALTER TABLE training_module_configs "
            f"ALTER COLUMN {column} SET DEFAULT {default_value}"
        )


def downgrade() -> None:
    for column, _ in _COLUMNS:
        op.execute(
            f"ALTER TABLE training_module_configs "
            f"ALTER COLUMN {column} DROP DEFAULT"
        )
