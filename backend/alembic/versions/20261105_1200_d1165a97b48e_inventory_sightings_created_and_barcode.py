"""Inventory sightings: creation and barcode put-away count as seeing an item

Revision ID: d1165a97b48e
Revises: bd8fc0c4a941

``inventory_nfc_scans.action`` gains two values (owner decisions of
2026-11-01, W44-2 and "Count it"):

* ``created`` -- written when an item is created or imported;
* ``barcode_put_away`` -- written when an item is put away by barcode scan.

Existing rows are untouched: the values are appended to the ENUM, which MySQL
applies without rewriting stored values. No row is backfilled. The decision is
that *new* items start as seen, so an item created before this revision keeps
whatever sightings it had (often none, reading "Never" on Items Not Seen)
rather than being stamped seen at a creation date nobody recorded as a
sighting.

Guarded on the table, which ``create_all`` may have built from the current
models already (Pitfall #26); MODIFY with the full value list is idempotent.

Downgrade is lossy by necessity: rows recorded with either new value are
deleted, because the narrower enum cannot hold them.
"""

import sqlalchemy as sa
from alembic import op

revision = "d1165a97b48e"
down_revision = "bd8fc0c4a941"
branch_labels = None
depends_on = None

SCANS = "inventory_nfc_scans"

BEFORE = ("lookup", "put_away", "audit")
AFTER = ("lookup", "put_away", "audit", "created", "barcode_put_away")


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _action_enum(values: tuple[str, ...]) -> sa.Enum:
    return sa.Enum(*values, name="inventorynfcscanaction")


def upgrade() -> None:
    if not _has_table(SCANS):
        return
    op.alter_column(
        SCANS,
        "action",
        existing_type=_action_enum(BEFORE),
        type_=_action_enum(AFTER),
        existing_nullable=False,
    )


def downgrade() -> None:
    if not _has_table(SCANS):
        return
    op.execute(
        sa.text(f"DELETE FROM {SCANS} WHERE action IN ('created', 'barcode_put_away')")
    )
    op.alter_column(
        SCANS,
        "action",
        existing_type=_action_enum(AFTER),
        type_=_action_enum(BEFORE),
        existing_nullable=False,
    )
