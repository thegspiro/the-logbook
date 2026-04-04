"""Add composite indexes to shift_equipment_checks

Adds indexes for common query patterns: compliance reports
(org+checked_at), duplicate detection (shift+template),
and timing-specific queries (shift+check_timing).

Revision ID: 20260404_0400
Revises: 20260404_0300
Create Date: 2026-04-04
"""

from alembic import op


revision = "20260404_0400"
down_revision = "20260404_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_shift_equip_check_org_date",
        "shift_equipment_checks",
        ["organization_id", "checked_at"],
    )
    op.create_index(
        "idx_shift_equip_check_shift_tmpl",
        "shift_equipment_checks",
        ["shift_id", "template_id"],
    )
    op.create_index(
        "idx_shift_equip_check_shift_timing",
        "shift_equipment_checks",
        ["shift_id", "check_timing"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_shift_equip_check_shift_timing",
        table_name="shift_equipment_checks",
    )
    op.drop_index(
        "idx_shift_equip_check_shift_tmpl",
        table_name="shift_equipment_checks",
    )
    op.drop_index(
        "idx_shift_equip_check_org_date",
        table_name="shift_equipment_checks",
    )
