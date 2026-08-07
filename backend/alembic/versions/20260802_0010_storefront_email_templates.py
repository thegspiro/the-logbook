"""Make the storefront's notices editable in Email Templates

The store sends ten emails and none of them appeared in Communications → Email
Templates, because none was an ``EmailTemplateType``. A department could switch
a notice on or off and reword the settings that appear inside it, but could not
touch the prose around them.

Widens the enum on both columns that carry it. The values match the
``template_type`` strings the storefront has always written to message_history,
so a department's send log stays continuous — with one deliberate exception:
the cancellation notice previously logged as ``storefront_order_update`` and
now has its own type, since sharing one row would mean editing the order-update
wording and silently changing the cancellation email too.

No template rows are created here. ``ensure_default_templates`` creates them on
first visit to the Email Templates screen, and until then the storefront falls
back to the same bodies it has always composed in code.

Revision ID: 20260802_0010
Revises: 20260802_0009
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260802_0010"
down_revision = "20260802_0009"
branch_labels = None
depends_on = None

# Snapshot of EmailTemplateType at this revision. Written out rather than
# imported so a later edit to the enum cannot rewrite what this migration did.
_STOREFRONT_VALUES = (
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
)

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
    "custom",
)

# "custom" stays last, matching the enum's declaration order. Named ALL_TYPES
# by convention: test_database_schema reads this tuple out of the newest
# enum-widening migration and asserts it still matches EmailTemplateType.
ALL_TYPES = _EXISTING_VALUES[:-1] + _STOREFRONT_VALUES + ("custom",)

_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(_EXISTING_VALUES),
            type_=_enum(ALL_TYPES),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Any row on a storefront type would violate the narrowed enum, so move
    # them out of the way first. "custom" is the enum's own escape hatch and is
    # the only value guaranteed to survive the narrowing.
    values = ", ".join(f"'{value}'" for value in _STOREFRONT_VALUES)
    for table, column in _COLUMNS:
        op.execute(f"DELETE FROM {table} WHERE {column} IN ({values})")

    for table, column in _COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(ALL_TYPES),
            type_=_enum(_EXISTING_VALUES),
            existing_nullable=False,
        )
