"""Email members about the open seats on a run of apparatus nights.

Email only, like the request pipeline's volunteer call: a call for help on a
community event is not one of the alerts in ``SmsAlert`` (CLAUDE.md pitfall
#18). One email covers the whole run, listing each upcoming night that still
has a seat a member can take, so a member hears about a five-night Santamobile
run once rather than five times.

The send can be repeated on purpose — a coordinator asks again when seats are
still open a week out — so it is not idempotent and makes no attempt to be
(pitfall #36 is about a side effect repeated *without* anyone asking). Each
send is recorded in ``apparatus_event_seat_calls`` instead, and the crew card
shows the last one so a second send is a decision, not an accident.

Send, then record: a failure between the two loses the record but not the
email, so the next coordinator may ask again. A duplicate call for help is a
nuisance; a call recorded but never delivered would hide that nobody was asked.
"""

from __future__ import annotations

import html as _html
from dataclasses import dataclass
from datetime import datetime
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.apparatus import Apparatus
from app.models.apparatus_event import (
    ApparatusEventEvocMode,
    ApparatusEventSeatCall,
    ApparatusEventSeatType,
    EventApparatusPlan,
    EventApparatusUnit,
)
from app.models.event import Event
from app.models.user import User
from app.services.event_service import attendance_is_finalized
from app.services.member_audience import AudienceFilter, resolve_audience
from app.utils.org_timezone import resolve_scheduling_timezone, to_local


class SeatCallNotSent(Exception):
    """Delivery sent nothing, so no send is recorded. The message is safe to
    show the coordinator."""


@dataclass
class OpenNight:
    """One night the email lists."""

    event_id: str
    title: str
    start: datetime
    location: Optional[str]
    # (unit number, "Elf × 2, Navigator") per apparatus with an open seat.
    units: List[Tuple[str, str]]


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=dt_timezone.utc)


def _open_seats_text(unit: EventApparatusUnit, evoc_mode: str) -> str:
    """The open seats of one apparatus, in the words of the crew card."""
    counts: Dict[str, int] = {}
    order: List[str] = []
    evoc = (
        unit.apparatus.required_evoc_level.name
        if unit.apparatus is not None and unit.apparatus.required_evoc_level
        else None
    )
    for seat in unit.seats:
        if seat.user_id:
            continue
        label = seat.name
        if (
            seat.seat_type == ApparatusEventSeatType.DRIVER.value
            and evoc
            and evoc_mode != ApparatusEventEvocMode.IGNORE.value
        ):
            label = f"{seat.name} (needs {evoc})"
        if label not in counts:
            order.append(label)
            counts[label] = 0
        counts[label] += 1
    return ", ".join(
        f"{label} × {counts[label]}" if counts[label] > 1 else label for label in order
    )


