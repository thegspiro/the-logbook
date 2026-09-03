"""Meetings, action items and published minutes."""

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
from app.mcp.registry import GATE_MESSAGES, logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    member_names,
    org_uuid,
    page,
    parse_date,
    parse_uuid,
)
from app.models.meeting import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingStatus,
    MeetingType,
)
from app.models.minute import ActionItem, Motion
from app.services.meetings_service import MeetingsService
from app.services.minute_service import MinuteService
from app.utils.sql_ordering import nulls_last_asc

# Minutes written with the dynamic-section format keep the money inside
# ``sections`` rather than the legacy treasurer column, so the finance switch
# has to be applied to the array as well as to the column. The built-in
# templates' finance-bearing sections are named outright (the trustee
# template's trust-fund and audit reports carry figures without a word of
# "treasurer" in them); the markers catch a department's own sections.
_FINANCE_SECTION_KEYS = frozenset(
    {"treasurer_report", "financial_review", "trust_fund_report", "audit_report"}
)
_FINANCE_SECTION_MARKERS = (
    "treasurer",
    "financ",
    "budget",
    "trust fund",
    "trust_fund",
    "audit",
    "dues",
)


def _is_finance_section(section: Any) -> bool:
    if not isinstance(section, dict):
        return False
    if str(section.get("key") or "") in _FINANCE_SECTION_KEYS:
        return True
    haystack = " ".join(
        str(section.get(field) or "") for field in ("key", "title")
    ).lower()
    return any(marker in haystack for marker in _FINANCE_SECTION_MARKERS)


def _sections(m: Any, expose_finance: bool) -> list:
    sections = m.get_sections() or []
    if expose_finance:
        return list(sections)
    return [sec for sec in sections if not _is_finance_section(sec)]


