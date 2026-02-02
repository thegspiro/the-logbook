"""Create IP security tables with approval workflow

Revision ID: 20260202_0020
Revises: 20260201_0018
Create Date: 2026-02-02

Tables created:
- ip_exceptions: User-specific IP allowlist with IT admin approval workflow
- blocked_access_attempts: Log of blocked requests
- country_block_rules: Dynamic country blocking rules
- ip_exception_audit_log: Audit trail for all IP exception actions

Zero-Trust Security Model:
- All IP exceptions are user-specific (user_id required)
- Require IT administrator approval (approval workflow)
- Must have a defined time period (valid_until required)
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260202_0020'
down_revision = '20260201_0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IP Exceptions table with approval workflow
    op.create_table(
        'ip_exceptions',
        sa.Column('id', sa.String(36), primary_key=True),

        # Request Information
        sa.Column('ip_address', sa.String(45), nullable=False, index=True),
        sa.Column('cidr_range', sa.String(50)),
        sa.Column('exception_type', sa.Enum('allowlist', 'blocklist', name='ipexceptiontype'), nullable=False, index=True),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('description', sa.Text),

        # User Association (REQUIRED for zero-trust)
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False, index=True),

        # Time Period (REQUIRED - no permanent exceptions)
        sa.Column('requested_duration_days', sa.Integer, nullable=False),
        sa.Column('valid_from', sa.DateTime(timezone=True)),
        sa.Column('valid_until', sa.DateTime(timezone=True), nullable=False),

        # Approval Workflow
        sa.Column('approval_status', sa.Enum('pending', 'approved', 'rejected', 'expired', 'revoked', name='ipexceptionapprovalstatus'), nullable=False, default='pending', index=True),

        # Request submitted
        sa.Column('requested_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), server_default=sa.func.now()),

        # Approval by IT Administrator
        sa.Column('approved_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('approved_at', sa.DateTime(timezone=True)),
        sa.Column('approval_notes', sa.Text),
        sa.Column('approved_duration_days', sa.Integer),

        # Rejection
        sa.Column('rejected_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('rejected_at', sa.DateTime(timezone=True)),
        sa.Column('rejection_reason', sa.Text),

        # Revocation
        sa.Column('revoked_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
        sa.Column('revoke_reason', sa.Text),

        # Context Information
        sa.Column('country_code', sa.String(2)),
        sa.Column('country_name', sa.String(100)),
        sa.Column('use_case', sa.String(100)),

        # Usage Tracking
        sa.Column('last_used_at', sa.DateTime(timezone=True)),
        sa.Column('use_count', sa.Integer, default=0),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_index('idx_ip_exception_user', 'ip_exceptions', ['user_id'])
    op.create_index('idx_ip_exception_org', 'ip_exceptions', ['organization_id'])
    op.create_index('idx_ip_exception_approval', 'ip_exceptions', ['approval_status'])
    op.create_index('idx_ip_exception_type_status', 'ip_exceptions', ['exception_type', 'approval_status'])
    op.create_index('idx_ip_exception_valid_until', 'ip_exceptions', ['valid_until'])

    # IP Exception Audit Log table
    op.create_table(
        'ip_exception_audit_log',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('exception_id', sa.String(36), sa.ForeignKey('ip_exceptions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('action', sa.String(50), nullable=False, index=True),
        sa.Column('performed_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('performed_at', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        sa.Column('details', sa.Text),
        sa.Column('ip_address', sa.String(45)),
    )

    op.create_index('idx_exception_audit_exception', 'ip_exception_audit_log', ['exception_id'])
    op.create_index('idx_exception_audit_action', 'ip_exception_audit_log', ['action'])
    op.create_index('idx_exception_audit_time', 'ip_exception_audit_log', ['performed_at'])

    # Blocked Access Attempts table
    op.create_table(
        'blocked_access_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('ip_address', sa.String(45), nullable=False, index=True),
        sa.Column('country_code', sa.String(2), index=True),
        sa.Column('country_name', sa.String(100)),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id'), index=True),
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
    op.create_index('idx_blocked_user', 'blocked_access_attempts', ['user_id'])

    # Country Block Rules table
    op.create_table(
        'country_block_rules',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('country_code', sa.String(2), nullable=False, unique=True),
        sa.Column('country_name', sa.String(100)),
        sa.Column('is_blocked', sa.Boolean, default=True, index=True),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('risk_level', sa.String(20)),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column('updated_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('blocked_attempts_count', sa.Integer, default=0),
        sa.Column('last_blocked_at', sa.DateTime(timezone=True)),
    )

    op.create_index('idx_country_rule_code', 'country_block_rules', ['country_code'])
    op.create_index('idx_country_rule_blocked', 'country_block_rules', ['is_blocked'])


def downgrade() -> None:
    op.drop_table('country_block_rules')
    op.drop_table('blocked_access_attempts')
    op.drop_table('ip_exception_audit_log')
    op.drop_table('ip_exceptions')

    # Drop enums
    op.execute("DROP TYPE IF EXISTS ipexceptiontype")
    op.execute("DROP TYPE IF EXISTS ipexceptionapprovalstatus")
