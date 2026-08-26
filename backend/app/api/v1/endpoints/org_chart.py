"""
Organizational Chart Endpoints

Governance -> Organizational Chart. Publishes the department's real chain of
command to the whole membership: who holds each seat, what area they are in
charge of, and who they report to.

Reading is open to every authenticated member by design — the screen exists so
a member can find the right person without asking around, and gating it would
defeat that. Editing is held behind ``orgchart.manage`` (delegable to a
secretary or adjutant on its own) or ``settings.manage``.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.org_chart import (
    OrgChartNodeCreate,
    OrgChartNodeMove,
    OrgChartNodeResponse,
    OrgChartNodeUpdate,
    OrgChartResponse,
)
from app.services.org_chart_service import OrgChartService

router = APIRouter()

_MANAGE_PERMISSIONS = ("orgchart.manage", "settings.manage")


def _can_manage(user: User) -> bool:
    return any(user_has_permission(user, perm) for perm in _MANAGE_PERMISSIONS)


async def _chart_payload(db: AsyncSession, current_user: User) -> OrgChartResponse:
    """Build the response for whoever is asking.

    A manager sees unpublished seats and what a seat is edited with — the
    member roster, and the roles and ranks a seat can be linked to, each
    carrying whoever holds it right now so the editor can confirm the choice on
    the spot. The general membership sees the published chart only.
    """
    service = OrgChartService(db)
    can_manage = _can_manage(current_user)
    nodes = await service.get_chart(
        current_user.organization_id, include_unpublished=can_manage
    )
    members = []
    roles = []
    ranks = []
    if can_manage:
        members = await service.list_member_options(current_user.organization_id)
        roles, ranks = await service.list_link_options(current_user.organization_id)
    return OrgChartResponse(
        nodes=[OrgChartNodeResponse(**node) for node in nodes],
        can_manage=can_manage,
        members=members,
        roles=roles,
        ranks=ranks,
    )


@router.get("", response_model=OrgChartResponse)
async def get_org_chart(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the department's organizational chart, depth-first."""
    return await _chart_payload(db, current_user)


@router.post(
    "/nodes", response_model=OrgChartResponse, status_code=status.HTTP_201_CREATED
)
async def create_org_chart_node(
    payload: OrgChartNodeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("orgchart.manage", "settings.manage")
    ),
):
    """Add a position to the chart."""
    service = OrgChartService(db)
    try:
        node = await service.create_node(
            current_user.organization_id,
            payload=payload.model_dump(),
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="org_chart_node_created",
        event_category="administration",
        severity="info",
        event_data={"node_id": str(node.id), "title": node.title},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    payload_out = await _chart_payload(db, current_user)
    await db.commit()
    logger.info(
        "Org chart position {} created org={} by={}",
        node.id,
        current_user.organization_id,
        current_user.id,
    )
    return payload_out


@router.put("/nodes/{node_id}", response_model=OrgChartResponse)
async def update_org_chart_node(
    node_id: str,
    payload: OrgChartNodeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("orgchart.manage", "settings.manage")
    ),
):
    """Edit a position — its title, people, link, area, or published state."""
    service = OrgChartService(db)
    try:
        # exclude_unset so an omitted key means "leave it alone" while an
        # explicit null clears the column (pitfall #1, update direction).
        await service.update_node(
            current_user.organization_id,
            node_id,
            updates=payload.model_dump(exclude_unset=True),
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="org_chart_node_updated",
        event_category="administration",
        severity="info",
        event_data={"node_id": node_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    payload_out = await _chart_payload(db, current_user)
    await db.commit()
    return payload_out


@router.post("/nodes/{node_id}/move", response_model=OrgChartResponse)
async def move_org_chart_node(
    node_id: str,
    payload: OrgChartNodeMove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("orgchart.manage", "settings.manage")
    ),
):
    """Re-parent a position and/or reorder it among its siblings."""
    service = OrgChartService(db)
    try:
        _node, previous_parent_id = await service.move_node(
            current_user.organization_id,
            node_id,
            parent_id=payload.parent_id,
            position=payload.position,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    # Audited like every other mutation here: a reparent changes the published
    # chain of command, which is a bigger claim about the department than the
    # field edits next door that are already recorded.
    await log_audit_event(
        db=db,
        event_type="org_chart_node_moved",
        event_category="administration",
        severity="info",
        event_data={
            "node_id": node_id,
            "previous_parent_id": previous_parent_id,
            "new_parent_id": payload.parent_id,
            "position": payload.position,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    payload_out = await _chart_payload(db, current_user)
    await db.commit()
    return payload_out


@router.delete("/nodes/{node_id}", response_model=OrgChartResponse)
async def delete_org_chart_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("orgchart.manage", "settings.manage")
    ),
):
    """Remove a position; anyone reporting to it is promoted to its parent."""
    service = OrgChartService(db)
    try:
        await service.delete_node(
            current_user.organization_id, node_id, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="org_chart_node_deleted",
        event_category="administration",
        severity="info",
        event_data={"node_id": node_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    payload_out = await _chart_payload(db, current_user)
    await db.commit()
    return payload_out
