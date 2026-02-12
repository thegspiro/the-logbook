"""add public forms and integrations

Revision ID: 20260212_0200
Revises: 20260212_0100
Create Date: 2026-02-12 02:00:00.000000

Adds public form access (public_slug, is_public) to forms table,
public submission metadata to form_submissions table,
member_lookup field type, and creates the form_integrations table
for cross-module data flow.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0200'
down_revision = '20260212_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add member_lookup to the fieldtype enum (MySQL requires column modify)
    op.alter_column(
        'form_fields',
        'field_type',
        existing_type=sa.Enum(
            'text', 'textarea', 'number', 'email', 'phone', 'date', 'time', 'datetime',
            'select', 'multiselect', 'checkbox', 'radio', 'file', 'signature', 'section_header',
            name='fieldtype'
        ),
        type_=sa.Enum(
            'text', 'textarea', 'number', 'email', 'phone', 'date', 'time', 'datetime',
            'select', 'multiselect', 'checkbox', 'radio', 'file', 'signature', 'section_header',
            'member_lookup',
            name='fieldtype'
        ),
        existing_nullable=False,
    )

    # Add public access columns to forms table
    op.add_column('forms', sa.Column('public_slug', sa.String(12), unique=True, index=True))
    op.add_column('forms', sa.Column('is_public', sa.Boolean, server_default='0'))

    # Add public submission metadata to form_submissions table
    op.add_column('form_submissions', sa.Column('submitter_name', sa.String(255)))
    op.add_column('form_submissions', sa.Column('submitter_email', sa.String(255)))
    op.add_column('form_submissions', sa.Column('is_public_submission', sa.Boolean, server_default='0'))
    op.add_column('form_submissions', sa.Column('integration_processed', sa.Boolean, server_default='0'))
    op.add_column('form_submissions', sa.Column('integration_result', sa.JSON))

    # Create form_integrations table
    op.create_table(
        'form_integrations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('form_id', sa.String(36), sa.ForeignKey('forms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_module', sa.Enum('membership', 'inventory', name='integrationtarget'), nullable=False),
        sa.Column('integration_type', sa.Enum('membership_interest', 'equipment_assignment', name='integrationtype'), nullable=False),
        sa.Column('field_mappings', sa.JSON, nullable=False),
        sa.Column('is_active', sa.Boolean, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('form_id', 'target_module', name='uq_form_integration_target'),
    )
    op.create_index('idx_form_integrations_form', 'form_integrations', ['form_id'])

    print("Added public forms support and form_integrations table")


def downgrade() -> None:
    op.drop_table('form_integrations')

    op.drop_column('form_submissions', 'integration_result')
    op.drop_column('form_submissions', 'integration_processed')
    op.drop_column('form_submissions', 'is_public_submission')
    op.drop_column('form_submissions', 'submitter_email')
    op.drop_column('form_submissions', 'submitter_name')

    op.drop_column('forms', 'is_public')
    op.drop_column('forms', 'public_slug')

    # Revert fieldtype enum to remove member_lookup
    op.alter_column(
        'form_fields',
        'field_type',
        existing_type=sa.Enum(
            'text', 'textarea', 'number', 'email', 'phone', 'date', 'time', 'datetime',
            'select', 'multiselect', 'checkbox', 'radio', 'file', 'signature', 'section_header',
            'member_lookup',
            name='fieldtype'
        ),
        type_=sa.Enum(
            'text', 'textarea', 'number', 'email', 'phone', 'date', 'time', 'datetime',
            'select', 'multiselect', 'checkbox', 'radio', 'file', 'signature', 'section_header',
            name='fieldtype'
        ),
        existing_nullable=False,
    )

    print("Removed public forms support and form_integrations table")
