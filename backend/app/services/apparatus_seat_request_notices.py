"""Emails about seat requests on apparatus nights that need approval.

Two notices, both email only (CLAUDE.md pitfall #18 — neither is an alert in
``SmsAlert``):

* **A member asked for a seat** — to the night's organizer and alternate who
  hold ``apparatus_events.manage``, because only they can answer it; failing
  both, the event's creator if they hold it. Sent under "Event officer
  duties", which the recipient can turn off: the request also waits on the
  crew card and in the nights list.
* **Your request was answered** — to the member, for an approval, a decline
  (in the coordinator's words, if any), or a request that lapsed when the
  night started. Sent under "Event changes and cancellations".

A member withdrawing their own request is told nothing; they did it.

Every notice is sent after the write it describes has committed, from the
``new_request_ids`` and ``decisions`` the service collected, and a failure
here is logged, never raised: the seat change has already happened, and an
error after it would read to the person who pressed the button as if it had
not.
"""

from __future__ import annotations

import html as _html
from typing import Dict, List, Optional, Sequence

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.models.apparatus_event import (
    ApparatusEventSeatRequest,
    ApparatusEventSeatRequestStatus,
    EventApparatusSeat,
)
from app.models.event import Event
from app.models.user import Organization, User
from app.services.apparatus_event_service import (
    ApparatusEventService,
    RequestDecision,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.event_organizer_service import eligible_member_clause, organizer_ids
from app.utils.member_names import format_display_name
from app.utils.org_timezone import resolve_scheduling_timezone, to_local

MANAGE_PERMISSION = "apparatus_events.manage"

_HEADLINES = {
    ApparatusEventSeatRequestStatus.APPROVED.value: "Your seat is confirmed",
    ApparatusEventSeatRequestStatus.DECLINED.value: "Your seat request was declined",
    ApparatusEventSeatRequestStatus.LAPSED.value: "Your seat request was not answered",
}


def answerers(event: Event, people: Dict[str, User]) -> List[User]:
    """Who is told about a new request: the organizer and alternate who can
    answer it, or failing both, the creator if they can."""
    chosen = [
        people[i]
        for i in organizer_ids(event)
        if i in people and user_has_permission(people[i], MANAGE_PERMISSION)
    ]
    if chosen:
        return chosen
    creator = people.get(str(event.created_by)) if event.created_by else None
    if creator is not None and user_has_permission(creator, MANAGE_PERMISSION):
        return [creator]
    return []


async def _people(
    db: AsyncSession, organization_id: str, ids: Sequence[str]
) -> Dict[str, User]:
    wanted = sorted({str(i) for i in ids if i})
    if not wanted:
        return {}
    users = (
        (
            await db.execute(
                select(User)
                .where(
                    User.id.in_(wanted),
                    User.organization_id == str(organization_id),
                    eligible_member_clause(),
                )
                .options(selectinload(User.roles))
            )
        )
        .scalars()
        .all()
    )
    return {str(u.id): u for u in users}


def _name(user: User) -> str:
    return format_display_name(user.first_name, user.last_name, user.preferred_name)


async def _send(
    organization: Optional[Organization],
    to: str,
    subject: str,
    title: str,
    paragraphs: List[str],
    event_id: str,
    button: str,
) -> None:
    from app.services.email_service import EmailService, wrap_email_body

    url = f"{settings.FRONTEND_URL.rstrip('/')}/events/{event_id}"
    body = "".join(f"<p>{_html.escape(p)}</p>" for p in paragraphs)
    html_body = wrap_email_body(
        organization,
        title,
        body + f'<p style="text-align: center;"><a href="{_html.escape(url)}" '
        f'class="button" role="link">{_html.escape(button)}</a></p>',
    )
    text_body = "\n\n".join(paragraphs + [f"{button}: {url}"])
    await EmailService(organization=organization).send_email(
        to_emails=[to], subject=subject, html_body=html_body, text_body=text_body
    )


async def _when(db: AsyncSession, organization_id: str, event: Event) -> str:
    tz = await resolve_scheduling_timezone(db, organization_id)
    start = event.start_datetime
    return to_local(start, tz).strftime("%A, %B %d at %I:%M %p")


async def _tell_answerers(
    db: AsyncSession,
    organization: Optional[Organization],
    organization_id: str,
    request_ids: Sequence[str],
    required: frozenset,
) -> int:
    sent = 0
    for request_id in request_ids:
        row = (
            await db.execute(
                select(ApparatusEventSeatRequest, Event, EventApparatusSeat.name)
                .join(Event, Event.id == ApparatusEventSeatRequest.event_id)
                .join(
                    EventApparatusSeat,
                    EventApparatusSeat.id == ApparatusEventSeatRequest.seat_id,
                )
                .where(
                    ApparatusEventSeatRequest.id == str(request_id),
                    ApparatusEventSeatRequest.organization_id == str(organization_id),
                )
            )
        ).first()
        if row is None:
            continue
        request, event, seat_name = row
        ids = organizer_ids(event) + (
            [str(event.created_by)] if event.created_by else []
        )
        people = await _people(db, organization_id, ids + [str(request.user_id)])
        requester = people.get(str(request.user_id))
        who = _name(requester) if requester else "A member"
        when = await _when(db, organization_id, event)
        for recipient in answerers(event, people):
            if not recipient.email or not member_receives_email(
                recipient.notification_preferences, EmailKind.EVENT_DUTIES, required
            ):
                continue
            await _send(
                organization,
                recipient.email,
                f"Seat request: {event.title}",
                "A member asked for a seat",
                [
                    f"{who} asked for the {seat_name} seat on {event.title}, "
                    f"{when}.",
                    "Open the night to approve or decline the request. A "
                    "request nobody answers is declined when the night starts.",
                ],
                str(event.id),
                "Review the request",
            )
            sent += 1
    return sent


async def _tell_members(
    db: AsyncSession,
    organization: Optional[Organization],
    organization_id: str,
    decisions: Sequence[RequestDecision],
    required: frozenset,
) -> int:
    if not decisions:
        return 0
    people = await _people(db, organization_id, [d.user_id for d in decisions])
    events = {
        str(e.id): e
        for e in (
            await db.execute(
                select(Event).where(
                    Event.organization_id == str(organization_id),
                    Event.id.in_(sorted({d.event_id for d in decisions})),
                )
            )
        )
        .scalars()
        .all()
    }
    sent = 0
    for decision in decisions:
        member = people.get(decision.user_id)
        event = events.get(decision.event_id)
        if (
            member is None
            or event is None
            or not member.email
            or not member_receives_email(
                member.notification_preferences, EmailKind.EVENT_CHANGES, required
            )
        ):
            continue
        when = await _when(db, organization_id, event)
        if decision.status == ApparatusEventSeatRequestStatus.APPROVED.value:
            paragraphs = [
                f"You have the {decision.seat_name} seat on {event.title}, "
                f"{when}. You are marked as going.",
            ]
        else:
            paragraphs = [
                f"Your request for the {decision.seat_name} seat on "
                f"{event.title}, {when}, was not approved.",
            ]
            if decision.note:
                paragraphs.append(decision.note)
        await _send(
            organization,
            member.email,
            f"{_HEADLINES.get(decision.status, 'Seat request')}: {event.title}",
            _HEADLINES.get(decision.status, "Seat request"),
            paragraphs,
            str(event.id),
            "View the night",
        )
        sent += 1
    return sent


async def deliver(
    db: AsyncSession,
    organization_id: str,
    request_ids: Sequence[str],
    decisions: Sequence[RequestDecision],
) -> int:
    """Send the notices for writes that have committed. Returns the number of
    emails handed to the mail service; never raises."""
    if not request_ids and not decisions:
        return 0
    try:
        organization = (
            await db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        required = department_required_kinds(organization)
        return await _tell_answerers(
            db, organization, organization_id, request_ids, required
        ) + await _tell_members(db, organization, organization_id, decisions, required)
    except Exception:
        logger.exception(
            "Seat request notices failed for org {} ({} requests, {} decisions)",
            organization_id,
            len(request_ids),
            len(decisions),
        )
        return 0


async def send_seat_request_notices(
    service: ApparatusEventService, organization_id: str
) -> int:
    """Send and clear whatever the service's last write collected."""
    request_ids, decisions = list(service.new_request_ids), list(service.decisions)
    service.new_request_ids.clear()
    service.decisions.clear()
    return await deliver(service.db, organization_id, request_ids, decisions)
