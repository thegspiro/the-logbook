"""Add pool item management enhancements

Revision ID: 20260304_0300
Revises: 20260304_0200
Create Date: 2026-03-04

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260304_0300'
down_revision = '20260304_0200'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add replacement_cost to inventory_items
    op.add_column(
        'inventory_items',
        sa.Column('replacement_cost', sa.Numeric(10, 2), nullable=True),
    )

    # Add cost tracking fields to item_issuances
    op.add_column(
        'item_issuances',
        sa.Column('unit_cost_at_issuance', sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        'item_issuances',
        sa.Column('charge_status', sa.String(20), server_default='none', nullable=True),
    )
    op.add_column(
        'item_issuances',
        sa.Column('charge_amount', sa.Numeric(10, 2), nullable=True),
    )

    # Create issuance_allowances table
    op.create_table(
        'issuance_allowances',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column(
            'organization_id',
            sa.String(36),
            sa.ForeignKey('organizations.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'category_id',
            sa.String(36),
            sa.ForeignKey('inventory_categories.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'role_id',
            sa.String(36),
            sa.ForeignKey('roles.id', ondelete='CASCADE'),
            nullable=True,
        ),
        sa.Column('max_quantity', sa.Integer, nullable=False),
        sa.Column('period_type', sa.String(20), server_default='annual'),
        sa.Column('is_active', sa.Boolean, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=True),
        sa.UniqueConstraint(
            'organization_id', 'category_id', 'role_id',
            name='uq_allowance_org_cat_role',
        ),
    )
    op.create_index('idx_allowances_org', 'issuance_allowances', ['organization_id'])


def downgrade() -> None:
    op.drop_table('issuance_allowances')
    op.drop_column('item_issuances', 'charge_amount')
    op.drop_column('item_issuances', 'charge_status')
    op.drop_column('item_issuances', 'unit_cost_at_issuance')
    op.drop_column('inventory_items', 'replacement_cost')
