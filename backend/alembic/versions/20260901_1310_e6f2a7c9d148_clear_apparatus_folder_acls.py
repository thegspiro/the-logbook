"""Clear the facilities ACL mistakenly stamped on apparatus folders

``a9c4e7b2f631`` added ``document_folders.required_permissions`` to gate the
facility tree on facilities.view_sensitive/edit/manage. The apparatus
sub-folder writer had that same list copy-pasted into it, so every apparatus
sub-folder — Maintenance, Manuals, Inspections — was gated on *facilities*
permissions it has nothing to do with. An apparatus officer holding the
apparatus and document grants but no facilities grant could not open a truck's
own manuals.

Removing the line fixes apparatus folders created from now on. This is the
other half: the folders already on disk keep the stored list, so an
installation would behave one way for its existing trucks and another for the
next one added.

Matched on the exact stored list as well as the slug, so a department that
deliberately set its own ACL on an apparatus folder keeps it. Scoped by slug
prefix, which ``ensure_apparatus_folder`` assigns and users cannot edit.

The downgrade is deliberately empty: restoring the list would re-lock truck
manuals behind facilities permissions, which is the defect rather than a prior
state worth returning to.

Guarded on the table existing: fresh installs come up through ``create_all`` +
stamp-head rather than this chain (CLAUDE.md pitfall #26).
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e6f2a7c9d148"
down_revision = "d5e1f6a8b037"
branch_labels = None
depends_on = None

_TABLE = "document_folders"
_MISTAKEN = [
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column(_TABLE, "required_permissions"):
        return

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, required_permissions FROM document_folders "
            "WHERE slug LIKE 'apparatus-%' "
            "AND required_permissions IS NOT NULL"
        )
    ).fetchall()

    # Compared in Python rather than as a SQL string: the column is JSON, and
    # MySQL and MariaDB do not agree on how a JSON array renders back out, so
    # matching on text would clear nothing on one of them and look correct on
    # the other.
    doomed = []
    for row_id, stored in rows:
        value = json.loads(stored) if isinstance(stored, str) else stored
        if isinstance(value, list) and sorted(value) == sorted(_MISTAKEN):
            doomed.append(row_id)

    for start in range(0, len(doomed), 500):
        bind.execute(
            sa.text(
                "UPDATE document_folders SET required_permissions = NULL "
                "WHERE id IN :ids"
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": doomed[start : start + 500]},
        )


def downgrade() -> None:
    # Deliberately empty: see the module docstring.
    pass
