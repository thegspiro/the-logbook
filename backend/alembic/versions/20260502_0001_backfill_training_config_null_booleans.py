"""Backfill NULL boolean columns in training_module_configs

Several boolean columns on training_module_configs were added in later
migrations without backfilling existing rows, leaving NULL values that
break the response schema (which declares them as required ``bool``).
``TrainingModuleConfigResponse.coerce_null_booleans`` already substitutes
defaults at serialization time, but persisting the defaults in the
database is the more correct fix and avoids silently relying on the
schema layer for new boolean columns going forward.

Revision ID: 20260502_0001
Revises: 20260411_0200
Create Date: 2026-05-02
"""

from alembic import op


revision = "20260502_0001"
down_revision = "20260411_0200"
branch_labels = None
depends_on = None


# Mirrors schemas.training_module_config._BOOL_FIELD_DEFAULTS so the
# database state matches what the response schema would have coerced.
_BOOL_DEFAULTS = {
    "form_show_performance_rating": True,
    "form_show_areas_of_strength": True,
    "form_show_areas_for_improvement": True,
    "form_show_officer_narrative": True,
    "form_show_skills_observed": True,
    "form_show_tasks_performed": True,
    "form_show_call_types": True,
    "shift_reports_enabled": True,
    "shift_reports_include_training": True,
    "report_review_required": False,
    "manual_entry_enabled": False,
    "manual_entry_require_apparatus": True,
}


def upgrade() -> None:
    for column, default in _BOOL_DEFAULTS.items():
        op.execute(
            f"UPDATE training_module_configs "
            f"SET {column} = {1 if default else 0} "
            f"WHERE {column} IS NULL"
        )


def downgrade() -> None:
    # Backfilled values are indistinguishable from explicit user choices,
    # so a downgrade cannot meaningfully revert this change.
    pass
