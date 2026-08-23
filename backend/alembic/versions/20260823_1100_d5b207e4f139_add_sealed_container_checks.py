"""Add sealed-container support to equipment checks.

Revision ID: d5b207e4f139
Revises: c3e91a7f4d28

A container closed with a numbered tamper seal — a drug bag, a trauma kit —
can have its contents count cleared by the seal rather than counted by hand.
Two pieces: the template flag that says a compartment carries a seal, and the
per-check record of the number the crew read.

No backfill. Every existing compartment stays unsealed, which is the behaviour
every department has today; the shortcut only appears once someone marks a
container as sealed.
"""

import sqlalchemy as sa
from alembic import op

revision = "d5b207e4f139"
down_revision = "c3e91a7f4d28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "check_template_compartments",
        sa.Column(
            "is_sealed",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
    )

    op.create_table(
        "shift_equipment_check_seals",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "check_id",
            sa.String(length=36),
            sa.ForeignKey("shift_equipment_checks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_compartment_id",
            sa.String(length=36),
            sa.ForeignKey("check_template_compartments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("compartment_name", sa.Text(), nullable=False),
        sa.Column("seal_number", sa.String(length=100), nullable=True),
        sa.Column("intact", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column(
            "cleared_item_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    op.create_index(
        "idx_shift_equip_check_seal_check",
        "shift_equipment_check_seals",
        ["check_id"],
    )
    op.create_index(
        "idx_shift_equip_check_seal_compartment",
        "shift_equipment_check_seals",
        ["template_compartment_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_shift_equip_check_seal_compartment",
        table_name="shift_equipment_check_seals",
    )
    op.drop_index(
        "idx_shift_equip_check_seal_check", table_name="shift_equipment_check_seals"
    )
    op.drop_table("shift_equipment_check_seals")
    op.drop_column("check_template_compartments", "is_sealed")