class ApparatusSeatCallService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _plan_for(
        self, event_id: str, organization_id: str
    ) -> Optional[EventApparatusPlan]:
        return (
            await self.db.execute(
                select(EventApparatusPlan).where(
                    EventApparatusPlan.event_id == str(event_id),
                    EventApparatusPlan.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()

    async def open_nights(
        self, series_id: str, organization_id: str, now: Optional[datetime] = None
    ) -> List[OpenNight]:
        """Nights of the run a member could still sign up for.

        Leaves out a night that has started, is cancelled or finalized, takes
        no self sign-ups (nothing for the member to do), or has every seat
        filled.
        """
        now = now or datetime.now(dt_timezone.utc)
        rows = (
            await self.db.execute(
                select(Event, EventApparatusPlan)
                .join(EventApparatusPlan, EventApparatusPlan.event_id == Event.id)
                .options(
                    selectinload(EventApparatusPlan.units)
                    .selectinload(EventApparatusUnit.apparatus)
                    .selectinload(Apparatus.required_evoc_level),
                    selectinload(EventApparatusPlan.units).selectinload(
                        EventApparatusUnit.seats
                    ),
                )
                .where(
                    EventApparatusPlan.organization_id == str(organization_id),
                    EventApparatusPlan.series_id == series_id,
                    Event.organization_id == str(organization_id),
                    Event.is_cancelled.is_(False),
                    Event.start_datetime > now,
                    EventApparatusPlan.allow_self_signup.is_(True),
                )
                .order_by(Event.start_datetime)
            )
        ).all()
        nights: List[OpenNight] = []
        for event, plan in rows:
            if attendance_is_finalized(event):
                continue
            units = [
                (unit.apparatus.unit_number if unit.apparatus else "", text)
                for unit in plan.units
                if (text := _open_seats_text(unit, plan.evoc_mode))
            ]
            if not units:
                continue
            nights.append(
                OpenNight(
                    event_id=str(event.id),
                    title=event.title,
                    start=_utc(event.start_datetime),
                    location=event.location,
                    units=units,
                )
            )
        return nights

    async def last_call(
        self, series_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """The most recent send for a run, for the crew card."""
        row = (
            await self.db.execute(
                select(ApparatusEventSeatCall, User.first_name, User.last_name)
                .outerjoin(User, User.id == ApparatusEventSeatCall.sent_by)
                .where(
                    ApparatusEventSeatCall.organization_id == str(organization_id),
                    ApparatusEventSeatCall.series_id == series_id,
                )
                .order_by(ApparatusEventSeatCall.sent_at.desc())
                .limit(1)
            )
        ).first()
        if row is None:
            return None
        call, first, last = row
        name = " ".join(p for p in (first, last) if p) or None
        return {
            "sent_at": _utc(call.sent_at),
            "recipients": call.recipients,
            "sent_by_name": name,
        }

    async def send(
        self,
        event_id: str,
        organization: Any,
        organization_id: str,
        actor_id: str,
        audience: AudienceFilter,
        message: Optional[str],
        frontend_url: str,
    ) -> Dict[str, Any]:
        """Email the chosen members about the run *event_id* belongs to."""
        from app.services.email_service import EmailService, wrap_email_body

        plan = await self._plan_for(event_id, organization_id)
        if plan is None:
            raise LookupError("This event has no apparatus crew.")
        nights = await self.open_nights(plan.series_id, organization_id)
        if not nights:
            raise ValueError(
                "No upcoming night in this run has a seat members can take "
                "themselves, so there is nothing to ask them to sign up for."
            )
        recipients = await resolve_audience(
            self.db, organization, organization_id, audience
        )
        if not recipients.emails:
            raise ValueError(
                "No members match those choices, or every one of them has "
                "turned off volunteer call emails."
            )

        tz = await resolve_scheduling_timezone(self.db, organization_id)
        base = frontend_url.rstrip("/")
        title = nights[0].title

        html_nights: List[str] = []
        text_nights: List[str] = []
        for night in nights:
            when = to_local(night.start, tz).strftime("%A, %B %d at %I:%M %p")
            link = f"{base}/events/{night.event_id}"
            seats_html = "".join(
                f"<li><strong>{_html.escape(unit)}</strong>: {_html.escape(text)}</li>"
                for unit, text in night.units
            )
            where_html = f"<br>{_html.escape(night.location)}" if night.location else ""
            html_nights.append(
                f"<p><strong>{_html.escape(when)}</strong>{where_html}</p>"
                f"<ul>{seats_html}</ul>"
                f'<p><a href="{_html.escape(link)}">Take a seat on this night</a></p>'
            )
            text_nights.append(when)
            if night.location:
                text_nights.append(night.location)
            text_nights += [f"  {unit}: {text}" for unit, text in night.units]
            text_nights += [f"  Take a seat: {link}", ""]

        note_html = (
            f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'
            if message
            else ""
        )
        count = len(nights)
        subject = f"Seats open: {title}"
        html_body = wrap_email_body(
            organization,
            f"Seats open on {title}",
            f"<p>The department is looking for members to crew "
            f"{'this night' if count == 1 else f'these {count} nights'}. "
            f"Open the night to take a seat; the first to sign up gets it.</p>"
            f"{note_html}{''.join(html_nights)}"
            f"<p>This is not a shift, and the time is recorded as admin hours.</p>",
        )
        text_lines = [
            f"The department is looking for members to crew {title}.",
            "Open a night to take a seat; the first to sign up gets it.",
            "",
        ]
        if message:
            text_lines += [message, ""]
        text_lines += text_nights
        text_lines.append(
            "This is not a shift, and the time is recorded as admin hours."
        )

        sent, failed = await EmailService(organization=organization).send_email(
            to_emails=recipients.emails,
            subject=subject,
            html_body=html_body,
            text_body="\n".join(text_lines),
            db=self.db,
            template_type="apparatus_event_seat_call",
            sent_by=actor_id,
        )

        # With email turned off, or the provider refusing everything, nothing
        # went out. Recording a send then would tell the next coordinator the
        # membership had been asked when it had not.
        if sent == 0:
            raise SeatCallNotSent(
                "No email went out. Email may not be set up for this department."
            )

        call = ApparatusEventSeatCall(
            organization_id=str(organization_id),
            series_id=plan.series_id,
            sent_by=actor_id,
            sent_at=datetime.now(dt_timezone.utc),
            recipients=sent,
            skipped_opted_out=recipients.skipped_opted_out,
            nights_listed=count,
            audience=audience.as_record(),
        )
        self.db.add(call)
        await self.db.flush()
        failed_note = f" {failed} could not be delivered." if failed else ""
        return {
            "message": (
                f"Emailed {sent} {'member' if sent == 1 else 'members'} "
                f"about {count} {'night' if count == 1 else 'nights'}.{failed_note}"
            ),
            "recipients": sent,
            "failed": failed,
            "skipped_opted_out": recipients.skipped_opted_out,
            "nights_listed": count,
            "sent_at": call.sent_at,
        }
