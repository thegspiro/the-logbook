"""Preceptor links for outside-shift evaluations

- ``shift_evaluation_links``: the no-login link an outside agency's preceptor
  fills one evaluation out through. The token is stored as a SHA-256 hash for
  lookup and encrypted for showing again.
- ``training_module_configs.shift_evaluation_link_days``: how many days after
  the shift a link stays open (default 7).
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  ``shift_evaluation_preceptor_link``, the email that carries the link. No
  template rows are created; ``ensure_default_templates`` makes them.

Existing rows: the new column has a server default, so every department reads
7 days; the enum only gains a value; the table is new. Safe to run twice.

Downgrade drops the table (outstanding links stop working), the column, and
the new template rows, then narrows the enum.

Revision ID: 533f8aba187e
Revises: 86722d75b5a2
Create Date: 2026-11-13 12:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "533f8aba187e"
down_revision: Union[str, None] = "86722d75b5a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LINKS = "shift_evaluation_links"
CONFIGS = "training_module_configs"

_NEW_TEMPLATE_TYPES = ("shift_evaluation_preceptor_link",)

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

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


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

    if _has_table(CONFIGS) and not _has_column(CONFIGS, "shift_evaluation_link_days"):
        op.add_column(
            CONFIGS,
            sa.Column(
                "shift_evaluation_link_days",
                sa.Integer(),
                nullable=False,
                server_default="7",
            ),
        )

    if not _has_table(LINKS) and _has_table("external_shift_hours"):
        op.create_table(
            LINKS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "external_shift_id",
                sa.String(36),
                sa.ForeignKey("external_shift_hours.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "member_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("scope_key", sa.String(40), nullable=False),
            sa.Column("token", sa.Text(), nullable=True),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("preceptor_email", sa.Text(), nullable=True),
            sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_by_member",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "evaluation_id",
                sa.String(36),
                sa.ForeignKey(
                    "shift_evaluations.id",
                    ondelete="SET NULL",
                    name="fk_shift_evaluation_links_evaluation",
                ),
                nullable=True,
            ),
            sa.Column("submitted_ip", sa.String(64), nullable=True),
            sa.Column("submitted_user_agent", sa.String(500), nullable=True),
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
                nullable=False,
            ),
            sa.UniqueConstraint(
                "token_hash", name="uq_shift_evaluation_link_token_hash"
            ),
        )
        op.create_index(
            "idx_shift_evaluation_link_entry",
            LINKS,
            ["organization_id", "external_shift_id", "scope_key"],
        )
        op.create_index(
            "idx_shift_evaluation_link_evaluation", LINKS, ["evaluation_id"]
        )


def downgrade() -> None:
    if _has_table(LINKS):
        op.drop_table(LINKS)
    if _has_table(CONFIGS) and _has_column(CONFIGS, "shift_evaluation_link_days"):
        op.drop_column(CONFIGS, "shift_evaluation_link_days")
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
