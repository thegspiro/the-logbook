"""Editable templates for two applicant emails the pipeline built in code

The step-completed notice and the status-page link email were assembled in
``membership_pipeline_service`` with fixed wording, so a department could not
change what its applicants were told.

* Widens ``email_templates.template_type`` and
  ``scheduled_emails.template_type`` with ``application_step_completed`` and
  ``application_status_link``. No template rows are created;
  ``ensure_default_templates`` makes them, and until it does the senders use
  the code defaults, which carry the wording the hardcoded emails had.

Each column is checked first, so a re-run, or a table ``create_all`` built from
the models with the values already in the enum, is a no-op. Widening an ENUM
leaves every existing row as it was.

The downgrade removes any template rows of the new types before narrowing the
enums, losing a department's edits to those two templates.

Revision ID: 08e6220f2dce
Revises: 1ad0b594f3fb
Create Date: 2026-10-26 18:19:43.606766

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "08e6220f2dce"
down_revision: Union[str, None] = "1ad0b594f3fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUES = ("application_step_completed", "application_status_link")

# EmailTemplateType before this revision, as 32a58e65eb63 left it. Written out
# rather than imported so a later edit to the enum cannot rewrite this step.
_EXISTING_VALUES = (
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
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_VALUES[:-1] + _NEW_VALUES + ("custom",)

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


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
        if all(f"'{v}'" in _enum_values(table, column) for v in _NEW_VALUES):
            continue
        op.alter_column(
            table,
            column,
            existing_type=_enum(_EXISTING_VALUES),
            type_=_enum(ALL_TYPES),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in _TEMPLATE_COLUMNS:
        if not _has_table(table):
            continue
        op.execute(
            sa.text(f"DELETE FROM {table} WHERE {column} IN :values").bindparams(
                sa.bindparam("values", value=list(_NEW_VALUES), expanding=True)
            )
        )
        op.alter_column(
            table,
            column,
            existing_type=_enum(ALL_TYPES),
            type_=_enum(_EXISTING_VALUES),
            existing_nullable=False,
        )
