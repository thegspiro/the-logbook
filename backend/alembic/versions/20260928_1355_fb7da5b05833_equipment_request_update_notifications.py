"""Equipment request update notifications

Two enum widenings behind one feature: telling a member their equipment
request was approved, declined or issued.

* ``notification_rules.trigger`` accepts ``equipment_request_update``, so a
  department can switch the notice off under Notification Rules. No rule rows
  are created: absence means on.
* ``email_templates.template_type`` and ``scheduled_emails.template_type``
  accept ``equipment_request_update``, so the member's email is editable under
  Email Templates. No template rows are created here either;
  ``ensure_default_templates`` makes them on first visit to that screen.

No data changes. The downgrade deletes any rule or template row of the new
type before narrowing the enums, since such a row would violate the narrowed
column; after a downgrade no code reads either.

Revision ID: fb7da5b05833
Revises: ba5c348d7045
Create Date: 2026-09-28 13:55:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fb7da5b05833"
down_revision: Union[str, Sequence[str], None] = "ba5c348d7045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUE = "equipment_request_update"

# Snapshot of EmailTemplateType before this revision, as 1ae1ffbc445e left
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
    "suggestion_submitted",
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

# NotificationTrigger as 1ae1ffbc445e left it.
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
)
ALL_TRIGGERS = _EXISTING_TRIGGERS + (_NEW_VALUE,)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


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


def downgrade() -> None:
    # A row on the new value would violate the narrowed enum, so remove it
    # first. A rule is only the department's on/off switch for this notice,
    # and a template only its edit of the email.
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
