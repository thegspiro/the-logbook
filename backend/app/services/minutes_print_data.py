"""The data a printed copy of a set of minutes is made from.

One builder, used by the PDF and by the public copy, so what is printed and
what is posted publicly are decided from the same data and cannot drift apart
(CLAUDE.md pitfall #29). The PDF renders all of it; the public copy takes this
dict and narrows it (``app/utils/minutes_public.py``).
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional
from uuid import UUID

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import Organization, User
from app.services.minutes_record_service import MinutesRecordService
from app.services.minutes_signature_service import MinutesSignatureService
from app.utils.minutes_attendance import effective_listing, listed_attendees
from app.utils.minutes_settings import attendance_listing_in
from app.utils.motion_votes import acceptance_label, recorded_motions, vote_summary
from app.utils.org_timezone import scheduling_timezone, stored_calendar_day


def adopting_title(minutes: Any) -> Optional[str]:
    """The adopting meeting's title, unless it was a closed session: its title
    can name the matter, and these minutes may be read by every member."""
    if "adopting_minutes" in sa_inspect(minutes).unloaded:
        return None
    adopting = minutes.adopting_minutes
    if adopting is None:
        return None
    kind = (
        adopting.meeting_type
        if isinstance(adopting.meeting_type, str)
        else adopting.meeting_type.value
    )
    return None if kind == "executive" else adopting.title


def _parse(value: Optional[str]) -> Optional[datetime]:
    """A closed-session participant's time, stored as ISO text in JSON."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@dataclass
class PrintData:
    data: Dict[str, Any]
    org: Optional[Organization]
    tz: Any
    local: Callable[[Optional[datetime], str], Optional[str]]
    status_value: str


