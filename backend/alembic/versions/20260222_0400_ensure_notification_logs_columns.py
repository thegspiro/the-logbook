"""Ensure notification_logs has category, expires_at, and action_url columns

These columns were added in migrations 20260221_0700 and 20260221_0800,
but on databases bootstrapped via create_all() (which creates the table
from the model definition at that point in time), the alembic_version
was stamped at head before these ALTER TABLE migrations actually ran.
This migration fills the gap idempotently.

Revision ID: 20260222_0400
Revises: 20260222_0350
Create Date: 2026-02-22 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260222_0400"
down_revision: Union[str, None] = "20260222_0350"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(connection, table_name: str, column_name: str) -> bool:
    insp = inspect(connection)
    columns = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in columns


def _index_exists(connection, table_name: str, index_name: str) -> bool:
    insp = inspect(connection)
    return any(idx["name"] == index_name for idx in insp.get_indexes(table_name))


def upgrade() -> None:
    conn = op.get_bind()

    # category (from 20260221_0700)
    if not _column_exists(conn, "notification_logs", "category"):
        op.add_column(
            "notification_logs",
            sa.Column("category", sa.String(50), nullable=True),
        )
    if not _index_exists(conn, "notification_logs", "idx_notif_logs_category"):
        op.create_index("idx_notif_logs_category", "notification_logs", ["category"])

    # expires_at (from 20260221_0700)
    if not _column_exists(conn, "notification_logs", "expires_at"):
        op.add_column(
            "notification_logs",
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _index_exists(conn, "notification_logs", "idx_notif_logs_expires"):
        op.create_index("idx_notif_logs_expires", "notification_logs", ["expires_at"])

    # action_url (from 20260221_0800)
    if not _column_exists(conn, "notification_logs", "action_url"):
        op.add_column(
            "notification_logs",
            sa.Column("action_url", sa.String(500), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()

    if _column_exists(conn, "notification_logs", "action_url"):
        op.drop_column("notification_logs", "action_url")
    if _index_exists(conn, "notification_logs", "idx_notif_logs_expires"):
        op.drop_index("idx_notif_logs_expires", table_name="notification_logs")
    if _column_exists(conn, "notification_logs", "expires_at"):
        op.drop_column("notification_logs", "expires_at")
    if _index_exists(conn, "notification_logs", "idx_notif_logs_category"):
        op.drop_index("idx_notif_logs_category", table_name="notification_logs")
    if _column_exists(conn, "notification_logs", "category"):
        op.drop_column("notification_logs", "category")
