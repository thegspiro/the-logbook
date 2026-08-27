"""Store equipment-request duration intent separately from fulfillment.

Revision ID: 8fb3757b80ec
Revises: e2c8f5a71d40
"""

import sqlalchemy as sa
from alembic import op

revision = "8fb3757b80ec"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


_TABLE = "equipment_requests"
_COLUMN = "requested_duration"


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    # Guarded on the column already existing. Models are this schema's record
    # and migrations are alterations on top: an installation that starts the
    # app on this code before running the upgrade gets the column from
    # `create_all()`/`repair_schema.py`, because the model declares it, while
    # Alembic is still on the previous revision. The unguarded ADD COLUMN then
    # fails with "Duplicate column name 'requested_duration'" and takes the
    # whole upgrade with it. CI never sees this -- it migrates a database
    # nothing has started against -- so the shape has to be right by
    # construction rather than by a green matrix.
    inspector = sa.inspect(op.get_bind())
    if _has_column(inspector, _TABLE, _COLUMN):
        return

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
    inspector = sa.inspect(op.get_bind())
    if not _has_column(inspector, _TABLE, _COLUMN):
        return
    op.drop_column("equipment_requests", "requested_duration")
