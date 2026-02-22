"""Add item_issuances table, tracking_type/quantity_issued columns, and missing indexes

Revision ID: 20260222_0100
Revises: 20260221_0800
Create Date: 2026-02-22 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260222_0100'
down_revision = '20260221_0800'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------------------------------------------------------------
    # 1. Add tracking_type and quantity_issued to inventory_items
    # ---------------------------------------------------------------
    op.add_column(
        'inventory_items',
        sa.Column(
            'tracking_type',
            sa.Enum('individual', 'pool', name='trackingtype'),
            nullable=False,
            server_default='individual',
        ),
    )
    op.add_column(
        'inventory_items',
        sa.Column('quantity_issued', sa.Integer(), nullable=False, server_default='0'),
    )

    # Index for tracking_type queries
    op.create_index(
        'idx_inventory_items_tracking_type',
        'inventory_items',
        ['organization_id', 'tracking_type'],
    )

    # ---------------------------------------------------------------
    # 2. Create item_issuances table
    # ---------------------------------------------------------------
    op.create_table(
        'item_issuances',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('inventory_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('quantity_issued', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('issued_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('returned_at', sa.DateTime(), nullable=True),
        sa.Column('issued_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('returned_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('issue_reason', sa.Text(), nullable=True),
        sa.Column('return_condition', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('return_notes', sa.Text(), nullable=True),
        sa.Column('is_returned', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    # Indexes for item_issuances
    op.create_index('idx_item_issuances_org_item', 'item_issuances', ['organization_id', 'item_id'])
    op.create_index('idx_item_issuances_org_user', 'item_issuances', ['organization_id', 'user_id'])
    op.create_index('idx_item_issuances_org_returned', 'item_issuances', ['organization_id', 'is_returned'])

    # ---------------------------------------------------------------
    # 3. Add missing composite indexes for common queries
    # ---------------------------------------------------------------
    # Overdue checkout queries: (org_id, is_returned, expected_return_at)
    op.create_index(
        'idx_checkout_records_org_returned_expected',
        'checkout_records',
        ['organization_id', 'is_returned', 'expected_return_at'],
    )

    # Assignment lookups: (item_id, is_active)
    op.create_index(
        'idx_item_assignments_item_active',
        'item_assignments',
        ['item_id', 'is_active'],
    )


def downgrade() -> None:
    # Drop new indexes
    op.drop_index('idx_item_assignments_item_active', table_name='item_assignments')
    op.drop_index('idx_checkout_records_org_returned_expected', table_name='checkout_records')

    # Drop item_issuances table
    op.drop_index('idx_item_issuances_org_returned', table_name='item_issuances')
    op.drop_index('idx_item_issuances_org_user', table_name='item_issuances')
    op.drop_index('idx_item_issuances_org_item', table_name='item_issuances')
    op.drop_table('item_issuances')

    # Drop new columns from inventory_items
    op.drop_index('idx_inventory_items_tracking_type', table_name='inventory_items')
    op.drop_column('inventory_items', 'quantity_issued')
    op.drop_column('inventory_items', 'tracking_type')
