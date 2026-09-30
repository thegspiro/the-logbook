"""
Event attendance petitions.

A member who was at an event but has no check-in (no signal, a dead phone, a
QR code nobody put up) asks to be recorded as present. The event's organizer —
or anyone holding ``events.manage`` — confirms the times and approves it, or
rejects it with a reason.

Approval writes the same manager override the attendance screen writes (see
``EventService.override_rsvp_attendance``), so crediting stays on its one path:
the event's finalize turns the override into training records or admin hours.
It is therefore refused while attendance is finalized; reopening attendance is
the deliberate step that lets credited records change.
"""

import html as _html
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple

from loguru import logger
from sqlalchemy import case, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.core.utils import generate_uuid
from app.models.event import (
    AttendancePetitionStatus,
    Event,
    EventAttendancePetition,
    EventRSVP,
    RSVPStatus,
)
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.schemas.event import (
    AttendancePetitionApprove,
    AttendancePetitionCreate,
    AttendancePetitionReject,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.event_service import (
    EventService,
    attendance_is_finalized,
    attendance_locked_error,
)
from app.services.notifications_service import NotificationsService
from app.utils.org_timezone import format_in_org_timezone

# How long after an event ends a member may still ask. Long enough to cover a
# monthly compliance reconciliation, short enough that the organizer can still
# remember who was in the room. Owner decision, 2026-09-30.
PETITION_WINDOW_DAYS = 30

REVIEW_PERMISSION = "events.manage"

# In-app categories. Metadata carries petition_id so the reviewers' prompts can
# be archived once any one of them decides.
REVIEW_PROMPT_CATEGORY = "attendance_request"
MEMBER_UPDATE_CATEGORY = "attendance_request_update"


class PetitionNotFound(LookupError):
    """The event or petition does not exist in the caller's organization."""


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=dt_timezone.utc) if value.tzinfo is None else value


def effective_end(event: Event) -> datetime:
    """When the event ended: its recorded end if one was set, else scheduled."""
    return _utc(event.actual_end_time or event.end_datetime)


def can_review(event: Event, reviewer: User) -> bool:
    """The organizer, or anyone the department trusts to correct attendance."""
    if event.created_by and str(event.created_by) == str(reviewer.id):
        return True
    return user_has_permission(reviewer, REVIEW_PERMISSION)


class EventAttendancePetitionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get_event(
        self, event_id: str, organization_id: str, *, for_update: bool = False
    ) -> Event:
        query = select(Event).where(
            Event.id == str(event_id),
            Event.organization_id == str(organization_id),
        )
        if for_update:
            query = query.with_for_update().execution_options(populate_existing=True)
        event = (await self.db.execute(query)).scalar_one_or_none()
        if event is None:
            raise PetitionNotFound("Event not found")
        return event

    async def get_own(
        self, event_id: str, member: User
    ) -> Tuple[Optional[EventAttendancePetition], Optional[str]]:
        """The member's petition, and why they may not make one (None if they
        may). Both come from here so the screen never re-derives the rules."""
        organization_id = str(member.organization_id)
        event = await self.get_event(event_id, organization_id)
        result = await self.db.execute(
            select(EventAttendancePetition).where(
                EventAttendancePetition.event_id == str(event.id),
                EventAttendancePetition.user_id == str(member.id),
                EventAttendancePetition.organization_id == organization_id,
            )
        )
        petition = result.scalar_one_or_none()
        if petition is not None:
            return petition, (
                "You have already requested attendance credit for this event"
            )
        return None, await self._ineligibility(event, member)

    async def _ineligibility(self, event: Event, member: User) -> Optional[str]:
        """Why *member* cannot ask about *event* right now, or None."""
        now = datetime.now(dt_timezone.utc)
        if event.is_draft or event.is_cancelled:
            return "This event is not open to attendance requests"
        # While self check-in still works, that is the way to be recorded —
        # an organizer should not be asked to vouch for a tap the member can
        # still make. The window is the backend's, not the scheduled end: a
        # "window" event accepts check-ins for a while after it.
        _, check_in_closes_at = EventService._get_check_in_window(event)
        if now < check_in_closes_at:
            return "Check-in for this event is still open. Check in instead."
        if now > effective_end(event) + timedelta(days=PETITION_WINDOW_DAYS):
            return (
                f"Attendance can only be requested within {PETITION_WINDOW_DAYS} "
                "days of an event"
            )
        rsvp = (
            await self.db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == str(event.id),
                    EventRSVP.user_id == str(member.id),
                )
            )
        ).scalar_one_or_none()
        # An officer's back-filled check-in time counts as present even where
        # it never set checked_in (see the user_attended projection).
        if rsvp is not None and (
            rsvp.checked_in or rsvp.override_check_in_at is not None
        ):
            return "You are already recorded as present at this event"
        return None

    async def list_for_event(
        self, event_id: str, reviewer: User
    ) -> List[EventAttendancePetition]:
        event = await self.get_event(event_id, reviewer.organization_id)
        if not can_review(event, reviewer):
            raise PermissionError(
                "Only the event's organizer or an event manager can review "
                "attendance requests"
            )
        pending_first = case(
            (EventAttendancePetition.status == AttendancePetitionStatus.PENDING, 0),
            else_=1,
        )
        result = await self.db.execute(
            select(EventAttendancePetition)
            .where(
                EventAttendancePetition.event_id == str(event_id),
                EventAttendancePetition.organization_id
                == str(reviewer.organization_id),
            )
            .order_by(pending_first, EventAttendancePetition.created_at)
        )
        return list(result.scalars().all())

    async def display_names(
        self, user_ids: Iterable[Optional[str]], organization_id: str
    ) -> Dict[str, str]:
        """Names for the members on a set of petitions, org-scoped.

        Inactive members are still named: a petition from someone who has
        since left is still theirs.
        """
        ids = {str(uid) for uid in user_ids if uid}
        if not ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_(ids), User.organization_id == str(organization_id)
            )
        )
        names: Dict[str, str] = {}
        for user in result.scalars().all():
            full = f"{user.first_name or ''} {user.last_name or ''}".strip()
            names[str(user.id)] = full or user.username
        return names

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def submit(
        self, event_id: str, member: User, data: AttendancePetitionCreate
    ) -> EventAttendancePetition:
        organization_id = str(member.organization_id)
        event = await self.get_event(event_id, organization_id)
        now = datetime.now(dt_timezone.utc)

        if event.is_draft:
            raise PetitionNotFound("Event not found")
        for requested in (data.requested_check_in_at, data.requested_check_out_at):
            if requested is not None and _utc(requested) > now:
                raise ValueError("Requested times cannot be in the future")
        refusal = await self._ineligibility(event, member)
        if refusal:
            raise ValueError(refusal)

        petition = EventAttendancePetition(
            id=generate_uuid(),
            organization_id=organization_id,
            event_id=str(event.id),
            user_id=str(member.id),
            status=AttendancePetitionStatus.PENDING,
            reason=data.reason,
            requested_check_in_at=_utc(data.requested_check_in_at),
            requested_check_out_at=_utc(data.requested_check_out_at),
        )
        self.db.add(petition)
        try:
            await self.db.commit()
        except IntegrityError:
            # The unique (event_id, user_id) index, reached by a double tap or
            # by asking a second time. One request per member per event.
            await self.db.rollback()
            raise ValueError(
                "You have already requested attendance credit for this event"
            )
        await self.db.refresh(petition)

        await self._notify_reviewers(event, petition, member)
        return petition

    async def approve(
        self,
        event_id: str,
        petition_id: str,
        reviewer: User,
        data: AttendancePetitionApprove,
    ) -> EventAttendancePetition:
        organization_id = str(reviewer.organization_id)
        # Locking the event serializes this against finalize, which reads
        # the RSVPs this writes; locking the petition serializes two
        # reviewers deciding the same request at once.
        event = await self.get_event(event_id, organization_id, for_update=True)
        petition = await self._locked_petition(event, petition_id)
        self._assert_may_decide(event, petition, reviewer)

        if attendance_is_finalized(event):
            raise ValueError(attendance_locked_error("approving an attendance request"))

        check_in_at = _utc(data.check_in_at)
        check_out_at = _utc(data.check_out_at)
        now = datetime.now(dt_timezone.utc)
        if check_out_at > now:
            raise ValueError("Check-out time cannot be in the future")

        rsvp = (
            await self.db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == str(event.id),
                    EventRSVP.user_id == str(petition.user_id),
                )
            )
        ).scalar_one_or_none()
        if rsvp is None:
            rsvp = EventRSVP(
                id=generate_uuid(),
                organization_id=organization_id,
                event_id=str(event.id),
                user_id=str(petition.user_id),
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=now,
            )
            self.db.add(rsvp)
        else:
            # They were there, whatever they answered beforehand.
            rsvp.status = RSVPStatus.GOING

        # The same fields EventService.override_rsvp_attendance writes, so
        # finalize credits this exactly as it credits an officer's Edit Times.
        rsvp.checked_in = True
        if not rsvp.checked_in_at:
            rsvp.checked_in_at = check_in_at
        rsvp.override_check_in_at = check_in_at
        rsvp.override_check_out_at = check_out_at
        rsvp.override_duration_minutes = int(
            (check_out_at - check_in_at).total_seconds() / 60
        )
        rsvp.overridden_by = str(reviewer.id)
        rsvp.overridden_at = now
        rsvp.updated_at = now

        petition.status = AttendancePetitionStatus.APPROVED
        petition.reviewed_by = str(reviewer.id)
        petition.reviewed_at = now
        petition.review_note = (data.review_note or "").strip() or None

        await self.db.commit()
        await self.db.refresh(petition)

        await self._after_decision(event, petition, reviewer, check_in_at, check_out_at)
        return petition

    async def reject(
        self,
        event_id: str,
        petition_id: str,
        reviewer: User,
        data: AttendancePetitionReject,
    ) -> EventAttendancePetition:
        organization_id = str(reviewer.organization_id)
        event = await self.get_event(event_id, organization_id)
        petition = await self._locked_petition(event, petition_id)
        self._assert_may_decide(event, petition, reviewer)

        petition.status = AttendancePetitionStatus.REJECTED
        petition.reviewed_by = str(reviewer.id)
        petition.reviewed_at = datetime.now(dt_timezone.utc)
        petition.review_note = data.review_note

        await self.db.commit()
        await self.db.refresh(petition)

        await self._after_decision(event, petition, reviewer, None, None)
        return petition

    async def _locked_petition(
        self, event: Event, petition_id: str
    ) -> EventAttendancePetition:
        result = await self.db.execute(
            select(EventAttendancePetition)
            .where(
                EventAttendancePetition.id == str(petition_id),
                EventAttendancePetition.event_id == str(event.id),
                EventAttendancePetition.organization_id == str(event.organization_id),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        petition = result.scalar_one_or_none()
        if petition is None:
            raise PetitionNotFound("Attendance request not found")
        return petition

    @staticmethod
    def _assert_may_decide(
        event: Event, petition: EventAttendancePetition, reviewer: User
    ) -> None:
        if not can_review(event, reviewer):
            raise PermissionError(
                "Only the event's organizer or an event manager can review "
                "attendance requests"
            )
        # The point of a petition is that someone else vouches for you.
        if str(petition.user_id) == str(reviewer.id):
            raise PermissionError("You cannot decide your own attendance request")
        if petition.status != AttendancePetitionStatus.PENDING:
            raise ValueError("This attendance request has already been decided")

    # ------------------------------------------------------------------
    # Notifications — in-app always, email per the member's preferences
    # (CLAUDE.md #18: email is the channel of record; no SMS for this).
    # ------------------------------------------------------------------

    async def _reviewers_to_notify(self, event: Event, member: User) -> List[User]:
        """The organizer; failing that, everyone holding events.manage.

        Any holder of events.manage may decide, but prompting all of them for
        every request would bury the organizer's own task under everyone
        else's. The fallback covers an event whose organizer has left or was
        never recorded, where nobody would otherwise hear of it.
        """
        organization_id = str(event.organization_id)
        skip = str(member.id)
        if event.created_by and str(event.created_by) != skip:
            creator = (
                await self.db.execute(
                    select(User).where(
                        User.id == str(event.created_by),
                        User.organization_id == organization_id,
                        User.is_active,
                    )
                )
            ).scalar_one_or_none()
            if creator is not None:
                return [creator]

        result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(
                User.organization_id == organization_id,
                User.is_active,
            )
        )
        return [
            user
            for user in result.scalars().all()
            if str(user.id) != skip and user_has_permission(user, REVIEW_PERMISSION)
        ]

    async def _organization(self, organization_id: str) -> Optional[Organization]:
        return (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()

    async def _notify_reviewers(
        self, event: Event, petition: EventAttendancePetition, member: User
    ) -> None:
        try:
            recipients = await self._reviewers_to_notify(event, member)
            if not recipients:
                return
            names = await self.display_names([member.id], event.organization_id)
            name = names.get(str(member.id), "A member")
            title = event.title or "an event"
            subject = f"Attendance request — {name}, {title}"
            message = (
                f'{name} asked to be marked present at "{title}". '
                f"Review the request on the event page."
            )
            action_url = f"/events/{event.id}"
            for recipient in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=str(event.organization_id),
                        recipient_id=str(recipient.id),
                        channel=NotificationChannel.IN_APP,
                        category=REVIEW_PROMPT_CATEGORY,
                        subject=subject,
                        message=message,
                        action_url=action_url,
                        notification_metadata={
                            "event_id": str(event.id),
                            "petition_id": str(petition.id),
                        },
                        delivered=True,
                    )
                )
            await self.db.commit()

            org = await self._organization(event.organization_id)
            to_emails = [
                user.email
                for user in recipients
                if user.email
                and member_receives_email(
                    user.notification_preferences,
                    EmailKind.EVENT_DUTIES,
                    department_required_kinds(org),
                )
            ]
            if to_emails:
                reason_html = _html.escape(petition.reason)
                await self._send_email(
                    org,
                    to_emails,
                    subject,
                    "Attendance Request",
                    f"<p>{_html.escape(name)} asked to be marked present at "
                    f"<strong>{_html.escape(title)}</strong>, which they have "
                    f"no check-in for.</p>"
                    f'<p style="white-space:pre-line;"><strong>Their reason:'
                    f"</strong> {reason_html}</p>"
                    f"<p>Confirm the times and approve the request, or reject "
                    f"it with a reason.</p>",
                    f'{name} asked to be marked present at "{title}", which '
                    f"they have no check-in for.\n\nTheir reason: "
                    f"{petition.reason}\n\nConfirm the times and approve the "
                    f"request, or reject it with a reason.",
                    event,
                    "Review Request",
                )
        except Exception:
            # The request is committed; a failed notice must not un-commit it
            # or turn the member's success into an error.
            logger.exception(
                "Failed to notify reviewers of attendance request {}", petition.id
            )
            await self._recover(petition)

    async def _after_decision(
        self,
        event: Event,
        petition: EventAttendancePetition,
        reviewer: User,
        check_in_at: Optional[datetime],
        check_out_at: Optional[datetime],
    ) -> None:
        # Every reviewer's prompt goes once any one of them has decided.
        await NotificationsService(self.db).archive_related_notifications(
            event.organization_id,
            REVIEW_PROMPT_CATEGORY,
            "petition_id",
            str(petition.id),
        )
        try:
            org = await self._organization(event.organization_id)
            names = await self.display_names(
                [reviewer.id, petition.user_id], event.organization_id
            )
            reviewer_name = names.get(str(reviewer.id), "The event organizer")
            title = event.title or "the event"
            note = petition.review_note or ""
            if petition.status == AttendancePetitionStatus.APPROVED:
                times = (
                    f"{format_in_org_timezone(check_in_at, org, '%I:%M %p')} to "
                    f"{format_in_org_timezone(check_out_at, org, '%I:%M %p')}"
                    if check_in_at and check_out_at
                    else ""
                )
                subject = f"Attendance request approved — {title}"
                message = (
                    f'{reviewer_name} approved your attendance at "{title}"'
                    + (f", from {times}" if times else "")
                    + "."
                )
                note_label = "Note"
            else:
                subject = f"Attendance request not approved — {title}"
                message = (
                    f"{reviewer_name} did not approve your attendance request "
                    f'for "{title}".'
                )
                note_label = "Reason"
            body = message + (f"\n\n{note_label}: {note}" if note else "")

            self.db.add(
                NotificationLog(
                    id=generate_uuid(),
                    organization_id=str(event.organization_id),
                    recipient_id=str(petition.user_id),
                    channel=NotificationChannel.IN_APP,
                    category=MEMBER_UPDATE_CATEGORY,
                    subject=subject,
                    message=body,
                    action_url=f"/events/{event.id}",
                    notification_metadata={
                        "event_id": str(event.id),
                        "petition_id": str(petition.id),
                    },
                    delivered=True,
                )
            )
            await self.db.commit()

            member = (
                await self.db.execute(
                    select(User).where(
                        User.id == str(petition.user_id),
                        User.organization_id == str(event.organization_id),
                    )
                )
            ).scalar_one_or_none()
            if (
                member is not None
                and member.email
                and member_receives_email(
                    member.notification_preferences,
                    EmailKind.EVENT_REMINDERS,
                    department_required_kinds(org),
                )
            ):
                note_html = (
                    f'<p style="white-space:pre-line;"><strong>{note_label}:'
                    f"</strong> {_html.escape(note)}</p>"
                    if note
                    else ""
                )
                await self._send_email(
                    org,
                    [member.email],
                    subject,
                    "Attendance Request",
                    f"<p>{_html.escape(message)}</p>{note_html}",
                    body,
                    event,
                    "View Event",
                )
        except Exception:
            logger.exception(
                "Failed to notify member of attendance request {}", petition.id
            )
            await self._recover(petition)

    async def _recover(self, petition: EventAttendancePetition) -> None:
        """Reset the session after a failed notice, keeping *petition* usable.

        A rollback expires every loaded instance, and the endpoint still has
        to serialize the petition; reading an expired attribute in an async
        session raises rather than lazy-loading.
        """
        try:
            await self.db.rollback()
            await self.db.refresh(petition)
        except Exception:
            logger.exception("Failed to reload attendance request {}", petition.id)

    @staticmethod
    async def _send_email(
        org: Optional[Organization],
        to_emails: List[str],
        subject: str,
        heading: str,
        body_html: str,
        body_text: str,
        event: Event,
        button_label: str,
    ) -> None:
        from app.services.email_service import EmailService, wrap_email_body

        url = f"{settings.FRONTEND_URL}/events/{event.id}"
        html_body = wrap_email_body(
            org,
            heading,
            body_html + f'<p style="text-align: center;">'
            f'<a href="{_html.escape(url)}" class="button" role="link">'
            f"{_html.escape(button_label)}</a></p>",
        )
        await EmailService(organization=org).send_email(
            to_emails=to_emails,
            subject=subject,
            html_body=html_body,
            text_body=f"{body_text}\n\n{button_label}: {url}",
        )


def reviewer_ids(petitions: Iterable[EventAttendancePetition]) -> Set[str]:
    ids: Set[str] = set()
    for petition in petitions:
        ids.add(str(petition.user_id))
        if petition.reviewed_by:
            ids.add(str(petition.reviewed_by))
    return ids
