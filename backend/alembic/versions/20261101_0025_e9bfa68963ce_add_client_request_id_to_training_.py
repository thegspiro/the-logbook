"""add client_request_id to training_submissions

Revision ID: e9bfa68963ce
Revises: db30a34afa5b
Create Date: 2026-11-01 00:25:34.045199

A training submission queued offline is sent again whenever the answer to an
earlier attempt never arrived — a dropped connection, or the client's 30s
timeout firing while the server was still working — including when the server
had already stored it. Under auto-approval the second copy became a second
training record and the member's hours counted twice. The device now picks an
id before its first attempt and repeats it on every resend; the server answers
a repeat with the submission it already has.

Existing rows are left with NULL: nothing they carried identifies a request,
and a unique index on MySQL admits any number of NULLs, so the constraint holds
on the rows already there without touching them (CLAUDE.md pitfall #35).

Every step checks first, because ``repair_schema.py`` adds model columns at
startup and a fresh install builds this table from the models.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e9bfa68963ce"
down_revision: Union[str, None] = "db30a34afa5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "training_submissions"
COLUMN = "client_request_id"
CONSTRAINT = "uq_submission_member_client_request"


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def _has_column() -> bool:
    columns = sa.inspect(op.get_bind()).get_columns(TABLE)
    return any(column["name"] == COLUMN for column in columns)


def _has_constraint() -> bool:
    inspector = sa.inspect(op.get_bind())
    names = {c["name"] for c in inspector.get_unique_constraints(TABLE)}
    names |= {i["name"] for i in inspector.get_indexes(TABLE) if i.get("unique")}
    return CONSTRAINT in names


def upgrade() -> None:
    if not _has_table():
        return
    if not _has_column():
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(64), nullable=True))
    if not _has_constraint():
        op.create_unique_constraint(CONSTRAINT, TABLE, ["submitted_by", COLUMN])


def downgrade() -> None:
    if not _has_table():
        return
    if _has_constraint():
        op.drop_constraint(CONSTRAINT, TABLE, type_="unique")
    if _has_column():
        op.drop_column(TABLE, COLUMN)
