"""Add container_type to check template compartments

Lets departments describe storage containers in their own terms
(compartment, bag, pack, cabinet, drawer, ...) rather than everything
being a generic "compartment". Existing rows backfill to "compartment".

Revision ID: 20260723_0001
Revises: 20260722_0001
Create Date: 2026-07-17 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260723_0001"
down_revision = "20260722_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default backfills existing rows so the NOT NULL column is
    # valid immediately; the ORM supplies the default for new rows.
    op.add_column(
        "check_template_compartments",
        sa.Column(
            "container_type",
            sa.String(length=50),
            nullable=False,
            server_default="compartment",
        ),
    )


def downgrade() -> None:
    op.drop_column("check_template_compartments", "container_type")
