"""Training approval reminder becomes an email template

``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
``training_approval_reminder``: the email to the training officers when a
training session's sign-off has waited 7 days, and again at 14 (owner decision
2026-11-23). No template row is created; ``ensure_default_templates`` makes
it. Which approvals were reminded is stamped in the existing
``training_approvals.reminder_sent_at``, which nothing wrote before, so no
column is added.

Existing rows: only an enum value is added, so no row is touched (pitfall
#35). Safe to run twice: the upgrade checks for the value first.

Downgrade deletes any rows of the new type, a department's edits to the
template included, and narrows the enum back. ``reminder_sent_at`` stamps are
left as they are, so an upgrade after a downgrade does not remind about those
approvals again.

Revision ID: 5845dae0c277
Revises: 07abf8e6553b
Create Date: 2026-11-23 07:12:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5845dae0c277"
down_revision: Union[str, None] = "07abf8e6553b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TEMPLATE_TYPES = ("training_approval_reminder",)

# EmailTemplateType as this revision finds it (bfb747c095c3's ALL_TYPES; the
# revisions between it and 07abf8e6553b add no template type).
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
    "leave_of_absence_notice",
    "leave_ending_reminder",
    "leave_ending_officer_notice",
    "open_ended_leave_digest",
    "leave_request_submitted",
    "leave_request_denied",
    "guest_headcount_reminder",
    "leave_request_for_member",
    "leave_request_update",
    "leave_request_reminder",
    "leave_request_escalation",
    "leave_ended_early",
    "leave_cover_named",
    "leave_cover_cleared",
    "leave_cover_ended",
    "program_requirement_reopened",
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_TEMPLATE_TYPES[:-1] + _NEW_TEMPLATE_TYPES + ("custom",)

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


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
    for table, column in _TEMPLATE_COLUMNS:
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
    for table, column in _TEMPLATE_COLUMNS:
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
