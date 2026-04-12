"""Add admin_hours_requirements to compliance_profiles

Extends compliance profiles to include admin hours category targets
alongside existing training requirements.

Revision ID: 20260321_0300
Revises: 20260321_0200
Create Date: 2026-03-21 03:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260321_0300"
down_revision = "20260321_0201"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "compliance_profiles",
        sa.Column(
            "admin_hours_requirements",
            sa.JSON(),
            nullable=True,
            comment=(
                "List of {category_id, required_hours, frequency} objects. "
                "Defines yearly/quarterly admin hours targets per category."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("compliance_profiles", "admin_hours_requirements")
