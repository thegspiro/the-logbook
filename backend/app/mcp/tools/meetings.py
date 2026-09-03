"""Meetings, action items and published minutes."""

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    org_uuid,
    page,
    parse_date,
)
from app.models.meeting import ActionItemStatus, MeetingActionItem
from app.services.meetings_service import MeetingsService
from app.services.minute_service import MinuteService
from app.utils.sql_ordering import nulls_last_asc

# Section keys and title words that carry the treasurer's figures. Minutes
# written with the dynamic-section format keep the treasurer's report inside
# ``sections`` rather than the legacy column, so the finance switch has to be
# applied to the array as well as to the column.
_FINANCE_SECTION_MARKERS = ("treasurer", "financ", "budget")


def _is_finance_section(section: Any) -> bool:
    if not isinstance(section, dict):
        return False
    haystack = " ".join(
        str(section.get(field) or "") for field in ("key", "title")
    ).lower()
    return any(marker in haystack for marker in _FINANCE_SECTION_MARKERS)


def _sections(m: Any, expose_finance: bool) -> list:
    sections = m.get_sections() or []
    if expose_finance:
        return list(sections)
    return [sec for sec in sections if not _is_finance_section(sec)]


def _minutes_summary(m: Any) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "meeting_type": iso(m.meeting_type),
        "meeting_date": iso(m.meeting_date),
        "location": m.location,
        "status": iso(m.status),
        "approved_at": iso(m.approved_at),
        "quorum_met": m.quorum_met,
        "motion_count": len(m.motions or []),
        "action_item_count": len(m.action_items or []),
    }


def register(server: Any) -> None:
    @logbook_tool(server, title="List meetings", module="minutes")
    async def list_meetings(
        db: AsyncSession,
        principal: McpPrincipal,
        from_date: Optional[str] = None,
        status: Optional[str] = None,
        meeting_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Meetings on or after ``from_date`` (YYYY-MM-DD): title, type,
        date and times, location, status and agenda. ``start_time`` and
        ``end_time`` are the department's local clock times, not UTC."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        meetings, total = await MeetingsService(db).get_meetings(
            org_uuid(principal),
            meeting_type=meeting_type or None,
            status=status or None,
            from_date=parse_date(from_date, "from_date"),
            skip=offset,
            limit=limit,
        )
        callers = await member_names(
            db, principal.organization_id, (m.called_by for m in meetings)
        )
        items = [
            {
                "id": m.id,
                "title": m.title,
                "meeting_type": iso(m.meeting_type),
                "meeting_date": iso(m.meeting_date),
                "start_time": iso(m.start_time),
                "end_time": iso(m.end_time),
                "location": m.location,
                "called_by": callers.get(m.called_by or ""),
                "status": iso(m.status),
                "agenda": m.agenda,
            }
            for m in meetings
        ]
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Open action items", module="minutes")
    async def list_open_action_items(
        db: AsyncSession, principal: McpPrincipal, limit: int = 50, offset: int = 0
    ) -> dict:
        """Action items still open or in progress across all meetings, soonest
        due first (undated last), with assignee name, due date and priority.
        Paged; ``total`` counts every open item."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        criteria = (
            MeetingActionItem.organization_id == principal.organization_id,
            MeetingActionItem.status.in_(
                [ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS]
            ),
        )
        total = (
            await db.execute(
                select(func.count()).select_from(MeetingActionItem).where(*criteria)
            )
        ).scalar_one()
        rows = await db.execute(
            select(MeetingActionItem)
            .where(*criteria)
            .order_by(
                *nulls_last_asc(MeetingActionItem.due_date),
                MeetingActionItem.created_at.asc(),
                MeetingActionItem.id,
            )
            .offset(offset)
            .limit(limit)
        )
        items = list(rows.scalars().all())
        names = await member_names(
            db, principal.organization_id, (i.assigned_to for i in items)
        )
        rendered = [
            {
                "id": i.id,
                "meeting_id": i.meeting_id,
                "description": i.description,
                "assigned_to_member_id": i.assigned_to,
                "assigned_to": names.get(i.assigned_to or ""),
                "due_date": iso(i.due_date),
                "status": iso(i.status),
                "priority": iso(i.priority),
            }
            for i in items
        ]
        return page(rendered, total, limit, offset)

    @logbook_tool(server, title="List published minutes", module="minutes")
    async def list_minutes(
        db: AsyncSession,
        principal: McpPrincipal,
        meeting_type: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Approved, non-executive meeting minutes, newest first. Drafts and
        executive-session minutes are never listed."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        rows = await MinuteService(db).list_minutes(
            org_uuid(principal),
            meeting_type=meeting_type or None,
            search=search or None,
            skip=offset,
            limit=limit,
            restricted=True,
        )
        return page([_minutes_summary(m) for m in rows], None, limit, offset)

    @logbook_tool(server, title="Get published minutes", module="minutes")
    async def get_minutes(
        db: AsyncSession, principal: McpPrincipal, minutes_id: str
    ) -> dict:
        """The full text of one set of approved minutes: reports, business,
        announcements, motions with their votes, and action items. The
        treasurer's report is included only when finance sharing is on."""
        m = await MinuteService(db).get_minutes(
            str(minutes_id), org_uuid(principal), restricted=True
        )
        if m is None:
            raise ValueError("Minutes not found or not published")
        movers = await member_names(
            db,
            principal.organization_id,
            [x for mo in (m.motions or []) for x in (mo.moved_by, mo.seconded_by)],
        )
        body = _minutes_summary(m)
        body.update(
            {
                "called_to_order_at": iso(m.called_to_order_at),
                "adjourned_at": iso(m.adjourned_at),
                "attendees": m.attendees,
                "quorum_count": m.quorum_count,
                "agenda": m.agenda,
                "old_business": m.old_business,
                "new_business": m.new_business,
                "chief_report": m.chief_report,
                "committee_reports": m.committee_reports,
                "announcements": m.announcements,
                "notes": m.notes,
                "sections": _sections(m, principal.expose_finance),
                "motions": [
                    {
                        "order": mo.order,
                        "motion_text": mo.motion_text,
                        "moved_by": movers.get(mo.moved_by or "", mo.moved_by),
                        "seconded_by": movers.get(mo.seconded_by or "", mo.seconded_by),
                        "discussion_notes": mo.discussion_notes,
                        "status": iso(mo.status),
                        "votes_for": mo.votes_for,
                        "votes_against": mo.votes_against,
                        "votes_abstain": mo.votes_abstain,
                    }
                    for mo in (m.motions or [])
                ],
                "action_items": [
                    {
                        "description": ai.description,
                        "assignee_name": ai.assignee_name,
                        "due_date": iso(ai.due_date),
                        "priority": iso(ai.priority),
                        "status": iso(ai.status),
                    }
                    for ai in (m.action_items or [])
                ],
            }
        )
        if principal.expose_finance:
            body["treasurer_report"] = m.treasurer_report
        return body
