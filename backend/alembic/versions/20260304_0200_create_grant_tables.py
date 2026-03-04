"""Create grant management tables

Revision ID: 20260304_0200
Revises: 20260304_0100
Create Date: 2026-03-04

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260304_0200'
down_revision = '20260304_0100'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create grant_opportunities table - Library of available grant programs
    op.create_table(
        'grant_opportunities',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('agency', sa.String(255)),
        sa.Column('description', sa.Text()),
        sa.Column('eligible_uses', sa.Text()),
        sa.Column('typical_award_min', sa.Numeric(12, 2)),
        sa.Column('typical_award_max', sa.Numeric(12, 2)),
        sa.Column('eligibility_criteria', sa.Text()),
        sa.Column('application_url', sa.String(500)),
        sa.Column('program_url', sa.String(500)),
        sa.Column('match_required', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('match_percentage', sa.Numeric(5, 2)),
        sa.Column('match_description', sa.String(500)),
        sa.Column('deadline_type', sa.Enum('fixed', 'recurring', 'rolling', name='deadlinetype')),
        sa.Column('deadline_date', sa.Date()),
        sa.Column('recurring_schedule', sa.JSON()),
        sa.Column('required_documents', sa.JSON()),
        sa.Column('tags', sa.JSON()),
        sa.Column('category', sa.Enum('equipment', 'staffing', 'training', 'prevention', 'facilities', 'vehicles', 'wellness', 'community', 'other', name='grantcategory')),
        sa.Column('federal_program_code', sa.String(50)),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_opportunities_organization_id', 'grant_opportunities', ['organization_id'])
    op.create_index('ix_grant_opportunities_category', 'grant_opportunities', ['category'])
    op.create_index('ix_grant_opportunities_is_active', 'grant_opportunities', ['is_active'])
    op.create_index('ix_grant_opportunities_deadline_date', 'grant_opportunities', ['deadline_date'])
    op.create_index('ix_grant_opportunities_federal_program_code', 'grant_opportunities', ['federal_program_code'])

    # Create grant_applications table - Individual grant applications tracked through the pipeline
    op.create_table(
        'grant_applications',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('opportunity_id', sa.String(36), sa.ForeignKey('grant_opportunities.id', ondelete='SET NULL')),
        sa.Column('grant_program_name', sa.String(255)),
        sa.Column('grant_agency', sa.String(255)),
        sa.Column('application_status', sa.Enum('researching', 'preparing', 'internal_review', 'submitted', 'under_review', 'awarded', 'denied', 'active', 'reporting', 'closed', name='applicationstatus'), nullable=False, server_default='researching'),
        sa.Column('amount_requested', sa.Numeric(12, 2)),
        sa.Column('amount_awarded', sa.Numeric(12, 2)),
        sa.Column('match_amount', sa.Numeric(12, 2)),
        sa.Column('match_source', sa.String(255)),
        sa.Column('application_deadline', sa.Date()),
        sa.Column('submitted_date', sa.Date()),
        sa.Column('award_date', sa.Date()),
        sa.Column('grant_start_date', sa.Date()),
        sa.Column('grant_end_date', sa.Date()),
        sa.Column('project_description', sa.Text()),
        sa.Column('narrative_summary', sa.Text()),
        sa.Column('budget_summary', sa.JSON()),
        sa.Column('key_contacts', sa.JSON()),
        sa.Column('federal_award_id', sa.String(100)),
        sa.Column('nfirs_compliant', sa.Boolean()),
        sa.Column('performance_period_months', sa.Integer()),
        sa.Column('reporting_frequency', sa.Enum('monthly', 'quarterly', 'semi_annual', 'annual', name='reportingfrequency')),
        sa.Column('next_report_due', sa.Date()),
        sa.Column('final_report_due', sa.Date()),
        sa.Column('assigned_to', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('priority', sa.Enum('low', 'medium', 'high', 'critical', name='grantpriority'), nullable=False, server_default='medium'),
        sa.Column('linked_campaign_id', sa.String(36), sa.ForeignKey('fundraising_campaigns.id', ondelete='SET NULL')),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_applications_organization_id', 'grant_applications', ['organization_id'])
    op.create_index('ix_grant_applications_opportunity_id', 'grant_applications', ['opportunity_id'])
    op.create_index('ix_grant_applications_status', 'grant_applications', ['application_status'])
    op.create_index('ix_grant_applications_assigned_to', 'grant_applications', ['assigned_to'])
    op.create_index('ix_grant_applications_priority', 'grant_applications', ['priority'])
    op.create_index('ix_grant_applications_deadline', 'grant_applications', ['application_deadline'])
    op.create_index('ix_grant_applications_linked_campaign_id', 'grant_applications', ['linked_campaign_id'])

    # Create grant_budget_items table - Budget line items for grant applications
    op.create_table(
        'grant_budget_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('application_id', sa.String(36), sa.ForeignKey('grant_applications.id', ondelete='CASCADE'), nullable=False),
        sa.Column('category', sa.Enum('equipment', 'personnel', 'training', 'contractual', 'supplies', 'travel', 'construction', 'indirect', 'other', name='budgetitemcategory'), nullable=False),
        sa.Column('description', sa.String(500)),
        sa.Column('amount_budgeted', sa.Numeric(12, 2), nullable=False),
        sa.Column('amount_spent', sa.Numeric(12, 2), nullable=False, server_default='0.00'),
        sa.Column('amount_remaining', sa.Numeric(12, 2)),
        sa.Column('federal_share', sa.Numeric(12, 2)),
        sa.Column('local_match', sa.Numeric(12, 2)),
        sa.Column('notes', sa.Text()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_budget_items_application_id', 'grant_budget_items', ['application_id'])
    op.create_index('ix_grant_budget_items_category', 'grant_budget_items', ['category'])

    # Create grant_expenditures table - Individual spending records against a grant budget
    op.create_table(
        'grant_expenditures',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('application_id', sa.String(36), sa.ForeignKey('grant_applications.id', ondelete='CASCADE'), nullable=False),
        sa.Column('budget_item_id', sa.String(36), sa.ForeignKey('grant_budget_items.id', ondelete='SET NULL')),
        sa.Column('description', sa.String(500), nullable=False),
        sa.Column('amount', sa.Numeric(12, 2), nullable=False),
        sa.Column('expenditure_date', sa.Date(), nullable=False),
        sa.Column('vendor', sa.String(255)),
        sa.Column('invoice_number', sa.String(100)),
        sa.Column('receipt_url', sa.String(500)),
        sa.Column('payment_method', sa.String(100)),
        sa.Column('approved_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('approval_date', sa.Date()),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_expenditures_application_id', 'grant_expenditures', ['application_id'])
    op.create_index('ix_grant_expenditures_budget_item_id', 'grant_expenditures', ['budget_item_id'])
    op.create_index('ix_grant_expenditures_expenditure_date', 'grant_expenditures', ['expenditure_date'])

    # Create grant_compliance_tasks table - Follow-up tasks, reports, and compliance obligations
    op.create_table(
        'grant_compliance_tasks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('application_id', sa.String(36), sa.ForeignKey('grant_applications.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_type', sa.Enum('performance_report', 'financial_report', 'progress_update', 'site_visit', 'audit', 'equipment_inventory', 'nfirs_submission', 'closeout_report', 'other', name='compliancetasktype'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('completed_date', sa.Date()),
        sa.Column('status', sa.Enum('pending', 'in_progress', 'completed', 'overdue', 'waived', name='compliancetaskstatus'), nullable=False, server_default='pending'),
        sa.Column('priority', sa.Enum('low', 'medium', 'high', 'critical', name='grantpriority'), nullable=False, server_default='medium'),
        sa.Column('assigned_to', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('reminder_days_before', sa.Integer(), nullable=False, server_default='14'),
        sa.Column('last_reminder_sent', sa.DateTime(timezone=True)),
        sa.Column('report_template', sa.Text()),
        sa.Column('submission_url', sa.String(500)),
        sa.Column('attachments', sa.JSON()),
        sa.Column('notes', sa.Text()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_compliance_tasks_application_id', 'grant_compliance_tasks', ['application_id'])
    op.create_index('ix_grant_compliance_tasks_status', 'grant_compliance_tasks', ['status'])
    op.create_index('ix_grant_compliance_tasks_due_date', 'grant_compliance_tasks', ['due_date'])
    op.create_index('ix_grant_compliance_tasks_assigned_to', 'grant_compliance_tasks', ['assigned_to'])

    # Create grant_notes table - Activity log / notes for grant applications
    op.create_table(
        'grant_notes',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('application_id', sa.String(36), sa.ForeignKey('grant_applications.id', ondelete='CASCADE'), nullable=False),
        sa.Column('note_type', sa.Enum('general', 'status_change', 'document_added', 'contact_made', 'milestone', 'financial', 'compliance', name='grantnotetype'), nullable=False, server_default='general'),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('metadata', sa.JSON()),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_grant_notes_application_id', 'grant_notes', ['application_id'])
    op.create_index('ix_grant_notes_note_type', 'grant_notes', ['note_type'])
    op.create_index('ix_grant_notes_created_at', 'grant_notes', ['created_at'])


def downgrade() -> None:
    op.drop_table('grant_notes')
    op.drop_table('grant_compliance_tasks')
    op.drop_table('grant_expenditures')
    op.drop_table('grant_budget_items')
    op.drop_table('grant_applications')
    op.drop_table('grant_opportunities')
