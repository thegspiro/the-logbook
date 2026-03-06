"""Seed NFPA-aligned facility maintenance types and compliance checklists

Revision ID: 20260306_0200
Revises: 20260306_0100
Create Date: 2026-03-06

Adds fire-service-specific maintenance types aligned with NFPA 1500,
1581, 1851, 1911, and OSHA standards. Also adds system-level
compliance checklist templates for common regulatory frameworks.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.sql import table, column
import uuid

# revision identifiers, used by Alembic.
revision = "20260306_0200"
down_revision = "20260306_0100"
branch_labels = None
depends_on = None


def generate_uuid():
    return str(uuid.uuid4())


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Make organization_id nullable on facility lookup tables so that
    # system-level records (is_system=True) can exist without an org.
    # The earlier seed migration (20260214_2000) also inserts system
    # records with organization_id=NULL, so this fixes both.
    # ------------------------------------------------------------------
    op.alter_column(
        "facility_maintenance_types",
        "organization_id",
        existing_type=sa.String(36),
        nullable=True,
    )
    op.alter_column(
        "facility_types",
        "organization_id",
        existing_type=sa.String(36),
        nullable=True,
    )
    op.alter_column(
        "facility_statuses",
        "organization_id",
        existing_type=sa.String(36),
        nullable=True,
    )

    # ------------------------------------------------------------------
    # Backfill original seed data from 20260214_2000 if missing.
    # That migration may have been stamped as applied without data
    # being inserted (due to the NOT NULL constraint that we just fixed).
    # ------------------------------------------------------------------
    conn = op.get_bind()

    facility_types_tbl = table(
        "facility_types",
        column("id", sa.String),
        column("organization_id", sa.String),
        column("name", sa.String),
        column("description", sa.Text),
        column("category", sa.String),
        column("is_system", sa.Boolean),
        column("is_active", sa.Boolean),
    )

    facility_statuses_tbl = table(
        "facility_statuses",
        column("id", sa.String),
        column("organization_id", sa.String),
        column("name", sa.String),
        column("description", sa.Text),
        column("color", sa.String),
        column("is_operational", sa.Boolean),
        column("is_system", sa.Boolean),
        column("is_active", sa.Boolean),
    )

    facility_maintenance_types = table(
        "facility_maintenance_types",
        column("id", sa.String),
        column("organization_id", sa.String),
        column("name", sa.String),
        column("description", sa.Text),
        column("category", sa.String),
        column("default_interval_value", sa.Integer),
        column("default_interval_unit", sa.String),
        column("is_system", sa.Boolean),
        column("is_active", sa.Boolean),
    )

    # Check if original seed data exists (look for "Fire Station" type)
    result = conn.execute(
        text("SELECT COUNT(*) FROM facility_types WHERE is_system = 1 AND organization_id IS NULL")
    )
    system_types_count = result.scalar()

    if not system_types_count:
        # Re-insert original facility types from 20260214_2000
        op.bulk_insert(facility_types_tbl, [
            {"id": generate_uuid(), "organization_id": None, "name": "Fire Station", "description": "Active fire station housing apparatus and personnel", "category": "station", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "EMS Station", "description": "Emergency medical services station", "category": "station", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Training Center", "description": "Dedicated training facility or academy", "category": "training", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Administrative Office", "description": "Administrative and headquarters building", "category": "administration", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Meeting Hall", "description": "Meeting hall or social hall", "category": "meeting_hall", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Storage Building", "description": "Equipment or supply storage facility", "category": "storage", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Maintenance Shop", "description": "Vehicle and equipment maintenance facility", "category": "storage", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Communications Center", "description": "Dispatch or communications center", "category": "administration", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Community Center", "description": "Community outreach or public education facility", "category": "community", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Other", "description": "Other facility type", "category": "other", "is_system": True, "is_active": True},
        ])

    result = conn.execute(
        text("SELECT COUNT(*) FROM facility_statuses WHERE is_system = 1 AND organization_id IS NULL")
    )
    system_statuses_count = result.scalar()

    if not system_statuses_count:
        # Re-insert original facility statuses from 20260214_2000
        op.bulk_insert(facility_statuses_tbl, [
            {"id": generate_uuid(), "organization_id": None, "name": "Operational", "description": "Facility is fully operational and in use", "color": "#22C55E", "is_operational": True, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Under Renovation", "description": "Facility is undergoing renovation or major repairs", "color": "#F59E0B", "is_operational": False, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Under Construction", "description": "New facility under construction", "color": "#3B82F6", "is_operational": False, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Temporarily Closed", "description": "Facility is temporarily closed or out of service", "color": "#EF4444", "is_operational": False, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Decommissioned", "description": "Facility has been decommissioned and is no longer in use", "color": "#6B7280", "is_operational": False, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Other", "description": "Other status", "color": "#9CA3AF", "is_operational": True, "is_system": True, "is_active": True},
        ])

    result = conn.execute(
        text("SELECT COUNT(*) FROM facility_maintenance_types WHERE is_system = 1 AND organization_id IS NULL")
    )
    system_maint_types_count = result.scalar()

    if not system_maint_types_count:
        # Re-insert original maintenance types from 20260214_2000
        op.bulk_insert(facility_maintenance_types, [
            {"id": generate_uuid(), "organization_id": None, "name": "HVAC Filter Change", "description": "Replace HVAC air filters", "category": "preventive", "default_interval_value": 3, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "HVAC Seasonal Service", "description": "Seasonal HVAC inspection and tune-up", "category": "preventive", "default_interval_value": 6, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Generator Test", "description": "Test backup generator under load", "category": "preventive", "default_interval_value": 1, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Fire Extinguisher Inspection", "description": "Monthly visual inspection of fire extinguishers", "category": "safety", "default_interval_value": 1, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Fire Alarm Test", "description": "Test fire alarm system and notification devices", "category": "safety", "default_interval_value": 1, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Sprinkler System Inspection", "description": "Inspect fire suppression sprinkler system", "category": "safety", "default_interval_value": 3, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Backflow Preventer Test", "description": "Annual backflow preventer certification test", "category": "inspection", "default_interval_value": 1, "default_interval_unit": "years", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Roof Inspection", "description": "Inspect roof condition, drainage, and integrity", "category": "inspection", "default_interval_value": 1, "default_interval_unit": "years", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Elevator Inspection", "description": "Annual elevator safety inspection and certification", "category": "inspection", "default_interval_value": 1, "default_interval_unit": "years", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Bay Door Service", "description": "Service and inspect apparatus bay doors", "category": "preventive", "default_interval_value": 6, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Plumbing Inspection", "description": "Inspect plumbing system, fixtures, and drains", "category": "inspection", "default_interval_value": 1, "default_interval_unit": "years", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Electrical Panel Inspection", "description": "Inspect electrical panels, breakers, and wiring", "category": "inspection", "default_interval_value": 1, "default_interval_unit": "years", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Pest Control", "description": "Scheduled pest control treatment", "category": "preventive", "default_interval_value": 3, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Landscaping", "description": "Grounds maintenance and landscaping", "category": "cleaning", "default_interval_value": 1, "default_interval_unit": "weeks", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Deep Cleaning", "description": "Deep cleaning of facility interior", "category": "cleaning", "default_interval_value": 3, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Emergency Lighting Test", "description": "Test emergency lighting and exit signs", "category": "safety", "default_interval_value": 1, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Security System Check", "description": "Test security cameras, locks, and alarm system", "category": "safety", "default_interval_value": 3, "default_interval_unit": "months", "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "General Repair", "description": "General repair or fix", "category": "repair", "default_interval_value": None, "default_interval_unit": None, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Painting", "description": "Interior or exterior painting", "category": "renovation", "default_interval_value": None, "default_interval_unit": None, "is_system": True, "is_active": True},
            {"id": generate_uuid(), "organization_id": None, "name": "Other", "description": "Other maintenance type", "category": "other", "default_interval_value": None, "default_interval_unit": None, "is_system": True, "is_active": True},
        ])

    # ------------------------------------------------------------------
    # Fire-service-specific maintenance types (NFPA-aligned)
    # ------------------------------------------------------------------
    maint_type_data = [
        # --- NFPA 1500: Exhaust extraction systems ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Exhaust Extraction System Inspection",
            "description": "Inspect vehicle exhaust extraction system per NFPA 1500 Section 10.1.5",
            "category": "safety",
            "default_interval_value": 6,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Exhaust Extraction Filter Replacement",
            "description": "Replace filters in vehicle exhaust extraction system",
            "category": "preventive",
            "default_interval_value": 3,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- NFPA 1500: CO/Air quality monitoring ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "CO/NO2 Monitor Calibration",
            "description": "Calibrate carbon monoxide and nitrogen dioxide monitors in apparatus bays per IMC requirements",
            "category": "safety",
            "default_interval_value": 6,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Air Quality Sensor Test",
            "description": "Functional test of apparatus bay air quality sensors and automatic ventilation activation",
            "category": "safety",
            "default_interval_value": 1,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- NFPA 1851: PPE cleaning and maintenance ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Gear Extractor Service",
            "description": "Service PPE gear extractor/washer per NFPA 1851 requirements",
            "category": "preventive",
            "default_interval_value": 6,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "PPE Drying Cabinet Inspection",
            "description": "Inspect PPE drying racks/cabinets for proper operation and temperature",
            "category": "inspection",
            "default_interval_value": 3,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- NFPA 1581: Infection control ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Decontamination Area Inspection",
            "description": "Inspect decontamination facilities per NFPA 1581 Chapter 5 — ventilation, non-porous surfaces, biohazard containers",
            "category": "safety",
            "default_interval_value": 1,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Biohazard Waste Container Service",
            "description": "Empty and sanitize biohazard waste containers per NFPA 1581",
            "category": "cleaning",
            "default_interval_value": 1,
            "default_interval_unit": "weeks",
            "is_system": True,
            "is_active": True,
        },
        # --- NFPA 1500/1585: Zone pressurization ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Zone Pressure Differential Test",
            "description": "Verify HVAC pressure differentials between hot/transition/cold zones per NFPA 1500/1585",
            "category": "inspection",
            "default_interval_value": 6,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- Cascade air system ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Cascade Air System Inspection",
            "description": "Inspect SCBA cascade air fill system — compressor, filters, air quality, fittings",
            "category": "safety",
            "default_interval_value": 3,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Cascade Air Quality Test",
            "description": "Test breathing air quality from cascade system (Grade D or better per OSHA 29 CFR 1910.134)",
            "category": "inspection",
            "default_interval_value": 3,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- Alerting system ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Station Alerting System Test",
            "description": "Test station alerting/tones system — speakers, lights, bay door triggers, dispatch interface",
            "category": "safety",
            "default_interval_value": 1,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- Shore power ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Shore Power Connection Inspection",
            "description": "Inspect apparatus shore power connections, cables, and auto-disconnect systems",
            "category": "inspection",
            "default_interval_value": 6,
            "default_interval_unit": "months",
            "is_system": True,
            "is_active": True,
        },
        # --- Generator load testing (annual full-load per NFPA 110) ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Generator Annual Load Test",
            "description": "Annual full-load test of emergency generator per NFPA 110",
            "category": "inspection",
            "default_interval_value": 1,
            "default_interval_unit": "years",
            "is_system": True,
            "is_active": True,
        },
        # --- ADA-related ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "ADA Accessibility Review",
            "description": "Review facility ADA compliance — accessible routes, parking, signage, alarm signals (audible + visual)",
            "category": "inspection",
            "default_interval_value": 1,
            "default_interval_unit": "years",
            "is_system": True,
            "is_active": True,
        },
        # --- Fire extinguisher annual maintenance (separate from monthly visual) ---
        {
            "id": generate_uuid(),
            "organization_id": None,
            "name": "Fire Extinguisher Annual Maintenance",
            "description": "Annual professional maintenance and certification of fire extinguishers per NFPA 10",
            "category": "safety",
            "default_interval_value": 1,
            "default_interval_unit": "years",
            "is_system": True,
            "is_active": True,
        },
    ]
    op.bulk_insert(facility_maintenance_types, maint_type_data)


def downgrade() -> None:
    # Remove seeded NFPA maintenance types by name
    names = [
        "Exhaust Extraction System Inspection",
        "Exhaust Extraction Filter Replacement",
        "CO/NO2 Monitor Calibration",
        "Air Quality Sensor Test",
        "Gear Extractor Service",
        "PPE Drying Cabinet Inspection",
        "Decontamination Area Inspection",
        "Biohazard Waste Container Service",
        "Zone Pressure Differential Test",
        "Cascade Air System Inspection",
        "Cascade Air Quality Test",
        "Station Alerting System Test",
        "Shore Power Connection Inspection",
        "Generator Annual Load Test",
        "ADA Accessibility Review",
        "Fire Extinguisher Annual Maintenance",
    ]
    placeholders = ", ".join([f"'{n}'" for n in names])
    op.execute(
        f"DELETE FROM facility_maintenance_types "
        f"WHERE organization_id IS NULL AND is_system = 1 "
        f"AND name IN ({placeholders})"
    )

    # Revert organization_id back to NOT NULL on lookup tables
    op.alter_column(
        "facility_statuses",
        "organization_id",
        existing_type=sa.String(36),
        nullable=False,
    )
    op.alter_column(
        "facility_types",
        "organization_id",
        existing_type=sa.String(36),
        nullable=False,
    )
    op.alter_column(
        "facility_maintenance_types",
        "organization_id",
        existing_type=sa.String(36),
        nullable=False,
    )
