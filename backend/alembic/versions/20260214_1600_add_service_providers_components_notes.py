"""Add service providers, components, and component notes tables

Revision ID: 20260214_1600
Revises: 20260214_1500
Create Date: 2026-02-14

Adds three new tables for apparatus module:
- apparatus_service_providers: Track service companies/individuals
- apparatus_components: Vehicle sub-system segmentation
- apparatus_component_notes: Per-component service notes/issues

Also adds component_id and service_provider_id FK columns to
the existing apparatus_maintenance table.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1600'
down_revision = '20260214_1500'
branch_labels = None
depends_on = None

# Enum values for the new columns
COMPONENT_TYPE_VALUES = [
    'engine', 'pump', 'aerial', 'chassis', 'drivetrain', 'brakes',
    'electrical', 'hydraulic', 'body', 'cab', 'tank', 'foam_system',
    'cooling', 'exhaust', 'lighting', 'communications',
    'safety_equipment', 'hvac', 'tires_wheels', 'other',
]

COMPONENT_CONDITION_VALUES = ['excellent', 'good', 'fair', 'poor', 'critical']

NOTE_TYPE_VALUES = ['observation', 'repair', 'issue', 'inspection', 'update']

NOTE_SEVERITY_VALUES = ['info', 'low', 'medium', 'high', 'critical']

NOTE_STATUS_VALUES = ['open', 'in_progress', 'resolved', 'deferred']


def upgrade() -> None:
    # =========================================================================
    # 1. Create apparatus_service_providers table
    # =========================================================================
    op.create_table(
        'apparatus_service_providers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36),
                   sa.ForeignKey('organizations.id', ondelete='CASCADE'),
                   nullable=False),
        # Provider Identity
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('company_name', sa.String(200), nullable=True),
        sa.Column('contact_name', sa.String(200), nullable=True),
        # Contact Information
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('email', sa.String(200), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('zip_code', sa.String(20), nullable=True),
        sa.Column('website', sa.String(300), nullable=True),
        # Capabilities
        sa.Column('specialties', sa.JSON(), nullable=True),
        sa.Column('certifications', sa.JSON(), nullable=True),
        sa.Column('is_emergency_service', sa.Boolean(), nullable=False,
                   server_default='0'),
        # Business Details
        sa.Column('license_number', sa.String(100), nullable=True),
        sa.Column('insurance_info', sa.Text(), nullable=True),
        sa.Column('tax_id', sa.String(50), nullable=True),
        # Preference
        sa.Column('is_preferred', sa.Boolean(), nullable=False,
                   server_default='0'),
        sa.Column('rating', sa.Integer(), nullable=True),
        # Notes
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('contract_info', sa.Text(), nullable=True),
        # Status
        sa.Column('is_active', sa.Boolean(), nullable=False,
                   server_default='1'),
        # Timestamps
        sa.Column('created_by', sa.String(36),
                   sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
    )

    op.create_index('idx_service_providers_org',
                     'apparatus_service_providers', ['organization_id'])
    op.create_index('idx_service_providers_org_name',
                     'apparatus_service_providers',
                     ['organization_id', 'name'])
    op.create_index('idx_service_providers_preferred',
                     'apparatus_service_providers',
                     ['organization_id', 'is_preferred'])

    # =========================================================================
    # 2. Create apparatus_components table
    # =========================================================================
    component_type_enum = sa.Enum(
        *COMPONENT_TYPE_VALUES, name='componenttype',
    )
    component_condition_enum = sa.Enum(
        *COMPONENT_CONDITION_VALUES, name='componentcondition',
    )

    op.create_table(
        'apparatus_components',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36),
                   sa.ForeignKey('organizations.id', ondelete='CASCADE'),
                   nullable=False),
        sa.Column('apparatus_id', sa.String(36),
                   sa.ForeignKey('apparatus.id', ondelete='CASCADE'),
                   nullable=False),
        # Component Identity
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('component_type', component_type_enum,
                   nullable=False, server_default='other'),
        sa.Column('description', sa.Text(), nullable=True),
        # Manufacturer Details
        sa.Column('manufacturer', sa.String(200), nullable=True),
        sa.Column('model_number', sa.String(100), nullable=True),
        sa.Column('serial_number', sa.String(100), nullable=True),
        # Lifecycle
        sa.Column('install_date', sa.Date(), nullable=True),
        sa.Column('warranty_expiration', sa.Date(), nullable=True),
        sa.Column('expected_life_years', sa.Integer(), nullable=True),
        # Condition
        sa.Column('condition', component_condition_enum,
                   nullable=False, server_default='good'),
        sa.Column('last_serviced_date', sa.Date(), nullable=True),
        sa.Column('last_inspected_date', sa.Date(), nullable=True),
        # Notes
        sa.Column('notes', sa.Text(), nullable=True),
        # Display
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False,
                   server_default='1'),
        # Timestamps
        sa.Column('created_by', sa.String(36),
                   sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
    )

    op.create_index('idx_apparatus_components_apparatus',
                     'apparatus_components', ['apparatus_id'])
    op.create_index('idx_apparatus_components_type',
                     'apparatus_components',
                     ['apparatus_id', 'component_type'])
    op.create_index('idx_apparatus_components_condition',
                     'apparatus_components', ['condition'])
    op.create_index('idx_apparatus_components_org',
                     'apparatus_components', ['organization_id'])

    # =========================================================================
    # 3. Create apparatus_component_notes table
    # =========================================================================
    note_type_enum = sa.Enum(*NOTE_TYPE_VALUES, name='notetype')
    note_severity_enum = sa.Enum(*NOTE_SEVERITY_VALUES, name='noteseverity')
    note_status_enum = sa.Enum(*NOTE_STATUS_VALUES, name='notestatus')

    op.create_table(
        'apparatus_component_notes',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36),
                   sa.ForeignKey('organizations.id', ondelete='CASCADE'),
                   nullable=False),
        sa.Column('apparatus_id', sa.String(36),
                   sa.ForeignKey('apparatus.id', ondelete='CASCADE'),
                   nullable=False),
        sa.Column('component_id', sa.String(36),
                   sa.ForeignKey('apparatus_components.id',
                                 ondelete='CASCADE'),
                   nullable=False),
        # Note Details
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('note_type', note_type_enum,
                   nullable=False, server_default='observation'),
        sa.Column('severity', note_severity_enum,
                   nullable=False, server_default='info'),
        sa.Column('status', note_status_enum,
                   nullable=False, server_default='open'),
        # Service Provider
        sa.Column('service_provider_id', sa.String(36),
                   sa.ForeignKey('apparatus_service_providers.id',
                                 ondelete='SET NULL'),
                   nullable=True),
        # Cost tracking
        sa.Column('estimated_cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('actual_cost', sa.Numeric(10, 2), nullable=True),
        # Resolution
        sa.Column('reported_by', sa.String(36),
                   sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolved_by', sa.String(36),
                   sa.ForeignKey('users.id'), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),
        # Attachments and tags
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                   server_default=sa.func.now()),
    )

    op.create_index('idx_component_notes_apparatus',
                     'apparatus_component_notes', ['apparatus_id'])
    op.create_index('idx_component_notes_component',
                     'apparatus_component_notes', ['component_id'])
    op.create_index('idx_component_notes_status',
                     'apparatus_component_notes', ['status'])
    op.create_index('idx_component_notes_severity',
                     'apparatus_component_notes', ['severity'])
    op.create_index('idx_component_notes_type',
                     'apparatus_component_notes', ['note_type'])
    op.create_index('idx_component_notes_provider',
                     'apparatus_component_notes', ['service_provider_id'])
    op.create_index('idx_component_notes_org',
                     'apparatus_component_notes', ['organization_id'])

    # =========================================================================
    # 4. Add component_id and service_provider_id to apparatus_maintenance
    # =========================================================================
    op.add_column(
        'apparatus_maintenance',
        sa.Column('component_id', sa.String(36),
                   sa.ForeignKey('apparatus_components.id',
                                 ondelete='SET NULL'),
                   nullable=True),
    )
    op.add_column(
        'apparatus_maintenance',
        sa.Column('service_provider_id', sa.String(36),
                   sa.ForeignKey('apparatus_service_providers.id',
                                 ondelete='SET NULL'),
                   nullable=True),
    )

    op.create_index('idx_apparatus_maint_component',
                     'apparatus_maintenance', ['component_id'])
    op.create_index('idx_apparatus_maint_provider',
                     'apparatus_maintenance', ['service_provider_id'])


def downgrade() -> None:
    # Remove FK columns from apparatus_maintenance
    op.drop_index('idx_apparatus_maint_provider',
                   table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_component',
                   table_name='apparatus_maintenance')
    op.drop_column('apparatus_maintenance', 'service_provider_id')
    op.drop_column('apparatus_maintenance', 'component_id')

    # Drop apparatus_component_notes
    op.drop_index('idx_component_notes_org',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_provider',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_type',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_severity',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_status',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_component',
                   table_name='apparatus_component_notes')
    op.drop_index('idx_component_notes_apparatus',
                   table_name='apparatus_component_notes')
    op.drop_table('apparatus_component_notes')

    # Drop apparatus_components
    op.drop_index('idx_apparatus_components_org',
                   table_name='apparatus_components')
    op.drop_index('idx_apparatus_components_condition',
                   table_name='apparatus_components')
    op.drop_index('idx_apparatus_components_type',
                   table_name='apparatus_components')
    op.drop_index('idx_apparatus_components_apparatus',
                   table_name='apparatus_components')
    op.drop_table('apparatus_components')

    # Drop apparatus_service_providers
    op.drop_index('idx_service_providers_preferred',
                   table_name='apparatus_service_providers')
    op.drop_index('idx_service_providers_org_name',
                   table_name='apparatus_service_providers')
    op.drop_index('idx_service_providers_org',
                   table_name='apparatus_service_providers')
    op.drop_table('apparatus_service_providers')

    # Drop enum types
    sa.Enum(name='notestatus').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='noteseverity').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='notetype').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='componentcondition').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='componenttype').drop(op.get_bind(), checkfirst=True)
