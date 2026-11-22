"""Community risk reduction (CRR): the department's activity catalogue, and
the ZIP code lookup activity logging uses.

The catalogue is managed by whoever manages events (owner decision,
2026-11-22): the outreach manager and the officers above them. Logging the
activities themselves, with its own permissions, arrives with the activity log.
"""

from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.crr import (
    CrrActivityTypeCreate,
    CrrActivityTypeResponse,
    CrrActivityTypeUpdate,
    CrrCatalogueResponse,
    CrrMeasureCreate,
    CrrMeasureUpdate,
    CrrTagCreate,
    CrrTagResponse,
    CrrTagUpdate,
    CrrTypeTagsUpdate,
    ZipLookupResponse,
)
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
    current_user: User = Depends(require_permission("events.manage")),
):
    """
    City, state and county for a US ZIP code, from the GeoNames data bundled
    with the app. 404 when the ZIP is not in it, so the person types the city.

    **Requires permission: events.manage**
    """
    if normalize_zip(zip_code) is None:
        raise HTTPException(status_code=400, detail="Enter a five-digit ZIP code")
    place = lookup_zip(zip_code)
    if place is None:
        raise HTTPException(status_code=404, detail="ZIP code not found")
    return ZipLookupResponse(**place._asdict())
