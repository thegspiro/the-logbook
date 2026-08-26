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


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # `equipment_requests` is one of the tables no migration creates -- it comes
    # into being when main.py's fast-path init calls create_all() and stamps
    # Alembic at head. CI runs `alembic upgrade head` against an empty database
    # before anything calls create_all, so altering it unguarded kills the whole
    # upgrade. Skipping is correct rather than merely safe: a table create_all
    # builds later is built from the models, which already declare this column.
    if not _has_table("equipment_requests"):
        return
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
    if not _has_table("equipment_requests"):
        return
    op.drop_column("equipment_requests", "requested_duration")
