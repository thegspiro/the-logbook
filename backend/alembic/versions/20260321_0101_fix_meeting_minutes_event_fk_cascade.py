"""Fix meeting_minutes.event_id FK to use SET NULL on delete

The meeting_minutes.event_id foreign key had no ondelete action, defaulting
to RESTRICT. This caused IntegrityError (1451) when deleting events that
had linked meeting minutes.

Revision ID: 20260321_0101
Revises: 20260319_0100
Create Date: 2026-03-21 01:00:00.000000
"""

from alembic import op

# revision identifiers
revision = "20260321_0101"
down_revision = "20260321_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "fk_meeting_minutes_event_id_events",
        "meeting_minutes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_meeting_minutes_event_id_events",
        "meeting_minutes",
        "events",
        ["event_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_meeting_minutes_event_id_events",
        "meeting_minutes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_meeting_minutes_event_id_events",
        "meeting_minutes",
        "events",
        ["event_id"],
        ["id"],
    )
