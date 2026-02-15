"""Add shift scheduling tables

Revision ID: 20260214_2200
Revises: 20260214_2100
Create Date: 2026-02-14

Adds shift scheduling and management tables:
- shift_templates      — reusable shift definitions
- shift_patterns       — recurring schedule patterns
- shift_assignments    — user-to-shift assignments
- shift_swap_requests  — shift swap/trade requests
- shift_time_off       — time-off requests
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_2200'
down_revision = '20260214_2100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. shift_templates
    # ------------------------------------------------------------------
    op.create_table(
        'shift_templates',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('start_time_of_day', sa.String(5), nullable=False),
        sa.Column('end_time_of_day', sa.String(5), nullable=False),
        sa.Column('duration_hours', sa.Float(), nullable=False),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('positions', sa.JSON(), nullable=True),
        sa.Column('min_staffing', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('idx_shift_template_org', 'shift_templates', ['organization_id'])

    # ------------------------------------------------------------------
    # 2. shift_patterns
    # ------------------------------------------------------------------
    op.create_table(
        'shift_patterns',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('pattern_type', sa.String(20), nullable=False, server_default='weekly'),
        sa.Column('template_id', sa.String(36), sa.ForeignKey('shift_templates.id', ondelete='SET NULL'), nullable=True),
        sa.Column('rotation_days', sa.Integer(), nullable=True),
        sa.Column('days_on', sa.Integer(), nullable=True),
        sa.Column('days_off', sa.Integer(), nullable=True),
        sa.Column('schedule_config', sa.JSON(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('assigned_members', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('idx_shift_pattern_org', 'shift_patterns', ['organization_id'])

    # ------------------------------------------------------------------
    # 3. shift_assignments
    # ------------------------------------------------------------------
    op.create_table(
        'shift_assignments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('shift_id', sa.String(36), sa.ForeignKey('shifts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('position', sa.String(20), nullable=False, server_default='firefighter'),
        sa.Column('assignment_status', sa.String(20), nullable=False, server_default='assigned'),
        sa.Column('assigned_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_shift_assign_org', 'shift_assignments', ['organization_id'])
    op.create_index('idx_shift_assign_shift', 'shift_assignments', ['shift_id'])
    op.create_index('idx_shift_assign_user', 'shift_assignments', ['user_id'])

    # ------------------------------------------------------------------
    # 4. shift_swap_requests
    # ------------------------------------------------------------------
    op.create_table(
        'shift_swap_requests',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('requesting_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('offering_shift_id', sa.String(36), sa.ForeignKey('shifts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('requesting_shift_id', sa.String(36), sa.ForeignKey('shifts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('target_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewer_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_swap_req_org', 'shift_swap_requests', ['organization_id'])
    op.create_index('idx_swap_req_user', 'shift_swap_requests', ['requesting_user_id'])
    op.create_index('idx_swap_req_status', 'shift_swap_requests', ['status'])

    # ------------------------------------------------------------------
    # 5. shift_time_off
    # ------------------------------------------------------------------
    op.create_table(
        'shift_time_off',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('approved_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewer_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_timeoff_org', 'shift_time_off', ['organization_id'])
    op.create_index('idx_timeoff_user', 'shift_time_off', ['user_id'])
    op.create_index('idx_timeoff_dates', 'shift_time_off', ['start_date', 'end_date'])


def downgrade() -> None:
    op.drop_table('shift_time_off')
    op.drop_table('shift_swap_requests')
    op.drop_table('shift_assignments')
    op.drop_table('shift_patterns')
    op.drop_table('shift_templates')
