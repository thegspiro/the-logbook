"""Add visibility to skill_templates and is_practice to skill_tests

Revision ID: 20260227_0300
Revises: 20260227_0200
Create Date: 2026-02-27

Adds template visibility control (all_members, officers_only, assigned_only)
and practice mode flag for test sessions that should not be recorded.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260227_0300"
down_revision = "20260227_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
