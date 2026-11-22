"""Community risk reduction (CRR): the department's activity catalogue, and
the activity log.

Who may do what (owner decisions, 2026-11-22):

* the catalogue and its settings: whoever manages events (``events.manage``);
* recording activities and reading the log: ``crr.record``, held by the
  Community Outreach Team and every seeded position with ``events.manage``
  (``events.manage`` is accepted too, for a department's own positions);
* a resident's address, contact and the notes: ``crr.view_contact``, the
  Community Outreach Manager and above. Every response that carries them is
  audited, once per request, by activity id and never by value.
"""

from datetime import datetime
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.crr import (
    CrrActivityCreate,
    CrrActivityListResponse,
    CrrActivityResponse,
    CrrActivityTypeCreate,
    CrrActivityTypeResponse,
    CrrActivityTypeUpdate,
    CrrActivityUpdate,
    CrrCatalogueResponse,
    CrrFormOptionsResponse,
    CrrMeasureCreate,
    CrrMeasureUpdate,
    CrrSettingsResponse,
    CrrSettingsUpdate,
    CrrTagCreate,
    CrrTagResponse,
    CrrTagUpdate,
    CrrTypeTagsUpdate,
    ZipLookupResponse,
)
from app.services.crr_activity_service import RESIDENT_FIELDS, CrrActivityService
from app.services.crr_catalogue_service import CrrCatalogueService
from app.services.zip_lookup import lookup_zip, normalize_zip

router = APIRouter()


async def _changed(
    db: AsyncSession,
    user: User,
    action: str,
    run: Callable[[], Awaitable[Any]],
    **details: Any,
) -> Any:
    """Run a catalogue write, commit it, and audit it; map errors to HTTP.

    No rollback on a refusal: the raised HTTPException reaches get_db's
    session, which rolls back whatever was flushed. Rolling back here as well
    would expire every loaded object, the signed-in user included.
    """
    try:
        result = await run()
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await db.commit()
    await log_audit_event(
        db=db,
        event_type=f"crr.catalogue.{action}",
        event_category="events",
        severity="info",
        event_data=details,
        user_id=str(user.id),
        username=user.username,
    )
    return result


@router.get("/catalogue", response_model=CrrCatalogueResponse)
async def get_catalogue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    The department's CRR activity types, their counts, and the risk and
    population tags. Seeds the defaults the first time it is read.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    data = await service.catalogue(str(current_user.organization_id))
    # The first read may have seeded the defaults.
    await db.commit()
    return CrrCatalogueResponse(**data)


