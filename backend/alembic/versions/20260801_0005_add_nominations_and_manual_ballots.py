"""Add nomination phase and manual (paper) ballot support

- elections.status ENUM gains 'nominations' (optional pre-ballot phase;
  appending a value to a MySQL ENUM is an in-place metadata change)
- elections.nomination_deadline: when set, the election_lifecycle task
  closes nominations (back to draft) once the deadline passes
- votes.is_manual + votes.recorded_by: paper-tally votes keyed in by an
  officer — no voter identity/dedup hash, attributed to the recorder

Revision ID: 20260801_0005
Revises: 20260801_0004
Create Date: 2026-08-01 00:05:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0005"
down_revision = "20260801_0004"
branch_labels = None
depends_on = None

_STATUS_FULL = sa.Enum(
    "draft", "nominations", "open", "closed", "cancelled", name="electionstatus"
)
_STATUS_OLD = sa.Enum("draft", "open", "closed", "cancelled", name="electionstatus")


def upgrade() -> None:
    op.alter_column(
        "elections",
        "status",
        type_=_STATUS_FULL,
        existing_type=_STATUS_OLD,
        existing_nullable=False,
    )
    op.add_column(
        "elections",
        sa.Column("nomination_deadline", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "votes",
        sa.Column("is_manual", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "votes",
        sa.Column(
            "recorded_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("votes", "recorded_by")
    op.drop_column("votes", "is_manual")
    op.drop_column("elections", "nomination_deadline")
    # Fold any nominations-phase elections back to draft before narrowing.
    op.execute("UPDATE elections SET status = 'draft' WHERE status = 'nominations'")
    op.alter_column(
        "elections",
        "status",
        type_=_STATUS_OLD,
        existing_type=_STATUS_FULL,
        existing_nullable=False,
    )
