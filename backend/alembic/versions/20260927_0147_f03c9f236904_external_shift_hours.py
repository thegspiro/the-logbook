"""External shift hours: members log shifts worked outside the department

Adds ``external_shift_hours``, one row per shift a member worked on another
jurisdiction's apparatus. Nothing existing is altered, and every existing
installation starts with the table empty, so no hours total changes on
upgrade.

Guarded on the table's absence: a fresh install that ran ``create_all``
already has it.

**Downgrade** drops the table and every logged entry with it.

Revision ID: f03c9f236904
Revises: b795d1b3401b
Create Date: 2026-09-27 01:47:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f03c9f236904"
down_revision: Union[str, None] = "b795d1b3401b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "external_shift_hours"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(_TABLE):
        return

    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("shift_date", sa.Date(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("agency_name", sa.String(255), nullable=False),
        sa.Column("apparatus", sa.String(100), nullable=True),
        sa.Column("role", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="counted"),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('counted', 'rejected')",
            name="ck_external_shift_hours_status",
        ),
        sa.CheckConstraint(
            "duration_minutes > 0 AND duration_minutes <= 2880",
            name="ck_external_shift_hours_duration",
        ),
    )
    op.create_index(
        "ix_external_shift_hours_org_user_date",
        _TABLE,
        ["organization_id", "user_id", "shift_date"],
    )
    op.create_index(
        "ix_external_shift_hours_org_date",
        _TABLE,
        ["organization_id", "shift_date"],
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
