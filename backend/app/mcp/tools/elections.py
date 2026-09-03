"""Elections: what is scheduled and, once closed, how it came out."""

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    org_uuid,
    page,
    parse_uuid,
)
from app.models.election import Election, ElectionStatus
from app.services.election_service import ElectionService


def register(server: Any) -> None:
    @logbook_tool(server, title="List elections", module="elections")
    async def list_elections(
        db: AsyncSession,
        principal: McpPrincipal,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Elections newest first: title, type, status, positions on the
        ballot, dates and voting method. ``status`` is draft, nominations,
        open, closed or cancelled. Paged; ``total`` counts every match."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        criteria = [Election.organization_id == principal.organization_id]
        if status:
            try:
                criteria.append(Election.status == ElectionStatus(status.lower()))
            except ValueError:
                raise ValueError(f"Unknown status: {status}")
        total = (
            await db.execute(
                select(func.count()).select_from(Election).where(*criteria)
            )
        ).scalar_one()
        rows = await db.execute(
            select(Election)
            .where(*criteria)
            .order_by(Election.start_date.desc(), Election.id)
            .offset(offset)
            .limit(limit)
        )
        items = [
            {
                "id": e.id,
                "title": e.title,
                "description": e.description,
                "election_type": iso(e.election_type),
                "status": iso(e.status),
                "positions": e.positions,
                "meeting_date": iso(e.meeting_date),
                "start_date": iso(e.start_date),
                "end_date": iso(e.end_date),
                "nomination_deadline": iso(e.nomination_deadline),
                "voting_method": iso(e.voting_method),
                "anonymous_voting": bool(e.anonymous_voting),
                "quorum_type": iso(e.quorum_type),
                "quorum_value": e.quorum_value,
            }
            for e in rows.scalars().all()
        ]
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Election results", module="elections")
    async def get_election_results(
        db: AsyncSession, principal: McpPrincipal, election_id: str
    ) -> dict:
        """Results of a closed election: turnout, quorum and the tally per
        position. Not available while voting is open."""
        election_uuid = parse_uuid(election_id, "election_id")
        election = (
            await db.execute(
                select(Election).where(
                    Election.id == str(election_uuid),
                    Election.organization_id == principal.organization_id,
                )
            )
        ).scalar_one_or_none()
        if election is None:
            raise ValueError("Election not found")
        # The service also honours ``results_visible_immediately``, which an
        # officer may have set before opening the ballot; a live tally is
        # never shown here, whatever that flag says.
        if election.status != ElectionStatus.CLOSED:
            raise ValueError("Results are not available until the election closes")
        results = await ElectionService(db).get_election_results(
            election_uuid, org_uuid(principal)
        )
        if results is None:
            raise ValueError("Results are not available until the election closes")
        return results.model_dump(mode="json")
