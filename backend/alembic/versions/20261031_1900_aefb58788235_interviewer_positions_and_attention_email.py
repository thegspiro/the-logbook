"""Interviewer position snapshot and the applicant-attention email

Revision ID: aefb58788235
Revises: 3fbd0fe30e5b
Create Date: 2026-10-31 19:00:00.000000

Two steps:

- ``prospect_interviews.interviewer_positions`` (JSON, nullable) records the
  positions and offices the interviewer held when the interview was logged.
  An Interview Requirement stage that names required interviewer positions
  ("an interview by the Chief and one by the President") is graded against
  this snapshot, so a member who has since left the office still counts for
  the interview they gave while holding it, and one who takes the office
  later does not count for an interview given before.

  Existing rows are left NULL: what an interviewer held on the day of an
  interview already logged is not recorded anywhere, so it cannot be
  backfilled. The grader reads a NULL snapshot as the interviewer's current
  positions, which is the only evidence there is. No existing stage names
  required positions yet, so no stage's outcome changes on upgrade.
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  ``application_needs_attention``, the email a case manager gets when their
  applicant submits a follow-up form, withdraws, or reaches an interview or
  sign-off stage. No template rows are created; ``ensure_default_templates``
  makes them.

Safe to run twice: each step checks for what it adds. The downgrade drops the
column (the snapshots with it; later grading falls back to current positions)
and deletes the new template rows, a department's edits included.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aefb58788235"
down_revision: Union[str, None] = "3fbd0fe30e5b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INTERVIEWS = "prospect_interviews"
SNAPSHOT_COLUMN = "interviewer_positions"

_NEW_TEMPLATE_TYPES = ("application_needs_attention",)

# EmailTemplateType as this revision finds it. Written out rather than
# imported so a later edit to the enum cannot rewrite this step.
_PREV_BASE = (
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
    "custom",
)

_EXISTING_TEMPLATE_TYPES = _PREV_BASE[:-1] + (
    "application_follow_up_form",
    "application_contact_changed",
    "application_follow_up_reminder",
    "application_follow_up_submitted",
    "custom",
)

_EXISTING_TEMPLATE_TYPES = _PREV_BASE[:-1] + (
    "application_follow_up_form",
    "application_contact_changed",
    "application_follow_up_reminder",
    "application_follow_up_submitted",
    "application_assigned",
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
    return any(c["name"] == column for c in _inspector().get_columns(table))


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

    if _has_table(INTERVIEWS) and not _has_column(INTERVIEWS, SNAPSHOT_COLUMN):
        op.add_column(INTERVIEWS, sa.Column(SNAPSHOT_COLUMN, sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table(INTERVIEWS) and _has_column(INTERVIEWS, SNAPSHOT_COLUMN):
        op.drop_column(INTERVIEWS, SNAPSHOT_COLUMN)

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
