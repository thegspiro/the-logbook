"""
What a generated document says about where it came from: its report number
and who prepared it (owner decision, 2026-11-21).

The export endpoints call these before rendering, pass the results to the PDF
generator, and record the report number in the export's audit row; that row is
what lets a printed page be traced back to the export that made it.
"""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.utils.org_timezone import resolve_org_today
from app.utils.report_number import new_report_number


async def report_number_for(db: AsyncSession, organization_id: Any) -> str:
    """A new report number, dated in the department's own time zone."""
    return new_report_number(await resolve_org_today(db, str(organization_id)))


async def preparer_label(db: AsyncSession, user: Any) -> Optional[str]:
    """The member's name and rank as a report's "Prepared by" shows them.

    The rank is the department's own display name for the member's rank
    code (``operational_ranks``), as the reports themselves resolve it; a
    code with no active rank row is left off rather than printed raw.
    """
    name = (getattr(user, "full_name", None) or "").strip() or None
    rank_code = getattr(user, "rank", None)
    if not name or not rank_code:
        return name
    rank = await db.scalar(
        select(OperationalRank.display_name).where(
            OperationalRank.organization_id == str(user.organization_id),
            OperationalRank.rank_code == rank_code,
            OperationalRank.is_active.is_(True),
        )
    )
    return f"{name}, {rank}" if rank else name
