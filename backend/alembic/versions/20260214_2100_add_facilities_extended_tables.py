"""Add facilities extended tables

Revision ID: 20260214_2100
Revises: 20260214_2000
Create Date: 2026-02-14

Adds extended facility management tables:
- facility_utility_accounts   — utility provider accounts
- facility_utility_readings   — monthly cost/usage readings
- facility_access_keys        — keys, fobs, access codes
- facility_rooms              — room/space inventory
- facility_emergency_contacts — emergency vendor contacts
- facility_shutoff_locations  — utility shutoff locations
- facility_capital_projects   — capital improvement projects
- facility_insurance_policies — insurance policy tracking
- facility_occupants          — unit/crew assignments
- facility_compliance_checklists — regulatory checklists
- facility_compliance_items   — individual checklist line items
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_2100'
down_revision = '20260214_2000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. facility_utility_accounts
    # ------------------------------------------------------------------
    op.create_table(
        'facility_utility_accounts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('utility_type', sa.String(20), nullable=False),
        sa.Column('provider_name', sa.String(200), nullable=False),
        sa.Column('account_number', sa.String(100), nullable=True),
        sa.Column('meter_number', sa.String(100), nullable=True),
        sa.Column('contact_phone', sa.String(50), nullable=True),
        sa.Column('contact_email', sa.String(200), nullable=True),
        sa.Column('emergency_phone', sa.String(50), nullable=True),
        sa.Column('billing_cycle', sa.String(20), nullable=True, server_default='monthly'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_utility_facility', 'facility_utility_accounts', ['facility_id'])
    op.create_index('idx_facility_utility_type', 'facility_utility_accounts', ['facility_id', 'utility_type'])

    # ------------------------------------------------------------------
    # 2. facility_utility_readings
    # ------------------------------------------------------------------
    op.create_table(
        'facility_utility_readings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('utility_account_id', sa.String(36), sa.ForeignKey('facility_utility_accounts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reading_date', sa.Date(), nullable=False),
        sa.Column('period_start', sa.Date(), nullable=True),
        sa.Column('period_end', sa.Date(), nullable=True),
        sa.Column('amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('usage_quantity', sa.Numeric(12, 3), nullable=True),
        sa.Column('usage_unit', sa.String(50), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_utility_readings_account', 'facility_utility_readings', ['utility_account_id'])
    op.create_index('idx_facility_utility_readings_date', 'facility_utility_readings', ['reading_date'])

    # ------------------------------------------------------------------
    # 3. facility_access_keys
    # ------------------------------------------------------------------
    op.create_table(
        'facility_access_keys',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('key_type', sa.String(20), nullable=False),
        sa.Column('key_identifier', sa.String(100), nullable=True),
        sa.Column('description', sa.String(300), nullable=True),
        sa.Column('assigned_to_user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('assigned_to_name', sa.String(200), nullable=True),
        sa.Column('issued_date', sa.Date(), nullable=True),
        sa.Column('returned_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_access_keys_facility', 'facility_access_keys', ['facility_id'])
    op.create_index('idx_facility_access_keys_user', 'facility_access_keys', ['assigned_to_user_id'])
    op.create_index('idx_facility_access_keys_type', 'facility_access_keys', ['key_type'])

    # ------------------------------------------------------------------
    # 4. facility_rooms
    # ------------------------------------------------------------------
    op.create_table(
        'facility_rooms',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('room_number', sa.String(50), nullable=True),
        sa.Column('floor', sa.Integer(), nullable=True),
        sa.Column('room_type', sa.String(20), nullable=False, server_default='other'),
        sa.Column('square_footage', sa.Integer(), nullable=True),
        sa.Column('capacity', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('equipment', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_rooms_facility', 'facility_rooms', ['facility_id'])
    op.create_index('idx_facility_rooms_type', 'facility_rooms', ['room_type'])
    op.create_index('idx_facility_rooms_floor', 'facility_rooms', ['facility_id', 'floor'])

    # ------------------------------------------------------------------
    # 5. facility_emergency_contacts
    # ------------------------------------------------------------------
    op.create_table(
        'facility_emergency_contacts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('contact_type', sa.String(30), nullable=False),
        sa.Column('company_name', sa.String(200), nullable=False),
        sa.Column('contact_name', sa.String(200), nullable=True),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('alt_phone', sa.String(50), nullable=True),
        sa.Column('email', sa.String(200), nullable=True),
        sa.Column('service_contract_number', sa.String(100), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default=sa.text('1')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_emerg_contacts_facility', 'facility_emergency_contacts', ['facility_id'])
    op.create_index('idx_facility_emerg_contacts_type', 'facility_emergency_contacts', ['contact_type'])

    # ------------------------------------------------------------------
    # 6. facility_shutoff_locations
    # ------------------------------------------------------------------
    op.create_table(
        'facility_shutoff_locations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('shutoff_type', sa.String(30), nullable=False),
        sa.Column('location_description', sa.Text(), nullable=False),
        sa.Column('floor', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('photo_path', sa.String(500), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_shutoffs_facility', 'facility_shutoff_locations', ['facility_id'])
    op.create_index('idx_facility_shutoffs_type', 'facility_shutoff_locations', ['shutoff_type'])

    # ------------------------------------------------------------------
    # 7. facility_capital_projects
    # ------------------------------------------------------------------
    op.create_table(
        'facility_capital_projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_name', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('project_type', sa.String(30), nullable=False, server_default='other'),
        sa.Column('project_status', sa.String(20), nullable=False, server_default='planning'),
        sa.Column('estimated_cost', sa.Numeric(12, 2), nullable=True),
        sa.Column('actual_cost', sa.Numeric(12, 2), nullable=True),
        sa.Column('budget_source', sa.String(300), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('estimated_completion', sa.Date(), nullable=True),
        sa.Column('actual_completion', sa.Date(), nullable=True),
        sa.Column('contractor_name', sa.String(200), nullable=True),
        sa.Column('contractor_phone', sa.String(50), nullable=True),
        sa.Column('contractor_email', sa.String(200), nullable=True),
        sa.Column('project_manager', sa.String(200), nullable=True),
        sa.Column('permit_numbers', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_capital_facility', 'facility_capital_projects', ['facility_id'])
    op.create_index('idx_facility_capital_status', 'facility_capital_projects', ['project_status'])
    op.create_index('idx_facility_capital_type', 'facility_capital_projects', ['project_type'])

    # ------------------------------------------------------------------
    # 8. facility_insurance_policies
    # ------------------------------------------------------------------
    op.create_table(
        'facility_insurance_policies',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('policy_type', sa.String(20), nullable=False),
        sa.Column('policy_number', sa.String(100), nullable=True),
        sa.Column('carrier_name', sa.String(200), nullable=False),
        sa.Column('agent_name', sa.String(200), nullable=True),
        sa.Column('agent_phone', sa.String(50), nullable=True),
        sa.Column('agent_email', sa.String(200), nullable=True),
        sa.Column('coverage_amount', sa.Numeric(14, 2), nullable=True),
        sa.Column('deductible', sa.Numeric(10, 2), nullable=True),
        sa.Column('annual_premium', sa.Numeric(10, 2), nullable=True),
        sa.Column('effective_date', sa.Date(), nullable=True),
        sa.Column('expiration_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_insurance_facility', 'facility_insurance_policies', ['facility_id'])
    op.create_index('idx_facility_insurance_type', 'facility_insurance_policies', ['policy_type'])
    op.create_index('idx_facility_insurance_expiration', 'facility_insurance_policies', ['expiration_date'])

    # ------------------------------------------------------------------
    # 9. facility_occupants
    # ------------------------------------------------------------------
    op.create_table(
        'facility_occupants',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('unit_name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('contact_name', sa.String(200), nullable=True),
        sa.Column('contact_phone', sa.String(50), nullable=True),
        sa.Column('effective_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_occupants_facility', 'facility_occupants', ['facility_id'])
    op.create_index('idx_facility_occupants_active', 'facility_occupants', ['is_active'])

    # ------------------------------------------------------------------
    # 10. facility_compliance_checklists
    # ------------------------------------------------------------------
    op.create_table(
        'facility_compliance_checklists',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('checklist_name', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('compliance_type', sa.String(30), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('completed_date', sa.Date(), nullable=True),
        sa.Column('completed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_compliance_facility', 'facility_compliance_checklists', ['facility_id'])
    op.create_index('idx_facility_compliance_type', 'facility_compliance_checklists', ['compliance_type'])
    op.create_index('idx_facility_compliance_due', 'facility_compliance_checklists', ['due_date'])
    op.create_index('idx_facility_compliance_completed', 'facility_compliance_checklists', ['is_completed'])

    # ------------------------------------------------------------------
    # 11. facility_compliance_items
    # ------------------------------------------------------------------
    op.create_table(
        'facility_compliance_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('checklist_id', sa.String(36), sa.ForeignKey('facility_compliance_checklists.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_number', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('is_compliant', sa.Boolean(), nullable=True),
        sa.Column('findings', sa.Text(), nullable=True),
        sa.Column('corrective_action', sa.Text(), nullable=True),
        sa.Column('corrective_action_deadline', sa.Date(), nullable=True),
        sa.Column('corrective_action_completed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_compliance_items_checklist', 'facility_compliance_items', ['checklist_id'])


def downgrade() -> None:
    op.drop_table('facility_compliance_items')
    op.drop_table('facility_compliance_checklists')
    op.drop_table('facility_occupants')
    op.drop_table('facility_insurance_policies')
    op.drop_table('facility_capital_projects')
    op.drop_table('facility_shutoff_locations')
    op.drop_table('facility_emergency_contacts')
    op.drop_table('facility_rooms')
    op.drop_table('facility_access_keys')
    op.drop_table('facility_utility_readings')
    op.drop_table('facility_utility_accounts')
