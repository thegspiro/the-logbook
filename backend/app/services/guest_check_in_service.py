"""
Guest Check-In Service

Business logic for unauthenticated ("guest") attendance at events that opt in
via ``Event.allow_guest_check_in`` — typically volunteer interest nights and
open houses, where the people in the room have no account and no reason to
create one just to sign the sheet.

Two records can come out of a single sign-in:

* an :class:`EventExternalAttendee` row — always, this *is* the attendance;
* a :class:`ProspectiveMember` row — only when the event has
  ``guest_check_in_creates_prospect`` set and the guest supplied an email, so a
  recruitment lead is not stranded on an attendance list nobody revisits.

Everything here runs for an anonymous caller, so the organization is resolved
from the room's display code by the endpoint layer and passed in — never taken
from the request body.
"""

from datetime import datetime, timezone
from typing import Optional, Tuple

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.event import Event, EventExternalAttendee
from app.models.membership_pipeline import ProspectEventLink, ProspectiveMember
from app.services.event_service import EventService
from app.services.membership_pipeline_service import MembershipPipelineService


class GuestCheckInService:
    """Records non-member attendance captured at a room display."""

    # Marks rows created by this path, distinguishing a self-recorded kiosk
    # sign-in from one a staff member typed in on a member's behalf.
    SOURCE_KIOSK_QR = "kiosk_qr"

    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_in_guest(
        self,
        event: Event,
        organization_id: str,
        first_name: str,
        last_name: str,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        organization_name: Optional[str] = None,
        interest_reason: Optional[str] = None,
    ) -> Tuple[Optional[EventExternalAttendee], Optional[str], bool]:
        """Record a guest's attendance at *event*.

        Returns ``(attendee, error, prospect_created)``. The event is expected
        to have been resolved and gated by the caller (org scope, guest opt-in
        and check-in window); this method owns only what gets written.
        """
        if not event.allow_guest_check_in:
            return None, "Guest check-in is not enabled for this event.", False

        normalized_email = (email or "").strip().lower() or None
        full_name = f"{first_name.strip()} {last_name.strip()}".strip()

        attendee = await self._find_existing_attendee(
            event_id=str(event.id),
            organization_id=organization_id,
            email=normalized_email,
            full_name=full_name,
        )

        already_checked_in = bool(attendee and attendee.checked_in)

        if attendee is None:
            attendee = EventExternalAttendee(
                id=generate_uuid(),
                organization_id=organization_id,
                event_id=str(event.id),
                name=full_name,
                email=normalized_email,
                phone=phone,
                organization_name=organization_name,
                source=self.SOURCE_KIOSK_QR,
                notes=interest_reason,
            )
            self.db.add(attendee)
        else:
            # A staff member may have pre-registered this guest with partial
            # details; fill the blanks from what they typed at the kiosk rather
            # than overwriting what someone deliberately entered.
            attendee.phone = attendee.phone or phone
            attendee.organization_name = attendee.organization_name or organization_name
            attendee.email = attendee.email or normalized_email
            attendee.notes = attendee.notes or interest_reason

        if not already_checked_in:
            attendee.checked_in = True
            attendee.checked_in_at = datetime.now(timezone.utc)

        await self.db.flush()

        prospect_created = False
        if event.guest_check_in_creates_prospect and normalized_email:
            prospect, prospect_created = await self._link_prospect(
                event=event,
                organization_id=organization_id,
                attendee=attendee,
                first_name=first_name.strip(),
                last_name=last_name.strip(),
                email=normalized_email,
                phone=phone,
                interest_reason=interest_reason,
            )
            if prospect is not None:
                attendee.prospect_id = prospect.id

        await self.db.commit()
        await self.db.refresh(attendee)

        return attendee, None, prospect_created

    async def _find_existing_attendee(
        self,
        event_id: str,
        organization_id: str,
        email: Optional[str],
        full_name: str,
    ) -> Optional[EventExternalAttendee]:
        """Find a prior attendance row for this person at this event.

        Matches on email when one was given, otherwise on name. Name matching
        is intentionally the weaker fallback — two different Chris Smiths at one
        open house would collapse into a single row — but the alternative is a
        duplicate every time someone taps the QR twice, which is the far more
        common case at a kiosk.
        """
        query = select(EventExternalAttendee).where(
            EventExternalAttendee.event_id == event_id,
            EventExternalAttendee.organization_id == organization_id,
        )

        if email:
            query = query.where(func.lower(EventExternalAttendee.email) == email)
        else:
            query = query.where(
                func.lower(EventExternalAttendee.name) == full_name.lower(),
                EventExternalAttendee.email.is_(None),
            )

        result = await self.db.execute(query.limit(1))
        return result.scalars().first()

    async def _link_prospect(
        self,
        event: Event,
        organization_id: str,
        attendee: EventExternalAttendee,
        first_name: str,
        last_name: str,
        email: str,
        phone: Optional[str],
        interest_reason: Optional[str],
    ) -> Tuple[Optional[ProspectiveMember], bool]:
        """Open or reuse a prospect for this guest and link it to the event.

        Returns ``(prospect, created)``. A failure here must not cost the guest
        their attendance — the sign-in is the thing they came to do — so
        pipeline errors are logged and swallowed rather than raised.
        """
        pipeline_service = MembershipPipelineService(self.db)

        try:
            existing = await pipeline_service.find_active_prospect_by_email(
                organization_id, email
            )
            if existing is not None:
                await self._link_prospect_to_event(existing, event)
                return existing, False

            prospect = await pipeline_service.create_prospect(
                organization_id=organization_id,
                data={
                    "first_name": first_name,
                    "last_name": last_name,
                    "email": email,
                    "phone": phone,
                    "interest_reason": interest_reason,
                    "referral_source": f"Attended: {event.title}",
                    "metadata_": {
                        "source": self.SOURCE_KIOSK_QR,
                        "source_event_id": str(event.id),
                        "source_event_title": event.title,
                        "external_attendee_id": attendee.id,
                    },
                },
            )
            await self._link_prospect_to_event(prospect, event)
            return prospect, True
        except Exception as exc:
            logger.error(
                "Guest check-in could not open a prospect for event {}: {}",
                event.id,
                exc,
            )
            return None, False

    async def _link_prospect_to_event(
        self, prospect: ProspectiveMember, event: Event
    ) -> None:
        """Attach the prospect to the event, if not already attached.

        ``prospect_event_links`` carries a unique (prospect, event) index, so a
        second sign-in must find the existing row rather than insert a clashing
        one.
        """
        existing = await self.db.execute(
            select(ProspectEventLink).where(
                ProspectEventLink.prospect_id == prospect.id,
                ProspectEventLink.event_id == str(event.id),
            )
        )
        if existing.scalars().first() is not None:
            return

        self.db.add(
            ProspectEventLink(
                id=generate_uuid(),
                prospect_id=prospect.id,
                event_id=str(event.id),
                notes=f"Checked in at {event.title} via room QR code",
            )
        )
        await self.db.flush()

    @staticmethod
    def check_in_window_state(
        event: Event, now: datetime
    ) -> Tuple[bool, Optional[str]]:
        """Report whether guest sign-in is open, using the member window rules.

        Guests are held to the same window the event's organizer configured for
        members, with one deliberate difference: the early-arrival grace that
        lets a member check in before a FLEXIBLE window opens does not apply.
        A member checking in early is identifiable and correctable; an
        anonymous early write is neither, so the gate stays shut until the
        window the organizer actually chose.
        """
        check_in_start, check_in_end = EventService._get_check_in_window(event)
        if now < check_in_start:
            return False, "Check-in for this event has not opened yet."
        if now > check_in_end:
            return False, "Check-in has closed for this event."
        return True, None
