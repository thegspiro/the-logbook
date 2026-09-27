"""External shift hours: members log shifts worked for other departments

Adds three tables:

* ``external_agencies`` — departments members may staff apparatus for,
  maintained by scheduling officers.
* ``external_apparatus`` — units belonging to those agencies.
* ``external_shift_hours`` — one row per shift a member worked on one of
  those units. It references the unit and snapshots the agency and apparatus
  names at the write, so removing a unit from the list later does not
  orphan the shifts logged on it.

Nothing existing is altered, and every installation starts with the tables
empty, so no hours total changes on upgrade.

Each table is guarded on its absence: a fresh install that ran
``create_all`` already has them.

**Downgrade** drops all three tables, and every logged entry and list
entry with them.

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


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _timestamps() -> list:
    return [
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
    ]


def upgrade() -> None:
    if not _has_table("external_agencies"):
        op.create_table(
            "external_agencies",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            *_timestamps(),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_external_agencies_org_name"
            ),
        )

    if not _has_table("external_apparatus"):
        op.create_table(
            "external_apparatus",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "agency_id",
                sa.String(36),
                sa.ForeignKey("external_agencies.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("apparatus_type", sa.String(50), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            *_timestamps(),
            sa.UniqueConstraint(
                "agency_id", "name", name="uq_external_apparatus_agency_name"
            ),
        )
        op.create_index(
            "ix_external_apparatus_org", "external_apparatus", ["organization_id"]
        )

    if not _has_table("external_shift_hours"):
        op.create_table(
            "external_shift_hours",
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
            sa.Column(
                "external_apparatus_id",
                sa.String(36),
                sa.ForeignKey("external_apparatus.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("agency_name", sa.String(255), nullable=False),
            sa.Column("apparatus_name", sa.String(100), nullable=False),
            sa.Column("role", sa.String(100), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "status", sa.String(20), nullable=False, server_default="counted"
            ),
            sa.Column(
                "reviewed_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            *_timestamps(),
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
            "external_shift_hours",
            ["organization_id", "user_id", "shift_date"],
        )
        op.create_index(
            "ix_external_shift_hours_org_date",
            "external_shift_hours",
            ["organization_id", "shift_date"],
        )
        op.create_index(
            "ix_external_shift_hours_apparatus",
            "external_shift_hours",
            ["external_apparatus_id"],
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS external_shift_hours")
    op.execute("DROP TABLE IF EXISTS external_apparatus")
    op.execute("DROP TABLE IF EXISTS external_agencies")
