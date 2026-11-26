"""A feedback reminder to outreach requesters

Two additive steps:

- ``email_templates.template_type`` and ``scheduled_emails.template_type``
  gain ``outreach_feedback_reminder``: the one email reminding a requester,
  three days after their request was completed, that the department would
  like their feedback. No template row is created; ``ensure_default_templates``
  makes it.
- ``event_requests.feedback_reminder_sent_at``, nullable: when that reminder
  went out, so a request is reminded once. Existing rows stay NULL, and the
  task only looks at requests completed in the last 14 days, so the first run
  after the upgrade reminds only those (pitfall #35).

``event_requests`` is built by ``create_all`` on a fresh install, so the column
step is skipped when the table does not exist yet (pitfall #26): the model
declares the column and ``create_all`` builds it. Safe to run twice: each step
checks first.

Downgrade drops the column and deletes rows of the new template type, a
department's edits included, then narrows the enum back. A downgrade forgets
which requests were reminded, so an upgrade straight after it could remind a
request completed in the last 14 days a second time.

Revision ID: 7c3e9a51b2d4
Revises: 103bffdb9528
Create Date: 2026-11-26 05:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c3e9a51b2d4"
down_revision: Union[str, None] = "103bffdb9528"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TEMPLATE_TYPES = ("outreach_feedback_reminder",)

# EmailTemplateType as this revision finds it (5845dae0c277's ALL_TYPES).
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
    "outreach_feedback_received",
    "training_approval_reminder",
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_TEMPLATE_TYPES[:-1] + _NEW_TEMPLATE_TYPES + ("custom",)

REQUESTS = "event_requests"
MARKER = "feedback_reminder_sent_at"


def _template_columns():
    # Read at call time so a test can point the step at scratch tables.
    return (("email_templates", "template_type"), ("scheduled_emails", "template_type"))


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


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
    if _has_table(REQUESTS) and not _has_column(REQUESTS, MARKER):
        op.add_column(
            REQUESTS,
            sa.Column(MARKER, sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _has_table(REQUESTS) and _has_column(REQUESTS, MARKER):
        op.drop_column(REQUESTS, MARKER)
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
