"""
The phase 5 managed lists: station names, apparatus types and event types.

Kept like sources and document types (owner decision): records point at an
entry rather than repeating its text, an entry in use is retired (kept on the
records that carry it, no longer offered) or merged into another, never
deleted out from under them. Correcting a misspelt station corrects it on
every event and designation at once, which is how the owner asked for
entries to be trackable and correctable (decision 12).

One service serves all three: they differ only in their model, their noun,
their starting entries and which columns point at them.
"""

from dataclasses import dataclass
from typing import Any, Callable, Generic, Optional, TypeVar, Union

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models.history import (
    HistoryApparatus,
    HistoryApparatusDesignation,
    HistoryApparatusType,
    HistoryEvent,
    HistoryEventType,
    HistoryStation,
)
from app.models.user import Organization
from app.services.history_service import clean_title_name, title_key

ListEntry = Union[HistoryStation, HistoryApparatusType, HistoryEventType]

#: A department's starting apparatus types, created the first time it reads
#: the list (owner-approved spec, 2026-11-21).
DEFAULT_APPARATUS_TYPES = (
    "Engine",
    "Ladder or truck",
    "Tanker or tender",
    "Rescue",
    "Ambulance",
    "Brush",
    "Hose wagon",
    "Steamer",
    "Hand-drawn",
    "Chief's or command car",
    "Other",
)

#: A department's starting event types.
DEFAULT_EVENT_TYPES = (
    "Fire or incident",
    "Station",
    "Apparatus",
    "Organisation",
    "Ceremony or celebration",
    "Line-of-duty death",
    "Community",
    "Other",
)


@dataclass(frozen=True)
class _Reference:
    """One column that points at a list entry, and how to reach the
    department's rows of it. ``update`` targets the model owning the column;
    a model without ``organization_id`` is constrained through ``scope``."""

    model: Any
    column: str
    #: Rows of ``model`` in the department, as a select of their ids.
    in_org: Callable[[str], Select]


def _org_rows(model: Any) -> Callable[[str], Select]:
    return lambda organization_id: select(model.id).where(
        model.organization_id == str(organization_id)
    )


def _designations_in_org(organization_id: str) -> Select:
    return select(HistoryApparatusDesignation.id).where(
        HistoryApparatusDesignation.apparatus_id.in_(
            select(HistoryApparatus.id).where(
                HistoryApparatus.organization_id == str(organization_id)
            )
        )
    )


#: One list's entry model. Each list's service is typed by its own, so a
#: station read from the station list is a ``HistoryStation``.
EntryT = TypeVar("EntryT", HistoryStation, HistoryApparatusType, HistoryEventType)


@dataclass(frozen=True)
class ListKind(Generic[EntryT]):
    model: type[EntryT]
    noun: str
    defaults: tuple[str, ...]
    references: tuple[_Reference, ...]


STATIONS: ListKind[HistoryStation] = ListKind(
    model=HistoryStation,
    noun="station",
    # No starting stations: a department's firehouses are its own.
    defaults=(),
    references=(
        _Reference(HistoryEvent, "station_id", _org_rows(HistoryEvent)),
        _Reference(HistoryApparatusDesignation, "station_id", _designations_in_org),
    ),
)
APPARATUS_TYPES: ListKind[HistoryApparatusType] = ListKind(
    model=HistoryApparatusType,
    noun="apparatus type",
    defaults=DEFAULT_APPARATUS_TYPES,
    references=(
        _Reference(HistoryApparatus, "apparatus_type_id", _org_rows(HistoryApparatus)),
    ),
)
EVENT_TYPES: ListKind[HistoryEventType] = ListKind(
    model=HistoryEventType,
    noun="event type",
    defaults=DEFAULT_EVENT_TYPES,
    references=(_Reference(HistoryEvent, "event_type_id", _org_rows(HistoryEvent)),),
)


