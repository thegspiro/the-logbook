"""
Support for permanently deleting a member.

What happens to rows that reference a member being hard-deleted is decided by
the ``ON DELETE`` action on each foreign key, and the schema is not uniform.
Most of the ~280 references to ``users.id`` declare ``SET NULL`` or
``CASCADE``, but a long tail of attribution columns (``created_by``,
``approved_by``, ``issued_by`` ...) is ``RESTRICT`` — declared explicitly in
the models since 2026-09, and MySQL's default before that — so any member who
has ever created a record blocks their own deletion with errno 1451.

Those constraints are unnamed in the models, which makes altering ~60 of them
in a migration fragile — Alembic would first have to resolve MySQL's generated
``<table>_ibfk_N`` names out of information_schema. So this module produces the
intended outcome at delete time instead, driven by ``Base.metadata``:

- nullable RESTRICT references are cleared first, which is the same
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

import importlib
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

from sqlalchemy import func, literal, or_, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.schema import ForeignKey

from app.core.database import Base
from app.models.inventory import CheckOutRecord, InventoryItem, ItemIssuance
from app.utils.sql_results import rows_affected

# Referential actions MySQL carries out by itself when the user row goes away.
# Anything else (RESTRICT, NO ACTION, or an unset ondelete, which MySQL reads
# as NO ACTION) leaves the referencing row in place and aborts the DELETE.
_DB_HANDLED_ACTIONS = frozenset({"CASCADE", "SET NULL", "SET DEFAULT"})

_USER_TABLE = "users"

# ``(table_name, column_name)`` pairs.
_ReferenceSet = tuple[tuple[str, str], ...]


def _targets_user_id(foreign_key: ForeignKey) -> bool:
    """True when *foreign_key* points at ``users.id``."""
    # target_fullname is "users.id", or "<schema>.users.id" when qualified.
    target: str = foreign_key.target_fullname
    return target.split(".")[-2:] == [_USER_TABLE, "id"]


def _register_all_models() -> None:
    """
    Guarantee every model module has registered its table on
    ``Base.metadata`` before a scan walks it, however this service is reached.

    ``import_module`` rather than a bare ``import app.models``: the package is
    wanted for its side effect only, and a bare import of an unused name is
    what flake8's F401 exists to flag.
    """
    importlib.import_module("app.models")


@lru_cache(maxsize=1)
def _cascading_references() -> _ReferenceSet:
    """
    ``(table_name, column_name)`` of every ``users.id`` reference declared
    ``ON DELETE CASCADE``: the rows a permanent delete removes outright.

    Read from the models for the same reason as the RESTRICT scan below — a
    table added later is reported without anyone remembering to list it. A
    hand-written list is how the deletion preview came to mention training
    records and inventory while the delete also took RSVPs, attendance, dues,
    qualifications, service history and consent records with it.
    """
    _register_all_models()

    cascading: list[tuple[str, str]] = []
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            for foreign_key in column.foreign_keys:
                if not _targets_user_id(foreign_key):
                    continue
                if (foreign_key.ondelete or "").strip().upper() == "CASCADE":
                    cascading.append((table.name, column.name))
    return tuple(sorted(cascading))


@lru_cache(maxsize=1)
def _classify_references() -> tuple[_ReferenceSet, _ReferenceSet]:
    """
    Split the ``users.id`` references MySQL will not resolve on its own.

    Returns ``(clearable, blocking)`` as ``(table_name, column_name)`` pairs:
    *clearable* can be set to NULL before the delete, *blocking* cannot.
    """
    _register_all_models()

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
        released += rows_affected(result) or 0

    return released


# Words a plain underscore-to-space rendering would get wrong in a label.
_LABEL_WORDS = {
    "ip": "IP",
    "mcp": "MCP",
    "nfc": "NFC",
    "nfpa": "NFPA",
    "oauth": "OAuth",
    "rsvp": "RSVP",
    "rsvps": "RSVPs",
}


def _label_for_table(table_name: str) -> str:
    """``event_rsvps`` -> ``Event RSVPs``: a readable name derived, not typed."""
    words = [_LABEL_WORDS.get(word, word) for word in table_name.split("_")]
    label = " ".join(words)
    return label[:1].upper() + label[1:]


@dataclass(frozen=True)
class RemovedRecordCount:
    """Rows in one table that a permanent delete removes with the member."""

    table: str
    label: str
    count: int


async def count_records_removed_with_member(
    db: AsyncSession, user_id: str, organization_id: str
) -> list[RemovedRecordCount]:
    """
    How many rows each ``ON DELETE CASCADE`` reference would take with
    *user_id*, largest first, omitting tables with none.

    One statement regardless of how many tables reference ``users``: every
    per-table count is a branch of a single ``UNION ALL``, so the preview
    costs one round trip and stays bounded as tables are added.

    Org-scoped twice over: the caller has already resolved *user_id* within
    *organization_id*, and every table that carries ``organization_id`` is
    additionally filtered on it. Only direct references are counted — a row
    that cascades from one of these (a requirement's progress under a
    program enrollment) goes too, and the dialog says so in words.
    """
    branches = []
    for table_name, column_name in _cascading_references():
        table = Base.metadata.tables[table_name]
        conditions = [table.c[column_name] == user_id]
        if "organization_id" in table.c:
            conditions.append(table.c.organization_id == organization_id)
        branches.append(
            select(
                literal(table_name).label("table_name"),
                literal(column_name).label("column_name"),
                func.count().label("row_count"),
            )
            .select_from(table)
            .where(*conditions)
        )
    if not branches:
        return []

    totals: dict[str, int] = {}
    for table_name, _column_name, row_count in (
        await db.execute(union_all(*branches))
    ).all():
        if row_count:
            totals[table_name] = totals.get(table_name, 0) + int(row_count)

    removed = [
        RemovedRecordCount(table=name, label=_label_for_table(name), count=count)
        for name, count in totals.items()
    ]
    return sorted(removed, key=lambda r: (-r.count, r.label))


@dataclass
class InventoryReturnSummary:
    """What :func:`return_member_inventory` put back."""

    unassigned: int = 0
    pool_returns: int = 0
    checked_in: int = 0

    @property
    def total(self) -> int:
        return self.unassigned + self.pool_returns + self.checked_in


_HARD_DELETE_RETURN_NOTE = "Returned to stock: the member was permanently deleted."


async def return_member_inventory(
    db: AsyncSession, user_id: str, organization_id: str, performed_by: str
) -> InventoryReturnSummary:
    """
    Put everything *user_id* still holds back in stock, inside the caller's
    transaction.

    The holding rows (``item_assignments``, ``item_issuances``,
    ``checkout_records``) CASCADE with the member and
    ``inventory_items.assigned_to_user_id`` is SET NULL, so a bare delete left
    an individual item reading ``assigned`` to nobody, a checked-out one
    ``checked_out`` forever, and a pool's ``quantity_issued`` counting units
    no record accounts for. Each holding goes through the inventory
    service's own return path — the one a quartermaster's return uses — so
    status, condition, lots and pool counts move exactly as they would for a
    real return; no stock arithmetic is repeated here.

    ``commit=False`` keeps all of it in the open transaction: the caller
    deletes the member and commits once, and a failure anywhere rolls the
    returns back with the delete. The service methods take their own row
    locks (item first, then holding), so the unlocked reads below only name
    candidates; a holding returned concurrently is reported back as already
    returned and skipped.

    Checked-out gear is checked in at the item's recorded condition: there is
    no inspection to go by, and inventing a worse one would quarantine
    serviceable gear.
    """
    # Imported here: inventory_service imports half the model layer, and this
    # module is loaded by the users endpoint on every request path.
    from app.services.inventory_service import InventoryService

    service = InventoryService(db)
    org = UUID(str(organization_id))
    summary = InventoryReturnSummary()

    assigned_ids = (
        await db.execute(
            select(InventoryItem.id).where(
                InventoryItem.assigned_to_user_id == user_id,
                InventoryItem.organization_id == organization_id,
            )
        )
    ).scalars()
    for item_id in list(assigned_ids):
        ok, _ = await service.unassign_item(
            UUID(str(item_id)),
            org,
            returned_by=performed_by,
            return_notes=_HARD_DELETE_RETURN_NOTE,
            expected_user_id=UUID(str(user_id)),
            commit=False,
        )
        summary.unassigned += int(ok)

    issuance_ids = (
        await db.execute(
            select(ItemIssuance.id).where(
                ItemIssuance.user_id == user_id,
                ItemIssuance.organization_id == organization_id,
                or_(
                    ItemIssuance.is_returned.is_(False),
                    ItemIssuance.is_returned.is_(None),
                ),
            )
        )
    ).scalars()
    for issuance_id in list(issuance_ids):
        ok, _ = await service.return_to_pool(
            UUID(str(issuance_id)),
            org,
            returned_by=performed_by,
            return_notes=_HARD_DELETE_RETURN_NOTE,
            commit=False,
        )
        summary.pool_returns += int(ok)

    checkouts = (
        await db.execute(
            select(CheckOutRecord.id, InventoryItem.condition)
            .join(InventoryItem, InventoryItem.id == CheckOutRecord.item_id)
            .where(
                CheckOutRecord.user_id == user_id,
                CheckOutRecord.organization_id == organization_id,
                InventoryItem.organization_id == organization_id,
                or_(
                    CheckOutRecord.is_returned.is_(False),
                    CheckOutRecord.is_returned.is_(None),
                ),
            )
        )
    ).all()
    for checkout_id, condition in checkouts:
        ok, _ = await service.checkin_item(
            UUID(str(checkout_id)),
            org,
            checked_in_by=performed_by,
            return_condition=condition,
            damage_notes=_HARD_DELETE_RETURN_NOTE,
            commit=False,
        )
        summary.checked_in += int(ok)

    return summary
