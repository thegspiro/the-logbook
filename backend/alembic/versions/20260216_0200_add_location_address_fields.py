"""Add address fields to locations table

Adds street address, city, state, zip, latitude, and longitude columns
to the locations table so frontend location forms work correctly.

Revision ID: 20260216_0200
Revises: 20260216_0100
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260216_0200'
down_revision = '20260216_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('locations', sa.Column('address', sa.String(255), nullable=True))
    op.add_column('locations', sa.Column('city', sa.String(100), nullable=True))
    op.add_column('locations', sa.Column('state', sa.String(50), nullable=True))
    op.add_column('locations', sa.Column('zip', sa.String(20), nullable=True))
    op.add_column('locations', sa.Column('latitude', sa.String(20), nullable=True))
    op.add_column('locations', sa.Column('longitude', sa.String(20), nullable=True))
    print("Added address fields to locations table")


def downgrade() -> None:
    op.drop_column('locations', 'longitude')
    op.drop_column('locations', 'latitude')
    op.drop_column('locations', 'zip')
    op.drop_column('locations', 'state')
    op.drop_column('locations', 'city')
    op.drop_column('locations', 'address')
    print("Removed address fields from locations table")
