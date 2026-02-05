"""Add external training integration tables

Revision ID: 20260205_0200
Revises: 20260205_0100
Create Date: 2026-02-05 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260205_0200'
down_revision = '20260205_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create external_training_providers table
    op.create_table(
        'external_training_providers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('provider_type', sa.String(50), nullable=False),  # vector_solutions, target_solutions, etc.
        sa.Column('description', sa.Text),
        sa.Column('api_base_url', sa.String(500)),
        sa.Column('api_key', sa.Text),  # Should be encrypted in production
        sa.Column('api_secret', sa.Text),  # Should be encrypted in production
        sa.Column('client_id', sa.String(255)),
        sa.Column('client_secret', sa.Text),  # Should be encrypted in production
        sa.Column('auth_type', sa.String(50), default='api_key'),
        sa.Column('config', sa.JSON),
        sa.Column('auto_sync_enabled', sa.Boolean, default=False),
        sa.Column('sync_interval_hours', sa.Integer, default=24),
        sa.Column('last_sync_at', sa.DateTime(timezone=True)),
        sa.Column('next_sync_at', sa.DateTime(timezone=True)),
        sa.Column('default_category_id', sa.String(36), sa.ForeignKey('training_categories.id', ondelete='SET NULL')),
        sa.Column('active', sa.Boolean, default=True, index=True),
        sa.Column('connection_verified', sa.Boolean, default=False),
        sa.Column('last_connection_test', sa.DateTime(timezone=True)),
        sa.Column('connection_error', sa.Text),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )

    # Create indexes for external_training_providers
    op.create_index('idx_ext_provider_org', 'external_training_providers', ['organization_id', 'active'])
    op.create_index('idx_ext_provider_type', 'external_training_providers', ['provider_type'])

    # Create external_category_mappings table
    op.create_table(
        'external_category_mappings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('provider_id', sa.String(36), sa.ForeignKey('external_training_providers.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('external_category_id', sa.String(255), nullable=False),
        sa.Column('external_category_name', sa.String(255), nullable=False),
        sa.Column('external_category_code', sa.String(100)),
        sa.Column('internal_category_id', sa.String(36), sa.ForeignKey('training_categories.id', ondelete='SET NULL')),
        sa.Column('is_mapped', sa.Boolean, default=False),
        sa.Column('auto_mapped', sa.Boolean, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('mapped_by', sa.String(36), sa.ForeignKey('users.id')),
    )

    # Create indexes for external_category_mappings
    op.create_index('idx_ext_mapping_provider', 'external_category_mappings', ['provider_id'])
    op.create_index('idx_ext_mapping_external', 'external_category_mappings', ['provider_id', 'external_category_id'])

    # Create external_user_mappings table
    op.create_table(
        'external_user_mappings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('provider_id', sa.String(36), sa.ForeignKey('external_training_providers.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('external_user_id', sa.String(255), nullable=False),
        sa.Column('external_username', sa.String(255)),
        sa.Column('external_email', sa.String(255)),
        sa.Column('external_name', sa.String(255)),
        sa.Column('internal_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('is_mapped', sa.Boolean, default=False),
        sa.Column('auto_mapped', sa.Boolean, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('mapped_by', sa.String(36), sa.ForeignKey('users.id')),
    )

    # Create indexes for external_user_mappings
    op.create_index('idx_ext_user_provider', 'external_user_mappings', ['provider_id'])
    op.create_index('idx_ext_user_external', 'external_user_mappings', ['provider_id', 'external_user_id'])
    op.create_index('idx_ext_user_internal', 'external_user_mappings', ['internal_user_id'])

    # Create external_training_sync_logs table
    op.create_table(
        'external_training_sync_logs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('provider_id', sa.String(36), sa.ForeignKey('external_training_providers.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('sync_type', sa.String(50), nullable=False),  # full, incremental, manual
        sa.Column('status', sa.String(50), default='pending', index=True),  # pending, in_progress, completed, failed, partial
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('completed_at', sa.DateTime(timezone=True)),
        sa.Column('records_fetched', sa.Integer, default=0),
        sa.Column('records_imported', sa.Integer, default=0),
        sa.Column('records_updated', sa.Integer, default=0),
        sa.Column('records_skipped', sa.Integer, default=0),
        sa.Column('records_failed', sa.Integer, default=0),
        sa.Column('error_message', sa.Text),
        sa.Column('error_details', sa.JSON),
        sa.Column('sync_from_date', sa.Date),
        sa.Column('sync_to_date', sa.Date),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('initiated_by', sa.String(36), sa.ForeignKey('users.id')),
    )

    # Create indexes for external_training_sync_logs
    op.create_index('idx_sync_log_provider', 'external_training_sync_logs', ['provider_id', 'status'])
    op.create_index('idx_sync_log_date', 'external_training_sync_logs', ['started_at'])

    # Create external_training_imports table
    op.create_table(
        'external_training_imports',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('provider_id', sa.String(36), sa.ForeignKey('external_training_providers.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('sync_log_id', sa.String(36), sa.ForeignKey('external_training_sync_logs.id', ondelete='SET NULL'), index=True),
        sa.Column('external_record_id', sa.String(255), nullable=False),
        sa.Column('external_user_id', sa.String(255)),
        sa.Column('external_course_id', sa.String(255)),
        sa.Column('external_category_id', sa.String(255)),
        sa.Column('course_title', sa.String(500), nullable=False),
        sa.Column('course_code', sa.String(100)),
        sa.Column('description', sa.Text),
        sa.Column('duration_minutes', sa.Integer),
        sa.Column('completion_date', sa.DateTime(timezone=True)),
        sa.Column('score', sa.Float),
        sa.Column('passed', sa.Boolean),
        sa.Column('external_category_name', sa.String(255)),
        sa.Column('raw_data', sa.JSON),
        sa.Column('training_record_id', sa.String(36), sa.ForeignKey('training_records.id', ondelete='SET NULL'), index=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), index=True),
        sa.Column('import_status', sa.String(50), default='pending', index=True),  # pending, imported, failed, skipped, duplicate
        sa.Column('import_error', sa.Text),
        sa.Column('imported_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    # Create indexes for external_training_imports
    op.create_index('idx_ext_import_provider', 'external_training_imports', ['provider_id', 'import_status'])
    op.create_index('idx_ext_import_external', 'external_training_imports', ['provider_id', 'external_record_id'])
    op.create_index('idx_ext_import_user', 'external_training_imports', ['user_id'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_ext_import_user', table_name='external_training_imports')
    op.drop_index('idx_ext_import_external', table_name='external_training_imports')
    op.drop_index('idx_ext_import_provider', table_name='external_training_imports')

    op.drop_index('idx_sync_log_date', table_name='external_training_sync_logs')
    op.drop_index('idx_sync_log_provider', table_name='external_training_sync_logs')

    op.drop_index('idx_ext_user_internal', table_name='external_user_mappings')
    op.drop_index('idx_ext_user_external', table_name='external_user_mappings')
    op.drop_index('idx_ext_user_provider', table_name='external_user_mappings')

    op.drop_index('idx_ext_mapping_external', table_name='external_category_mappings')
    op.drop_index('idx_ext_mapping_provider', table_name='external_category_mappings')

    op.drop_index('idx_ext_provider_type', table_name='external_training_providers')
    op.drop_index('idx_ext_provider_org', table_name='external_training_providers')

    # Drop tables in reverse order
    op.drop_table('external_training_imports')
    op.drop_table('external_training_sync_logs')
    op.drop_table('external_user_mappings')
    op.drop_table('external_category_mappings')
    op.drop_table('external_training_providers')
