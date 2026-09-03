"""Small helpers shared by the tool modules: paging, serialization, names."""

from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any, Iterable, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.constants import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.mcp.principal import McpPrincipal
from app.models.user import User


def org_uuid(principal: McpPrincipal) -> UUID:
    return UUID(principal.organization_id)


def clamp_limit(limit: Optional[int]) -> int:
    if limit is None or limit <= 0:
        return DEFAULT_PAGE_SIZE
    return min(limit, MAX_PAGE_SIZE)


def clamp_offset(offset: Optional[int]) -> int:
    return max(offset or 0, 0)


def parse_uuid(value: str, label: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"{label} is not a valid id")


def parse_date(value: Optional[str], label: str) -> Optional[date]:
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be an ISO date (YYYY-MM-DD)")


def parse_datetime(value: Optional[str], label: str) -> Optional[datetime]:
    if value is None or value == "":
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{label} must be an ISO-8601 date-time")
    if parsed.tzinfo is None:
        # Bare values are taken as UTC, which is what the database stores.
        from datetime import timezone

        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def iso(value: Any) -> Any:
    """JSON-friendly scalar: dates to ISO strings, enums to values, UUIDs to str."""
    if value is None:
        return None
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


def display_name(user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    parts = [user.first_name, user.last_name]
    name = " ".join(p for p in parts if p)
    return name or None


async def member_names(
    db: AsyncSession, organization_id: str, ids: Iterable[Optional[str]]
) -> dict[str, Optional[str]]:
    """Batch-resolve member ids to display names, org-scoped."""
    wanted = {str(i) for i in ids if i}
    if not wanted:
        return {}
    result = await db.execute(
        select(User).where(User.organization_id == organization_id, User.id.in_(wanted))
    )
    return {u.id: display_name(u) for u in result.scalars().all()}


def page(items: list[Any], total: Optional[int], limit: int, offset: int) -> dict:
    """A page of results.

    ``total`` is reported only when the caller has a real count. When it has
    none, ``has_more`` says whether another page is worth asking for — a
    page-sized result is treated as possibly incomplete — so a client never
    mistakes one page for the whole collection.
    """
    body: dict[str, Any] = {"items": items, "limit": limit, "offset": offset}
    if total is not None:
        body["total"] = total
        body["has_more"] = offset + len(items) < total
    else:
        body["has_more"] = len(items) >= limit
    return body
