"""Gate the facility document folders on the facilities permission set.

Revision ID: a9c4e7b2f631
Revises: d4e5f6a7b8c9
Create Date: 2026-08-27 18:00:00.000000

The facility Files section stores each file's bytes as a row in ``documents``
and keeps only a reference on the facility record. The record is gated on
facilities.view_sensitive/edit/manage; the document was not, so the protected
half pointed at an unprotected file. Folders had no way to express that gate —
``allowed_roles`` names role slugs, which a department renames — so this adds
``document_folders.required_permissions`` and stamps it on the facility tree.

Backfills the folders already created, since ``ensure_facility_folder`` only
stamps folders it creates and every department running the Files section
already has an unstamped tree. Scoped to the facility tree by slug: the
``facilities`` system root, its children, and their children.

Not reversible in the meaningful sense: the downgrade drops the column, which
returns those folders to organization-wide readability. That is the state this
revision exists to end, so the downgrade is for a schema rollback only.
"""

import sqlalchemy as sa
from alembic import op

revision = "a9c4e7b2f631"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None

_PERMISSIONS = '["facilities.view_sensitive", "facilities.edit", "facilities.manage"]'


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "document_folders" not in sa.inspect(bind).get_table_names():
        return

    if not _has_column("document_folders", "required_permissions"):
        op.add_column(
            "document_folders",
            sa.Column("required_permissions", sa.JSON(), nullable=True),
        )

    # The facilities root, per-facility folders, and their sub-folders. Matched
    # by slug rather than by walking parent_id so the statement stays a single
    # UPDATE on every engine; the slugs are assigned by ensure_facility_folder
    # and are not user-editable.
    bind.execute(
        sa.text(
            "UPDATE document_folders SET required_permissions = :perms "
            "WHERE required_permissions IS NULL "
            "AND (slug = 'facilities' OR slug LIKE 'facility-%')"
        ),
        {"perms": _PERMISSIONS},
    )


def downgrade() -> None:
    if _has_column("document_folders", "required_permissions"):
        op.drop_column("document_folders", "required_permissions")
