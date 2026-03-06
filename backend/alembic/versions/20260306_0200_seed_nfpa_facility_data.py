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
