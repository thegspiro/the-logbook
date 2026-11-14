"""Follow-up form requests

Revision ID: f34e25e2c820
Revises: b74bcce55c11
Create Date: 2026-10-29 03:22:00.000000

A pipeline stage can now send an applicant a follow-up form through a personal
link. Three additions, none of which changes an existing row:

- ``membership_pipeline_steps.step_type`` gains ``follow_up_form``. The ENUM is
  rewritten with every existing value kept in order, so stored rows read the
  same afterwards.
- ``form_fields.applicant_field`` (nullable) names the applicant-record field a
  follow-up form pre-fills from. NULL — every existing field — means none.
- ``email_templates.template_type`` and ``scheduled_emails.template_type``
  gain ``application_follow_up_form`` (the link email) and
  ``application_contact_changed`` (the notice to an applicant's previous
  address). No template rows are created; ``ensure_default_templates`` makes
  them.
- ``prospect_form_requests`` holds one row per applicant per stage: the link's
  token (hashed for lookup, encrypted for resending), the saved draft
  (encrypted), the submission it produced, the changes it made to the
  applicant record (encrypted) and the contact-change review.

Safe to run twice: each step checks for what it adds.

**The downgrade refuses while any stage is a Follow-up Form stage**, because
narrowing the ENUM would fail on those rows (or, without strict mode, blank
them). Remove those stages first. Dropping the table discards every link and
draft, which the downgrade does once nothing references the type. It also
deletes the two new templates (a department's edits to them included) before
narrowing the template-type columns.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f34e25e2c820"
down_revision: Union[str, None] = "b74bcce55c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STEPS = "membership_pipeline_steps"
FIELDS = "form_fields"
REQUESTS = "prospect_form_requests"

# Frozen: the step types as they stood when this revision was written
# (CLAUDE.md pitfall #20). Every value an earlier revision added, in order.
_PREVIOUS_STEP_TYPES = (
    "action",
    "checkbox",
    "note",
    "form_submission",
    "document_upload",
    "election_vote",
    "manual_approval",
    "meeting",
    "status_page_toggle",
    "automated_email",
    "reference_check",
    "checklist",
    "interview_requirement",
    "multi_approval",
    "medical_screening",
)
_NEW_STEP_TYPE = "follow_up_form"

_NEW_TEMPLATE_TYPES = ("application_follow_up_form", "application_contact_changed")

# EmailTemplateType before this revision, as 0d9897752425 left it. Written out
# rather than imported so a later edit to the enum cannot rewrite this step.
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


def _step_type_enum(values: Sequence[str]) -> str:
    listed = ", ".join(f"'{v}'" for v in values)
    return (
        f"ALTER TABLE {STEPS} MODIFY COLUMN step_type ENUM({listed}) "
        "NOT NULL DEFAULT 'checkbox'"
    )


def upgrade() -> None:
    op.execute(_step_type_enum(_PREVIOUS_STEP_TYPES + (_NEW_STEP_TYPE,)))

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

    if not _has_column(FIELDS, "applicant_field"):
        op.add_column(
            FIELDS, sa.Column("applicant_field", sa.String(40), nullable=True)
        )

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
                "prospect_id",
                sa.String(36),
                sa.ForeignKey("prospective_members.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "step_id",
                sa.String(36),
                sa.ForeignKey(f"{STEPS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "form_id",
                sa.String(36),
                sa.ForeignKey("forms.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("token", sa.Text(), nullable=True),
            sa.Column("token_hash", sa.String(64), nullable=True),
            sa.Column("first_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("draft_data", sa.Text(), nullable=True),
            sa.Column("draft_saved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "submission_id",
                sa.String(36),
                sa.ForeignKey("form_submissions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("changes", sa.Text(), nullable=True),
            sa.Column(
                "contact_changed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "contact_change_reviewed_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column(
                "contact_change_reviewed_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
        )
        op.create_index(
            "uq_prospect_form_request_step",
            REQUESTS,
            ["prospect_id", "step_id"],
            unique=True,
        )
        op.create_index(
            "uq_prospect_form_request_token_hash",
            REQUESTS,
            ["token_hash"],
            unique=True,
        )
        op.create_index("idx_prospect_form_request_org", REQUESTS, ["organization_id"])
        op.create_index("ix_prospect_form_requests_form_id", REQUESTS, ["form_id"])


def downgrade() -> None:
    in_use = op.get_bind().scalar(
        sa.text(f"SELECT COUNT(*) FROM {STEPS} WHERE step_type = :t"),
        {"t": _NEW_STEP_TYPE},
    )
    if in_use:
        raise RuntimeError(
            f"{in_use} pipeline stage(s) are Follow-up Form stages. Remove them "
            "before downgrading; the step type cannot be narrowed while rows "
            "use it."
        )

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

    op.execute(f"DROP TABLE IF EXISTS {REQUESTS}")
    if _has_column(FIELDS, "applicant_field"):
        op.drop_column(FIELDS, "applicant_field")
    op.execute(_step_type_enum(_PREVIOUS_STEP_TYPES))
