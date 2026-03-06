"""Add NFPA compliance fields to facilities module

Revision ID: 20260306_0100
Revises: 20260305_0200
Create Date: 2026-03-06

Adds fire-service-critical system types, certification/testing fields
to facility systems, inspector fields to inspections, and zone
classification to rooms per NFPA 1500/1581/1585/1851 standards.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260306_0100"
down_revision = "20260305_0200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Extend facility_system_type enum with fire-critical types
    # ------------------------------------------------------------------
    # MySQL requires ALTER TABLE ... MODIFY COLUMN to change ENUM values
    op.alter_column(
        "facility_systems",
        "system_type",
        existing_type=sa.Enum(
            "hvac",
            "electrical",
            "plumbing",
            "fire_suppression",
            "fire_alarm",
            "security",
            "roofing",
            "structural",
            "elevator",
            "generator",
            "communications",
            "doors_windows",
            "flooring",
            "painting",
            "landscaping",
            "parking",
            "other",
            name="facilitysystemtype",
        ),
        type_=sa.Enum(
            "hvac",
            "electrical",
            "plumbing",
            "fire_suppression",
            "fire_alarm",
            "security",
            "roofing",
            "structural",
            "elevator",
            "generator",
            "communications",
            "doors_windows",
            "flooring",
            "painting",
            "landscaping",
            "parking",
            "exhaust_extraction",
            "cascade_air",
            "decontamination",
            "bay_door",
            "air_quality_monitor",
            "ppe_cleaning",
            "alerting_system",
            "shore_power",
            "other",
            name="facilitysystemtype",
        ),
        existing_nullable=False,
    )

    # ------------------------------------------------------------------
    # 2. Add certification/testing columns to facility_systems
    # ------------------------------------------------------------------
    op.add_column(
        "facility_systems",
        sa.Column("last_tested_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "facility_systems",
        sa.Column("next_test_due", sa.Date(), nullable=True),
    )
    op.add_column(
        "facility_systems",
        sa.Column("test_result", sa.String(50), nullable=True),
    )
    op.add_column(
        "facility_systems",
        sa.Column("certification_number", sa.String(100), nullable=True),
    )
    op.add_column(
        "facility_systems",
        sa.Column("certified_by", sa.String(200), nullable=True),
    )
    op.add_column(
        "facility_systems",
        sa.Column("test_frequency_days", sa.Integer(), nullable=True),
    )

    # ------------------------------------------------------------------
    # 3. Add inspector fields to facility_inspections
    # ------------------------------------------------------------------
    op.add_column(
        "facility_inspections",
        sa.Column("inspector_license_number", sa.String(100), nullable=True),
    )
    op.add_column(
        "facility_inspections",
        sa.Column("inspector_agency", sa.String(200), nullable=True),
    )
    op.add_column(
        "facility_inspections",
        sa.Column("corrective_action_completed_date", sa.Date(), nullable=True),
    )

    # ------------------------------------------------------------------
    # 4. Add zone_classification to facility_rooms
    # ------------------------------------------------------------------
    op.add_column(
        "facility_rooms",
        sa.Column(
            "zone_classification",
            sa.Enum(
                "hot",
                "transition",
                "cold",
                "unclassified",
                name="zoneclassification",
            ),
            nullable=False,
            server_default="unclassified",
        ),
    )


def downgrade() -> None:
    # Remove zone_classification from facility_rooms
    op.drop_column("facility_rooms", "zone_classification")

    # Remove inspector fields from facility_inspections
    op.drop_column("facility_inspections", "corrective_action_completed_date")
    op.drop_column("facility_inspections", "inspector_agency")
    op.drop_column("facility_inspections", "inspector_license_number")

    # Remove certification/testing columns from facility_systems
    op.drop_column("facility_systems", "test_frequency_days")
    op.drop_column("facility_systems", "certified_by")
    op.drop_column("facility_systems", "certification_number")
    op.drop_column("facility_systems", "test_result")
    op.drop_column("facility_systems", "next_test_due")
    op.drop_column("facility_systems", "last_tested_date")

    # Revert facility_system_type enum
    op.alter_column(
        "facility_systems",
        "system_type",
        existing_type=sa.Enum(
            "hvac",
            "electrical",
            "plumbing",
            "fire_suppression",
            "fire_alarm",
            "security",
            "roofing",
            "structural",
            "elevator",
            "generator",
            "communications",
            "doors_windows",
            "flooring",
            "painting",
            "landscaping",
            "parking",
            "exhaust_extraction",
            "cascade_air",
            "decontamination",
            "bay_door",
            "air_quality_monitor",
            "ppe_cleaning",
            "alerting_system",
            "shore_power",
            "other",
            name="facilitysystemtype",
        ),
        type_=sa.Enum(
            "hvac",
            "electrical",
            "plumbing",
            "fire_suppression",
            "fire_alarm",
            "security",
            "roofing",
            "structural",
            "elevator",
            "generator",
            "communications",
            "doors_windows",
            "flooring",
            "painting",
            "landscaping",
            "parking",
            "other",
            name="facilitysystemtype",
        ),
        existing_nullable=False,
    )
