"""Attendance waiver emails and template position CC

Revision ID: 1c6632035ccd
Revises: 0136dd6d4144, 7b6db9dd8e4f
Create Date: 2026-11-11 13:18:00.000000

It also merges main's two heads: ``0136dd6d4144`` (budget request drafts)
and ``7b6db9dd8e4f`` (meeting attendee waiver link) both revise
``09f0171ccf5e`` and landed together, and neither touches a table this
revision does, so the order between them does not matter.

Three changes, for the attendance-waiver emails (owner decisions 2026-11-10):

1. ``email_templates.template_type`` and ``scheduled_emails.template_type``
   gain the six waiver template types: requested, decided and withdrawn, once
   for training sessions and once for business meetings. No template rows are
   created; ``ensure_default_templates`` makes them.
2. ``email_templates.default_cc_position_ids`` (JSON, nullable): positions
   whose current holders a template copies, so a department can CC "the
   Secretary". Every existing row reads NULL, which copies nobody, so no row
   needs settling (CLAUDE.md pitfall #35) and behaviour is unchanged until a
   department picks a position.
3. ``attendance_waiver_email_sends``: one row per email sent about one
   decision-log row, unique on ``(action_id, recipient_key)`` so a retried
   send is a no-op (pitfall #36). A new, empty table.

Every step is guarded on the table being there and the change not yet made,
so it is safe on a database ``create_all`` built and safe to run twice
(pitfall #26).

The downgrade drops the send log and the new column, deletes the six types'
template rows (a department's edits included) and narrows the enum back. The
previous release reads none of these, so it boots against the downgraded
database.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1c6632035ccd"
down_revision: Union[str, Sequence[str], None] = ("0136dd6d4144", "7b6db9dd8e4f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TEMPLATES = "email_templates"
SCHEDULED = "scheduled_emails"
POSITION_CC = "default_cc_position_ids"
SENDS = "attendance_waiver_email_sends"
# The tables the send log points at, named so the migration's test can point
# it at scratch copies.
ORGANIZATIONS = "organizations"
REQUESTS = "attendance_waiver_requests"
ACTIONS = "attendance_waiver_request_actions"
UQ_SENDS = "uq_attendance_waiver_email_sends_action_recipient"
IX_SENDS_ORG_REQUEST = "ix_attendance_waiver_email_sends_org_request"

_NEW_TEMPLATE_TYPES = (
    "session_waiver_requested",
    "session_waiver_decided",
    "session_waiver_withdrawn",
    "meeting_waiver_requested",
    "meeting_waiver_decided",
    "meeting_waiver_withdrawn",
)

# EmailTemplateType as this revision finds it (4f1f4921a052's ALL_TYPES).
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
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_TEMPLATE_TYPES[:-1] + _NEW_TEMPLATE_TYPES + ("custom",)


def _template_columns() -> tuple:
    # Read at call time, so the migration's test can point it at scratch copies.
    return ((TEMPLATES, "template_type"), (SCHEDULED, "template_type"))


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


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
    existing = _tables()
    for table, column in _template_columns():
        if table not in existing:
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

    if TEMPLATES in existing and POSITION_CC not in _columns(TEMPLATES):
        op.add_column(TEMPLATES, sa.Column(POSITION_CC, sa.JSON(), nullable=True))

    if SENDS not in existing and {ORGANIZATIONS, REQUESTS, ACTIONS} <= existing:
        op.create_table(
            SENDS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey(f"{REQUESTS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "action_id",
                sa.String(36),
                sa.ForeignKey(f"{ACTIONS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("recipient_key", sa.String(80), nullable=False),
            sa.Column(
                "is_copy", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint("action_id", "recipient_key", name=UQ_SENDS),
        )
        op.create_index(IX_SENDS_ORG_REQUEST, SENDS, ["organization_id", "request_id"])


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {SENDS}")
    existing = _tables()
    if TEMPLATES in existing and POSITION_CC in _columns(TEMPLATES):
        op.drop_column(TEMPLATES, POSITION_CC)
    for table, column in _template_columns():
        if table not in existing:
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
