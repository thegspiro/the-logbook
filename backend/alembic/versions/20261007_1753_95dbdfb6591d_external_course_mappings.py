"""External course mappings

Target Solutions reissues a course under a new Course ID when it publishes a
new version. ``external_course_mappings`` maps each provider course id to a
course in the department's library, so a requirement linked to the library
course is met by whichever version a member took, and a new version can be
added to the same course instead of editing the requirement.

* Creates ``external_course_mappings``, one row per provider and course id.
* Seeds it with one unmapped row per course id already staged in
  ``external_training_imports``, so the Courses tab lists history the
  department has already synced. Nothing is mapped and nobody is emailed.
* Widens ``email_templates.template_type`` and
  ``scheduled_emails.template_type`` with ``external_course_match``, the
  email telling training officers a new course looks like a library course.
  No template rows are created; ``ensure_default_templates`` makes them.

The downgrade drops the table (mappings are lost; training records keep the
course they were linked to) and removes any ``external_course_match``
template rows before narrowing the enums.

Revision ID: 95dbdfb6591d
Revises: 6cf89b44dc08
Create Date: 2026-10-07 17:53:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "95dbdfb6591d"
down_revision: Union[str, None] = "6cf89b44dc08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "external_course_mappings"
_NEW_VALUE = "external_course_match"

# EmailTemplateType before this revision, as fb7da5b05833 left it. Written out
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
    "custom",
)

# "custom" stays last. Named ALL_TYPES by convention: test_database_schema
# reads it from the newest enum-widening migration and checks it against
# EmailTemplateType.
ALL_TYPES = _EXISTING_VALUES[:-1] + (_NEW_VALUE, "custom")

_TEMPLATE_COLUMNS = (
    ("email_templates", "template_type"),
    ("scheduled_emails", "template_type"),
)


def _enum(values) -> sa.Enum:
    return sa.Enum(*values, native_enum=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(_TABLE):
        op.create_table(
            _TABLE,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "provider_id",
                sa.String(36),
                sa.ForeignKey("external_training_providers.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("external_course_id", sa.String(255), nullable=False),
            sa.Column("external_course_name", sa.String(500), nullable=False),
            sa.Column(
                "internal_course_id",
                sa.String(36),
                sa.ForeignKey("training_courses.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "is_mapped", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
            ),
            sa.Column(
                "mapped_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_external_course_mappings_organization_id", _TABLE, ["organization_id"]
        )
        op.create_index(
            "idx_ext_course_mapping_external",
            _TABLE,
            ["provider_id", "external_course_id"],
            unique=True,
        )
        op.create_index(
            "idx_ext_course_mapping_internal", _TABLE, ["internal_course_id"]
        )

    if _has_table("external_training_imports"):
        op.execute(
            sa.text(
                f"INSERT INTO {_TABLE} (id, provider_id, organization_id, "
                "external_course_id, external_course_name, is_mapped) "
                "SELECT UUID(), i.provider_id, MAX(i.organization_id), "
                "i.external_course_id, LEFT(MAX(i.course_title), 500), 0 "
                "FROM external_training_imports i "
                "WHERE i.external_course_id IS NOT NULL "
                "AND i.external_course_id <> '' "
                f"AND NOT EXISTS (SELECT 1 FROM {_TABLE} m "
                "WHERE m.provider_id = i.provider_id "
                "AND m.external_course_id = i.external_course_id) "
                "GROUP BY i.provider_id, i.external_course_id"
            )
        )

    for table, column in _TEMPLATE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(_EXISTING_VALUES),
            type_=_enum(ALL_TYPES),
            existing_nullable=False,
        )


def downgrade() -> None:
    for table, column in _TEMPLATE_COLUMNS:
        op.execute(
            sa.text(f"DELETE FROM {table} WHERE {column} = :value").bindparams(
                value=_NEW_VALUE
            )
        )
    for table, column in _TEMPLATE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=_enum(ALL_TYPES),
            type_=_enum(_EXISTING_VALUES),
            existing_nullable=False,
        )
    op.execute(f"DROP TABLE IF EXISTS {_TABLE}")
