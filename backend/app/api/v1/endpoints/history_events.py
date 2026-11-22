"""
History events, historical apparatus, the timeline and "Today in history"
(``/api/v1/history``, gated on the module), plus the three managed lists they
use: stations, apparatus types and event types.

Who receives what is decided by the server, as for every History record:
members read what is published to members or the public, without research
notes; the archive's keepers read everything, drafts included. The timeline
and "Today in history" apply the same rule to every entry they compute, and
a line-of-duty death appears to members only when the death date's own
visibility allows it.

Starting an apparatus record from a fleet truck also needs the Apparatus
module to be on: with it off there is no fleet to start from.

Audit entries carry ids, never titles, names or descriptions.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_module,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.history import (
    HistoryApparatus,
    HistoryEvent,
    PublicationLevel,
)
from app.models.user import User
from app.schemas.history import (
    ApparatusCreate,
    ApparatusFullView,
    ApparatusList,
    ApparatusMemberView,
    ApparatusSummary,
    ApparatusUpdate,
    ApparatusView,
    EventCreate,
    EventFullView,
    EventList,
    EventMemberView,
    EventSummary,
    EventUpdate,
    EventView,
    FleetApparatusCreate,
    FleetOption,
    HistoryListEntryCreate,
    HistoryListEntryMerge,
    HistoryListEntryResponse,
    HistoryListEntryUpdate,
    PublishRequest,
    RevisionResponse,
    TimelineDecade,
    TimelineEntry,
    TimelineKind,
    UnpublishRequest,
)
from app.services.history_apparatus_service import (
    RECORD_APPARATUS,
    HistoryApparatusService,
)
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_event_service import RECORD_EVENT, HistoryEventService
from app.services.history_lists_service import (
    APPARATUS_TYPES,
    EVENT_TYPES,
    STATIONS,
    EntryT,
    HistoryListService,
    ListKind,
)
from app.services.history_service import HistoryService, Viewer
from app.services.history_timeline_service import HistoryTimelineService
from app.utils.org_timezone import resolve_org_today

router = APIRouter()

_APPARATUS = "Apparatus"
_EVENT = "Event"

#: The links an event write may set, as the service names them.
_EVENT_LINKS = ("members", "apparatus_ids", "media_ids", "document_ids")


async def _audit(db: AsyncSession, user: User, event_type: str, data: dict) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="history",
        severity="info",
        event_data={"organization_id": str(user.organization_id), **data},
        user_id=str(user.id),
        username=user.username,
    )


async def _clearance_state(
    db: AsyncSession, viewer: Viewer, record_type: str, item: Any, label: str
) -> dict[str, Any]:
    clearance = HistoryClearanceService(db)
    latest = await clearance.latest_request(
        viewer.organization_id, record_type, item.id
    )
    return {
        "clearance": (
            await clearance.request_view(
                latest, record_label=label, viewer_id=viewer.user_id
            )
            if latest
            else None
        ),
        "clearance_required": bool(await clearance.list_steps(viewer.organization_id)),
        "cleared_for_public": await clearance.is_cleared(
            viewer.organization_id,
            record_type,
            item.id,
            item.substantial_revision_number,
        ),
    }


async def _revisions(
    db: AsyncSession, viewer: Viewer, record_type: str, record_id: str
) -> list[RevisionResponse]:
    revisions = await HistoryService(db).revisions(
        viewer.organization_id, record_type, record_id
    )
    return [
        RevisionResponse(
            id=r.id,
            revision_number=r.revision_number,
            kind=r.kind,
            note=r.note,
            actor_name=r.actor.full_name if r.actor else None,
            created_at=r.created_at,
        )
        for r in revisions
    ]


async def _may_read_revisions(db: AsyncSession, viewer: Viewer) -> None:
    """The archive's keepers and the members on the clearance list read a
    record's change history; nobody else does."""
    if not viewer.can_view_archive and not await HistoryClearanceService(db).is_clearer(
        viewer.organization_id, viewer.user_id
    ):
        raise HTTPException(status_code=403, detail="Not allowed")


