"""Create onboarding tables

Revision ID: 20260201_0018
Revises: 20260201_0017
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260201_0018'
down_revision = '20260201_0017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create onboarding_status table
    op.create_table(
        'onboarding_status',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('completed_at', sa.DateTime()),
        sa.Column('steps_completed', sa.JSON(), server_default='{}'),
        sa.Column('current_step', sa.Integer(), server_default='0'),
        sa.Column('organization_name', sa.String(255)),
        sa.Column('organization_type', sa.String(50)),
        sa.Column('admin_email', sa.String(255)),
        sa.Column('admin_username', sa.String(100)),
        sa.Column('security_keys_verified', sa.Boolean(), server_default='0'),
        sa.Column('database_verified', sa.Boolean(), server_default='0'),
        sa.Column('email_configured', sa.Boolean(), server_default='0'),
        sa.Column('enabled_modules', sa.JSON(), server_default='[]'),
        sa.Column('timezone', sa.String(50), server_default="'America/New_York'"),
        sa.Column('setup_started_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('setup_ip_address', sa.String(45)),
        sa.Column('setup_user_agent', sa.Text()),
        sa.Column('setup_notes', sa.Text()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )

    # Create onboarding_checklist table
    op.create_table(
        'onboarding_checklist',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('category', sa.String(50)),
        sa.Column('priority', sa.String(20)),
        sa.Column('is_completed', sa.Boolean(), server_default='0'),
        sa.Column('completed_at', sa.DateTime()),
        sa.Column('completed_by', sa.String(36)),
        sa.Column('documentation_link', sa.Text()),
        sa.Column('estimated_time_minutes', sa.Integer()),
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )

    # Create onboarding_sessions table for secure server-side session storage
    op.create_table(
        'onboarding_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(64), nullable=False, unique=True),
        sa.Column('data', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('ip_address', sa.String(45), nullable=False),
        sa.Column('user_agent', sa.Text()),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )
    op.create_index('idx_onboarding_session_id', 'onboarding_sessions', ['session_id'], unique=True)
    op.create_index('idx_onboarding_session_expires', 'onboarding_sessions', ['expires_at'])


def downgrade() -> None:
    op.drop_table('onboarding_sessions')
    op.drop_table('onboarding_checklist')
    op.drop_table('onboarding_status')
