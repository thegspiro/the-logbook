"""Finance approvals: emailed link send status and link version

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5f7b9d2
Create Date: 2026-11-01 12:10:00.000000

Adds three columns to ``approval_step_records`` (owner decisions 2026-11-01,
KNOWN_LIMITATIONS "Emailed Approvals Cannot Be Re-Sent"):

- ``email_status`` -- ``sent`` or ``failed``, the outcome of the last attempt
  to email the step's approval link;
- ``email_status_at`` -- when that attempt was made;
- ``email_link_version`` -- bumped each time a link is minted, so a re-send
  names the version it saw and a repeated one is a no-op.

Existing rows: ``email_status`` and ``email_status_at`` stay NULL, which the
queue reads as "emailed before send status was recorded" for a step holding
a live link -- nothing recorded whether those sends worked, and inventing
``sent`` would claim a delivery nobody saw. ``email_link_version`` takes 0
from its server default, which is what a re-send of a pre-existing link then
names. No row is rewritten, so there is nothing to reverse.

``approval_step_records`` is built by ``create_all`` and by no migration, so
each step is skipped when the table is absent (CLAUDE.md pitfall #26): the
table is then built from the model, which declares these columns. Each column
is added only when missing, so a re-run is a no-op. The downgrade drops them;
the previous release reads none of them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e3"
down_revision: Union[str, None] = "a1c3e5f7b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "approval_step_records"


def _new_columns() -> list[sa.Column]:
    return [
        sa.Column("email_status", sa.String(16), nullable=True),
        sa.Column("email_status_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "email_link_version",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    ]


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns:
        return
    for column in _new_columns():
        if column.name not in columns:
            op.add_column(TABLE, column)


def downgrade() -> None:
    columns = _columns()
    for name in ("email_link_version", "email_status_at", "email_status"):
        if name in columns:
            op.drop_column(TABLE, name)
