"""
Prospect self-access privacy guard.

A member must never be able to read or act on the prospective-membership
record that describes *them*. Those records carry interview notes,
recommendations, reference checks, election-package commentary and
coordinator notes written in confidence by other members — material an
applicant is not entitled to see, and which stays sensitive after they are
elected and hold ``prospective_members.view`` in their own right. Membership
votes in a volunteer department are also secret by convention; letting the
subject read the file that fed the vote breaks that.

The guard is enforced as a router-level dependency rather than per endpoint
so that every current *and future* route carrying a ``{prospect_id}`` path
parameter inherits it. A new endpoint cannot silently reopen the hole.

Matching a user to a prospect record is deliberately conservative: a false
positive hides a *different* applicant from a coordinator, which is its own
failure. Only identifiers that are unique in practice are used — the
transfer back-link, an email address the user owns, or a full name paired
with a matching date of birth. Name alone is not enough (two J. Smiths in
one department is routine).
"""

import uuid as uuid_lib
from typing import Optional, Set

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.models.membership_pipeline import ProspectiveMember
from app.models.user import User


def self_prospect_predicate(user: User) -> ColumnElement[bool]:
    """SQL predicate selecting the prospect records that describe ``user``."""
    clauses = []

    if user.id:
        clauses.append(ProspectiveMember.transferred_user_id == str(user.id))

    emails = sorted({e.lower() for e in (user.email, user.personal_email) if e})
    if emails:
        clauses.append(func.lower(ProspectiveMember.email).in_(emails))

    if user.first_name and user.last_name and user.date_of_birth:
        clauses.append(
            and_(
                func.lower(ProspectiveMember.first_name) == user.first_name.lower(),
                func.lower(ProspectiveMember.last_name) == user.last_name.lower(),
                ProspectiveMember.date_of_birth == user.date_of_birth,
            )
        )

    if not clauses:
        return false()
    return or_(*clauses)


async def load_self_prospect_ids(db: AsyncSession, user: User) -> Set[str]:
    """Return the ids of prospect records in ``user``'s org that describe them.

    Ids are normalized (lowercase, hyphenated) so callers can compare against
    a client-supplied path value without a case- or format-mismatch bypass.
    """
    if not user.organization_id:
        return set()

    result = await db.execute(
        select(ProspectiveMember.id).where(
            ProspectiveMember.organization_id == user.organization_id,
            self_prospect_predicate(user),
        )
    )
    return {normalize_prospect_id(row) for row in result.scalars().all()}


def normalize_prospect_id(value: object) -> str:
    """Canonicalize a prospect id for comparison.

    MySQL's default collation compares ``id`` case-insensitively and FastAPI
    accepts an unhyphenated UUID in the path, so a raw string comparison
    against the stored id can miss where the database query hits — which
    would let a caller walk past this guard by re-casing or unhyphenating
    their own record's id. Route everything through ``uuid.UUID`` first.
    """
    text = str(value).strip()
    try:
        return str(uuid_lib.UUID(text))
    except (ValueError, AttributeError, TypeError):
        return text.lower()


async def get_hidden_prospect_ids(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Set[str]:
    """Prospect ids the caller must not see, for list/board/stat filtering.

    FastAPI caches this per request, so an endpoint that also sits behind
    :func:`block_self_prospect_access` pays for the lookup only once.
    """
    return await load_self_prospect_ids(db, current_user)


async def block_self_prospect_access(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deny by-id access to the caller's own prospective-membership record.

    Answers 404 rather than 403: a 403 would confirm that a record with that
    id exists, and the caller already knows their own application exists —
    what they must not learn is anything the file contains.

    Deliberately a targeted existence check rather than a reuse of
    :func:`get_hidden_prospect_ids`, so routes with no ``{prospect_id}`` in
    their path — the bulk of this router — add no query at all.
    """
    raw_id: Optional[object] = request.path_params.get("prospect_id")
    if raw_id is None or not current_user.organization_id:
        return

    match = await db.scalar(
        select(ProspectiveMember.id).where(
            ProspectiveMember.id == normalize_prospect_id(raw_id),
            ProspectiveMember.organization_id == current_user.organization_id,
            self_prospect_predicate(current_user),
        )
    )
    if match is None:
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Prospect not found",
    )
