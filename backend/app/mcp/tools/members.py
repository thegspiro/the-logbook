"""Roster: who the members are, by name, rank, station and position."""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    display_name,
    iso,
    page,
    parse_uuid,
)
from app.models.user import User


def _member(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": display_name(user),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "rank": user.rank,
        "station": user.station,
        "platoon": user.platoon,
        "status": iso(user.status),
        "member_class": user.member_class,
        "member_status": user.member_status,
        "membership_type": user.membership_type,
        "hire_date": iso(user.hire_date),
        "compliance_exempt": bool(user.compliance_exempt),
        "positions": sorted(
            {r.name for r in (user.roles or []) if getattr(r, "name", None)}
        ),
    }


async def _get_member(
    db: AsyncSession, principal: McpPrincipal, member_id: str
) -> User:
    result = await db.execute(
        select(User)
        .where(
            User.id == str(parse_uuid(member_id, "member_id")),
            User.organization_id == principal.organization_id,
            User.deleted_at.is_(None),
        )
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise ValueError("Member not found")
    return user


def register(server: Any) -> None:
    @logbook_tool(server, title="List members")
    async def list_members(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        status: Optional[str] = None,
        member_class: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """The department roster: name, rank, station, platoon, membership
        class and status, hire date and held positions for each member.
        ``search`` matches first or last name; ``status`` is the account status
        (active, inactive, ...); ``member_class`` is operational,
        administrative or social. No contact details are included."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        query = (
            select(User)
            .where(
                User.organization_id == principal.organization_id,
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
            .order_by(User.last_name, User.first_name)
        )
        users = list((await db.execute(query)).scalars().all())
        if search:
            needle = search.strip().lower()
            users = [u for u in users if needle in (display_name(u) or "").lower()]
        if status:
            users = [u for u in users if iso(u.status) == status.lower()]
        if member_class:
            users = [u for u in users if (u.member_class or "") == member_class.lower()]
        total = len(users)
        return page(
            [_member(u) for u in users[offset : offset + limit]], total, limit, offset
        )

    @logbook_tool(server, title="Get member")
    async def get_member(
        db: AsyncSession, principal: McpPrincipal, member_id: str
    ) -> dict:
        """One member's roster entry by id: name, rank, station, platoon,
        membership class and status, hire date, positions."""
        return _member(await _get_member(db, principal, member_id))
