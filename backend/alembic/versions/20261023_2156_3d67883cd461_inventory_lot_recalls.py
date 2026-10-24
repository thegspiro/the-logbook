"""Record manufacturer recalls of a supply's lot number.

Revision ID: 3d67883cd461
Revises: a8c3b50b6d9b
Create Date: 2026-10-23 21:56:00.000000

A recall names a lot number. The Medical Supplies lot lookup already finds
every unit of one, on the shelves and on the apparatus, but there was nowhere
to record that a lot is recalled, so the units kept counting as stock and
could be swapped onto a truck. ``inventory_lot_recalls`` holds one row per
recall of a supply's lot number; while it is active (``lifted_at`` NULL) the
units carrying that number stop counting and cannot be swapped.

A new table, so no existing row changes and nothing behaves differently until
someone records a recall.

**Why the step is guarded.** The table is created only when it does not
exist, so a database built by ``create_all`` (which already declares it) or a
re-run changes nothing.

**Downgrade** drops the table: every recall recorded, and every lift, is
lost, and the units they covered count as stock again.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3d67883cd461"
down_revision: Union[str, None] = "a8c3b50b6d9b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "inventory_lot_recalls"


def _has_table() -> bool:
    return _TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table():
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
            "inventory_item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("lot_number", sa.String(100), nullable=False),
        sa.Column("lot_number_key", sa.String(100), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "recalled_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "recalled_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("lifted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "lifted_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("lift_note", sa.Text(), nullable=True),
    )
    op.create_index(
        "idx_lot_recalls_org_item_key",
        _TABLE,
        ["organization_id", "inventory_item_id", "lot_number_key"],
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
