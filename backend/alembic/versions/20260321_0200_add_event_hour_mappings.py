"""Add event hour mappings and extend admin hours entries

Adds the event_hour_mappings table for configuring how event attendance
hours are credited to admin hours categories, and extends admin_hours_entries
with source event/RSVP references and the EVENT_ATTENDANCE entry method.

Revision ID: 20260321_0200
Revises: 20260321_0100
Create Date: 2026-03-21 02:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260321_0200"
down_revision = "20260321_0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Create event_hour_mappings table --
    op.create_table(
        "event_hour_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(50), nullable=True),
        sa.Column("custom_category", sa.String(100), nullable=True),
        sa.Column(
            "admin_hours_category_id",
            sa.String(36),
            sa.ForeignKey("admin_hours_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("percentage", sa.Integer(), nullable=False, server_default="100"),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")
        ),
        sa.Column(
            "created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "percentage >= 1 AND percentage <= 100",
            name="ck_event_hour_mappings_percentage_range",
        ),
        sa.CheckConstraint(
            "(event_type IS NOT NULL AND custom_category IS NULL) OR "
            "(event_type IS NULL AND custom_category IS NOT NULL)",
            name="ck_event_hour_mappings_one_source",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "event_type",
            "custom_category",
            "admin_hours_category_id",
            name="uq_event_hour_mappings_source_target",
        ),
    )
    op.create_index(
        "ix_event_hour_mappings_org_id",
        "event_hour_mappings",
        ["organization_id"],
    )
    op.create_index(
        "ix_event_hour_mappings_org_event_type",
        "event_hour_mappings",
        ["organization_id", "event_type"],
    )

    # -- Extend admin_hours_entries entry_method enum --
    # MySQL requires ALTER COLUMN to change enum values
    op.alter_column(
        "admin_hours_entries",
        "entry_method",
        type_=sa.Enum("qr_scan", "manual", "event_attendance", name="adminhoursentrymethod"),
        existing_type=sa.Enum("qr_scan", "manual", name="adminhoursentrymethod"),
        existing_nullable=False,
    )

    # -- Add source event/RSVP columns to admin_hours_entries --
    op.add_column(
        "admin_hours_entries",
        sa.Column(
            "source_event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "admin_hours_entries",
        sa.Column(
            "source_rsvp_id",
            sa.String(36),
            sa.ForeignKey("event_rsvps.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_admin_hours_entries_source_rsvp",
        "admin_hours_entries",
        ["source_rsvp_id", "category_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_admin_hours_entries_source_rsvp", table_name="admin_hours_entries"
    )
    op.drop_column("admin_hours_entries", "source_rsvp_id")
    op.drop_column("admin_hours_entries", "source_event_id")

    op.alter_column(
        "admin_hours_entries",
        "entry_method",
        type_=sa.Enum("qr_scan", "manual", name="adminhoursentrymethod"),
        existing_type=sa.Enum(
            "qr_scan", "manual", "event_attendance", name="adminhoursentrymethod"
        ),
        existing_nullable=False,
    )

    op.drop_index("ix_event_hour_mappings_org_event_type", table_name="event_hour_mappings")
    op.drop_index("ix_event_hour_mappings_org_id", table_name="event_hour_mappings")
    op.drop_table("event_hour_mappings")
