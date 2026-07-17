"""Add scheduled_at to department_messages for deferred publishing

A future scheduled_at means the message is not yet live (hidden from inboxes
and not yet escalated). The publish task clears it to NULL when the message
goes live, so NULL means published/immediate.

Revision ID: 20260720_0003
Revises: 20260720_0002
Create Date: 2026-07-20 00:03:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260720_0003"
down_revision = "20260720_0002"
branch_labels = None
depends_on = None

TABLE = "department_messages"
INDEX = "idx_dept_msg_scheduled_at"


def _has_column(inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector, table: str, index: str) -> bool:
    return any(ix["name"] == index for ix in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, TABLE, "scheduled_at"):
        op.add_column(
            TABLE,
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not _has_index(inspector, TABLE, INDEX):
        op.create_index(INDEX, TABLE, ["scheduled_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_index(inspector, TABLE, INDEX):
        op.drop_index(INDEX, table_name=TABLE)

    if _has_column(inspector, TABLE, "scheduled_at"):
        op.drop_column(TABLE, "scheduled_at")
