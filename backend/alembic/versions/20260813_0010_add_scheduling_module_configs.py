"""Add scheduling_module_configs table

Department-wide scheduling defaults (position names, apparatus-type crew
defaults, equipment-check rules) previously persisted only to each admin's
browser localStorage, so every admin had a private copy and a new browser
saw factory defaults. This table gives them one org-scoped home, mirroring
training_module_configs (one row per organization).

Revision ID: 20260813_0010
Revises: 20260813_0009
Create Date: 2026-08-13 00:03:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260813_0010"
down_revision = "20260813_0009"
branch_labels = None
depends_on = None

_TABLE = "scheduling_module_configs"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE in inspector.get_table_names():
        # Fresh installs materialize the table from the model via create_all
        # before this migration replays.
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("default_duration_hours", sa.Float(), nullable=True),
        sa.Column("default_min_staffing", sa.Integer(), nullable=True),
        sa.Column("require_assignment_confirmation", sa.Boolean(), nullable=True),
        sa.Column("overtime_threshold_hours_per_week", sa.Float(), nullable=True),
        sa.Column("enabled_positions", sa.JSON(), nullable=True),
        sa.Column("custom_positions", sa.JSON(), nullable=True),
        sa.Column("apparatus_type_defaults", sa.JSON(), nullable=True),
        sa.Column("resource_type_defaults", sa.JSON(), nullable=True),
        sa.Column("equipment_check_settings", sa.JSON(), nullable=True),
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
        sa.Column(
            "updated_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE in inspector.get_table_names():
        op.drop_table(_TABLE)
