"""Elections: what is scheduled and, once closed, how it came out."""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import iso, org_uuid, parse_uuid
from app.models.election import Election, ElectionStatus
from app.services.election_service import ElectionService


def register(server: Any) -> None:
    @logbook_tool(server, title="List elections")
    async def list_elections(
        db: AsyncSession, principal: McpPrincipal, status: Optional[str] = None
    ) -> dict:
        """Elections newest first: title, type, status, positions on the
        ballot, dates and voting method. ``status`` is draft, nominations,
        open, closed or cancelled."""
        query = select(Election).where(
            Election.organization_id == principal.organization_id
        )
        if status:
            try:
                query = query.where(Election.status == ElectionStatus(status.lower()))
            except ValueError:
                raise ValueError(f"Unknown status: {status}")
        rows = await db.execute(query.order_by(Election.start_date.desc()))
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
        return {"items": items, "total": len(items)}

    @logbook_tool(server, title="Election results")
    async def get_election_results(
        db: AsyncSession, principal: McpPrincipal, election_id: str
    ) -> dict:
        """Results of a closed election: turnout, quorum and the tally per
        position. Not available while voting is open."""
        results = await ElectionService(db).get_election_results(
            parse_uuid(election_id, "election_id"), org_uuid(principal)
        )
        if results is None:
            raise ValueError("Results are not available until the election closes")
        return results.model_dump(mode="json")
