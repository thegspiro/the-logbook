"""Seed facilities system data

Revision ID: 20260214_2000
Revises: 20260214_1900
Create Date: 2026-02-14

Seeds system-defined facility types, statuses, and maintenance types
that are available to all organizations.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column
import uuid

# revision identifiers, used by Alembic.
revision = '20260214_2000'
down_revision = '20260214_1900'
branch_labels = None
depends_on = None


def generate_uuid():
    return str(uuid.uuid4())


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Define table references for bulk_insert
    # ------------------------------------------------------------------
    facility_types = table(
        'facility_types',
        column('id', sa.String),
        column('organization_id', sa.String),
        column('name', sa.String),
        column('description', sa.Text),
        column('category', sa.String),
        column('is_system', sa.Boolean),
        column('is_active', sa.Boolean),
    )

    facility_statuses = table(
        'facility_statuses',
        column('id', sa.String),
        column('organization_id', sa.String),
        column('name', sa.String),
        column('description', sa.Text),
        column('color', sa.String),
        column('is_operational', sa.Boolean),
        column('is_system', sa.Boolean),
        column('is_active', sa.Boolean),
    )

    facility_maintenance_types = table(
        'facility_maintenance_types',
        column('id', sa.String),
        column('organization_id', sa.String),
        column('name', sa.String),
        column('description', sa.Text),
        column('category', sa.String),
        column('default_interval_value', sa.Integer),
        column('default_interval_unit', sa.String),
        column('is_system', sa.Boolean),
        column('is_active', sa.Boolean),
    )

    # ------------------------------------------------------------------
    # 1. Seed default facility types
    # ------------------------------------------------------------------
    type_data = [
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Fire Station',
            'description': 'Active fire station housing apparatus and personnel',
            'category': 'station',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'EMS Station',
            'description': 'Emergency medical services station',
            'category': 'station',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Training Center',
            'description': 'Dedicated training facility or academy',
            'category': 'training',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Administrative Office',
            'description': 'Administrative and headquarters building',
            'category': 'administration',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Meeting Hall',
            'description': 'Meeting hall or social hall',
            'category': 'meeting_hall',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Storage Building',
            'description': 'Equipment or supply storage facility',
            'category': 'storage',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Maintenance Shop',
            'description': 'Vehicle and equipment maintenance facility',
            'category': 'storage',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Communications Center',
            'description': 'Dispatch or communications center',
            'category': 'administration',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Community Center',
            'description': 'Community outreach or public education facility',
            'category': 'community',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Other',
            'description': 'Other facility type',
            'category': 'other',
            'is_system': True,
            'is_active': True,
        },
    ]
    op.bulk_insert(facility_types, type_data)

    # ------------------------------------------------------------------
    # 2. Seed default facility statuses
    # ------------------------------------------------------------------
    status_data = [
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Operational',
            'description': 'Facility is fully operational and in use',
            'color': '#22C55E',
            'is_operational': True,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Under Renovation',
            'description': 'Facility is undergoing renovation or major repairs',
            'color': '#F59E0B',
            'is_operational': False,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Under Construction',
            'description': 'New facility under construction',
            'color': '#3B82F6',
            'is_operational': False,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Temporarily Closed',
            'description': 'Facility is temporarily closed or out of service',
            'color': '#EF4444',
            'is_operational': False,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Decommissioned',
            'description': 'Facility has been decommissioned and is no longer in use',
            'color': '#6B7280',
            'is_operational': False,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Other',
            'description': 'Other status',
            'color': '#9CA3AF',
            'is_operational': True,
            'is_system': True,
            'is_active': True,
        },
    ]
    op.bulk_insert(facility_statuses, status_data)

    # ------------------------------------------------------------------
    # 3. Seed default facility maintenance types
    # ------------------------------------------------------------------
    maint_type_data = [
        # Preventive
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'HVAC Filter Change',
            'description': 'Replace HVAC air filters',
            'category': 'preventive',
            'default_interval_value': 3,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'HVAC Seasonal Service',
            'description': 'Seasonal HVAC inspection and tune-up',
            'category': 'preventive',
            'default_interval_value': 6,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Generator Test',
            'description': 'Test backup generator under load',
            'category': 'preventive',
            'default_interval_value': 1,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Fire Extinguisher Inspection',
            'description': 'Monthly visual inspection of fire extinguishers',
            'category': 'safety',
            'default_interval_value': 1,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Fire Alarm Test',
            'description': 'Test fire alarm system and notification devices',
            'category': 'safety',
            'default_interval_value': 1,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Sprinkler System Inspection',
            'description': 'Inspect fire suppression sprinkler system',
            'category': 'safety',
            'default_interval_value': 3,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Backflow Preventer Test',
            'description': 'Annual backflow preventer certification test',
            'category': 'inspection',
            'default_interval_value': 1,
            'default_interval_unit': 'years',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Roof Inspection',
            'description': 'Inspect roof condition, drainage, and integrity',
            'category': 'inspection',
            'default_interval_value': 1,
            'default_interval_unit': 'years',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Elevator Inspection',
            'description': 'Annual elevator safety inspection and certification',
            'category': 'inspection',
            'default_interval_value': 1,
            'default_interval_unit': 'years',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Bay Door Service',
            'description': 'Service and inspect apparatus bay doors',
            'category': 'preventive',
            'default_interval_value': 6,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Plumbing Inspection',
            'description': 'Inspect plumbing system, fixtures, and drains',
            'category': 'inspection',
            'default_interval_value': 1,
            'default_interval_unit': 'years',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Electrical Panel Inspection',
            'description': 'Inspect electrical panels, breakers, and wiring',
            'category': 'inspection',
            'default_interval_value': 1,
            'default_interval_unit': 'years',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Pest Control',
            'description': 'Scheduled pest control treatment',
            'category': 'preventive',
            'default_interval_value': 3,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Landscaping',
            'description': 'Grounds maintenance and landscaping',
            'category': 'cleaning',
            'default_interval_value': 1,
            'default_interval_unit': 'weeks',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Deep Cleaning',
            'description': 'Deep cleaning of facility interior',
            'category': 'cleaning',
            'default_interval_value': 3,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Emergency Lighting Test',
            'description': 'Test emergency lighting and exit signs',
            'category': 'safety',
            'default_interval_value': 1,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Security System Check',
            'description': 'Test security cameras, locks, and alarm system',
            'category': 'safety',
            'default_interval_value': 3,
            'default_interval_unit': 'months',
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'General Repair',
            'description': 'General repair or fix',
            'category': 'repair',
            'default_interval_value': None,
            'default_interval_unit': None,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Painting',
            'description': 'Interior or exterior painting',
            'category': 'renovation',
            'default_interval_value': None,
            'default_interval_unit': None,
            'is_system': True,
            'is_active': True,
        },
        {
            'id': generate_uuid(),
            'organization_id': None,
            'name': 'Other',
            'description': 'Other maintenance type',
            'category': 'other',
            'default_interval_value': None,
            'default_interval_unit': None,
            'is_system': True,
            'is_active': True,
        },
    ]
    op.bulk_insert(facility_maintenance_types, maint_type_data)


def downgrade() -> None:
    # Remove seeded system data (organization_id IS NULL means system-wide)
    op.execute("DELETE FROM facility_maintenance_types WHERE organization_id IS NULL AND is_system = 1")
    op.execute("DELETE FROM facility_statuses WHERE organization_id IS NULL AND is_system = 1")
    op.execute("DELETE FROM facility_types WHERE organization_id IS NULL AND is_system = 1")
