"""Initial schema setup

Revision ID: 0001
Revises:
Create Date: 2026-01-18

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create organizations table
    op.create_table(
        'organizations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False, unique=True),
        sa.Column('description', sa.Text()),
        sa.Column('type', sa.String(50), server_default='fire_department'),
        sa.Column('settings', postgresql.JSONB(), server_default='{}'),
        sa.Column('active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_org_active', 'organizations', ['active'])

    # Create users table
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.String(255)),
        sa.Column('first_name', sa.String(100)),
        sa.Column('last_name', sa.String(100)),
        sa.Column('badge_number', sa.String(50)),
        sa.Column('phone', sa.String(20)),
        sa.Column('mobile', sa.String(20)),
        sa.Column('photo_url', sa.Text()),
        sa.Column('date_of_birth', sa.Date()),
        sa.Column('hire_date', sa.Date()),
        sa.Column('status', sa.Enum('active', 'inactive', 'suspended', 'probationary', 'retired', name='userstatus'), server_default='active'),
        sa.Column('email_verified', sa.Boolean(), server_default='false'),
        sa.Column('email_verified_at', sa.DateTime(timezone=True)),
        sa.Column('mfa_enabled', sa.Boolean(), server_default='false'),
        sa.Column('mfa_secret', sa.String(32)),
        sa.Column('mfa_backup_codes', postgresql.JSONB()),
        sa.Column('password_changed_at', sa.DateTime(timezone=True)),
        sa.Column('failed_login_attempts', sa.Integer(), server_default='0'),
        sa.Column('locked_until', sa.DateTime(timezone=True)),
        sa.Column('last_login_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('deleted_at', sa.DateTime(timezone=True)),
    )
    op.create_index('idx_user_org_id', 'users', ['organization_id'])
    op.create_index('idx_user_email', 'users', ['email'])
    op.create_index('idx_user_status', 'users', ['status'])
    op.create_index('idx_user_org_username', 'users', ['organization_id', 'username'], unique=True)
    op.create_index('idx_user_org_email', 'users', ['organization_id', 'email'], unique=True)

    # Create roles table
    op.create_table(
        'roles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('permissions', postgresql.JSONB(), server_default='[]'),
        sa.Column('is_system', sa.Boolean(), server_default='false'),
        sa.Column('priority', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_role_org_id', 'roles', ['organization_id'])
    op.create_index('idx_role_org_slug', 'roles', ['organization_id', 'slug'], unique=True)

    # Create user_roles association table
    op.create_table(
        'user_roles',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('assigned_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_user_role', 'user_roles', ['user_id', 'role_id'], unique=True)

    # Create sessions table
    op.create_table(
        'sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token', sa.Text(), nullable=False, unique=True),
        sa.Column('refresh_token', sa.Text()),
        sa.Column('ip_address', sa.String(45)),
        sa.Column('user_agent', sa.Text()),
        sa.Column('device_info', postgresql.JSONB()),
        sa.Column('geo_location', postgresql.JSONB()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_activity', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index('idx_session_user_id', 'sessions', ['user_id'])
    op.create_index('idx_session_token', 'sessions', ['token'], unique=True)
    op.create_index('idx_session_expires', 'sessions', ['expires_at'])

    # Create audit_logs table
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('timestamp_nanos', sa.BigInteger(), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('event_category', sa.String(50), nullable=False),
        sa.Column('severity', sa.Enum('info', 'warning', 'critical', name='severitylevel'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True)),
        sa.Column('username', sa.String(255)),
        sa.Column('session_id', postgresql.UUID(as_uuid=True)),
        sa.Column('ip_address', postgresql.INET()),
        sa.Column('user_agent', sa.Text()),
        sa.Column('geo_location', postgresql.JSONB()),
        sa.Column('event_data', postgresql.JSONB(), nullable=False),
        sa.Column('sensitive_data_encrypted', sa.Text()),
        sa.Column('previous_hash', sa.String(64), nullable=False),
        sa.Column('current_hash', sa.String(64), nullable=False),
        sa.Column('server_id', sa.String(100)),
        sa.Column('process_id', sa.Integer()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('idx_audit_timestamp', 'audit_logs', ['timestamp'])
    op.create_index('idx_audit_user_id', 'audit_logs', ['user_id'])
    op.create_index('idx_audit_event_type', 'audit_logs', ['event_type'])
    op.create_index('idx_audit_current_hash', 'audit_logs', ['current_hash'])

    # Create audit_log_checkpoints table
    op.create_table(
        'audit_log_checkpoints',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('checkpoint_time', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('first_log_id', sa.BigInteger(), nullable=False),
        sa.Column('last_log_id', sa.BigInteger(), nullable=False),
        sa.Column('merkle_root', sa.String(64), nullable=False),
        sa.Column('checkpoint_hash', sa.String(64), nullable=False),
        sa.Column('signature', sa.Text()),
        sa.Column('total_entries', sa.Integer(), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True)),
        sa.Column('verification_status', sa.String(20)),
        sa.Column('verification_details', postgresql.JSONB()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('idx_checkpoint_time', 'audit_log_checkpoints', ['checkpoint_time'])


def downgrade() -> None:
    op.drop_table('audit_log_checkpoints')
    op.drop_table('audit_logs')
    op.drop_table('sessions')
    op.drop_table('user_roles')
    op.drop_table('roles')
    op.drop_table('users')
    op.drop_table('organizations')

    # Drop enums
    op.execute('DROP TYPE IF EXISTS userstatus')
    op.execute('DROP TYPE IF EXISTS severitylevel')
