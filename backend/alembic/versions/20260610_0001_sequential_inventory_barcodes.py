"""Switch inventory barcodes to per-organization sequential numbers

Barcodes move to a single human-readable scheme: ``<prefix><zero-padded
number>`` per organization (default ``INV-000001``, ``INV-000002`` ...). The
prefix and running counter live in ``organizations.settings["barcode"]`` and
are advanced at item-creation time by ``InventoryService`` — mirroring the
membership-number scheme.

This migration also merges the two open heads (the shift-assignment index and
the earlier barcode backfill) so ``alembic upgrade head`` is unambiguous again.

It reassigns **every** existing item a sequential barcode (overwriting the
prior UUID-derived values) and seeds each organization's counter. This is safe
because the prior scheme was introduced in the same release and no barcodes
were in production use.

Revision ID: 20260610_0001
Revises: 20260604_0001, 20260604_0200
Create Date: 2026-06-10 00:00:00.000000

"""

from sqlalchemy import text

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260610_0001"
down_revision = ("20260604_0001", "20260604_0200")
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Reassign every item a sequential, per-organization barcode. The
    #    derived table is materialised (it uses a window function), so
    #    self-updating inventory_items is permitted.
    conn.execute(
        text(
            """
            UPDATE inventory_items i
            JOIN (
                SELECT
                    id,
                    CONCAT(
                        'INV-',
                        LPAD(
                            ROW_NUMBER() OVER (
                                PARTITION BY organization_id
                                ORDER BY created_at, id
                            ),
                            6, '0'
                        )
                    ) AS bc
                FROM inventory_items
            ) seq ON i.id = seq.id
            SET i.barcode = seq.bc
            """
        )
    )

    # 2. Seed each organization's counter so the app continues after the last
    #    assigned number. Organizations with no items keep the default (1).
    conn.execute(
        text(
            """
            UPDATE organizations o
            JOIN (
                SELECT organization_id, COUNT(*) AS cnt
                FROM inventory_items
                GROUP BY organization_id
            ) c ON o.id = c.organization_id
            SET o.settings = JSON_SET(
                COALESCE(o.settings, JSON_OBJECT()),
                '$.barcode',
                JSON_OBJECT('prefix', 'INV-', 'next_number', c.cnt + 1)
            )
            """
        )
    )


def downgrade() -> None:
    # No-op: sequential barcodes are indistinguishable from any other assigned
    # value, so there is nothing safe to revert.
    pass
