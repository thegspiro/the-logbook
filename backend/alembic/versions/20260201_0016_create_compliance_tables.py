"""Create compliance module tables

Revision ID: 20260201_0016
Revises: 20260122_0030
Create Date: 2026-02-01

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260201_0016'
down_revision = '20260122_0030'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create compliance_policies table - Organization policies that require acknowledgment
    op.create_table(
        'compliance_policies',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('category', sa.Enum('safety', 'hr', 'operational', 'legal', 'ethics', 'other', name='policycategory'), nullable=False),
        sa.Column('version', sa.String(20), nullable=False, server_default='1.0'),
        sa.Column('effective_date', sa.Date(), nullable=False),
        sa.Column('expiration_date', sa.Date()),
        sa.Column('document_url', sa.String(500)),
        sa.Column('requires_signature', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('requires_quiz', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('quiz_passing_score', sa.Integer()),
        sa.Column('renewal_frequency_months', sa.Integer()),
        sa.Column('applies_to_all', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('required_roles', sa.JSON()),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_compliance_policies_org', 'compliance_policies', ['organization_id'])
    op.create_index('idx_compliance_policies_category', 'compliance_policies', ['organization_id', 'category'])
    op.create_index('idx_compliance_policies_active', 'compliance_policies', ['organization_id', 'active'])

    # Create policy_acknowledgments table - User acknowledgments of policies
    op.create_table(
        'policy_acknowledgments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('policy_id', sa.String(36), sa.ForeignKey('compliance_policies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('policy_version', sa.String(20), nullable=False),
        sa.Column('acknowledged_at', sa.DateTime(), nullable=False),
        sa.Column('signature_data', sa.Text()),
        sa.Column('ip_address', sa.String(45)),
        sa.Column('user_agent', sa.Text()),
        sa.Column('quiz_score', sa.Integer()),
        sa.Column('quiz_passed', sa.Boolean()),
        sa.Column('expires_at', sa.DateTime()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_policy_ack_org_policy', 'policy_acknowledgments', ['organization_id', 'policy_id'])
    op.create_index('idx_policy_ack_user', 'policy_acknowledgments', ['user_id'])
    op.create_index('idx_policy_ack_expires', 'policy_acknowledgments', ['expires_at'])
    op.create_index('idx_policy_ack_unique', 'policy_acknowledgments', ['policy_id', 'user_id', 'policy_version'], unique=True)

    # Create compliance_checklists table - Audit/inspection checklists
    op.create_table(
        'compliance_checklists',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('checklist_type', sa.Enum('equipment', 'facility', 'vehicle', 'safety', 'audit', 'other', name='checklisttype'), nullable=False),
        sa.Column('frequency', sa.Enum('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'as_needed', name='checklistfrequency'), nullable=False),
        sa.Column('items', sa.JSON(), nullable=False),
        sa.Column('passing_threshold', sa.Integer(), server_default='100'),
        sa.Column('requires_signature', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notify_on_failure', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id')),
    )
    op.create_index('idx_compliance_checklists_org', 'compliance_checklists', ['organization_id'])
    op.create_index('idx_compliance_checklists_type', 'compliance_checklists', ['organization_id', 'checklist_type'])

    # Create checklist_submissions table - Completed checklist submissions
    op.create_table(
        'checklist_submissions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('checklist_id', sa.String(36), sa.ForeignKey('compliance_checklists.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submitted_by', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submitted_at', sa.DateTime(), nullable=False),
        sa.Column('responses', sa.JSON(), nullable=False),
        sa.Column('score', sa.Integer()),
        sa.Column('passed', sa.Boolean()),
        sa.Column('notes', sa.Text()),
        sa.Column('signature_data', sa.Text()),
        sa.Column('related_item_id', sa.String(36)),
        sa.Column('related_item_type', sa.String(50)),
        sa.Column('attachments', sa.JSON()),
        sa.Column('reviewed_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('reviewed_at', sa.DateTime()),
        sa.Column('review_notes', sa.Text()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_checklist_sub_org', 'checklist_submissions', ['organization_id'])
    op.create_index('idx_checklist_sub_checklist', 'checklist_submissions', ['checklist_id'])
    op.create_index('idx_checklist_sub_user', 'checklist_submissions', ['submitted_by'])
    op.create_index('idx_checklist_sub_date', 'checklist_submissions', ['submitted_at'])
    op.create_index('idx_checklist_sub_related', 'checklist_submissions', ['related_item_type', 'related_item_id'])

    # Create compliance_incidents table - Track compliance violations/incidents
    op.create_table(
        'compliance_incidents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('incident_type', sa.Enum('violation', 'near_miss', 'injury', 'property_damage', 'complaint', 'other', name='incidenttype'), nullable=False),
        sa.Column('severity', sa.Enum('low', 'medium', 'high', 'critical', name='incidentseverity'), nullable=False),
        sa.Column('incident_date', sa.DateTime(), nullable=False),
        sa.Column('reported_by', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('reported_at', sa.DateTime(), nullable=False),
        sa.Column('involved_users', sa.JSON()),
        sa.Column('location', sa.String(255)),
        sa.Column('root_cause', sa.Text()),
        sa.Column('corrective_actions', sa.Text()),
        sa.Column('status', sa.Enum('open', 'investigating', 'resolved', 'closed', name='incidentstatus'), nullable=False, server_default='open'),
        sa.Column('resolved_by', sa.String(36), sa.ForeignKey('users.id')),
        sa.Column('resolved_at', sa.DateTime()),
        sa.Column('resolution_notes', sa.Text()),
        sa.Column('attachments', sa.JSON()),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('idx_compliance_incidents_org', 'compliance_incidents', ['organization_id'])
    op.create_index('idx_compliance_incidents_type', 'compliance_incidents', ['organization_id', 'incident_type'])
    op.create_index('idx_compliance_incidents_status', 'compliance_incidents', ['organization_id', 'status'])
    op.create_index('idx_compliance_incidents_date', 'compliance_incidents', ['incident_date'])
    op.create_index('idx_compliance_incidents_severity', 'compliance_incidents', ['organization_id', 'severity'])


def downgrade() -> None:
    op.drop_table('compliance_incidents')
    op.drop_table('checklist_submissions')
    op.drop_table('compliance_checklists')
    op.drop_table('policy_acknowledgments')
    op.drop_table('compliance_policies')
