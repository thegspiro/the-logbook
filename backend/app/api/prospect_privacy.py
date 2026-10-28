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
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.core.security import email_fingerprints
from app.models.membership_pipeline import ProspectInterview, ProspectiveMember
from app.models.user import User


def _link_predicate(user: User) -> Optional[ColumnElement[bool]]:
    """SQL predicate for the identifiers a database can compare directly: the
    transfer back-link and an email address the user owns."""
    clauses = []

    if user.id:
        clauses.append(ProspectiveMember.transferred_user_id == str(user.id))

    fingerprints = [
        fp
        for address in (user.email, user.personal_email)
        if address
        for fp in email_fingerprints(address)
    ]
    if fingerprints:
        clauses.append(ProspectiveMember.email_hash.in_(fingerprints))

    return or_(*clauses) if clauses else None


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


async def load_self_prospect_ids(
    db: AsyncSession, user: User, prospect_id: Optional[str] = None
) -> Set[str]:
    """Return the ids of prospect records in ``user``'s org that describe them.

    Ids are normalized (lowercase, hyphenated) so callers can compare against
    a client-supplied path value without a case- or format-mismatch bypass.
    ``prospect_id`` narrows the lookup to one record for the by-id guards.

    The date of birth is encrypted at rest, so it cannot be compared in SQL.
    The name pair is matched in SQL and the date is compared here, on the
    decrypted value. That is the same set of records as comparing in SQL: a
    record matches by name AND date of birth, never by either alone.
    """
    if not user.organization_id:
        return set()

    scope = [ProspectiveMember.organization_id == user.organization_id]
    if prospect_id is not None:
        scope.append(ProspectiveMember.id == normalize_prospect_id(prospect_id))

    found: Set[str] = set()

    link = _link_predicate(user)
    if link is not None:
        linked = await db.execute(select(ProspectiveMember.id).where(*scope, link))
        found.update(normalize_prospect_id(row) for row in linked.scalars().all())

    if user.first_name and user.last_name and user.date_of_birth:
        named = await db.execute(
            select(ProspectiveMember.id, ProspectiveMember.date_of_birth).where(
                *scope,
                func.lower(ProspectiveMember.first_name) == user.first_name.lower(),
                func.lower(ProspectiveMember.last_name) == user.last_name.lower(),
            )
        )
        found.update(
            normalize_prospect_id(row_id)
            for row_id, born in named.all()
            if born == user.date_of_birth
        )

    return found


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

    if not await load_self_prospect_ids(db, current_user, prospect_id=str(raw_id)):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Prospect not found",
    )


async def block_self_interview_access(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deny an interview route acting on the caller's own application.

    ``/interviews/{interview_id}`` routes carry no ``{prospect_id}`` path
    parameter, so the router-level :func:`block_self_prospect_access` guard —
    keyed on that parameter — never fires for them. A caller who holds
    ``prospective_members.manage`` (a coordinator role a former applicant can
    hold once transferred to membership) could otherwise update or delete an
    interview record filed against their own application by its id alone.
    Resolve ``interview_id`` to its owning prospect and apply the same check.
    """
    raw_id: Optional[object] = request.path_params.get("interview_id")
    if raw_id is None or not current_user.organization_id:
        return

    owner_id = await db.scalar(
        select(ProspectInterview.prospect_id).where(
            ProspectInterview.id == normalize_prospect_id(raw_id)
        )
    )
    if owner_id is None:
        return
    if not await load_self_prospect_ids(db, current_user, prospect_id=str(owner_id)):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Interview not found",
    )
