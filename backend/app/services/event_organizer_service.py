"""
Event organizers: who runs an event, who hears about it, and handing it over.

An event names an organizer and an optional alternate. They — not every holder
of ``events.manage`` — are asked to vouch for a member who missed check-in, and
they receive the series-end reminder for a recurring event. Either of them, or
any events manager, can hand the event to somebody else; on a recurring event
the handover can carry to every upcoming occurrence, which is how a new officer
takes over a standing drill night without anybody re-creating it.

When neither can be reached — both have left, or the only one set is the member
asking — attendance requests go to a position the department picks per event
type in Events settings, then to its Secretary, and only as the last resort to
every events manager, so a request is never addressed to nobody.
"""

import html as _html
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from loguru import logger
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.core.utils import generate_uuid
from app.models.event import Event
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)

# The permission that lets anyone decide or reassign any event. The organizer
# and alternate hold the same rights over their own event without it.
EVENT_MANAGER_PERMISSION = "events.manage"

# Org setting: event type -> position id whose members take attendance
# requests nobody else on the event can.
FALLBACK_POSITIONS_SETTING = "attendance_request_fallback_positions"
# Used for an event type the department has not configured.
DEFAULT_FALLBACK_POSITION_SLUG = "secretary"

TRANSFER_SCOPE_THIS = "this"
TRANSFER_SCOPE_FUTURE = "future"
TRANSFER_SCOPES = (TRANSFER_SCOPE_THIS, TRANSFER_SCOPE_FUTURE)

TRANSFER_NOTICE_CATEGORY = "event_transfer"

ROLE_ORGANIZER = "organizer"
ROLE_ALTERNATE = "alternate"
_ROLE_LABELS = {ROLE_ORGANIZER: "organizer", ROLE_ALTERNATE: "alternate organizer"}


def eligible_member_clause():
    """Members who can run an event and be asked about it: active or on
    probation, and not deleted. A probationary member running a drill is
    ordinary; one on leave or retired should not be handed requests."""
    return and_(
        User.status.in_((UserStatus.ACTIVE, UserStatus.PROBATIONARY)),
        User.deleted_at.is_(None),
    )


def organizer_ids(event: Event) -> List[str]:
    """The event's organizer and alternate, in that order, without blanks."""
    ids: List[str] = []
    for value in (event.organizer_id, event.alternate_organizer_id):
        if value and str(value) not in ids:
            ids.append(str(value))
    return ids


def is_event_organizer(event: Event, user: User) -> bool:
    return str(user.id) in organizer_ids(event)


def can_manage_organizers(event: Event, user: User) -> bool:
    """Whether *user* may decide this event's attendance requests and hand it
    over: its organizer, its alternate, or an events manager. One rule for
    both, because whoever answers for the event is whoever may pass it on."""
    return is_event_organizer(event, user) or user_has_permission(
        user, EVENT_MANAGER_PERMISSION
    )


def _display_name(user: User) -> str:
    return user.display_name or user.username


def _event_type_value(event: Event) -> str:
    value = event.event_type
    return value.value if hasattr(value, "value") else str(value or "")


@dataclass
class TransferResult:
    # Plain values, not the ORM rows: the notices that follow can roll the
    # session back (a failed email), which expires every loaded instance, and
    # reading one afterwards in an async session raises instead of reloading.
    event_id: str
    organization_id: str
    title: str
    actor_id: str
    actor_name: str
    updated_count: int
    previous_organizer_id: Optional[str]
    previous_alternate_id: Optional[str]
    affected_event_ids: List[str] = field(default_factory=list)


class EventOrganizerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def _active_member(self, user_id: str, organization_id: str) -> User:
        user: Optional[User] = (
            await self.db.execute(
                select(User).where(
                    User.id == str(user_id),
                    User.organization_id == str(organization_id),
                    eligible_member_clause(),
                )
            )
        ).scalar_one_or_none()
        if user is None:
            raise ValueError("The selected member is not an active member")
        return user

    async def validate_pair(
        self,
        organization_id: str,
        organizer_id: Optional[str],
        alternate_id: Optional[str],
        *,
        default_organizer_id: Optional[str] = None,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Normalize and check a client-supplied organizer/alternate pair.

        Both must be active members of the caller's department (XC-1: a
        foreign id would otherwise be stored and later routed notices), and
        the alternate is a second person, not the organizer twice.
        ``default_organizer_id`` stands in, unchecked, for an organizer the
        client left out — the creator, who is the authenticated caller.
        """
        organizer = str(organizer_id) if organizer_id else None
        alternate = str(alternate_id) if alternate_id else None
        for user_id in (organizer, alternate):
            if user_id:
                await self._active_member(user_id, organization_id)
        organizer = organizer or default_organizer_id
        if alternate and not organizer:
            raise ValueError("Choose an organizer before an alternate")
        if organizer and alternate and organizer == alternate:
            raise ValueError("The alternate must be a different member")
        return organizer, alternate

    # ------------------------------------------------------------------
    # Who hears about an attendance request
    # ------------------------------------------------------------------

    async def _active_users(
        self, user_ids: Sequence[str], organization_id: str
    ) -> List[User]:
        """*user_ids* who can still run an event, in the order given."""
        if not user_ids:
            return []
        result = await self.db.execute(
            select(User).where(
                User.id.in_([str(u) for u in user_ids]),
                User.organization_id == str(organization_id),
                eligible_member_clause(),
            )
        )
        by_id = {str(u.id): u for u in result.scalars().all()}
        return [by_id[str(u)] for u in user_ids if str(u) in by_id]

    async def _position_members(
        self, position_id: str, organization_id: str
    ) -> List[User]:
        result = await self.db.execute(
            select(User)
            .join(user_positions, user_positions.c.user_id == User.id)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(
                Position.id == str(position_id),
                Position.organization_id == str(organization_id),
                User.organization_id == str(organization_id),
                User.is_active,
            )
            .order_by(User.last_name, User.first_name)
        )
        return list(result.scalars().all())

    async def _fallback_position_ids(self, event: Event) -> List[str]:
        """The configured position for this event type, then the Secretary."""
        organization_id = str(event.organization_id)
        ids: List[str] = []
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        configured = (
            ((org.settings or {}).get("events") or {}).get(FALLBACK_POSITIONS_SETTING)
            if org is not None
            else None
        )
        # Free-form JSON (CLAUDE.md #19): a malformed value degrades to the
        # built-in default instead of failing the member's request.
        if isinstance(configured, dict):
            position_id = configured.get(_event_type_value(event))
            if isinstance(position_id, str) and position_id:
                ids.append(position_id)
        secretary_ids = (
            (
                await self.db.execute(
                    select(Position.id).where(
                        Position.organization_id == organization_id,
                        Position.slug == DEFAULT_FALLBACK_POSITION_SLUG,
                    )
                )
            )
            .scalars()
            .all()
        )
        ids.extend(str(p) for p in secretary_ids if str(p) not in ids)
        return ids

    async def attendance_request_recipients(
        self, event: Event, exclude_user_id: Optional[str] = None
    ) -> List[User]:
        """Who is asked to decide an attendance request on *event*.

        The organizer and alternate; failing both, the fallback position for
        the event type, then the Secretary, then every events manager. A step
        that leaves nobody (vacant, or only the member asking) moves to the
        next, so a request always reaches somebody who can decide it.
        """
        organization_id = str(event.organization_id)
        skip = str(exclude_user_id) if exclude_user_id else None

        def without_requester(users: Iterable[User]) -> List[User]:
            return [u for u in users if str(u.id) != skip]

        recipients = without_requester(
            await self._active_users(organizer_ids(event), organization_id)
        )
        if recipients:
            return recipients

        for position_id in await self._fallback_position_ids(event):
            recipients = without_requester(
                await self._position_members(position_id, organization_id)
            )
            if recipients:
                return recipients

        result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.organization_id == organization_id, User.is_active)
        )
        return [
            user
            for user in without_requester(result.scalars().all())
            if user_has_permission(user, EVENT_MANAGER_PERMISSION)
        ]

    async def series_reminder_recipients(self, event: Event) -> List[User]:
        """The organizer and alternate of a series; its creator if neither is
        reachable, which is who the reminder went to before organizers."""
        organization_id = str(event.organization_id)
        recipients = await self._active_users(organizer_ids(event), organization_id)
        if recipients or not event.created_by:
            return recipients
        return await self._active_users([str(event.created_by)], organization_id)

    # ------------------------------------------------------------------
    # Transfer
    # ------------------------------------------------------------------

    async def _series_events(self, anchor: Event, organization_id: str) -> List[Event]:
        """This occurrence, every upcoming one in its series, and the series
        parent — which carries the series-end reminder and is what a rolling
        series copies new occurrences from, so a handover that skipped it
        would be undone the next time the series extends. Past occurrences
        keep the organizer who ran them."""
        parent_id = str(anchor.recurrence_parent_id or anchor.id)
        result = await self.db.execute(
            select(Event)
            .where(
                Event.organization_id == organization_id,
                or_(Event.id == parent_id, Event.recurrence_parent_id == parent_id),
                or_(
                    Event.id == parent_id,
                    Event.id == str(anchor.id),
                    (Event.start_datetime >= anchor.start_datetime)
                    & Event.is_cancelled.is_(False),
                ),
            )
            .order_by(Event.start_datetime)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    async def transfer(
        self,
        event_id: str,
        actor: User,
        organizer_id: str,
        alternate_id: Optional[str],
        scope: str,
    ) -> TransferResult:
        organization_id = str(actor.organization_id)
        if scope not in TRANSFER_SCOPES:
            raise ValueError("Choose this event or this and future events")

        anchor = (
            await self.db.execute(
                select(Event)
                .where(
                    Event.id == str(event_id),
                    Event.organization_id == organization_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if anchor is None:
            raise LookupError("Event not found")
        if not can_manage_organizers(anchor, actor):
            raise PermissionError(
                "Only the event's organizer, its alternate or an event manager "
                "can transfer it"
            )

        new_organizer, new_alternate = await self.validate_pair(
            organization_id, organizer_id, alternate_id
        )
        if new_organizer is None:
            raise ValueError("Choose an organizer")

        previous_organizer = str(anchor.organizer_id) if anchor.organizer_id else None
        previous_alternate = (
            str(anchor.alternate_organizer_id)
            if anchor.alternate_organizer_id
            else None
        )

        if scope == TRANSFER_SCOPE_FUTURE and anchor.is_recurring:
            events = await self._series_events(anchor, organization_id)
        else:
            events = [anchor]

        changed = [
            e
            for e in events
            if (str(e.organizer_id) if e.organizer_id else None) != new_organizer
            or (str(e.alternate_organizer_id) if e.alternate_organizer_id else None)
            != new_alternate
        ]
        if not changed:
            raise ValueError("The event already has this organizer and alternate")

        for event in changed:
            event.organizer_id = new_organizer
            event.alternate_organizer_id = new_alternate
            event.updated_by = str(actor.id)
        affected_ids = [str(e.id) for e in changed]
        result = TransferResult(
            event_id=str(anchor.id),
            organization_id=organization_id,
            title=anchor.title or "an event",
            actor_id=str(actor.id),
            actor_name=_display_name(actor),
            updated_count=len(changed),
            previous_organizer_id=previous_organizer,
            previous_alternate_id=previous_alternate,
            affected_event_ids=affected_ids,
        )
        await self.db.commit()

        await self._redirect_pending_requests(affected_ids, organization_id)
        await self._notify_transfer(result, new_organizer, new_alternate)
        return result

    async def _redirect_pending_requests(
        self, event_ids: List[str], organization_id: str
    ) -> None:
        # Local import: the petition service imports this module for routing.
        from app.services.event_attendance_petition_service import (
            EventAttendancePetitionService,
        )

        try:
            await EventAttendancePetitionService(self.db).redirect_pending(
                event_ids, organization_id
            )
        except Exception:
            # The transfer is committed; a failed re-route must not turn it
            # into an error. The new organizer can still decide from the event.
            logger.exception("Failed to re-route attendance requests on transfer")
            await self.db.rollback()

    async def _notify_transfer(
        self,
        result: TransferResult,
        new_organizer: str,
        new_alternate: Optional[str],
    ) -> None:
        """Tell whoever was given a role, and whoever lost one. Never the actor:
        they know what they just did."""
        actor_id = result.actor_id
        old_roles: Dict[str, str] = {}
        if result.previous_alternate_id:
            old_roles[result.previous_alternate_id] = ROLE_ALTERNATE
        if result.previous_organizer_id:
            old_roles[result.previous_organizer_id] = ROLE_ORGANIZER
        new_roles: Dict[str, str] = {new_organizer: ROLE_ORGANIZER}
        if new_alternate:
            new_roles[new_alternate] = ROLE_ALTERNATE

        assigned = {
            uid: role
            for uid, role in new_roles.items()
            if uid != actor_id and old_roles.get(uid) != role
        }
        released = {
            uid: role
            for uid, role in old_roles.items()
            if uid != actor_id and uid not in new_roles
        }
        if not assigned and not released:
            return

        try:
            organization_id = result.organization_id
            users = {
                str(u.id): u
                for u in await self._active_users(
                    list(assigned) + list(released) + [new_organizer],
                    organization_id,
                )
            }
            org = (
                await self.db.execute(
                    select(Organization).where(Organization.id == organization_id)
                )
            ).scalar_one_or_none()
            actor_name = result.actor_name
            title = result.title
            later = result.updated_count - 1
            scope_note = (
                f" and {later} later occurrence{'s' if later != 1 else ''} in "
                "the series"
                if later > 0
                else ""
            )
            new_organizer_name = (
                _display_name(users[new_organizer])
                if new_organizer in users
                else "a new organizer"
            )

            notices: List[Tuple[User, str, str]] = []
            for uid, role in assigned.items():
                user = users.get(uid)
                if user is None:
                    continue
                label = _ROLE_LABELS[role]
                notices.append(
                    (
                        user,
                        f"You are now the {label} — {title}",
                        f'{actor_name} made you the {label} of "{title}"'
                        f"{scope_note}. Attendance requests for it will come "
                        "to you.",
                    )
                )
            for uid, role in released.items():
                user = users.get(uid)
                if user is None:
                    continue
                label = _ROLE_LABELS[role]
                notices.append(
                    (
                        user,
                        f"Event handed over — {title}",
                        f'{actor_name} handed "{title}"{scope_note} to '
                        f"{new_organizer_name}. You are no longer its {label}.",
                    )
                )

            for user, subject, message in notices:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=organization_id,
                        recipient_id=str(user.id),
                        channel=NotificationChannel.IN_APP,
                        category=TRANSFER_NOTICE_CATEGORY,
                        subject=subject,
                        message=message,
                        action_url=f"/events/{result.event_id}",
                        notification_metadata={"event_id": result.event_id},
                        delivered=True,
                    )
                )
            await self.db.commit()

            required = department_required_kinds(org)
            for user, subject, message in notices:
                if user.email and member_receives_email(
                    user.notification_preferences, EmailKind.EVENT_DUTIES, required
                ):
                    await self._send_email(
                        org, user.email, subject, message, result.event_id
                    )
        except Exception:
            logger.exception(
                "Failed to send event transfer notices for {}", result.event_id
            )
            try:
                await self.db.rollback()
            except Exception:
                logger.exception("Failed to reset session after transfer notices")

    @staticmethod
    async def _send_email(
        org: Optional[Organization],
        to_email: str,
        subject: str,
        message: str,
        event_id: str,
    ) -> None:
        from app.services.email_service import EmailService, wrap_email_body

        url = f"{settings.FRONTEND_URL}/events/{event_id}"
        html_body = wrap_email_body(
            org,
            "Event Organizer",
            f"<p>{_html.escape(message)}</p>"
            f'<p style="text-align: center;">'
            f'<a href="{_html.escape(url)}" class="button" role="link">'
            f"View Event</a></p>",
        )
        await EmailService(organization=org).send_email(
            to_emails=[to_email],
            subject=subject,
            html_body=html_body,
            text_body=f"{message}\n\nView Event: {url}",
        )
