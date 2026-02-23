"""Add location_id FK to inventory_items for room reference

Links inventory items to specific rooms (locations) so that storage
location can be tracked as a structured room + storage area instead
of free-text only.

Revision ID: 20260222_0350
Revises: 20260222_0300
Create Date: 2026-02-22 03:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260222_0350'
down_revision = '20260222_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'inventory_items',
        sa.Column('location_id', sa.String(36), nullable=True),
    )
    op.create_foreign_key(
        'fk_inventory_items_location_id',
        'inventory_items',
        'locations',
        ['location_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'idx_inventory_items_location_id',
        'inventory_items',
        ['location_id'],
    )


def downgrade() -> None:
    op.drop_index('idx_inventory_items_location_id', table_name='inventory_items')
    op.drop_constraint('fk_inventory_items_location_id', 'inventory_items', type_='foreignkey')
    op.drop_column('inventory_items', 'location_id')
