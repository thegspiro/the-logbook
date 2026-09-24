"""Record when a barcode label was confirmed printed for an inventory item.

``label_printed_at`` / ``label_printed_by`` are set when a quartermaster
confirms a batch of labels came off the printer, and cleared by the
``InventoryItem`` update listener when the value a label encodes changes. A
null ``label_printed_at`` is the "needs a label" worklist the print page and
items list filter on, so it is indexed.

Nothing is backfilled: no installation has recorded a print before this
revision, so every existing item starts on the worklist. That is the honest
state — the system cannot know which items already carry a label — and a
department clears it by confirming its next print run.

**Reversible.** The downgrade drops both columns and the index. Only the print
history is lost; nothing else references it.

Revision ID: 5a70c5dcd138
Revises: 9cb132ad83dc
Create Date: 2026-09-24 00:02:14.384943
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5a70c5dcd138"
down_revision = "9cb132ad83dc"
branch_labels = None
depends_on = None

_TABLE = "inventory_items"
_FK = "fk_inventory_items_label_printed_by_users"
_INDEX = "ix_inventory_items_label_printed_at"


def _has_column(column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(_TABLE)}


def _has_index(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {ix["name"] for ix in inspector.get_indexes(_TABLE)}


def _foreign_keys_on(column: str) -> list[str]:
    """Names of the foreign keys constraining ``column`` alone.

    An installation whose column came from startup's ``create_all`` carries the
    model's constraint under whatever name was generated there; the downgrade
    drops what exists rather than assuming ``_FK``.
    """
    inspector = sa.inspect(op.get_bind())
    return [
        fk["name"]
        for fk in inspector.get_foreign_keys(_TABLE)
        if fk.get("name") and fk.get("constrained_columns") == [column]
    ]


def upgrade() -> None:
    # ``inventory_items`` is created by 20260120_0013b, so it is present on
    # every upgrade path and needs no table guard (CLAUDE.md pitfall #26). The
    # column guards are still load-bearing: startup's create_all and column
    # repair can build these columns from the model before this revision runs.
    if not _has_column("label_printed_at"):
        op.add_column(
            _TABLE,
            sa.Column("label_printed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_index(_INDEX):
        op.create_index(_INDEX, _TABLE, ["label_printed_at"])

    if not _has_column("label_printed_by"):
        op.add_column(
            _TABLE,
            sa.Column("label_printed_by", sa.String(length=36), nullable=True),
        )
        # SET NULL, and so nullable (CLAUDE.md pitfall #2): deleting the member
        # who confirmed a print must not delete, or block deleting, the mark.
        op.create_foreign_key(
            _FK, _TABLE, "users", ["label_printed_by"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    if _has_column("label_printed_by"):
        for name in _foreign_keys_on("label_printed_by"):
            op.drop_constraint(name, _TABLE, type_="foreignkey")
        op.drop_column(_TABLE, "label_printed_by")
    if _has_index(_INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    if _has_column("label_printed_at"):
        op.drop_column(_TABLE, "label_printed_at")
