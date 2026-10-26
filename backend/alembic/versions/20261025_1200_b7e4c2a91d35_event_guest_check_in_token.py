"""event guest check-in token

Revision ID: b7e4c2a91d35
Revises: 3f2593e8071e
Create Date: 2026-10-25 12:00:00.000000

Adds ``events.guest_check_in_token``: the bearer credential behind an event's
own guest QR code, so visitors can sign in at an event held somewhere with no
room kiosk. A manager issues it on demand and rotates it to revoke a printed
code; it opens nothing unless ``allow_guest_check_in`` is also on.

Additive and nullable. Every existing event reads as having no code issued, so
nothing becomes reachable on upgrade — a manager has to issue one first. The
unique index holds on a populated table because every existing row is NULL,
and MySQL's unique indexes admit any number of NULLs.

**Why each step is guarded.** The column and index may already exist where
``create_all`` (or ``scripts/repair_schema.py``) built ``events`` from the
model before Alembic reached this revision (CLAUDE.md pitfall #26).

**Downgrade** drops the index and the column; every issued guest QR code stops
working, and the room-kiosk guest path is unaffected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7e4c2a91d35"
down_revision: Union[str, None] = "3f2593e8071e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "events"
COLUMN = "guest_check_in_token"
# The name SQLAlchemy gives ``index=True, unique=True`` on the model, so a
# table create_all built and one this revision altered carry the same index.
INDEX = "ix_events_guest_check_in_token"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    if not _has_table():
        return False
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return COLUMN in {c["name"] for c in columns}


def _has_index() -> bool:
    if not _has_table():
        return False
    indexes = sa.inspect(op.get_bind()).get_indexes(TABLE)
    return INDEX in {i["name"] for i in indexes}


def upgrade() -> None:
    if not _has_table():
        return
    if not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(64), nullable=True))
    if not _has_index():
        op.create_index(INDEX, TABLE, [COLUMN], unique=True)


def downgrade() -> None:
    if _has_index():
        op.drop_index(INDEX, table_name=TABLE)
    if _has_column():
        op.drop_column(TABLE, COLUMN)
