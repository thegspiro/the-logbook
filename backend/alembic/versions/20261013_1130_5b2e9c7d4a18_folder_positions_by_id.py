"""Store a document folder's positions by id, not slug.

Revision ID: 5b2e9c7d4a18
Revises: 4d8807bdd737
Create Date: 2026-10-13 11:30:00.000000

``document_folders.allowed_roles`` named positions by slug. A slug outlives its
position: delete the Quartermaster position and its folders refuse everybody,
then create a new position with the same slug and it silently inherits them.
Ids are never reused, so the column now holds ``positions.id`` values, and
deleting a position takes it out of every folder (RoleService.delete_role).

Each folder's slugs are looked up among its own organization's positions. A
slug that matches none (its position was already deleted) is kept as it is:
it can never equal an id, so the folder stays as closed as it is today rather
than opening to the whole department because its list became empty.

Downgrade maps ids back to slugs the same way; anything that matches no
position is kept unchanged.
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "5b2e9c7d4a18"
down_revision = "4d8807bdd737"
branch_labels = None
depends_on = None


def _convert(to_ids: bool) -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if not {"document_folders", "positions"} <= tables:
        return
    lookup: dict[tuple[str, str], str] = {}
    for org_id, position_id, slug in bind.execute(
        sa.text("SELECT organization_id, id, slug FROM positions")
    ):
        if to_ids:
            lookup[(str(org_id), str(slug))] = str(position_id)
        else:
            lookup[(str(org_id), str(position_id))] = str(slug)

    rows = bind.execute(
        sa.text(
            "SELECT id, organization_id, allowed_roles FROM document_folders "
            "WHERE allowed_roles IS NOT NULL"
        )
    ).fetchall()
    for folder_id, org_id, raw in rows:
        entries = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
        if not isinstance(entries, list) or not entries:
            continue
        converted = [lookup.get((str(org_id), str(entry)), entry) for entry in entries]
        if converted != entries:
            bind.execute(
                sa.text(
                    "UPDATE document_folders SET allowed_roles = :value WHERE id = :id"
                ),
                {"value": json.dumps(converted), "id": folder_id},
            )


def upgrade() -> None:
    _convert(to_ids=True)


def downgrade() -> None:
    _convert(to_ids=False)
