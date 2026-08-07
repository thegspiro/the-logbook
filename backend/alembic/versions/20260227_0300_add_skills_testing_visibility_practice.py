"""Add visibility to skill_templates and is_practice to skill_tests

Revision ID: 20260227_0300
Revises: 20260227_0250
Create Date: 2026-02-27

Adds template visibility control (all_members, officers_only, assigned_only)
and practice mode flag for test sessions that should not be recorded.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers
revision = "20260227_0300"
down_revision = "20260227_0250"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # skill_templates / skill_tests are model-only tables — no migration
    # creates them; deployments materialize them via create_all(), which
    # already includes these columns. On a fresh chain run (CI) the tables
    # don't exist yet, so there is nothing to alter.
    if "skill_templates" not in inspect(op.get_bind()).get_table_names():
        return

    op.add_column(
        "skill_templates",
        sa.Column(
            "visibility",
            sa.String(20),
            nullable=False,
            server_default="all_members",
        ),
    )
    op.add_column(
        "skill_tests",
        sa.Column(
            "is_practice",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("skill_tests", "is_practice")
    op.drop_column("skill_templates", "visibility")
