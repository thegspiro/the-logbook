"""Add standing shift claims.

Revision ID: e7a41b6d09c2
Revises: a71c9d4e5b62

A standing shift is a member's recurring claim on a seat — "every Tuesday
night through December". It is stored rather than written once as a batch of
assignments so that giving up a single date leaves the series intact, and so
shifts generated later can still be seated from it.

No backfill: no such claim exists yet, and inferring one from a member's
existing assignments would guess a commitment nobody made.
"""

import sqlalchemy as sa
from alembic import op

revision = "e7a41b6d09c2"
down_revision = "a71c9d4e5b62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "standing_shift_claims",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "pattern",
            sa.Enum("weekly", "biweekly", "monthly", name="standingshiftpattern"),
            nullable=False,
            server_default="weekly",
        ),
        # 0 = Sunday … 6 = Saturday, matching the member-facing weekday picker.
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column(
            "period",
            sa.Enum("day", "night", name="standingshiftperiod"),
            nullable=False,
            server_default="day",
        ),
        sa.Column(
            "position",
            sa.Enum(
                "officer",
                "driver",
                "firefighter",
                "ems",
                "captain",
                "lieutenant",
                "probationary",
                "volunteer",
                "other",
                name="shiftposition",
            ),
            nullable=False,
            server_default="firefighter",
        ),
        # No foreign key: a shift's apparatus_id may name a row in either
        # apparatus table (see app/utils/apparatus_ref.py), so a constraint
        # against one of them would reject ids the shift form itself issues.
        sa.Column("apparatus_id", sa.String(length=36), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_standing_claim_org", "standing_shift_claims", ["organization_id"]
    )
    op.create_index("idx_standing_claim_user", "standing_shift_claims", ["user_id"])
    # The shift-creation reader looks up active claims by org and weekday.
    op.create_index(
        "idx_standing_claim_lookup",
        "standing_shift_claims",
        ["organization_id", "is_active", "weekday"],
    )


def downgrade() -> None:
    op.drop_index("idx_standing_claim_lookup", table_name="standing_shift_claims")
    op.drop_index("idx_standing_claim_user", table_name="standing_shift_claims")
    op.drop_index("idx_standing_claim_org", table_name="standing_shift_claims")
    op.drop_table("standing_shift_claims")
