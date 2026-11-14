"""Leave requests, leave reminders and the open-ended leave digest

- ``leave_requests``: a member's request for a leave of absence, with the
  department's decision rule as it was when the request was made, and the
  leave an approval created (SET NULL, so the request outlives the leave).
- ``leave_request_votes``: one vote per approver per request, unique.
- ``leave_notice_sends``: the claim each scheduled leave email takes before it
  is sent (the ending reminder per leave and end date, the digest per month),
  unique per department, kind and key, so a re-run sends nothing.
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  the five leave reminder, digest and request templates. No template rows are
  created; ``ensure_default_templates`` makes them.

Existing rows: three new tables, and the enum only gains values. The
department settings these read live in ``organizations.settings`` and default
in code, so no row is backfilled. Safe to run twice.

Downgrade drops the three tables (every request and its votes, and the
record of which reminders were sent, so a reminder already sent may be sent
again after a later upgrade), deletes any rows of the new template types, and
narrows the enum.

Revision ID: c8d2f61a7e34
Revises: b4e7c2a91f06
Create Date: 2026-11-14 18:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d2f61a7e34"
down_revision: Union[str, None] = "b4e7c2a91f06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUESTS = "leave_requests"
VOTES = "leave_request_votes"
SENDS = "leave_notice_sends"

_LEAVE_TYPES = (
    "leave_of_absence",
    "medical",
    "military",
    "personal",
    "administrative",
    "new_member",
    "other",
)

_NEW_TEMPLATE_TYPES = (
    "leave_ending_reminder",
    "leave_ending_officer_notice",
    "open_ended_leave_digest",
    "leave_request_submitted",
    "leave_request_denied",
)

# EmailTemplateType as this revision finds it (b4e7c2a91f06's ALL_TYPES).
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

    # Every table this one references; on a database create_all has not yet
    # built, skip -- create_all builds these from the models later.
    if not all(
        _has_table(t) for t in ("organizations", "users", "member_leaves_of_absence")
    ):
        return

    if not _has_table(REQUESTS):
        op.create_table(
            REQUESTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "leave_type",
                sa.Enum(*_LEAVE_TYPES, native_enum=True),
                nullable=False,
                server_default="leave_of_absence",
            ),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column(
                "status",
                sa.Enum("pending", "approved", "denied", "withdrawn", native_enum=True),
                nullable=False,
                server_default="pending",
            ),
            sa.Column(
                "decision_rule",
                sa.Enum("any", "majority", "all", native_enum=True),
                nullable=False,
                server_default="any",
            ),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "decided_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "leave_id",
                sa.String(36),
                sa.ForeignKey("member_leaves_of_absence.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_leave_requests_org_status", REQUESTS, ["organization_id", "status"]
        )
        op.create_index(
            "ix_leave_requests_org_user", REQUESTS, ["organization_id", "user_id"]
        )

    if not _has_table(VOTES):
        op.create_table(
            VOTES,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "request_id",
                sa.String(36),
                sa.ForeignKey(f"{REQUESTS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "voter_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "vote", sa.Enum("approve", "deny", native_enum=True), nullable=False
            ),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint("request_id", "voter_id", name="uq_leave_request_vote"),
        )
        op.create_index("ix_leave_request_votes_request_id", VOTES, ["request_id"])
        op.create_index(
            "ix_leave_request_votes_org_request",
            VOTES,
            ["organization_id", "request_id"],
        )

    if not _has_table(SENDS):
        op.create_table(
            SENDS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(40), nullable=False),
            sa.Column("key", sa.String(120), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "organization_id", "kind", "key", name="uq_leave_notice_send"
            ),
        )


def downgrade() -> None:
    for table in (VOTES, REQUESTS, SENDS):
        if _has_table(table):
            op.drop_table(table)
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