async def build_print_data(
    db: AsyncSession,
    minutes: MeetingMinutes,
    organization_id: UUID | str,
    *,
    restricted: bool,
) -> PrintData:
    """Everything a printed copy of *minutes* shows, as one dict."""
    records = MinutesRecordService(db)
    elections = await records.list_election_results(
        minutes.id, organization_id, restricted=restricted
    )
    closed_sessions = await records.list_closed_sessions(
        minutes.id, organization_id, restricted=restricted
    )
    attachments = await records.list_attachments(
        minutes.id, organization_id, restricted=restricted
    )
    revisions = await records.list_revisions(
        minutes.id, organization_id, restricted=restricted
    )
    org = (
        await db.execute(select(Organization).where(Organization.id == organization_id))
    ).scalar_one_or_none()
    tz = scheduling_timezone(org)
    # The roll is recorded in full; the department (or these minutes) decides
    # which statuses a reader of the printed copy is shown.
    listing = effective_listing(
        minutes.attendance_listing, attendance_listing_in(org.settings if org else None)
    )

    def local(value: Optional[datetime], fmt: str) -> Optional[str]:
        stamp = _aware(value)
        return stamp.astimezone(tz).strftime(fmt) if stamp else None

    person_ids = {i for i in (minutes.submitted_by, minutes.approved_by) if i}
    names = {}
    if person_ids:
        found = await db.execute(
            select(User).where(
                User.id.in_(person_ids), User.organization_id == str(organization_id)
            )
        )
        names = {u.id: (u.display_name or u.username) for u in found.scalars().all()}

    status_value = (
        minutes.status if isinstance(minutes.status, str) else minutes.status.value
    )
    current_revision = next(
        (r for r in (revisions or []) if r.superseded_at is None), None
    )
    approval = None
    if status_value == MinutesStatus.APPROVED.value:
        approval = {
            "submitted_by": names.get(minutes.submitted_by or ""),
            "approved_by": names.get(minutes.approved_by or ""),
            "approved_at_display": local(
                minutes.approved_at, "%B %d, %Y at %I:%M %p %Z"
            ),
            "adopted_on_display": local(minutes.adopted_on, "%B %d, %Y"),
            "as_amended": minutes.adopted_as_amended,
            "moved_by": minutes.adoption_moved_by,
            "seconded_by": minutes.adoption_seconded_by,
            "adopting_title": adopting_title(minutes),
            "version": current_revision.version if current_revision else None,
            "content_hash": current_revision.content_hash if current_revision else None,
            "signatures": [
                {
                    "title": row.slot_title,
                    "name": row.signed_name,
                    "signed_at_display": local(
                        row.signed_at, "%B %d, %Y at %I:%M %p %Z"
                    ),
                }
                for row in await MinutesSignatureService(db).for_revision(
                    minutes.id, organization_id
                )
            ],
        }

    meeting_type = (
        minutes.meeting_type
        if isinstance(minutes.meeting_type, str)
        else minutes.meeting_type.value
    )
    data = {
        "title": minutes.title,
        "meeting_type_display": meeting_type.replace("_", " ").title(),
        "meeting_date_display": local(minutes.meeting_date, "%B %d, %Y at %I:%M %p"),
        "location": minutes.location,
        "called_by": minutes.called_by,
        "called_to_order": local(minutes.called_to_order_at, "%I:%M %p"),
        "adjourned": local(minutes.adjourned_at, "%I:%M %p"),
        "status_display": status_value.title(),
        "attendees": [
            {
                "name": a.get("name"),
                "role": a.get("role"),
                "status": a.get("status")
                or ("present" if a.get("present", True) else "absent"),
                "note": a.get("note"),
            }
            for a in listed_attendees(minutes.attendees, listing)
        ],
        "attendance_listing": listing,
        "quorum_display": (
            ("Quorum met" if minutes.quorum_met else "Quorum NOT met")
            + (f" ({minutes.quorum_count} present)" if minutes.quorum_count else "")
            if minutes.quorum_met is not None
            else None
        ),
        "sections": sorted(minutes.get_sections(), key=lambda s: s.get("order", 0)),
        "motions": [
            {
                "number": index,
                "text": m.motion_text,
                "status": m.status if isinstance(m.status, str) else m.status.value,
                "moved_by": m.moved_by,
                "seconded_by": m.seconded_by,
                "notes": m.discussion_notes,
                "ballot": (
                    getattr(getattr(m, "election", None), "title", None)
                    if m.election_id
                    else None
                ),
                "vote_display": vote_summary(m),
                "acceptance_display": acceptance_label(m),
            }
            for index, m in enumerate(recorded_motions(minutes.motions), 1)
        ],
        "action_items": [
            {
                "description": a.description,
                "assignee": a.assignee_name,
                # A calendar day, not an instant: shown as stored.
                "due": (
                    due_on.isoformat()
                    if (due_on := stored_calendar_day(a.due_date))
                    else None
                ),
                "priority": (
                    a.priority if isinstance(a.priority, str) else a.priority.value
                ),
                "status": a.status if isinstance(a.status, str) else a.status.value,
            }
            for a in (minutes.action_items or [])
        ],
        "closed_sessions": [
            {
                "reason": c.reason,
                "legal_basis": c.legal_basis,
                "started": local(c.started_at, "%I:%M %p"),
                "ended": local(c.ended_at, "%I:%M %p"),
                "participants": [
                    {
                        "name": p.get("name"),
                        "joined": local(_parse(p.get("joined_at")), "%I:%M %p"),
                        "left": local(_parse(p.get("left_at")), "%I:%M %p"),
                    }
                    for p in (c.participants or [])
                ],
                "summary": c.summary,
            }
            for c in (closed_sessions or [])
        ],
        "election_results": [
            {
                "title": r.election_title,
                "closed_display": local(r.election_closed_at, "%B %d, %Y %I:%M %p %Z"),
                "snapshot": r.snapshot,
                "addendum": r.is_addendum,
                "filed_display": local(r.created_at, "%B %d, %Y"),
            }
            for r in (elections or [])
        ],
        "attachments": [
            {
                "title": a.title,
                "category": a.category,
                "name": a.original_name,
                "sha256": a.sha256,
            }
            for a in (attachments or [])
        ],
        "approval": approval,
        "header": minutes.get_effective_header(),
        "footer": minutes.get_effective_footer(),
    }
    return PrintData(data=data, org=org, tz=tz, local=local, status_value=status_value)
