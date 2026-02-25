"""Add NFPA 1851/1852 compliance tracking tables and category flag

Revision ID: 20260225_0100
Revises: 20260224_0100
Create Date: 2026-02-25

Adds:
- nfpa_tracking_enabled column to inventory_categories
- nfpa_item_compliance table (lifecycle dates, ensemble, SCBA fields)
- nfpa_inspection_details table (structured pass/fail per NFPA 1851 Ch. 6-8)
- nfpa_exposure_records table (hazardous exposure tracking per NFPA 1851 §6.2)
- New maintenance_type enum values for NFPA inspection levels
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260225_0100"
down_revision = "20260224_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Add nfpa_tracking_enabled to inventory_categories ---
    op.add_column(
        "inventory_categories",
        sa.Column(
            "nfpa_tracking_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )

    # --- Add new NFPA maintenance_type enum values ---
    # MySQL requires ALTER TABLE MODIFY COLUMN to extend an ENUM
    op.execute(
        "ALTER TABLE maintenance_records MODIFY COLUMN maintenance_type "
        "ENUM('inspection','repair','cleaning','testing','calibration',"
        "'replacement','preventive','routine_inspection','advanced_inspection',"
        "'independent_inspection','advanced_cleaning','decontamination') NOT NULL"
    )

    # --- Create nfpa_item_compliance table ---
    op.create_table(
        "nfpa_item_compliance",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Lifecycle dates
        sa.Column("manufacture_date", sa.Date(), nullable=True),
        sa.Column("first_in_service_date", sa.Date(), nullable=True),
        sa.Column("expected_retirement_date", sa.Date(), nullable=True),
        sa.Column("retirement_reason", sa.String(255), nullable=True),
        sa.Column(
            "is_retired_by_age", sa.Boolean(), nullable=False, server_default="0"
        ),
        # Ensemble
        sa.Column("ensemble_id", sa.String(36), nullable=True),
        sa.Column("ensemble_role", sa.String(50), nullable=True),
        # SCBA
        sa.Column("cylinder_manufacture_date", sa.Date(), nullable=True),
        sa.Column("cylinder_expiration_date", sa.Date(), nullable=True),
        sa.Column("hydrostatic_test_date", sa.Date(), nullable=True),
        sa.Column("hydrostatic_test_due", sa.Date(), nullable=True),
        sa.Column("flow_test_date", sa.Date(), nullable=True),
        sa.Column("flow_test_due", sa.Date(), nullable=True),
        # Contamination
        sa.Column(
            "contamination_level",
            sa.Enum(
                "none", "light", "moderate", "heavy", "gross",
                name="contaminationlevel",
            ),
            server_default="none",
        ),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id")),
    )
    op.create_index(
        "idx_nfpa_compliance_org", "nfpa_item_compliance", ["organization_id"]
    )
    op.create_index(
        "idx_nfpa_compliance_ensemble",
        "nfpa_item_compliance",
        ["organization_id", "ensemble_id"],
    )
    op.create_index(
        "idx_nfpa_compliance_retirement",
        "nfpa_item_compliance",
        ["organization_id", "expected_retirement_date"],
    )

    # --- Create nfpa_inspection_details table ---
    op.create_table(
        "nfpa_inspection_details",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "maintenance_record_id",
            sa.String(36),
            sa.ForeignKey("maintenance_records.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Inspection level
        sa.Column(
            "inspection_level",
            sa.Enum("routine", "advanced", "independent", name="nfpainspectionlevel"),
            nullable=False,
        ),
        # Pass/fail assessments
        sa.Column("thermal_damage", sa.Boolean(), nullable=True),
        sa.Column("moisture_barrier", sa.Boolean(), nullable=True),
        sa.Column("seam_integrity", sa.Boolean(), nullable=True),
        sa.Column("reflective_trim", sa.Boolean(), nullable=True),
        sa.Column("closure_systems", sa.Boolean(), nullable=True),
        sa.Column("liner_integrity", sa.Boolean(), nullable=True),
        # Contamination
        sa.Column(
            "contamination_level",
            sa.Enum(
                "none", "light", "moderate", "heavy", "gross",
                name="contaminationlevel",
                create_type=False,
            ),
            nullable=True,
        ),
        # SCBA
        sa.Column("facepiece_seal", sa.Boolean(), nullable=True),
        sa.Column("regulator_function", sa.Boolean(), nullable=True),
        sa.Column("cylinder_pressure", sa.Float(), nullable=True),
        sa.Column("low_air_alarm", sa.Boolean(), nullable=True),
        # Recommendation
        sa.Column("recommendation", sa.String(50), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_nfpa_inspection_org_level",
        "nfpa_inspection_details",
        ["organization_id", "inspection_level"],
    )

    # --- Create nfpa_exposure_records table ---
    op.create_table(
        "nfpa_exposure_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Exposure details
        sa.Column(
            "exposure_type",
            sa.Enum(
                "structure_fire",
                "vehicle_fire",
                "wildland_fire",
                "hazmat",
                "bloodborne_pathogen",
                "chemical",
                "smoke",
                "other",
                name="exposuretype",
            ),
            nullable=False,
        ),
        sa.Column("exposure_date", sa.Date(), nullable=False),
        sa.Column("incident_number", sa.String(100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        # Decontamination
        sa.Column(
            "decon_required", sa.Boolean(), nullable=False, server_default="0"
        ),
        sa.Column(
            "decon_completed", sa.Boolean(), nullable=False, server_default="0"
        ),
        sa.Column("decon_completed_date", sa.Date(), nullable=True),
        sa.Column("decon_method", sa.String(255), nullable=True),
        # User
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id")),
    )
    op.create_index(
        "idx_nfpa_exposure_org_item",
        "nfpa_exposure_records",
        ["organization_id", "item_id"],
    )
    op.create_index(
        "idx_nfpa_exposure_org_date",
        "nfpa_exposure_records",
        ["organization_id", "exposure_date"],
    )


def downgrade() -> None:
    op.drop_table("nfpa_exposure_records")
    op.drop_table("nfpa_inspection_details")
    op.drop_table("nfpa_item_compliance")

    # Revert maintenance_type enum
    op.execute(
        "ALTER TABLE maintenance_records MODIFY COLUMN maintenance_type "
        "ENUM('inspection','repair','cleaning','testing','calibration',"
        "'replacement','preventive') NOT NULL"
    )

    op.drop_column("inventory_categories", "nfpa_tracking_enabled")
