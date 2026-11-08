"""Donations reference the pledge they pay toward

Owner decision, 2026-11-01 ("Grants & Fundraising — Pledges and Fundraising
Events"): a donation may name the pledge it pays toward, and recording,
editing or refunding it moves that pledge's fulfilled amount and status.

Adds ``donations.pledge_id`` (nullable, ``ON DELETE SET NULL``) with its index.
A new nullable column: every existing donation keeps a null and names no
pledge, and every pledge keeps the fulfilled amount entered by hand. Nothing is
backfilled — which gift paid which pledge was never recorded, so it cannot be
inferred. Skipped when either table is absent; ``create_all`` then builds
``donations`` from the model, column included.

The downgrade drops the column, its foreign key and its index. Pledge amounts
already moved by linked donations stay as they are.

Revision ID: 6dadac1674c8
Revises: fd900bc2c9e7
Create Date: 2026-11-06 06:14:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6dadac1674c8"
down_revision: Union[str, None] = "fd900bc2c9e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "donations"
COLUMN = "pledge_id"
FK_NAME = "fk_donations_pledge_id"
INDEX_NAME = "idx_donations_pledge"


def _inspector():
    return sa.inspect(op.get_bind())


def _tables() -> set[str]:
    return set(_inspector().get_table_names())


def _has_column() -> bool:
    return COLUMN in {c["name"] for c in _inspector().get_columns(TABLE)}


def upgrade() -> None:
    if not {TABLE, "pledges"} <= _tables() or _has_column():
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.String(36), nullable=True))
    op.create_foreign_key(
        FK_NAME, TABLE, "pledges", [COLUMN], ["id"], ondelete="SET NULL"
    )
    op.create_index(INDEX_NAME, TABLE, [COLUMN])


def downgrade() -> None:
    if TABLE not in _tables() or not _has_column():
        return
    inspector = _inspector()
    for fk in inspector.get_foreign_keys(TABLE):
        if fk.get("constrained_columns") == [COLUMN] and fk.get("name"):
            op.drop_constraint(fk["name"], TABLE, type_="foreignkey")
    if INDEX_NAME in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        op.drop_index(INDEX_NAME, table_name=TABLE)
    op.drop_column(TABLE, COLUMN)
