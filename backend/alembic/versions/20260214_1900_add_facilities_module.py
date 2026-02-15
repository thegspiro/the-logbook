"""Add facilities module tables

Revision ID: 20260214_1900
Revises: 20260214_1800
Create Date: 2026-02-14

Creates all tables for the Facilities module:
- facility_types         — customizable facility type lookup
- facility_statuses      — customizable facility status lookup
- facilities             — main facility/building records
- facility_photos        — photos associated with a facility
- facility_documents     — documents (blueprints, permits, leases, etc.)
- facility_maintenance_types — customizable maintenance type lookup
- facility_maintenance   — maintenance/repair/inspection records
- facility_systems       — building sub-systems (HVAC, electrical, etc.)
- facility_inspections   — regulatory and routine inspection records
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1900'
down_revision = '20260214_1800'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. facility_types
    # ------------------------------------------------------------------
    op.create_table(
        'facility_types',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_types_org', 'facility_types', ['organization_id'])
    op.create_index('idx_facility_types_org_name', 'facility_types', ['organization_id', 'name'], unique=True)

    # ------------------------------------------------------------------
    # 2. facility_statuses
    # ------------------------------------------------------------------
    op.create_table(
        'facility_statuses',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('is_operational', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_statuses_org', 'facility_statuses', ['organization_id'])
    op.create_index('idx_facility_statuses_org_name', 'facility_statuses', ['organization_id', 'name'], unique=True)

    # ------------------------------------------------------------------
    # 3. facilities (main table)
    # ------------------------------------------------------------------
    op.create_table(
        'facilities',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        # Identity
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('facility_number', sa.String(50), nullable=True),
        sa.Column('facility_type_id', sa.String(36), sa.ForeignKey('facility_types.id'), nullable=False),
        sa.Column('status_id', sa.String(36), sa.ForeignKey('facility_statuses.id'), nullable=False),
        # Address
        sa.Column('address_line1', sa.String(200), nullable=True),
        sa.Column('address_line2', sa.String(200), nullable=True),
        sa.Column('city', sa.String(100), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('zip_code', sa.String(20), nullable=True),
        sa.Column('county', sa.String(100), nullable=True),
        sa.Column('latitude', sa.Numeric(10, 7), nullable=True),
        sa.Column('longitude', sa.Numeric(10, 7), nullable=True),
        # Building info
        sa.Column('year_built', sa.Integer(), nullable=True),
        sa.Column('year_renovated', sa.Integer(), nullable=True),
        sa.Column('square_footage', sa.Integer(), nullable=True),
        sa.Column('num_floors', sa.Integer(), nullable=True),
        sa.Column('num_bays', sa.Integer(), nullable=True),
        sa.Column('lot_size_acres', sa.Numeric(10, 2), nullable=True),
        # Ownership
        sa.Column('is_owned', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('lease_expiration', sa.Date(), nullable=True),
        sa.Column('property_tax_id', sa.String(100), nullable=True),
        # Capacity
        sa.Column('max_occupancy', sa.Integer(), nullable=True),
        sa.Column('sleeping_quarters', sa.Integer(), nullable=True),
        # Contact
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('fax', sa.String(50), nullable=True),
        sa.Column('email', sa.String(200), nullable=True),
        # Description
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        # Status tracking
        sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status_changed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        # Archive (soft-delete)
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('archived_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        # Metadata
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facilities_org', 'facilities', ['organization_id'])
    op.create_index('idx_facilities_org_number', 'facilities', ['organization_id', 'facility_number'], unique=True)
    op.create_index('idx_facilities_org_type', 'facilities', ['organization_id', 'facility_type_id'])
    op.create_index('idx_facilities_org_status', 'facilities', ['organization_id', 'status_id'])
    op.create_index('idx_facilities_archived', 'facilities', ['is_archived'])

    # ------------------------------------------------------------------
    # 4. facility_photos
    # ------------------------------------------------------------------
    op.create_table(
        'facility_photos',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_name', sa.String(200), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('caption', sa.String(500), nullable=True),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_photos_facility', 'facility_photos', ['facility_id'])

    # ------------------------------------------------------------------
    # 5. facility_documents
    # ------------------------------------------------------------------
    op.create_table(
        'facility_documents',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('file_name', sa.String(200), nullable=False),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('document_type', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('document_date', sa.Date(), nullable=True),
        sa.Column('expiration_date', sa.Date(), nullable=True),
        sa.Column('uploaded_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_documents_facility', 'facility_documents', ['facility_id'])
    op.create_index('idx_facility_documents_type', 'facility_documents', ['document_type'])
    op.create_index('idx_facility_documents_expiration', 'facility_documents', ['expiration_date'])

    # ------------------------------------------------------------------
    # 6. facility_maintenance_types
    # ------------------------------------------------------------------
    op.create_table(
        'facility_maintenance_types',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.String(50), nullable=True),
        sa.Column('default_interval_value', sa.Integer(), nullable=True),
        sa.Column('default_interval_unit', sa.String(20), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_maint_types_org', 'facility_maintenance_types', ['organization_id'])
    op.create_index('idx_facility_maint_types_org_name', 'facility_maintenance_types', ['organization_id', 'name'], unique=True)

    # ------------------------------------------------------------------
    # 7. facility_systems
    # ------------------------------------------------------------------
    op.create_table(
        'facility_systems',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('system_type', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('manufacturer', sa.String(200), nullable=True),
        sa.Column('model_number', sa.String(100), nullable=True),
        sa.Column('serial_number', sa.String(100), nullable=True),
        sa.Column('install_date', sa.Date(), nullable=True),
        sa.Column('warranty_expiration', sa.Date(), nullable=True),
        sa.Column('expected_life_years', sa.Integer(), nullable=True),
        sa.Column('condition', sa.String(20), nullable=False, server_default='good'),
        sa.Column('last_serviced_date', sa.Date(), nullable=True),
        sa.Column('last_inspected_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('archived_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_systems_facility', 'facility_systems', ['facility_id'])
    op.create_index('idx_facility_systems_type', 'facility_systems', ['facility_id', 'system_type'])
    op.create_index('idx_facility_systems_condition', 'facility_systems', ['condition'])

    # ------------------------------------------------------------------
    # 8. facility_maintenance
    # ------------------------------------------------------------------
    op.create_table(
        'facility_maintenance',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('maintenance_type_id', sa.String(36), sa.ForeignKey('facility_maintenance_types.id'), nullable=False),
        sa.Column('system_id', sa.String(36), sa.ForeignKey('facility_systems.id', ondelete='SET NULL'), nullable=True),
        # Scheduling
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        # Completion
        sa.Column('completed_date', sa.Date(), nullable=True),
        sa.Column('completed_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('performed_by', sa.String(200), nullable=True),
        # Status
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_overdue', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        # Details
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('work_performed', sa.Text(), nullable=True),
        sa.Column('findings', sa.Text(), nullable=True),
        # Cost
        sa.Column('cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('vendor', sa.String(200), nullable=True),
        sa.Column('invoice_number', sa.String(100), nullable=True),
        sa.Column('work_order_number', sa.String(100), nullable=True),
        # Next service
        sa.Column('next_due_date', sa.Date(), nullable=True),
        # Notes & attachments
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('attachments', sa.JSON(), nullable=True),
        # Historic entry support
        sa.Column('is_historic', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('occurred_date', sa.Date(), nullable=True),
        sa.Column('historic_source', sa.String(200), nullable=True),
        # Timestamps
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_maint_facility', 'facility_maintenance', ['facility_id'])
    op.create_index('idx_facility_maint_type', 'facility_maintenance', ['maintenance_type_id'])
    op.create_index('idx_facility_maint_system', 'facility_maintenance', ['system_id'])
    op.create_index('idx_facility_maint_due_date', 'facility_maintenance', ['due_date'])
    op.create_index('idx_facility_maint_completed', 'facility_maintenance', ['is_completed'])
    op.create_index('idx_facility_maint_overdue', 'facility_maintenance', ['is_overdue'])
    op.create_index('idx_facility_maint_historic', 'facility_maintenance', ['is_historic'])
    op.create_index('idx_facility_maint_occurred', 'facility_maintenance', ['occurred_date'])

    # ------------------------------------------------------------------
    # 9. facility_inspections
    # ------------------------------------------------------------------
    op.create_table(
        'facility_inspections',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('organization_id', sa.String(36), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('facility_id', sa.String(36), sa.ForeignKey('facilities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('inspection_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('inspection_date', sa.Date(), nullable=False),
        sa.Column('next_inspection_date', sa.Date(), nullable=True),
        sa.Column('passed', sa.Boolean(), nullable=True),
        sa.Column('inspector_name', sa.String(200), nullable=True),
        sa.Column('inspector_organization', sa.String(200), nullable=True),
        sa.Column('certificate_number', sa.String(100), nullable=True),
        sa.Column('findings', sa.Text(), nullable=True),
        sa.Column('corrective_actions', sa.Text(), nullable=True),
        sa.Column('corrective_action_deadline', sa.Date(), nullable=True),
        sa.Column('corrective_action_completed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('attachments', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('idx_facility_inspections_facility', 'facility_inspections', ['facility_id'])
    op.create_index('idx_facility_inspections_type', 'facility_inspections', ['inspection_type'])
    op.create_index('idx_facility_inspections_date', 'facility_inspections', ['inspection_date'])
    op.create_index('idx_facility_inspections_next', 'facility_inspections', ['next_inspection_date'])
    op.create_index('idx_facility_inspections_passed', 'facility_inspections', ['passed'])


def downgrade() -> None:
    op.drop_table('facility_inspections')
    op.drop_table('facility_maintenance')
    op.drop_table('facility_systems')
    op.drop_table('facility_maintenance_types')
    op.drop_table('facility_documents')
    op.drop_table('facility_photos')
    op.drop_table('facilities')
    op.drop_table('facility_statuses')
    op.drop_table('facility_types')
