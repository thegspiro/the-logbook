"""
Endpoint dependencies for per-applicant access (app/services/prospect_access.py).

Every route with a ``{prospect_id}`` declares the level it needs with
:func:`require_prospect_access`, and ``tests/test_prospect_access_routes.py``
fails on one that does not, so a new route cannot quietly fall back to the old
"any pipeline permission sees everyone" rule.

A member who cannot see the applicant at all gets 404, as the self-access guard
does (prospect_privacy.py): a 403 would confirm the applicant exists. One who
can see them but not do this gets 403.
"""

import enum
from typing import Callable, Iterable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, user_has_permission
from app.core.database import get_db
from app.models.membership_pipeline import ProspectInterview
from app.models.user import User
from app.services.prospect_access import (
    MANAGE_PERMISSIONS,
    PIPELINE_MANAGE,
    VIEW_ALL,
    ProspectAccess,
    assigned_prospect_ids,
    load_access,
)


class Level(str, enum.Enum):
    SEE = "see"
    FULL = "full"
    WORK = "work"
    MANAGE = "manage"
    INTERVIEW = "interview"


_ALLOWED = {
    Level.SEE: lambda a: a.can_see,
    Level.FULL: lambda a: a.can_see_full,
    Level.WORK: lambda a: a.can_work,
    Level.MANAGE: lambda a: a.can_manage,
    Level.INTERVIEW: lambda a: a.can_log_interview,
}


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found"
    )


def require_prospect_access(
    level: Level,
    manage_permissions: Iterable[str] = MANAGE_PERMISSIONS,
    bypass_permissions: Iterable[str] = (),
) -> Callable:
    """A dependency that admits the caller to ``{prospect_id}`` at ``level``.

    ``manage_permissions`` are the permissions the endpoint accepted for
    managing before assignments existed. ``bypass_permissions`` admit the
    caller whatever their assignments, for the election-side permission that
    reads and places election packages without seeing the pipeline itself.
    """
    manage_permissions = tuple(manage_permissions)
    bypass_permissions = tuple(bypass_permissions)
    allowed = _ALLOWED[level]

    async def dependency(
        prospect_id: UUID,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> ProspectAccess:
        access = await load_access(
            db, current_user, str(prospect_id), manage_permissions
        )
        if any(user_has_permission(current_user, p) for p in bypass_permissions):
            return access
        if not access.can_see:
            raise _not_found()
        if not allowed(access):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to do this for this applicant",
            )
        return access

    dependency.prospect_access_level = level  # type: ignore[attr-defined]
    # Read the way require_permission's dependency is, so a test comparing the
    # permissions two routes accept can compare these too.
    # A list, as require_permission's is, so the two compare equal.
    dependency.required_permissions = list(  # type: ignore[attr-defined]
        ((VIEW_ALL,) if level in (Level.SEE, Level.FULL) else manage_permissions)
        + bypass_permissions
    )
    return dependency


async def require_interview_access(
    interview_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProspectAccess:
    """Editing or deleting an interview: a manager who can see the applicant
    may change any of its interviews; anyone else only their own, and only
    while they are still assigned to the applicant."""
    interview = await db.scalar(
        select(ProspectInterview).where(ProspectInterview.id == str(interview_id))
    )
    if interview is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found"
        )
    access = await load_access(
        db, current_user, str(interview.prospect_id), (PIPELINE_MANAGE,)
    )
    if not access.can_see:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found"
        )
    own = str(interview.interviewer_id or "") == str(current_user.id)
    if access.can_manage or (own and access.roles):
        return access
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can change only your own interview",
    )


async def require_pipeline_reader(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Reading a pipeline's stages: anyone who can see the pipeline, or anyone
    assigned to an applicant, whose page shows where that applicant stands."""
    for permission in (
        "prospective_members.view",
        PIPELINE_MANAGE,
        VIEW_ALL,
    ):
        if user_has_permission(current_user, permission):
            return current_user
    if await assigned_prospect_ids(db, current_user):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to view the membership pipeline",
    )


def require_view_all(*also: str) -> Callable:
    """For pipeline-wide figures and lists of every applicant: statistics,
    reports, labels. ``also`` admits other permissions the endpoint accepted
    for reasons of their own (election officers and the package list)."""

    async def dependency(current_user: User = Depends(get_current_user)) -> User:
        for permission in (VIEW_ALL, *also):
            if user_has_permission(current_user, permission):
                return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seeing every applicant requires prospective_members.view_all",
        )

    return dependency
