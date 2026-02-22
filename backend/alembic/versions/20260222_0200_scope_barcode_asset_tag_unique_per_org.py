"""Scope barcode and asset_tag unique constraints per organization

Replaces the global unique indexes on inventory_items.barcode and
inventory_items.asset_tag with composite unique constraints scoped
to (organization_id, barcode) and (organization_id, asset_tag),
allowing different organizations to reuse the same codes.

Revision ID: 20260222_0200
Revises: 20260222_0100
Create Date: 2026-02-22 02:00:00.000000

"""
from alembic import op
from sqlalchemy import inspect, text

# revision identifiers, used by Alembic.
revision = '20260222_0200'
down_revision = '20260222_0100'
branch_labels = None
depends_on = None


def _index_exists(connection, table_name: str, index_name: str) -> bool:
    """Check whether an index exists on the given table."""
    insp = inspect(connection)
    return any(idx["name"] == index_name for idx in insp.get_indexes(table_name))


def _unique_constraint_exists(connection, table_name: str, constraint_name: str) -> bool:
    """Check whether a unique constraint exists on the given table."""
    insp = inspect(connection)
    return any(uc["name"] == constraint_name for uc in insp.get_unique_constraints(table_name))


def upgrade() -> None:
    conn = op.get_bind()

    # Drop the old global unique indexes (may not exist if create_all() was
    # used instead of running the original 0013b migration)
    if _index_exists(conn, 'inventory_items', 'idx_inventory_items_barcode'):
        op.drop_index('idx_inventory_items_barcode', table_name='inventory_items')
    if _index_exists(conn, 'inventory_items', 'idx_inventory_items_asset_tag'):
        op.drop_index('idx_inventory_items_asset_tag', table_name='inventory_items')

    # Create org-scoped unique constraints (these also serve as indexes)
    if not _unique_constraint_exists(conn, 'inventory_items', 'uq_item_org_barcode'):
        op.create_unique_constraint(
            'uq_item_org_barcode',
            'inventory_items',
            ['organization_id', 'barcode'],
        )
    if not _unique_constraint_exists(conn, 'inventory_items', 'uq_item_org_asset_tag'):
        op.create_unique_constraint(
            'uq_item_org_asset_tag',
            'inventory_items',
            ['organization_id', 'asset_tag'],
        )

    # Re-create non-unique indexes on barcode and asset_tag for single-column
    # lookups (the composite unique constraints above are ordered org_id-first,
    # so a bare WHERE barcode = ? query wouldn't use them efficiently).
    if not _index_exists(conn, 'inventory_items', 'ix_inventory_items_barcode'):
        op.create_index('ix_inventory_items_barcode', 'inventory_items', ['barcode'])
    if not _index_exists(conn, 'inventory_items', 'ix_inventory_items_asset_tag'):
        op.create_index('ix_inventory_items_asset_tag', 'inventory_items', ['asset_tag'])


def downgrade() -> None:
    # Drop the single-column lookup indexes
    op.drop_index('ix_inventory_items_asset_tag', table_name='inventory_items')
    op.drop_index('ix_inventory_items_barcode', table_name='inventory_items')

    # Drop org-scoped unique constraints
    op.drop_constraint('uq_item_org_asset_tag', 'inventory_items', type_='unique')
    op.drop_constraint('uq_item_org_barcode', 'inventory_items', type_='unique')

    # Restore original global unique indexes
    op.create_index('idx_inventory_items_asset_tag', 'inventory_items', ['asset_tag'], unique=True)
    op.create_index('idx_inventory_items_barcode', 'inventory_items', ['barcode'], unique=True)
