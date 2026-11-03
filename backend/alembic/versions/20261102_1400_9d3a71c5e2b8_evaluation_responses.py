"""Evaluation responses: the PDF that carries one, and the officers' email

Revision ID: 9d3a71c5e2b8
Revises: 6b2f0c9d4e71
Create Date: 2026-11-02 14:00:00.000000

Two steps (owner decision 2026-11-02):

- ``evaluation_documents`` gains ``includes_response`` (boolean, default
  false). A member's written response, attached after finalization, is
  printed in a second PDF for the same revision, and the first is kept as it
  was signed, so the unique key widens from (evaluation, revision) to
  (evaluation, revision, includes_response). Every existing row is a signed
  record without a response, which the default says, so no row changes and
  none can collide under the wider key (CLAUDE.md pitfall #35). The new key is
  created before the old one is dropped: the old one is the only index that
  begins with ``evaluation_id``, which its foreign key needs, and MySQL
  refuses to drop it while nothing else serves.
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  ``evaluation_response``, the notice the evaluator and the evaluation
  managers get when a member submits one. No template rows are created;
  ``ensure_default_templates`` makes them.

Safe to run twice: each step checks for what it adds, and the documents step
is skipped when ``create_all`` has not built the table yet. The downgrade
deletes the response PDFs' rows (their files stay in storage; take a backup
first once members have responded), restores the narrower key and drops the
column, and deletes the new template rows, a department's edits included.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d3a71c5e2b8"
down_revision: Union[str, None] = "6b2f0c9d4e71"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DOCUMENTS = "evaluation_documents"
COLUMN = "includes_response"
OLD_KEY = "uq_evaluation_documents_revision"
NEW_KEY = "uq_evaluation_documents_variant"

_NEW_TEMPLATE_TYPES = ("evaluation_response",)

# EmailTemplateType as this revision finds it (6b2f0c9d4e71's ALL_TYPES).
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


def _has_key(table: str, name: str) -> bool:
    inspector = _inspector()
    return any(
        u["name"] == name for u in inspector.get_unique_constraints(table)
    ) or any(i["name"] == name for i in inspector.get_indexes(table))


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
    if _has_table(DOCUMENTS):
        if not _has_column(DOCUMENTS, COLUMN):
            op.add_column(
                DOCUMENTS,
                sa.Column(
                    COLUMN, sa.Boolean(), nullable=False, server_default=sa.text("0")
                ),
            )
        if not _has_key(DOCUMENTS, NEW_KEY):
            op.create_unique_constraint(
                NEW_KEY, DOCUMENTS, ["evaluation_id", "revision", COLUMN]
            )
        if _has_key(DOCUMENTS, OLD_KEY):
            op.drop_constraint(OLD_KEY, DOCUMENTS, type_="unique")

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

    if _has_table(DOCUMENTS) and _has_column(DOCUMENTS, COLUMN):
        op.execute(sa.text(f"DELETE FROM {DOCUMENTS} WHERE {COLUMN} = 1"))
        if not _has_key(DOCUMENTS, OLD_KEY):
            op.create_unique_constraint(
                OLD_KEY, DOCUMENTS, ["evaluation_id", "revision"]
            )
        if _has_key(DOCUMENTS, NEW_KEY):
            op.drop_constraint(NEW_KEY, DOCUMENTS, type_="unique")
        op.drop_column(DOCUMENTS, COLUMN)
