"""Evaluation deletion: the Chief's grant and the member's email

Revision ID: 857291750c67
Revises: 38e0f552242d
Create Date: 2026-11-02 05:00:00.000000

Two steps:

- **The grant.** ``evaluations.delete`` is new; ``OPERATIONAL_RANKS
  ["fire_chief"]`` now carries it (owner decision 2026-11-02: the Chief only),
  and a member holding the Chief *rank* has it at runtime, but the system
  ``fire_chief`` *position* stores a copy of its list (CLAUDE.md pitfall #23),
  so existing departments get it on the position only through this step.
  Adding, gated on the grant's own absence: the permission did not exist
  before this revision, so no department can have removed it on purpose. Only
  ``is_system`` rows are touched; a position a department created is theirs.
- **The email.** ``email_templates.template_type`` and
  ``scheduled_emails.template_type`` gain ``evaluation_deleted``, the notice a
  member gets when one of their evaluations is deleted. No template rows are
  created; ``ensure_default_templates`` makes them.

Safe to run twice: a row already holding the grant is skipped and the enum is
widened only when the value is missing. The downgrade takes the grant back
off the same seeded rows (a department that granted it to the Chief position
deliberately after the upgrade loses it too, the unavoidable cost of reversing
a grant nothing distinguishes from the seed) and deletes the template rows, a
department's edits included.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "857291750c67"
down_revision: Union[str, None] = "38e0f552242d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMISSIONS = ("evaluations.delete",)

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry moves on.
_SLUGS = ("fire_chief",)

# The same grants keyed by slug, the shape tests/test_storefront_grant_backfill.py
# reads from a later migration that adds several permissions at once.
_GRANTS = {slug: _PERMISSIONS for slug in _SLUGS}

_NEW_TEMPLATE_TYPES = ("evaluation_deleted",)

# EmailTemplateType as this revision finds it (38e0f552242d's ALL_TYPES).
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


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    for slug in _SLUGS:
        rows = bind.execute(
            sa.text(
                "SELECT id, permissions FROM positions "
                "WHERE slug = :slug AND is_system = :is_system"
            ),
            {"slug": slug, "is_system": True},
        ).fetchall()
        for row in rows:
            updated = mutate(_load_permissions(row.permissions))
            if updated is None:
                continue
            bind.execute(
                sa.text(
                    "UPDATE positions SET permissions = :permissions WHERE id = :id"
                ),
                {"permissions": json.dumps(updated), "id": row.id},
            )


def _add(permissions):
    missing = [p for p in _PERMISSIONS if p not in permissions]
    if not missing:
        return None
    return permissions + missing


def _remove(permissions):
    if not any(p in permissions for p in _PERMISSIONS):
        return None
    return [item for item in permissions if item not in _PERMISSIONS]


def upgrade() -> None:
    bind = op.get_bind()
    if _has_table("positions"):
        _rewrite(bind, _add)

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
    bind = op.get_bind()
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

    if _has_table("positions"):
        _rewrite(bind, _remove)
