"""Unify locations and facilities with bridge FK, add location_id to training records

Adds facility_id to locations table so Location records can optionally
reference a Facility when the Facilities module is enabled. This makes
the locations table the universal "place picker" across all modules.

Also adds location_id FK to training_records so training data can reference
wizard-created locations instead of relying on free-text strings.

Revision ID: 20260218_0800
Revises: 20260218_0700
Create Date: 2026-02-18
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '20260218_0800'
down_revision = '20260218_0700'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add facility_id FK to locations table — bridges Location to Facility
    op.add_column('locations', sa.Column('facility_id', sa.String(36), nullable=True))
    op.create_foreign_key(
        'fk_locations_facility_id',
        'locations', 'facilities',
        ['facility_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_locations_facility_id', 'locations', ['facility_id'])

    # Add location_id FK to training_records — replaces free-text location
    op.add_column('training_records', sa.Column('location_id', sa.String(36), nullable=True))
    op.create_foreign_key(
        'fk_training_records_location_id',
        'training_records', 'locations',
        ['location_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('idx_record_location', 'training_records', ['location_id'])


def downgrade() -> None:
    # Remove location_id from training_records
    op.drop_index('idx_record_location', table_name='training_records')
    op.drop_constraint('fk_training_records_location_id', 'training_records', type_='foreignkey')
    op.drop_column('training_records', 'location_id')

    # Remove facility_id from locations
    op.drop_index('ix_locations_facility_id', table_name='locations')
    op.drop_constraint('fk_locations_facility_id', 'locations', type_='foreignkey')
    op.drop_column('locations', 'facility_id')
