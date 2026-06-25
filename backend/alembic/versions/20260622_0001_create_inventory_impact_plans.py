"""Create inventory_impact_plans table

Adds the inventory_impact_plans table that stores saved, named
impact-planner scenarios (their filter set) so quartermasters can re-run
recurring plans without re-entering filters.

Revision ID: 20260622_0001
Revises: 20260613_0001
Create Date: 2026-06-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260622_0001'
down_revision = '20260613_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'inventory_impact_plans',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column(
            'organization_id', sa.String(36),
            sa.ForeignKey('organizations.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('filters', sa.JSON, nullable=False),
        sa.Column(
            'created_by', sa.String(36),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        'idx_impact_plans_org', 'inventory_impact_plans', ['organization_id']
    )


def downgrade() -> None:
    op.drop_index('idx_impact_plans_org', table_name='inventory_impact_plans')
    op.drop_table('inventory_impact_plans')
