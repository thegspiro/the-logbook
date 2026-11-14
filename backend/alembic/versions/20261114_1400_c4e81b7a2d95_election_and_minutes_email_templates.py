"""Election and minutes emails become editable templates

Revision ID: c4e81b7a2d95
Revises: 7735ee22aa76
Create Date: 2026-11-14 14:00:00.000000

``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
ten values for notices that were built in code: four election notices
(nominations open, a nomination to accept, a nomination accepted on the
member's behalf, a proxy authorized), the pre-meeting package, and five
minutes and meeting action-item notices. No template rows are created;
``ensure_default_templates`` makes them.

Only enum values are added, so no existing row is touched. Safe to run twice:
the upgrade checks for the values first. The downgrade deletes the new template
rows, a department's edits included, and narrows the enum back. Send-log rows
(``message_history``) are a free-text column and are not touched either way.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e81b7a2d95"
down_revision: Union[str, None] = "7735ee22aa76"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TEMPLATE_TYPES = (
    "election_nominations_open",
    "election_nominated",
    "election_nomination_accepted_for_you",
    "election_proxy_authorized",
    "pre_meeting_package",
    "minutes_circulated",
    "minutes_action_items",
    "minutes_action_item_reminder",
    "minutes_open_items_digest",
    "meeting_action_item_reminder",
)

# EmailTemplateType as this revision finds it (533f8aba187e's ALL_TYPES).
# Written out rather than imported so a later edit to the enum cannot rewrite
# this step.
_EXISTING_TEMPLATE_TYPES = (
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
    "application_going_inactive",
    "application_follow_up_form",
    "application_contact_changed",
    "application_follow_up_reminder",
    "application_follow_up_submitted",
    "application_assigned",
    "application_needs_attention",
    "evaluation_step_waiting",
    "evaluation_deadline_reminder",
    "evaluation_overdue",
    "evaluation_finalized",
    "evaluation_deleted",
    "evaluation_amended",
    "evaluation_response",
    "application_interview_requested",
    "session_waiver_requested",
    "session_waiver_decided",
    "session_waiver_withdrawn",
    "meeting_waiver_requested",
    "meeting_waiver_decided",
    "meeting_waiver_withdrawn",
    "shift_evaluation_preceptor_link",
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_TEMPLATE_TYPES[:-1] + _NEW_TEMPLATE_TYPES + ("custom",)

TEMPLATES = "email_templates"
SCHEDULED = "scheduled_emails"


def _template_columns():
    # Read at call time so a test can point the step at scratch tables.
    return ((TEMPLATES, "template_type"), (SCHEDULED, "template_type"))


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


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
    for table, column in _template_columns():
        if not _has_table(table):
            continue
        if all(f"'{v}'" in _enum_values(table, column) for v in _NEW_TEMPLATE_TYPES):
            continue
        op.alter_column(
            table,
            column,
            existing_type=sa.Enum(*_EXISTING_TEMPLATE_TYPES, native_enum=True),
            type_=sa.Enum(*ALL_TYPES, native_enum=True),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in _template_columns():
        if not _has_table(table):
            continue
        op.execute(
            sa.text(f"DELETE FROM {table} WHERE {column} IN :values").bindparams(
                sa.bindparam("values", value=list(_NEW_TEMPLATE_TYPES), expanding=True)
            )
        )
        op.alter_column(
            table,
            column,
            existing_type=sa.Enum(*ALL_TYPES, native_enum=True),
            type_=sa.Enum(*_EXISTING_TEMPLATE_TYPES, native_enum=True),
            existing_nullable=False,
        )
