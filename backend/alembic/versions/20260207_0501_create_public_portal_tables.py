"""Create public portal tables

Revision ID: 20260207_0501
Revises: 20260207_0500
Create Date: 2026-02-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '20260207_0501'
down_revision = '20260207_0500'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create public_portal_config table
    op.create_table(
        'public_portal_config',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('allowed_origins', sa.JSON(), nullable=False),
        sa.Column('default_rate_limit', sa.Integer(), nullable=False, server_default='1000'),
        sa.Column('cache_ttl_seconds', sa.Integer(), nullable=False, server_default='300'),
        sa.Column('settings', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.String(length=26), nullable=False),
        sa.Column('updated_at', sa.String(length=26), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('organization_id'),
    )
    op.create_index(op.f('ix_public_portal_config_organization_id'), 'public_portal_config', ['organization_id'], unique=False)

    # Create public_portal_api_keys table
    op.create_table(
        'public_portal_api_keys',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=False),
        sa.Column('config_id', sa.String(length=36), nullable=False),
        sa.Column('key_hash', sa.String(length=255), nullable=False),
        sa.Column('key_prefix', sa.String(length=8), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('rate_limit_override', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.String(length=26), nullable=True),
        sa.Column('last_used_at', sa.String(length=26), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.String(length=26), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['config_id'], ['public_portal_config.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.UniqueConstraint('key_hash'),
    )
    op.create_index(op.f('ix_public_portal_api_keys_organization_id'), 'public_portal_api_keys', ['organization_id'], unique=False)
    op.create_index('idx_api_key_prefix', 'public_portal_api_keys', ['key_prefix'], unique=False)
    op.create_index('idx_api_key_active', 'public_portal_api_keys', ['is_active'], unique=False)
    op.create_index(op.f('ix_public_portal_api_keys_key_hash'), 'public_portal_api_keys', ['key_hash'], unique=True)

    # Create public_portal_access_log table
    op.create_table(
        'public_portal_access_log',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=False),
        sa.Column('config_id', sa.String(length=36), nullable=False),
        sa.Column('api_key_id', sa.String(length=36), nullable=True),
        sa.Column('ip_address', sa.String(length=45), nullable=False),
        sa.Column('endpoint', sa.String(length=255), nullable=False),
        sa.Column('method', sa.String(length=10), nullable=False),
        sa.Column('status_code', sa.Integer(), nullable=False),
        sa.Column('response_time_ms', sa.Integer(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('referer', sa.String(length=500), nullable=True),
        sa.Column('timestamp', sa.String(length=26), nullable=False),
        sa.Column('flagged_suspicious', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('flag_reason', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['config_id'], ['public_portal_config.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['api_key_id'], ['public_portal_api_keys.id'], ondelete='SET NULL'),
    )
    op.create_index(op.f('ix_public_portal_access_log_organization_id'), 'public_portal_access_log', ['organization_id'], unique=False)
    op.create_index(op.f('ix_public_portal_access_log_api_key_id'), 'public_portal_access_log', ['api_key_id'], unique=False)
    op.create_index(op.f('ix_public_portal_access_log_ip_address'), 'public_portal_access_log', ['ip_address'], unique=False)
    op.create_index(op.f('ix_public_portal_access_log_endpoint'), 'public_portal_access_log', ['endpoint'], unique=False)
    op.create_index(op.f('ix_public_portal_access_log_status_code'), 'public_portal_access_log', ['status_code'], unique=False)
    op.create_index('idx_access_log_timestamp', 'public_portal_access_log', ['timestamp'], unique=False)
    op.create_index('idx_access_log_suspicious', 'public_portal_access_log', ['flagged_suspicious'], unique=False)
    op.create_index('idx_access_log_org_timestamp', 'public_portal_access_log', ['organization_id', 'timestamp'], unique=False)

    # Create public_portal_data_whitelist table
    op.create_table(
        'public_portal_data_whitelist',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('organization_id', sa.String(length=36), nullable=False),
        sa.Column('config_id', sa.String(length=36), nullable=False),
        sa.Column('data_category', sa.String(length=50), nullable=False),
        sa.Column('field_name', sa.String(length=100), nullable=False),
        sa.Column('is_enabled', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.String(length=26), nullable=False),
        sa.Column('updated_at', sa.String(length=26), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['config_id'], ['public_portal_config.id'], ondelete='CASCADE'),
    )
    op.create_index(op.f('ix_public_portal_data_whitelist_organization_id'), 'public_portal_data_whitelist', ['organization_id'], unique=False)
    op.create_index('idx_whitelist_category', 'public_portal_data_whitelist', ['data_category'], unique=False)
    op.create_index('idx_whitelist_enabled', 'public_portal_data_whitelist', ['is_enabled'], unique=False)
    op.create_index('idx_whitelist_unique', 'public_portal_data_whitelist', ['organization_id', 'data_category', 'field_name'], unique=True)


def downgrade() -> None:
    # Drop tables in reverse order (due to foreign keys)
    op.drop_table('public_portal_data_whitelist')
    op.drop_table('public_portal_access_log')
    op.drop_table('public_portal_api_keys')
    op.drop_table('public_portal_config')
