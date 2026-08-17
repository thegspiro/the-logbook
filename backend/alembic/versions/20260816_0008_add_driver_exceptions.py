"""Add driver qualification exceptions

Revision ID: 20260816_0008
Revises: 20260816_0006, 20260816_0007
Create Date: 2026-08-16

Creates the ``driver_exceptions`` table backing chief-approved, time-boxed
waivers of the EVOC driving requirement (parades, special events, non-emergency
transport). EVOC enforcement is a hard block; this table is the sanctioned way
around it, and every approval is attributable and bounded.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260816_0008"
# A merge point, not a single parent. main forked at 0005: the legacy
# shift-finalization backfill (0006) and the email-preference unification
# (0007) both chain off it, leaving two heads. Whichever this branch had
# chained to, the other would have been skipped on deploy — the startup
# runner upgrades to a single head it picks by sort order, and that head is
# now this migration. Depending on both makes it the join and applies both.
down_revision = ("20260816_0006", "20260816_0007")
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "driver_exceptions" in inspector.get_table_names():
        return

    op.create_table(
        "driver_exceptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Nullable: NULL means "any apparatus". CASCADE rather than SET NULL —
        # SET NULL would turn a deleted unit's exception into one that matches
        # every apparatus, widening a safety grant as a side effect of fleet
        # housekeeping. The audit log retains the approval independently.
        sa.Column(
            "apparatus_id",
            sa.String(36),
            sa.ForeignKey("apparatus.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "reason",
            sa.Enum(
                "parade",
                "special_event",
                "non_emergency_transport",
                "mutual_aid",
                "other",
                name="driverexceptionreason",
            ),
            nullable=False,
            server_default="parade",
        ),
        sa.Column("justification", sa.Text(), nullable=False),
        sa.Column("restrictions", sa.Text(), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "approved",
                "denied",
                "revoked",
                name="driverexceptionstatus",
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "requested_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "reviewed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_notes", sa.Text(), nullable=True),
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
        sa.CheckConstraint(
            "valid_until >= valid_from", name="ck_driver_exception_date_order"
        ),
    )

    op.create_index(
        "idx_driver_exceptions_org", "driver_exceptions", ["organization_id"]
    )
    op.create_index("idx_driver_exceptions_status", "driver_exceptions", ["status"])
    op.create_index(
        "idx_driver_exceptions_lookup",
        "driver_exceptions",
        ["organization_id", "user_id", "status"],
    )
    op.create_index(
        "idx_driver_exceptions_validity",
        "driver_exceptions",
        ["valid_from", "valid_until"],
    )


def downgrade() -> None:
    op.drop_table("driver_exceptions")
