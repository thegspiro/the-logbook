"""create compliance config tables

Revision ID: 20260313_0100
Revises: 20260308_0300
Create Date: 2026-03-13 01:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260313_0100"
down_revision = "20260308_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- compliance_configs --
    op.create_table(
        "compliance_configs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        # Thresholds
        sa.Column(
            "threshold_type",
            sa.String(30),
            nullable=False,
            server_default="percentage",
        ),
        sa.Column(
            "compliant_threshold",
            sa.Float,
            nullable=False,
            server_default="100.0",
        ),
        sa.Column(
            "at_risk_threshold",
            sa.Float,
            nullable=False,
            server_default="75.0",
        ),
        # Grace period
        sa.Column(
            "grace_period_days",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
        # Report scheduling
        sa.Column(
            "auto_report_frequency",
            sa.String(20),
            nullable=False,
            server_default="none",
        ),
        sa.Column("report_email_recipients", sa.JSON, nullable=True),
        sa.Column(
            "report_day_of_month",
            sa.Integer,
            nullable=True,
            server_default="1",
        ),
        # Notifications
        sa.Column(
            "notify_non_compliant_members",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("notify_days_before_deadline", sa.JSON, nullable=True),
        # Metadata
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # -- compliance_profiles --
    op.create_table(
        "compliance_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "config_id",
            sa.String(36),
            sa.ForeignKey("compliance_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        # Applicability
        sa.Column("membership_types", sa.JSON, nullable=True),
        sa.Column("role_ids", sa.JSON, nullable=True),
        # Threshold overrides
        sa.Column("compliant_threshold_override", sa.Float, nullable=True),
        sa.Column("at_risk_threshold_override", sa.Float, nullable=True),
        # Requirement IDs
        sa.Column("required_requirement_ids", sa.JSON, nullable=True),
        sa.Column("optional_requirement_ids", sa.JSON, nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "priority",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
        # Metadata
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_compliance_profiles_config",
        "compliance_profiles",
        ["config_id"],
    )

    # -- compliance_reports --
    op.create_table(
        "compliance_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("report_type", sa.String(20), nullable=False),
        sa.Column("period_label", sa.String(50), nullable=False),
        sa.Column("period_year", sa.Integer, nullable=False),
        sa.Column("period_month", sa.Integer, nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("report_data", sa.JSON, nullable=True),
        sa.Column("summary", sa.JSON, nullable=True),
        sa.Column("emailed_to", sa.JSON, nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "generated_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("generation_duration_ms", sa.Integer, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )
    op.create_index(
        "idx_compliance_reports_org_period",
        "compliance_reports",
        ["organization_id", "period_year", "period_month"],
    )
    op.create_index(
        "idx_compliance_reports_status",
        "compliance_reports",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_compliance_reports_status", table_name="compliance_reports")
    op.drop_index(
        "idx_compliance_reports_org_period", table_name="compliance_reports"
    )
    op.drop_table("compliance_reports")
    op.drop_index(
        "idx_compliance_profiles_config", table_name="compliance_profiles"
    )
    op.drop_table("compliance_profiles")
    op.drop_table("compliance_configs")
