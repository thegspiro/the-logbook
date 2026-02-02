"""Create onboarding_status and onboarding_checklist tables

Revision ID: 20260202_0019
Revises: 20260201_0018
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260202_0019'
down_revision = '20260201_0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create onboarding_status table
    op.create_table(
        'onboarding_status',
        sa.Column('id', sa.String(36), primary_key=True),

        # Onboarding completion status
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('completed_at', sa.DateTime()),

        # Steps tracking
        sa.Column('steps_completed', sa.JSON()),
        sa.Column('current_step', sa.Integer(), server_default='0'),

        # System information collected during onboarding
        sa.Column('organization_name', sa.String(255)),
        sa.Column('organization_type', sa.String(50)),
        sa.Column('admin_email', sa.String(255)),
        sa.Column('admin_username', sa.String(100)),

        # Security verification
        sa.Column('security_keys_verified', sa.Boolean(), server_default='0'),
        sa.Column('database_verified', sa.Boolean(), server_default='0'),
        sa.Column('email_configured', sa.Boolean(), server_default='0'),

        # Configuration choices
        sa.Column('enabled_modules', sa.JSON()),
        sa.Column('timezone', sa.String(50), server_default='America/New_York'),

        # Metadata
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

        # Item details
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('category', sa.String(50)),
        sa.Column('priority', sa.String(20)),

        # Status
        sa.Column('is_completed', sa.Boolean(), server_default='0'),
        sa.Column('completed_at', sa.DateTime()),
        sa.Column('completed_by', sa.String(36)),

        # Help information
        sa.Column('documentation_link', sa.Text()),
        sa.Column('estimated_time_minutes', sa.Integer()),

        # Ordering
        sa.Column('sort_order', sa.Integer(), server_default='0'),

        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')),
    )

    op.create_index('idx_checklist_category', 'onboarding_checklist', ['category'])
    op.create_index('idx_checklist_priority', 'onboarding_checklist', ['priority'])


def downgrade() -> None:
    op.drop_index('idx_checklist_priority', table_name='onboarding_checklist')
    op.drop_index('idx_checklist_category', table_name='onboarding_checklist')
    op.drop_table('onboarding_checklist')
    op.drop_table('onboarding_status')
