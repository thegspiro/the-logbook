"""Record why a training record was voided, and email the member about it

An officer voids a training record that should never have counted, such as a
completion a member cheated on. Until now a void appended a note only officers
read; the member was not told and could not see why the credit went away.

* Adds ``training_records.voided_at``, ``voided_by`` and ``void_reason``, all
  nullable. Records voided before this revision keep NULLs: their reason is
  still in ``notes``, and nothing parses it back out.
* Widens ``email_templates.template_type`` and
  ``scheduled_emails.template_type`` with ``training_record_voided`` and
  ``training_record_changed``, the emails telling a member an officer voided
  or edited one of their records. No template rows are created;
  ``ensure_default_templates`` makes them.

Every step checks first, so a re-run, or a ``training_records`` table that
``create_all`` built from the models with the columns already on it, is a
no-op.

The downgrade drops the three columns, losing the structured reasons (the
appended note in ``notes`` survives), and removes any template rows of the two
new types before narrowing the enums.

Revision ID: 26ca07c56d0f
Revises: 95dbdfb6591d
Create Date: 2026-10-07 21:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "26ca07c56d0f"
down_revision: Union[str, None] = "95dbdfb6591d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RECORDS = "training_records"
_VOIDED_BY_FK = "fk_training_records_voided_by_users"
_NEW_VALUES = ("training_record_voided", "training_record_changed")

# EmailTemplateType before this revision, as 95dbdfb6591d left it. Written out
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


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _columns(table: str) -> set:
    return {c["name"] for c in _inspector().get_columns(table)}


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
    if _has_table(_RECORDS):
        existing = _columns(_RECORDS)
        if "voided_at" not in existing:
            op.add_column(
                _RECORDS,
                sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "voided_by" not in existing:
            op.add_column(
                _RECORDS, sa.Column("voided_by", sa.String(36), nullable=True)
            )
            op.create_foreign_key(
                _VOIDED_BY_FK,
                _RECORDS,
                "users",
                ["voided_by"],
                ["id"],
                ondelete="SET NULL",
            )
        if "void_reason" not in existing:
            op.add_column(_RECORDS, sa.Column("void_reason", sa.Text(), nullable=True))

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

    if _has_table(_RECORDS):
        existing = _columns(_RECORDS)
        if "voided_by" in existing:
            # By constrained column, not by name: a table create_all built
            # carries the database's generated name rather than _VOIDED_BY_FK.
            for fk in _inspector().get_foreign_keys(_RECORDS):
                if fk.get("constrained_columns") == ["voided_by"] and fk.get("name"):
                    op.drop_constraint(fk["name"], _RECORDS, type_="foreignkey")
            op.drop_column(_RECORDS, "voided_by")
        for column in ("void_reason", "voided_at"):
            if column in existing:
                op.drop_column(_RECORDS, column)
