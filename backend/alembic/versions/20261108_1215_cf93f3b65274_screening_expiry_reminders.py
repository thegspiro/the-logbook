"""Medical screening expiry reminders (W71b-4)

Two changes behind one feature: emailing a member before a screening falls
due, on the certification reminders' 90/60/30/7-day tiers (owner decision
2026-11-06).

* ``screening_reminder_sends`` records each reminder sent. Its unique key
  ``(screening_record_id, tier_days, due_date)`` is what makes a second daily
  run send nothing. A new table: there are no rows to settle.
* ``notification_rules.trigger`` accepts ``medical_screening_expiry``, so a
  department can switch the reminders off under Notification Rules. No rule
  rows are created: absence means on.

Effect on an upgraded installation: from the first daily run after the
upgrade, members with a screening due within 90 days get one email at the
tier it has reached (a screening due in 20 days gets the 30-day reminder).

The downgrade deletes any rule on the new trigger before narrowing the enum,
since such a row would violate the narrowed column, and drops the table; the
record of which reminders went out goes with it.

Revision ID: cf93f3b65274
Revises: ac1687769b62
Create Date: 2026-11-08 12:15:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cf93f3b65274"
down_revision: Union[str, None] = "ac1687769b62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "screening_reminder_sends"
_NEW_TRIGGER = "medical_screening_expiry"

# NotificationTrigger as fb7da5b05833 left it. Written out rather than
# imported so a later edit to the enum cannot rewrite what this migration did.
_EXISTING_TRIGGERS = (
    "event_reminder",
    "training_expiry",
    "schedule_change",
    "new_member",
    "member_dropped",
    "maintenance_due",
    "election_started",
    "form_submitted",
    "action_item_assigned",
    "meeting_scheduled",
    "document_uploaded",
    "suggestion_submitted",
    "equipment_request_update",
)
ALL_TRIGGERS = _EXISTING_TRIGGERS + (_NEW_TRIGGER,)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if _TABLE not in tables:
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
                "screening_record_id",
                sa.String(36),
                sa.ForeignKey("screening_records.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "tier_days",
                sa.Integer(),
                nullable=False,
                comment=(
                    "The reminder tier: days before the due date (90, 60, 30 or 7)."
                ),
            ),
            sa.Column(
                "due_date",
                sa.Date(),
                nullable=False,
                comment="The due date this reminder was about.",
            ),
            sa.Column(
                "sent_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
            sa.UniqueConstraint(
                "screening_record_id",
                "tier_days",
                "due_date",
                name="uq_screening_reminder_send",
            ),
        )
        op.create_index("idx_screening_reminder_org", _TABLE, ["organization_id"])

    if "notification_rules" in tables:
        op.alter_column(
            "notification_rules",
            "trigger",
            existing_type=_enum(_EXISTING_TRIGGERS),
            type_=_enum(ALL_TRIGGERS),
            existing_nullable=False,
        )


def downgrade() -> None:
    tables = _tables()
    if "notification_rules" in tables:
        # A rule is only the department's on/off switch for these reminders.
        op.execute(
            sa.text(
                "DELETE FROM notification_rules WHERE `trigger` = :value"
            ).bindparams(value=_NEW_TRIGGER)
        )
        op.alter_column(
            "notification_rules",
            "trigger",
            existing_type=_enum(ALL_TRIGGERS),
            type_=_enum(_EXISTING_TRIGGERS),
            existing_nullable=False,
        )
    if _TABLE in tables:
        op.drop_table(_TABLE)
