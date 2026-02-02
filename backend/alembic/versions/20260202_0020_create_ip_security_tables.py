"""Create IP security tables

Revision ID: 20260202_0020
Revises: 20260201_0018
Create Date: 2026-02-02

Tables created:
- ip_exceptions: Allowlist/blocklist for IP addresses
- blocked_access_attempts: Log of blocked requests
- country_block_rules: Dynamic country blocking rules
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260202_0020'
down_revision = '20260201_0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IP Exceptions table (allowlist/blocklist)
    op.create_table(
        'ip_exceptions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('ip_address', sa.String(45), nullable=False, index=True),
        sa.Column('cidr_range', sa.String(50)),
        sa.Column('exception_type', sa.Enum('allowlist', 'blocklist', name='ipexceptiontype'), nullable=False, index=True),
        sa.Column('status', sa.Enum('active', 'expired', 'revoked', name='ipexceptionstatus'), default='active', index=True),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('organization_id', sa.String(36), index=True),
        sa.Column('user_id', sa.String(36), index=True),
        sa.Column('entity_name', sa.String(255)),
        sa.Column('country_code', sa.String(2)),
        sa.Column('country_name', sa.String(100)),
        sa.Column('valid_from', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('valid_until', sa.DateTime(timezone=True)),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('revoked_by', sa.String(36)),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
        sa.Column('revoke_reason', sa.Text),
        sa.Column('last_used_at', sa.DateTime(timezone=True)),
        sa.Column('use_count', sa.Integer, default=0),
    )

    op.create_index('idx_ip_exception_type_status', 'ip_exceptions', ['exception_type', 'status'])
    op.create_index('idx_ip_exception_org', 'ip_exceptions', ['organization_id'])

    # Blocked Access Attempts table
    op.create_table(
        'blocked_access_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('ip_address', sa.String(45), nullable=False, index=True),
        sa.Column('country_code', sa.String(2), index=True),
        sa.Column('country_name', sa.String(100)),
        sa.Column('block_reason', sa.String(100), nullable=False, index=True),
        sa.Column('block_details', sa.Text),
        sa.Column('request_path', sa.String(500)),
        sa.Column('request_method', sa.String(10)),
        sa.Column('user_agent', sa.Text),
        sa.Column('request_headers', sa.Text),
        sa.Column('blocked_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )

    op.create_index('idx_blocked_ip_time', 'blocked_access_attempts', ['ip_address', 'blocked_at'])
    op.create_index('idx_blocked_country_time', 'blocked_access_attempts', ['country_code', 'blocked_at'])

    # Country Block Rules table
    op.create_table(
        'country_block_rules',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('country_code', sa.String(2), nullable=False, unique=True),
        sa.Column('country_name', sa.String(100)),
        sa.Column('is_blocked', sa.Boolean, default=True, index=True),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('risk_level', sa.String(20)),
        sa.Column('created_by', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('updated_by', sa.String(36)),
        sa.Column('blocked_attempts_count', sa.Integer, default=0),
        sa.Column('last_blocked_at', sa.DateTime(timezone=True)),
    )

    op.create_index('idx_country_rule_code', 'country_block_rules', ['country_code'])
    op.create_index('idx_country_rule_blocked', 'country_block_rules', ['is_blocked'])


def downgrade() -> None:
    op.drop_table('country_block_rules')
    op.drop_table('blocked_access_attempts')
    op.drop_table('ip_exceptions')

    # Drop enums
    op.execute("DROP TYPE IF EXISTS ipexceptiontype")
    op.execute("DROP TYPE IF EXISTS ipexceptionstatus")
