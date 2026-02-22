"""Create operational_ranks table

Per-organization configurable operational ranks with default seeding.

Revision ID: 20260222_0500
Revises: 20260222_0400
Create Date: 2026-02-22 05:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260222_0500"
down_revision: Union[str, None] = "20260222_0400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(connection, table_name: str) -> bool:
    insp = inspect(connection)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    conn = op.get_bind()

    if _table_exists(conn, "operational_ranks"):
        return

    op.create_table(
        "operational_ranks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rank_code", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("organization_id", "rank_code", name="uq_ranks_org_code"),
    )

    op.create_index("ix_operational_ranks_org", "operational_ranks", ["organization_id"])


def downgrade() -> None:
    conn = op.get_bind()
    if _table_exists(conn, "operational_ranks"):
        op.drop_index("ix_operational_ranks_org", table_name="operational_ranks")
        op.drop_table("operational_ranks")
