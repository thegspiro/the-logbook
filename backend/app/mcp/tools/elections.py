"""Elections: what is scheduled and, once closed, how it came out."""

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
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

# A listing carries this much of an election's description; the rest is
# read in pieces through ``get_election_description``. The column is
# unbounded Text, so a page of elections cannot carry every word of it.
ELECTION_TEXT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``ELECTION_TEXT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= ELECTION_TEXT_CHARS:
        return value, False
    return value[:ELECTION_TEXT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + ELECTION_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


async def _election(
    db: AsyncSession, principal: McpPrincipal, election_id: str
) -> Election:
    election = await ElectionService(db).get_election(
        parse_uuid(election_id, "election_id"), org_uuid(principal)
    )
    if election is None:
        raise ValueError("Election not found")
    return election


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
        open, closed or cancelled. Paged; ``total`` counts every match. A
        description is cut at 20,000 characters (``description_truncated``);
        ``get_election_description`` reads the rest."""
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
        items = []
        for e in rows.scalars().all():
            description, cut = _clip(e.description)
            items.append(
                {
                    "id": e.id,
                    "title": e.title,
                    "description": description,
                    "description_truncated": cut,
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
            )
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Read election description", module="elections")
    async def get_election_description(
        db: AsyncSession,
        principal: McpPrincipal,
        election_id: str,
        content_offset: int = 0,
    ) -> dict:
        """An election's description, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        election = await _election(db, principal, election_id)
        body = {"id": election.id, "title": election.title}
        body.update(_chunk(election.description or "", content_offset))
        return body

    @logbook_tool(server, title="Election results", module="elections")
    async def get_election_results(
        db: AsyncSession, principal: McpPrincipal, election_id: str
    ) -> dict:
        """Results of a closed election: turnout, quorum and the tally per
        position. Not available while voting is open."""
        election = await _election(db, principal, election_id)
        # The service also honours ``results_visible_immediately``, which an
        # officer may have set before opening the ballot; a live tally is
        # never shown here, whatever that flag says.
        if election.status != ElectionStatus.CLOSED:
            raise ValueError("Results are not available until the election closes")
        # The status check above is the gate. The service's own visibility
        # rule additionally requires the scheduled end to have passed, which
        # an election an officer closed early never satisfies; bypass it,
        # since a closed ballot's tally is final either way.
        results = await ElectionService(db).get_election_results(
            parse_uuid(election_id, "election_id"),
            org_uuid(principal),
            _internal_bypass_visibility=True,
        )
        if results is None:
            raise ValueError("Results are not available until the election closes")
        return results.model_dump(mode="json")
