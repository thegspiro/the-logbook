"""Add training categories and due date type

Revision ID: 20260205_0100
Revises: 20260205_0024
Create Date: 2026-02-05 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '20260205_0100'
down_revision = '20260205_0024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create training_categories table
    op.create_table(
        'training_categories',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('code', sa.String(50)),
        sa.Column('description', sa.Text),
        sa.Column('color', sa.String(7)),
        sa.Column('parent_category_id', sa.String(36), sa.ForeignKey('training_categories.id', ondelete='SET NULL'), nullable=True),
        sa.Column('sort_order', sa.Integer, default=0),
        sa.Column('icon', sa.String(50)),
        sa.Column('active', sa.Boolean, default=True, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )

    # Create indexes for training_categories
    op.create_index('idx_category_org_code', 'training_categories', ['organization_id', 'code'])
    op.create_index('idx_category_parent', 'training_categories', ['parent_category_id'])

    # Add category_ids to training_courses
    op.add_column('training_courses', sa.Column('category_ids', sa.JSON, nullable=True))

    # Add new columns to training_requirements
    # Due date type enum - using string for MySQL compatibility
    op.add_column('training_requirements', sa.Column('due_date_type', sa.String(50), default='calendar_period'))
    op.add_column('training_requirements', sa.Column('rolling_period_months', sa.Integer, nullable=True))
    op.add_column('training_requirements', sa.Column('period_start_month', sa.Integer, default=1))
    op.add_column('training_requirements', sa.Column('period_start_day', sa.Integer, default=1))
    op.add_column('training_requirements', sa.Column('category_ids', sa.JSON, nullable=True))


def downgrade() -> None:
    # Remove columns from training_requirements
    op.drop_column('training_requirements', 'category_ids')
    op.drop_column('training_requirements', 'period_start_day')
    op.drop_column('training_requirements', 'period_start_month')
    op.drop_column('training_requirements', 'rolling_period_months')
    op.drop_column('training_requirements', 'due_date_type')

    # Remove category_ids from training_courses
    op.drop_column('training_courses', 'category_ids')

    # Drop indexes
    op.drop_index('idx_category_parent', table_name='training_categories')
    op.drop_index('idx_category_org_code', table_name='training_categories')

    # Drop training_categories table
    op.drop_table('training_categories')