class HistoryListService(Generic[EntryT]):
    def __init__(self, db: AsyncSession, kind: ListKind[EntryT]):
        self.db = db
        self.kind: ListKind[EntryT] = kind
        self._model: type[EntryT] = kind.model

    async def ensure_defaults(self, organization_id: str) -> None:
        """Give a department with an empty list its starting entries.

        Read-then-write with no unique key to lean on (two first readers
        would both see an empty list), so the insert runs under the
        organization row lock and re-checks there (pitfall #27). A list is
        filled exactly once: entries are retired, never deleted, so an empty
        list has never been filled.
        """
        if not self.kind.defaults or await self._count(organization_id):
            return
        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None or await self._count(organization_id, lock=True):
            return
        for position, name in enumerate(self.kind.defaults):
            self.db.add(
                self._model(
                    organization_id=str(organization_id),
                    name=name,
                    name_key=title_key(name)[:150],
                    sort_order=position,
                )
            )
        await self.db.flush()

    async def _count(self, organization_id: str, *, lock: bool = False) -> int:
        query = select(self._model.id).where(
            self._model.organization_id == str(organization_id)
        )
        if lock:
            query = query.with_for_update()
        return len((await self.db.execute(query)).scalars().all())

    async def _usage(self, organization_id: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for ref in self.kind.references:
            column = getattr(ref.model, ref.column)
            result = await self.db.execute(
                select(column, func.count())
                .where(
                    column.is_not(None),
                    ref.model.id.in_(ref.in_org(organization_id)),
                )
                .group_by(column)
            )
            for entry_id, uses in result.all():
                counts[str(entry_id)] = counts.get(str(entry_id), 0) + int(uses)
        return counts

    async def list_entries(
        self, organization_id: str, *, include_retired: bool
    ) -> list[tuple[EntryT, int]]:
        await self.ensure_defaults(organization_id)
        query = (
            select(self._model)
            .where(self._model.organization_id == str(organization_id))
            .order_by(self._model.sort_order, self._model.name)
        )
        if not include_retired:
            query = query.where(self._model.is_retired.is_(False))
        entries = list((await self.db.execute(query)).scalars().all())
        usage = await self._usage(organization_id)
        return [(entry, usage.get(entry.id, 0)) for entry in entries]

    async def get_entry(self, organization_id: str, entry_id: str) -> Optional[EntryT]:
        return await self.db.scalar(
            select(self._model).where(
                self._model.id == str(entry_id),
                self._model.organization_id == str(organization_id),
            )
        )

    async def validated_id(
        self, organization_id: str, entry_id: Optional[str]
    ) -> Optional[str]:
        """An entry id a client sent, confirmed to be on this department's
        list (pitfall #14c), or None for a blank."""
        if not entry_id:
            return None
        found = await self.get_entry(organization_id, entry_id)
        if found is None:
            raise ValueError(f"That {self.kind.noun} is not on this department's list")
        return str(found.id)

    async def by_name(self, organization_id: str, name: str) -> Optional[EntryT]:
        """The entry whose name matches *name* the way the list decides
        duplicates, if any."""
        cleaned = clean_title_name(name or "")
        if not cleaned:
            return None
        return await self._by_key(organization_id, title_key(cleaned))

    async def _by_key(self, organization_id: str, key: str) -> Optional[EntryT]:
        return await self.db.scalar(
            select(self._model).where(
                self._model.organization_id == str(organization_id),
                self._model.name_key == key[:150],
            )
        )

    async def create_entry(
        self, organization_id: str, name: str, actor_id: str
    ) -> EntryT:
        await self.ensure_defaults(organization_id)
        cleaned = clean_title_name(name)
        if not cleaned:
            raise ValueError(f"Enter a {self.kind.noun}")
        existing = await self._by_key(organization_id, title_key(cleaned))
        if existing:
            raise ValueError(f'"{existing.name}" is already on the list')
        highest = await self.db.scalar(
            select(func.max(self._model.sort_order)).where(
                self._model.organization_id == str(organization_id)
            )
        )
        entry = self._model(
            organization_id=str(organization_id),
            name=cleaned[:150],
            name_key=title_key(cleaned)[:150],
            sort_order=int(highest or 0) + 1,
            created_by=actor_id,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry)
        return entry

    async def update_entry(self, entry: EntryT, updates: dict[str, Any]) -> EntryT:
        if updates.get("name") is not None:
            cleaned = clean_title_name(updates["name"])
            if not cleaned:
                raise ValueError(f"Enter a {self.kind.noun}")
            clash = await self._by_key(entry.organization_id, title_key(cleaned))
            if clash and clash.id != entry.id:
                raise ValueError(
                    f'"{clash.name}" is already on the list — merge into it instead'
                )
            entry.name = cleaned[:150]
            entry.name_key = title_key(cleaned)[:150]
        if updates.get("is_retired") is not None:
            entry.is_retired = bool(updates["is_retired"])
        await self.db.flush()
        await self.db.refresh(entry)
        return entry

    async def merge_entry(self, entry: EntryT, target: EntryT) -> EntryT:
        """Point everything that uses *entry* at *target*, then remove
        *entry*."""
        if entry.id == target.id:
            raise ValueError(f"Choose a different {self.kind.noun} to merge into")
        if entry.organization_id != target.organization_id:
            raise ValueError(f"{self.kind.noun.capitalize()} not found")
        for ref in self.kind.references:
            column = getattr(ref.model, ref.column)
            # The ids are read first rather than used as a subquery: MySQL
            # refuses an UPDATE whose WHERE selects from the table being
            # updated (error 1093), though MariaDB accepts it.
            ids = list(
                (
                    await self.db.execute(
                        select(ref.model.id).where(
                            column == entry.id,
                            ref.model.id.in_(ref.in_org(entry.organization_id)),
                        )
                    )
                ).scalars()
            )
            if ids:
                await self.db.execute(
                    update(ref.model)
                    .where(ref.model.id.in_(ids))
                    .values({ref.column: target.id})
                    .execution_options(synchronize_session=False)
                )
        await self.db.delete(entry)
        await self.db.flush()
        await self.db.refresh(target)
        return target
