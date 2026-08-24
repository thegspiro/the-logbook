"""Add attendance finalization state to events.

Revision ID: c3f8a29d54e1
Revises: e7a41b6d09c2

Finalizing attendance used to be a recalculation with no state behind it: the
only trace it left was ``custom_fields["attendance_finalized"]``, read by
exactly one consumer (the post-event validation reminder task) and by no
mutation at all. Every attendance write stayed open afterwards, so a corrected
duration silently diverged from the admin-hours entry already credited from
the finalized value.

These columns make it a state transition. ``attendance_finalized_at`` is the
lock the service layer checks; ``attendance_finalized_by`` records who closed
it. The legacy JSON marker keeps being written alongside them so the reminder
task is unaffected.

Backfill: events already carrying the JSON marker are stamped with their
effective end time, since that is the only defensible timestamp available —
the marker never recorded when finalization ran, nor who ran it, so
``attendance_finalized_by`` stays NULL for those rows and the UI shows them as
finalized by nobody in particular. Without the backfill every historically
finalized event would come back unlocked.

The downgrade drops both columns. It is lossy in one direction only: the JSON
marker survives, so re-upgrading recovers the lock (again at the effective end
time), but a real finalization timestamp and actor recorded after this
migration cannot be recovered.
"""

import sqlalchemy as sa
from alembic import op

revision = "c3f8a29d54e1"
down_revision = "e7a41b6d09c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("events"):
        return

    columns = {c["name"] for c in inspector.get_columns("events")}

    if "attendance_finalized_at" not in columns:
        op.add_column(
            "events",
            sa.Column(
                "attendance_finalized_at", sa.DateTime(timezone=True), nullable=True
            ),
        )
    if "attendance_finalized_by" not in columns:
        op.add_column(
            "events",
            sa.Column("attendance_finalized_by", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_events_attendance_finalized_by_users",
            "events",
            "users",
            ["attendance_finalized_by"],
            ["id"],
            ondelete="SET NULL",
        )

    # JSON_EXTRACT is MySQL-specific and this project targets MySQL 8 only.
    # A different dialect keeps the columns and skips the backfill rather than
    # failing the upgrade.
    if bind.dialect.name != "mysql":
        return

    op.execute(sa.text("""
            UPDATE events
               SET attendance_finalized_at = COALESCE(actual_end_time, end_datetime)
             WHERE attendance_finalized_at IS NULL
               AND custom_fields IS NOT NULL
               AND JSON_UNQUOTE(
                       JSON_EXTRACT(custom_fields, '$.attendance_finalized')
                   ) IN ('true', '1')
            """))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("events"):
        return

    columns = {c["name"] for c in inspector.get_columns("events")}

    if "attendance_finalized_by" in columns:
        fks = {
            fk["name"] for fk in inspector.get_foreign_keys("events") if fk.get("name")
        }
        if "fk_events_attendance_finalized_by_users" in fks:
            op.drop_constraint(
                "fk_events_attendance_finalized_by_users", "events", type_="foreignkey"
            )
        op.drop_column("events", "attendance_finalized_by")

    if "attendance_finalized_at" in columns:
        op.drop_column("events", "attendance_finalized_at")
