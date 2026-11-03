"""
Member Supervisor API Endpoints

Who a member reports to, with the history of earlier supervisors:

GET  /users/{user_id}/supervisor             - current supervisor and history
PUT  /users/{user_id}/supervisor             - set or change the supervisor
POST /users/{user_id}/supervisor/end         - end the current assignment
GET  /users/{user_id}/supervisor/candidates  - who may be named as supervisor

Dates are inclusive and assignments never overlap; see
``MemberSupervisorService`` for how a change closes the previous assignment.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.member_supervisor import MemberSupervisorAssignment
from app.models.user import User
from app.schemas.member_supervisor import (
    MemberSupervisorResponse,
    SupervisorAssignmentEnd,
    SupervisorAssignmentResponse,
    SupervisorAssignmentSet,
    SupervisorCandidateListResponse,
    SupervisorCandidateResponse,
)
from app.services.member_supervisor_service import MemberSupervisorService

router = APIRouter()


async def _load_member(db: AsyncSession, user_id: str, organization_id: str) -> User:
    result = await db.execute(
        select(User).where(
            User.id == str(user_id),
            User.organization_id == str(organization_id),
            User.deleted_at.is_(None),
        )
    )
    member: User | None = result.scalar_one_or_none()
    return ensure_found(member, "Member")


def _assignment_response(
    row: MemberSupervisorAssignment, names: dict
) -> SupervisorAssignmentResponse:
    return SupervisorAssignmentResponse(
        id=str(row.id),
        supervisor_id=row.supervisor_id,
        supervisor_name=names.get(row.supervisor_id) if row.supervisor_id else None,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        created_at=row.created_at,
    )


async def _supervisor_response(
    svc: MemberSupervisorService, member: User
) -> MemberSupervisorResponse:
    rows = await svc.list_assignments(member.organization_id, member.id)
    names = await svc.names_by_id(
        member.organization_id, {r.supervisor_id for r in rows if r.supervisor_id}
    )
    history = [_assignment_response(r, names) for r in rows]
    current = next(
        (h for h, r in zip(history, rows) if r.ends_on is None and r.supervisor_id),
        None,
    )
    return MemberSupervisorResponse(
        member_id=str(member.id), current=current, history=history
    )


@router.get("/{user_id}/supervisor", response_model=MemberSupervisorResponse)
async def get_member_supervisor(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Who the member reports to now, and every earlier assignment, newest first.

    **Authentication required.** A member may read their own. Reading anyone
    else's needs `members.manage`, matching the rest of the profile's
    administrative section.
    """
    if str(current_user.id) != str(user_id) and not user_has_permission(
        current_user, "members.manage"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized"
        )
    member = await _load_member(db, user_id, current_user.organization_id)
    return await _supervisor_response(MemberSupervisorService(db), member)


@router.get(
    "/{user_id}/supervisor/candidates",
    response_model=SupervisorCandidateListResponse,
)
async def list_supervisor_candidates(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    The current members of the department who may be named as this member's
    supervisor: everyone active or probationary, except the member.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    users = await MemberSupervisorService(db).list_candidates(
        member.organization_id, member.id
    )
    return SupervisorCandidateListResponse(
        candidates=[
            SupervisorCandidateResponse(
                id=str(u.id),
                name=u.display_name,
                membership_number=u.membership_number,
            )
            for u in users
        ]
    )


@router.put("/{user_id}/supervisor", response_model=MemberSupervisorResponse)
async def set_member_supervisor(
    user_id: str,
    payload: SupervisorAssignmentSet,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Set or change who the member reports to, from `starts_on` (default today).

    An assignment already in effect ends the day before the new one starts. A
    change dated the day the current assignment started corrects it in place.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    svc = MemberSupervisorService(db)
    async with handle_service_errors("Failed to set the supervisor"):
        change = await svc.set_supervisor(
            member.organization_id,
            member.id,
            payload.supervisor_id,
            starts_on=payload.starts_on,
            actor_id=str(current_user.id),
        )
        await db.commit()

    await log_audit_event(
        db=db,
        event_type="member_supervisor_set",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(member.id),
            "assignment_id": str(change.assignment.id),
            "supervisor_id": change.assignment.supervisor_id,
            "previous_supervisor_id": change.previous_supervisor_id,
            "closed_assignment_id": change.closed_assignment_id,
            "corrected_in_place": change.corrected_in_place,
            "starts_on": change.assignment.starts_on.isoformat(),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _supervisor_response(svc, member)


@router.post("/{user_id}/supervisor/end", response_model=MemberSupervisorResponse)
async def end_member_supervisor(
    user_id: str,
    payload: SupervisorAssignmentEnd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    End the member's current supervisor assignment on `ends_on` (default
    today, inclusive), leaving them with no supervisor.

    **Requires permission: members.manage**
    """
    member = await _load_member(db, user_id, current_user.organization_id)
    svc = MemberSupervisorService(db)
    async with handle_service_errors("Failed to end the supervisor assignment"):
        ended = await svc.end_current(
            member.organization_id, member.id, ends_on=payload.ends_on
        )
        await db.commit()

    await log_audit_event(
        db=db,
        event_type="member_supervisor_ended",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(member.id),
            "assignment_id": str(ended.id),
            "supervisor_id": ended.supervisor_id,
            "ends_on": ended.ends_on.isoformat() if ended.ends_on else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _supervisor_response(svc, member)
