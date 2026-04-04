"""Add report form section toggles to training_module_configs

Adds form_show_* columns that control which optional sections
appear on the shift completion report creation form. These are
separate from the existing show_* visibility columns which
control what trainees see after submission.

Revision ID: 20260404_0200
Revises: 20260404_0100
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260404_0200"
down_revision = "20260404_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_performance_rating",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_areas_of_strength",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_areas_for_improvement",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_officer_narrative",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_skills_observed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_tasks_performed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "training_module_configs",
        sa.Column(
            "form_show_call_types",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "training_module_configs",
        "form_show_call_types",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_tasks_performed",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_skills_observed",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_officer_narrative",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_areas_for_improvement",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_areas_of_strength",
    )
    op.drop_column(
        "training_module_configs",
        "form_show_performance_rating",
    )
