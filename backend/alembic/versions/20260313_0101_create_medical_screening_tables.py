"""create medical screening tables

Revision ID: 20260313_0101
Revises: 20260308_0300
Create Date: 2026-03-13 01:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260313_0101"
down_revision = "20260313_0100"
branch_labels = None
depends_on = None

SCREENING_TYPE_ENUM = sa.Enum(
    "physical_exam",
    "medical_clearance",
    "drug_screening",
    "vision_hearing",
    "fitness_assessment",
    "psychological",
    name="screening_type_enum",
)

SCREENING_STATUS_ENUM = sa.Enum(
    "scheduled",
    "completed",
    "passed",
    "failed",
    "pending_review",
    "waived",
    "expired",
    name="screening_status_enum",
)


def upgrade() -> None:
    op.create_table(
        "screening_requirements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("screening_type", SCREENING_TYPE_ENUM, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "frequency_months",
            sa.Integer,
            nullable=True,
            comment="Recurrence in months (e.g. 12 for annual). NULL = one-time.",
        ),
        sa.Column(
            "applies_to_roles",
            sa.JSON,
            nullable=True,
            comment="JSON list of role names this requirement applies to.",
        ),
        sa.Column(
            "is_active", sa.Boolean, nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "grace_period_days",
            sa.Integer,
            nullable=False,
            server_default=sa.text("30"),
            comment="Days past due before flagging non-compliant.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_screening_req_org", "screening_requirements", ["organization_id"]
    )
    op.create_index(
        "idx_screening_req_org_type",
        "screening_requirements",
        ["organization_id", "screening_type"],
    )

    op.create_table(
        "screening_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("screening_requirements.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            comment="For active members. NULL if this is for a prospect.",
        ),
        sa.Column(
            "prospect_id",
            sa.String(36),
            sa.ForeignKey("prospective_members.id", ondelete="CASCADE"),
            nullable=True,
            comment="For prospective members. NULL if for an active member.",
        ),
        sa.Column("screening_type", SCREENING_TYPE_ENUM, nullable=False),
        sa.Column(
            "status",
            SCREENING_STATUS_ENUM,
            nullable=False,
            server_default="scheduled",
        ),
        sa.Column("scheduled_date", sa.Date, nullable=True),
        sa.Column("completed_date", sa.Date, nullable=True),
        sa.Column("expiration_date", sa.Date, nullable=True),
        sa.Column("provider_name", sa.String(255), nullable=True),
        sa.Column("result_summary", sa.Text, nullable=True),
        sa.Column(
            "result_data",
            sa.JSON,
            nullable=True,
            comment="Structured results (scores, measurements, etc.).",
        ),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_screening_rec_org", "screening_records", ["organization_id"]
    )
    op.create_index(
        "idx_screening_rec_user", "screening_records", ["user_id"]
    )
    op.create_index(
        "idx_screening_rec_prospect", "screening_records", ["prospect_id"]
    )
    op.create_index(
        "idx_screening_rec_status",
        "screening_records",
        ["organization_id", "status"],
    )
    op.create_index(
        "idx_screening_rec_expiration",
        "screening_records",
        ["organization_id", "expiration_date"],
    )


def downgrade() -> None:
    op.drop_table("screening_records")
    op.drop_table("screening_requirements")
    SCREENING_STATUS_ENUM.drop(op.get_bind(), checkfirst=True)
    SCREENING_TYPE_ENUM.drop(op.get_bind(), checkfirst=True)
