"""Add cross-module foreign keys and event_external_attendees table

Revision ID: 20260218_0400
Revises: 20260218_0200
Create Date: 2026-02-18

Adds missing cross-module relationships:
- meetings.event_id FK → events.id (bridge event check-in to meeting attendance)
- meetings.location_id FK → locations.id (structured location reference)
- meeting_minutes.meeting_id FK → meetings.id (link minutes to meeting records)
- training_sessions.instructor_id FK → users.id (proper instructor tracking)
- training_sessions.apparatus_id FK → apparatus.id (apparatus used in training)
- training_sessions.co_instructors JSON (additional instructor IDs)
- training_records.apparatus_id FK → apparatus.id (apparatus trained on)
- skill_checkoffs.session_id FK → training_sessions.id (training context)
- skill_checkoffs.apparatus_id FK → apparatus.id (apparatus used in eval)
- skill_checkoffs.conditions JSON (environmental conditions during eval)

Creates new table:
- event_external_attendees: tracks non-member attendees at public events

Extends enums:
- form_integrations.target_module: adds 'events'
- form_integrations.integration_type: adds 'event_registration'
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260218_0400'
down_revision = '20260218_0200'
branch_labels = None
depends_on = None


def _column_exists(conn, table, column):
    """Check if a column exists in a table (MySQL)."""
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.scalar() > 0


def _table_exists(conn, table):
    """Check if a table exists (MySQL)."""
    result = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = :table"
        ),
        {"table": table},
    )
    return result.scalar() > 0


def upgrade() -> None:
    conn = op.get_bind()

    # ── meetings.event_id FK → events.id ──
    if _table_exists(conn, "meetings") and not _column_exists(conn, "meetings", "event_id"):
        op.add_column("meetings", sa.Column("event_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_meetings_event_id", "meetings", "events",
            ["event_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_meetings_event_id", "meetings", ["event_id"])

    # ── meetings.location_id FK → locations.id ──
    if _table_exists(conn, "meetings") and not _column_exists(conn, "meetings", "location_id"):
        op.add_column("meetings", sa.Column("location_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_meetings_location_id", "meetings", "locations",
            ["location_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_meetings_location_id", "meetings", ["location_id"])

    # ── meeting_minutes.meeting_id FK → meetings.id ──
    if _table_exists(conn, "meeting_minutes") and not _column_exists(conn, "meeting_minutes", "meeting_id"):
        op.add_column("meeting_minutes", sa.Column("meeting_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_meeting_minutes_meeting_id", "meeting_minutes", "meetings",
            ["meeting_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_meeting_minutes_meeting_id", "meeting_minutes", ["meeting_id"])

    # ── training_sessions.instructor_id FK → users.id ──
    if _table_exists(conn, "training_sessions") and not _column_exists(conn, "training_sessions", "instructor_id"):
        op.add_column("training_sessions", sa.Column("instructor_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_training_sessions_instructor_id", "training_sessions", "users",
            ["instructor_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_training_sessions_instructor_id", "training_sessions", ["instructor_id"])

    # ── training_sessions.co_instructors JSON ──
    if _table_exists(conn, "training_sessions") and not _column_exists(conn, "training_sessions", "co_instructors"):
        op.add_column("training_sessions", sa.Column("co_instructors", sa.JSON, nullable=True))

    # ── training_sessions.apparatus_id FK → apparatus.id ──
    if _table_exists(conn, "training_sessions") and not _column_exists(conn, "training_sessions", "apparatus_id"):
        op.add_column("training_sessions", sa.Column("apparatus_id", sa.String(36), nullable=True))
        # Only add FK if apparatus table exists (module may be disabled)
        if _table_exists(conn, "apparatus"):
            op.create_foreign_key(
                "fk_training_sessions_apparatus_id", "training_sessions", "apparatus",
                ["apparatus_id"], ["id"], ondelete="SET NULL",
            )
        op.create_index("ix_training_sessions_apparatus_id", "training_sessions", ["apparatus_id"])

    # ── training_records.apparatus_id FK → apparatus.id ──
    if _table_exists(conn, "training_records") and not _column_exists(conn, "training_records", "apparatus_id"):
        op.add_column("training_records", sa.Column("apparatus_id", sa.String(36), nullable=True))
        if _table_exists(conn, "apparatus"):
            op.create_foreign_key(
                "fk_training_records_apparatus_id", "training_records", "apparatus",
                ["apparatus_id"], ["id"], ondelete="SET NULL",
            )
        op.create_index("ix_training_records_apparatus_id", "training_records", ["apparatus_id"])

    # ── skill_checkoffs.session_id FK → training_sessions.id ──
    if _table_exists(conn, "skill_checkoffs") and not _column_exists(conn, "skill_checkoffs", "session_id"):
        op.add_column("skill_checkoffs", sa.Column("session_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_skill_checkoffs_session_id", "skill_checkoffs", "training_sessions",
            ["session_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_skill_checkoffs_session_id", "skill_checkoffs", ["session_id"])

    # ── skill_checkoffs.apparatus_id FK → apparatus.id ──
    if _table_exists(conn, "skill_checkoffs") and not _column_exists(conn, "skill_checkoffs", "apparatus_id"):
        op.add_column("skill_checkoffs", sa.Column("apparatus_id", sa.String(36), nullable=True))
        if _table_exists(conn, "apparatus"):
            op.create_foreign_key(
                "fk_skill_checkoffs_apparatus_id", "skill_checkoffs", "apparatus",
                ["apparatus_id"], ["id"], ondelete="SET NULL",
            )
        op.create_index("ix_skill_checkoffs_apparatus_id", "skill_checkoffs", ["apparatus_id"])

    # ── skill_checkoffs.conditions JSON ──
    if _table_exists(conn, "skill_checkoffs") and not _column_exists(conn, "skill_checkoffs", "conditions"):
        op.add_column("skill_checkoffs", sa.Column("conditions", sa.JSON, nullable=True))

    # ── Create event_external_attendees table ──
    if not _table_exists(conn, "event_external_attendees"):
        op.create_table(
            "event_external_attendees",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
            # Attendee info
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("email", sa.String(255), nullable=True),
            sa.Column("phone", sa.String(50), nullable=True),
            sa.Column("organization_name", sa.String(255), nullable=True),
            # Check-in
            sa.Column("checked_in", sa.Boolean, nullable=False, server_default="0"),
            sa.Column("checked_in_at", sa.DateTime, nullable=True),
            # Source tracking (e.g., form submission)
            sa.Column("source", sa.String(50), nullable=True),
            sa.Column("source_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text, nullable=True),
            # Timestamps
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
            sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index("ix_ext_attendees_event_id", "event_external_attendees", ["event_id"])
        op.create_index("ix_ext_attendees_org_id", "event_external_attendees", ["organization_id"])
        op.create_index("ix_ext_attendees_email", "event_external_attendees", ["email"])

    # ── Extend form_integrations enum values ──
    # For MySQL ENUM columns, we need to ALTER the column to add new values.
    # Check if the column exists and modify its type to include new values.
    if _table_exists(conn, "form_integrations"):
        try:
            op.alter_column(
                "form_integrations", "target_module",
                type_=sa.Enum("membership", "inventory", "events", name="integrationtarget"),
                existing_type=sa.Enum("membership", "inventory", name="integrationtarget"),
                existing_nullable=False,
            )
        except Exception:
            pass  # Enum may already include the value

        try:
            op.alter_column(
                "form_integrations", "integration_type",
                type_=sa.Enum("membership_interest", "equipment_assignment", "event_registration", name="integrationtype"),
                existing_type=sa.Enum("membership_interest", "equipment_assignment", name="integrationtype"),
                existing_nullable=False,
            )
        except Exception:
            pass  # Enum may already include the value


def downgrade() -> None:
    conn = op.get_bind()

    # Drop event_external_attendees table
    if _table_exists(conn, "event_external_attendees"):
        op.drop_table("event_external_attendees")

    # Remove added columns (reverse order)
    for table, column in [
        ("skill_checkoffs", "conditions"),
        ("skill_checkoffs", "apparatus_id"),
        ("skill_checkoffs", "session_id"),
        ("training_records", "apparatus_id"),
        ("training_sessions", "apparatus_id"),
        ("training_sessions", "co_instructors"),
        ("training_sessions", "instructor_id"),
        ("meeting_minutes", "meeting_id"),
        ("meetings", "location_id"),
        ("meetings", "event_id"),
    ]:
        if _table_exists(conn, table) and _column_exists(conn, table, column):
            op.drop_column(table, column)

    # Revert enum extensions
    if _table_exists(conn, "form_integrations"):
        try:
            op.alter_column(
                "form_integrations", "target_module",
                type_=sa.Enum("membership", "inventory", name="integrationtarget"),
                existing_nullable=False,
            )
            op.alter_column(
                "form_integrations", "integration_type",
                type_=sa.Enum("membership_interest", "equipment_assignment", name="integrationtype"),
                existing_nullable=False,
            )
        except Exception:
            pass
