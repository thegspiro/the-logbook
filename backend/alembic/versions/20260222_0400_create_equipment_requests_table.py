"""Create equipment_requests table

Adds the equipment_requests table to support the equipment request
workflow where members can request checkouts, issuances, or purchases
and admins can review and approve/deny them.

Revision ID: 20260222_0400
Revises: 20260222_0300
Create Date: 2026-02-22 04:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260222_0400'
down_revision = '20260222_0300'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'equipment_requests',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('requester_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_name', sa.String(255), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('inventory_items.id', ondelete='SET NULL'), nullable=True),
        sa.Column('category_id', sa.String(36), sa.ForeignKey('inventory_categories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('quantity', sa.Integer, nullable=False, server_default='1'),
        sa.Column('request_type', sa.String(20), nullable=False, server_default='checkout'),
        sa.Column('priority', sa.String(10), nullable=False, server_default='normal'),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_equip_requests_org_status', 'equipment_requests', ['organization_id', 'status'])
    op.create_index('idx_equip_requests_requester', 'equipment_requests', ['requester_id', 'status'])


def downgrade() -> None:
    op.drop_index('idx_equip_requests_requester', table_name='equipment_requests')
    op.drop_index('idx_equip_requests_org_status', table_name='equipment_requests')
    op.drop_table('equipment_requests')
