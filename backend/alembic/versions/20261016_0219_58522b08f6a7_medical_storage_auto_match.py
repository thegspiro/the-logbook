"""File medical supplies under the storage area their free text names.

Revision ID: 58522b08f6a7
Revises: c903fc771081
Create Date: 2026-10-16 02:19:09.122235

Medical supplies used to record where they are kept only as free text
(``inventory_items.storage_location``, e.g. "Medical Cabinet"), while the rest
of Inventory files items under structured storage areas. The medical supply
form now offers those areas, and the department chose to carry the existing
text across automatically rather than re-file every supply by hand.

**The rule.** A medical supply (its category's ``item_type`` is ``medical``)
with no storage area and non-empty free text is filed under an active storage
area of its own organization whose name matches the text — compared with
surrounding and repeated whitespace removed and case ignored. Only when
exactly one active area matches: two areas called "Shelf 1" in different
cabinets is a guess, and a guess here files a supply where nobody will find
it. Everything else is left as it was.

The free text is kept. It becomes the note shown beside the area, and the
supply page hides it when it merely repeats the area's name, so nothing a
department typed is lost.

``location_id`` is not touched: the room is resolved from the area when the
supply is shown, and an item that already names a room keeps it.

**Frozen.** The matching rule is inlined rather than imported, so this
revision keeps doing what it did the day it ran whatever later code does.

**Why each step is guarded.** ``storage_areas`` is created by a migration, but
the check costs nothing and keeps a database built some other way from
failing the whole upgrade (CLAUDE.md pitfall #26). With any table missing
there is nothing to match, and skipping is correct.

**Downgrade** clears the storage area on medical supplies whose free text
still matches their area's name by the same rule — the rows this revision
filed. It cannot tell those from a supply someone filed by hand afterwards
under an area whose name matches its text; that supply loses its area too.
Its free text survives in both cases, so the location is never lost, only
its link.
"""

from typing import Dict, List, Sequence, Tuple, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "58522b08f6a7"
down_revision: Union[str, None] = "c903fc771081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("inventory_items", "inventory_categories", "storage_areas")
_BATCH = 500


def _norm(text: object) -> str:
    """Case-folded, with runs of whitespace collapsed and the ends trimmed."""
    return " ".join(str(text or "").split()).casefold()


def _has_tables() -> bool:
    present = set(sa.inspect(op.get_bind()).get_table_names())
    return all(t in present for t in _TABLES)


def _medical_items(conn: sa.engine.Connection, *, filed: bool) -> List[sa.Row]:
    area_clause = (
        "i.storage_area_id IS NOT NULL" if filed else "i.storage_area_id IS NULL"
    )
    return list(
        conn.execute(
            sa.text(
                "SELECT i.id, i.organization_id, i.storage_location, "
                "i.storage_area_id "
                "FROM inventory_items i "
                "JOIN inventory_categories c ON c.id = i.category_id "
                "WHERE c.item_type = 'medical' "
                "AND i.storage_location IS NOT NULL "
                "AND TRIM(i.storage_location) <> '' "
                f"AND {area_clause}"
            )
        )
    )


def upgrade() -> None:
    if not _has_tables():
        return
    conn = op.get_bind()

    # (org, normalized name) -> the matching active area ids.
    names: Dict[Tuple[str, str], List[str]] = {}
    for area_id, org_id, name in conn.execute(
        sa.text(
            "SELECT id, organization_id, name FROM storage_areas " "WHERE is_active = 1"
        )
    ):
        key = (str(org_id), _norm(name))
        if key[1]:
            names.setdefault(key, []).append(str(area_id))

    updates: List[Dict[str, str]] = []
    for item_id, org_id, text, _area in _medical_items(conn, filed=False):
        matches = names.get((str(org_id), _norm(text)), [])
        if len(matches) == 1:
            updates.append({"item_id": str(item_id), "area_id": matches[0]})

    statement = sa.text(
        "UPDATE inventory_items SET storage_area_id = :area_id "
        "WHERE id = :item_id AND storage_area_id IS NULL"
    )
    for start in range(0, len(updates), _BATCH):
        conn.execute(statement, updates[start : start + _BATCH])


def downgrade() -> None:
    if not _has_tables():
        return
    conn = op.get_bind()

    area_names = {
        str(area_id): _norm(name)
        for area_id, name in conn.execute(sa.text("SELECT id, name FROM storage_areas"))
    }
    cleared = [
        {"item_id": str(item_id)}
        for item_id, _org, text, area_id in _medical_items(conn, filed=True)
        if area_names.get(str(area_id)) == _norm(text)
    ]
    statement = sa.text(
        "UPDATE inventory_items SET storage_area_id = NULL WHERE id = :item_id"
    )
    for start in range(0, len(cleared), _BATCH):
        conn.execute(statement, cleared[start : start + _BATCH])
