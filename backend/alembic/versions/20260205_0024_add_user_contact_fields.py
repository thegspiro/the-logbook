"""Add user contact and profile fields

Revision ID: 20260205_0024
Revises: 20260203_0023
Create Date: 2026-02-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import JSON


# revision identifiers, used by Alembic.
revision = '20260205_0024'
down_revision = '20260203_0023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new user profile fields
    op.add_column('users', sa.Column('middle_name', sa.String(100), nullable=True))
    op.add_column('users', sa.Column('rank', sa.String(100), nullable=True))
    op.add_column('users', sa.Column('station', sa.String(100), nullable=True))

    # Address fields
    op.add_column('users', sa.Column('address_street', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('address_city', sa.String(100), nullable=True))
    op.add_column('users', sa.Column('address_state', sa.String(50), nullable=True))
    op.add_column('users', sa.Column('address_zip', sa.String(20), nullable=True))
    op.add_column('users', sa.Column('address_country', sa.String(100), nullable=True, server_default='USA'))

    # Emergency contacts as JSON
    op.add_column('users', sa.Column('emergency_contacts', JSON, nullable=True))


def downgrade() -> None:
    # Remove the new columns
    op.drop_column('users', 'emergency_contacts')
    op.drop_column('users', 'address_country')
    op.drop_column('users', 'address_zip')
    op.drop_column('users', 'address_state')
    op.drop_column('users', 'address_city')
    op.drop_column('users', 'address_street')
    op.drop_column('users', 'station')
    op.drop_column('users', 'rank')
    op.drop_column('users', 'middle_name')
