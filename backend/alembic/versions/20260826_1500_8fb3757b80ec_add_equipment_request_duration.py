"""Store equipment-request duration intent separately from fulfillment.

Revision ID: 8fb3757b80ec
Revises: e2c8f5a71d40
"""

import sqlalchemy as sa
from alembic import op

revision = "8fb3757b80ec"
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
    # `existing_type` is mandatory here, not decorative: MySQL has no
    # "alter nullability" verb, so Alembic emits MODIFY COLUMN, which restates
    # the whole definition. Without the type it raises "All MySQL CHANGE/MODIFY
    # COLUMN operations require the existing type" and takes the entire upgrade
    # down with it -- both database jobs in the matrix, on every branch.
    op.alter_column(
        "equipment_requests",
        "requested_duration",
        existing_type=sa.String(20),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("equipment_requests", "requested_duration")
