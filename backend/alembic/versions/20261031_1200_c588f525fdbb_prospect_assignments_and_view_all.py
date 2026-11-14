"""Applicant assignments and prospective_members.view_all

Revision ID: c588f525fdbb
Revises: f90b1124e6f4
Create Date: 2026-10-31 12:00:00.000000

Case managers and interviewers are now assigned to individual applicants, and
seeing every applicant takes the new ``prospective_members.view_all``. Three
steps:

- ``prospect_assignments`` holds one row per member per role per applicant. It
  starts empty; no applicant gains or loses anyone.
- ``email_templates.template_type`` and ``scheduled_emails.template_type`` gain
  ``application_assigned``, the email a member gets when assigned. No template
  rows are created; ``ensure_default_templates`` makes them.
- **Every position holding ``prospective_members.view`` or
  ``prospective_members.manage`` is given ``prospective_members.view_all``**,
  system and department-created alike. Before this revision those holders saw
  every applicant; without the grant they would see only the ones assigned to
  them, which nobody is yet, so the pipeline would empty on upgrade for every
  coordinator. A row already holding ``*`` or ``prospective_members.*`` is
  covered by the wildcard and left alone.

**Direction: an addition, gated on evidence** (docs/rules/migrations.md). The
evidence is the view or manage grant itself: it is what showed the position
every applicant this morning, so the addition preserves access rather than
extending it. Department-created positions are included, unlike most grant
migrations, because leaving them out narrows a committee position the
department built for exactly this. **What it costs when wrong:** a position the
department meant to limit to its own applicants keeps seeing them all until
an administrator removes ``view_all`` on the positions screen, which is the
same access it had before the upgrade.

Safe to run twice: each step checks for what it adds. The downgrade removes
``view_all`` from every position (nothing read it before this revision),
deletes the new template rows (a department's edits included) and drops the
assignments.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c588f525fdbb"
down_revision: Union[str, None] = "f90b1124e6f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ASSIGNMENTS = "prospect_assignments"
POSITIONS = "positions"

_PERMISSION = "prospective_members.view_all"
_EVIDENCE = {"prospective_members.view", "prospective_members.manage"}
_ALREADY_COVERED = {"*", "prospective_members.*", _PERMISSION}

_NEW_TEMPLATE_TYPES = ("application_assigned",)

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


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def grant(permissions):
    """Return the row with view_all added, or None to leave it alone."""
    held = set(permissions)
    if held & _ALREADY_COVERED or not held & _EVIDENCE:
        return None
    return list(permissions) + [_PERMISSION]


def revoke(permissions):
    """Return the row without view_all, or None when it does not hold it."""
    if _PERMISSION not in permissions:
        return None
    return [p for p in permissions if p != _PERMISSION]


def _rewrite_positions(change) -> None:
    if not _has_table(POSITIONS):
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id, permissions FROM {POSITIONS}")).fetchall()
    for row in rows:
        updated = change(_load_permissions(row.permissions))
        if updated is None:
            continue
        bind.execute(
            sa.text(
                f"UPDATE {POSITIONS} SET permissions = :permissions WHERE id = :id"
            ),
            {"permissions": json.dumps(updated), "id": row.id},
        )


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

    if not _has_table(ASSIGNMENTS):
        op.create_table(
            ASSIGNMENTS,
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
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column(
                "assigned_by",
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
        )
        op.create_index(
            "uq_prospect_assignment",
            ASSIGNMENTS,
            ["prospect_id", "user_id", "role"],
            unique=True,
        )
        op.create_index(
            "idx_prospect_assignment_user", ASSIGNMENTS, ["user_id", "organization_id"]
        )
        op.create_index("idx_prospect_assignment_org", ASSIGNMENTS, ["organization_id"])

    _rewrite_positions(grant)


def downgrade() -> None:
    _rewrite_positions(revoke)

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

    op.execute(f"DROP TABLE IF EXISTS {ASSIGNMENTS}")
