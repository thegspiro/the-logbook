"""Leave request extensions, questions, changed dates and reminders

- ``leave_requests`` gains:
  - ``extends_leave_id``: the active leave a request extends, when its dates
    overlap that leave or start the day after it ends (SET NULL);
  - ``info_requested_at``: set while an approver's question waits on the
    member;
  - ``proposed_start_date``, ``proposed_end_date``, ``proposed_by``,
    ``proposed_at``: an approver's changed dates waiting on the member;
  - ``vote_round`` (default 1): bumped when the member accepts changed dates,
    so votes on the old dates stop counting.
- ``leave_request_votes`` gains ``round`` (default 1), and its one-vote rule
  becomes one vote per approver per round
  (``uq_leave_request_vote`` -> ``uq_leave_request_vote_round``).
- ``leave_request_messages``: the questions, answers and proposals on a
  request, numbered by ``position`` within it; the body is encrypted text.
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  three values. No template rows are created; ``ensure_default_templates``
  makes them.

Existing rows: every new column is nullable or has a server default of 1, so
each request already stored is in its first round with no question or
proposal open, and each stored vote counts in that round. Widening the unique
key cannot conflict with rows that satisfied the narrower one. Safe to run
twice: each step checks first.

Downgrade drops the messages table and the new columns, restores the
one-vote-per-request key (a request with votes from more than one round
would violate it, so those earlier rounds' votes are deleted first), deletes
any rows of the new template types, and narrows the enum.

Revision ID: e5a9c3d71b28
Revises: bc58d756a179
Create Date: 2026-11-16 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a9c3d71b28"
down_revision: Union[str, None] = "bc58d756a179"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REQUESTS = "leave_requests"
VOTES = "leave_request_votes"
MESSAGES = "leave_request_messages"

_NEW_TEMPLATE_TYPES = (
    "leave_request_for_member",
    "leave_request_update",
    "leave_request_reminder",
)

# EmailTemplateType as this revision finds it (73f64017f9e2's ALL_TYPES,
# reached through the bc58d756a179 merge). Written out rather than imported
# so a later edit to the enum cannot rewrite this step.
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


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _unique_names(table: str) -> set:
    return {u["name"] for u in _inspector().get_unique_constraints(table)}


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

    # Built by c8d2f61a7e34, or later by create_all from the models, which
    # already carry every column below.
    if not _has_table(REQUESTS):
        return

    # Foreign keys are left for MySQL to name: their names must be unique in
    # the whole database, and the downgrade looks them up by column.
    if not _has_column(REQUESTS, "extends_leave_id"):
        op.add_column(
            REQUESTS, sa.Column("extends_leave_id", sa.String(36), nullable=True)
        )
        op.create_foreign_key(
            None,
            REQUESTS,
            "member_leaves_of_absence",
            ["extends_leave_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_column(REQUESTS, "info_requested_at"):
        op.add_column(
            REQUESTS,
            sa.Column("info_requested_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column(REQUESTS, "proposed_start_date"):
        op.add_column(
            REQUESTS, sa.Column("proposed_start_date", sa.Date(), nullable=True)
        )
    if not _has_column(REQUESTS, "proposed_end_date"):
        op.add_column(
            REQUESTS, sa.Column("proposed_end_date", sa.Date(), nullable=True)
        )
    if not _has_column(REQUESTS, "proposed_by"):
        op.add_column(REQUESTS, sa.Column("proposed_by", sa.String(36), nullable=True))
        op.create_foreign_key(
            None,
            REQUESTS,
            "users",
            ["proposed_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_column(REQUESTS, "proposed_at"):
        op.add_column(
            REQUESTS,
            sa.Column("proposed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column(REQUESTS, "vote_round"):
        op.add_column(
            REQUESTS,
            sa.Column("vote_round", sa.Integer(), nullable=False, server_default="1"),
        )

    if _has_table(VOTES):
        if not _has_column(VOTES, "round"):
            op.add_column(
                VOTES,
                sa.Column("round", sa.Integer(), nullable=False, server_default="1"),
            )
        names = _unique_names(VOTES)
        if "uq_leave_request_vote_round" not in names:
            op.create_unique_constraint(
                "uq_leave_request_vote_round",
                VOTES,
                ["request_id", "voter_id", "round"],
            )
        if "uq_leave_request_vote" in names:
            op.drop_constraint("uq_leave_request_vote", VOTES, type_="unique")

    if not _has_table(MESSAGES):
        op.create_table(
            MESSAGES,
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
                "author_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "kind",
                sa.Enum(
                    "question",
                    "answer",
                    "proposal",
                    "proposal_accepted",
                    "proposal_declined",
                    native_enum=True,
                ),
                nullable=False,
            ),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.UniqueConstraint(
                "request_id", "position", name="uq_leave_request_message_position"
            ),
        )
        op.create_index(
            "ix_leave_request_messages_org_request",
            MESSAGES,
            ["organization_id", "request_id"],
        )


def downgrade() -> None:
    if _has_table(MESSAGES):
        op.drop_table(MESSAGES)
    if _has_table(VOTES):
        names = _unique_names(VOTES)
        if _has_column(VOTES, "round"):
            # Only the latest round's votes can stand under the narrower key.
            op.execute(
                sa.text(
                    f"DELETE v FROM {VOTES} v JOIN {REQUESTS} r "
                    "ON r.id = v.request_id WHERE v.round <> r.vote_round"
                )
            )
        if "uq_leave_request_vote" not in names:
            op.create_unique_constraint(
                "uq_leave_request_vote", VOTES, ["request_id", "voter_id"]
            )
        if "uq_leave_request_vote_round" in names:
            op.drop_constraint("uq_leave_request_vote_round", VOTES, type_="unique")
        if _has_column(VOTES, "round"):
            op.drop_column(VOTES, "round")
    if _has_table(REQUESTS):
        for column in ("extends_leave_id", "proposed_by"):
            if not _has_column(REQUESTS, column):
                continue
            # Looked up rather than assumed: a table create_all built names
            # its foreign keys itself.
            for fk in _inspector().get_foreign_keys(REQUESTS):
                if fk["constrained_columns"] == [column] and fk.get("name"):
                    op.drop_constraint(fk["name"], REQUESTS, type_="foreignkey")
            op.drop_column(REQUESTS, column)
        for column in (
            "info_requested_at",
            "proposed_start_date",
            "proposed_end_date",
            "proposed_at",
            "vote_round",
        ):
            if _has_column(REQUESTS, column):
                op.drop_column(REQUESTS, column)
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
