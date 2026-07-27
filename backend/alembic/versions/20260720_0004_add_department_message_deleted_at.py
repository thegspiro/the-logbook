"""Add deleted_at soft-delete column and expiry index to department_messages

Soft delete preserves DepartmentMessageRead rows (read/acknowledgment records
are used as compliance evidence) instead of cascade-removing them on a hard
DELETE. Also adds an org+active+expires_at index that the inbox/unread-count
queries filter on.

Revision ID: 20260720_0004
Revises: 20260720_0003
Create Date: 2026-07-20 00:01:00.000000

NOTE: this migration originally shared the revision id "20260720_0001" with
20260720_0001_add_training_positions_and_shift_status (a duplicate that made the
chain unrunnable, and left 20260720_0003_add_department_message_scheduled_at a
dangling second head). It was renumbered to 20260720_0004 and re-parented onto
20260720_0003 to linearize the chain; the schema change it performs is
independent of its neighbours, so ordering does not affect correctness.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260720_0004"
down_revision = "20260720_0003"
branch_labels = None
depends_on = None

TABLE = "department_messages"
INDEX = "idx_dept_msg_org_active_expires"


def _has_column(inspector, table: str, column: str) -> bool:
    return any(c["name"] == column for c in inspector.get_columns(table))


def _has_index(inspector, table: str, index: str) -> bool:
    return any(ix["name"] == index for ix in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _has_column(inspector, TABLE, "deleted_at"):
        op.add_column(
            TABLE,
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not _has_index(inspector, TABLE, INDEX):
        op.create_index(
            INDEX,
            TABLE,
            ["organization_id", "is_active", "expires_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _has_index(inspector, TABLE, INDEX):
        op.drop_index(INDEX, table_name=TABLE)

    if _has_column(inspector, TABLE, "deleted_at"):
        op.drop_column(TABLE, "deleted_at")
