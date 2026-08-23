"""Make shift/template equipment-check submission atomic and idempotent.

Revision ID: a17c4e9d2b61
Revises: 9bb38ab9b052

Safe duplicate strategy
-----------------------
Keep one canonical row per non-null (shift_id, template_id), preferring a
completed row and then the earliest check.  Historical duplicate rows and
their item snapshots are retained; only their shift_id is detached, and an
explanatory note is appended.  This makes the new rule satisfiable without
deleting safety records or inventing a winner based on migration run order.
"""

import sqlalchemy as sa
from alembic import op

revision = "a17c4e9d2b61"
down_revision = "9bb38ab9b052"
branch_labels = None
depends_on = None

_DEDUP_NOTE = (
    "[Migration: detached from shift because a canonical check already exists "
    "for this shift and template.]"
)


def upgrade() -> None:
    op.add_column(
        "shift_equipment_checks",
        sa.Column("client_submission_id", sa.String(length=100), nullable=True),
    )

    checks = sa.table(
        "shift_equipment_checks",
        sa.column("id", sa.String(36)),
        sa.column("shift_id", sa.String(36)),
        sa.column("template_id", sa.String(36)),
        sa.column("overall_status", sa.String(30)),
        sa.column("checked_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("notes", sa.Text()),
    )
    rows = (
        op.get_bind()
        .execute(
            sa.select(checks).where(
                checks.c.shift_id.is_not(None), checks.c.template_id.is_not(None)
            )
        )
        .mappings()
    )

    grouped = {}
    for row in rows:
        grouped.setdefault((row["shift_id"], row["template_id"]), []).append(row)

    for duplicates in grouped.values():
        if len(duplicates) < 2:
            continue
        duplicates.sort(
            key=lambda row: (
                row["overall_status"] == "incomplete",
                row["checked_at"] is None,
                str(row["checked_at"] or ""),
                row["created_at"] is None,
                str(row["created_at"] or ""),
                row["id"],
            )
        )
        for duplicate in duplicates[1:]:
            old_notes = (duplicate["notes"] or "").rstrip()
            notes = f"{old_notes}\n{_DEDUP_NOTE}" if old_notes else _DEDUP_NOTE
            op.get_bind().execute(
                checks.update()
                .where(checks.c.id == duplicate["id"])
                .values(shift_id=None, notes=notes)
            )

    op.create_unique_constraint(
        "uq_shift_equipment_check_shift_template",
        "shift_equipment_checks",
        ["shift_id", "template_id"],
    )
    op.create_unique_constraint(
        "uq_shift_equipment_check_client_submission",
        "shift_equipment_checks",
        ["organization_id", "client_submission_id"],
    )


def downgrade() -> None:
    # Detached historical duplicates cannot safely be re-associated: a later
    # check may now own the same slot. Their item snapshots and migration note
    # remain intact.
    op.drop_constraint(
        "uq_shift_equipment_check_client_submission",
        "shift_equipment_checks",
        type_="unique",
    )
    op.drop_constraint(
        "uq_shift_equipment_check_shift_template",
        "shift_equipment_checks",
        type_="unique",
    )
    op.drop_column("shift_equipment_checks", "client_submission_id")
