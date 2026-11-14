"""Reads of the dated position history (``member_position_terms``).

The writes are not here: a session hook in ``app/models/member_position_term``
keeps the terms in step with ``user_positions`` on every path.
"""

from typing import Any

from sqlalchemy import and_, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    POSITION_KIND_COMMITTEE,
    POSITION_KIND_OFFICE,
    RANK_MIRRORING_POSITION_SLUGS,
)
from app.models.member_position_term import MemberPositionTerm
from app.models.user import Position

# What the profile lists as a past position: offices and committee seats. The
# baseline Member position is a system position and so is left out, as the
# profile's current list leaves it out (owner decision 2026-11-01).
_LISTED_KINDS = (POSITION_KIND_OFFICE, POSITION_KIND_COMMITTEE)


async def past_positions_for(
    db: AsyncSession, user_id: str, organization_id: str
) -> list[dict[str, Any]]:
    """The member's closed terms, newest first, for the profile.

    A rank-mirroring system position is left out for the reason the profile
    leaves it out of the current list (``withoutRankMirrors``): the rank
    already says it. A deleted position cannot be one, since system positions
    cannot be deleted.
    """
    kind = func.coalesce(Position.kind, MemberPositionTerm.position_kind)
    rows = await db.execute(
        select(
            MemberPositionTerm.position_id,
            func.coalesce(Position.name, MemberPositionTerm.position_name),
            kind,
            MemberPositionTerm.started_at,
            MemberPositionTerm.ended_at,
        )
        .select_from(MemberPositionTerm)
        .outerjoin(Position, Position.id == MemberPositionTerm.position_id)
        .where(
            MemberPositionTerm.user_id == str(user_id),
            MemberPositionTerm.organization_id == str(organization_id),
            MemberPositionTerm.ended_at.is_not(None),
            kind.in_(_LISTED_KINDS),
            not_(
                and_(
                    Position.is_system.is_(True),
                    Position.slug.in_(sorted(RANK_MIRRORING_POSITION_SLUGS)),
                )
            ),
        )
        .order_by(
            MemberPositionTerm.ended_at.desc(), MemberPositionTerm.started_at.desc()
        )
    )
    return [
        {
            "position_id": position_id,
            "name": name,
            "kind": kind_value,
            "started_at": started_at,
            "ended_at": ended_at,
        }
        for position_id, name, kind_value, started_at, ended_at in rows.all()
    ]
