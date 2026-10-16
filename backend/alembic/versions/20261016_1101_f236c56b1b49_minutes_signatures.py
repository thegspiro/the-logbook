"""Minutes signatures

Creates ``minutes_signatures``: who attested to which adopted version of a set
of minutes, and when. A row is tied to the revision it was given on and carries
that revision's content hash. One signature per slot per revision.

The table is new, so there is nothing to backfill, and the step is skipped when
it already exists (``create_all`` builds it from the models on a fresh
database). Foreign keys to ``meeting_minutes`` and ``minutes_revisions`` are
created only when those tables exist, which on a fresh database they do not
until ``create_all`` runs.

The downgrade drops the table; recorded signatures are lost with it, and the
minutes and their revisions are untouched.

Revision ID: f236c56b1b49
Revises: 9ce470b513ae, dc3c105464c1
Create Date: 2026-10-16 11:01:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f236c56b1b49"
down_revision: Union[str, Sequence[str], None] = ("9ce470b513ae", "dc3c105464c1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "minutes_signatures"


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()
    if TABLE in existing:
        return
    if not {"meeting_minutes", "minutes_revisions", "organizations"} <= existing:
        # A fresh database: create_all builds this table from the models, after
        # the tables it points at.
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "minutes_id",
            sa.String(36),
            sa.ForeignKey("meeting_minutes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "revision_id",
            sa.String(36),
            sa.ForeignKey("minutes_revisions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slot_key", sa.String(50), nullable=False),
        sa.Column("slot_title", sa.String(100), nullable=False),
        sa.Column(
            "signer_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("signed_name", sa.String(200), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.UniqueConstraint(
            "revision_id", "slot_key", name="uq_minutes_signatures_slot"
        ),
    )
    op.create_index("ix_minutes_signatures_minutes_id", TABLE, ["minutes_id"])
    op.create_index("ix_minutes_signatures_revision_id", TABLE, ["revision_id"])
    op.create_index("ix_minutes_signatures_organization_id", TABLE, ["organization_id"])


def downgrade() -> None:
    op.execute(sa.text(f"DROP TABLE IF EXISTS {TABLE}"))
