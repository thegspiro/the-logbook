"""Add member service periods.

Creates ``member_service_periods``: one row per continuous stint of
membership, so length of service can exclude the time a member was away and
a department can restart a returning member's clock while keeping the earlier
stints on record as prior service.

Purely additive, with no backfill. A member with no rows is read as one
unbroken stint from ``users.hire_date`` -- exactly how service was calculated
before this table existed -- so every existing installation's numbers are
unchanged by the upgrade. Rows are written from now on when a member is
dropped, retired or reactivated.

Guarded on the table's absence so a database built by ``create_all`` is a
no-op. The downgrade drops the table and with it every recorded stint; the
members, their ``hire_date`` and their statuses are untouched, and service
falls back to ``hire_date`` as before.

Revision ID: 500a63596f66
Revises: 7b2e4c9d1a53
Create Date: 2026-09-24 20:20:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "500a63596f66"
down_revision = "7b2e4c9d1a53"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("member_service_periods"):
        return
    op.create_table(
        "member_service_periods",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("separation_status", sa.String(32), nullable=True),
        sa.Column(
            "counts_toward_service",
            sa.Boolean(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_member_service_periods_org_user",
        "member_service_periods",
        ["organization_id", "user_id"],
    )
    op.create_index(
        "ix_member_service_periods_user_id",
        "member_service_periods",
        ["user_id"],
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS member_service_periods")
