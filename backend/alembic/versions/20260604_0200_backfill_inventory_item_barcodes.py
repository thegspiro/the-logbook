"""Backfill barcodes for inventory items missing one

Historically ``InventoryService.get_items`` lazily generated a barcode for any
item lacking one and committed it during a list (GET) read. That made a read
path issue writes, which is surprising and interacts badly with the
stale-while-revalidate API cache. This migration backfilled the legacy rows
that never received one with a deterministic ``INV-`` + first 8 hex of the row
UUID value so the on-read generation could be removed safely.

NOTE: superseded by ``20260610_0001``, which moves all barcodes to the
per-organization sequential scheme. This step is retained for history (it runs
before the merge) but its values are reassigned by that later migration.

Revision ID: 20260604_0200
Revises: 20260604_0100
Create Date: 2026-06-04 02:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260604_0200"
down_revision = "20260604_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Derive a deterministic, per-row barcode from the item's UUID PK. This is
    # the single canonical scheme the application also uses at create time
    # (InventoryService._barcode_for_item / _format_barcode): INV- + first 8
    # uppercase hex of the dehyphenated row UUID.
    op.execute(
        """
        UPDATE inventory_items
        SET barcode = CONCAT('INV-', UPPER(SUBSTRING(REPLACE(id, '-', ''), 1, 8)))
        WHERE barcode IS NULL OR barcode = ''
        """
    )


def downgrade() -> None:
    # No-op: backfilled barcodes are indistinguishable from app-generated ones,
    # so there is nothing safe to revert.
    pass
