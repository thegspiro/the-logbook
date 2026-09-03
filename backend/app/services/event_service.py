"""
Event Service

Business logic for event management.
"""

import calendar
import copy
import csv
import io
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event import (
    EVENT_LIFECYCLE_CUSTOM_FIELD_KEYS,
    AttendeeVisibility,
    CheckInWindowType,
    Event,
    EventRSVP,
    EventTemplate,
    EventType,
    RecurrencePattern,
    RSVPHistory,
    RSVPStatus,
    default_reminder_target,
)
from app.models.notification import NotificationCategory, NotificationChannel
from app.models.training import TrainingRecord, TrainingSession, TrainingStatus
from app.models.user import MemberLeaveOfAbsence, Organization, User
from app.schemas.event import (
    EventCreate,
    EventStats,
    EventUpdate,
    RSVPCreate,
    RSVPOverride,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.location_service import LocationService
from app.services.notifications_service import NotificationsService
from app.utils.event_attachments import validate_attachments_for_org

DEFAULT_ALLOWED_RSVP_STATUSES = ["going", "not_going"]

BULK_ADD_MAX_SIZE = 200

# Ceiling on how many waitlisted parties one seat release may promote. Freeing
# N seats can legitimately admit N members, so this is generous rather than
# tight — it exists only so a regression in promote_from_waitlist's "no longer
# fits" condition cannot turn one RSVP into an unbounded loop.
MAX_WAITLIST_PROMOTIONS_PER_RELEASE = 50


def resolve_attendee_visibility(
    event: Any, org_settings: Optional[Dict[str, Any]]
) -> AttendeeVisibility:
    """Decide who may see ``event``'s attendee list.

    The per-event column wins when set; NULL hands the decision to the
    organization's ``events.defaults.attendee_visibility`` setting; an
    organization that never configured one falls back to MANAGERS, which is the
    behavior every installation had before member-visible rosters existed.

    An unrecognized stored value resolves to MANAGERS rather than raising:
    ``settings`` is unvalidated JSON, and a typo an administrator saved through
    some other path must not be able to publish a roster that was meant to stay
    restricted. Failing closed is the only safe direction for a visibility
    gate.
    """
    candidates = (
        getattr(event, "attendee_visibility", None),
        ((org_settings or {}).get("events") or {})
        .get("defaults", {})
        .get("attendee_visibility"),
    )
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return AttendeeVisibility(str(candidate).lower())
        except ValueError:
            logger.warning(
                "Unrecognized attendee_visibility {!r}; failing closed to "
                "managers-only",
                candidate,
            )
            return AttendeeVisibility.MANAGERS
    return AttendeeVisibility.MANAGERS


# Sentinel error prefix for the soft training-pipeline phase gate: a
# program-linked session is ahead of the member's current phase. The endpoint
# turns this into a 409 the client can override (proceed anyway).
PHASE_GATE_PREFIX = "PHASE_GATE::"

# Sentinel error prefix for the attendance lock. Finalizing an event closes its
# attendance: the durations it wrote feed admin hours, training records and
# compliance totals, so every write that could change those numbers is refused
# until a department leader reopens the event. The endpoint layer turns this
# into a 409 (conflicting state) rather than the 400 it gives a bad request —
# nothing about the caller's payload is wrong, the event is closed.
ATTENDANCE_LOCKED_PREFIX = "ATTENDANCE_LOCKED::"

# Fields on an update payload that change what attendance means. Editing the
# title or the description of a closed event is harmless housekeeping and stays
# allowed; moving its clock is not, because finalize derived every credited
# duration from end_datetime/actual_end_time and those minutes are already in
# the hours ledger.
ATTENDANCE_SENSITIVE_UPDATE_FIELDS = frozenset(
    {
        "start_datetime",
        "end_datetime",
        "actual_start_time",
        "actual_end_time",
        "require_checkout",
        "check_in_window_type",
        "check_in_minutes_before",
        "check_in_minutes_after",
        "event_type",
        "custom_category",
    }
)


def attendance_is_finalized(event: Event) -> bool:
    """Whether this event's attendance is closed.

    ``attendance_finalized_at`` is the authority. The legacy
    ``custom_fields["attendance_finalized"]`` marker is still consulted as a
    fallback so a row the backfill could not reach (a JSON payload the
    migration's dialect guard skipped) is not silently unlocked.
    """
    if getattr(event, "attendance_finalized_at", None) is not None:
        return True
    custom = getattr(event, "custom_fields", None) or {}
    return bool(custom.get("attendance_finalized"))


def attendance_locked_error(action: str) -> str:
    """Build the sentinel-prefixed refusal for a write blocked by the lock."""
    return (
        ATTENDANCE_LOCKED_PREFIX
        + f"Attendance for this event has been finalized, so {action} is no "
        "longer available. A department leader can reopen attendance to make "
        "corrections."
    )


class EventService:
    """Service for event management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_event(
        self, event_data: EventCreate, organization_id: UUID, created_by: UUID
    ) -> Event:
        """Create a new event"""
        # Validate dates
        if event_data.end_datetime <= event_data.start_datetime:
            raise ValueError("End date must be after start date")

        if event_data.requires_rsvp and event_data.rsvp_deadline:
            if event_data.rsvp_deadline >= event_data.start_datetime:
                raise ValueError("RSVP deadline must be before event start")

        # EV-17 / XC-1: `attachments` is a free-form JSON column that this
        # generic payload can write, and its `file_path` is the exact string
        # the download endpoint later serves. An unvalidated one lets a caller
        # graft another organization's uploaded file onto an event in their
        # own org and read it there.
        validate_attachments_for_org(event_data.attachments, organization_id)

        # Check for location double-booking
        if event_data.location_id:
            location_service = LocationService(self.db)
            # Validate the client-supplied location belongs to the caller's org
            # first: without this, a foreign location_id is stored (leaking that
            # org's location via the eager-loaded relationship) and the
            # double-booking guard — scoped to this org — never sees the other
            # org's real bookings for that room.
            if not await location_service.get_location(
                event_data.location_id, str(organization_id)
            ):
                raise ValueError("Location not found")
            overlapping = await location_service.check_overlapping_events(
                location_id=event_data.location_id,
                organization_id=str(organization_id),
                start_datetime=event_data.start_datetime,
                end_datetime=event_data.end_datetime,
            )
            if overlapping:
                titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                raise ValueError(
                    f"Location is already booked during this time. "
                    f"Conflicting event(s): {titles}"
                )

        # Prepare event data
        event_dict = event_data.model_dump()

        # Set default allowed_rsvp_statuses if not provided and RSVP is required
        if event_data.requires_rsvp and not event_dict.get("allowed_rsvp_statuses"):
            event_dict["allowed_rsvp_statuses"] = DEFAULT_ALLOWED_RSVP_STATUSES

        # Create event
        event = Event(
            organization_id=organization_id, created_by=created_by, **event_dict
        )

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)

        # Eagerly load location relationship for the response
        if event.location_id:
            result = await self.db.execute(
                select(Event)
                .where(Event.id == event.id)
                .options(selectinload(Event.location_obj))
            )
            event = result.scalar_one()

        return event

    async def get_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
        load_rsvps: bool = True,
    ) -> Optional[Tuple[Event, Optional[EventRSVP]]]:
        """
        Get an event by ID

        Returns: (Event, user's RSVP if exists). ``load_rsvps=False`` leaves
        the RSVP collection unloaded for a caller that only reads the event
        row, so a well-attended event does not cost its whole roster.
        """
        options = [selectinload(Event.location_obj)]
        if load_rsvps:
            options.append(selectinload(Event.rsvps))
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(*options)
        )
        event = result.scalar_one_or_none()

        if not event:
            return None, None

        # Get user's RSVP if user_id provided
        user_rsvp = None
        if user_id:
            rsvp_result = await self.db.execute(
                select(EventRSVP)
                .where(EventRSVP.event_id == str(event_id))
                .where(EventRSVP.user_id == str(user_id))
            )
            user_rsvp = rsvp_result.scalar_one_or_none()

        return event, user_rsvp

    async def list_events(
        self,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
        event_type: Optional[str] = None,
        custom_category: Optional[str] = None,
        exclude_event_types: Optional[List[str]] = None,
        start_after: Optional[datetime] = None,
        start_before: Optional[datetime] = None,
        end_after: Optional[datetime] = None,
        end_before: Optional[datetime] = None,
        include_cancelled: bool = False,
        include_drafts: bool = False,
        mandatory_only: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """List events with filtering.

        Returns dicts with event fields plus pre-computed rsvp_count,
        going_count, user_rsvp_status and user_attended — avoiding N+1
        queries.
        """
        # Aggregate RSVP counts as correlated subqueries
        rsvp_count_sq = (
            select(func.count(EventRSVP.id))
            .where(EventRSVP.event_id == Event.id)
            .correlate(Event)
            .scalar_subquery()
            .label("rsvp_count")
        )
        going_count_sq = (
            select(func.count(EventRSVP.id))
            .where(EventRSVP.event_id == Event.id)
            .where(EventRSVP.status == RSVPStatus.GOING)
            .correlate(Event)
            .scalar_subquery()
            .label("going_count")
        )

        # How many members are waiting, for the "N waiting" line on a
        # waitlisted card. A third correlated subquery on a query that already
        # runs two — still one round trip, no N+1. The member's *position* is
        # deliberately not here: ranking per row needs a window function, and
        # the card already knows the member is waitlisted from
        # user_rsvp_status. Position belongs on the detail page.
        #
        # The seat filter is the same one promote_from_waitlist and the detail
        # endpoint apply: a party bigger than the whole event is passed over by
        # promotion, so counting it here would make the card disagree with the
        # detail page the member opens next ("5 waiting", then "#1 of 4"). An
        # absent or zero cap means no cap, matching `if event.max_attendees:`
        # on the other two paths.
        waitlist_count_sq = (
            select(func.count(EventRSVP.id))
            .where(EventRSVP.event_id == Event.id)
            .where(EventRSVP.status == RSVPStatus.WAITLISTED)
            .where(
                or_(
                    func.coalesce(Event.max_attendees, 0) == 0,
                    1 + EventRSVP.guest_count <= Event.max_attendees,
                )
            )
            .correlate(Event)
            .scalar_subquery()
            .label("waitlist_count")
        )

        # Seats occupied, as opposed to members going: a member with two guests
        # fills three places. The cap is enforced in seats, so any UI that talks
        # about capacity ("N of M slots filled", roster-full) has to use this,
        # or it will promise room the RSVP path then refuses. going_count stays
        # the member count, which is what "N going" means.
        occupied_seats_sq = (
            select(func.coalesce(func.sum(1 + EventRSVP.guest_count), 0))
            .where(EventRSVP.event_id == Event.id)
            .where(EventRSVP.status == RSVPStatus.GOING)
            .correlate(Event)
            .scalar_subquery()
            .label("occupied_seats")
        )

        columns = [
            Event,
            rsvp_count_sq,
            going_count_sq,
            waitlist_count_sq,
            occupied_seats_sq,
        ]

        # Optionally include current user's RSVP status and attendance
        if user_id:
            user_rsvp_sq = (
                select(EventRSVP.status)
                .where(EventRSVP.event_id == Event.id)
                .where(EventRSVP.user_id == str(user_id))
                .correlate(Event)
                .scalar_subquery()
                .label("user_rsvp_status")
            )
            columns.append(user_rsvp_sq)

            # An officer recording attendance after the fact writes
            # override_check_in_at without ever setting `checked_in`, so a
            # member who was present but never scanned would otherwise read
            # back as a no-show on the list.
            user_attended_sq = (
                select(
                    case(
                        (
                            or_(
                                EventRSVP.checked_in.is_(True),
                                EventRSVP.override_check_in_at.isnot(None),
                            ),
                            True,
                        ),
                        else_=False,
                    )
                )
                .where(EventRSVP.event_id == Event.id)
                .where(EventRSVP.user_id == str(user_id))
                .correlate(Event)
                .scalar_subquery()
                .label("user_attended")
            )
            columns.append(user_attended_sq)

        query = (
            select(*columns)
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )

        if not include_drafts:
            query = query.where(
                or_(Event.is_draft.is_(False), Event.is_draft.is_(None))
            )

        if event_type:
            query = query.where(Event.event_type == event_type)

        if custom_category:
            query = query.where(Event.custom_category == custom_category)

        if exclude_event_types:
            query = query.where(Event.event_type.notin_(exclude_event_types))

        if not include_cancelled:
            query = query.where(Event.is_cancelled.is_(False))

        if mandatory_only:
            query = query.where(Event.is_mandatory.is_(True))

        if start_after:
            query = query.where(Event.start_datetime >= start_after)

        if start_before:
            query = query.where(Event.start_datetime <= start_before)

        if end_after:
            query = query.where(Event.end_datetime >= end_after)

        if end_before:
            query = query.where(Event.end_datetime <= end_before)

        # The id breaks ties between simultaneous events, so an offset page
        # never repeats or skips one.
        query = query.order_by(Event.start_datetime, Event.id).offset(skip).limit(limit)

        result = await self.db.execute(query)
        rows = result.all()

        items: List[Dict[str, Any]] = []
        for row in rows:
            event = row[0]
            # Positional, matching the `columns` list built above. The
            # user-scoped columns are appended only when user_id is set, so
            # their indices follow the three unconditional aggregates.
            item: Dict[str, Any] = {
                "event": event,
                "rsvp_count": row[1] or 0,
                "going_count": row[2] or 0,
                "waitlist_count": row[3] or 0,
                "occupied_seats": row[4] or 0,
                "user_rsvp_status": None,
                "user_attended": False,
            }
            if user_id:
                raw_status = row[5]
                if raw_status is not None:
                    item["user_rsvp_status"] = (
                        raw_status.value if hasattr(raw_status, "value") else raw_status
                    )
                item["user_attended"] = bool(row[6])
            items.append(item)

        await self._annotate_list_items(items, organization_id)

        return items

    async def list_missed_mandatory_events(
        self,
        organization_id: UUID,
        user_id: UUID,
        since: datetime,
        until: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        """Recent mandatory events this member was expected at and did not attend.

        "Expected at" is the load-bearing part. A plain mandatory-and-no-check-in
        query tells a member they missed drills held before they were hired,
        drills held while they were on an approved leave, and drills that were
        never mandatory for their membership type in the first place. The events
        list puts each of these in a band headed "clears itself as you respond" —
        and none of them can be cleared by responding, because the member did
        nothing wrong. So they are excluded here rather than filtered in the UI:
        a client that forgets the filter would accuse people.
        """
        until = until or datetime.now(dt_timezone.utc)

        items = await self.list_events(
            organization_id=organization_id,
            user_id=user_id,
            start_after=since,
            end_before=until,
            mandatory_only=True,
            limit=500,
        )
        candidates = [item for item in items if not item["user_attended"]]
        if not candidates:
            return []

        # Org-scoped even though user_id is the caller's own id, so the rule
        # holds by inspection rather than by tracing where the id came from
        # (pitfall #14a).
        user_result = await self.db.execute(
            select(User).where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
            )
        )
        user = user_result.scalar_one_or_none()
        if user is None:
            return []

        leaves = await self._active_leave_periods(organization_id, user_id)

        return [
            item
            for item in candidates
            if self._was_expected_at(item["event"], user, leaves)
        ]

    async def _active_leave_periods(
        self, organization_id: UUID, user_id: UUID
    ) -> List[Tuple[date, Optional[date]]]:
        """Approved, still-active leave periods for one member.

        An open-ended leave (``end_date`` NULL) is permanent, so it is returned
        with ``None`` and treated as covering everything from its start.
        """
        result = await self.db.execute(
            select(
                MemberLeaveOfAbsence.start_date, MemberLeaveOfAbsence.end_date
            ).where(
                MemberLeaveOfAbsence.organization_id == str(organization_id),
                MemberLeaveOfAbsence.user_id == str(user_id),
                MemberLeaveOfAbsence.active.is_(True),
            )
        )
        return [(row[0], row[1]) for row in result.all() if row[0] is not None]

    @staticmethod
    def _was_expected_at(
        event: Event,
        user: User,
        leaves: List[Tuple[date, Optional[date]]],
    ) -> bool:
        """Whether this member was actually required at this event.

        Errs toward *not* accusing: anything unknown (no hire date recorded, no
        membership type recorded) is treated as "cannot show they were required",
        because the cost of a false accusation on someone's attendance record is
        much higher than the cost of one missing reminder.
        """
        start = event.start_datetime
        if start is None:
            return False
        if start.tzinfo is None:
            start = start.replace(tzinfo=dt_timezone.utc)
        event_date = start.date()

        # Hired after it happened — they could not have been there.
        if user.hire_date and event_date < user.hire_date:
            return False

        for leave_start, leave_end in leaves:
            if event_date >= leave_start and (
                leave_end is None or event_date <= leave_end
            ):
                return False

        # An event mandatory only for certain membership types is not mandatory
        # for anybody else. An empty or absent list means "everyone".
        required_types = event.mandatory_membership_types
        if isinstance(required_types, list) and required_types:
            if user.membership_type not in required_types:
                return False

        return True

    async def _annotate_list_items(
        self, items: List[Dict[str, Any]], organization_id: UUID
    ) -> None:
        """Attach the derived fields the member-facing list renders.

        The check-in window is computed, not stored, and the credited hours
        come from the org's event-hour mappings — both would otherwise be a
        query (or a duplicated rule) per card.
        """
        if not items:
            return

        mappings = await AdminHoursService(self.db).get_active_mappings_by_source(
            str(organization_id)
        )

        for item in items:
            event: Event = item["event"]
            check_in_opens_at, check_in_closes_at = self._get_check_in_window(event)
            item["check_in_opens_at"] = check_in_opens_at
            item["check_in_closes_at"] = check_in_closes_at

            credited_hours, hour_category_label = self._resolve_credited_hours(
                event, mappings
            )
            item["credited_hours"] = credited_hours
            item["hour_category_label"] = hour_category_label

    @staticmethod
    def _resolve_credited_hours(
        event: Event,
        mappings: Dict[Tuple[str, str], List[Tuple[int, str]]],
    ) -> Tuple[Optional[float], Optional[str]]:
        """Hours this event's scheduled duration would credit, and to what.

        Resolution order mirrors ``AdminHoursService.get_mappings_for_event``
        exactly — event_type wins, custom_category applies only when the event
        has no type — so the number on the card is the number
        ``credit_event_attendance`` will award. It is an estimate in one
        respect the card must not overstate: the real credit is the *attended*
        duration settled at check-out, not the scheduled one.
        """
        event_type = (
            event.event_type.value
            if hasattr(event.event_type, "value")
            else event.event_type
        )
        if event_type:
            matched = mappings.get(("event_type", event_type))
        elif event.custom_category:
            matched = mappings.get(("custom_category", event.custom_category))
        else:
            matched = None

        if not matched:
            return None, None
        if not event.start_datetime or not event.end_datetime:
            return None, None

        duration_hours = (
            event.end_datetime - event.start_datetime
        ).total_seconds() / 3600
        if duration_hours <= 0:
            return None, None

        total_percentage = sum(percentage for percentage, _ in matched)
        credited = round(duration_hours * total_percentage / 100, 1)
        if credited <= 0:
            return None, None

        # A split (70% Training / 30% Professional Development) has no single
        # honest label, so the card shows the total without naming a category.
        label = matched[0][1] if len(matched) == 1 else None
        return credited, label

    async def update_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        event_data: EventUpdate,
        updated_by: Optional[UUID] = None,
    ) -> Optional[Event]:
        """Update an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
            .with_for_update()
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        # Cannot update cancelled events
        if event.is_cancelled:
            raise ValueError("Cannot update cancelled event")

        # Update fields
        update_data = event_data.model_dump(exclude_unset=True)

        # EV-17 / XC-1: same guard as create_event — a client-supplied
        # attachment file_path must name a file under this org's own upload
        # subtree before it is persisted. Checked against `update_data` so an
        # unset field stays untouched and an explicit `[]` still clears.
        if "attachments" in update_data:
            validate_attachments_for_org(update_data["attachments"], organization_id)

        # A closed event still accepts descriptive edits — fixing a typo in the
        # title of last month's drill is housekeeping. What it refuses is a
        # change to the clock or the check-in rules the credited durations were
        # derived from, which would leave the event disagreeing with the hours
        # already in the ledger.
        if attendance_is_finalized(event):
            locked = ATTENDANCE_SENSITIVE_UPDATE_FIELDS & set(update_data)
            if locked:
                raise ValueError(
                    attendance_locked_error("changing " + ", ".join(sorted(locked)))
                )

        # custom_fields is a whole-column replacement, and it carries the
        # lifecycle markers as well as whatever the organizer typed. A client
        # that PATCHes it without them would strip attendance_finalized while
        # the column keeps the event locked — and the post-event validation
        # task, which reads only the marker, would then nag about an event
        # nobody can edit. Carry the lifecycle keys across any replacement.
        if "custom_fields" in update_data:
            preserved = {
                key: value
                for key, value in (event.custom_fields or {}).items()
                if key in EVENT_LIFECYCLE_CUSTOM_FIELD_KEYS
            }
            if preserved:
                incoming = dict(update_data["custom_fields"] or {})
                incoming.update(preserved)
                update_data["custom_fields"] = incoming

        # Validate dates if being updated
        start_dt = update_data.get("start_datetime", event.start_datetime)
        end_dt = update_data.get("end_datetime", event.end_datetime)

        if end_dt <= start_dt:
            raise ValueError("End date must be after start date")

        # Check for location double-booking if location or times are changing
        check_location_id = update_data.get("location_id", event.location_id)
        if check_location_id:
            location_service = LocationService(self.db)
            # Validate a newly-set location belongs to the caller's org (the
            # existing location was validated at create time).
            if update_data.get(
                "location_id"
            ) and not await location_service.get_location(
                update_data["location_id"], str(organization_id)
            ):
                raise ValueError("Location not found")
            overlapping = await location_service.check_overlapping_events(
                location_id=check_location_id,
                organization_id=str(organization_id),
                start_datetime=start_dt,
                end_datetime=end_dt,
                exclude_event_id=event_id,
            )
            if overlapping:
                titles = ", ".join(f'"{e.title}"' for e in overlapping[:3])
                raise ValueError(
                    f"Location is already booked during this time. "
                    f"Conflicting event(s): {titles}"
                )

        for field, value in update_data.items():
            setattr(event, field, value)

        if updated_by:
            event.updated_by = str(updated_by)
        event.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def publish_event(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[Event]:
        """Publish a draft event by setting is_draft to False"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        if not event.is_draft:
            raise ValueError("Event is already published")

        event.is_draft = False
        await self.db.commit()
        await self.db.refresh(event)

        return event

    async def update_future_events(
        self,
        event_id: UUID,
        organization_id: UUID,
        event_data: EventUpdate,
        updated_by: Optional[UUID] = None,
    ) -> int:
        """Update this event and all future events in the same recurring series.

        Returns the count of updated events.
        """
        # Fetch the anchor event
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        anchor = result.scalar_one_or_none()

        if not anchor:
            raise ValueError("Event not found")

        if anchor.is_cancelled:
            raise ValueError("Cannot update cancelled event")

        # Determine the series parent id
        parent_id = anchor.recurrence_parent_id or anchor.id

        # Query all events in the series with start_datetime >= anchor's start
        result = await self.db.execute(
            select(Event)
            .where(
                Event.organization_id == str(organization_id),
                Event.is_cancelled.is_(False),
                or_(
                    Event.id == str(parent_id),
                    Event.recurrence_parent_id == str(parent_id),
                ),
                Event.start_datetime >= anchor.start_datetime,
            )
            .with_for_update()
        )
        future_events = result.scalars().all()

        update_data = event_data.model_dump(exclude_unset=True)

        # EV-17 / XC-1: this path writes the same client-supplied attachment
        # dictionaries as update_event, across every future occurrence.
        if "attachments" in update_data:
            validate_attachments_for_org(update_data["attachments"], organization_id)

        # A series-wide edit reaches finalized occurrences too. Descriptive
        # fields stay allowed here exactly as they do on the single-event path;
        # only the ones the credited durations were derived from are refused.
        sensitive = ATTENDANCE_SENSITIVE_UPDATE_FIELDS & set(update_data)
        if sensitive:
            locked = [e for e in future_events if attendance_is_finalized(e)]
            if locked:
                raise ValueError(
                    attendance_locked_error(
                        "changing "
                        + ", ".join(sorted(sensitive))
                        + f" across this series ({len(locked)} of "
                        f"{len(future_events)} occurrences have finalized "
                        "attendance)"
                    )
                )

        # XC-1 (BXC-1): update_event and create_event validate a newly-set
        # location_id in-org, but this series-wide bulk update did not — and the
        # location is eager-loaded and name-projected as location_name in the
        # response, so a foreign location_id would leak another org's location
        # name on every future event in the series. Validate once before the loop.
        if update_data.get("location_id") and not await LocationService(
            self.db
        ).get_location(update_data["location_id"], str(organization_id)):
            raise ValueError("Location not found")

        now = datetime.now(dt_timezone.utc)
        updated_count = 0

        for event in future_events:
            for field, value in update_data.items():
                setattr(event, field, value)
            if updated_by:
                event.updated_by = str(updated_by)
            event.updated_at = now
            updated_count += 1

        if updated_count > 0:
            await self.db.commit()

        return updated_count

    async def cancel_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        reason: str,
        send_notifications: bool = False,
    ) -> Optional[Event]:
        """Cancel an event and optionally notify RSVPs"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj), selectinload(Event.rsvps))
            .with_for_update()
        )
        event = result.scalar_one_or_none()

        if not event:
            return None

        if event.is_cancelled:
            raise ValueError("Event is already cancelled")

        # An event whose attendance is closed already happened and already
        # credited hours; marking it cancelled would contradict its own record.
        if attendance_is_finalized(event):
            raise ValueError(attendance_locked_error("cancelling the event"))

        # Same reasoning as delete_event: a reopened event that is cancelled
        # rather than re-finalized would leave its credited hours standing.
        await self._revoke_event_attendance_credit(event_id, organization_id)

        event.is_cancelled = True
        event.cancellation_reason = reason
        event.cancelled_at = datetime.now(dt_timezone.utc)
        event.updated_at = datetime.now(dt_timezone.utc)

        # Capture rsvps before commit expires the relationship
        rsvps_to_notify = list(event.rsvps)

        await self.db.commit()
        await self.db.refresh(event)

        # Send cancellation notifications if requested
        if send_notifications and rsvps_to_notify:
            notifications_service = NotificationsService(self.db)
            for rsvp in rsvps_to_notify:
                if rsvp.status == RSVPStatus.GOING or rsvp.status == RSVPStatus.MAYBE:
                    await notifications_service.log_notification(
                        organization_id=organization_id,
                        log_data={
                            "channel": NotificationChannel.IN_APP,
                            "recipient_id": str(rsvp.user_id),
                            "subject": f"Event Cancelled: {event.title}",
                            "message": f'The event "{event.title}" has been cancelled. Reason: {reason}',
                        },
                    )

        return event

    async def cancel_series(
        self,
        parent_event_id: UUID,
        organization_id: UUID,
        reason: str,
        cancel_future_only: bool = False,
    ) -> int:
        """Cancel all events in a recurring series.

        Returns the number of events cancelled.
        """
        # Build query for all events in the series (parent + children)
        conditions = [
            Event.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
        ]

        if cancel_future_only:
            conditions.append(Event.start_datetime >= datetime.now(dt_timezone.utc))

        conditions.append(
            or_(
                Event.id == str(parent_event_id),
                Event.recurrence_parent_id == str(parent_event_id),
            )
        )

        result = await self.db.execute(
            select(Event).where(*conditions).with_for_update()
        )
        events = result.scalars().all()

        # Same door as delete_event_series: cancelling a closed occurrence
        # would contradict the attendance it already credited.
        locked = [e for e in events if attendance_is_finalized(e)]
        if locked:
            raise ValueError(
                attendance_locked_error(
                    f"cancelling this series ({len(locked)} of {len(events)} "
                    "occurrences have finalized attendance)"
                )
            )

        now = datetime.now(dt_timezone.utc)
        cancelled_count = 0
        for event in events:
            event.is_cancelled = True
            event.cancellation_reason = reason
            event.cancelled_at = now
            event.updated_at = now
            cancelled_count += 1

        if cancelled_count > 0:
            await self.db.commit()

        return cancelled_count

    async def duplicate_event(
        self, event_id: UUID, organization_id: UUID, created_by: UUID
    ) -> Optional[Event]:
        """
        Duplicate an event, copying all configuration but not RSVPs or attendance data.

        Resets RSVP/attendance/cancellation state.
        """
        # Get the source event
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        source_event = result.scalar_one_or_none()

        if not source_event:
            return None

        # custom_fields mixes organizer configuration with lifecycle markers
        # written by scheduled jobs. A copy keeps the configuration, but must
        # be eligible for its own reminders and post-event notifications.
        custom_fields = copy.deepcopy(source_event.custom_fields)
        if custom_fields:
            for lifecycle_key in EVENT_LIFECYCLE_CUSTOM_FIELD_KEYS:
                custom_fields.pop(lifecycle_key, None)

        # Fields to copy from the source event
        new_event = Event(
            organization_id=organization_id,
            created_by=created_by,
            title=source_event.title,
            description=source_event.description,
            event_type=source_event.event_type,
            location_id=source_event.location_id,
            location=source_event.location,
            location_details=source_event.location_details,
            start_datetime=source_event.start_datetime,
            end_datetime=source_event.end_datetime,
            requires_rsvp=source_event.requires_rsvp,
            rsvp_deadline=source_event.rsvp_deadline,
            max_attendees=source_event.max_attendees,
            allowed_rsvp_statuses=copy.deepcopy(source_event.allowed_rsvp_statuses),
            is_mandatory=source_event.is_mandatory,
            mandatory_membership_types=source_event.mandatory_membership_types,
            allow_guests=source_event.allow_guests,
            # Carried, not defaulted: a duplicate of an event whose roster the
            # organizer published must not quietly revert to managers-only.
            attendee_visibility=source_event.attendee_visibility,
            send_reminders=source_event.send_reminders,
            reminder_schedule=copy.deepcopy(source_event.reminder_schedule),
            reminder_target=source_event.reminder_target,
            check_in_window_type=source_event.check_in_window_type,
            check_in_minutes_before=source_event.check_in_minutes_before,
            check_in_minutes_after=source_event.check_in_minutes_after,
            require_checkout=source_event.require_checkout,
            allow_guest_check_in=source_event.allow_guest_check_in,
            guest_check_in_creates_prospect=source_event.guest_check_in_creates_prospect,
            custom_category=source_event.custom_category,
            custom_fields=custom_fields,
            attachments=copy.deepcopy(source_event.attachments),
            template_id=source_event.template_id,
            # Explicitly NOT copying: RSVPs, cancellation state, actual times, recurrence
        )

        self.db.add(new_event)
        await self.db.commit()
        await self.db.refresh(new_event)

        # Eagerly load location relationship for the response
        if new_event.location_id:
            result = await self.db.execute(
                select(Event)
                .where(Event.id == new_event.id)
                .options(selectinload(Event.location_obj))
            )
            new_event = result.scalar_one()

        return new_event

    async def delete_event(self, event_id: UUID, organization_id: UUID) -> bool:
        """Delete an event"""
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = result.scalar_one_or_none()

        if not event:
            return False

        # Deleting cascades the RSVPs, which are the attendance record the
        # finalized hours were derived from. Same call the shift module makes:
        # a closed record is not deletable while it is closed.
        if attendance_is_finalized(event):
            raise ValueError(attendance_locked_error("deleting the event"))

        # Reachable on a reopened event, where entries from the earlier
        # finalize are still on the ledger waiting to be resynced by a
        # re-finalize that is now never going to happen.
        await self._revoke_event_attendance_credit(event_id, organization_id)

        await self.db.delete(event)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise ValueError(
                "Cannot delete event because it has linked records "
                "(e.g. meeting minutes). Remove or unlink them first."
            )

        return True

    async def delete_event_series(
        self,
        parent_event_id: UUID,
        organization_id: UUID,
        delete_future_only: bool = False,
    ) -> int:
        """Delete all events in a recurring series.

        Returns the number of events deleted.
        """
        conditions = [
            Event.organization_id == str(organization_id),
            or_(
                Event.id == str(parent_event_id),
                Event.recurrence_parent_id == str(parent_event_id),
            ),
        ]

        if delete_future_only:
            conditions.append(Event.start_datetime >= datetime.now(dt_timezone.utc))

        result = await self.db.execute(
            select(Event).where(*conditions).with_for_update()
        )
        events = result.scalars().all()

        if not events:
            return 0

        # The single-event guards are not enough on their own: the series
        # endpoints reach the same rows in bulk, so an events.manage caller
        # could delete finalized attendance through the series door without
        # ever holding events.reopen_attendance. Refuse the whole batch rather
        # than silently deleting the open siblings and keeping the closed ones
        # — a partial series delete is not what the caller asked for.
        locked = [e for e in events if attendance_is_finalized(e)]
        if locked:
            raise ValueError(
                attendance_locked_error(
                    f"deleting this series ({len(locked)} of {len(events)} "
                    "occurrences have finalized attendance)"
                )
            )

        for event in events:
            await self.db.delete(event)

        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise ValueError(
                "Cannot delete series because some events have linked records "
                "(e.g. meeting minutes). Remove or unlink them first."
            )

        return len(events)

    # RSVP Methods

    async def _evaluate_session_phase_warning(
        self, event: Event, user_id: UUID
    ) -> Optional[str]:
        """Soft training-pipeline gate: if this event is a program-linked
        training session belonging to a phase *ahead* of the member's current
        enrollment phase, return a warning string; otherwise None.

        Only gates members actively enrolled in the session's program — a
        non-enrolled member (or a session not tied to a program/phase) is never
        gated. This warns; it never hard-blocks (the caller can override).
        """
        from app.models.training import (
            EnrollmentStatus,
            ProgramEnrollment,
            ProgramPhase,
            TrainingSession,
        )

        ts_result = await self.db.execute(
            select(TrainingSession).where(TrainingSession.event_id == str(event.id))
        )
        training_session = ts_result.scalar_one_or_none()
        if not training_session or not training_session.program_id:
            return None
        if not training_session.phase_id:
            return None

        enr_result = await self.db.execute(
            select(ProgramEnrollment).where(
                ProgramEnrollment.user_id == str(user_id),
                ProgramEnrollment.program_id == str(training_session.program_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )
        enrollment = enr_result.scalar_one_or_none()
        if not enrollment:
            return None

        session_phase = (
            await self.db.execute(
                select(ProgramPhase).where(
                    ProgramPhase.id == str(training_session.phase_id)
                )
            )
        ).scalar_one_or_none()
        if not session_phase:
            return None

        current_phase = None
        if enrollment.current_phase_id:
            current_phase = (
                await self.db.execute(
                    select(ProgramPhase).where(
                        ProgramPhase.id == str(enrollment.current_phase_id)
                    )
                )
            ).scalar_one_or_none()

        current_number = current_phase.phase_number if current_phase else 0
        if session_phase.phase_number <= current_number:
            return None

        current_label = (
            f"Phase {current_phase.phase_number} ({current_phase.name})"
            if current_phase
            else "an earlier phase"
        )
        return (
            f"This session is part of Phase {session_phase.phase_number} "
            f"({session_phase.name}), but you are currently in {current_label}."
        )

    async def create_or_update_rsvp(
        self,
        event_id: UUID,
        user_id: UUID,
        rsvp_data: RSVPCreate,
        organization_id: UUID,
        override: bool = False,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """Create or update an RSVP"""
        # Lock the event row to serialize concurrent RSVP capacity checks
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Cannot RSVP to cancelled event"

        if attendance_is_finalized(event):
            return None, attendance_locked_error("responding to this event")

        # EV-6: a draft (unpublished) event isn't RSVP-able. get_event filters
        # drafts for normal reads, but this path fetches the event directly, so
        # a member who knows a draft's id could otherwise RSVP before publication.
        if event.is_draft:
            return None, "Cannot RSVP to an unpublished event"

        # No requires_rsvp gate here, deliberately. That flag means "a response
        # is expected of every member" — it drives the Required badge, the
        # deadline, and the non-respondent reminder audience. It does not mean
        # "responses are permitted": a member who wants to tell the department
        # they are coming to an optional drill may always do so, and blocking
        # that left most events with no member-facing action at all.

        # EV-6: an event that has already ended is not RSVP-able. The rsvp_deadline
        # check below only fires when a deadline is set; without one, a past event
        # would otherwise still accept RSVPs.
        event_end = event.end_datetime
        if event_end and event_end.tzinfo is None:
            event_end = event_end.replace(tzinfo=dt_timezone.utc)
        if event_end and datetime.now(dt_timezone.utc) > event_end:
            return None, "Cannot RSVP to an event that has already ended"

        # Check RSVP deadline — ensure deadline is timezone-aware before comparing
        rsvp_deadline = event.rsvp_deadline
        if rsvp_deadline and rsvp_deadline.tzinfo is None:
            rsvp_deadline = rsvp_deadline.replace(tzinfo=dt_timezone.utc)
        if rsvp_deadline and datetime.now(dt_timezone.utc) > rsvp_deadline:
            return None, "RSVP deadline has passed"

        # Validate RSVP status against allowed statuses
        allowed_statuses = event.allowed_rsvp_statuses or DEFAULT_ALLOWED_RSVP_STATUSES
        if rsvp_data.status not in allowed_statuses:
            return (
                None,
                f"RSVP status '{rsvp_data.status}' is not allowed. "
                f"Allowed statuses: {', '.join(allowed_statuses)}",
            )

        # allow_guests has existed on the model since the beginning and was read
        # nowhere: guest_count was accepted on every event regardless, and then
        # left out of the capacity count below, so an event that forbade guests
        # could be filled with them and a capped event could be oversubscribed.
        # Scoped to a going response, for two reasons. A member declining is not
        # asking to bring anybody, and existing installations can hold rows with
        # guests on an allow_guests=false event because the old code never
        # enforced the flag — the modal prefills that historical count, so an
        # unconditional guard rejected their decline outright and left them
        # holding seats they had tried to give back.
        requested_guests = rsvp_data.guest_count or 0
        if rsvp_data.status == RSVPStatus.GOING.value:
            if requested_guests and not event.allow_guests:
                return None, "This event does not allow guests"
        else:
            # A party that is not attending occupies no seats. Normalizing here
            # rather than leaving the stale count is what lets a legacy guest
            # party actually release its capacity by declining.
            requested_guests = 0
            rsvp_data = rsvp_data.model_copy(update={"guest_count": 0})

        # Refused here, with the other guards, rather than down at the capacity
        # check — and the position matters as much as the rule. Every return
        # below this point happens *after* the RSVP row has been added to or
        # mutated in the session, so a late rejection leaves dirty state the
        # next commit would persist. That is not hypothetical: rsvp_to_series
        # calls this in a loop and commits per occurrence, so one refused
        # occurrence would be written by the next one's commit while being
        # excluded from the reported count.
        #
        # A party that does not fit even an empty event has no queue position
        # to wait for, and since promote_from_waitlist refuses to skip the head
        # of the queue, admitting one would block everybody behind it.
        if event.max_attendees and rsvp_data.status == RSVPStatus.GOING.value:
            party_size = 1 + (rsvp_data.guest_count or 0)
            if party_size > event.max_attendees:
                return (
                    None,
                    f"This event holds {event.max_attendees} people, so a party "
                    f"of {party_size} cannot be accommodated.",
                )

        # Soft pipeline phase gate — warn (overridable) when RSVPing to a session
        # ahead of the member's current phase. Only when actually attending.
        if not override and rsvp_data.status == "going":
            phase_warning = await self._evaluate_session_phase_warning(event, user_id)
            if phase_warning:
                return None, PHASE_GATE_PREFIX + phase_warning

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        # Seats this member held before the write, for the promotion decision
        # below. Reducing a guest count while staying "going" frees capacity
        # just as surely as declining does.
        previous_seats = (
            1 + (existing_rsvp.guest_count or 0)
            if existing_rsvp and existing_rsvp.status == RSVPStatus.GOING
            else 0
        )

        old_status = None
        if existing_rsvp:
            # Capture old status before updating
            old_status = existing_rsvp.status
            if isinstance(old_status, RSVPStatus):
                old_status = old_status.value
            # Update existing RSVP
            for field, value in rsvp_data.model_dump().items():
                setattr(existing_rsvp, field, value)
            existing_rsvp.updated_at = datetime.now(dt_timezone.utc)
            rsvp = existing_rsvp
        else:
            # Create new RSVP
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                **rsvp_data.model_dump(),
            )
            self.db.add(rsvp)

        # Check capacity if user is going. The event row lock serializes the
        # decision, but it does NOT make a plain count current: under InnoDB's
        # default REPEATABLE READ a non-locking SELECT answers from the
        # snapshot taken at this transaction's first read, so it can still
        # report the tally from before the RSVP that beat us committed. The
        # count below is a locking read for that reason.
        # (previous_seats above already records what this member held, which is
        # what the promotion decision after the commit compares against.)
        if rsvp_data.status == RSVPStatus.GOING.value and event.max_attendees:
            # Seats, not rows: a member bringing two guests occupies three
            # places. func.sum over (1 + guest_count) rather than func.count for
            # exactly that reason — counting rows is what let a capped event be
            # oversubscribed by however many guests attendees brought.
            # coalesce is required: SUM over zero rows is NULL, and comparing
            # NULL against max_attendees would skip waitlisting entirely.
            capacity_query = (
                select(func.coalesce(func.sum(1 + EventRSVP.guest_count), 0))
                .where(EventRSVP.event_id == str(event_id))
                .where(EventRSVP.status == RSVPStatus.GOING)
            )
            if existing_rsvp:
                capacity_query = capacity_query.where(EventRSVP.id != existing_rsvp.id)
            capacity_query = capacity_query.with_for_update()

            # no_autoflush: the new RSVP was just add()ed as "going", and a
            # Query-invoked autoflush would insert it before the sum runs — the
            # row would count its own seats, waitlisting the party that exactly
            # fills the roster instead of the next one. The stakes are higher
            # than they were under a row count: a self-counted row now costs
            # 1 + its own guest_count seats rather than one.
            with self.db.no_autoflush:
                occupied_result = await self.db.execute(capacity_query)
            occupied_seats = occupied_result.scalar() or 0

            # ">" against the party size, not ">=" against the tally: the old
            # row count only had to ask "is the roster already full", but a
            # party of three does not fit a one-seat gap. (A party too big for
            # the event at all was already refused above, before this function
            # touched the session.)
            requested_seats = 1 + (rsvp_data.guest_count or 0)
            if occupied_seats + requested_seats > event.max_attendees:
                # Auto-waitlist instead of rejecting
                rsvp.status = RSVPStatus.WAITLISTED

        # Flush to ensure rsvp.id is available for history record
        await self.db.flush()

        # Record RSVP history if status changed or this is a new RSVP
        new_status = rsvp.status
        if isinstance(new_status, RSVPStatus):
            new_status = new_status.value
        if old_status != new_status:
            history_entry = RSVPHistory(
                rsvp_id=rsvp.id,
                event_id=str(event_id),
                user_id=str(user_id),
                old_status=old_status,
                new_status=new_status,
                changed_at=datetime.now(dt_timezone.utc),
            )
            self.db.add(history_entry)

        await self.db.commit()
        await self.db.refresh(rsvp)

        # Promote whenever this write *released* seats — not merely when the
        # status moved away from going. Three paths free capacity and only the
        # first used to be covered: declining, lowering a guest count while
        # staying going, and being waitlisted after asking for a larger party
        # than fits. Missing the latter two stranded waitlisted members behind
        # seats that were already empty, until some unrelated action happened
        # to trigger promotion.
        final_status = (
            rsvp.status.value if hasattr(rsvp.status, "value") else rsvp.status
        )
        current_seats = (
            1 + (rsvp.guest_count or 0) if final_status == RSVPStatus.GOING.value else 0
        )
        if event.max_attendees and current_seats < previous_seats:
            # Looped, because one release can admit several parties: a party of
            # four declining frees four seats, and promoting a single solo
            # member would leave three idle until some unrelated write happened
            # to trigger promotion again. promote_from_waitlist returns None as
            # soon as the head of the queue no longer fits, so this terminates
            # on its own; the bound is only so a bug in that condition cannot
            # spin the request.
            for _ in range(MAX_WAITLIST_PROMOTIONS_PER_RELEASE):
                if not await self.promote_from_waitlist(event_id, organization_id):
                    break

        return rsvp, None

    async def get_rsvp_history(
        self,
        event_id: UUID,
        organization_id: UUID,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Get RSVP change history for an event"""
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        # Fetch history with user names
        result = await self.db.execute(
            select(RSVPHistory)
            .where(RSVPHistory.event_id == str(event_id))
            .order_by(RSVPHistory.changed_at.desc())
            .limit(limit)
        )
        history_entries = result.scalars().all()

        # Collect user IDs for name lookup
        user_ids = set()
        for entry in history_entries:
            user_ids.add(entry.user_id)
            if entry.changed_by:
                user_ids.add(entry.changed_by)

        # Fetch user names
        user_names: Dict[str, str] = {}
        if user_ids:
            users_result = await self.db.execute(
                select(User).where(User.id.in_(list(user_ids)))
            )
            for u in users_result.scalars().all():
                name = f"{u.first_name} {u.last_name}".strip()
                user_names[u.id] = name or u.email

        # Build response
        items = []
        for entry in history_entries:
            items.append(
                {
                    "id": entry.id,
                    "rsvp_id": entry.rsvp_id,
                    "event_id": entry.event_id,
                    "user_id": entry.user_id,
                    "old_status": entry.old_status,
                    "new_status": entry.new_status,
                    "changed_at": entry.changed_at,
                    "changed_by": entry.changed_by,
                    "user_name": user_names.get(entry.user_id, "Unknown"),
                    "changer_name": (
                        user_names.get(entry.changed_by, "Unknown")
                        if entry.changed_by
                        else None
                    ),
                }
            )
        return items

    async def promote_from_waitlist(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[EventRSVP]:
        """
        Promote the earliest waitlisted RSVP for an event to 'going'.

        Uses SELECT ... FOR UPDATE to prevent two concurrent promotions
        from both succeeding when only one capacity slot is available.

        Returns the promoted RSVP or None if no waitlisted users exist.
        """
        # Lock the event row to serialize promotions against capacity
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()
        if not event or not event.max_attendees:
            return None

        # Nobody is promoted onto a closed roster. This runs unattended from
        # remove_attendee too, so it returns quietly rather than erroring.
        if attendance_is_finalized(event):
            return None

        # Lock and fetch the earliest waitlisted RSVP. This now happens *before*
        # the capacity read because capacity is measured in seats: how much room
        # is needed depends on how many guests this particular party brings.
        #
        # Ordering by responded_at is not a preference — create_or_update_rsvp's
        # waitlist position is computed on the same column, and if the two ever
        # disagree the app tells a member they are next and then promotes
        # somebody else.
        #
        # The seat filter excludes parties that can *never* fit — bigger than
        # the whole event. create_or_update_rsvp now rejects those outright,
        # but rows predating that check exist, and an organizer who lowers
        # max_attendees after somebody queued creates one at any time. Filtering
        # here rather than checking after the fetch is what actually lets the
        # queue move: the head of the line becomes the earliest *promotable*
        # party, instead of an impossible one that blocks everyone behind it.
        result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.organization_id == str(organization_id))
            .where(EventRSVP.status == RSVPStatus.WAITLISTED)
            .where(1 + EventRSVP.guest_count <= event.max_attendees)
            .order_by(EventRSVP.responded_at.asc())
            .limit(1)
            .with_for_update()
        )
        waitlisted_rsvp = result.scalar_one_or_none()

        if not waitlisted_rsvp:
            return None

        # Verify there is actually capacity before promoting. Locking read:
        # the event row lock does not refresh this transaction's REPEATABLE
        # READ snapshot, so a plain read can miss an RSVP committed since.
        # Seats, not rows — must match create_or_update_rsvp's arithmetic, or a
        # party of three gets promoted into a one-seat gap the RSVP path
        # correctly refused.
        occupied_result = await self.db.execute(
            select(func.coalesce(func.sum(1 + EventRSVP.guest_count), 0))
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.status == RSVPStatus.GOING)
            .with_for_update()
        )
        occupied_seats = occupied_result.scalar() or 0

        # Whoever is first in line stays first in line. Skipping past a party
        # that does not fit *yet* to promote a smaller one behind them would
        # silently reorder the queue and contradict the position the member was
        # shown. (A party that can never fit was already excluded by the query
        # above — that is a different case, and the only one worth passing
        # over.)
        needed_seats = 1 + (waitlisted_rsvp.guest_count or 0)
        if occupied_seats + needed_seats > event.max_attendees:
            return None

        waitlisted_rsvp.status = RSVPStatus.GOING
        waitlisted_rsvp.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(waitlisted_rsvp)

        # Tell the promoted member they're off the waitlist. Without this the
        # status flips silently and they have no way to know a spot opened up,
        # so they may miss an event they're now confirmed for. Non-fatal: a
        # failed notification must not undo the promotion.
        try:
            notifications_service = NotificationsService(self.db)
            await notifications_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "channel": NotificationChannel.IN_APP,
                    "category": "event_waitlist_promotion",
                    "recipient_id": str(waitlisted_rsvp.user_id),
                    "subject": f"You're off the waitlist: {event.title}",
                    "message": (
                        f'A spot opened up for "{event.title}" and you have '
                        f"been moved off the waitlist — you are now confirmed "
                        f"as going."
                    ),
                    "action_url": f"/events/{event.id}",
                },
            )
        except Exception as e:
            logger.error(
                "Failed to notify waitlist promotion for user {} event {}: {}",
                waitlisted_rsvp.user_id,
                event.id,
                e,
            )

        return waitlisted_rsvp

    async def rsvp_to_series(
        self,
        parent_event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        rsvp_data: RSVPCreate,
    ) -> int:
        """
        RSVP to all future, non-cancelled events in a recurring series.

        Each occurrence goes through :meth:`create_or_update_rsvp` rather than
        being written here directly. This used to hand-roll the insert, which
        meant the series path had no capacity tally, no event-row lock, and no
        allow_guests, deadline or draft guard — a member applying to a series
        was saved as "going" on a full occurrence, and a guest party overbooked
        it by several seats. Delegating restores all of those at once, along
        with RSVP history and waitlist promotion, and leaves exactly one write
        path to keep correct.

        The cost is one locked transaction per occurrence instead of a single
        bulk commit. That is the deliberate trade: duplicating the capacity and
        locking logic in a second place is how these two drifted far enough
        apart for the gap to go unnoticed.

        Returns the count of occurrences the response was actually applied to.
        """
        now = datetime.now(dt_timezone.utc)

        # Find all future events in the series (parent + children)
        result = await self.db.execute(
            select(Event)
            .where(Event.organization_id == str(organization_id))
            .where(Event.is_cancelled.is_(False))
            .where(Event.start_datetime > now)
            .where(
                or_(
                    Event.id == str(parent_event_id),
                    Event.recurrence_parent_id == str(parent_event_id),
                )
            )
        )
        series_events = result.scalars().all()
        event_ids = [event.id for event in series_events]

        rsvp_count = 0
        for event_id in event_ids:
            # An occurrence that refuses the response — finalized, full past
            # what this party needs, guests not allowed, deadline gone — is
            # skipped rather than failing the batch. The member is answering
            # for the rest of the series, not asking to force one date.
            #
            # override=True: the member confirmed the training phase-gate
            # warning once for the series, and there is no way to prompt them
            # again per occurrence.
            rsvp, error = await self.create_or_update_rsvp(
                # Passed through as stored. create_or_update_rsvp stringifies
                # whatever it is given, so coercing to UUID here would only add
                # a way for a non-canonical id to raise.
                event_id=event_id,
                user_id=user_id,
                rsvp_data=rsvp_data,
                organization_id=organization_id,
                override=True,
            )
            if error or rsvp is None:
                # Roll back before moving on. create_or_update_rsvp commits its
                # own successful writes, so this discards only what a refusal
                # left uncommitted — and without it, any error path that ever
                # returns after the row is added would be persisted by the
                # *next* occurrence's commit rather than dropped.
                await self.db.rollback()
                logger.info(
                    "Series RSVP skipped event {}: {}",
                    event_id,
                    error or "no RSVP returned",
                )
                continue

            rsvp_count += 1

        return rsvp_count

    async def list_event_rsvps(
        self,
        event_id: UUID,
        organization_id: UUID,
        status_filter: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[EventRSVP]:
        """List all RSVPs for an event"""
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return []

        query = (
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .options(selectinload(EventRSVP.user))
        )

        if status_filter:
            query = query.where(EventRSVP.status == status_filter)

        query = query.order_by(EventRSVP.responded_at.desc()).offset(skip).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def list_event_attendees_for_member(
        self,
        event_id: UUID,
        organization_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[Optional[Event], List[EventRSVP]]:
        """Return the going-only roster an ordinary member is allowed to see.

        Deliberately narrower than :meth:`list_event_rsvps`: only ``going``
        RSVPs, ordered oldest-first so the list reads as a sign-up sheet rather
        than a leaderboard. Returns the org-scoped event alongside the rows so
        the caller can resolve visibility without a second fetch — and so a
        missing event is distinguishable from an event with an empty roster.

        This method does NOT decide who may call it. Visibility is resolved by
        the endpoint, which has the organization's settings in hand.
        """
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, []

        query = (
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.status == RSVPStatus.GOING)
            .options(selectinload(EventRSVP.user))
            # The id breaks ties between responses at one instant, so an
            # offset page never repeats or skips one.
            .order_by(EventRSVP.responded_at.asc(), EventRSVP.id.asc())
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return event, list(result.scalars().all())

    async def manager_add_attendee(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        manager_id: UUID,
        status: str = "going",
        checked_in: bool = False,
        notes: Optional[str] = None,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Manager adds an attendee to an event and optionally marks them checked in.

        This allows managers to add someone who had trouble logging in, or
        to retroactively give credit for attendance.
        """
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Cannot add attendees to a cancelled event"

        if attendance_is_finalized(event):
            return None, attendance_locked_error("adding an attendee")

        # Verify target user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Check if RSVP already exists
        existing_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        existing_rsvp = existing_result.scalar_one_or_none()

        now = datetime.now(dt_timezone.utc)

        was_update = existing_rsvp is not None

        if existing_rsvp:
            # Update existing RSVP
            existing_rsvp.status = RSVPStatus(status)
            if notes is not None:
                existing_rsvp.notes = notes
            existing_rsvp.updated_at = now

            if checked_in and not existing_rsvp.checked_in:
                existing_rsvp.checked_in = True
                existing_rsvp.checked_in_at = now
                existing_rsvp.overridden_by = manager_id
                existing_rsvp.overridden_at = now

            rsvp = existing_rsvp
        else:
            # Create new RSVP
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus(status),
                guest_count=0,
                notes=notes,
                responded_at=now,
                checked_in=checked_in,
                checked_in_at=now if checked_in else None,
                overridden_by=manager_id if checked_in else None,
                overridden_at=now if checked_in else None,
            )
            self.db.add(rsvp)

        await self.db.commit()
        await self.db.refresh(rsvp)

        # Transient attribute the endpoint reads to audit-log overwrites.
        # Not a mapped column; lost when the object is detached.
        rsvp.was_update = was_update

        return rsvp, None

    async def override_rsvp_attendance(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        manager_id: UUID,
        override_data: RSVPOverride,
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Override attendance details for an RSVP (manager action).

        Allows managers to fix check-in/check-out times and credit hours
        for attendees who had issues scanning in/out.
        """
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if attendance_is_finalized(event):
            return None, attendance_locked_error("correcting attendance")

        # Get the RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            return None, "RSVP not found for this user"

        now = datetime.now(dt_timezone.utc)
        override_fields = override_data.model_dump(exclude_unset=True)

        # Validate override times if both provided
        check_in = override_fields.get(
            "override_check_in_at", rsvp.override_check_in_at
        )
        check_out = override_fields.get(
            "override_check_out_at", rsvp.override_check_out_at
        )
        if check_in and check_out and check_out <= check_in:
            return None, "Override check-out time must be after check-in time"

        for field, value in override_fields.items():
            setattr(rsvp, field, value)

        # If overriding check-in time, also mark as checked in
        if override_fields.get("override_check_in_at"):
            rsvp.checked_in = True
            if not rsvp.checked_in_at:
                rsvp.checked_in_at = override_fields["override_check_in_at"]

        # Auto-calculate duration if both override times are set and no explicit duration override
        if (
            rsvp.override_check_in_at
            and rsvp.override_check_out_at
            and "override_duration_minutes" not in override_fields
        ):
            duration = (
                rsvp.override_check_out_at - rsvp.override_check_in_at
            ).total_seconds() / 60
            rsvp.override_duration_minutes = int(duration)

        rsvp.overridden_by = manager_id
        rsvp.overridden_at = now
        rsvp.updated_at = now

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def remove_attendee(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Optional[str]:
        """
        Remove an attendee's RSVP from an event (manager action).

        Returns an error string on failure, or None on success.
        """
        # Verify event exists and belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return "Event not found"

        if attendance_is_finalized(event):
            return attendance_locked_error("removing an attendee")

        # Get the RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            return "RSVP not found for this user"

        was_going = rsvp.status == RSVPStatus.GOING

        # Take the credited hours with the attendance record. source_rsvp_id is
        # an ondelete="SET NULL" FK, so without this the entry survives the
        # delete pointing at nothing and the member keeps credit for an event
        # they are no longer recorded at.
        await AdminHoursService(self.db).delete_event_attendance_entries(
            str(rsvp.id), str(organization_id)
        )

        await self.db.delete(rsvp)
        await self.db.commit()

        # Auto-promote from waitlist if a "going" attendee was removed
        if was_going and event.max_attendees:
            await self.promote_from_waitlist(event_id, organization_id)

        return None

    async def check_in_attendee(
        self, event_id: UUID, user_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[EventRSVP], Optional[str]]:
        """
        Check in an attendee (manager action)

        If RSVP doesn't exist, creates one automatically with status 'going'.
        This allows check-in to work for events that don't require RSVP.
        Validates the check-in window to prevent check-ins outside allowed times.
        """
        # Verify event belongs to organization
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        if attendance_is_finalized(event):
            return None, attendance_locked_error("checking a member in")

        # Get organization timezone for user-facing messages
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        # Validate check-in window (manager path ignores the early notice)
        now = datetime.now(dt_timezone.utc)
        is_valid, error_msg, _notice = self._validate_check_in_window(
            event, now, tz_name
        )
        if not is_valid:
            return None, error_msg

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization"

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.now(dt_timezone.utc),
            )
            self.db.add(rsvp)

        if rsvp.checked_in:
            return None, "Already checked in"

        rsvp.checked_in = True
        rsvp.checked_in_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(rsvp)

        return rsvp, None

    async def get_event_stats(
        self, event_id: UUID, organization_id: UUID
    ) -> Optional[EventStats]:
        """Get statistics for an event"""
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None

        # Count RSVPs by status
        rsvps_result = await self.db.execute(
            select(
                EventRSVP.status,
                func.count(EventRSVP.id),
                func.sum(EventRSVP.guest_count),
                func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)),
            )
            .where(EventRSVP.event_id == str(event_id))
            .group_by(EventRSVP.status)
        )
        rsvp_counts = rsvps_result.all()

        going_count = 0
        not_going_count = 0
        maybe_count = 0
        total_guests = 0
        checked_in_count = 0

        for status, count, guests, checked_in in rsvp_counts:
            if status == RSVPStatus.GOING:
                going_count = count
                total_guests = guests or 0
                # Only count checked-in attendees who are still GOING
                checked_in_count = checked_in or 0
            elif status == RSVPStatus.NOT_GOING:
                not_going_count = count
            elif status == RSVPStatus.MAYBE:
                maybe_count = count

        total_rsvps = going_count + not_going_count + maybe_count

        # Calculate capacity percentage. Measured in seats, matching what
        # max_attendees now caps: a roster of 8 members who brought 2 guests
        # fills a 10-seat event, and reporting that as 80% would have an
        # organizer expecting room that the RSVP path will refuse.
        capacity_percentage = None
        if event.max_attendees and event.max_attendees > 0:
            occupied_seats = going_count + total_guests
            capacity_percentage = round((occupied_seats / event.max_attendees) * 100, 2)

        return EventStats(
            event_id=event.id,
            total_rsvps=total_rsvps,
            going_count=going_count,
            not_going_count=not_going_count,
            maybe_count=maybe_count,
            checked_in_count=checked_in_count,
            total_guests=total_guests,
            capacity_percentage=capacity_percentage,
        )

    async def record_actual_times(
        self,
        event_id: UUID,
        organization_id: UUID,
        actual_start_time: Optional[datetime],
        actual_end_time: Optional[datetime],
        finalized_by: Optional[UUID] = None,
    ) -> Tuple[Optional[Event], Optional[str]]:
        """
        Record actual start and end times for an event

        This allows tracking the actual duration of the event for attendance purposes.
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if attendance_is_finalized(event):
            return None, attendance_locked_error("recording actual times")

        # Validate the resulting pair, including a previously recorded value when
        # this request updates only one side of the interval.
        effective_start = (
            actual_start_time
            if actual_start_time is not None
            else event.actual_start_time
        )
        effective_end = (
            actual_end_time if actual_end_time is not None else event.actual_end_time
        )
        if (
            effective_start is not None
            and effective_end is not None
            and effective_end <= effective_start
        ):
            return None, "Actual end time must be after actual start time"

        # Update times
        if actual_start_time is not None:
            event.actual_start_time = actual_start_time
        if actual_end_time is not None:
            event.actual_end_time = actual_end_time

        event.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()
        await self.db.refresh(event)

        # Auto-finalize attendance when actual end time is recorded
        if actual_end_time is not None:
            await self.finalize_event_attendance(
                event_id, organization_id, finalized_by=finalized_by
            )

        return event, None

    async def attendance_lock_error_for(
        self,
        event_id: UUID,
        organization_id: UUID,
        action: str,
    ) -> Optional[str]:
        """Return the lock refusal for an event, or None if it is still open.

        For callers that loop over many members (bulk add): checking once up
        front fails the request with a single 409 instead of stamping the same
        sentinel onto every row of a per-user error list.
        """
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
        )
        event = result.scalar_one_or_none()
        if event is None or not attendance_is_finalized(event):
            return None
        return attendance_locked_error(action)

    async def finalize_event_attendance(
        self,
        event_id: UUID,
        organization_id: UUID,
        finalized_by: Optional[UUID] = None,
    ) -> Tuple[int, Optional[str]]:
        """
        Finalize attendance duration for all checked-in members who didn't check out.

        When require_checkout is false (the default), members check in but never
        check out, leaving attendance_duration_minutes as NULL. This method
        calculates duration using: actual_end_time (if recorded) > end_datetime,
        minus the member's check-in time.

        Also updates any linked training records that have hours_completed == 0.

        Finalizing closes the event: the attendance-affecting writes are refused
        afterwards until ``reopen_event_attendance`` runs. Because of that lock
        this can only be reached on an open event, so any admin-hours entry it
        finds for one of these RSVPs is left over from an earlier cycle and is
        resynced to the corrected numbers rather than skipped.

        Returns:
            Tuple of (number_of_rsvps_updated, error_message)
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return 0, "Event not found"

        if attendance_is_finalized(event):
            return 0, attendance_locked_error("finalizing attendance again")

        # Determine effective end time: actual_end_time takes priority
        effective_end = event.actual_end_time or event.end_datetime
        if not effective_end:
            return 0, "Event has no end time"
        # Datetimes read straight from MySQL are naive while ones set in this
        # session are UTC-aware; normalize before any subtraction below.
        if effective_end.tzinfo is None:
            effective_end = effective_end.replace(tzinfo=dt_timezone.utc)

        # Two different sets, and conflating them is what left whole
        # categories of attendee uncredited:
        #
        #   `derivable` — checked in, never checked out, no duration yet. These
        #   are the rows finalize has to *compute* a duration for.
        #
        #   `attended`  — every checked-in row. These are the rows that have to
        #   reach the hours ledger, whether their duration was derived here,
        #   measured from a real check-out, or set by hand.
        #
        # Crediting only `derivable` meant a member who tapped out — or whom
        # End Event bulk-checked-out, which stamps checked_out_at on everyone
        # before this runs — was skipped by the query and never credited at
        # all. Reported by review on PR #1791; the miss predates the lock, but
        # the lock is what made it unrecoverable without a chief.
        derivable_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_out_at.is_(None),
                EventRSVP.override_duration_minutes.is_(None),
                EventRSVP.attendance_duration_minutes.is_(None),
            )
        )
        rsvps = list(derivable_result.scalars().all())

        attended_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
            )
        )
        attended = list(attended_result.scalars().all())

        if not attended:
            await self._record_attendance_finalized(
                event, organization_id, finalized_by
            )
            return 0, None

        # Get linked training session if this is a training event
        training_session = None
        if event.event_type == EventType.TRAINING:
            session_result = await self.db.execute(
                select(TrainingSession).where(TrainingSession.event_id == event.id)
            )
            training_session = session_result.scalar_one_or_none()

        updated_count = 0
        for rsvp in rsvps:
            # Credit runs from the scheduled start, not from whenever the tap
            # landed — see _credited_check_in_time.
            check_in_time = self._credited_check_in_time(event, rsvp)
            if not check_in_time:
                continue

            duration_minutes = (effective_end - check_in_time).total_seconds() / 60
            duration_minutes = max(0, int(duration_minutes))
            rsvp.attendance_duration_minutes = duration_minutes
            updated_count += 1

            # Update linked training record if hours are still 0
            if training_session:
                record_result = await self.db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.user_id == str(rsvp.user_id),
                        TrainingRecord.course_name == training_session.course_name,
                        TrainingRecord.scheduled_date == event.start_datetime.date(),
                    )
                )
                training_record = record_result.scalar_one_or_none()
                # Write the derived hours whenever this event is the thing the
                # record came from. The old "only if null or zero" guard was
                # there to avoid trampling a number someone else set, but it
                # also meant a reopen-and-correct left the training record on
                # the first finalize's figure while the RSVP and the hours
                # ledger both moved — three records, two answers.
                if training_record is not None:
                    training_record.hours_completed = round(duration_minutes / 60.0, 2)

        # Close the event and credit the hours in the SAME transaction that
        # holds its row lock. Every attendance writer takes that lock too, so
        # one arriving mid-finalize blocks and then finds the event closed —
        # rather than committing a check-in between the roster snapshot above
        # and the close, which left an attendee checked in, uncredited, and
        # behind a lock nobody could see a reason for.
        #
        # Crediting is inside the lock rather than after it, which is a
        # correction to the first cut of this: committing the close first
        # released the lock while the credit loop was still running off a
        # captured roster, so a reopen could land mid-loop and the stale writes
        # would then overwrite a correction — or recreate credit on an event
        # that had since been cancelled. Per-RSVP failures are already caught
        # and logged below, and a hard failure now rolls the whole finalize
        # back and leaves the event open, which is the honest outcome.
        self._stamp_attendance_finalized(event, finalized_by)

        # Auto-credit event hours to admin hours categories via mappings
        admin_hours_service = AdminHoursService(self.db)
        event_type_val = event.event_type.value if event.event_type else None
        for rsvp in attended:
            # Same clamp as above: the window handed to admin hours has to
            # match the duration credited, or the two disagree on the record.
            check_in_time = self._credited_check_in_time(event, rsvp)
            duration = (
                rsvp.override_duration_minutes or rsvp.attendance_duration_minutes
            )
            if not check_in_time or not duration or duration <= 0:
                continue
            check_out_time = rsvp.checked_out_at or effective_end
            try:
                await admin_hours_service.credit_event_attendance(
                    organization_id=str(event.organization_id),
                    user_id=str(rsvp.user_id),
                    event_id=str(event.id),
                    rsvp_id=str(rsvp.id),
                    event_title=event.title or "Event",
                    check_in_at=check_in_time,
                    check_out_at=check_out_time,
                    duration_minutes=duration,
                    event_type=event_type_val,
                    custom_category=event.custom_category,
                    resync=True,
                )
            except Exception:
                logger.exception("Failed to credit admin hours for RSVP {}", rsvp.id)

        # One commit closes the event and lands every credit together, then
        # releases the row lock. _record_attendance_finalized re-stamps (a
        # no-op), commits, and archives the validation prompt.
        await self._record_attendance_finalized(event, organization_id, finalized_by)

        return updated_count, None

    async def _revoke_event_attendance_credit(
        self, event_id: UUID, organization_id: UUID
    ) -> None:
        """Drop the admin-hours entries derived from this event's attendance.

        Reopening leaves the entries in place on the assumption that
        re-finalizing will resync them. A reopened event can instead be deleted
        or cancelled, and then that re-finalize never happens: deletion nulls
        both source ids (they are ``ondelete="SET NULL"``) and cancellation
        leaves them pointing at an event that did not happen, so every attendee
        keeps hours with no attendance behind them. Called from both paths.
        """
        rsvp_result = await self.db.execute(
            select(EventRSVP.id)
            .join(Event, Event.id == EventRSVP.event_id)
            .where(
                EventRSVP.event_id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        admin_hours = AdminHoursService(self.db)
        for rsvp_id in rsvp_result.scalars().all():
            await admin_hours.delete_event_attendance_entries(
                str(rsvp_id), str(organization_id)
            )

    @staticmethod
    def _stamp_attendance_finalized(
        event: Event,
        finalized_by: Optional[UUID] = None,
    ) -> None:
        """Mark the event closed, in memory only.

        Deliberately does not commit: the caller decides the transaction
        boundary, and for finalize that boundary matters. The close has to land
        in the same transaction that holds the event's row lock, or the lock is
        released before the state it was protecting is written and a concurrent
        check-in slips into the gap.
        """
        # Deep copy before reassigning: a shallow copy of a JSON column shares
        # nested references with SQLAlchemy's committed state, which can make
        # the reassignment a silent no-op (see CLAUDE.md pitfall #12).
        custom = copy.deepcopy(event.custom_fields or {})
        if not custom.get("attendance_finalized"):
            custom["attendance_finalized"] = True
            event.custom_fields = custom
        if event.attendance_finalized_at is None:
            event.attendance_finalized_at = datetime.now(dt_timezone.utc)
        # A finalize path with no acting user (the auto-finalize inside
        # record_actual_times, when it is reached without one) leaves the actor
        # NULL rather than attributing the close to nobody in particular.
        if finalized_by is not None and event.attendance_finalized_by is None:
            event.attendance_finalized_by = str(finalized_by)

    async def _record_attendance_finalized(
        self,
        event: Event,
        organization_id: UUID,
        finalized_by: Optional[UUID] = None,
    ) -> None:
        """Durably record that attendance finalization ran for this event.

        ``attendance_finalized_at`` is the lock every attendance write checks.
        The ``custom_fields`` marker is written alongside it because the
        post-event validation reminder task keys off that marker — without it,
        finalizing before the task ever runs (end_event, record_actual_times
        auto-finalize, or the manual endpoint) still produces a stale "validate
        attendance" prompt later. Also archives any prompt already sent.
        """
        # Deep copy before reassigning: a shallow copy of a JSON column shares
        # nested references with SQLAlchemy's committed state, which can make
        # the reassignment a silent no-op (see CLAUDE.md pitfall #12).
        self._stamp_attendance_finalized(event, finalized_by)
        await self.db.commit()

        await NotificationsService(self.db).archive_related_notifications(
            organization_id,
            "event_validation",
            "event_id",
            event.id,
        )

    async def reopen_event_attendance(
        self,
        event_id: UUID,
        organization_id: UUID,
    ) -> Tuple[Optional[Event], Optional[str]]:
        """Reopen a finalized event so attendance can be corrected.

        Clears the lock and puts the derived state back the way finalize found
        it, so re-finalizing genuinely recomputes rather than rubber-stamping
        the old numbers:

        * Durations that finalize *derived* are cleared — the rows with a
          check-in, no check-out and no manual override. Finalize only fills a
          NULL duration, so leaving them set would mean a corrected end time
          changed nothing on the next finalize. A duration measured from a real
          check-out, or set by hand as an override, is not derived and stays.
        * The ``attendance_finalized`` marker goes, so the post-event validation
          task can prompt again for an event that is open once more; the
          ``validation_notification_sent`` marker goes with it, or the task
          would consider itself already done and never re-prompt.

        Admin-hours entries are deliberately left in place. Re-finalizing
        resyncs them (see ``credit_event_attendance``), which keeps each entry's
        id, approval state and audit trail across the correction — deleting and
        recreating them would silently revoke approvals a supervisor gave.

        The caller is responsible for audit-logging who reopened it and why.
        """
        result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if not attendance_is_finalized(event):
            return None, "Attendance for this event is not finalized"

        rsvp_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_out_at.is_(None),
                EventRSVP.override_duration_minutes.is_(None),
            )
        )
        for rsvp in rsvp_result.scalars().all():
            rsvp.attendance_duration_minutes = None

        event.attendance_finalized_at = None
        event.attendance_finalized_by = None

        # Deep copy before reassigning — a shallow copy of a JSON column shares
        # nested references with the committed state and the write can be a
        # silent no-op (CLAUDE.md pitfall #12).
        custom = copy.deepcopy(event.custom_fields or {})
        for marker in ("attendance_finalized", "validation_notification_sent"):
            custom.pop(marker, None)
        event.custom_fields = custom

        event.updated_at = datetime.now(dt_timezone.utc)

        await self.db.commit()

        # Re-read rather than refresh(): the endpoint serializes what this
        # returns through _build_event_response, which reads location_obj, and
        # the fetch above carries no eager loads on purpose — the row lock is
        # for the event row alone. Left lazy, that read is IO outside the
        # greenlet context and raises MissingGreenlet, which surfaced as a 500
        # on reopening any event that has a location; events with no
        # location_id short-circuit on the NULL FK and appeared to work.
        reloaded = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = reloaded.scalar_one_or_none()
        if not event:
            # Deleted between the commit and this read. The reopen stands;
            # there is simply nothing left to serialize.
            return None, "Event not found"

        return event, None

    async def end_event(
        self,
        event_id: UUID,
        organization_id: UUID,
        ended_by: Optional[UUID] = None,
    ) -> Tuple[Optional[Event], int, Optional[str]]:
        """
        End an in-progress event: record actual_end_time as now,
        bulk-checkout all checked-in members, and finalize attendance.

        Returns:
            Tuple of (event, checked_out_count, error_message)
        """
        now = datetime.now(dt_timezone.utc)

        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, 0, "Event not found"

        if event.is_cancelled:
            return None, 0, "Cannot end a cancelled event"

        if attendance_is_finalized(event):
            return None, 0, attendance_locked_error("ending the event")

        if event.actual_end_time:
            return None, 0, "Event has already ended"

        # Record actual start time if not already set
        if not event.actual_start_time:
            event.actual_start_time = event.start_datetime

        event.actual_end_time = now
        event.updated_at = now

        # Bulk-checkout all checked-in members who haven't checked out
        rsvp_result = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_out_at.is_(None),
            )
        )
        rsvps = list(rsvp_result.scalars().all())

        for rsvp in rsvps:
            rsvp.checked_out_at = now
            # Stamp the duration here too. Finalize derives one only for rows
            # that have no check-out, and this loop has just given every one of
            # them a check-out — so without this the bulk-checked-out crew ends
            # the event with no duration and no hours credited, which is
            # exactly what ending an event is supposed to record.
            if rsvp.attendance_duration_minutes is None:
                check_in_time = self._credited_check_in_time(event, rsvp)
                if check_in_time:
                    minutes = (now - check_in_time).total_seconds() / 60
                    rsvp.attendance_duration_minutes = max(0, int(minutes))

        await self.db.commit()
        await self.db.refresh(event)

        # Finalize attendance durations
        updated_count, _ = await self.finalize_event_attendance(
            event_id, organization_id, finalized_by=ended_by
        )

        return event, len(rsvps), None

    async def get_qr_check_in_data(
        self, event_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get QR code check-in data for an event

        Returns check-in URL and validates that the event is within the valid
        check-in window based on the event's check_in_window_type settings
        (same logic as self_check_in).

        Returns: (data_dict, error_message)
        """
        # Get event with location and organization (for timezone)
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .options(selectinload(Event.location_obj))
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.is_cancelled:
            return None, "Event has been cancelled"

        # Refuse the QR payload outright rather than letting a member scan into
        # a self-check-in the lock will reject a tap later.
        if attendance_is_finalized(event):
            return None, attendance_locked_error("check-in")

        # Fetch organization timezone for display
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        org_timezone = org.timezone if org else None

        # `is_valid` is the strict on-time window, kept for the "Check-in Not
        # Available" time-range display. `_validate_check_in_window` is the
        # actual gate self_check_in enforces, and admits a Flexible/Window
        # tap up to an hour early with a notice -- can_check_in mirrors that,
        # so the button renders whenever a tap would actually succeed.
        now = datetime.now(dt_timezone.utc)
        check_in_start, check_in_end = self._get_check_in_window(event)
        is_valid = check_in_start <= now <= check_in_end
        can_check_in, _early_error, _early_notice = self._validate_check_in_window(
            event, now, org_timezone
        )

        location_name = None
        if event.location_obj:
            location_name = event.location_obj.name

        return {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value if event.event_type else None,
            "event_description": event.description,
            "start_datetime": event.start_datetime.replace(tzinfo=None).isoformat()
            + "Z",
            "end_datetime": event.end_datetime.replace(tzinfo=None).isoformat() + "Z",
            "actual_end_time": (
                (event.actual_end_time.replace(tzinfo=None).isoformat() + "Z")
                if event.actual_end_time
                else None
            ),
            "check_in_start": check_in_start.replace(tzinfo=None).isoformat() + "Z",
            "check_in_end": check_in_end.replace(tzinfo=None).isoformat() + "Z",
            "is_valid": is_valid,
            "can_check_in": can_check_in,
            "location": event.location,
            "location_id": str(event.location_id) if event.location_id else None,
            "location_name": location_name,
            "require_checkout": event.require_checkout or False,
            "timezone": org_timezone,
        }, None

    # A self check-in this far ahead of the scheduled start is worth putting in
    # front of the event's manager. Below it, an early tap is somebody walking
    # through the door as the event begins, and listing those would bury the
    # one that matters under a page of "2 minutes early".
    EARLY_CHECK_IN_WARNING_MINUTES = 10

    @staticmethod
    def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
        """Treat a naive datetime as UTC.

        MySQL DATETIME carries no offset, so a value read back through
        DateTime(timezone=True) arrives naive; subtracting it from an aware one
        raises TypeError.
        """
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=dt_timezone.utc)

    @classmethod
    def _minutes_before_start(cls, event: Event, moment: datetime) -> Optional[int]:
        """Whole minutes between ``moment`` and the event's scheduled start.

        None when the moment is at or after the start, so the column reads as
        "not early" rather than as zero — a stored 0 and an absent value would
        otherwise be indistinguishable in every query that filters on it.
        """
        scheduled_start = cls._as_utc(event.start_datetime)
        if scheduled_start is None:
            return None
        moment_utc = cls._as_utc(moment)
        if moment_utc is None:
            return None
        minutes = int((scheduled_start - moment_utc).total_seconds() / 60)
        return minutes if minutes > 0 else None

    @classmethod
    def _credited_check_in_time(
        cls, event: Event, rsvp: EventRSVP
    ) -> Optional[datetime]:
        """When this member's attendance starts counting.

        A training runs from the moment it is scheduled to start. Somebody who
        taps their ID card in the parking lot forty minutes early was not being
        trained for those forty minutes, and crediting them inflates the hours
        that flow on to training records, admin hours categories and every
        compliance report built on top of them. So a self-recorded check-in is
        clamped forward to the scheduled start; a late one is left alone, since
        arriving late really does mean less time.

        A manager's ``override_check_in_at`` is honoured verbatim and never
        clamped. That is the escape hatch for the case the clamp gets wrong —
        volunteers who genuinely were setting up an hour before the doors
        opened — and it is a deliberate act by somebody accountable for it,
        which a tap is not.
        """
        override = cls._as_utc(rsvp.override_check_in_at)
        if override:
            return override

        checked_in_at = cls._as_utc(rsvp.checked_in_at)
        if checked_in_at is None:
            return None

        scheduled_start = cls._as_utc(event.start_datetime)
        if scheduled_start is None:
            return checked_in_at
        return max(checked_in_at, scheduled_start)

    @staticmethod
    def _get_check_in_window(
        event: Event,
    ) -> Tuple[datetime, datetime]:
        """
        Calculate the check-in window boundaries based on event settings.

        Returns: (check_in_start, check_in_end) — both UTC-aware datetimes.
        """
        check_in_window_type = event.check_in_window_type or CheckInWindowType.FLEXIBLE

        def _ensure_utc(dt: datetime) -> datetime:
            """Attach UTC tzinfo to naive datetimes from the database."""
            return dt.replace(tzinfo=dt_timezone.utc) if dt.tzinfo is None else dt

        if check_in_window_type == CheckInWindowType.FLEXIBLE:
            minutes_before = (
                event.check_in_minutes_before
                if event.check_in_minutes_before is not None
                else 60
            )
            check_in_start = _ensure_utc(event.start_datetime) - timedelta(
                minutes=minutes_before
            )
            check_in_end = _ensure_utc(
                event.actual_end_time if event.actual_end_time else event.end_datetime
            )

        elif check_in_window_type == CheckInWindowType.STRICT:
            check_in_start = _ensure_utc(
                event.actual_start_time
                if event.actual_start_time
                else event.start_datetime
            )
            check_in_end = _ensure_utc(
                event.actual_end_time if event.actual_end_time else event.end_datetime
            )

        else:  # WINDOW type
            minutes_before = (
                event.check_in_minutes_before
                if event.check_in_minutes_before is not None
                else 15
            )
            minutes_after = (
                event.check_in_minutes_after
                if event.check_in_minutes_after is not None
                else 15
            )
            check_in_start = _ensure_utc(event.start_datetime) - timedelta(
                minutes=minutes_before
            )
            check_in_end = _ensure_utc(event.end_datetime) + timedelta(
                minutes=minutes_after
            )

        return check_in_start, check_in_end

    def _validate_check_in_window(
        self, event: Event, now: datetime, tz_name: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Validate whether check-in is allowed for the event's check-in window.

        Window-type policy:
        - STRICT is a hard gate by design — no check-in before the window opens.
        - FLEXIBLE / WINDOW allow a check-in up to one hour before the official
          window and return an informational notice telling the member when the
          window (set by the event creator) begins.
        - A check-in after the window has closed is never self-served; it
          requires an event organizer to record it (via the manager override).

        Returns: (is_allowed, error_message, notice). On a blocked attempt the
        error is set and notice is None; on an allowed-but-early attempt the
        error is None and notice carries the user-facing window message.
        """
        check_in_start, check_in_end = self._get_check_in_window(event)
        window_type = event.check_in_window_type or CheckInWindowType.FLEXIBLE

        def _local_time(dt: datetime) -> str:
            """Format a UTC datetime as 'HH:MM AM/PM TZ' in the org's timezone."""
            utc_dt = dt if dt.tzinfo else dt.replace(tzinfo=dt_timezone.utc)
            if tz_name:
                try:
                    local = utc_dt.astimezone(ZoneInfo(tz_name))
                    return f"{local.strftime('%I:%M %p')} {local.strftime('%Z')}"
                except Exception:
                    # Misconfigured org timezone — fall back to UTC rather than
                    # 500-ing the check-in window message.
                    pass
            return f"{utc_dt.strftime('%I:%M %p')} UTC"

        if now < check_in_start:
            opens_at = _local_time(check_in_start)
            earliest_flexible_check_in = check_in_start - timedelta(hours=1)
            if (
                window_type == CheckInWindowType.STRICT
                or now < earliest_flexible_check_in
            ):
                # Strict events have no grace period. Flexible/window events
                # retain the kiosk's one-hour early-arrival grace, but cannot
                # be checked into arbitrarily far in advance.
                return (
                    False,
                    f"Check-in is not available yet. Opens at {opens_at}.",
                    None,
                )
            # Flexible / window events: let the member check in early, but tell
            # them when the official window the organizer configured starts.
            return (
                True,
                None,
                f"You're a bit early. The official check-in window for this "
                f"event opens at {opens_at}.",
            )

        if now > check_in_end:
            return (
                False,
                "Check-in has closed for this event. Ask an event organizer to "
                "record a late check-in.",
                None,
            )

        return True, None, None

    async def self_check_in(
        self,
        event_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        is_checkout: bool = False,
        override: bool = False,
    ) -> Tuple[Optional[EventRSVP], Optional[str], Optional[str]]:
        """
        Allow a user to check themselves in or out via QR code

        Args:
            event_id: Event ID
            user_id: User ID
            organization_id: Organization ID
            is_checkout: True if this is a check-out request

        Returns: (rsvp, error_message, notice). ``notice`` is a non-blocking,
        user-facing message (e.g. an early check-in succeeded but the official
        window opens later); it is None unless such a case applies.
        """
        # Get event
        event_result = await self.db.execute(
            select(Event)
            .where(Event.id == str(event_id))
            .where(Event.organization_id == str(organization_id))
            .with_for_update()
        )
        event = event_result.scalar_one_or_none()

        if not event:
            return None, "Event not found", None

        if event.is_cancelled:
            return None, "Event has been cancelled", None

        # Checkout is refused alongside check-in: finalize already credited a
        # duration for anyone who never tapped out, so a late checkout would be
        # writing a second answer over one the ledger has already spent.
        if attendance_is_finalized(event):
            return None, attendance_locked_error("check-in"), None

        # Verify user belongs to organization
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .where(User.organization_id == str(organization_id))
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None, "User not found in organization", None

        # Soft pipeline phase gate — warn (overridable) when checking in to a
        # session ahead of the member's current phase. Not applied on checkout.
        if not is_checkout and not override:
            phase_warning = await self._evaluate_session_phase_warning(event, user_id)
            if phase_warning:
                return None, PHASE_GATE_PREFIX + phase_warning, None

        # Get organization timezone for user-facing messages
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        now = datetime.now(dt_timezone.utc)

        # Validate check-in window (may allow an early check-in with a notice)
        is_valid, error_msg, notice = self._validate_check_in_window(
            event, now, tz_name
        )
        if not is_valid:
            return None, error_msg, None

        # Get or create RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP)
            .where(EventRSVP.event_id == str(event_id))
            .where(EventRSVP.user_id == str(user_id))
        )
        rsvp = rsvp_result.scalar_one_or_none()

        if not rsvp:
            if is_checkout:
                return None, "Cannot check out without checking in first", None

            # Auto-create RSVP when checking in
            rsvp = EventRSVP(
                organization_id=organization_id,
                event_id=event_id,
                user_id=user_id,
                status=RSVPStatus.GOING,
                guest_count=0,
                responded_at=datetime.now(dt_timezone.utc),
            )
            self.db.add(rsvp)

        # Handle check-out
        if is_checkout:
            if not rsvp.checked_in:
                return None, "You are not checked in to this event", None

            if rsvp.checked_out_at:
                return None, "You have already checked out of this event", None

            rsvp.checked_out_at = now

            # Calculate attendance duration, credited from the scheduled start
            # rather than from an early tap (see _credited_check_in_time). A
            # member who tapped in forty minutes early and out on time attended
            # the event, not the parking lot.
            check_in_time = self._credited_check_in_time(event, rsvp)
            if check_in_time:
                duration = (now - check_in_time).total_seconds() / 60
                rsvp.attendance_duration_minutes = max(0, int(duration))

            await self.db.commit()
            await self.db.refresh(rsvp)

            return rsvp, None, None

        # Handle check-in
        if rsvp.checked_in:
            # Already checked in - return special message to prompt for checkout
            return rsvp, "ALREADY_CHECKED_IN", None

        rsvp.checked_in = True
        rsvp.checked_in_at = now
        # Record how far ahead of the scheduled start this landed, so the
        # event's manager is shown who tapped in early instead of having to
        # compare timestamps by eye. Deliberately a snapshot of what was true
        # at the tap: it is an observation about when the member arrived, not a
        # value to recompute if the organizer later moves the event.
        rsvp.early_check_in_minutes = self._minutes_before_start(event, now)

        await self.db.commit()
        await self.db.refresh(rsvp)

        # Auto-create TrainingRecord if this is a training event
        await self._auto_create_training_record(event, rsvp, user_id, organization_id)

        return rsvp, None, notice

    async def _auto_create_training_record(
        self, event: Event, rsvp: EventRSVP, user_id: UUID, organization_id: UUID
    ) -> None:
        """
        Auto-create a TrainingRecord if the event is a training session
        with auto_create_records enabled.

        Errors are logged but do not propagate — the check-in has
        already committed, so a training-record failure must not
        cause the caller to return an error to the user.
        """
        if event.event_type != EventType.TRAINING:
            return

        try:
            # Check if this event has a training session
            session_result = await self.db.execute(
                select(TrainingSession).where(TrainingSession.event_id == event.id)
            )
            training_session = session_result.scalar_one_or_none()

            if not training_session:
                return

            if not training_session.auto_create_records:
                return

            # Check if training record already exists
            existing_record_result = await self.db.execute(
                select(TrainingRecord)
                .where(TrainingRecord.user_id == str(user_id))
                .where(TrainingRecord.course_name == training_session.course_name)
                .where(TrainingRecord.scheduled_date == event.start_datetime.date())
            )
            existing_record = existing_record_result.scalar_one_or_none()

            if existing_record:
                return  # Record already exists

            # Create training record
            training_record = TrainingRecord(
                organization_id=organization_id,
                user_id=user_id,
                course_id=training_session.course_id,
                category_id=training_session.category_id,
                course_name=training_session.course_name,
                course_code=training_session.course_code,
                training_type=training_session.training_type,
                scheduled_date=event.start_datetime.date(),
                completion_date=None,
                status=TrainingStatus.IN_PROGRESS,
                hours_completed=0.0,
                credit_hours=training_session.credit_hours,
                instructor=training_session.instructor,
                location=event.location,
                certification_number=None,
                issuing_agency=(
                    training_session.issuing_agency
                    if training_session.issues_certification
                    else None
                ),
                created_by=user_id,
            )

            self.db.add(training_record)
            await self.db.commit()
        except Exception:
            logger.opt(exception=True).error(
                "Failed to auto-create training record for user {} "
                "at event {} (session {}). Check-in succeeded but "
                "training credit was not recorded.",
                user_id,
                event.id,
                event.title,
            )
            await self.db.rollback()

    async def get_check_in_monitoring_stats(
        self, event_id: UUID, organization_id: UUID
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Get real-time check-in monitoring statistics for an event.

        Returns:
            Tuple of (stats_dict, error_message)
        """
        # Get event
        result = await self.db.execute(select(Event).where(Event.id == str(event_id)))
        event = result.scalar_one_or_none()

        if not event:
            return None, "Event not found"

        if event.organization_id != organization_id:
            return None, "Event not found in your organization"

        # Use the same check-in window logic as the QR self-check-in page
        now = datetime.now(dt_timezone.utc)
        check_in_start, check_in_end = self._get_check_in_window(event)
        is_check_in_active = check_in_start <= now <= check_in_end

        # Get all RSVPs with user details
        rsvp_result = await self.db.execute(
            select(EventRSVP, User)
            .join(User, EventRSVP.user_id == User.id)
            .where(EventRSVP.event_id == str(event_id))
            .order_by(EventRSVP.checked_in_at.desc())
        )
        rsvps_with_users = rsvp_result.all()

        # Get total eligible members in organization
        eligible_members_result = await self.db.execute(
            select(func.count(User.id))
            .where(User.organization_id == str(organization_id))
            .where(User.is_active.is_(True))
        )
        total_eligible_members = eligible_members_result.scalar() or 0

        # Calculate stats
        total_rsvps = len(rsvps_with_users)
        checked_in_rsvps = [r for r, u in rsvps_with_users if r.checked_in]
        total_checked_in = len(checked_in_rsvps)
        check_in_rate = (
            (total_checked_in / total_eligible_members * 100)
            if total_eligible_members > 0
            else 0
        )

        # Get recent check-ins (last 10), plus every materially early one.
        #
        # The early list is not capped at ten and is not a slice of the recent
        # list: it is the whole point of the panel above it, and a manager who
        # can only see the ten most recent taps cannot act on the one from an
        # hour ago that is still wrong.
        recent_check_ins = []
        early_check_ins = []
        for rsvp, user in rsvps_with_users:
            if not (rsvp.checked_in and rsvp.checked_in_at):
                continue
            entry = {
                "user_id": str(user.id),
                "user_name": f"{user.first_name} {user.last_name}",
                "user_email": user.email,
                "checked_in_at": rsvp.checked_in_at,
                "rsvp_status": rsvp.status.value,
                "guest_count": rsvp.guest_count or 0,
                "early_check_in_minutes": rsvp.early_check_in_minutes,
                # An override is the manager having already ruled on this tap,
                # so it stops being something to flag at them.
                "check_in_overridden": rsvp.override_check_in_at is not None,
            }
            if len(recent_check_ins) < 10:
                recent_check_ins.append(entry)
            if (
                rsvp.early_check_in_minutes is not None
                and rsvp.early_check_in_minutes >= self.EARLY_CHECK_IN_WARNING_MINUTES
                and rsvp.override_check_in_at is None
            ):
                early_check_ins.append(entry)

        early_check_ins.sort(
            key=lambda e: e["early_check_in_minutes"] or 0, reverse=True
        )

        # Calculate average check-in time (minutes before event start)
        avg_check_in_time = None
        last_check_in_at = None
        if checked_in_rsvps:
            check_in_times = []
            for rsvp in checked_in_rsvps:
                if rsvp.checked_in_at:
                    time_diff = (
                        event.start_datetime - rsvp.checked_in_at
                    ).total_seconds() / 60
                    check_in_times.append(time_diff)
                    if not last_check_in_at or rsvp.checked_in_at > last_check_in_at:
                        last_check_in_at = rsvp.checked_in_at

            if check_in_times:
                avg_check_in_time = sum(check_in_times) / len(check_in_times)

        stats = {
            "event_id": str(event.id),
            "event_name": event.title,
            "event_type": event.event_type.value,
            "start_datetime": event.start_datetime,
            "end_datetime": event.end_datetime,
            "is_check_in_active": is_check_in_active,
            "check_in_window_start": check_in_start,
            "check_in_window_end": check_in_end,
            "total_eligible_members": total_eligible_members,
            "total_rsvps": total_rsvps,
            "total_checked_in": total_checked_in,
            "check_in_rate": round(check_in_rate, 2),
            "recent_check_ins": recent_check_ins,
            "early_check_ins": early_check_ins,
            "early_check_in_count": len(early_check_ins),
            "early_check_in_threshold_minutes": self.EARLY_CHECK_IN_WARNING_MINUTES,
            "avg_check_in_time_minutes": (
                round(avg_check_in_time, 2) if avg_check_in_time else None
            ),
            "last_check_in_at": last_check_in_at,
        }

        return stats, None

    # ============================================================
    # Event Templates
    # ============================================================

    async def _assert_template_location_in_org(
        self, location_id: Optional[str], organization_id: UUID
    ) -> None:
        # EV2-2 (XC-1): a template's default_location_id is client-supplied and
        # stamped onto the template. Validate it is in the caller's org (mirrors
        # the EV-8 create_event check), so a foreign id can't be persisted.
        if location_id:
            location_service = LocationService(self.db)
            if not await location_service.get_location(
                location_id, str(organization_id)
            ):
                raise ValueError("Location not found")

    async def create_template(
        self, template_data: Dict[str, Any], organization_id: UUID, created_by: UUID
    ) -> EventTemplate:
        """Create a new event template"""
        await self._assert_template_location_in_org(
            template_data.get("default_location_id"), organization_id
        )
        template = EventTemplate(
            organization_id=str(organization_id),
            created_by=str(created_by),
            **template_data,
        )
        self.db.add(template)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def list_templates(
        self,
        organization_id: UUID,
        include_inactive: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[EventTemplate]:
        """List all event templates for an organization"""
        query = select(EventTemplate).where(
            EventTemplate.organization_id == str(organization_id)
        )
        if not include_inactive:
            query = query.where(EventTemplate.is_active.is_(True))
        query = query.order_by(EventTemplate.name).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_template(
        self, template_id: UUID, organization_id: UUID
    ) -> Optional[EventTemplate]:
        """Get a specific event template"""
        result = await self.db.execute(
            select(EventTemplate)
            .where(EventTemplate.id == str(template_id))
            .where(EventTemplate.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_template(
        self,
        template_id: UUID,
        organization_id: UUID,
        update_data: Dict[str, Any],
        updated_by: Optional[UUID] = None,
    ) -> Optional[EventTemplate]:
        """Update an event template"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return None

        if "default_location_id" in update_data:
            await self._assert_template_location_in_org(
                update_data.get("default_location_id"), organization_id
            )

        for field, value in update_data.items():
            setattr(template, field, value)

        if updated_by:
            template.updated_by = str(updated_by)
        template.updated_at = datetime.now(dt_timezone.utc)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def delete_template(self, template_id: UUID, organization_id: UUID) -> bool:
        """Soft-delete a template by deactivating it"""
        template = await self.get_template(template_id, organization_id)
        if not template:
            return False

        template.is_active = False
        template.updated_at = datetime.now(dt_timezone.utc)
        await self.db.commit()
        return True

    # ============================================================
    # Recurring Events
    # ============================================================

    @staticmethod
    def _nth_weekday_of_month(
        year: int,
        month: int,
        weekday: int,
        ordinal: int,
        reference: datetime,
    ) -> Optional[datetime]:
        """
        Find the Nth weekday of a given month/year.

        weekday: 0=Mon … 6=Sun
        ordinal: 1-5 for 1st-5th, -1 for last
        Returns a datetime with the same time as *reference*, or None if
        the ordinal doesn't exist (e.g. 5th Monday in February).
        """
        if ordinal == -1:
            # Last occurrence: start from month's last day and walk back
            last_day = calendar.monthrange(year, month)[1]
            d = last_day
            while d >= 1:
                candidate = reference.replace(year=year, month=month, day=d)
                if candidate.weekday() == weekday:
                    return candidate
                d -= 1
            return None

        # Nth occurrence: walk from day 1
        count = 0
        for d in range(1, calendar.monthrange(year, month)[1] + 1):
            candidate = reference.replace(year=year, month=month, day=d)
            if candidate.weekday() == weekday:
                count += 1
                if count == ordinal:
                    return candidate
        return None

    def _generate_recurrence_dates(
        self,
        start_datetime: datetime,
        end_datetime: datetime,
        pattern: str,
        recurrence_end_date: datetime,
        custom_days: Optional[List[int]] = None,
        weekday: Optional[int] = None,
        week_ordinal: Optional[int] = None,
        month: Optional[int] = None,
        exceptions: Optional[List[str]] = None,
    ) -> List[Tuple[datetime, datetime]]:
        """
        Generate all occurrence dates for a recurring event.

        Returns list of (start, end) datetime tuples.
        """
        duration = end_datetime - start_datetime
        occurrences = []
        current = start_datetime
        # Anchor day-of-month for monthly/annual patterns: each step clamps to
        # the target month's length using this original day, so a series never
        # drifts down permanently after a short month (e.g. the 31st must not
        # become the 28th from March onward once February clamps it).
        anchor_day = start_datetime.day

        while current <= recurrence_end_date:
            occurrences.append((current, current + duration))

            # Stop materializing once past the cap the caller enforces (>365),
            # so a far-future end date can't build tens of thousands of tuples.
            if len(occurrences) > 365:
                break

            if pattern == RecurrencePattern.DAILY.value:
                current += timedelta(days=1)
            elif pattern == RecurrencePattern.WEEKLY.value:
                current += timedelta(weeks=1)
            elif pattern == RecurrencePattern.BIWEEKLY.value:
                current += timedelta(weeks=2)
            elif pattern == RecurrencePattern.MONTHLY.value:
                # Move to the anchor day of next month, clamped to that month's
                # length. Using anchor_day (the original day) rather than the
                # possibly-clamped current.day keeps a 31st-of-month series on
                # the 31st in long months instead of pinning it to 28 forever.
                m = current.month + 1
                y = current.year
                if m > 12:
                    m = 1
                    y += 1
                last_day = calendar.monthrange(y, m)[1]
                current = current.replace(
                    year=y, month=m, day=min(anchor_day, last_day)
                )
            elif (
                pattern == RecurrencePattern.MONTHLY_WEEKDAY.value
                and weekday is not None
                and week_ordinal is not None
            ):
                # e.g., 2nd Monday of every month
                m = current.month + 1
                y = current.year
                if m > 12:
                    m = 1
                    y += 1
                candidate = self._nth_weekday_of_month(
                    y, m, weekday, week_ordinal, current
                )
                if candidate is None:
                    # Skip months where the ordinal doesn't exist
                    # Try next month
                    m += 1
                    if m > 12:
                        m = 1
                        y += 1
                    candidate = self._nth_weekday_of_month(
                        y, m, weekday, week_ordinal, current
                    )
                if candidate is None:
                    break
                current = candidate
            elif pattern == RecurrencePattern.ANNUALLY.value:
                # Same month/day next year, anchored to the original day so a
                # Feb 29 series returns to the 29th in later leap years instead
                # of being pinned to Feb 28 after the first non-leap year.
                y = current.year + 1
                last_day = calendar.monthrange(y, current.month)[1]
                current = current.replace(year=y, day=min(anchor_day, last_day))
            elif (
                pattern == RecurrencePattern.ANNUALLY_WEEKDAY.value
                and weekday is not None
                and week_ordinal is not None
                and month is not None
            ):
                # e.g., 4th Monday of July every year
                y = current.year + 1
                candidate = self._nth_weekday_of_month(
                    y, month, weekday, week_ordinal, current
                )
                if candidate is None:
                    break
                current = candidate
            elif pattern == RecurrencePattern.CUSTOM.value and custom_days:
                # Find next matching weekday
                found = False
                for i in range(1, 8):
                    next_date = current + timedelta(days=i)
                    if next_date.weekday() in custom_days:
                        current = next_date
                        found = True
                        break
                if not found:
                    break
            else:
                break

        # Filter out exception dates (compare date parts only)
        if exceptions:
            exception_dates = set(exceptions)
            occurrences = [
                (s, e)
                for s, e in occurrences
                if s.strftime("%Y-%m-%d") not in exception_dates
            ]

        return occurrences

    async def create_recurring_event(
        self,
        event_data: Dict[str, Any],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[List[Event], Optional[str]]:
        """
        Create a series of recurring events.

        Creates a parent event and individual occurrences.
        """
        recurrence_pattern = event_data.pop("recurrence_pattern")
        recurrence_end_date = event_data.pop("recurrence_end_date", None)
        rolling_recurrence = event_data.pop("rolling_recurrence", False)
        recurrence_custom_days = event_data.pop("recurrence_custom_days", None)
        recurrence_weekday = event_data.pop("recurrence_weekday", None)
        recurrence_week_ordinal = event_data.pop("recurrence_week_ordinal", None)
        recurrence_month = event_data.pop("recurrence_month", None)
        recurrence_exceptions = event_data.pop("recurrence_exceptions", None)

        # EV-17 / XC-1: RecurringEventCreate carries `attachments` too, and it
        # is copied onto every generated occurrence — so an unvalidated foreign
        # file_path would be planted across the whole series at once.
        try:
            validate_attachments_for_org(event_data.get("attachments"), organization_id)
        except ValueError as exc:
            return [], str(exc)

        # Rolling recurrence: auto-set end date to 12 months from start
        if rolling_recurrence and not recurrence_end_date:
            start = event_data["start_datetime"]
            recurrence_end_date = start.replace(year=start.year + 1)

        # Validate the client-supplied location belongs to the caller's org
        # (same guard as create_event): without it a foreign location_id is
        # stored on every occurrence and leaks that org's location name back
        # through the eager-loaded relationship in the response.
        if event_data.get("location_id"):
            location_service = LocationService(self.db)
            if not await location_service.get_location(
                event_data["location_id"], str(organization_id)
            ):
                return [], "Location not found"

        # Same XC-1 shape as location_id above: a client-supplied template_id
        # must belong to the caller's org before it's stored on every
        # occurrence. (EventCreate, the plain single-event schema, has no
        # template_id field at all, so only this recurring path can set it.)
        if event_data.get("template_id"):
            if not await self.get_template(event_data["template_id"], organization_id):
                return [], "Template not found"

        # Generate occurrence dates
        occurrences = self._generate_recurrence_dates(
            start_datetime=event_data["start_datetime"],
            end_datetime=event_data["end_datetime"],
            pattern=recurrence_pattern,
            recurrence_end_date=recurrence_end_date,
            custom_days=recurrence_custom_days,
            weekday=recurrence_weekday,
            week_ordinal=recurrence_week_ordinal,
            month=recurrence_month,
            exceptions=recurrence_exceptions,
        )

        if len(occurrences) == 0:
            return [], "No valid occurrences generated for the given recurrence pattern"

        if len(occurrences) > 365:
            return [], "Too many occurrences (max 365). Please narrow the date range."

        # Create parent event (first occurrence)
        parent_event = Event(
            organization_id=str(organization_id),
            created_by=str(created_by),
            is_recurring=True,
            recurrence_pattern=RecurrencePattern(recurrence_pattern),
            recurrence_end_date=recurrence_end_date,
            rolling_recurrence=rolling_recurrence,
            recurrence_custom_days=recurrence_custom_days,
            recurrence_weekday=recurrence_weekday,
            recurrence_week_ordinal=recurrence_week_ordinal,
            recurrence_month=recurrence_month,
            recurrence_exceptions=recurrence_exceptions,
            start_datetime=occurrences[0][0],
            end_datetime=occurrences[0][1],
            **{
                k: v
                for k, v in event_data.items()
                if k not in ("start_datetime", "end_datetime")
            },
        )
        self.db.add(parent_event)
        await self.db.flush()  # Get the parent ID

        created_events = [parent_event]

        # Create child events for subsequent occurrences
        for start, end in occurrences[1:]:
            child_event = Event(
                organization_id=str(organization_id),
                created_by=str(created_by),
                is_recurring=True,
                recurrence_parent_id=parent_event.id,
                recurrence_pattern=RecurrencePattern(recurrence_pattern),
                start_datetime=start,
                end_datetime=end,
                **{
                    k: v
                    for k, v in event_data.items()
                    if k not in ("start_datetime", "end_datetime")
                },
            )
            self.db.add(child_event)
            created_events.append(child_event)

        await self.db.commit()

        # Re-query with eager loading so server-computed columns
        # (created_at, updated_at) and relationships (location_obj) are
        # available without lazy-loading, which would raise MissingGreenlet
        # in async mode when Pydantic serializes the response.
        event_ids = [e.id for e in created_events]
        result = await self.db.execute(
            select(Event)
            .where(Event.id.in_(event_ids))
            .options(selectinload(Event.location_obj))
            .order_by(Event.start_datetime)
        )
        created_events = list(result.scalars().all())

        return created_events, None

    async def import_events_from_csv(
        self,
        rows: List[Dict[str, str]],
        organization_id: UUID,
        created_by: UUID,
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """
        Import events from parsed CSV rows.

        Args:
            rows: List of dicts with keys matching CSV columns.
            organization_id: The org to create events for.
            created_by: The user performing the import.

        Returns:
            (imported_count, errors) where errors is a list of
            {"row": int, "error": str}.
        """
        valid_event_types = {et.value for et in EventType}
        imported_count = 0
        errors: List[Dict[str, Any]] = []

        date_formats = [
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%m/%d/%Y %H:%M:%S",
            "%m/%d/%Y %H:%M",
            "%m/%d/%Y %I:%M %p",
        ]

        def _parse_datetime(value: str) -> Optional[datetime]:
            """Try multiple datetime formats, return UTC datetime or None."""
            stripped = value.strip()
            for fmt in date_formats:
                try:
                    dt = datetime.strptime(stripped, fmt)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=dt_timezone.utc)
                    return dt
                except ValueError:
                    continue
            return None

        for idx, row in enumerate(rows, start=2):
            # Row numbering starts at 2 (1 = header row)
            title = row.get("title", "").strip()
            if not title:
                errors.append({"row": idx, "error": "Missing required field: title"})
                continue

            raw_event_type = row.get("event_type", "").strip().lower()
            if not raw_event_type:
                errors.append(
                    {"row": idx, "error": "Missing required field: event_type"}
                )
                continue
            # Allow underscore or space-separated values
            event_type_value = raw_event_type.replace(" ", "_")
            if event_type_value not in valid_event_types:
                errors.append(
                    {
                        "row": idx,
                        "error": (
                            f"Invalid event_type '{raw_event_type}'. "
                            f"Valid types: {', '.join(sorted(valid_event_types))}"
                        ),
                    }
                )
                continue

            raw_start = row.get("start_datetime", "").strip()
            if not raw_start:
                errors.append(
                    {"row": idx, "error": "Missing required field: start_datetime"}
                )
                continue
            start_dt = _parse_datetime(raw_start)
            if start_dt is None:
                errors.append(
                    {
                        "row": idx,
                        "error": f"Invalid start_datetime format: '{raw_start}'",
                    }
                )
                continue

            raw_end = row.get("end_datetime", "").strip()
            if not raw_end:
                errors.append(
                    {"row": idx, "error": "Missing required field: end_datetime"}
                )
                continue
            end_dt = _parse_datetime(raw_end)
            if end_dt is None:
                errors.append(
                    {
                        "row": idx,
                        "error": f"Invalid end_datetime format: '{raw_end}'",
                    }
                )
                continue

            if end_dt <= start_dt:
                errors.append(
                    {"row": idx, "error": "end_datetime must be after start_datetime"}
                )
                continue

            location = row.get("location", "").strip() or None
            description = row.get("description", "").strip() or None

            raw_mandatory = row.get("is_mandatory", "").strip().lower()
            is_mandatory = raw_mandatory in ("true", "yes", "1")

            try:
                # Isolate each row in a savepoint so a single row that fails at
                # flush (e.g. a DB constraint) rolls back only itself instead of
                # poisoning the session and discarding every other row — the
                # method's contract is partial success (imported_count plus
                # per-row errors), and the final commit persists the good rows.
                async with self.db.begin_nested():
                    event = Event(
                        organization_id=str(organization_id),
                        created_by=str(created_by),
                        title=title,
                        event_type=EventType(event_type_value),
                        start_datetime=start_dt,
                        end_datetime=end_dt,
                        location=location,
                        description=description,
                        is_mandatory=is_mandatory,
                        reminder_target=default_reminder_target(is_mandatory),
                    )
                    self.db.add(event)
                imported_count += 1
            except Exception as exc:
                errors.append({"row": idx, "error": str(exc)})

        if imported_count > 0:
            await self.db.commit()

        return imported_count, errors

    @staticmethod
    def parse_csv_file(file_content: bytes) -> List[Dict[str, str]]:
        """
        Parse CSV bytes into a list of dicts.

        Normalizes header names to lowercase with underscores.
        """
        text = file_content.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        rows: List[Dict[str, str]] = []
        for raw_row in reader:
            normalized: Dict[str, str] = {}
            for key, value in raw_row.items():
                if key is None:
                    continue
                norm_key = key.strip().lower().replace(" ", "_")
                normalized[norm_key] = (value or "").strip()
            rows.append(normalized)
        return rows

    async def send_event_reminders(
        self,
        event_id: UUID,
        organization_id: UUID,
        reminder_type: str = "non_respondents",
    ) -> Tuple[List[str], Optional[str]]:
        """
        Identify members who need reminders for an event.

        Args:
            event_id: The event to send reminders for.
            organization_id: The organization scope.
            reminder_type: "non_respondents" (only those without RSVPs)
                           or "all" (every active member).

        Returns:
            Tuple of (list of user IDs to remind, error message or None).
        """
        # Verify the event exists and belongs to the organization
        result = await self.db.execute(
            select(Event).where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            return [], "Event not found"

        if event.is_cancelled:
            return [], "Cannot send reminders for a cancelled event"

        # Get all active members in the organization
        members_result = await self.db.execute(
            select(User.id).where(
                User.organization_id == str(organization_id),
                User.is_active.is_(True),
            )
        )
        all_member_ids = [str(row[0]) for row in members_result.all()]

        if reminder_type == "all":
            logger.info(
                "Sending reminders to all {} members for event {}",
                len(all_member_ids),
                event_id,
            )
            return all_member_ids, None

        # For non_respondents: exclude members who already have an RSVP
        rsvp_result = await self.db.execute(
            select(EventRSVP.user_id).where(EventRSVP.event_id == str(event_id))
        )
        rsvp_user_ids = {str(row[0]) for row in rsvp_result.all()}

        non_respondents = [uid for uid in all_member_ids if uid not in rsvp_user_ids]

        logger.info(
            "Sending reminders to {} non-respondents (out of {} total) " "for event {}",
            len(non_respondents),
            len(all_member_ids),
            event_id,
        )

        return non_respondents, None

    # ------------------------------------------------------------------
    # Analytics (#44, #46, #47)
    # ------------------------------------------------------------------

    async def get_analytics_summary(
        self,
        organization_id: UUID,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Return aggregated analytics for the attendance trends dashboard.

        Includes total events, average attendance rate, event type
        distribution, monthly trend counts, average check-in lead time,
        and top events by attendance.
        """
        from sqlalchemy import extract

        # Base filter: org, not cancelled, not draft
        base_filter = [
            Event.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
        ]
        if start_date:
            base_filter.append(Event.start_datetime >= start_date)
        if end_date:
            base_filter.append(Event.start_datetime <= end_date)

        # 1) Total events
        total_q = select(func.count(Event.id)).where(*base_filter)
        total_events = (await self.db.execute(total_q)).scalar() or 0

        # 2) RSVP / check-in aggregates
        rsvp_filter = [
            EventRSVP.organization_id == str(organization_id),
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
        ]
        if start_date:
            rsvp_filter.append(Event.start_datetime >= start_date)
        if end_date:
            rsvp_filter.append(Event.start_datetime <= end_date)

        agg_q = (
            select(
                func.count(EventRSVP.id).label("total_rsvps"),
                func.sum(
                    case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)
                ).label("going_count"),
                func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)).label(
                    "checked_in_count"
                ),
            )
            .join(Event, Event.id == EventRSVP.event_id)
            .where(*rsvp_filter)
        )
        row = (await self.db.execute(agg_q)).one()
        total_rsvps = row.total_rsvps or 0
        going_count = row.going_count or 0
        checked_in_count = row.checked_in_count or 0

        avg_attendance_rate = checked_in_count / going_count if going_count > 0 else 0.0
        check_in_rate = checked_in_count / total_rsvps if total_rsvps > 0 else 0.0

        # 3) Average check-in time before event start (minutes)
        #    Uses raw SQL text for MySQL TIMESTAMPDIFF.
        from sqlalchemy import literal_column

        avg_seconds_expr = func.avg(
            func.timestampdiff(
                literal_column("SECOND"),
                EventRSVP.checked_in_at,
                Event.start_datetime,
            )
        ).label("avg_seconds_before")
        checkin_time_q = (
            select(avg_seconds_expr)
            .join(Event, Event.id == EventRSVP.event_id)
            .where(
                *rsvp_filter,
                EventRSVP.checked_in.is_(True),
                EventRSVP.checked_in_at.isnot(None),
            )
        )
        avg_seconds = (await self.db.execute(checkin_time_q)).scalar()
        avg_checkin_minutes_before: Optional[float] = None
        if avg_seconds is not None:
            avg_checkin_minutes_before = round(float(avg_seconds) / 60.0, 1)

        # 4) Event type distribution
        type_q = (
            select(
                Event.event_type,
                func.count(Event.id).label("cnt"),
            )
            .where(*base_filter)
            .group_by(Event.event_type)
            .order_by(func.count(Event.id).desc())
        )
        type_rows = (await self.db.execute(type_q)).all()
        event_type_distribution = [
            {
                "event_type": (
                    r.event_type.value
                    if hasattr(r.event_type, "value")
                    else str(r.event_type)
                ),
                "count": r.cnt,
            }
            for r in type_rows
        ]

        # 5) Monthly event counts
        month_q = (
            select(
                extract("year", Event.start_datetime).label("yr"),
                extract("month", Event.start_datetime).label("mo"),
                func.count(Event.id).label("cnt"),
            )
            .where(*base_filter)
            .group_by("yr", "mo")
            .order_by("yr", "mo")
        )
        month_rows = (await self.db.execute(month_q)).all()
        monthly_event_counts = [
            {
                "month": f"{int(r.yr)}-{int(r.mo):02d}",
                "count": r.cnt,
            }
            for r in month_rows
        ]

        # 6) Top events by attendance (top 10)
        top_q = (
            select(
                Event.id.label("event_id"),
                Event.title,
                Event.event_type,
                Event.start_datetime,
                func.sum(
                    case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)
                ).label("going_count"),
                func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)).label(
                    "checked_in_count"
                ),
            )
            .join(EventRSVP, EventRSVP.event_id == Event.id)
            .where(*base_filter)
            .group_by(Event.id, Event.title, Event.event_type, Event.start_datetime)
            .having(
                func.sum(case((EventRSVP.status == RSVPStatus.GOING, 1), else_=0)) > 0
            )
            .order_by(
                func.sum(case((EventRSVP.checked_in.is_(True), 1), else_=0)).desc()
            )
            .limit(10)
        )
        top_rows = (await self.db.execute(top_q)).all()
        top_events = []
        for r in top_rows:
            g = r.going_count or 0
            c = r.checked_in_count or 0
            top_events.append(
                {
                    "event_id": r.event_id,
                    "title": r.title,
                    "event_type": (
                        r.event_type.value
                        if hasattr(r.event_type, "value")
                        else str(r.event_type)
                    ),
                    "start_datetime": r.start_datetime,
                    "going_count": g,
                    "checked_in_count": c,
                    "attendance_rate": round(c / g, 4) if g > 0 else 0.0,
                }
            )

        return {
            "total_events": total_events,
            "total_rsvps": total_rsvps,
            "total_checked_in": checked_in_count,
            "avg_attendance_rate": round(avg_attendance_rate, 4),
            "check_in_rate": round(check_in_rate, 4),
            "avg_checkin_minutes_before": avg_checkin_minutes_before,
            "event_type_distribution": event_type_distribution,
            "monthly_event_counts": monthly_event_counts,
            "top_events": top_events,
        }

    async def send_event_notification(
        self,
        event_id: UUID,
        organization_id: UUID,
        notification_type: str,
        target: str = "all",
        message: Optional[str] = None,
    ) -> Tuple[int, str]:
        """
        Build a recipient list for an event notification and log it.

        Args:
            event_id: The event to notify about.
            organization_id: The organization scope.
            notification_type: One of announcement, reminder, follow_up,
                               missed_event, check_in_confirmation.
            target: Target audience — all, going, not_responded,
                    checked_in, not_checked_in.
            message: Optional custom message body.

        Returns:
            Tuple of (recipients_count, human-readable summary message).

        Raises:
            ValueError: If the event is not found or is cancelled.
        """
        # Verify the event exists and belongs to the organization
        result = await self.db.execute(
            select(Event).where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
        )
        event = result.scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        if event.is_cancelled:
            raise ValueError("Cannot send notifications for a cancelled event")

        # Fetch all active members
        members_result = await self.db.execute(
            select(User.id).where(
                User.organization_id == str(organization_id),
                User.is_active.is_(True),
            )
        )
        all_member_ids = {str(row[0]) for row in members_result.all()}

        # Fetch RSVPs for filtering
        rsvp_result = await self.db.execute(
            select(EventRSVP).where(EventRSVP.event_id == str(event_id))
        )
        rsvps = rsvp_result.scalars().all()

        rsvp_by_user: Dict[str, Any] = {}
        for rsvp in rsvps:
            rsvp_by_user[str(rsvp.user_id)] = rsvp

        # Build recipient list based on target
        recipient_ids: List[str] = []

        if target == "all":
            recipient_ids = list(all_member_ids)
        elif target == "going":
            recipient_ids = [
                uid
                for uid, r in rsvp_by_user.items()
                if r.status == RSVPStatus.GOING and uid in all_member_ids
            ]
        elif target == "not_responded":
            responded_ids = set(rsvp_by_user.keys())
            recipient_ids = [uid for uid in all_member_ids if uid not in responded_ids]
        elif target == "checked_in":
            recipient_ids = [
                uid
                for uid, r in rsvp_by_user.items()
                if r.checked_in and uid in all_member_ids
            ]
        elif target == "not_checked_in":
            checked_in_ids = {uid for uid, r in rsvp_by_user.items() if r.checked_in}
            # Members who RSVP'd going but did not check in
            recipient_ids = [
                uid
                for uid, r in rsvp_by_user.items()
                if r.status == RSVPStatus.GOING
                and uid not in checked_in_ids
                and uid in all_member_ids
            ]

        type_labels = {
            "announcement": "Announcement",
            "reminder": "Reminder",
            "follow_up": "Follow-up",
            "missed_event": "Missed event notice",
            "check_in_confirmation": "Check-in confirmation",
        }
        label = type_labels.get(notification_type, notification_type)

        logger.info(
            "Event notification: type={}, target={}, event={}, "
            "recipients={}, custom_message={}",
            notification_type,
            target,
            event_id,
            len(recipient_ids),
            bool(message),
        )

        # Build notification subject and body
        subject = f"{label}: {event.title}"
        default_messages = {
            "announcement": (
                f'New announcement for "{event.title}". '
                f"Check the event page for details."
            ),
            "reminder": (
                f'Reminder: "{event.title}" is coming up. '
                f"Please check the event details."
            ),
            "follow_up": (
                f'Follow-up regarding "{event.title}". '
                f"Please review the event page."
            ),
            "missed_event": (
                f'You missed "{event.title}". ' f"Please review the event details."
            ),
            "check_in_confirmation": (
                f'Your check-in for "{event.title}" has been confirmed.'
            ),
        }
        body = message or default_messages.get(
            notification_type,
            f'Notification regarding "{event.title}".',
        )
        action_url = f"/events/{event_id}"
        now = datetime.now(dt_timezone.utc)

        # Create in-app notifications for each recipient
        notif_service = NotificationsService(self.db)
        delivered_count = 0
        for uid in recipient_ids:
            entry, error = await notif_service.log_notification(
                organization_id=organization_id,
                log_data={
                    "recipient_id": uid,
                    "channel": NotificationChannel.IN_APP,
                    "subject": subject,
                    "message": body,
                    "category": NotificationCategory.EVENTS,
                    "action_url": action_url,
                    "delivered": True,
                    "sent_at": now,
                },
            )
            if entry:
                delivered_count += 1
            else:
                logger.warning(
                    "Failed to deliver notification to user {}: {}",
                    uid,
                    error,
                )

        summary = f"{label} notification sent to " f"{delivered_count} recipient(s)"

        return delivered_count, summary