# Characters of any one piece of minutes text returned per call; a longer
# report or section is read in pieces through ``get_minutes_text``.
MINUTES_TEXT_CHARS = 20_000
# The free-text columns ``get_minutes`` returns, in the order it lists them.
_MINUTES_TEXT_FIELDS = (
    "agenda",
    "old_business",
    "new_business",
    "chief_report",
    "committee_reports",
    "announcements",
    "notes",
)


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` cut to ``MINUTES_TEXT_CHARS`` and whether it was cut.

    Scrubbed before it is cut, and ``_chunk`` measures its offsets over the
    same scrubbed text, so a number or address can never be split across
    the cut and reassembled from the pieces.
    """
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= MINUTES_TEXT_CHARS:
        return value, False
    return value[:MINUTES_TEXT_CHARS], True


def _motion(mo: Any, movers: dict[str, str]) -> dict:
    motion_text, text_cut = _clip(mo.motion_text)
    discussion, discussion_cut = _clip(mo.discussion_notes)
    return {
        "id": mo.id,
        "order": mo.order,
        "motion_text": motion_text,
        "motion_text_truncated": text_cut,
        "moved_by": movers.get(mo.moved_by or "", mo.moved_by),
        "seconded_by": movers.get(mo.seconded_by or "", mo.seconded_by),
        "discussion_notes": discussion,
        "discussion_truncated": discussion_cut,
        "status": iso(mo.status),
        "votes_for": mo.votes_for,
        "votes_against": mo.votes_against,
        "votes_abstain": mo.votes_abstain,
    }


def _chunk(text: str, offset: int) -> dict:
    text = scrub_text(text)
    piece = text[offset : offset + MINUTES_TEXT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _minutes_summary(m: Any, motion_count: int, action_item_count: int) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "meeting_type": iso(m.meeting_type),
        "meeting_date": iso(m.meeting_date),
        "location": m.location,
        "status": iso(m.status),
        "approved_at": iso(m.approved_at),
        "quorum_met": m.quorum_met,
        "motion_count": motion_count,
        "action_item_count": action_item_count,
    }


async def _counts_by_minutes(
    db: AsyncSession, model: Any, minutes_ids: list[str]
) -> dict[str, int]:
    """Rows of ``model`` (Motion or ActionItem) per minutes id, in one query.

    The listing defers the minutes bodies and does not load the children, so
    the headline counts come from a grouped count rather than from
    ``len(m.motions)``, which would load every motion on the page.
    """
    if not minutes_ids:
        return {}
    rows = await db.execute(
        select(model.minutes_id, func.count())
        .where(model.minutes_id.in_(minutes_ids))
        .group_by(model.minutes_id)
    )
    return {minutes_id: int(count) for minutes_id, count in rows.all()}


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
        ``end_time`` are the department's local clock times, not UTC. An
        agenda is cut at 20,000 characters (``agenda_truncated``);
        ``get_meeting_agenda`` reads the rest."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        # The service drops a filter it cannot parse, which would turn a
        # misspelled value into "every meeting"; refuse it here instead.
        if meeting_type:
            try:
                meeting_type = MeetingType(meeting_type.lower()).value
            except ValueError:
                raise ValueError(
                    "meeting_type must be one of: "
                    + ", ".join(t.value for t in MeetingType)
                )
        if status:
            try:
                status = MeetingStatus(status.lower()).value
            except ValueError:
                raise ValueError(
                    "status must be one of: "
                    + ", ".join(s.value for s in MeetingStatus)
                )
        meetings, total = await MeetingsService(db).get_meetings(
            org_uuid(principal),
            meeting_type=meeting_type or None,
            status=status or None,
            from_date=parse_date(from_date, "from_date"),
            skip=offset,
            limit=limit,
        )
        items = []
        for m in meetings:
            agenda, cut = _clip(m.agenda)
            items.append(
                {
                    "id": m.id,
                    "title": m.title,
                    "meeting_type": iso(m.meeting_type),
                    "meeting_date": iso(m.meeting_date),
                    "start_time": iso(m.start_time),
                    "end_time": iso(m.end_time),
                    "location": m.location,
                    # A free-text name as entered on the meeting, not a
                    # member id.
                    "called_by": m.called_by,
                    "status": iso(m.status),
                    "agenda": agenda,
                    "agenda_truncated": cut,
                }
            )
        return page(items, total, limit, offset)

    @logbook_tool(server, title="Read meeting agenda", module="minutes")
    async def get_meeting_agenda(
        db: AsyncSession,
        principal: McpPrincipal,
        meeting_id: str,
        content_offset: int = 0,
    ) -> dict:
        """A meeting's agenda, 20,000 characters at a time. When
        ``content_has_more`` is true, call again with ``content_offset`` set
        to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        result = await db.execute(
            select(Meeting).where(
                Meeting.id == str(parse_uuid(meeting_id, "meeting_id")),
                Meeting.organization_id == principal.organization_id,
            )
        )
        meeting = result.scalar_one_or_none()
        if meeting is None:
            raise ValueError("Meeting not found")
        body = _chunk(meeting.agenda or "", content_offset)
        body.update({"meeting_id": meeting.id, "title": meeting.title})
        return body

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
            summary_only=True,
        )
        ids = [m.id for m in rows]
        motions = await _counts_by_minutes(db, Motion, ids)
        action_items = await _counts_by_minutes(db, ActionItem, ids)
        items = [
            _minutes_summary(m, motions.get(m.id, 0), action_items.get(m.id, 0))
            for m in rows
        ]
        return page(items, None, limit, offset)

    @logbook_tool(server, title="Get published minutes", module="minutes")
    async def get_minutes(
        db: AsyncSession,
        principal: McpPrincipal,
        minutes_id: str,
        section_offset: int = 0,
        section_limit: int = 20,
    ) -> dict:
        """One set of approved minutes: reports, business, announcements,
        motions with their votes, action items and the dynamic sections
        (``section_offset`` / ``section_limit`` page them). Every piece of
        text is cut at 20,000 characters; ``truncated_fields``, a section's
        ``content_truncated`` and a motion's ``discussion_truncated`` say
        which were, and ``get_minutes_text`` reads the rest. The
        treasurer's report is included only when finance sharing is on."""
        section_offset = clamp_offset(section_offset)
        section_limit = clamp_limit(section_limit)
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
        # Finance content needs the switch *and* the Finance module: turning
        # the module off must stop its data reaching Claude by every path.
        share_finance = principal.expose_finance and principal.module_enabled("finance")
        body = _minutes_summary(m, len(m.motions or []), len(m.action_items or []))
        truncated_fields: list[str] = []
        texts: dict[str, Any] = {}
        for field in _MINUTES_TEXT_FIELDS:
            texts[field], cut = _clip(getattr(m, field))
            if cut:
                truncated_fields.append(field)
        visible_sections = _sections(m, share_finance)
        sections_page = []
        for sec in visible_sections[section_offset : section_offset + section_limit]:
            entry = dict(sec) if isinstance(sec, dict) else {"content": sec}
            entry["content"], cut = _clip(entry.get("content"))
            entry["content_truncated"] = cut
            sections_page.append(entry)
        body.update(
            {
                "called_to_order_at": iso(m.called_to_order_at),
                "adjourned_at": iso(m.adjourned_at),
                "attendees": m.attendees,
                "quorum_count": m.quorum_count,
                **texts,
                "sections": sections_page,
                "section_offset": section_offset,
                "section_total": len(visible_sections),
                "sections_has_more": section_offset + len(sections_page)
                < len(visible_sections),
                "motions": [_motion(mo, movers) for mo in (m.motions or [])],
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
        if share_finance:
            body["treasurer_report"], cut = _clip(m.treasurer_report)
            if cut:
                truncated_fields.append("treasurer_report")
        body["truncated_fields"] = truncated_fields
        return body

    @logbook_tool(server, title="Read minutes text", module="minutes")
    async def get_minutes_text(
        db: AsyncSession,
        principal: McpPrincipal,
        minutes_id: str,
        field: str,
        content_offset: int = 0,
    ) -> dict:
        """One piece of text from approved minutes, 20,000 characters at a
        time: ``field`` is a report or business field named by ``get_minutes``
        (old_business, chief_report, treasurer_report, ...),
        ``section:<key>`` for a dynamic section, ``motion:<id>`` for a
        motion's discussion notes or ``motion_text:<id>`` for its wording
        (the ``id`` on each motion). When ``content_has_more`` is true, call
        again with ``content_offset`` set to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        m = await MinuteService(db).get_minutes(
            str(minutes_id), org_uuid(principal), restricted=True
        )
        if m is None:
            raise ValueError("Minutes not found or not published")
        share_finance = principal.expose_finance and principal.module_enabled("finance")
        if field == "treasurer_report":
            if not share_finance:
                raise ValueError(GATE_MESSAGES["finance"])
            text = m.treasurer_report
        elif field.startswith("section:"):
            key = field[len("section:") :]
            matches = [
                sec
                for sec in _sections(m, share_finance)
                if isinstance(sec, dict) and str(sec.get("key")) == key
            ]
            if not matches:
                raise ValueError(f"No section named {key!r}")
            text = matches[0].get("content")
        elif field.startswith(("motion:", "motion_text:")):
            # By id, not ``order``: the column is not unique, and a motion
            # that shares its order with another could never be read.
            prefix, motion_id = field.split(":", 1)
            matches = [mo for mo in (m.motions or []) if mo.id == motion_id]
            if not matches:
                raise ValueError(f"No motion with id {motion_id!r}")
            motion = matches[0]
            text = (
                motion.motion_text
                if prefix == "motion_text"
                else motion.discussion_notes
            )
        elif field in _MINUTES_TEXT_FIELDS:
            text = getattr(m, field)
        else:
            raise ValueError(
                "field must be one of: "
                + ", ".join(
                    (
                        *_MINUTES_TEXT_FIELDS,
                        "treasurer_report",
                        "section:<key>",
                        "motion:<id>",
                        "motion_text:<id>",
                    )
                )
            )
        body = _chunk(text if isinstance(text, str) else "", content_offset)
        body.update({"minutes_id": m.id, "field": field})
        return body