@router.post("/activity-types", response_model=CrrActivityTypeResponse)
async def create_activity_type(
    body: CrrActivityTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Add an activity type, with the counts it records.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    row = await _changed(
        db,
        current_user,
        "type_created",
        lambda: service.create_type(
            str(current_user.organization_id),
            body.name,
            body.description,
            body.measures,
        ),
    )
    return CrrActivityTypeResponse(**row)


@router.patch("/activity-types/{type_id}", response_model=CrrActivityTypeResponse)
async def update_activity_type(
    type_id: str,
    body: CrrActivityTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Rename, describe, reorder, retire or restore an activity type.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    updates = body.model_dump(exclude_unset=True)
    row = await _changed(
        db,
        current_user,
        "type_updated",
        lambda: service.update_type(
            str(current_user.organization_id), type_id, updates
        ),
        activity_type_id=type_id,
        fields=sorted(updates),
    )
    return CrrActivityTypeResponse(**row)


@router.delete("/activity-types/{type_id}", status_code=204)
async def delete_activity_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Delete an activity type the department added. A built-in one is retired
    instead.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    await _changed(
        db,
        current_user,
        "type_deleted",
        lambda: service.delete_type(str(current_user.organization_id), type_id),
        activity_type_id=type_id,
    )


@router.put("/activity-types/{type_id}/tags", response_model=CrrActivityTypeResponse)
async def set_activity_type_tags(
    type_id: str,
    body: CrrTypeTagsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Replace the tags an activity type carries by default.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    row = await _changed(
        db,
        current_user,
        "type_tags_set",
        lambda: service.set_type_tags(
            str(current_user.organization_id), type_id, body.tag_ids
        ),
        activity_type_id=type_id,
    )
    return CrrActivityTypeResponse(**row)


@router.post(
    "/activity-types/{type_id}/measures", response_model=CrrActivityTypeResponse
)
async def add_measure(
    type_id: str,
    body: CrrMeasureCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Add a count an activity type records.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    row = await _changed(
        db,
        current_user,
        "measure_added",
        lambda: service.add_measure(
            str(current_user.organization_id), type_id, body.label
        ),
        activity_type_id=type_id,
    )
    return CrrActivityTypeResponse(**row)


@router.patch("/measures/{measure_id}", response_model=CrrActivityTypeResponse)
async def update_measure(
    measure_id: str,
    body: CrrMeasureUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Rename, retire or restore a count. Returns the activity type it belongs to.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    updates = body.model_dump(exclude_unset=True)
    row = await _changed(
        db,
        current_user,
        "measure_updated",
        lambda: service.update_measure(
            str(current_user.organization_id), measure_id, updates
        ),
        measure_id=measure_id,
        fields=sorted(updates),
    )
    return CrrActivityTypeResponse(**row)


@router.post("/tags", response_model=CrrTagResponse)
async def create_tag(
    body: CrrTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Add a risk or a priority population.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    row = await _changed(
        db,
        current_user,
        "tag_created",
        lambda: service.create_tag(
            str(current_user.organization_id), body.kind, body.label
        ),
        kind=body.kind,
    )
    return CrrTagResponse(**row)


@router.patch("/tags/{tag_id}", response_model=CrrTagResponse)
async def update_tag(
    tag_id: str,
    body: CrrTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    Rename, retire or restore a tag.

    **Requires permission: events.manage**
    """
    service = CrrCatalogueService(db)
    updates = body.model_dump(exclude_unset=True)
    row = await _changed(
        db,
        current_user,
        "tag_updated",
        lambda: service.update_tag(str(current_user.organization_id), tag_id, updates),
        tag_id=tag_id,
        fields=sorted(updates),
    )
    return CrrTagResponse(**row)


@router.get("/zip-lookup/{zip_code}", response_model=ZipLookupResponse)
async def zip_lookup(
    zip_code: str,
    current_user: User = Depends(require_permission("crr.record", "events.manage")),
):
    """
    City, state and county for a US ZIP code, from the GeoNames data bundled
    with the app. 404 when the ZIP is not in it, so the person types the city.
    Open to recorders as well as managers: the activity form fills from it.

    **Requires permission: crr.record OR events.manage**
    """
    if normalize_zip(zip_code) is None:
        raise HTTPException(status_code=400, detail="Enter a five-digit ZIP code")
    place = lookup_zip(zip_code)
    if place is None:
        raise HTTPException(status_code=404, detail="ZIP code not found")
    return ZipLookupResponse(**place._asdict())


# ----------------------------------------------------------------------
# Settings


@router.put("/settings", response_model=CrrSettingsResponse)
async def update_settings(
    body: CrrSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    How many months resident details are kept before they are cleared.

    **Requires permission: events.manage**
    """
    service = CrrActivityService(db)
    months = await _changed(
        db,
        current_user,
        "settings_updated",
        lambda: service.set_retention_months(
            str(current_user.organization_id), body.resident_details_retention_months
        ),
        resident_details_retention_months=body.resident_details_retention_months,
    )
    return CrrSettingsResponse(resident_details_retention_months=months)


# ----------------------------------------------------------------------
# Activities

_RECORD = ("crr.record", "events.manage")


def _can_view_contact(user: User) -> bool:
    return user_has_permission(user, "crr.view_contact")


def _can_edit(user: User, activity: Any) -> bool:
    """The member who recorded it, or anyone who manages events."""
    return activity.recorded_by == str(user.id) or user_has_permission(
        user, "events.manage"
    )


def _row(activity: Any, names: dict, user: User) -> CrrActivityResponse:
    show = _can_view_contact(user)
    has_details = any(getattr(activity, f) for f in RESIDENT_FIELDS)
    return CrrActivityResponse(
        id=activity.id,
        activity_type_id=activity.activity_type_id,
        activity_type_name=names["types"].get(activity.activity_type_id, "Activity"),
        event_id=activity.event_id,
        event_title=names["events"].get(activity.event_id),
        occurred_at=activity.occurred_at,
        zip_code=activity.zip_code,
        city=activity.city,
        state=activity.state,
        county=activity.county,
        counts=[
            {
                "measure_id": c.measure_id,
                "label": names["measures"].get(c.measure_id, "Count"),
                "quantity": c.quantity,
            }
            for c in activity.counts
        ],
        tags=[
            {"id": t.tag_id, "label": names["tags"].get(t.tag_id, "Tag")}
            for t in activity.tag_links
        ],
        members=[
            {
                "user_id": m.user_id,
                "name": names["users"].get(m.user_id, "Former member"),
                "minutes": m.minutes,
            }
            for m in activity.members
        ],
        recorded_by_name=names["users"].get(activity.recorded_by),
        has_resident_details=has_details,
        resident_details_cleared=activity.resident_details_cleared_at is not None,
        street_address=activity.street_address if show else None,
        resident_name=activity.resident_name if show else None,
        resident_phone=activity.resident_phone if show else None,
        resident_email=activity.resident_email if show else None,
        notes=activity.notes if show else None,
        can_edit=_can_edit(user, activity),
    )


async def _audit_details_read(db: AsyncSession, user: User, activities: list) -> None:
    """Record that resident details left the server, by activity id only.

    Once per request, and only when something was actually disclosed: the
    audit log is hash-chained and cannot be scrubbed, so it carries ids, never
    the address or name itself.
    """
    if not _can_view_contact(user):
        return
    disclosed = [
        a.id
        for a in activities
        if any(getattr(a, f) for f in RESIDENT_FIELDS) or a.notes
    ]
    if not disclosed:
        return
    await log_audit_event(
        db=db,
        event_type="crr.resident_details_viewed",
        event_category="events",
        severity="info",
        event_data={"activity_ids": disclosed},
        user_id=str(user.id),
        username=user.username,
    )


@router.get("/form-options", response_model=CrrFormOptionsResponse)
async def get_form_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    What the activity form offers: active types with their active counts, the
    active tags, the department's city and state, whether the ZIP lookup is
    on, and the members who can be named.

    **Requires permission: crr.record OR events.manage**
    """
    data = await CrrActivityService(db).form_options(str(current_user.organization_id))
    # The first read may have seeded the catalogue.
    await db.commit()
    return CrrFormOptionsResponse(
        **data, can_view_contact=_can_view_contact(current_user)
    )


@router.get("/activities", response_model=CrrActivityListResponse)
async def list_activities(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    activity_type_id: Optional[str] = Query(None),
    event_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    The department's CRR activities, newest first.

    **Requires permission: crr.record OR events.manage**
    """
    org_id = str(current_user.organization_id)
    service = CrrActivityService(db)
    activities, total = await service.list_activities(
        org_id,
        start=start,
        end=end,
        activity_type_id=activity_type_id,
        event_id=event_id,
        limit=limit,
        offset=offset,
    )
    names = await service.names(org_id, activities)
    await _audit_details_read(db, current_user, activities)
    return CrrActivityListResponse(
        items=[_row(a, names, current_user) for a in activities], total=total
    )


@router.get("/activities/{activity_id}", response_model=CrrActivityResponse)
async def get_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    One CRR activity.

    **Requires permission: crr.record OR events.manage**
    """
    org_id = str(current_user.organization_id)
    service = CrrActivityService(db)
    try:
        activity = await service.get(org_id, activity_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    names = await service.names(org_id, [activity])
    await _audit_details_read(db, current_user, [activity])
    return _row(activity, names, current_user)


@router.post("/activities", response_model=CrrActivityResponse)
async def create_activity(
    body: CrrActivityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    Record a CRR activity. A log entry credits Admin Hours to the members
    named; one recorded against an outreach event credits nothing.

    **Requires permission: crr.record OR events.manage**
    """
    org_id = str(current_user.organization_id)
    service = CrrActivityService(db)
    activity = await _changed(
        db,
        current_user,
        "activity_recorded",
        lambda: service.create(org_id, str(current_user.id), body.model_dump()),
        activity_type_id=body.activity_type_id,
        event_id=body.event_id,
    )
    names = await service.names(org_id, [activity])
    return _row(activity, names, current_user)


async def _editable(db: AsyncSession, user: User, activity_id: str):
    try:
        activity = await CrrActivityService(db).get(
            str(user.organization_id), activity_id
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not _can_edit(user, activity):
        raise HTTPException(
            status_code=403,
            detail="Only the member who recorded it, or an events manager, can change it",
        )
    return activity


@router.patch("/activities/{activity_id}", response_model=CrrActivityResponse)
async def update_activity(
    activity_id: str,
    body: CrrActivityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    Change an activity's counts, tags, location, notes or resident details.
    Resident details and notes need crr.view_contact.

    **Requires permission: crr.record OR events.manage**
    """
    org_id = str(current_user.organization_id)
    await _editable(db, current_user, activity_id)
    updates = body.model_dump(exclude_unset=True)
    if "notes" in updates and not _can_view_contact(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only members who can see resident details can change notes",
        )
    service = CrrActivityService(db)
    try:
        activity = await _changed(
            db,
            current_user,
            "activity_updated",
            lambda: service.update(
                org_id,
                activity_id,
                updates,
                may_edit_resident_details=_can_view_contact(current_user),
            ),
            activity_id=activity_id,
            fields=sorted(updates),
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    names = await service.names(org_id, [activity])
    return _row(activity, names, current_user)


@router.delete("/activities/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(*_RECORD)),
):
    """
    Delete an activity and the Admin Hours it credited.

    **Requires permission: crr.record OR events.manage**
    """
    await _editable(db, current_user, activity_id)
    service = CrrActivityService(db)
    await _changed(
        db,
        current_user,
        "activity_deleted",
        lambda: service.delete(str(current_user.organization_id), activity_id),
        activity_id=activity_id,
    )
