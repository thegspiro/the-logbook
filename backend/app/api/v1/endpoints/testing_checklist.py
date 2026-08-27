"""
Testing Checklist API Endpoints

The shared page-testing run behind the in-app testing home (`/testing`).

Any signed-in member may record their own findings — that is the point: the
permission gates are tested by signing in as each position in turn and
confirming what each is refused. Reading *other* testers' findings is what
needs a grant, and it is the same one the navigation entry uses,
``settings.manage``, so the IT manager (whose ``*`` matches everything) sees
every check in one place while an ordinary tester sees their own run.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.testing_checklist import (
    TestingChecklistResponse,
    TestingCheckResponse,
    TestingCheckUpsert,
)
from app.services.testing_checklist_service import TestingChecklistService

router = APIRouter()

# The grant that opens every tester's marks. Mirrors the gate on the
# navigation entry for /testing (SideNavigation/TopNavigation).
SEE_ALL_TESTERS_PERMISSION = "settings.manage"


def _can_see_all_testers(user: User) -> bool:
    return user_has_permission(user, SEE_ALL_TESTERS_PERMISSION)


def _serialize(entry, names: dict[str, str], viewer_id: str) -> TestingCheckResponse:
    return TestingCheckResponse(
        id=entry.id,
        route_path=entry.route_path,
        status=entry.status,
        note=entry.note,
        params=entry.params or None,
        checked_at=entry.checked_at,
        user_id=entry.user_id,
        user_name=names.get(entry.user_id),
        tested_as=entry.tested_as or None,
        is_mine=entry.user_id == viewer_id,
    )


@router.get("", response_model=TestingChecklistResponse)
@router.get("/", response_model=TestingChecklistResponse)
async def list_checklist(
    include_all_testers: bool = Query(
        False,
        description="Include every tester's marks (requires settings.manage)",
    ),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's run, or the whole department's."""
    if include_all_testers and not _can_see_all_testers(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reading other testers' results requires settings.manage",
        )

    service = TestingChecklistService(db)
    entries = await service.list_entries(
        current_user.organization_id,
        str(current_user.id),
        include_all_testers=include_all_testers,
    )
    names = await service.resolve_tester_names(current_user.organization_id, entries)
    return TestingChecklistResponse(
        entries=[_serialize(entry, names, str(current_user.id)) for entry in entries],
        includes_all_testers=include_all_testers,
        tester_count=len({entry.user_id for entry in entries}),
    )


@router.put("/entries", response_model=TestingCheckResponse)
async def upsert_entry(
    payload: TestingCheckUpsert,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Record what the caller found on one page.

    Always writes the caller's own row: the route path is the only thing the
    client chooses, so no tester can overwrite another's observation.
    """
    service = TestingChecklistService(db)
    try:
        entry = await service.upsert_entry(
            current_user.organization_id, current_user, payload
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    names = await service.resolve_tester_names(current_user.organization_id, [entry])
    return _serialize(entry, names, str(current_user.id))


@router.delete("")
@router.delete("/")
async def clear_checklist(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear the caller's run, or — with the grant — the department's.

    Clearing everyone's is destructive and not undoable, so it is audited:
    somebody else's evidence has just been deleted, and the log is the only
    thing that says by whom.
    """
    clear_everyone = scope == "all"
    if clear_everyone and not _can_see_all_testers(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clearing other testers' results requires settings.manage",
        )

    service = TestingChecklistService(db)
    deleted = await service.clear_run(
        current_user.organization_id,
        None if clear_everyone else str(current_user.id),
    )

    if clear_everyone:
        await log_audit_event(
            db=db,
            event_type="testing_checklist_cleared",
            event_category="administration",
            severity="warning",
            event_data={"scope": "all", "deleted": deleted},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await db.commit()

    return {"deleted": deleted}
