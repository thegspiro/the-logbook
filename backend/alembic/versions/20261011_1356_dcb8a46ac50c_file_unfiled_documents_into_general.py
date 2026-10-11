"""File unfiled documents into each organization's General folder

A document with no ``folder_id`` was organization-level: readable and
downloadable by anyone holding ``documents.view``, outside every folder's
rights. Upload let the folder be left out, and a move could set it to null —
so a document taken *out* of a gated folder (Finance, Member Separations, a
personal folder) became readable by the whole organization. The application
now files a folderless upload or move into General Documents; this settles the
rows already there, so every document's access is decided by a folder.

General Documents is the shared-library system root (organization visibility,
no required permissions), so who can read each moved document is unchanged:
it was ``documents.view`` holders, it still is. What changes is that the
folder now governs it.

An organization that has unfiled documents but no General root (one created
before the root existed, whose Documents page was never opened) gets one,
built with the fields the root had on the day this ran. Those fields are
inlined rather than read from ``app.models.document.SYSTEM_FOLDERS`` because a
migration must keep doing what it did on the day it ran.

Reversible. Every moved document, and every General root this created, is
recorded in ``document_unfiled_backfill``. The downgrade returns a recorded
document to no folder only while it is still in the General root it was moved
to — one somebody has since filed elsewhere is left where they put it — then
removes a root it created if that root is empty, and drops the record.

This revision also joins the two heads ``3f3bd6f3c7e4`` and ``990e288940bc``,
which were published with the same parent (``4b7e1f0c9a2d``) and left the
chain with two heads.

Both tables are created by migrations, but each step is still skipped when one
is absent, so a database built another way cannot fail here.

Revision ID: dcb8a46ac50c
Revises: 3f3bd6f3c7e4, 990e288940bc
Create Date: 2026-10-11 13:56:23.081517

"""

import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "dcb8a46ac50c"
down_revision: Union[str, Sequence[str], None] = ("3f3bd6f3c7e4", "990e288940bc")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module constants so a test can point the migration at scratch copies.
DOCUMENTS = "documents"
FOLDERS = "document_folders"
RECORD = "document_unfiled_backfill"

# The General Documents system root as defined on 2026-10-11.
_GENERAL = {
    "slug": "general",
    "name": "General Documents",
    "description": "Miscellaneous department files",
    "sort_order": 6,
    "icon": "folder",
    "color": "text-slate-400",
    "visibility": "organization",
}


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _general_root(bind, organization_id: str):
    return bind.execute(
        sa.text(
            f"SELECT id FROM {FOLDERS} "
            "WHERE organization_id = :org AND slug = :slug "
            "AND is_system = 1 AND parent_id IS NULL "
            "ORDER BY created_at, id LIMIT 1"
        ),
        {"org": organization_id, "slug": _GENERAL["slug"]},
    ).scalar()


def upgrade() -> None:
    tables = _tables()
    if not {DOCUMENTS, FOLDERS} <= tables:
        return
    bind = op.get_bind()

    if RECORD not in tables:
        op.create_table(
            RECORD,
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            # Exactly one of the two is set per row: a moved document, or a
            # General root this revision had to create.
            sa.Column("document_id", sa.String(36), nullable=True),
            sa.Column("created_folder_id", sa.String(36), nullable=True),
            sa.Column("general_folder_id", sa.String(36), nullable=False),
        )

    organizations = (
        bind.execute(
            sa.text(
                f"SELECT DISTINCT organization_id FROM {DOCUMENTS} WHERE folder_id IS NULL"
            )
        )
        .scalars()
        .all()
    )

    for organization_id in organizations:
        general_id = _general_root(bind, organization_id)
        if general_id is None:
            general_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            bind.execute(
                sa.text(
                    f"INSERT INTO {FOLDERS} "
                    "(id, organization_id, name, slug, description, color, icon, "
                    "is_system, sort_order, parent_id, visibility, "
                    "created_at, updated_at) VALUES "
                    "(:id, :org, :name, :slug, :description, :color, :icon, "
                    "1, :sort_order, NULL, :visibility, :now, :now)"
                ),
                {"id": general_id, "org": organization_id, "now": now, **_GENERAL},
            )
            bind.execute(
                sa.text(
                    f"INSERT INTO {RECORD} "
                    "(organization_id, created_folder_id, general_folder_id) "
                    "VALUES (:org, :folder, :folder)"
                ),
                {"org": organization_id, "folder": general_id},
            )

        # Record before moving, in one statement each, so the record always
        # covers every row the update touches.
        bind.execute(
            sa.text(
                f"INSERT INTO {RECORD} "
                "(organization_id, document_id, general_folder_id) "
                f"SELECT organization_id, id, :folder FROM {DOCUMENTS} "
                "WHERE organization_id = :org AND folder_id IS NULL"
            ),
            {"org": organization_id, "folder": general_id},
        )
        bind.execute(
            sa.text(
                f"UPDATE {DOCUMENTS} SET folder_id = :folder "
                "WHERE organization_id = :org AND folder_id IS NULL"
            ),
            {"org": organization_id, "folder": general_id},
        )


def downgrade() -> None:
    tables = _tables()
    if RECORD not in tables:
        return
    bind = op.get_bind()
    if {DOCUMENTS, FOLDERS} <= tables:
        # Only documents still in the root they were moved to.
        bind.execute(
            sa.text(
                f"UPDATE {DOCUMENTS} d JOIN {RECORD} r ON r.document_id = d.id "
                "SET d.folder_id = NULL WHERE d.folder_id = r.general_folder_id"
            )
        )
        # A root this revision created goes only if nothing is in it now.
        bind.execute(
            sa.text(
                f"DELETE f FROM {FOLDERS} f JOIN {RECORD} r "
                "ON r.created_folder_id = f.id "
                f"WHERE NOT EXISTS (SELECT 1 FROM {DOCUMENTS} d WHERE d.folder_id = f.id) "
                "AND NOT EXISTS "
                f"(SELECT 1 FROM (SELECT parent_id FROM {FOLDERS}) c "
                "WHERE c.parent_id = f.id)"
            )
        )
    op.execute(f"DROP TABLE IF EXISTS {RECORD}")
