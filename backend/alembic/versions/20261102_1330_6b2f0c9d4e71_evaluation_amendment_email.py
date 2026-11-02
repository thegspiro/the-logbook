"""Evaluation amendments: the member's and signers' email

Revision ID: 6b2f0c9d4e71
Revises: 857291750c67
Create Date: 2026-11-02 13:30:00.000000

``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
``evaluation_amended``, the notice the member and everyone who signed get when
a finalized evaluation is reopened as a new revision (owner decision
2026-11-02). No template rows are created; ``ensure_default_templates`` makes
them. Amendments themselves need no schema change: ``evaluation_amendments``
and the per-revision steps, parts and signatures exist since 3fbd0fe30e5b.

Safe to run twice: the enum is widened only when the value is missing. The
downgrade deletes the template rows, a department's edits included.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6b2f0c9d4e71"
down_revision: Union[str, None] = "857291750c67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_TEMPLATE_TYPES = ("evaluation_amended",)

# EmailTemplateType as this revision finds it (857291750c67's ALL_TYPES).
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
