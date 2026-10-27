"""Applicant inactivity email, and essential emails switched back on

* Widens ``email_templates.template_type`` and
  ``scheduled_emails.template_type`` with ``application_going_inactive``, the
  notice an applicant now receives when their pipeline is set to warn them
  that their application is about to be marked inactive. No template rows are
  created; ``ensure_default_templates`` makes them. Each column is checked
  first, so a re-run, or a table ``create_all`` built from the models with the
  value already in the enum, is a no-op.
* Switches back on any stored Password Reset, IT Password Notification,
  Welcome, Ballot Notification or Application Status Link template a
  department had switched off. Switching a template off now stops its email,
  and these five carry something their recipient cannot get any other way,
  so the Email Templates screen no longer lets them be switched off. Before
  this revision "off" only made them send the built-in default; from here a
  department's edits to them are what is sent.

**Downgrade** removes any ``application_going_inactive`` template rows before
narrowing the enums, losing a department's edits to that one template. It
does not switch the five essential templates back off: which rows were off is
not recorded, and at the revision below "off" still sent them anyway.

Revision ID: 0d9897752425
Revises: 8079ea63f119
Create Date: 2026-10-27 15:41:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d9897752425"
down_revision: Union[str, Sequence[str], None] = "8079ea63f119"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUES = ("application_going_inactive",)

# EmailTemplateType before this revision, as 08e6220f2dce left it. Written out
# rather than imported so a later edit to the enum cannot rewrite this step.
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
    "equipment_request_update",
    "external_course_match",
    "training_record_voided",
    "training_record_changed",
    "event_waitlist_promotion",
    "application_step_completed",
    "application_status_link",
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_VALUES[:-1] + _NEW_VALUES + ("custom",)

# The types a department can no longer switch off (ALWAYS_SENT_TYPES in
# email_template_service), frozen as they were the day this ran.
ESSENTIAL_TYPES = (
    "password_reset",
    "it_password_notification",
    "welcome",
    "ballot_notification",
    "application_status_link",
)

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _enum_values(table: str, column: str) -> str:
    row = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
                "AND COLUMN_NAME = :column"
            ),
            {"table": table, "column": column},
        )
        .first()
    )
    return str(row[0]) if row else ""


def upgrade() -> None:
    for table, column in _TEMPLATE_COLUMNS:
        if not _has_table(table):
            continue
        if all(f"'{v}'" in _enum_values(table, column) for v in _NEW_VALUES):
            continue
        op.alter_column(
            table,
            column,
            existing_type=_enum(_EXISTING_VALUES),
            type_=_enum(ALL_TYPES),
            existing_nullable=False,
        )

    if _has_table("email_templates"):
        switch_essential_templates_on()


def switch_essential_templates_on() -> None:
    op.execute(
        sa.text(
            "UPDATE email_templates SET is_active = 1 "
            "WHERE is_active = 0 AND template_type IN :types"
        ).bindparams(sa.bindparam("types", value=list(ESSENTIAL_TYPES), expanding=True))
    )


def downgrade() -> None:
    for table, column in _TEMPLATE_COLUMNS:
        if not _has_table(table):
            continue
        op.execute(
            sa.text(f"DELETE FROM {table} WHERE {column} IN :values").bindparams(
                sa.bindparam("values", value=list(_NEW_VALUES), expanding=True)
            )
        )
        op.alter_column(
            table,
            column,
            existing_type=_enum(ALL_TYPES),
            type_=_enum(_EXISTING_VALUES),
            existing_nullable=False,
        )
