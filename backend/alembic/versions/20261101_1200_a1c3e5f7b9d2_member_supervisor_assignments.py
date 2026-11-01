"""Member supervisor assignments

Revision ID: a1c3e5f7b9d2
Revises: e15d635bbb98
Create Date: 2026-11-01 12:00:00.000000

Adds ``member_supervisor_assignments`` (owner decision 2026-11-01): who a
member reports to, as dated rows so the history of who supervised them is
kept. See ``app/models/member_supervisor.py`` for the column choices.

A new table, so no existing row is touched and nothing needs settling
(CLAUDE.md pitfall #35). It is created only when absent, so a database whose
table ``create_all`` already built — a fresh install stamped at head — is left
alone, and running the upgrade twice is harmless.

The downgrade drops the table and every recorded assignment with it. Nothing
else in the schema refers to it, so the previous release boots against the
downgraded database; the assignments themselves are lost, so take a backup
(``scripts/backup.sh``) before downgrading past this revision once they are in
use.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3e5f7b9d2"
down_revision: Union[str, None] = "e15d635bbb98"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "member_supervisor_assignments"

# Inlined rather than imported from the model: a migration must keep doing
# what it did the day it ran, and the model's constant is free to change.
_OPEN_MARKER_EXPRESSION = "CASE WHEN ends_on IS NULL THEN 1 ELSE NULL END"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table():
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "member_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "supervisor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column(
            "open_marker",
            sa.Integer(),
            sa.Computed(_OPEN_MARKER_EXPRESSION, persisted=True),
        ),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "member_id", "open_marker", name="uq_member_supervisor_assignments_open"
        ),
        sa.CheckConstraint(
            "ends_on IS NULL OR ends_on >= starts_on", name="date_order"
        ),
    )
    op.create_index(
        "ix_member_supervisor_assignments_org_member",
        TABLE,
        ["organization_id", "member_id", "starts_on"],
    )
    op.create_index(
        "ix_member_supervisor_assignments_org_supervisor",
        TABLE,
        ["organization_id", "supervisor_id"],
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
