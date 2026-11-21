"""
Historical apparatus: the trucks, wagons and engines in a department's
history, their unit numbers over time, and their publication.

History's own records (owner decision 1, phase 5). A record can start from an
Apparatus-module truck: its descriptive details are copied once and the link
kept only to say where it came from and to stop a second record from the
same truck. Nothing operational is copied — no price, VIN, plate,
financing, insurance or maintenance figure — and nothing syncs afterwards.

The same three audiences as every History record: the archive's keepers read
drafts and research notes; other members read what is published to members
or the public, without the research notes or the fleet link; the public
(phase 7) gets the cleared snapshot.

Every query filters ``organization_id``; every client-sent id is resolved
inside the caller's department before it is stored (CLAUDE.md pitfall #14).
"""

import copy
from datetime import date
from typing import Any, Optional

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus
from app.models.history import (
    ApparatusDisposition,
    DatePrecision,
    HistoryApparatus,
    HistoryApparatusDesignation,
    HistorySource,
    PublicationLevel,
    RevisionKind,
)
from app.services.history_lists_service import (
    APPARATUS_TYPES,
    STATIONS,
    HistoryListService,
)
from app.services.history_records import (
    READABLE_BY_MEMBERS,
    PublishedRecordService,
    can_read_record,
)
from app.services.history_service import Viewer, normalize_partial_date
from app.utils.model_updates import apply_updates
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

RECORD_APPARATUS = "apparatus"

CATALOGUE_FIELDS = (
    "name",
    "apparatus_type_id",
    "year",
    "make",
    "model",
    "body_builder",
    "pump_gpm",
    "tank_gallons",
    "ladder_feet",
    "in_service_date",
    "in_service_precision",
    "in_service_circa",
    "out_of_service_date",
    "out_of_service_precision",
    "out_of_service_circa",
    "disposition",
    "current_location",
    "description",
    "research_notes",
    "source_id",
    "accession_number",
)

#: Everything a reader sees. A change to any of these needs clearing again
#: before the public sees it; research notes, the source and the accession
#: number are the archive's own housekeeping.
SUBSTANTIAL_FIELDS = frozenset(CATALOGUE_FIELDS) - {
    "research_notes",
    "source_id",
    "accession_number",
}

_TEXT_FIELDS = (
    "name",
    "make",
    "model",
    "body_builder",
    "current_location",
    "description",
    "research_notes",
    "accession_number",
)

_SEARCHED = (
    HistoryApparatus.name,
    HistoryApparatus.make,
    HistoryApparatus.model,
    HistoryApparatus.body_builder,
    HistoryApparatus.description,
    HistoryApparatus.current_location,
)

#: How the fleet's free-text disposal method reads as a disposition. Checked
#: in order; anything unrecognized is "unknown" rather than a guess.
_DISPOSAL_WORDS = (
    ("museum", ApparatusDisposition.MUSEUM),
    ("preserv", ApparatusDisposition.PRESERVED),
    ("trade", ApparatusDisposition.TRADED),
    ("scrap", ApparatusDisposition.SCRAPPED),
    ("sold", ApparatusDisposition.SOLD),
    ("sale", ApparatusDisposition.SOLD),
)


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else _enum_value(value)


