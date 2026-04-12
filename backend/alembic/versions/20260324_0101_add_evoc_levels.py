"""Add EVOC levels table and EVOC fields to apparatus/operators

Creates the evoc_levels table for organization-configurable EVOC
(Emergency Vehicle Operator Course) certification levels, and adds
required_evoc_level_id to apparatus and evoc_level_id to
apparatus_operators to bridge training, apparatus, and scheduling.

Revision ID: 20260324_0101
Revises: 20260321_0300
Create Date: 2026-03-24 01:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "20260324_0101"
down_revision = "20260323_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evoc_levels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("level_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_cumulative",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column(
            "training_program_id",
            sa.String(36),
            sa.ForeignKey("training_programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
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
        ),
    )

    op.create_index(
        "idx_evoc_levels_org_level",
        "evoc_levels",
        ["organization_id", "level_number"],
        unique=True,
    )
    op.create_index(
        "idx_evoc_levels_org_code",
        "evoc_levels",
        ["organization_id", "code"],
        unique=True,
    )
    op.create_index("idx_evoc_levels_active", "evoc_levels", ["is_active"])

    op.add_column(
        "apparatus",
        sa.Column(
            "required_evoc_level_id",
            sa.String(36),
            sa.ForeignKey("evoc_levels.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.add_column(
        "apparatus_operators",
        sa.Column(
            "evoc_level_id",
            sa.String(36),
            sa.ForeignKey("evoc_levels.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_apparatus_operators_evoc",
        "apparatus_operators",
        ["evoc_level_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_apparatus_operators_evoc", table_name="apparatus_operators")
    op.drop_column("apparatus_operators", "evoc_level_id")
    op.drop_column("apparatus", "required_evoc_level_id")
    op.drop_index("idx_evoc_levels_active", table_name="evoc_levels")
    op.drop_index("idx_evoc_levels_org_code", table_name="evoc_levels")
    op.drop_index("idx_evoc_levels_org_level", table_name="evoc_levels")
    op.drop_table("evoc_levels")
