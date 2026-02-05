"""Add comprehensive organization fields

Revision ID: 20260202_0020
Revises: 20260202_0019
Create Date: 2026-02-02

Adds organization type, timezone, contact info, addresses, and identifiers
to support comprehensive organization setup during onboarding.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260202_0020'
down_revision = '20260202_0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add organization_type enum column
    op.add_column('organizations', sa.Column(
        'organization_type',
        sa.Enum('fire_department', 'ems_only', 'fire_ems_combined', name='organizationtype'),
        nullable=False,
        server_default='fire_department'
    ))

    # Add timezone
    op.add_column('organizations', sa.Column(
        'timezone',
        sa.String(50),
        nullable=True,
        server_default='America/New_York'
    ))

    # Add contact information fields
    op.add_column('organizations', sa.Column('phone', sa.String(20), nullable=True))
    op.add_column('organizations', sa.Column('fax', sa.String(20), nullable=True))
    op.add_column('organizations', sa.Column('email', sa.String(255), nullable=True))
    op.add_column('organizations', sa.Column('website', sa.String(255), nullable=True))

    # Add mailing address fields
    op.add_column('organizations', sa.Column('mailing_address_line1', sa.String(255), nullable=True))
    op.add_column('organizations', sa.Column('mailing_address_line2', sa.String(255), nullable=True))
    op.add_column('organizations', sa.Column('mailing_city', sa.String(100), nullable=True))
    op.add_column('organizations', sa.Column('mailing_state', sa.String(50), nullable=True))
    op.add_column('organizations', sa.Column('mailing_zip', sa.String(20), nullable=True))
    op.add_column('organizations', sa.Column('mailing_country', sa.String(100), nullable=True, server_default='USA'))

    # Add physical address fields
    op.add_column('organizations', sa.Column('physical_address_same', sa.Boolean(), nullable=True, server_default='1'))
    op.add_column('organizations', sa.Column('physical_address_line1', sa.String(255), nullable=True))
    op.add_column('organizations', sa.Column('physical_address_line2', sa.String(255), nullable=True))
    op.add_column('organizations', sa.Column('physical_city', sa.String(100), nullable=True))
    op.add_column('organizations', sa.Column('physical_state', sa.String(50), nullable=True))
    op.add_column('organizations', sa.Column('physical_zip', sa.String(20), nullable=True))
    op.add_column('organizations', sa.Column('physical_country', sa.String(100), nullable=True, server_default='USA'))

    # Add identifier_type enum column
    op.add_column('organizations', sa.Column(
        'identifier_type',
        sa.Enum('fdid', 'state_id', 'department_id', name='identifiertype'),
        nullable=False,
        server_default='department_id'
    ))

    # Add identifier fields
    op.add_column('organizations', sa.Column('fdid', sa.String(50), nullable=True))
    op.add_column('organizations', sa.Column('state_id', sa.String(50), nullable=True))
    op.add_column('organizations', sa.Column('department_id', sa.String(50), nullable=True))

    # Add additional information fields
    op.add_column('organizations', sa.Column('county', sa.String(100), nullable=True))
    op.add_column('organizations', sa.Column('founded_year', sa.Integer(), nullable=True))
    op.add_column('organizations', sa.Column('tax_id', sa.String(50), nullable=True))

    # Add logo field
    op.add_column('organizations', sa.Column('logo', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove all added columns in reverse order
    op.drop_column('organizations', 'logo')
    op.drop_column('organizations', 'tax_id')
    op.drop_column('organizations', 'founded_year')
    op.drop_column('organizations', 'county')
    op.drop_column('organizations', 'department_id')
    op.drop_column('organizations', 'state_id')
    op.drop_column('organizations', 'fdid')
    op.drop_column('organizations', 'identifier_type')
    op.drop_column('organizations', 'physical_country')
    op.drop_column('organizations', 'physical_zip')
    op.drop_column('organizations', 'physical_state')
    op.drop_column('organizations', 'physical_city')
    op.drop_column('organizations', 'physical_address_line2')
    op.drop_column('organizations', 'physical_address_line1')
    op.drop_column('organizations', 'physical_address_same')
    op.drop_column('organizations', 'mailing_country')
    op.drop_column('organizations', 'mailing_zip')
    op.drop_column('organizations', 'mailing_state')
    op.drop_column('organizations', 'mailing_city')
    op.drop_column('organizations', 'mailing_address_line2')
    op.drop_column('organizations', 'mailing_address_line1')
    op.drop_column('organizations', 'website')
    op.drop_column('organizations', 'email')
    op.drop_column('organizations', 'fax')
    op.drop_column('organizations', 'phone')
    op.drop_column('organizations', 'timezone')
    op.drop_column('organizations', 'organization_type')

    # Drop enum types (MySQL may need manual cleanup)
    # op.execute("DROP TYPE IF EXISTS organizationtype")
    # op.execute("DROP TYPE IF EXISTS identifiertype")