def _clean(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(values)
    for field in _TEXT_FIELDS:
        if field in cleaned and isinstance(cleaned[field], str):
            cleaned[field] = cleaned[field].strip() or None
    return cleaned


def _year(value: Optional[date], circa: bool) -> Optional[str]:
    if value is None:
        return None
    return f"c. {value.year}" if circa else str(value.year)


def service_span(item: HistoryApparatus) -> Optional[str]:
    """ "1924–1968", "c. 1911–", "1998–present", or None with no dates."""
    start = _year(item.in_service_date, item.in_service_circa)
    if item.disposition == ApparatusDisposition.IN_SERVICE:
        return f"{start or '?'}–present"
    end = _year(item.out_of_service_date, item.out_of_service_circa)
    if start is None and end is None:
        return None
    if end is None:
        return f"{start}–"
    if start is None:
        return f"?–{end}"
    return start if start == end else f"{start}–{end}"


def _designation_order(designation: HistoryApparatusDesignation) -> tuple:
    return (designation.start_date or date.min, designation.sort_order)


def fleet_disposition(fleet: Apparatus) -> ApparatusDisposition:
    if not fleet.is_archived:
        return ApparatusDisposition.IN_SERVICE
    method = (fleet.disposal_method or "").casefold()
    for word, disposition in _DISPOSAL_WORDS:
        if word in method:
            return disposition
    if fleet.sold_date is not None:
        return ApparatusDisposition.SOLD
    return ApparatusDisposition.UNKNOWN


class HistoryApparatusService(PublishedRecordService[HistoryApparatus]):
    record_type = RECORD_APPARATUS
    noun = "apparatus record"

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.stations = HistoryListService(db, STATIONS)
        self.types = HistoryListService(db, APPARATUS_TYPES)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @staticmethod
    def _options():
        return (
            selectinload(HistoryApparatus.apparatus_type),
            selectinload(HistoryApparatus.source),
            selectinload(HistoryApparatus.fleet_apparatus),
            selectinload(HistoryApparatus.designations).selectinload(
                HistoryApparatusDesignation.station
            ),
        )

    async def get_apparatus(
        self, organization_id: str, apparatus_id: str
    ) -> Optional[HistoryApparatus]:
        return await self.db.scalar(
            select(HistoryApparatus)
            .options(*self._options())
            .where(
                HistoryApparatus.id == str(apparatus_id),
                HistoryApparatus.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )

    async def _reload(self, item: HistoryApparatus) -> HistoryApparatus:
        reloaded = await self.get_apparatus(item.organization_id, item.id)
        if reloaded is None:
            raise ValueError("This apparatus record could not be read back")
        return reloaded

    @staticmethod
    def can_read(viewer: Viewer, item: HistoryApparatus) -> bool:
        return can_read_record(viewer.can_view_archive, item)

    async def get_readable_apparatus(
        self, viewer: Viewer, apparatus_id: str
    ) -> Optional[HistoryApparatus]:
        item = await self.get_apparatus(viewer.organization_id, apparatus_id)
        if item is None or not self.can_read(viewer, item):
            return None
        return item

    async def list_apparatus(
        self,
        viewer: Viewer,
        *,
        search: Optional[str] = None,
        apparatus_type_id: Optional[str] = None,
        station_id: Optional[str] = None,
        decade: Optional[int] = None,
        level: Optional[PublicationLevel] = None,
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[HistoryApparatus], int]:
        conditions = [HistoryApparatus.organization_id == viewer.organization_id]
        if not viewer.can_view_archive:
            conditions.append(
                HistoryApparatus.publication_level.in_(READABLE_BY_MEMBERS)
            )
        elif level is not None:
            conditions.append(HistoryApparatus.publication_level == level)
        if apparatus_type_id:
            conditions.append(
                HistoryApparatus.apparatus_type_id == str(apparatus_type_id)
            )
        designation = HistoryApparatusDesignation
        if search and search.strip():
            pattern = like_pattern(search.strip())
            conditions.append(
                or_(
                    *(
                        column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                        for column in _SEARCHED
                    ),
                    exists(
                        select(designation.id).where(
                            designation.apparatus_id == HistoryApparatus.id,
                            designation.designation.ilike(
                                pattern, escape=LIKE_ESCAPE_CHAR
                            ),
                        )
                    ),
                    *(
                        [HistoryApparatus.year == int(search.strip())]
                        if search.strip().isdigit()
                        else []
                    ),
                )
            )
        if station_id:
            conditions.append(
                exists(
                    select(designation.id).where(
                        designation.apparatus_id == HistoryApparatus.id,
                        designation.station_id == str(station_id),
                    )
                )
            )
        if decade is not None:
            conditions.append(self._served_in_decade(decade))
        total = int(
            await self.db.scalar(
                select(func.count()).select_from(HistoryApparatus).where(*conditions)
            )
            or 0
        )
        result = await self.db.execute(
            select(HistoryApparatus)
            .options(*self._options())
            .where(*conditions)
            .order_by(
                HistoryApparatus.in_service_date.is_(None),
                HistoryApparatus.in_service_date,
                HistoryApparatus.year.is_(None),
                HistoryApparatus.year,
                HistoryApparatus.name,
                HistoryApparatus.id,
            )
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().unique().all()), total

    @staticmethod
    def _served_in_decade(decade: int):
        start = date(decade, 1, 1)
        end = date(decade + 9, 12, 31)
        item = HistoryApparatus
        return (
            item.in_service_date.is_not(None)
            & (item.in_service_date <= end)
            & (
                (item.out_of_service_date >= start)
                | (
                    item.out_of_service_date.is_(None)
                    & (
                        (item.disposition == ApparatusDisposition.IN_SERVICE)
                        | (item.in_service_date >= start)
                    )
                )
            )
        )

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @staticmethod
    def designation_view(designation: HistoryApparatusDesignation) -> dict[str, Any]:
        return {
            "id": designation.id,
            "designation": designation.designation,
            "station_id": designation.station_id,
            "station_name": (
                designation.station.name if designation.station is not None else None
            ),
            "start_date": designation.start_date,
            "start_precision": designation.start_precision,
            "start_circa": designation.start_circa,
            "end_date": designation.end_date,
            "end_precision": designation.end_precision,
            "end_circa": designation.end_circa,
        }

    def _designations(self, item: HistoryApparatus) -> list[dict[str, Any]]:
        return [
            self.designation_view(d)
            for d in sorted(item.designations, key=_designation_order)
        ]

    def summary(self, item: HistoryApparatus) -> dict[str, Any]:
        ordered = sorted(item.designations, key=_designation_order)
        return {
            "id": item.id,
            "name": item.name,
            "apparatus_type_name": (
                item.apparatus_type.name if item.apparatus_type is not None else None
            ),
            "year": item.year,
            "make": item.make,
            "model": item.model,
            "designations": [d.designation for d in ordered],
            "service_span": service_span(item),
            "disposition": item.disposition,
            "publication_level": item.publication_level,
        }

    def _catalogue(self, item: HistoryApparatus) -> dict[str, Any]:
        view: dict[str, Any] = {
            field: getattr(item, field)
            for field in CATALOGUE_FIELDS
            if field != "research_notes"
        }
        view.update(
            {
                "id": item.id,
                "apparatus_type_name": (
                    item.apparatus_type.name
                    if item.apparatus_type is not None
                    else None
                ),
                "source_name": item.source.name if item.source is not None else None,
                "designations": self._designations(item),
                "service_span": service_span(item),
                "publication_level": item.publication_level,
            }
        )
        return view

    def member_view(self, item: HistoryApparatus) -> dict[str, Any]:
        view = self._catalogue(item)
        view["view"] = "member"
        return view

    def full_view(
        self,
        viewer: Viewer,
        item: HistoryApparatus,
        clearance: Optional[dict[str, Any]],
        *,
        clearance_required: bool,
        cleared_for_public: bool,
    ) -> dict[str, Any]:
        view = self._catalogue(item)
        fleet = item.fleet_apparatus
        view.update(
            {
                "view": "full",
                "research_notes": item.research_notes,
                "fleet_apparatus_id": item.fleet_apparatus_id,
                "fleet_label": fleet.display_name if fleet is not None else None,
                "published_at": item.published_at,
                "revision_number": item.revision_number,
                "public_revision_number": item.public_revision_number,
                "public_changes_pending": self.public_changes_pending(item),
                "clearance": clearance,
                "clearance_required": clearance_required,
                "cleared_for_public": cleared_for_public,
                "can_edit": viewer.can_manage,
                "can_publish": viewer.can_publish,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
            }
        )
        return view

    # ------------------------------------------------------------------
    # Change history
    # ------------------------------------------------------------------

    def _snapshot(self, item: HistoryApparatus) -> dict[str, Any]:
        data = {field: _iso(getattr(item, field)) for field in CATALOGUE_FIELDS}
        data["fleet_apparatus_id"] = item.fleet_apparatus_id
        data["designations"] = [
            {
                "designation": d.designation,
                "station_id": d.station_id,
                "start_date": _iso(d.start_date),
                "start_precision": _enum_value(d.start_precision),
                "start_circa": d.start_circa,
                "end_date": _iso(d.end_date),
                "end_precision": _enum_value(d.end_precision),
                "end_circa": d.end_circa,
            }
            for d in sorted(item.designations, key=_designation_order)
        ]
        return data

    def _public_snapshot(self, item: HistoryApparatus) -> dict[str, Any]:
        """What the public may see: the catalogue without the research notes
        or the fleet link, with list entries by name."""
        snapshot = copy.deepcopy(
            {
                key: value
                for key, value in self._snapshot(item).items()
                if key
                not in (
                    "research_notes",
                    "fleet_apparatus_id",
                    "source_id",
                    "apparatus_type_id",
                    "designations",
                )
            }
        )
        snapshot["source_name"] = item.source.name if item.source else None
        snapshot["apparatus_type_name"] = (
            item.apparatus_type.name if item.apparatus_type else None
        )
        snapshot["designations"] = [
            {
                key: _iso(value)
                for key, value in self.designation_view(d).items()
                if key not in ("id", "station_id")
            }
            for d in sorted(item.designations, key=_designation_order)
        ]
        return snapshot

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def _validated_source_id(
        self, organization_id: str, source_id: Optional[str]
    ) -> Optional[str]:
        if not source_id:
            return None
        found = await self.db.scalar(
            select(HistorySource.id).where(
                HistorySource.id == str(source_id),
                HistorySource.organization_id == str(organization_id),
            )
        )
        if found is None:
            raise ValueError("That source is not on this department's list")
        return str(found)

    async def _validated_references(
        self, organization_id: str, values: dict[str, Any]
    ) -> dict[str, Any]:
        if "source_id" in values:
            values["source_id"] = await self._validated_source_id(
                organization_id, values["source_id"]
            )
        if "apparatus_type_id" in values:
            values["apparatus_type_id"] = await self.types.validated_id(
                organization_id, values["apparatus_type_id"]
            )
        return values

    @staticmethod
    def _settle_dates(item: HistoryApparatus) -> None:
        item.in_service_date = normalize_partial_date(
            item.in_service_date, item.in_service_precision or DatePrecision.YEAR
        )
        item.out_of_service_date = normalize_partial_date(
            item.out_of_service_date,
            item.out_of_service_precision or DatePrecision.YEAR,
        )
        if (
            item.in_service_date
            and item.out_of_service_date
            and item.out_of_service_date < item.in_service_date
        ):
            raise ValueError("An apparatus cannot leave service before it enters it")

    async def _write_designations(
        self, item: HistoryApparatus, designations: list[dict[str, Any]]
    ) -> None:
        for existing in list(item.designations):
            await self.db.delete(existing)
        await self.db.flush()
        for index, values in enumerate(designations):
            text = (values.get("designation") or "").strip()
            if not text:
                raise ValueError("Enter the unit number for each designation")
            station_id = await self.stations.validated_id(
                item.organization_id, values.get("station_id")
            )
            self.db.add(
                HistoryApparatusDesignation(
                    apparatus_id=item.id,
                    designation=text[:100],
                    station_id=station_id,
                    start_date=normalize_partial_date(
                        values.get("start_date"), values.get("start_precision")
                    ),
                    start_precision=values.get("start_precision") or DatePrecision.YEAR,
                    start_circa=bool(values.get("start_circa")),
                    end_date=normalize_partial_date(
                        values.get("end_date"), values.get("end_precision")
                    ),
                    end_precision=values.get("end_precision") or DatePrecision.YEAR,
                    end_circa=bool(values.get("end_circa")),
                    sort_order=index,
                )
            )
        await self.db.flush()

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def create(
        self,
        organization_id: str,
        values: dict[str, Any],
        designations: list[dict[str, Any]],
        actor_id: str,
        *,
        fleet_apparatus_id: Optional[str] = None,
    ) -> HistoryApparatus:
        values = _clean(values)
        if not values.get("name"):
            raise ValueError("Enter a name")
        values = await self._validated_references(organization_id, values)
        item = HistoryApparatus(
            organization_id=str(organization_id),
            fleet_apparatus_id=fleet_apparatus_id,
            created_by=actor_id,
            updated_by=actor_id,
            revision_number=1,
            substantial_revision_number=1,
        )
        for field in CATALOGUE_FIELDS:
            if values.get(field) is not None:
                setattr(item, field, values[field])
        self._settle_dates(item)
        self.db.add(item)
        await self.db.flush()
        created = await self._reload(item)
        await self._write_designations(created, designations)
        created = await self._reload(created)
        await self._log(created, RevisionKind.CREATED, actor_id, with_snapshot=True)
        return created

    async def update(
        self,
        item: HistoryApparatus,
        values: dict[str, Any],
        designations: Optional[list[dict[str, Any]]],
        *,
        edit_kind: str,
        edit_note: Optional[str],
        actor_id: str,
    ) -> HistoryApparatus:
        values = _clean(values)
        if "name" in values and not values["name"]:
            raise ValueError("Enter a name")
        values = await self._validated_references(item.organization_id, values)
        before = self._snapshot(item)
        apply_updates(
            item,
            {k: v for k, v in values.items() if k in CATALOGUE_FIELDS},
            skip=set(),
        )
        self._settle_dates(item)
        item.updated_by = actor_id
        await self.db.flush()
        if designations is not None:
            await self._write_designations(item, designations)
        reloaded = await self._reload(item)
        after = self._snapshot(reloaded)
        changed = before["designations"] != after["designations"] or any(
            before[field] != after[field] for field in SUBSTANTIAL_FIELDS
        )
        return await self._after_edit(
            reloaded, edit_kind == "substantial" or changed, edit_note, actor_id
        )

    # ------------------------------------------------------------------
    # From the fleet
    # ------------------------------------------------------------------

    async def _recorded_fleet_ids(self, organization_id: str) -> dict[str, str]:
        result = await self.db.execute(
            select(HistoryApparatus.fleet_apparatus_id, HistoryApparatus.id).where(
                HistoryApparatus.organization_id == str(organization_id),
                HistoryApparatus.fleet_apparatus_id.is_not(None),
            )
        )
        return {str(fleet_id): str(record_id) for fleet_id, record_id in result.all()}

    async def fleet_options(self, organization_id: str) -> list[dict[str, Any]]:
        """The department's fleet trucks, current and previously owned, each
        with the History record already made from it, if any."""
        recorded = await self._recorded_fleet_ids(organization_id)
        result = await self.db.execute(
            select(Apparatus)
            .where(Apparatus.organization_id == str(organization_id))
            .order_by(Apparatus.is_archived, Apparatus.unit_number)
        )
        return [
            {
                "id": fleet.id,
                "unit_number": fleet.unit_number,
                "name": fleet.name,
                "description": fleet.full_description,
                "is_archived": bool(fleet.is_archived),
                "history_apparatus_id": recorded.get(str(fleet.id)),
            }
            for fleet in result.scalars().all()
        ]

    async def create_from_fleet(
        self, organization_id: str, fleet_apparatus_id: str, actor_id: str
    ) -> HistoryApparatus:
        """Start a History record from a fleet truck, copying its descriptive
        details once. Refused when the truck already has a record."""
        fleet = await self.db.scalar(
            select(Apparatus)
            .options(
                selectinload(Apparatus.apparatus_type),
                selectinload(Apparatus.primary_station),
            )
            .where(
                Apparatus.id == str(fleet_apparatus_id),
                Apparatus.organization_id == str(organization_id),
            )
        )
        if fleet is None:
            raise ValueError("Apparatus not found")
        if str(fleet.id) in await self._recorded_fleet_ids(organization_id):
            raise ValueError("This truck already has a History record")
        disposition = fleet_disposition(fleet)
        left = fleet.disposal_date or fleet.sold_date
        # A department that has never opened its type list has none yet, and
        # the truck's type could match nothing.
        await self.types.ensure_defaults(organization_id)
        type_entry = (
            await self.types.by_name(organization_id, fleet.apparatus_type.name)
            if fleet.apparatus_type is not None
            else None
        )
        station = (
            await self.stations.by_name(organization_id, fleet.primary_station.name)
            if fleet.primary_station is not None
            else None
        )
        values: dict[str, Any] = {
            "name": fleet.display_name,
            "apparatus_type_id": type_entry.id if type_entry is not None else None,
            "year": fleet.year,
            "make": fleet.make,
            "model": fleet.model,
            "body_builder": fleet.body_manufacturer,
            "pump_gpm": fleet.pump_capacity_gpm,
            "tank_gallons": fleet.tank_capacity_gallons,
            "ladder_feet": fleet.ladder_length_feet,
            "in_service_date": fleet.in_service_date,
            "in_service_precision": DatePrecision.DAY,
            "out_of_service_date": left if fleet.is_archived else None,
            "out_of_service_precision": DatePrecision.DAY,
            "disposition": disposition,
        }
        designation = {
            "designation": fleet.unit_number,
            "station_id": station.id if station is not None else None,
            "start_date": fleet.in_service_date,
            "start_precision": DatePrecision.DAY,
            "end_date": values["out_of_service_date"],
            "end_precision": DatePrecision.DAY,
        }
        return await self.create(
            organization_id,
            values,
            [designation],
            actor_id,
            fleet_apparatus_id=str(fleet.id),
        )
