"""Suggestion-submitted notifications, and people notified of a box

Three changes behind one feature: telling people a suggestion box received a
submission.

* ``notification_rules.trigger`` accepts ``suggestion_submitted``, so a
  department can switch the new-submission notice off under Notification
  Rules. No rule rows are created: absence means on, which is what every
  department had before this revision.
* ``email_templates.template_type`` and ``scheduled_emails.template_type``
  accept ``suggestion_submitted``, so the reviewers' email is editable under
  Email Templates. No template rows are created here either;
  ``ensure_default_templates`` makes them on first visit to that screen.
* ``suggestion_box_watchers`` holds the positions and members told of a box's
  submissions without being able to read them. Guarded on the table's absence,
  because a fresh install that ran ``create_all`` already has it.

The downgrade deletes any rule or template row of the new type before
narrowing the enums, since such a row would violate the narrowed column, and
drops the watchers table with every watcher configured on it.

Revision ID: 1ae1ffbc445e
Revises: 169772734c90, a0e4764c1b55
Create Date: 2026-09-25 12:51:38.260748

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1ae1ffbc445e"
# Also merges main's two heads at the time of writing, so this revision leaves
# the chain with a single head.
down_revision: Union[str, Sequence[str], None] = ("169772734c90", "a0e4764c1b55")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUE = "suggestion_submitted"

# Snapshot of EmailTemplateType before this revision, as 941e1251ad74 left
# it. Written out rather than imported so a later edit to the enum cannot
# rewrite what this migration did.
_EXISTING_VALUES = (
    "welcome",
    "password_reset",
    "event_cancellation",
    "event_reminder",
    "training_approval",
    "ballot_notification",
    "member_dropped",
    "inventory_change",
    "cert_expiration",
    "post_event_validation",
    "post_shift_validation",
    "property_return_reminder",
    "inactivity_warning",
    "election_report",
    "ballot_eligibility_summary",
    "election_rollback",
    "election_deleted",
    "member_archived",
    "event_request_status",
    "it_password_notification",
    "duplicate_application",
    "series_end_reminder",
    "shift_decline",
    "shift_assignment",
    "shift_reminder",
    "storefront_order_confirmation",
    "storefront_new_order_admin",
    "storefront_order_update",
    "storefront_order_cancelled",
    "storefront_payment_reminder",
    "storefront_payment_received",
    "storefront_window_open",
    "storefront_window_closing",
    "storefront_window_closed",
    "storefront_vendor_order_placed",
    "application_withdrawn",
    "custom",
)

# "custom" stays last, matching the enum's declaration order. Named ALL_TYPES
# by convention: test_database_schema reads this tuple out of the newest
# enum-widening migration and asserts it still matches EmailTemplateType.
ALL_TYPES = _EXISTING_VALUES[:-1] + (_NEW_VALUE, "custom")

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)

# NotificationTrigger as 20260214_0500 left it; no revision since widened it.
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
)
ALL_TRIGGERS = _EXISTING_TRIGGERS + (_NEW_VALUE,)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    for table, column in _TEMPLATE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(_EXISTING_VALUES),
            type_=_enum(ALL_TYPES),
            existing_nullable=False,
        )

    op.alter_column(
        "notification_rules",
        "trigger",
        existing_type=_enum(_EXISTING_TRIGGERS),
        type_=_enum(ALL_TRIGGERS),
        existing_nullable=False,
    )

    if not _has_table("suggestion_box_watchers"):
        op.create_table(
            "suggestion_box_watchers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("box_id", sa.String(36), nullable=False),
            sa.Column("position_id", sa.String(36), nullable=True),
            sa.Column("user_id", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["box_id"], ["suggestion_boxes.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["position_id"], ["positions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "box_id", "position_id", name="uq_suggestion_watcher_pos"
            ),
            sa.UniqueConstraint("box_id", "user_id", name="uq_suggestion_watcher_user"),
        )
        op.create_index(
            "idx_suggestion_watchers_org_box",
            "suggestion_box_watchers",
            ["organization_id", "box_id"],
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS suggestion_box_watchers")

    # A row on the new value would violate the narrowed enum, so remove it
    # first. A rule is only the department's on/off switch for this notice,
    # and a template only its edit of the email; after a downgrade no code
    # reads either.
    op.execute(
        sa.text("DELETE FROM notification_rules WHERE `trigger` = :value").bindparams(
            value=_NEW_VALUE
        )
    )
    op.alter_column(
        "notification_rules",
        "trigger",
        existing_type=_enum(ALL_TRIGGERS),
        type_=_enum(_EXISTING_TRIGGERS),
        existing_nullable=False,
    )

    for table, column in _TEMPLATE_COLUMNS:
        op.execute(
            sa.text(f"DELETE FROM {table} WHERE {column} = :value").bindparams(
                value=_NEW_VALUE
            )
        )
    for table, column in _TEMPLATE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(ALL_TYPES),
            type_=_enum(_EXISTING_VALUES),
            existing_nullable=False,
        )
