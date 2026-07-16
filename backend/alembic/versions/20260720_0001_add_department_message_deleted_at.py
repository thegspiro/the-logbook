"""Add deleted_at soft-delete column and expiry index to department_messages

Soft delete preserves DepartmentMessageRead rows (read/acknowledgment records
are used as compliance evidence) instead of cascade-removing them on a hard
DELETE. Also adds an org+active+expires_at index that the inbox/unread-count
queries filter on.

Revision ID: 20260720_0001
Revises: 20260719_0001
Create Date: 2026-07-20 00:01:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260720_0001"
down_revision = "20260719_0001"
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
