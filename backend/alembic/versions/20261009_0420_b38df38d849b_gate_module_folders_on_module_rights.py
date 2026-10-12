"""Gate module system folders on module rights.

Revision ID: b38df38d849b
Revises: 5c8be05f2f0f
Create Date: 2026-10-09 04:20:00.000000

Phase 3 of docs/FILE_STORAGE_HARDENING.md. A module's folder now opens to the
rights of that module rather than to document leadership:

- Training Materials -> training.view / training.manage
- Event Attachments  -> events.view / events.edit / events.manage
- Apparatus Files    -> apparatus.view / apparatus.edit / apparatus.manage
  (was leadership-only)
- Member Separations -> members.manage (was leadership-only)

The lists are frozen here rather than imported from app.models.document: a
migration must keep doing what it did the day it ran. Only system roots are
touched; children inherit through the ancestor check. required_permissions is
not settable through the API, so overwriting it on a system root discards no
department's own choice.

The Finance root is created lazily by the application, already gated, so it
needs nothing here on upgrade.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "b38df38d849b"
down_revision = "5c8be05f2f0f"
branch_labels = None
depends_on = None

_GATES = {
    "training": ["training.view", "training.manage"],
    "events": ["events.view", "events.edit", "events.manage"],
    "apparatus": ["apparatus.view", "apparatus.edit", "apparatus.manage"],
    "member-separations": ["members.manage"],
}

# What the roots carried before this revision.
_PREVIOUS_VISIBILITY = {
    "training": "organization",
    "events": "organization",
    "apparatus": "leadership",
    "member-separations": "leadership",
}


def _has_folders() -> bool:
    return "document_folders" in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_folders():
        return
    bind = op.get_bind()
    for slug, permissions in _GATES.items():
        bind.execute(
            sa.text(
                "UPDATE document_folders "
                "SET visibility = 'organization', required_permissions = :perms "
                "WHERE is_system = true AND slug = :slug"
            ),
            {"perms": json.dumps(permissions), "slug": slug},
        )


def downgrade() -> None:
    if not _has_folders():
        return
    bind = op.get_bind()
    for slug, visibility in _PREVIOUS_VISIBILITY.items():
        bind.execute(
            sa.text(
                "UPDATE document_folders "
                "SET visibility = :visibility, required_permissions = NULL "
                "WHERE is_system = true AND slug = :slug"
            ),
            {"visibility": visibility, "slug": slug},
        )
    # The code this downgrades to has no Finance gate: it would open the
    # Finance root to every documents.view holder. Leadership-only is the
    # closest the older rule can express.
    bind.execute(
        sa.text(
            "UPDATE document_folders "
            "SET visibility = 'leadership', required_permissions = NULL "
            "WHERE is_system = true AND slug = 'finance'"
        )
    )
