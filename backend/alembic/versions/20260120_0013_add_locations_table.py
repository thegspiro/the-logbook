"""add locations table and event location_id

Revision ID: 20260120_0013
Revises: 20260119_0012
Create Date: 2026-01-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '20260120_0013'
down_revision = '20260119_0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create locations table
    op.create_table(
        'locations',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('building', sa.String(100), nullable=True),
        sa.Column('floor', sa.String(20), nullable=True),
        sa.Column('room_number', sa.String(50), nullable=True),
        sa.Column('capacity', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )

    # Create indexes for locations
    op.create_index('ix_locations_organization_id', 'locations', ['organization_id'])
    op.create_index('ix_locations_name', 'locations', ['name'])
    op.create_index('ix_locations_is_active', 'locations', ['is_active'])

    # Add location_id column to events table (nullable for backward compatibility)
    op.add_column('events', sa.Column('location_id', sa.String(36), nullable=True))

    # Create foreign key constraint for location_id
    op.create_foreign_key(
        'fk_events_location_id',
        'events',
        'locations',
        ['location_id'],
        ['id']
    )

    # Create index for location_id
    op.create_index('ix_events_location_id', 'events', ['location_id'])


def downgrade() -> None:
    # Drop index and foreign key from events
    op.drop_index('ix_events_location_id', table_name='events')
    op.drop_constraint('fk_events_location_id', 'events', type_='foreignkey')
    op.drop_column('events', 'location_id')

    # Drop indexes from locations
    op.drop_index('ix_locations_is_active', table_name='locations')
    op.drop_index('ix_locations_name', table_name='locations')
    op.drop_index('ix_locations_organization_id', table_name='locations')

    # Drop locations table
    op.drop_table('locations')
