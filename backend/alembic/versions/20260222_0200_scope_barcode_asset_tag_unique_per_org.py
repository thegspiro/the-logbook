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

# revision identifiers, used by Alembic.
revision = '20260222_0200'
down_revision = '20260222_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old global unique indexes
    op.drop_index('idx_inventory_items_barcode', table_name='inventory_items')
    op.drop_index('idx_inventory_items_asset_tag', table_name='inventory_items')

    # Create org-scoped unique constraints (these also serve as indexes)
    op.create_unique_constraint(
        'uq_item_org_barcode',
        'inventory_items',
        ['organization_id', 'barcode'],
    )
    op.create_unique_constraint(
        'uq_item_org_asset_tag',
        'inventory_items',
        ['organization_id', 'asset_tag'],
    )

    # Re-create non-unique indexes on barcode and asset_tag for single-column
    # lookups (the composite unique constraints above are ordered org_id-first,
    # so a bare WHERE barcode = ? query wouldn't use them efficiently).
    op.create_index('ix_inventory_items_barcode', 'inventory_items', ['barcode'])
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
