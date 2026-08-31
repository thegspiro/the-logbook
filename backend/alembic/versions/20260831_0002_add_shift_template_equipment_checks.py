"""Add shift_template_equipment_checks

Lets a shift template name the equipment checklists its shifts carry, instead
of every shift resolving them from its apparatus alone.

Presence is meaningful, and that is the whole design: a template with no rows
here keeps resolving by apparatus id and then apparatus type, exactly as every
shift does today, so this table changes nothing until an officer uses it. A
template with rows carries those checklists and only those.

Deliberately thin — the two sides, the org, and an order. Timing
(start/end of shift) and position eligibility stay on
``equipment_check_templates``, where they are edited and where every other
reader already looks.

No table guard is needed: this migration creates the table, and both tables it
references (``shift_templates`` from 20260214_2200, ``equipment_check_templates``
from 20260307_0200) are migration-created too, so the foreign keys resolve on a
fresh ``alembic upgrade head`` against an empty database.

Revision ID: 20260831_0002
Revises: 20260831_0001
Create Date: 2026-08-31 00:02:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260831_0002"
down_revision = "20260831_0001"
branch_labels = None
depends_on = None

_TABLE = "shift_template_equipment_checks"


def upgrade() -> None:
    if _TABLE in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "shift_template_id",
            sa.String(36),
            sa.ForeignKey("shift_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "equipment_check_template_id",
            sa.String(36),
            sa.ForeignKey("equipment_check_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    op.create_index(
        "idx_stec_org_template", _TABLE, ["organization_id", "shift_template_id"]
    )
    # One checklist cannot be on the same template twice: the pair is the
    # identity of the link, and a duplicate would show the crew the same
    # checklist twice on one shift.
    op.create_unique_constraint(
        "uq_stec_template_pair",
        _TABLE,
        ["shift_template_id", "equipment_check_template_id"],
    )


def downgrade() -> None:
    if _TABLE not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.drop_table(_TABLE)