def _check_decade(decade: Optional[int]) -> None:
    if decade is not None and decade % 10:
        raise HTTPException(status_code=400, detail="A decade starts on a 0 year")


# ----------------------------------------------------------------------
# Managed lists: stations, apparatus types, event types
# ----------------------------------------------------------------------


def _entry_response(entry: Any, usage: int = 0) -> HistoryListEntryResponse:
    return HistoryListEntryResponse(
        id=entry.id,
        name=entry.name,
        sort_order=entry.sort_order,
        is_retired=entry.is_retired,
        usage_count=usage,
    )


async def _list_entries(
    db: AsyncSession, user: User, kind: ListKind[EntryT], include_retired: bool
) -> list[HistoryListEntryResponse]:
    rows = await HistoryListService(db, kind).list_entries(
        str(user.organization_id), include_retired=include_retired
    )
    # The first read may have created the starting list.
    await db.commit()
    return [_entry_response(entry, usage) for entry, usage in rows]


async def _create_entry(
    db: AsyncSession, user: User, kind: ListKind[EntryT], name: str, event_type: str
) -> HistoryListEntryResponse:
    async with handle_service_errors(f"Could not add this {kind.noun}"):
        entry = await HistoryListService(db, kind).create_entry(
            str(user.organization_id), name, str(user.id)
        )
    await db.commit()
    await _audit(db, user, event_type, {"entry_id": entry.id})
    return _entry_response(entry)


async def _update_entry(
    db: AsyncSession,
    user: User,
    kind: ListKind[EntryT],
    entry_id: str,
    payload: HistoryListEntryUpdate,
    event_type: str,
) -> HistoryListEntryResponse:
    service = HistoryListService(db, kind)
    entry = ensure_found(
        await service.get_entry(str(user.organization_id), entry_id),
        kind.noun.capitalize(),
    )
    async with handle_service_errors(f"Could not save this {kind.noun}"):
        entry = await service.update_entry(
            entry, payload.model_dump(exclude_unset=True)
        )
    await db.commit()
    await _audit(db, user, event_type, {"entry_id": entry_id})
    return _entry_response(entry)


async def _merge_entry(
    db: AsyncSession,
    user: User,
    kind: ListKind[EntryT],
    entry_id: str,
    payload: HistoryListEntryMerge,
    event_type: str,
) -> HistoryListEntryResponse:
    org_id = str(user.organization_id)
    service = HistoryListService(db, kind)
    noun = kind.noun.capitalize()
    entry = ensure_found(await service.get_entry(org_id, entry_id), noun)
    target = ensure_found(await service.get_entry(org_id, payload.into_id), noun)
    async with handle_service_errors(f"Could not merge these {kind.noun}s"):
        target = await service.merge_entry(entry, target)
    await db.commit()
    await _audit(db, user, event_type, {"entry_id": entry_id, "into_id": target.id})
    return _entry_response(target)


