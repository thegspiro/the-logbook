"""Resolve a notification's position setting to the members who should get it.

Scheduling's notice settings store ``notify_roles`` as the panel's office keys
(``chief``, ``deputy_chief``, ``captain``). They were matched against
``Position.slug`` as written, and the seeded Chief position is ``fire_chief``,
so the Chief never heard of a declined shift or a failed equipment check —
the defect ``core.constants`` fixed for the role groups on 2026-08-26.
Expanding through ``position_slugs_for_offices`` addresses either spelling,
and a key that is not an office passes through as a plain slug.

Only current members are returned: a position is not revoked when a member
retires or is dropped (CLAUDE.md #32), so matching the position alone kept
sending notices to people who have left.
"""

from typing import Iterable, Set
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import position_slugs_for_offices
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Position, User, user_positions


async def current_holder_ids(
    db: AsyncSession, organization_id: UUID | str, position_keys: Iterable[object]
) -> Set[str]:
    """Ids of the department's current members holding any of *position_keys*.

    Non-string entries are ignored: the setting is free-form JSON, and one bad
    entry must not cost the department the whole notice (CLAUDE.md #19).
    """
    keys = [k.strip() for k in position_keys if isinstance(k, str) and k.strip()]
    slugs = position_slugs_for_offices(*keys)
    if not slugs:
        return set()
    result = await db.execute(
        select(User.id)
        .join(user_positions, user_positions.c.user_id == User.id)
        .join(Position, Position.id == user_positions.c.position_id)
        .where(
            Position.organization_id == str(organization_id),
            Position.slug.in_(slugs),
            User.organization_id == str(organization_id),
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            User.deleted_at.is_(None),
        )
    )
    return {str(row[0]) for row in result.all()}
