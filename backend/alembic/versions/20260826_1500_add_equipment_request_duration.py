"""Store equipment-request duration intent separately from fulfillment.

Revision ID: 20260826_1500
Revises: e2c8f5a71d40
"""

import sqlalchemy as sa
from alembic import op

revision = "20260826_1500"
down_revision = "e2c8f5a71d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_requests",
        sa.Column("requested_duration", sa.String(20), nullable=True),
    )
    op.execute(
        "UPDATE equipment_requests SET requested_duration = "
        "CASE WHEN request_type = 'checkout' THEN 'temporary' ELSE 'ongoing' END"
    )
    op.alter_column("equipment_requests", "requested_duration", nullable=False)


def downgrade() -> None:
    op.drop_column("equipment_requests", "requested_duration")
