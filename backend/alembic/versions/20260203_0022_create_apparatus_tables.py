"""Create apparatus module tables

Revision ID: 20260203_0022
Revises: 20260202_0021
Create Date: 2026-02-03

Creates all tables for the Apparatus/Vehicle tracking module:
- apparatus_types: Vehicle type definitions (engine, ladder, etc.)
- apparatus_statuses: Status definitions (in service, out of service, etc.)
- apparatus: Main vehicle/apparatus records
- apparatus_custom_fields: User-defined field definitions
- apparatus_photos: Vehicle photos
- apparatus_documents: Vehicle documents (titles, registrations, etc.)
- apparatus_maintenance_types: Maintenance type definitions
- apparatus_maintenance: Maintenance records
- apparatus_fuel_logs: Fuel purchase/usage logs
- apparatus_operators: Operator certifications
- apparatus_equipment: Equipment on apparatus
- apparatus_location_history: Station assignment history
- apparatus_status_history: Status change history
- apparatus_nfpa_compliance: NFPA compliance tracking
- apparatus_report_configs: Report configuration
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision = '20260203_0022'
down_revision = '20260202_0021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =========================================================================
    # Apparatus Types
    # =========================================================================
    op.create_table(
        'apparatus_types',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.Enum('fire', 'ems', 'rescue', 'support', 'command', 'marine', 'aircraft', 'admin', 'other', name='apparatuscategory'), nullable=False, server_default='fire'),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('default_type', sa.Enum('engine', 'ladder', 'quint', 'rescue', 'ambulance', 'squad', 'tanker', 'brush', 'hazmat', 'command', 'utility', 'boat', 'atv', 'staff', 'reserve', 'other', name='defaultapparatustype'), nullable=True),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_types_org_code', 'apparatus_types', ['organization_id', 'code'], unique=True)
    op.create_index('idx_apparatus_types_category', 'apparatus_types', ['category'])
    op.create_index('idx_apparatus_types_is_system', 'apparatus_types', ['is_system'])

    # =========================================================================
    # Apparatus Statuses
    # =========================================================================
    op.create_table(
        'apparatus_statuses',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('default_status', sa.Enum('in_service', 'out_of_service', 'in_maintenance', 'reserve', 'on_order', 'sold', 'disposed', name='defaultapparatusstatus'), nullable=True),
        sa.Column('is_available', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('is_operational', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('requires_reason', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('is_archived_status', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_statuses_org_code', 'apparatus_statuses', ['organization_id', 'code'], unique=True)
    op.create_index('idx_apparatus_statuses_is_system', 'apparatus_statuses', ['is_system'])
    op.create_index('idx_apparatus_statuses_is_available', 'apparatus_statuses', ['is_available'])

    # =========================================================================
    # Main Apparatus Table
    # =========================================================================
    op.create_table(
        'apparatus',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        # Identification
        sa.Column('unit_number', sa.String(50), nullable=False),
        sa.Column('name', sa.String(200), nullable=True),
        sa.Column('vin', sa.String(17), nullable=True),
        sa.Column('license_plate', sa.String(20), nullable=True),
        sa.Column('license_state', sa.String(50), nullable=True),
        sa.Column('radio_id', sa.String(50), nullable=True),
        sa.Column('asset_tag', sa.String(50), nullable=True),
        # Type and Status
        sa.Column('apparatus_type_id', sa.String(36), nullable=False),
        sa.Column('status_id', sa.String(36), nullable=False),
        sa.Column('status_reason', sa.Text(), nullable=True),
        sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status_changed_by', sa.String(36), nullable=True),
        # Vehicle Specifications
        sa.Column('year', sa.Integer(), nullable=True),
        sa.Column('make', sa.String(100), nullable=True),
        sa.Column('model', sa.String(100), nullable=True),
        sa.Column('body_manufacturer', sa.String(100), nullable=True),
        sa.Column('color', sa.String(50), nullable=True),
        # Fuel
        sa.Column('fuel_type', sa.Enum('gasoline', 'diesel', 'electric', 'hybrid', 'propane', 'cng', 'other', name='fueltype'), nullable=True),
        sa.Column('fuel_capacity_gallons', sa.Numeric(10, 2), nullable=True),
        # Capacity
        sa.Column('seating_capacity', sa.Integer(), nullable=True),
        sa.Column('gvwr', sa.Integer(), nullable=True),
        # Fire/EMS Specifications
        sa.Column('pump_capacity_gpm', sa.Integer(), nullable=True),
        sa.Column('tank_capacity_gallons', sa.Integer(), nullable=True),
        sa.Column('foam_capacity_gallons', sa.Integer(), nullable=True),
        sa.Column('ladder_length_feet', sa.Integer(), nullable=True),
        # Location
        sa.Column('primary_station_id', sa.String(36), nullable=True),
        sa.Column('current_location_id', sa.String(36), nullable=True),
        # Usage Tracking
        sa.Column('current_mileage', sa.Integer(), nullable=True),
        sa.Column('current_hours', sa.Numeric(10, 2), nullable=True),
        sa.Column('mileage_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hours_updated_at', sa.DateTime(timezone=True), nullable=True),
        # Purchase Information
        sa.Column('purchase_date', sa.Date(), nullable=True),
        sa.Column('purchase_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('purchase_vendor', sa.String(200), nullable=True),
        sa.Column('purchase_order_number', sa.String(100), nullable=True),
        sa.Column('in_service_date', sa.Date(), nullable=True),
        # Financing
        sa.Column('is_financed', sa.Boolean(), nullable=True, server_default='0'),
        sa.Column('financing_company', sa.String(200), nullable=True),
        sa.Column('financing_end_date', sa.Date(), nullable=True),
        sa.Column('monthly_payment', sa.Numeric(10, 2), nullable=True),
        # Value Tracking
        sa.Column('original_value', sa.Numeric(12, 2), nullable=True),
        sa.Column('current_value', sa.Numeric(12, 2), nullable=True),
        sa.Column('value_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('depreciation_method', sa.String(50), nullable=True),
        sa.Column('depreciation_years', sa.Integer(), nullable=True),
        sa.Column('salvage_value', sa.Numeric(12, 2), nullable=True),
        # Warranty
        sa.Column('warranty_expiration', sa.Date(), nullable=True),
        sa.Column('extended_warranty_expiration', sa.Date(), nullable=True),
        sa.Column('warranty_provider', sa.String(200), nullable=True),
        sa.Column('warranty_notes', sa.Text(), nullable=True),
        # Insurance
        sa.Column('insurance_policy_number', sa.String(100), nullable=True),
        sa.Column('insurance_provider', sa.String(200), nullable=True),
        sa.Column('insurance_expiration', sa.Date(), nullable=True),
        # Registration
        sa.Column('registration_expiration', sa.Date(), nullable=True),
        sa.Column('inspection_expiration', sa.Date(), nullable=True),
        # Archive/Disposal
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('archived_by', sa.String(36), nullable=True),
        sa.Column('sold_date', sa.Date(), nullable=True),
        sa.Column('sold_price', sa.Numeric(12, 2), nullable=True),
        sa.Column('sold_to', sa.String(200), nullable=True),
        sa.Column('sold_to_contact', sa.String(200), nullable=True),
        sa.Column('disposal_date', sa.Date(), nullable=True),
        sa.Column('disposal_method', sa.String(100), nullable=True),
        sa.Column('disposal_reason', sa.Text(), nullable=True),
        sa.Column('disposal_notes', sa.Text(), nullable=True),
        # NFPA
        sa.Column('nfpa_tracking_enabled', sa.Boolean(), nullable=False, server_default='0'),
        # Custom Fields
        sa.Column('custom_field_values', sa.JSON(), nullable=True),
        # Notes
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        # Metadata
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_type_id'], ['apparatus_types.id']),
        sa.ForeignKeyConstraint(['status_id'], ['apparatus_statuses.id']),
        sa.ForeignKeyConstraint(['primary_station_id'], ['locations.id']),
        sa.ForeignKeyConstraint(['current_location_id'], ['locations.id']),
        sa.ForeignKeyConstraint(['status_changed_by'], ['users.id']),
        sa.ForeignKeyConstraint(['archived_by'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_org_unit', 'apparatus', ['organization_id', 'unit_number'], unique=True)
    op.create_index('idx_apparatus_org_type', 'apparatus', ['organization_id', 'apparatus_type_id'])
    op.create_index('idx_apparatus_org_status', 'apparatus', ['organization_id', 'status_id'])
    op.create_index('idx_apparatus_org_station', 'apparatus', ['organization_id', 'primary_station_id'])
    op.create_index('idx_apparatus_vin', 'apparatus', ['vin'])
    op.create_index('idx_apparatus_is_archived', 'apparatus', ['is_archived'])

    # =========================================================================
    # Custom Fields
    # =========================================================================
    op.create_table(
        'apparatus_custom_fields',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('field_key', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('field_type', sa.Enum('text', 'number', 'decimal', 'date', 'datetime', 'boolean', 'select', 'multi_select', 'url', 'email', name='customfieldtype'), nullable=False, server_default='text'),
        sa.Column('is_required', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('default_value', sa.Text(), nullable=True),
        sa.Column('placeholder', sa.String(200), nullable=True),
        sa.Column('options', sa.JSON(), nullable=True),
        sa.Column('min_value', sa.Numeric(20, 6), nullable=True),
        sa.Column('max_value', sa.Numeric(20, 6), nullable=True),
        sa.Column('min_length', sa.Integer(), nullable=True),
        sa.Column('max_length', sa.Integer(), nullable=True),
        sa.Column('regex_pattern', sa.String(500), nullable=True),
        sa.Column('applies_to_types', sa.JSON(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('show_in_list', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('show_in_detail', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_custom_fields_org_key', 'apparatus_custom_fields', ['organization_id', 'field_key'], unique=True)
    op.create_index('idx_apparatus_custom_fields_org_active', 'apparatus_custom_fields', ['organization_id', 'is_active'])

    # =========================================================================
    # Photos
    # =========================================================================
    op.create_table(
        'apparatus_photos',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('title', sa.String(200), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('taken_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('photo_type', sa.String(50), nullable=True),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('uploaded_by', sa.String(36), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_photos_apparatus', 'apparatus_photos', ['apparatus_id'])
    op.create_index('idx_apparatus_photos_is_primary', 'apparatus_photos', ['apparatus_id', 'is_primary'])

    # =========================================================================
    # Documents
    # =========================================================================
    op.create_table(
        'apparatus_documents',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=True),
        sa.Column('mime_type', sa.String(100), nullable=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('document_type', sa.String(50), nullable=False),
        sa.Column('expiration_date', sa.Date(), nullable=True),
        sa.Column('document_date', sa.Date(), nullable=True),
        sa.Column('uploaded_by', sa.String(36), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_documents_apparatus', 'apparatus_documents', ['apparatus_id'])
    op.create_index('idx_apparatus_documents_type', 'apparatus_documents', ['apparatus_id', 'document_type'])
    op.create_index('idx_apparatus_documents_expiration', 'apparatus_documents', ['expiration_date'])

    # =========================================================================
    # Maintenance Types
    # =========================================================================
    op.create_table(
        'apparatus_maintenance_types',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('code', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('category', sa.Enum('preventive', 'repair', 'inspection', 'certification', 'fluid', 'cleaning', 'other', name='maintenancecategory'), nullable=False, server_default='preventive'),
        sa.Column('is_system', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('default_interval_value', sa.Integer(), nullable=True),
        sa.Column('default_interval_unit', sa.Enum('days', 'weeks', 'months', 'years', 'miles', 'kilometers', 'hours', name='maintenanceintervalunit'), nullable=True),
        sa.Column('default_interval_miles', sa.Integer(), nullable=True),
        sa.Column('default_interval_hours', sa.Integer(), nullable=True),
        sa.Column('is_nfpa_required', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('nfpa_reference', sa.String(100), nullable=True),
        sa.Column('applies_to_types', sa.JSON(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_maint_types_org_code', 'apparatus_maintenance_types', ['organization_id', 'code'], unique=True)
    op.create_index('idx_apparatus_maint_types_category', 'apparatus_maintenance_types', ['category'])
    op.create_index('idx_apparatus_maint_types_is_system', 'apparatus_maintenance_types', ['is_system'])

    # =========================================================================
    # Maintenance Records
    # =========================================================================
    op.create_table(
        'apparatus_maintenance',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('maintenance_type_id', sa.String(36), nullable=False),
        sa.Column('scheduled_date', sa.Date(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('completed_date', sa.Date(), nullable=True),
        sa.Column('completed_by', sa.String(36), nullable=True),
        sa.Column('performed_by', sa.String(200), nullable=True),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('is_overdue', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('work_performed', sa.Text(), nullable=True),
        sa.Column('findings', sa.Text(), nullable=True),
        sa.Column('mileage_at_service', sa.Integer(), nullable=True),
        sa.Column('hours_at_service', sa.Numeric(10, 2), nullable=True),
        sa.Column('cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('vendor', sa.String(200), nullable=True),
        sa.Column('invoice_number', sa.String(100), nullable=True),
        sa.Column('next_due_date', sa.Date(), nullable=True),
        sa.Column('next_due_mileage', sa.Integer(), nullable=True),
        sa.Column('next_due_hours', sa.Numeric(10, 2), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['maintenance_type_id'], ['apparatus_maintenance_types.id']),
        sa.ForeignKeyConstraint(['completed_by'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_maint_apparatus', 'apparatus_maintenance', ['apparatus_id'])
    op.create_index('idx_apparatus_maint_type', 'apparatus_maintenance', ['maintenance_type_id'])
    op.create_index('idx_apparatus_maint_due_date', 'apparatus_maintenance', ['due_date'])
    op.create_index('idx_apparatus_maint_completed', 'apparatus_maintenance', ['is_completed'])
    op.create_index('idx_apparatus_maint_overdue', 'apparatus_maintenance', ['is_overdue'])

    # =========================================================================
    # Fuel Logs
    # =========================================================================
    op.create_table(
        'apparatus_fuel_logs',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('fuel_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('fuel_type', sa.Enum('gasoline', 'diesel', 'electric', 'hybrid', 'propane', 'cng', 'other', name='fueltype'), nullable=False),
        sa.Column('gallons', sa.Numeric(10, 3), nullable=False),
        sa.Column('price_per_gallon', sa.Numeric(6, 3), nullable=True),
        sa.Column('total_cost', sa.Numeric(10, 2), nullable=True),
        sa.Column('mileage_at_fill', sa.Integer(), nullable=True),
        sa.Column('hours_at_fill', sa.Numeric(10, 2), nullable=True),
        sa.Column('is_full_tank', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('station_name', sa.String(200), nullable=True),
        sa.Column('station_address', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('recorded_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recorded_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_fuel_apparatus', 'apparatus_fuel_logs', ['apparatus_id'])
    op.create_index('idx_apparatus_fuel_date', 'apparatus_fuel_logs', ['fuel_date'])

    # =========================================================================
    # Operators
    # =========================================================================
    op.create_table(
        'apparatus_operators',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('is_certified', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('certification_date', sa.Date(), nullable=True),
        sa.Column('certification_expiration', sa.Date(), nullable=True),
        sa.Column('certified_by', sa.String(36), nullable=True),
        sa.Column('license_type_required', sa.String(50), nullable=True),
        sa.Column('license_verified', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('license_verified_date', sa.Date(), nullable=True),
        sa.Column('has_restrictions', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('restrictions', sa.JSON(), nullable=True),
        sa.Column('restriction_notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['certified_by'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_operators_apparatus', 'apparatus_operators', ['apparatus_id'])
    op.create_index('idx_apparatus_operators_user', 'apparatus_operators', ['user_id'])
    op.create_index('idx_apparatus_operators_apparatus_user', 'apparatus_operators', ['apparatus_id', 'user_id'], unique=True)
    op.create_index('idx_apparatus_operators_active', 'apparatus_operators', ['is_active'])

    # =========================================================================
    # Equipment
    # =========================================================================
    op.create_table(
        'apparatus_equipment',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('inventory_item_id', sa.String(36), nullable=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('location_on_apparatus', sa.String(200), nullable=True),
        sa.Column('is_mounted', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('is_required', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('serial_number', sa.String(100), nullable=True),
        sa.Column('asset_tag', sa.String(50), nullable=True),
        sa.Column('is_present', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('assigned_by', sa.String(36), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_equipment_apparatus', 'apparatus_equipment', ['apparatus_id'])
    op.create_index('idx_apparatus_equipment_inventory', 'apparatus_equipment', ['inventory_item_id'])

    # =========================================================================
    # Location History
    # =========================================================================
    op.create_table(
        'apparatus_location_history',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('location_id', sa.String(36), nullable=False),
        sa.Column('assigned_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('unassigned_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('assignment_reason', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_loc_hist_apparatus', 'apparatus_location_history', ['apparatus_id'])
    op.create_index('idx_apparatus_loc_hist_location', 'apparatus_location_history', ['location_id'])
    op.create_index('idx_apparatus_loc_hist_dates', 'apparatus_location_history', ['assigned_date', 'unassigned_date'])

    # =========================================================================
    # Status History
    # =========================================================================
    op.create_table(
        'apparatus_status_history',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('status_id', sa.String(36), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('mileage_at_change', sa.Integer(), nullable=True),
        sa.Column('hours_at_change', sa.Numeric(10, 2), nullable=True),
        sa.Column('changed_by', sa.String(36), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['status_id'], ['apparatus_statuses.id']),
        sa.ForeignKeyConstraint(['changed_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_status_hist_apparatus', 'apparatus_status_history', ['apparatus_id'])
    op.create_index('idx_apparatus_status_hist_status', 'apparatus_status_history', ['status_id'])
    op.create_index('idx_apparatus_status_hist_changed', 'apparatus_status_history', ['changed_at'])

    # =========================================================================
    # NFPA Compliance
    # =========================================================================
    op.create_table(
        'apparatus_nfpa_compliance',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('apparatus_id', sa.String(36), nullable=False),
        sa.Column('standard_code', sa.String(50), nullable=False),
        sa.Column('section_reference', sa.String(100), nullable=False),
        sa.Column('requirement_description', sa.Text(), nullable=False),
        sa.Column('is_compliant', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('compliance_status', sa.String(50), nullable=True, server_default='pending'),
        sa.Column('last_checked_date', sa.Date(), nullable=True),
        sa.Column('last_checked_by', sa.String(36), nullable=True),
        sa.Column('next_due_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('exemption_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['apparatus_id'], ['apparatus.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['last_checked_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_nfpa_apparatus', 'apparatus_nfpa_compliance', ['apparatus_id'])
    op.create_index('idx_apparatus_nfpa_standard', 'apparatus_nfpa_compliance', ['standard_code'])
    op.create_index('idx_apparatus_nfpa_status', 'apparatus_nfpa_compliance', ['compliance_status'])
    op.create_index('idx_apparatus_nfpa_due', 'apparatus_nfpa_compliance', ['next_due_date'])

    # =========================================================================
    # Report Configs
    # =========================================================================
    op.create_table(
        'apparatus_report_configs',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('report_type', sa.String(50), nullable=False),
        sa.Column('is_scheduled', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('schedule_frequency', sa.String(50), nullable=True),
        sa.Column('schedule_day', sa.Integer(), nullable=True),
        sa.Column('next_run_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_run_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('data_range_type', sa.String(50), nullable=True),
        sa.Column('data_range_days', sa.Integer(), nullable=True),
        sa.Column('include_apparatus_ids', sa.JSON(), nullable=True),
        sa.Column('include_type_ids', sa.JSON(), nullable=True),
        sa.Column('include_status_ids', sa.JSON(), nullable=True),
        sa.Column('include_archived', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('fields_to_include', sa.JSON(), nullable=True),
        sa.Column('group_by', sa.String(100), nullable=True),
        sa.Column('sort_by', sa.String(100), nullable=True),
        sa.Column('sort_direction', sa.String(10), nullable=True, server_default='asc'),
        sa.Column('output_format', sa.String(50), nullable=True, server_default='pdf'),
        sa.Column('email_recipients', sa.JSON(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('created_by', sa.String(36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id']),
        mysql_charset='utf8mb4',
        mysql_collate='utf8mb4_unicode_ci'
    )
    op.create_index('idx_apparatus_report_configs_org', 'apparatus_report_configs', ['organization_id'])
    op.create_index('idx_apparatus_report_configs_scheduled', 'apparatus_report_configs', ['is_scheduled'])
    op.create_index('idx_apparatus_report_configs_next_run', 'apparatus_report_configs', ['next_run_date'])


def downgrade() -> None:
    # Drop tables in reverse order (respecting foreign keys)
    op.drop_index('idx_apparatus_report_configs_next_run', table_name='apparatus_report_configs')
    op.drop_index('idx_apparatus_report_configs_scheduled', table_name='apparatus_report_configs')
    op.drop_index('idx_apparatus_report_configs_org', table_name='apparatus_report_configs')
    op.drop_table('apparatus_report_configs')

    op.drop_index('idx_apparatus_nfpa_due', table_name='apparatus_nfpa_compliance')
    op.drop_index('idx_apparatus_nfpa_status', table_name='apparatus_nfpa_compliance')
    op.drop_index('idx_apparatus_nfpa_standard', table_name='apparatus_nfpa_compliance')
    op.drop_index('idx_apparatus_nfpa_apparatus', table_name='apparatus_nfpa_compliance')
    op.drop_table('apparatus_nfpa_compliance')

    op.drop_index('idx_apparatus_status_hist_changed', table_name='apparatus_status_history')
    op.drop_index('idx_apparatus_status_hist_status', table_name='apparatus_status_history')
    op.drop_index('idx_apparatus_status_hist_apparatus', table_name='apparatus_status_history')
    op.drop_table('apparatus_status_history')

    op.drop_index('idx_apparatus_loc_hist_dates', table_name='apparatus_location_history')
    op.drop_index('idx_apparatus_loc_hist_location', table_name='apparatus_location_history')
    op.drop_index('idx_apparatus_loc_hist_apparatus', table_name='apparatus_location_history')
    op.drop_table('apparatus_location_history')

    op.drop_index('idx_apparatus_equipment_inventory', table_name='apparatus_equipment')
    op.drop_index('idx_apparatus_equipment_apparatus', table_name='apparatus_equipment')
    op.drop_table('apparatus_equipment')

    op.drop_index('idx_apparatus_operators_active', table_name='apparatus_operators')
    op.drop_index('idx_apparatus_operators_apparatus_user', table_name='apparatus_operators')
    op.drop_index('idx_apparatus_operators_user', table_name='apparatus_operators')
    op.drop_index('idx_apparatus_operators_apparatus', table_name='apparatus_operators')
    op.drop_table('apparatus_operators')

    op.drop_index('idx_apparatus_fuel_date', table_name='apparatus_fuel_logs')
    op.drop_index('idx_apparatus_fuel_apparatus', table_name='apparatus_fuel_logs')
    op.drop_table('apparatus_fuel_logs')

    op.drop_index('idx_apparatus_maint_overdue', table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_completed', table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_due_date', table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_type', table_name='apparatus_maintenance')
    op.drop_index('idx_apparatus_maint_apparatus', table_name='apparatus_maintenance')
    op.drop_table('apparatus_maintenance')

    op.drop_index('idx_apparatus_maint_types_is_system', table_name='apparatus_maintenance_types')
    op.drop_index('idx_apparatus_maint_types_category', table_name='apparatus_maintenance_types')
    op.drop_index('idx_apparatus_maint_types_org_code', table_name='apparatus_maintenance_types')
    op.drop_table('apparatus_maintenance_types')

    op.drop_index('idx_apparatus_documents_expiration', table_name='apparatus_documents')
    op.drop_index('idx_apparatus_documents_type', table_name='apparatus_documents')
    op.drop_index('idx_apparatus_documents_apparatus', table_name='apparatus_documents')
    op.drop_table('apparatus_documents')

    op.drop_index('idx_apparatus_photos_is_primary', table_name='apparatus_photos')
    op.drop_index('idx_apparatus_photos_apparatus', table_name='apparatus_photos')
    op.drop_table('apparatus_photos')

    op.drop_index('idx_apparatus_custom_fields_org_active', table_name='apparatus_custom_fields')
    op.drop_index('idx_apparatus_custom_fields_org_key', table_name='apparatus_custom_fields')
    op.drop_table('apparatus_custom_fields')

    op.drop_index('idx_apparatus_is_archived', table_name='apparatus')
    op.drop_index('idx_apparatus_vin', table_name='apparatus')
    op.drop_index('idx_apparatus_org_station', table_name='apparatus')
    op.drop_index('idx_apparatus_org_status', table_name='apparatus')
    op.drop_index('idx_apparatus_org_type', table_name='apparatus')
    op.drop_index('idx_apparatus_org_unit', table_name='apparatus')
    op.drop_table('apparatus')

    op.drop_index('idx_apparatus_statuses_is_available', table_name='apparatus_statuses')
    op.drop_index('idx_apparatus_statuses_is_system', table_name='apparatus_statuses')
    op.drop_index('idx_apparatus_statuses_org_code', table_name='apparatus_statuses')
    op.drop_table('apparatus_statuses')

    op.drop_index('idx_apparatus_types_is_system', table_name='apparatus_types')
    op.drop_index('idx_apparatus_types_category', table_name='apparatus_types')
    op.drop_index('idx_apparatus_types_org_code', table_name='apparatus_types')
    op.drop_table('apparatus_types')

    # Drop enums
    op.execute("DROP TYPE IF EXISTS apparatuscategory")
    op.execute("DROP TYPE IF EXISTS defaultapparatustype")
    op.execute("DROP TYPE IF EXISTS defaultapparatusstatus")
    op.execute("DROP TYPE IF EXISTS fueltype")
    op.execute("DROP TYPE IF EXISTS customfieldtype")
    op.execute("DROP TYPE IF EXISTS maintenancecategory")
    op.execute("DROP TYPE IF EXISTS maintenanceintervalunit")
