"""Evaluation email notices: four template types and two sent-stamps

Revision ID: 38e0f552242d
Revises: 0ebd6603289b
Create Date: 2026-11-02 04:00:00.000000

Three steps:

- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  the four evaluation notices (owner decision 2026-11-02):
  ``evaluation_step_waiting``, ``evaluation_deadline_reminder``,
  ``evaluation_overdue`` and ``evaluation_finalized``. No template rows are
  created; ``ensure_default_templates`` makes them.
- ``evaluation_steps`` gains ``reminder_sent_at`` and
  ``overdue_notice_sent_at`` (nullable), which make each step's reminder and
  overdue notice go out once however often the scheduler runs (CLAUDE.md
  pitfall #36).

- ``evaluation_signatures.intent_confirmed`` and
  ``evaluation_deletion_records.was_finalized`` gain a server default of false.
  Every existing row was written with an explicit value, so none changes; the
  default only means a row inserted without one never claims a confirmed
  intent or a finalized record.

Existing steps are left NULL (pitfall #35), which reads as "not yet sent". A
step already open and already inside its reminder window or past its due
date on upgrade is therefore reminded or reported on the scheduler's next
run, which is the notice it would have had if the feature had existed: no
evaluation has been through a reminder before this revision.

Safe to run twice: each step checks for what it adds, and
``evaluation_steps`` is skipped when ``create_all`` has not built it yet. The
downgrade drops the two columns (when a step was reminded is lost; nothing
reads it once the code is gone) and deletes the four template rows, a
department's edits included.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "38e0f552242d"
down_revision: Union[str, None] = "0ebd6603289b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STEPS = "evaluation_steps"
STAMP_COLUMNS = ("reminder_sent_at", "overdue_notice_sent_at")
# (table, column) pairs that gain a server default of false.
FALSE_DEFAULTS = (
    ("evaluation_signatures", "intent_confirmed"),
    ("evaluation_deletion_records", "was_finalized"),
)

_NEW_TEMPLATE_TYPES = (
    "evaluation_step_waiting",
    "evaluation_deadline_reminder",
    "evaluation_overdue",
    "evaluation_finalized",
)

# EmailTemplateType as this revision finds it (aefb58788235's ALL_TYPES).
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

    if _has_table(STEPS):
        for column in STAMP_COLUMNS:
            if not _has_column(STEPS, column):
                op.add_column(
                    STEPS,
                    sa.Column(column, sa.DateTime(timezone=True), nullable=True),
                )

    for table, column in FALSE_DEFAULTS:
        if _has_table(table) and _has_column(table, column):
            op.alter_column(
                table,
                column,
                existing_type=sa.Boolean(),
                existing_nullable=False,
                server_default=sa.text("0"),
            )


def downgrade() -> None:
    for table, column in FALSE_DEFAULTS:
        if _has_table(table) and _has_column(table, column):
            op.alter_column(
                table,
                column,
                existing_type=sa.Boolean(),
                existing_nullable=False,
                server_default=None,
            )

    if _has_table(STEPS):
        for column in STAMP_COLUMNS:
            if _has_column(STEPS, column):
                op.drop_column(STEPS, column)

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
