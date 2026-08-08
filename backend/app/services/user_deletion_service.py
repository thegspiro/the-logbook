"""
Support for permanently deleting a member.

What happens to rows that reference a member being hard-deleted is decided by
the ``ON DELETE`` action on each foreign key, and the schema is not uniform.
Most of the ~280 references to ``users.id`` declare ``SET NULL`` or
``CASCADE``, but a long tail of attribution columns (``created_by``,
``approved_by``, ``issued_by`` ...) was never given one. MySQL defaults those
to RESTRICT, so any member who has ever created a record blocks their own
deletion with errno 1451.

Those constraints are unnamed in the models, which makes altering ~60 of them
in a migration fragile — Alembic would first have to resolve MySQL's generated
``<table>_ibfk_N`` names out of information_schema. So this module produces the
intended outcome at delete time instead, driven by ``Base.metadata``:

- nullable RESTRICT-by-default references are cleared first, which is the same
  ``SET NULL`` outcome the rest of the schema declares — attribution to a row
  that is about to cease existing carries no information anyway;
- NOT NULL ones cannot be cleared, so they are reported as blockers and the
  caller refuses the delete with an explanation. Rewriting them to point at
  some other member would falsify who requested a purchase or filed an
  expense report; the member should be deactivated and anonymized instead,
  which strips their PII while leaving the record owned.

Deriving both lists from metadata rather than a hand-maintained constant means
tables added later are covered without editing this file.
"""

from functools import lru_cache

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.schema import ForeignKey

from app.core.database import Base

# Referential actions MySQL carries out by itself when the user row goes away.
# Anything else (including an unset ondelete, which MySQL reads as NO ACTION)
# leaves the referencing row in place and aborts the DELETE.
_DB_HANDLED_ACTIONS = frozenset({"CASCADE", "SET NULL", "SET DEFAULT"})

_USER_TABLE = "users"

# ``(table_name, column_name)`` pairs.
_ReferenceSet = tuple[tuple[str, str], ...]


def _targets_user_id(foreign_key: ForeignKey) -> bool:
    """True when *foreign_key* points at ``users.id``."""
    # target_fullname is "users.id", or "<schema>.users.id" when qualified.
    return foreign_key.target_fullname.split(".")[-2:] == [_USER_TABLE, "id"]


@lru_cache(maxsize=1)
def _classify_references() -> tuple[_ReferenceSet, _ReferenceSet]:
    """
    Split the ``users.id`` references MySQL will not resolve on its own.

    Returns ``(clearable, blocking)`` as ``(table_name, column_name)`` pairs:
    *clearable* can be set to NULL before the delete, *blocking* cannot.
    """
    # Side-effect import: guarantees every model module has registered its
    # table on Base.metadata before we walk it, however this service is
    # reached. Nothing from the package is used directly.
    import app.models  # noqa: F401

    clearable: list[tuple[str, str]] = []
    blocking: list[tuple[str, str]] = []

    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            for foreign_key in column.foreign_keys:
                if not _targets_user_id(foreign_key):
                    continue
                action = (foreign_key.ondelete or "").strip().upper()
                if action in _DB_HANDLED_ACTIONS:
                    continue
                bucket = clearable if column.nullable else blocking
                bucket.append((table.name, column.name))

    return tuple(clearable), tuple(blocking)


def _group_by_table(references: _ReferenceSet) -> dict[str, list[str]]:
    """Collapse ``(table, column)`` pairs into ``{table: [columns]}``."""
    grouped: dict[str, list[str]] = {}
    for table_name, column_name in references:
        grouped.setdefault(table_name, []).append(column_name)
    return grouped


async def find_hard_delete_blockers(
    db: AsyncSession, user_id: str
) -> list[tuple[str, int]]:
    """
    Records that require an owner and therefore block deleting *user_id*.

    Returns ``(table_name, row_count)`` per affected table, most rows first.
    An empty list means the member can be hard-deleted.
    """
    _, blocking = _classify_references()

    blockers: list[tuple[str, int]] = []
    for table_name, column_names in _group_by_table(blocking).items():
        table = Base.metadata.tables[table_name]
        count = await db.scalar(
            select(func.count())
            .select_from(table)
            .where(or_(*(table.c[name] == user_id for name in column_names)))
        )
        if count:
            blockers.append((table_name, int(count)))

    return sorted(blockers, key=lambda blocker: (-blocker[1], blocker[0]))


def describe_blockers(blockers: list[tuple[str, int]]) -> str:
    """Render `find_hard_delete_blockers` output for an error message."""
    parts = []
    for table_name, count in blockers:
        label = table_name.replace("_", " ")
        # Table names are plural, so a single row reads as "1 budget".
        if count == 1 and label.endswith("s"):
            label = label[:-1]
        parts.append(f"{count} {label}")
    return ", ".join(parts)


async def release_user_references(db: AsyncSession, user_id: str) -> int:
    """
    NULL out every reference to *user_id* that MySQL would otherwise RESTRICT.

    Leaves the transaction open — the caller deletes the user and commits, so
    a failure anywhere in the sequence rolls the clearing back with it.

    Returns the number of rows updated.
    """
    clearable, _ = _classify_references()

    released = 0
    for table_name, column_name in clearable:
        table = Base.metadata.tables[table_name]
        result = await db.execute(
            update(table)
            .where(table.c[column_name] == user_id)
            .values({column_name: None})
        )
        released += result.rowcount or 0

    return released