@router.get("/stations", response_model=list[HistoryListEntryResponse])
async def list_stations(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's managed list of station names, used by events and by
    apparatus designations.

    **Authentication required**
    """
    return await _list_entries(db, current_user, STATIONS, include_retired)


@router.post("/stations", response_model=HistoryListEntryResponse, status_code=201)
async def create_station(
    payload: HistoryListEntryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a station name to the list.

    **Requires permission: history.manage**
    """
    return await _create_entry(
        db, current_user, STATIONS, payload.name, "history_station_created"
    )


@router.patch("/stations/{entry_id}", response_model=HistoryListEntryResponse)
async def update_station(
    entry_id: str,
    payload: HistoryListEntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename a station, which corrects it on every event and designation, or
    retire it so it is no longer offered.

    **Requires permission: history.manage**
    """
    return await _update_entry(
        db, current_user, STATIONS, entry_id, payload, "history_station_updated"
    )


@router.post("/stations/{entry_id}/merge", response_model=HistoryListEntryResponse)
async def merge_station(
    entry_id: str,
    payload: HistoryListEntryMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Move every event and designation from one station name to another, then
    remove the first.

    **Requires permission: history.manage**
    """
    return await _merge_entry(
        db, current_user, STATIONS, entry_id, payload, "history_station_merged"
    )


@router.get("/apparatus-types", response_model=list[HistoryListEntryResponse])
async def list_apparatus_types(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's managed list of apparatus types. A department with none
    starts with Engine, Ladder or truck, Tanker or tender, Rescue, Ambulance,
    Brush, Hose wagon, Steamer, Hand-drawn, Chief's or command car and Other.

    **Authentication required**
    """
    return await _list_entries(db, current_user, APPARATUS_TYPES, include_retired)


@router.post(
    "/apparatus-types", response_model=HistoryListEntryResponse, status_code=201
)
async def create_apparatus_type(
    payload: HistoryListEntryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add an apparatus type to the list.

    **Requires permission: history.manage**
    """
    return await _create_entry(
        db,
        current_user,
        APPARATUS_TYPES,
        payload.name,
        "history_apparatus_type_created",
    )


@router.patch("/apparatus-types/{entry_id}", response_model=HistoryListEntryResponse)
async def update_apparatus_type(
    entry_id: str,
    payload: HistoryListEntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename an apparatus type, or retire it so it is no longer offered.

    **Requires permission: history.manage**
    """
    return await _update_entry(
        db,
        current_user,
        APPARATUS_TYPES,
        entry_id,
        payload,
        "history_apparatus_type_updated",
    )


@router.post(
    "/apparatus-types/{entry_id}/merge", response_model=HistoryListEntryResponse
)
async def merge_apparatus_type(
    entry_id: str,
    payload: HistoryListEntryMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Move every apparatus of one type to another, then remove the first.

    **Requires permission: history.manage**
    """
    return await _merge_entry(
        db,
        current_user,
        APPARATUS_TYPES,
        entry_id,
        payload,
        "history_apparatus_type_merged",
    )


@router.get("/event-types", response_model=list[HistoryListEntryResponse])
async def list_event_types(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's managed list of event types. A department with none
    starts with Fire or incident, Station, Apparatus, Organisation, Ceremony
    or celebration, Line-of-duty death, Community and Other.

    **Authentication required**
    """
    return await _list_entries(db, current_user, EVENT_TYPES, include_retired)


@router.post("/event-types", response_model=HistoryListEntryResponse, status_code=201)
async def create_event_type(
    payload: HistoryListEntryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add an event type to the list.

    **Requires permission: history.manage**
    """
    return await _create_entry(
        db, current_user, EVENT_TYPES, payload.name, "history_event_type_created"
    )


@router.patch("/event-types/{entry_id}", response_model=HistoryListEntryResponse)
async def update_event_type(
    entry_id: str,
    payload: HistoryListEntryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename an event type, or retire it so it is no longer offered.

    **Requires permission: history.manage**
    """
    return await _update_entry(
        db, current_user, EVENT_TYPES, entry_id, payload, "history_event_type_updated"
    )


@router.post("/event-types/{entry_id}/merge", response_model=HistoryListEntryResponse)
async def merge_event_type(
    entry_id: str,
    payload: HistoryListEntryMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Move every event of one type to another, then remove the first.

    **Requires permission: history.manage**
    """
    return await _merge_entry(
        db, current_user, EVENT_TYPES, entry_id, payload, "history_event_type_merged"
    )


# ----------------------------------------------------------------------
# Historical apparatus
# ----------------------------------------------------------------------


async def _managed_apparatus(
    db: AsyncSession, user: User, apparatus_id: str
) -> HistoryApparatus:
    return ensure_found(
        await HistoryApparatusService(db).get_apparatus(
            str(user.organization_id), apparatus_id
        ),
        _APPARATUS,
    )


async def _apparatus_full(
    db: AsyncSession, viewer: Viewer, item: HistoryApparatus
) -> ApparatusFullView:
    state = await _clearance_state(db, viewer, RECORD_APPARATUS, item, item.name)
    return ApparatusFullView(
        **HistoryApparatusService(db).full_view(
            viewer,
            item,
            state["clearance"],
            clearance_required=state["clearance_required"],
            cleared_for_public=state["cleared_for_public"],
        )
    )


async def _reloaded_apparatus(
    db: AsyncSession, user: User, apparatus_id: str
) -> ApparatusFullView:
    # Re-read after every write: on MySQL the database-set timestamps are not
    # returned with an INSERT or UPDATE.
    item = await _managed_apparatus(db, user, apparatus_id)
    return await _apparatus_full(db, Viewer.of(user), item)


@router.get("/apparatus", response_model=ApparatusList)
async def list_apparatus(
    search: Optional[str] = Query(None, max_length=100),
    apparatus_type_id: Optional[str] = Query(None, max_length=36),
    station_id: Optional[str] = Query(None, max_length=36),
    decade: Optional[int] = Query(None, ge=1700, le=2100),
    level: Optional[PublicationLevel] = None,
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The archive's historical apparatus. Search covers the name, unit numbers,
    make, model, body builder, description, where it is now, and the year.
    A decade lists what was in service during it. Members see what is
    published; the archive's keepers also see drafts and may filter by level.

    **Authentication required**
    """
    _check_decade(decade)
    service = HistoryApparatusService(db)
    items, total = await service.list_apparatus(
        Viewer.of(current_user),
        search=search,
        apparatus_type_id=apparatus_type_id,
        station_id=station_id,
        decade=decade,
        level=level,
        limit=limit,
        offset=offset,
    )
    return ApparatusList(
        items=[ApparatusSummary(**service.summary(i)) for i in items], total=total
    )


@router.post("/apparatus", response_model=ApparatusFullView, status_code=201)
async def create_apparatus(
    payload: ApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a historical apparatus, as a draft, with its unit numbers over time.

    **Requires permission: history.manage**
    """
    values = payload.model_dump(exclude_unset=True)
    designations = values.pop("designations", [])
    async with handle_service_errors("Could not add this apparatus"):
        item = await HistoryApparatusService(db).create(
            str(current_user.organization_id),
            values,
            designations,
            str(current_user.id),
        )
    await db.commit()
    await _audit(
        db, current_user, "history_apparatus_created", {"apparatus_id": item.id}
    )
    return await _reloaded_apparatus(db, current_user, item.id)


@router.get(
    "/apparatus/fleet-options",
    response_model=list[FleetOption],
    dependencies=[Depends(require_module("apparatus", "Apparatus"))],
)
async def list_fleet_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    The department's Apparatus-module trucks, current and previously owned,
    to start a History record from. Each says whether it already has one.
    Needs the Apparatus module on.

    **Requires permission: history.manage**
    """
    return [
        FleetOption(**option)
        for option in await HistoryApparatusService(db).fleet_options(
            str(current_user.organization_id)
        )
    ]


@router.post(
    "/apparatus/from-fleet",
    response_model=ApparatusFullView,
    status_code=201,
    dependencies=[Depends(require_module("apparatus", "Apparatus"))],
)
async def create_apparatus_from_fleet(
    payload: FleetApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Start a History record from an Apparatus-module truck, as a draft. Its
    name, type, year, make, model, body builder, pump, tank and ladder
    figures, unit number, in-service date and disposal are copied once;
    nothing syncs afterwards, and no price, VIN, plate, financing or
    maintenance figure is copied. A truck has at most one History record.
    Needs the Apparatus module on.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not start a record from this truck"):
        try:
            item = await HistoryApparatusService(db).create_from_fleet(
                str(current_user.organization_id),
                payload.fleet_apparatus_id,
                str(current_user.id),
            )
            await db.commit()
        except IntegrityError as exc:
            # Two requests for the same truck at once: the unique key, not
            # the read before it, is what decides (pitfall #36).
            await db.rollback()
            raise HTTPException(
                status_code=409, detail="This truck already has a History record"
            ) from exc
    await _audit(
        db,
        current_user,
        "history_apparatus_created",
        {"apparatus_id": item.id, "fleet_apparatus_id": payload.fleet_apparatus_id},
    )
    return await _reloaded_apparatus(db, current_user, item.id)


@router.get("/apparatus/{apparatus_id}", response_model=ApparatusView)
async def get_apparatus(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One historical apparatus. Members receive the published view; the
    archive's keepers receive every field.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryApparatusService(db)
    item = ensure_found(
        await service.get_readable_apparatus(viewer, apparatus_id), _APPARATUS
    )
    if viewer.can_view_archive:
        return await _apparatus_full(db, viewer, item)
    return ApparatusMemberView(**service.member_view(item))


@router.patch("/apparatus/{apparatus_id}", response_model=ApparatusFullView)
async def update_apparatus(
    apparatus_id: str,
    payload: ApparatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit the catalogue, and replace the unit numbers when they are sent. A
    change to anything a reader sees is recorded as substantial whatever was
    chosen, so a public record keeps its cleared version until the change is
    cleared.

    **Requires permission: history.manage**
    """
    item = await _managed_apparatus(db, current_user, apparatus_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind", "minor")
    edit_note = values.pop("edit_note", None)
    designations = values.pop("designations", None)
    async with handle_service_errors("Could not save this apparatus"):
        await HistoryApparatusService(db).update(
            item,
            values,
            designations,
            edit_kind=edit_kind,
            edit_note=edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_apparatus_updated",
        {
            "apparatus_id": apparatus_id,
            "fields": sorted(values)
            + (["designations"] if designations is not None else []),
        },
    )
    return await _reloaded_apparatus(db, current_user, apparatus_id)


@router.delete("/apparatus/{apparatus_id}", status_code=204)
async def delete_apparatus(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a draft apparatus record, its unit numbers and its links to
    events, photos and documents. A published one is unpublished first. The
    fleet truck it was made from, if any, is untouched.

    **Requires permission: history.manage**
    """
    item = await _managed_apparatus(db, current_user, apparatus_id)
    async with handle_service_errors("Could not delete this apparatus"):
        await HistoryApparatusService(db).delete(item)
    await db.commit()
    await _audit(
        db, current_user, "history_apparatus_deleted", {"apparatus_id": apparatus_id}
    )


@router.post("/apparatus/{apparatus_id}/publish", response_model=ApparatusFullView)
async def publish_apparatus(
    apparatus_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the clearance list has cleared
    the record's latest substantial revision.

    **Requires permission: history.publish**
    """
    item = await _managed_apparatus(db, current_user, apparatus_id)
    async with handle_service_errors("Could not publish this apparatus"):
        await HistoryApparatusService(db).publish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_apparatus_published",
        {"apparatus_id": apparatus_id, "level": payload.level},
    )
    return await _reloaded_apparatus(db, current_user, apparatus_id)


@router.post("/apparatus/{apparatus_id}/unpublish", response_model=ApparatusFullView)
async def unpublish_apparatus(
    apparatus_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Return an apparatus record to members only, or to draft.

    **Requires permission: history.publish**
    """
    item = await _managed_apparatus(db, current_user, apparatus_id)
    async with handle_service_errors("Could not unpublish this apparatus"):
        await HistoryApparatusService(db).unpublish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_apparatus_unpublished",
        {"apparatus_id": apparatus_id, "level": payload.level},
    )
    return await _reloaded_apparatus(db, current_user, apparatus_id)


@router.get(
    "/apparatus/{apparatus_id}/revisions", response_model=list[RevisionResponse]
)
async def list_apparatus_revisions(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The apparatus record's change history. Readable by the archive's keepers
    and by members holding a position on the department's clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    await _may_read_revisions(db, viewer)
    item = await _managed_apparatus(db, current_user, apparatus_id)
    return await _revisions(db, viewer, RECORD_APPARATUS, item.id)


@router.get("/apparatus/{apparatus_id}/timeline", response_model=list[TimelineEntry])
async def apparatus_timeline(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    An apparatus's own timeline: entering and leaving service, its changes
    of unit number, and the events it took part in that the caller may read.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    item = ensure_found(
        await HistoryApparatusService(db).get_readable_apparatus(viewer, apparatus_id),
        _APPARATUS,
    )
    return [
        TimelineEntry(**entry)
        for entry in await HistoryTimelineService(db).for_apparatus(viewer, item)
    ]


# ----------------------------------------------------------------------
# Events
# ----------------------------------------------------------------------


async def _managed_event(db: AsyncSession, user: User, event_id: str) -> HistoryEvent:
    return ensure_found(
        await HistoryEventService(db).get_event(str(user.organization_id), event_id),
        _EVENT,
    )


async def _event_full(
    db: AsyncSession, viewer: Viewer, item: HistoryEvent
) -> EventFullView:
    state = await _clearance_state(db, viewer, RECORD_EVENT, item, item.title)
    return EventFullView(
        **HistoryEventService(db).full_view(
            viewer,
            item,
            state["clearance"],
            clearance_required=state["clearance_required"],
            cleared_for_public=state["cleared_for_public"],
        )
    )


async def _reloaded_event(db: AsyncSession, user: User, event_id: str) -> EventFullView:
    item = await _managed_event(db, user, event_id)
    return await _event_full(db, Viewer.of(user), item)


def _split_event_payload(
    values: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    links = {key: values.pop(key) for key in _EVENT_LINKS if key in values}
    return values, links


@router.get("/events", response_model=EventList)
async def list_events(
    search: Optional[str] = Query(None, max_length=100),
    event_type_id: Optional[str] = Query(None, max_length=36),
    station_id: Optional[str] = Query(None, max_length=36),
    decade: Optional[int] = Query(None, ge=1700, le=2100),
    member_id: Optional[str] = Query(None, max_length=36),
    apparatus_id: Optional[str] = Query(None, max_length=36),
    level: Optional[PublicationLevel] = None,
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The archive's events, oldest first. Search covers the title, description
    and place. A decade lists events that ran during it. Members see what is
    published; the archive's keepers also see drafts and may filter by level.

    **Authentication required**
    """
    _check_decade(decade)
    service = HistoryEventService(db)
    items, total = await service.list_events(
        Viewer.of(current_user),
        search=search,
        event_type_id=event_type_id,
        station_id=station_id,
        decade=decade,
        member_id=member_id,
        apparatus_id=apparatus_id,
        level=level,
        limit=limit,
        offset=offset,
    )
    return EventList(
        items=[EventSummary(**service.summary(i)) for i in items], total=total
    )


@router.post("/events", response_model=EventFullView, status_code=201)
async def create_event(
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add an event, as a draft, with the people (each with an optional role),
    apparatus, photos and documents it links to.

    **Requires permission: history.manage**
    """
    values, links = _split_event_payload(payload.model_dump(exclude_unset=True))
    async with handle_service_errors("Could not add this event"):
        item = await HistoryEventService(db).create(
            str(current_user.organization_id), values, links, str(current_user.id)
        )
    await db.commit()
    await _audit(db, current_user, "history_event_created", {"event_id": item.id})
    return await _reloaded_event(db, current_user, item.id)


@router.get("/events/{event_id}", response_model=EventView)
async def get_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One event and what it links to. Members receive the published view, with
    only the people, apparatus, photos and documents they may read; the
    archive's keepers receive every field and link.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryEventService(db)
    item = ensure_found(await service.get_readable_event(viewer, event_id), _EVENT)
    if viewer.can_view_archive:
        return await _event_full(db, viewer, item)
    return EventMemberView(**service.member_view(viewer, item))


@router.patch("/events/{event_id}", response_model=EventFullView)
async def update_event(
    event_id: str,
    payload: EventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit the event, and replace any link set that is sent. A change to
    anything a reader sees, its links included, is recorded as substantial
    whatever was chosen.

    **Requires permission: history.manage**
    """
    item = await _managed_event(db, current_user, event_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind", "minor")
    edit_note = values.pop("edit_note", None)
    values, links = _split_event_payload(values)
    async with handle_service_errors("Could not save this event"):
        await HistoryEventService(db).update(
            item,
            values,
            links,
            edit_kind=edit_kind,
            edit_note=edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_event_updated",
        {"event_id": event_id, "fields": sorted([*values, *links])},
    )
    return await _reloaded_event(db, current_user, event_id)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a draft event and its links. The people, apparatus, photos and
    documents it linked to are untouched. A published event is unpublished
    first.

    **Requires permission: history.manage**
    """
    item = await _managed_event(db, current_user, event_id)
    async with handle_service_errors("Could not delete this event"):
        await HistoryEventService(db).delete(item)
    await db.commit()
    await _audit(db, current_user, "history_event_deleted", {"event_id": event_id})


@router.post("/events/{event_id}/publish", response_model=EventFullView)
async def publish_event(
    event_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the clearance list has cleared
    the event's latest substantial revision.

    **Requires permission: history.publish**
    """
    item = await _managed_event(db, current_user, event_id)
    async with handle_service_errors("Could not publish this event"):
        await HistoryEventService(db).publish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_event_published",
        {"event_id": event_id, "level": payload.level},
    )
    return await _reloaded_event(db, current_user, event_id)


@router.post("/events/{event_id}/unpublish", response_model=EventFullView)
async def unpublish_event(
    event_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Return an event to members only, or to draft.

    **Requires permission: history.publish**
    """
    item = await _managed_event(db, current_user, event_id)
    async with handle_service_errors("Could not unpublish this event"):
        await HistoryEventService(db).unpublish(
            item, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_event_unpublished",
        {"event_id": event_id, "level": payload.level},
    )
    return await _reloaded_event(db, current_user, event_id)


@router.get("/events/{event_id}/revisions", response_model=list[RevisionResponse])
async def list_event_revisions(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The event's change history. Readable by the archive's keepers and by
    members holding a position on the department's clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    await _may_read_revisions(db, viewer)
    item = await _managed_event(db, current_user, event_id)
    return await _revisions(db, viewer, RECORD_EVENT, item.id)


# ----------------------------------------------------------------------
# Timelines and "Today in history"
# ----------------------------------------------------------------------


@router.get("/timeline/decades", response_model=list[TimelineDecade])
async def timeline_decades(
    kinds: Optional[list[TimelineKind]] = Query(None, max_length=6),
    event_type_id: Optional[str] = Query(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    How many timeline entries each decade holds, oldest first, with the same
    filters as the timeline, so the page loads one decade at a time.

    **Authentication required**
    """
    return [
        TimelineDecade(**row)
        for row in await HistoryTimelineService(db).decades(
            Viewer.of(current_user), kinds=kinds, event_type_id=event_type_id
        )
    ]


@router.get("/timeline", response_model=list[TimelineEntry])
async def timeline(
    decade: int = Query(..., ge=1600, le=2200),
    kinds: Optional[list[TimelineKind]] = Query(None, max_length=6),
    event_type_id: Optional[str] = Query(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One decade of the department timeline: events, plus apparatus entering
    and leaving service, line-of-duty deaths, and the starts of titles the
    Historian has chosen to show. ``kinds`` narrows it (events only, for
    instance); ``event_type_id`` narrows the events. Each entry appears only
    when its record is readable to the caller.

    **Authentication required**
    """
    _check_decade(decade)
    return [
        TimelineEntry(**entry)
        for entry in await HistoryTimelineService(db).decade(
            Viewer.of(current_user),
            decade,
            kinds=kinds,
            event_type_id=event_type_id,
        )
    ]


@router.get("/today", response_model=list[TimelineEntry])
async def today_in_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    "Today in history": entries dated to the day whose day and month are
    today's on the department's calendar, in earlier years, oldest first.
    A year or month alone never matches a day.

    **Authentication required**
    """
    today = await resolve_org_today(db, str(current_user.organization_id))
    return [
        TimelineEntry(**entry)
        for entry in await HistoryTimelineService(db).today_in_history(
            Viewer.of(current_user), today
        )
    ]


@router.get("/people/{person_id}/timeline", response_model=list[TimelineEntry])
async def person_timeline(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    A person's own timeline: the events they took part in, their
    line-of-duty death, and every title they held with a date entered, as
    the caller may read them.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    person = ensure_found(
        await HistoryService(db).get_readable_person(viewer, person_id), "Person"
    )
    return [
        TimelineEntry(**entry)
        for entry in await HistoryTimelineService(db).for_person(viewer, person)
    ]
