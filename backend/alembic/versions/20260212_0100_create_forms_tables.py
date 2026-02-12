"""create forms tables

Revision ID: 20260212_0100
Revises: 20260210_0023
Create Date: 2026-02-12 01:00:00.000000

Creates the forms, form_fields, and form_submissions tables
for the custom forms module.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260212_0100'
down_revision = '20260210_0023'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Forms table
    op.create_table(
        'forms',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('category', sa.Enum('Safety', 'Operations', 'Administration', 'Training', 'Other', name='formcategory'), nullable=False, server_default='Operations'),
        sa.Column('status', sa.Enum('draft', 'published', 'archived', name='formstatus'), nullable=False, server_default='draft'),
        sa.Column('allow_multiple_submissions', sa.Boolean, server_default='1'),
        sa.Column('require_authentication', sa.Boolean, server_default='1'),
        sa.Column('notify_on_submission', sa.Boolean, server_default='0'),
        sa.Column('notification_emails', sa.JSON),
        sa.Column('version', sa.Integer, server_default='1'),
        sa.Column('is_template', sa.Boolean, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('published_at', sa.DateTime(timezone=True)),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_forms_org_status', 'forms', ['organization_id', 'status'])
    op.create_index('idx_forms_org_category', 'forms', ['organization_id', 'category'])
    op.create_index('idx_forms_org_template', 'forms', ['organization_id', 'is_template'])

    # Form fields table
    op.create_table(
        'form_fields',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('form_id', sa.String(36), sa.ForeignKey('forms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('label', sa.String(255), nullable=False),
        sa.Column('field_type', sa.Enum(
            'text', 'textarea', 'number', 'email', 'phone', 'date', 'time', 'datetime',
            'select', 'multiselect', 'checkbox', 'radio', 'file', 'signature', 'section_header',
            name='fieldtype'
        ), nullable=False),
        sa.Column('placeholder', sa.String(255)),
        sa.Column('help_text', sa.Text),
        sa.Column('default_value', sa.Text),
        sa.Column('required', sa.Boolean, server_default='0'),
        sa.Column('min_length', sa.Integer),
        sa.Column('max_length', sa.Integer),
        sa.Column('min_value', sa.Integer),
        sa.Column('max_value', sa.Integer),
        sa.Column('validation_pattern', sa.String(500)),
        sa.Column('options', sa.JSON),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('width', sa.String(20), server_default='full'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_form_fields_form_order', 'form_fields', ['form_id', 'sort_order'])

    # Form submissions table
    op.create_table(
        'form_submissions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('form_id', sa.String(36), sa.ForeignKey('forms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('data', sa.JSON, nullable=False),
        sa.Column('ip_address', sa.String(45)),
        sa.Column('user_agent', sa.String(500)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_form_submissions_org_form', 'form_submissions', ['organization_id', 'form_id'])
    op.create_index('idx_form_submissions_org_user', 'form_submissions', ['organization_id', 'submitted_by'])

    print("Created forms, form_fields, and form_submissions tables")


def downgrade() -> None:
    op.drop_table('form_submissions')
    op.drop_table('form_fields')
    op.drop_table('forms')
    print("Dropped forms tables")
