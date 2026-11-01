"""
Guest Check-In Service

Business logic for unauthenticated ("guest") attendance at events that opt in
via ``Event.allow_guest_check_in`` — typically volunteer interest nights and
open houses, where the people in the room have no account and no reason to
create one just to sign the sheet.

A sign-in always writes an :class:`EventExternalAttendee` row — that *is* the
attendance. At an event with ``guest_check_in_creates_prospect`` set it is also
linked to the guest's :class:`ProspectiveMember`, so a recruitment lead is not
stranded on an attendance list nobody revisits.

Such an event signs in only applicants it already knows: the guest types an
email (:meth:`GuestCheckInService.lookup_guest`), confirms the first name and
last initial shown, and presents the signed token the lookup issued
(:meth:`GuestCheckInService.check_in_known_prospect`). The endpoint layer
refuses the typed sign-in at these events, so the prospect-opening branch of
:meth:`GuestCheckInService.check_in_guest` is not reachable from the kiosk.

Everything here runs for an anonymous caller, so the organization is resolved
from the room's display code — or, for an event's own guest QR code, from the
event the link token names — by the endpoint layer and passed in, never taken
from the request body.
"""

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import jwt
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.security import email_fingerprints
from app.core.utils import generate_uuid
from app.models.event import Event, EventExternalAttendee
from app.models.membership_pipeline import (
    PipelineStepType,
    ProspectEventLink,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import User
from app.services.event_service import EventService, attendance_is_finalized
from app.services.membership_pipeline_service import (
    MembershipPipelineService,
    meeting_config_matches_event,
)


class GuestCheckInService:
    """Records non-member attendance captured at a room display."""

    # Marks rows created by this path, distinguishing a self-recorded kiosk
    # sign-in from one a staff member typed in on a member's behalf.
    SOURCE_KIOSK_QR = "kiosk_qr"
    # The same self-recorded sign-in, reached through the event's own guest QR
    # code (Event.guest_check_in_token) rather than a room display.
    SOURCE_EVENT_QR = "event_qr"
    # A prospect opened because a staff member signed a walk-in in at the door.
    SOURCE_STAFF_ENTRY = "staff_entry"

    # Outcomes of an email lookup at the kiosk.
    LOOKUP_PROSPECT = "prospect"
    LOOKUP_MEMBER = "member"
    LOOKUP_NOT_FOUND = "not_found"

    # The confirm token is what stops "yes, that's me" from being a free
    # check-in-as-anyone call: the browser never names a prospect id, it
    # presents the token the lookup issued, which binds that prospect to this
    # event in this room. Long enough to read the screen and tap, short enough
    # that a token copied off a phone is useless by the next meeting.
    CONFIRM_TOKEN_TYPE = "guest_prospect_confirm"
    CONFIRM_TOKEN_TTL = timedelta(minutes=10)

    # The shape secrets.token_urlsafe(32) issues: 43 characters of URL-safe
    # base64. Checked before the lookup so a malformed path never reaches SQL.
    LINK_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")
    LINK_TOKEN_BYTES = 32

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
        source: str = SOURCE_KIOSK_QR,
    ) -> Tuple[Optional[EventExternalAttendee], Optional[str], bool]:
        """Record a guest's attendance at *event*.

        Returns ``(attendee, error, prospect_created)``. The event is expected
        to have been resolved and gated by the caller (org scope, guest opt-in
        and check-in window); this method owns only what gets written.
        ``source`` says which QR code the guest scanned.
        """
        if not event.allow_guest_check_in:
            return None, "Guest check-in is not enabled for this event.", False

        # This is an unauthenticated write reached from a room tablet, so it
        # gets the same lock the member paths do — the sentence, not the
        # sentinel, because it is shown straight to whoever is at the display.
        if attendance_is_finalized(event):
            return (
                None,
                "Attendance for this event has been closed.",
                False,
            )

        normalized_email = (email or "").strip().lower() or None
        full_name = f"{first_name.strip()} {last_name.strip()}".strip()

        # Find-then-insert: two taps of the QR code at once (a double-tap, or a
        # retry of a POST that timed out after it was processed) would both
        # find nobody and both insert, counting the guest twice. The attendee
        # that would conflict does not exist yet, so the event row is what is
        # locked, and the lookup is a locking read so it answers from the
        # committed state rather than the snapshot taken when the caller
        # resolved the event. The lock is released by the commit below.
        await self._lock_event(str(event.id), organization_id)
        attendee = await self._find_existing_attendee(
            event_id=str(event.id),
            organization_id=organization_id,
            email=normalized_email,
            full_name=full_name,
            for_update=True,
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
                source=source,
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
        prospect: Optional[ProspectiveMember] = None
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
                source=source,
            )
            if prospect is not None:
                attendee.prospect_id = prospect.id

        await self.db.commit()
        await self.db.refresh(attendee)

        # A sign-in no longer advances a pipeline stage. It used to, here, and
        # the moment it fired was wrong: a guest can be signed in at the door
        # and struck off ten minutes later, so an applicant advanced on the
        # door record moved on a roster the department had not settled. The
        # advance now runs when the event's attendance is finalized — see
        # GuestCheckInService.advance_prospects_for_settled_event, which
        # finalize calls, and run_prospect_attendance_advance for the events
        # nobody closes out.
        return attendee, None, prospect_created

    async def _lock_event(self, event_id: str, organization_id: str) -> None:
        """Take the event row's lock to serialize a guest sign-in on it."""
        await self.db.execute(
            select(Event.id)
            .where(
                Event.id == event_id,
                Event.organization_id == organization_id,
            )
            .with_for_update()
        )

    async def _find_existing_attendee(
        self,
        event_id: str,
        organization_id: str,
        email: Optional[str],
        full_name: str,
        for_update: bool = False,
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
            query = query.where(
                EventExternalAttendee.email_hash.in_(email_fingerprints(email))
            )
        else:
            query = query.where(
                func.lower(EventExternalAttendee.name) == full_name.lower(),
                EventExternalAttendee.email.is_(None),
            )

        query = query.limit(1)
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        event_external_attendee: Optional[EventExternalAttendee] = (
            result.scalars().first()
        )
        return event_external_attendee

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
        source: str = SOURCE_KIOSK_QR,
        note: Optional[str] = None,
    ) -> Tuple[Optional[ProspectiveMember], bool]:
        """Open or reuse a prospect for this guest and link it to the event.

        Returns ``(prospect, created)``. A failure here must not cost the guest
        their attendance — the sign-in is the thing they came to do — so
        pipeline errors are logged and swallowed rather than raised.

        ``source`` and ``note`` say how the attendance was recorded, so a
        coordinator reading the applicant's history is not told a walk-in
        scanned the room code when staff signed them in by hand.
        """
        pipeline_service = MembershipPipelineService(self.db)

        try:
            existing = await pipeline_service.find_active_prospect_by_email(
                organization_id, email
            )
            if existing is not None:
                await self.link_prospect_to_event(existing.id, event, note=note)
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
                        "source": source,
                        "source_event_id": str(event.id),
                        "source_event_title": event.title,
                        "external_attendee_id": attendee.id,
                    },
                },
            )
            await self.link_prospect_to_event(prospect.id, event, note=note)
            return prospect, True
        except Exception as exc:
            logger.error(
                "Guest check-in could not open a prospect for event {}: {}",
                event.id,
                exc,
            )
            return None, False

    async def link_prospect_to_event(
        self, prospect_id: str, event: Event, note: Optional[str] = None
    ) -> None:
        """Attach the prospect to the event, if not already attached.

        ``prospect_event_links`` carries a unique (prospect, event) index, so a
        second sign-in must find the existing row rather than insert a clashing
        one.

        Public because staff-entered attendance links a prospect too, and the
        link is what the applicant's linked-events section and the by-event
        applicant filter both read — setting ``prospect_id`` alone advanced the
        pipeline off an attendance that then appeared nowhere.

        ``note`` describes how the attendance was recorded and is kept in the
        prospect's event history, so the caller supplies it: the kiosk default
        below would tell a coordinator a guest scanned the room code when a
        staff member in fact entered them by hand.
        """
        existing = await self.db.execute(
            select(ProspectEventLink).where(
                ProspectEventLink.prospect_id == str(prospect_id),
                ProspectEventLink.event_id == str(event.id),
            )
        )
        if existing.scalars().first() is not None:
            return

        # Scope a duplicate-key race (two concurrent sign-ins linking the same
        # prospect to the same event) to a SAVEPOINT, matching
        # MembershipPipelineService.create_prospect's own pattern. Without
        # this, a lost race's flush() failure leaves the whole session
        # needing a rollback it never gets — _link_prospect's caller swallows
        # the exception and returns, but the guest's already-flushed
        # EventExternalAttendee then fails at check_in_guest's own
        # db.commit(), turning "the pipeline link is best-effort" into "the
        # guest's attendance is lost too."
        try:
            async with self.db.begin_nested():
                self.db.add(
                    ProspectEventLink(
                        id=generate_uuid(),
                        prospect_id=str(prospect_id),
                        event_id=str(event.id),
                        notes=note or f"Checked in at {event.title} via room QR code",
                    )
                )
                await self.db.flush()
        except IntegrityError:
            # Not every IntegrityError here is the duplicate-link race this
            # was written for — the prospect could instead have been deleted
            # concurrently (a real FK violation, not a harmless re-insert).
            # Swallowing that one too would let the caller keep treating a
            # since-deleted prospect as linked: check_in_guest would still
            # set attendee.prospect_id to it, and its own commit would then
            # fail the same FK check, losing the attendance this SAVEPOINT
            # exists to protect. Re-check the link actually exists before
            # treating the failure as harmless; otherwise re-raise so
            # _link_prospect's handler logs it and returns no prospect.
            #
            # Must be a locking read (FOR UPDATE): under this app's default
            # REPEATABLE READ, a plain SELECT answers from the snapshot
            # taken at this transaction's first statement — long before the
            # concurrent transaction committed its insert — so it would see
            # no row and wrongly re-raise even in the ordinary, successful
            # race this except exists to swallow (CLAUDE.md Pitfall #27).
            # The INSERT's own unique-index check already proved a row
            # exists in the *current* committed state; the recheck has to
            # look there too, not at a stale snapshot.
            recheck = await self.db.execute(
                select(ProspectEventLink)
                .where(
                    ProspectEventLink.prospect_id == str(prospect_id),
                    ProspectEventLink.event_id == str(event.id),
                )
                .with_for_update()
            )
            if recheck.scalars().first() is None:
                raise

    @staticmethod
    def _meeting_config_matches_event(config: dict, event: Event) -> bool:
        """Whether a meeting stage is waiting on *this* event.

        The stage builder records the event type (and optional category) the
        coordinator chose, then pins ``linked_event_id`` to the next occurrence
        of it as a convenience. Grading the pinned id first would strand every
        recurring stage the moment that occurrence passed — an applicant at
        March's business meeting would not satisfy a stage pinned to January's.
        So the type the coordinator actually chose wins, and the pinned id is
        the fallback for a stage built without one. A stage naming **neither**
        matches nothing — guest check-in is org-wide and the events departments
        enable it on are the public ones, so taking any recorded attendance
        advanced "Meeting with the Fire Chief" on a pancake breakfast.

        The rule itself now lives beside the stage gate that has to apply the
        same test to a *stored* attendance record, so offering an advance here
        and granting it there cannot drift apart.
        """
        return meeting_config_matches_event(config, event)

    async def advance_prospects_for_settled_event(self, event: Event) -> int:
        """Advance every applicant whose meeting stage this settled event clears.

        The finalize flow's counterpart for guests. ``finalize_event_attendance``
        walks ``EventRSVP`` — members, for the hours ledger — and never touches
        ``EventExternalAttendee``, which is where an applicant's attendance
        lives, so nothing here rides along with that loop.

        Runs per event rather than per check-in because finalizing is the event
        deciding its whole roster at once: everybody who was there becomes
        advanceable at the same moment, and which of them is sitting on a
        matching meeting stage is the gate's question, not this method's.

        Best-effort against a commit that has already happened. A pipeline
        failure must never roll back a finalize — the hours, the durations and
        the lock are the point of that operation, and an applicant who does not
        advance is recoverable by hand while a half-finalized event is not.

        Returns how many applicants actually moved.
        """
        result = await self.db.execute(
            select(EventExternalAttendee).where(
                EventExternalAttendee.event_id == str(event.id),
                EventExternalAttendee.organization_id == str(event.organization_id),
                EventExternalAttendee.checked_in.is_(True),
                EventExternalAttendee.prospect_id.isnot(None),
            )
        )
        advanced = 0
        for attendee in result.scalars().all():
            if await self.try_advance_attendance_pipeline(
                str(attendee.prospect_id), event
            ):
                advanced += 1
        return advanced

    async def try_advance_attendance_pipeline(
        self, prospect_id: str, event: Event
    ) -> bool:
        """Advance a prospect whose current stage is the meeting they attended.

        Called for a settled event — from the finalize flow by way of
        :meth:`advance_prospects_for_settled_event`, and from the nightly
        ``prospect_attendance_advance`` task for the events nobody finalizes.
        It used to run at check-in, which advanced applicants off a door record
        the department had not stood behind yet.

        ``event`` is the one that just settled, and it narrows the stage config
        this will act on. The gate behind it re-reads the applicant's whole
        attendance and applies its own rules, so a stage waiting on a different
        meeting is refused there rather than here.

        Whatever went wrong, it must not cost the caller its own work: the
        finalize is committed by this point and the hours are already landed.
        """
        try:
            return await MembershipPipelineService(
                self.db
            ).try_auto_advance_current_step(
                prospect_id=str(prospect_id),
                organization_id=str(event.organization_id),
                step_type=PipelineStepType.MEETING,
                # Reaches the applicant's activity log and the stage's
                # action_result, so it has to name what actually moved them.
                trigger="event attendance finalized",
                action_result={
                    "event_id": str(event.id),
                    "event_title": event.title,
                },
                config_matches=lambda config: self._meeting_config_matches_event(
                    config, event
                ),
            )
        except Exception as exc:
            logger.error(
                "Attendance pipeline progression failed for prospect {} "
                "at event {}: {}",
                prospect_id,
                event.id,
                exc,
            )
            return False

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

    @staticmethod
    def guest_check_in_window(event: Event) -> Tuple[datetime, datetime]:
        """The window guests may sign in during — the member window's bounds."""
        return EventService._get_check_in_window(event)

    @classmethod
    def guest_sign_in_state(
        cls, event: Event, now: datetime
    ) -> Tuple[bool, Optional[str]]:
        """Report whether a guest sign-in would be accepted right now.

        The window, then the attendance lock. The one definition both the
        public guest endpoints (which refuse on it) and the manager's guest QR
        card (which hides the code on it) read, so the code is shown exactly
        while a scan of it would be accepted.
        """
        is_open, closed_reason = cls.check_in_window_state(event, now)
        if is_open and attendance_is_finalized(event):
            return False, "Attendance for this event has been closed."
        return is_open, closed_reason

    async def lookup_guest(
        self, organization_id: str, email: str
    ) -> Tuple[str, Optional[ProspectiveMember]]:
        """Classify an email typed at the kiosk.

        Returns ``(outcome, prospect)``; ``prospect`` is set only for
        :attr:`LOOKUP_PROSPECT`. Only an *active* applicant is recognised,
        matching what :meth:`_link_prospect` would reuse — a withdrawn or
        rejected applicant is not reopened from an anonymous tablet. An
        applicant is checked before a member account, so someone who is both
        (an applicant re-using a work address) gets the guest path the event
        exists for.
        """
        normalized = email.strip().lower()

        prospect = await MembershipPipelineService(
            self.db
        ).find_active_prospect_by_email(organization_id, normalized)
        if prospect is not None:
            return self.LOOKUP_PROSPECT, prospect

        member_id = (
            await self.db.execute(
                select(User.id)
                .where(
                    User.organization_id == organization_id,
                    User.email_hash.in_(email_fingerprints(normalized)),
                    User.is_active,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if member_id is not None:
            return self.LOOKUP_MEMBER, None

        return self.LOOKUP_NOT_FOUND, None

    @staticmethod
    def short_name(first_name: str, last_name: str) -> str:
        """First name and last initial — the most the public kiosk shows.

        The same disclosure the room kiosk's badge tap already makes for a
        member: enough for the person to recognise themselves, not enough to
        tell a bystander who is applying.
        """
        first = (first_name or "").strip()
        last = (last_name or "").strip()
        return f"{first} {last[0]}." if last else first

    @classmethod
    def issue_confirm_token(
        cls,
        prospect_id: str,
        event_id: str,
        location_id: Optional[str],
        organization_id: str,
    ) -> str:
        """Sign a confirm token for this prospect, event and room.

        ``location_id`` is None for the event's own guest QR code, which has no
        room; the claim is then empty, so a token issued at a room kiosk is not
        accepted through the event link and one issued there is not accepted
        at a kiosk.
        """
        now = datetime.now(timezone.utc)
        payload = {
            "type": cls.CONFIRM_TOKEN_TYPE,
            "sub": str(prospect_id),
            "evt": str(event_id),
            "loc": str(location_id) if location_id else "",
            "org": str(organization_id),
            "iat": now,
            "exp": now + cls.CONFIRM_TOKEN_TTL,
        }
        return str(jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256"))

    @classmethod
    def read_confirm_token(
        cls,
        token: str,
        event_id: str,
        location_id: Optional[str],
        organization_id: str,
    ) -> Optional[str]:
        """Return the prospect id a confirm token names, or None.

        None for anything that is not a live token of this type issued for this
        event, in this room, in this department — an expired one, a session
        token, or one issued at another event all read the same.
        """
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=["HS256"],
                options={"require": ["exp", "sub"]},
            )
        except jwt.PyJWTError:
            return None
        if (
            payload.get("type") != cls.CONFIRM_TOKEN_TYPE
            or payload.get("evt") != str(event_id)
            or payload.get("loc") != (str(location_id) if location_id else "")
            or payload.get("org") != str(organization_id)
        ):
            return None
        prospect_id = payload.get("sub")
        return prospect_id if isinstance(prospect_id, str) else None

    async def check_in_known_prospect(
        self,
        event: Event,
        organization_id: str,
        prospect_id: str,
        source: str = SOURCE_KIOSK_QR,
    ) -> Tuple[Optional[EventExternalAttendee], Optional[str], bool]:
        """Sign in an applicant the kiosk recognised and they confirmed.

        Returns ``(attendee, error, already_checked_in)``. The prospect is read
        again rather than trusted from the lookup: it may have been withdrawn
        in the minutes between the two taps, and an applicant who is no longer
        active is not one the kiosk recognises. The attendance itself goes
        through :meth:`check_in_guest` with the details already on file, so a
        repeat confirm is the same idempotent re-scan a typed sign-in is.
        """
        prospect = (
            await self.db.execute(
                select(ProspectiveMember).where(
                    ProspectiveMember.id == prospect_id,
                    ProspectiveMember.organization_id == organization_id,
                    ProspectiveMember.status == ProspectStatus.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if prospect is None:
            return (
                None,
                "We couldn't confirm your details. Please see a member of staff.",
                False,
            )

        email = (prospect.email or "").strip().lower()
        existing = await self._find_existing_attendee(
            event_id=str(event.id),
            organization_id=organization_id,
            email=email or None,
            full_name=f"{prospect.first_name} {prospect.last_name}".strip(),
        )
        already_checked_in = bool(existing and existing.checked_in)

        attendee, error, _created = await self.check_in_guest(
            event=event,
            organization_id=organization_id,
            first_name=prospect.first_name,
            last_name=prospect.last_name,
            email=email or None,
            phone=prospect.phone,
            source=source,
        )
        return attendee, error, already_checked_in

    async def open_prospect_for_staff_entry(
        self,
        event: Event,
        organization_id: str,
        attendee: EventExternalAttendee,
    ) -> Tuple[Optional[str], bool]:
        """Open or link an applicant for a walk-in staff signed in by hand.

        Returns ``(prospect_id, failed)``. At an event that adds its guests to
        the pipeline the kiosk signs in only applicants it already knows and
        sends everyone else to staff, so this is where a first-time visitor's
        application is opened. It follows the kiosk's lookup: an active
        applicant is linked, a member account is left alone (a member is not
        an applicant, however staff entered them), and anyone else is opened.

        No prospect without an email to follow up on, or without a first and
        last name to file it under. ``failed`` is True only when the pipeline
        raised, so the caller knows its session needs a rollback.
        """
        if not event.guest_check_in_creates_prospect or not attendee.email:
            return None, False

        first_name, _, last_name = (attendee.name or "").strip().rpartition(" ")
        first_name, last_name = first_name.strip(), last_name.strip()
        if not first_name or not last_name:
            return None, False

        email = attendee.email.strip().lower()
        outcome, _prospect = await self.lookup_guest(organization_id, email)
        if outcome == self.LOOKUP_MEMBER:
            return None, False

        # The attendee's phone is free text up to 50 characters; the applicant
        # record holds 20. A longer one is left off the application rather
        # than cut short — the email is the contact the pipeline uses.
        phone = attendee.phone if attendee.phone and len(attendee.phone) <= 20 else None

        prospect, _created = await self._link_prospect(
            event=event,
            organization_id=organization_id,
            attendee=attendee,
            first_name=first_name,
            last_name=last_name,
            email=email,
            phone=phone,
            interest_reason=None,
            source=self.SOURCE_STAFF_ENTRY,
            note=f"Checked in at {event.title} by staff",
        )
        if prospect is None:
            return None, True
        return str(prospect.id), False

    # ------------------------------------------------------------------
    # The event's own guest QR code
    # ------------------------------------------------------------------

    @classmethod
    def new_link_token(cls) -> str:
        return secrets.token_urlsafe(cls.LINK_TOKEN_BYTES)

    async def issue_link_token(
        self, event_id: str, organization_id: str, rotate: bool = False
    ) -> Tuple[Optional[Event], bool]:
        """Give the event a guest QR code, or replace the one it has.

        Returns ``(event, changed)``; ``event`` is None when it is not in this
        organization. Without ``rotate`` this is idempotent: an event that
        already has a code keeps it, so a code printed yesterday still works
        when a second manager opens the QR page today. The row is locked so two
        managers opening the page at once cannot each issue a code and leave
        the first holding one the second overwrote.

        Issuing needs guest check-in switched on, so a code is never printed
        for an event that would refuse every scan. Rotating does not: revoking
        a code that leaked is always safe.

        Raises ``ValueError`` when issuing for an event that does not take
        guest sign-ins.
        """
        event = (
            await self.db.execute(
                select(Event)
                .where(
                    Event.id == str(event_id),
                    Event.organization_id == str(organization_id),
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if event is None:
            return None, False

        # Neither early exit commits: the lock is released with the caller's
        # transaction, and a rollback here would discard the caller's own
        # pending work along with it.
        if not rotate and event.guest_check_in_token:
            return event, False
        if not rotate and not event.allow_guest_check_in:
            raise ValueError(
                "Turn on guest check-in for this event before showing its "
                "guest QR code."
            )

        event.guest_check_in_token = self.new_link_token()
        await self.db.commit()
        return event, True

    async def get_event_by_link_token(self, token: str) -> Optional[Event]:
        """Resolve the event an anonymous guest QR code names, or None.

        The token is the only credential in play, so it alone decides the
        event and, through it, the organization. None covers a malformed or
        unknown token, a cancelled or unpublished event, and one whose guest
        check-in has been switched off since the code was printed — every
        case reads the same so the caller can answer one 404.
        """
        if not self.LINK_TOKEN_PATTERN.fullmatch(token or ""):
            return None
        event = (
            await self.db.execute(
                select(Event)
                .where(
                    Event.guest_check_in_token == token,
                    Event.is_cancelled.is_(False),
                    Event.is_draft.is_(False),
                )
                .options(selectinload(Event.location_obj))
            )
        ).scalar_one_or_none()
        if event is None or not event.allow_guest_check_in:
            return None
        return event
