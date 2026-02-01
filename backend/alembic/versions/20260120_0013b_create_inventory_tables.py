"""Create inventory tables

Revision ID: 20260120_0013b
Revises: 20260120_0013
Create Date: 2026-01-20 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260120_0013b'
down_revision = '20260120_0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create inventory_categories table
    op.create_table(
        'inventory_categories',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('item_type', sa.Enum('uniform', 'ppe', 'tool', 'equipment', 'vehicle', 'electronics', 'consumable', 'other', name='itemtype'), nullable=False),
        sa.Column('parent_category_id', sa.String(36), sa.ForeignKey('inventory_categories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('requires_assignment', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('requires_serial_number', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('requires_maintenance', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('low_stock_threshold', sa.Integer(), nullable=True),
        sa.Column('metadata', sa.JSON(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
    )

    # Create indexes for inventory_categories
    op.create_index('idx_inventory_categories_org_type', 'inventory_categories', ['organization_id', 'item_type'])
    op.create_index('idx_inventory_categories_org_active', 'inventory_categories', ['organization_id', 'active'])

    # Create inventory_items table
    op.create_table(
        'inventory_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('category_id', sa.String(36), sa.ForeignKey('inventory_categories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('manufacturer', sa.String(length=255), nullable=True),
        sa.Column('model_number', sa.String(length=255), nullable=True),
        sa.Column('serial_number', sa.String(length=255), nullable=True),
        sa.Column('asset_tag', sa.String(length=255), nullable=True),
        sa.Column('barcode', sa.String(length=255), nullable=True),
        sa.Column('purchase_date', sa.Date(), nullable=True),
        sa.Column('purchase_price', sa.Numeric(10, 2), nullable=True),
        sa.Column('purchase_order', sa.String(length=255), nullable=True),
        sa.Column('vendor', sa.String(length=255), nullable=True),
        sa.Column('warranty_expiration', sa.Date(), nullable=True),
        sa.Column('expected_lifetime_years', sa.Integer(), nullable=True),
        sa.Column('current_value', sa.Numeric(10, 2), nullable=True),
        sa.Column('size', sa.String(length=50), nullable=True),
        sa.Column('color', sa.String(length=50), nullable=True),
        sa.Column('weight', sa.Float(), nullable=True),
        sa.Column('storage_location', sa.String(length=255), nullable=True),
        sa.Column('station', sa.String(length=100), nullable=True),
        sa.Column('condition', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=False, server_default='good'),
        sa.Column('status', sa.Enum('available', 'assigned', 'checked_out', 'in_maintenance', 'lost', 'stolen', 'retired', name='itemstatus'), nullable=False, server_default='available'),
        sa.Column('status_notes', sa.Text(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('unit_of_measure', sa.String(length=50), nullable=True),
        sa.Column('last_inspection_date', sa.Date(), nullable=True),
        sa.Column('next_inspection_due', sa.Date(), nullable=True),
        sa.Column('inspection_interval_days', sa.Integer(), nullable=True),
        sa.Column('assigned_to_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('assigned_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('custom_fields', sa.JSON(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
    )

    # Create indexes for inventory_items
    op.create_index('idx_inventory_items_org_category', 'inventory_items', ['organization_id', 'category_id'])
    op.create_index('idx_inventory_items_org_status', 'inventory_items', ['organization_id', 'status'])
    op.create_index('idx_inventory_items_org_active', 'inventory_items', ['organization_id', 'active'])
    op.create_index('idx_inventory_items_assigned_to', 'inventory_items', ['assigned_to_user_id'])
    op.create_index('idx_inventory_items_next_inspection', 'inventory_items', ['next_inspection_due'])
    op.create_index('idx_inventory_items_name', 'inventory_items', ['name'])
    op.create_index('idx_inventory_items_serial_number', 'inventory_items', ['serial_number'])
    op.create_index('idx_inventory_items_condition', 'inventory_items', ['condition'])
    op.create_index('idx_inventory_items_category_id', 'inventory_items', ['category_id'])
    op.create_index('idx_inventory_items_asset_tag', 'inventory_items', ['asset_tag'], unique=True)
    op.create_index('idx_inventory_items_barcode', 'inventory_items', ['barcode'], unique=True)

    # Create item_assignments table
    op.create_table(
        'item_assignments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('inventory_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('assignment_type', sa.Enum('permanent', 'temporary', name='assignmenttype'), nullable=False, server_default='permanent'),
        sa.Column('assigned_date', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('returned_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expected_return_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('assigned_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('returned_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('assignment_reason', sa.Text(), nullable=True),
        sa.Column('return_condition', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('return_notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    # Create indexes for item_assignments
    op.create_index('idx_item_assignments_org_item', 'item_assignments', ['organization_id', 'item_id'])
    op.create_index('idx_item_assignments_org_user', 'item_assignments', ['organization_id', 'user_id'])
    op.create_index('idx_item_assignments_org_active', 'item_assignments', ['organization_id', 'is_active'])

    # Create checkout_records table
    op.create_table(
        'checkout_records',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('inventory_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('checked_out_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('expected_return_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('checked_out_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('checked_in_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('checkout_reason', sa.Text(), nullable=True),
        sa.Column('checkout_condition', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('return_condition', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('damage_notes', sa.Text(), nullable=True),
        sa.Column('is_returned', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('is_overdue', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )

    # Create indexes for checkout_records
    op.create_index('idx_checkout_records_org_item', 'checkout_records', ['organization_id', 'item_id'])
    op.create_index('idx_checkout_records_org_user', 'checkout_records', ['organization_id', 'user_id'])
    op.create_index('idx_checkout_records_org_returned', 'checkout_records', ['organization_id', 'is_returned'])
    op.create_index('idx_checkout_records_org_overdue', 'checkout_records', ['organization_id', 'is_overdue'])
    op.create_index('idx_checkout_records_checked_in_at', 'checkout_records', ['checked_in_at'])

    # Create maintenance_records table
    op.create_table(
        'maintenance_records',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('inventory_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('maintenance_type', sa.Enum('inspection', 'repair', 'cleaning', 'testing', 'calibration', 'replacement', 'preventive', name='maintenancetype'), nullable=False),
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('completed_date', sa.Date(), nullable=True),
        sa.Column('next_due_date', sa.Date(), nullable=True),
        sa.Column('performed_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('vendor_name', sa.String(length=255), nullable=True),
        sa.Column('cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('condition_before', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('condition_after', sa.Enum('excellent', 'good', 'fair', 'poor', 'damaged', 'out_of_service', 'retired', name='itemcondition'), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('parts_replaced', sa.JSON(), nullable=True),
        sa.Column('parts_cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('labor_hours', sa.Float(), nullable=True),
        sa.Column('passed', sa.Boolean(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('issues_found', sa.JSON(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
    )

    # Create indexes for maintenance_records
    op.create_index('idx_maintenance_records_org_item', 'maintenance_records', ['organization_id', 'item_id'])
    op.create_index('idx_maintenance_records_org_scheduled', 'maintenance_records', ['organization_id', 'scheduled_date'])
    op.create_index('idx_maintenance_records_org_next_due', 'maintenance_records', ['organization_id', 'next_due_date'])
    op.create_index('idx_maintenance_records_org_completed', 'maintenance_records', ['organization_id', 'is_completed'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index('idx_maintenance_records_org_completed', table_name='maintenance_records')
    op.drop_index('idx_maintenance_records_org_next_due', table_name='maintenance_records')
    op.drop_index('idx_maintenance_records_org_scheduled', table_name='maintenance_records')
    op.drop_index('idx_maintenance_records_org_item', table_name='maintenance_records')
    op.drop_table('maintenance_records')

    op.drop_index('idx_checkout_records_checked_in_at', table_name='checkout_records')
    op.drop_index('idx_checkout_records_org_overdue', table_name='checkout_records')
    op.drop_index('idx_checkout_records_org_returned', table_name='checkout_records')
    op.drop_index('idx_checkout_records_org_user', table_name='checkout_records')
    op.drop_index('idx_checkout_records_org_item', table_name='checkout_records')
    op.drop_table('checkout_records')

    op.drop_index('idx_item_assignments_org_active', table_name='item_assignments')
    op.drop_index('idx_item_assignments_org_user', table_name='item_assignments')
    op.drop_index('idx_item_assignments_org_item', table_name='item_assignments')
    op.drop_table('item_assignments')

    op.drop_index('idx_inventory_items_barcode', table_name='inventory_items')
    op.drop_index('idx_inventory_items_asset_tag', table_name='inventory_items')
    op.drop_index('idx_inventory_items_category_id', table_name='inventory_items')
    op.drop_index('idx_inventory_items_condition', table_name='inventory_items')
    op.drop_index('idx_inventory_items_serial_number', table_name='inventory_items')
    op.drop_index('idx_inventory_items_name', table_name='inventory_items')
    op.drop_index('idx_inventory_items_next_inspection', table_name='inventory_items')
    op.drop_index('idx_inventory_items_assigned_to', table_name='inventory_items')
    op.drop_index('idx_inventory_items_org_active', table_name='inventory_items')
    op.drop_index('idx_inventory_items_org_status', table_name='inventory_items')
    op.drop_index('idx_inventory_items_org_category', table_name='inventory_items')
    op.drop_table('inventory_items')

    op.drop_index('idx_inventory_categories_org_active', table_name='inventory_categories')
    op.drop_index('idx_inventory_categories_org_type', table_name='inventory_categories')
    op.drop_table('inventory_categories')
