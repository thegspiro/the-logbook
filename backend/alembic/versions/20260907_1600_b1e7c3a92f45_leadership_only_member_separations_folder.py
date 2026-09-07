"""File property-return reports in a leadership-only folder.

Revision ID: b1e7c3a92f45
Revises: f2a91c7d4e86
Create Date: 2026-09-07 16:00:00.000000

``PropertyReturnService.save_as_document`` filed each generated
property-return report into the ``Reports`` system folder. That folder carries
the default ``organization`` visibility, so every holder of plain
``documents.view`` could read a report that names a departed member, quotes
the reason for the separation — involuntary ones included — and prints their
home address so the letter can be posted to them.

This is the hazard ``DocumentService.publish_minutes`` already refuses for
executive minutes (MM2-1): copying a restricted body into an
organization-visible folder silently defeats the restriction. The answer is
the same mechanism, ``FolderVisibility.LEADERSHIP``.

The service now files into a ``member-separations`` folder and creates it on
demand. This revision covers the two populations the service cannot:

1. Organizations that already have system folders — ``initialize_system_folders``
   returns early for them, so the new folder is created here rather than
   waiting for the next separation to be processed.
2. Reports already written into ``Reports``, which stay readable by the whole
   department until they are moved.

**Reversible, deliberately.** The downgrade moves the reports back to
``Reports`` and drops the folders this revision created, restoring the prior
state exactly. It restores the disclosure along with it, so it is for a schema
rollback, not a decision to undo.
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "b1e7c3a92f45"
down_revision = "f2a91c7d4e86"
branch_labels = None
depends_on = None

_SLUG = "member-separations"
_SOURCE_TYPE = "property_return_report"

# Kept in step with the SYSTEM_FOLDERS entry in app/models/document.py. Inlined
# rather than imported: a migration must keep building the row the way it did
# the day it ran, and the registry is free to change (CLAUDE.md pitfall #20).
_FOLDER = {
    "name": "Member Separations",
    "description": "Property-return reports for departed members",
    "color": "text-stone-400",
    "icon": "user-minus",
    "sort_order": 11,
    "visibility": "leadership",
}


def _tables_present() -> bool:
    names = set(sa.inspect(op.get_bind()).get_table_names())
    return {"documents", "document_folders"}.issubset(names)


def upgrade() -> None:
    if not _tables_present():
        return

    bind = op.get_bind()

    # Every organization that owns at least one property-return report, or a
    # Reports folder those reports would land in. Creating the folder only
    # where it can matter keeps the sidebar of a department that has never
    # dropped a member unchanged.
    org_ids = [
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT DISTINCT organization_id FROM documents "
                "WHERE source_type = :src"
            ),
            {"src": _SOURCE_TYPE},
        ).fetchall()
    ]

    for org_id in org_ids:
        existing = bind.execute(
            sa.text(
                "SELECT id FROM document_folders "
                "WHERE organization_id = :org AND slug = :slug"
            ),
            {"org": org_id, "slug": _SLUG},
        ).scalar()

        folder_id = existing or str(uuid.uuid4())
        if not existing:
            bind.execute(
                sa.text(
                    "INSERT INTO document_folders "
                    "(id, organization_id, name, slug, description, color, icon, "
                    " is_system, sort_order, visibility) "
                    "VALUES (:id, :org, :name, :slug, :description, :color, "
                    " :icon, 1, :sort_order, :visibility)"
                ),
                {"id": folder_id, "org": org_id, "slug": _SLUG, **_FOLDER},
            )

        bind.execute(
            sa.text(
                "UPDATE documents SET folder_id = :folder "
                "WHERE organization_id = :org AND source_type = :src"
            ),
            {"folder": folder_id, "org": org_id, "src": _SOURCE_TYPE},
        )


def downgrade() -> None:
    if not _tables_present():
        return

    bind = op.get_bind()

    # Per-organization single-table statements, matching the upgrade. A
    # multi-table UPDATE ... JOIN would be shorter and is MySQL/MariaDB-only
    # syntax; no other migration in this chain relies on it.
    rows = bind.execute(
        sa.text("SELECT id, organization_id FROM document_folders WHERE slug = :slug"),
        {"slug": _SLUG},
    ).fetchall()

    for folder_id, org_id in rows:
        reports_id = bind.execute(
            sa.text(
                "SELECT id FROM document_folders "
                "WHERE organization_id = :org AND slug = 'reports'"
            ),
            {"org": org_id},
        ).scalar()

        # An organization with no Reports folder keeps its reports where they
        # are rather than being left with folder_id NULL, which reads as
        # organization-level and would disclose more than either state.
        if reports_id is None:
            continue

        bind.execute(
            sa.text(
                "UPDATE documents SET folder_id = :dst "
                "WHERE folder_id = :src AND source_type = :type"
            ),
            {"dst": reports_id, "src": folder_id, "type": _SOURCE_TYPE},
        )

        remaining = bind.execute(
            sa.text("SELECT COUNT(*) FROM documents WHERE folder_id = :src"),
            {"src": folder_id},
        ).scalar()
        if not remaining:
            bind.execute(
                sa.text("DELETE FROM document_folders WHERE id = :id"),
                {"id": folder_id},
            )
