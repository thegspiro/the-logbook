"""
Apparatus Event Service

Templates for outreach that rolls an apparatus with a named crew, scheduling
them onto nights, and filling each night's seats. A night is an ordinary
``Event``; this service owns only the apparatus plan riding on it. Check-in,
finalization and the Admin Hours credit stay with the events module — the one
thing this feature changes there is which category a night credits
(``AdminHoursService.crew_hour_category_overrides``).

Nothing here creates or reads a ``Shift``.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, overload

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.admin_hours import AdminHoursCategory
from app.models.apparatus import (
    Apparatus,
    ApparatusOperator,
    DriverException,
    DriverExceptionStatus,
)
from app.models.apparatus_event import (
    ApparatusEventEvocMode,
    ApparatusEventSeatMethod,
    ApparatusEventSeatType,
    ApparatusEventTemplate,
    ApparatusEventTemplateSeat,
    ApparatusEventTemplateUnit,
    EventApparatusPlan,
    EventApparatusSeat,
    EventApparatusUnit,
)
from app.models.event import Event, EventRSVP, EventType, RSVPHistory, RSVPStatus
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User
from app.schemas.apparatus_event import (
    ApparatusConflict,
    ApparatusEventTemplateBase,
    ApparatusEventTemplateCreate,
    NightPlanUpdate,
    NightSpec,
    ScheduleNightsRequest,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import attendance_is_finalized
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.utils.member_names import format_display_name
from app.utils.org_scoping import assert_in_org
from app.utils.org_timezone import local_date, resolve_scheduling_timezone

# The scheduling overlay asks for one visible month (plus spill-over days) at
# a time; anything wider is a client asking for more than it can draw.
MAX_CALENDAR_RANGE_DAYS = 62


class ConflictsNotAcknowledged(ValueError):
    """Scheduling found apparatus conflicts the coordinator has not seen."""

    def __init__(self, conflicts: List[ApparatusConflict]):
        super().__init__(
            "Some nights conflict with another use of the apparatus. "
            "Review the conflicts and confirm to schedule anyway."
        )
        self.conflicts = conflicts


@dataclass
class SeatOutcome:
    """A seat write's result: the warnings the caller should show."""

    warnings: List[Dict[str, Any]]


@overload
def _utc(value: datetime) -> datetime:
    """A stored time read as UTC; a naive one is UTC by convention."""


@overload
def _utc(value: None) -> None:
    """No time in, no time out."""


@overload
def _utc(value: Optional[datetime]) -> Optional[datetime]:
    """A nullable column (a template's latest night) stays nullable."""


def _utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt_timezone.utc)
    return value.astimezone(dt_timezone.utc)


def _value(enum_or_str: Any) -> Any:
    return getattr(enum_or_str, "value", enum_or_str)


def _expand_seats(
    units: Iterable[Any],
) -> List[Tuple[str, List[Tuple[str, str, Optional[str]]]]]:
    """A template's units as (apparatus_id, [(name, seat_type, note), ...]),
    each ``count``-wide seat row expanded into that many seats."""
    expanded = []
    for unit in units:
        seats: List[Tuple[str, str, Optional[str]]] = []
        for seat in unit.seats:
            for _ in range(int(seat.count)):
                seats.append((seat.name, _value(seat.seat_type), seat.note))
        expanded.append((unit.apparatus_id, seats))
    return expanded


class ApparatusEventService:
    """Business logic for apparatus event templates, nights and crew seats."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reference validation
    # ------------------------------------------------------------------

    async def _assert_apparatus(
        self, apparatus_ids: Sequence[str], organization_id: str
    ) -> Dict[str, Apparatus]:
        """Every apparatus in the caller's org and not archived (XC-1)."""
        result = await self.db.execute(
            select(Apparatus)
            .options(
                selectinload(Apparatus.required_evoc_level),
                selectinload(Apparatus.status_record),
            )
            .where(
                Apparatus.id.in_([str(a) for a in apparatus_ids]),
                Apparatus.organization_id == str(organization_id),
                Apparatus.is_archived.is_(False),
            )
        )
        found = {str(a.id): a for a in result.scalars().all()}
        missing = [a for a in apparatus_ids if str(a) not in found]
        if missing:
            raise ValueError("Invalid apparatus")
        return found

    async def _assert_category(
        self, category_id: Optional[str], organization_id: str
    ) -> None:
        await assert_in_org(
            self.db,
            AdminHoursCategory,
            category_id,
            organization_id,
            allow_none=True,
            label="admin hours category",
        )

    # ------------------------------------------------------------------
    # Templates
    # ------------------------------------------------------------------

    def _template_query(self, organization_id: str):
        return (
            select(ApparatusEventTemplate)
            .options(
                selectinload(ApparatusEventTemplate.units)
                .selectinload(ApparatusEventTemplateUnit.apparatus)
                .selectinload(Apparatus.required_evoc_level),
                selectinload(ApparatusEventTemplate.units).selectinload(
                    ApparatusEventTemplateUnit.seats
                ),
            )
            .where(ApparatusEventTemplate.organization_id == str(organization_id))
        )

    async def get_template(
        self, template_id: str, organization_id: str, *, include_archived=False
    ) -> Optional[ApparatusEventTemplate]:
        query = self._template_query(organization_id).where(
            ApparatusEventTemplate.id == str(template_id)
        )
        if not include_archived:
            query = query.where(ApparatusEventTemplate.is_archived.is_(False))
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_templates(
        self, organization_id: str
    ) -> List[ApparatusEventTemplate]:
        result = await self.db.execute(
            self._template_query(organization_id)
            .where(ApparatusEventTemplate.is_archived.is_(False))
            .order_by(ApparatusEventTemplate.name)
        )
        return list(result.scalars().all())

    async def template_usage(
        self, organization_id: str, template_ids: Sequence[str]
    ) -> Dict[str, Tuple[int, Optional[datetime]]]:
        """(nights scheduled, latest night start) per template, cancelled
        nights excluded."""
        if not template_ids:
            return {}
        result = await self.db.execute(
            select(
                EventApparatusPlan.template_id,
                func.count(EventApparatusPlan.id),
                func.max(Event.start_datetime),
            )
            .join(Event, Event.id == EventApparatusPlan.event_id)
            .where(
                EventApparatusPlan.organization_id == str(organization_id),
                EventApparatusPlan.template_id.in_([str(t) for t in template_ids]),
                Event.is_cancelled.is_(False),
            )
            .group_by(EventApparatusPlan.template_id)
        )
        return {
            str(template_id): (int(count), _utc(latest))
            for template_id, count, latest in result.all()
        }

    async def template_names(
        self, organization_id: str, template_ids: Sequence[Optional[str]]
    ) -> Dict[str, str]:
        ids = [str(t) for t in template_ids if t]
        if not ids:
            return {}
        result = await self.db.execute(
            select(ApparatusEventTemplate.id, ApparatusEventTemplate.name).where(
                ApparatusEventTemplate.organization_id == str(organization_id),
                ApparatusEventTemplate.id.in_(ids),
            )
        )
        return {str(i): n for i, n in result.all()}

    async def category_names(
        self, organization_id: str, category_ids: Sequence[Optional[str]]
    ) -> Dict[str, str]:
        ids = [str(c) for c in category_ids if c]
        if not ids:
            return {}
        result = await self.db.execute(
            select(AdminHoursCategory.id, AdminHoursCategory.name).where(
                AdminHoursCategory.organization_id == str(organization_id),
                AdminHoursCategory.id.in_(ids),
            )
        )
        return {str(i): n for i, n in result.all()}

    async def _validate_template(
        self, data: ApparatusEventTemplateBase, organization_id: str
    ) -> None:
        await self._assert_apparatus(
            [unit.apparatus_id for unit in data.units], organization_id
        )
        await self._assert_category(data.admin_hours_category_id, organization_id)

    def _write_template_fields(
        self, template: ApparatusEventTemplate, data: ApparatusEventTemplateBase
    ) -> None:
        template.name = data.name
        template.description = data.description
        template.event_type = _value(data.event_type)
        template.default_start_time = data.default_start_time
        template.duration_minutes = data.duration_minutes
        template.location = data.location
        template.admin_hours_category_id = data.admin_hours_category_id
        template.evoc_mode = _value(data.evoc_mode)
        template.allow_self_signup = data.allow_self_signup
        template.show_on_schedule = data.show_on_schedule
        template.units = [
            ApparatusEventTemplateUnit(
                apparatus_id=unit.apparatus_id,
                sort_order=unit_index,
                seats=[
                    ApparatusEventTemplateSeat(
                        name=seat.name,
                        seat_type=_value(seat.seat_type),
                        count=seat.count,
                        note=seat.note,
                        sort_order=seat_index,
                    )
                    for seat_index, seat in enumerate(unit.seats)
                ],
            )
            for unit_index, unit in enumerate(data.units)
        ]

    async def create_template(
        self,
        data: ApparatusEventTemplateCreate,
        organization_id: str,
        created_by: str,
    ) -> ApparatusEventTemplate:
        await self._validate_template(data, organization_id)
        await assert_in_org(
            self.db,
            ApparatusEventTemplate,
            data.duplicated_from_id,
            organization_id,
            allow_none=True,
            label="template",
        )
        template = ApparatusEventTemplate(
            organization_id=str(organization_id),
            created_by=str(created_by),
            duplicated_from_id=data.duplicated_from_id,
        )
        self._write_template_fields(template, data)
        self.db.add(template)
        await self.db.commit()
        created = await self.get_template(template.id, organization_id)
        if created is None:
            raise ValueError("Template not found")
        return created

    async def update_template(
        self,
        template_id: str,
        data: ApparatusEventTemplateBase,
        organization_id: str,
    ) -> Optional[ApparatusEventTemplate]:
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return None
        await self._validate_template(data, organization_id)
        # Units are replaced wholesale; scheduled nights copied the old plan
        # and are unaffected, which is the documented contract.
        self._write_template_fields(template, data)
        await self.db.commit()
        return await self.get_template(template_id, organization_id)

    async def archive_template(self, template_id: str, organization_id: str) -> bool:
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return False
        template.is_archived = True
        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # Conflicts and scheduling
    # ------------------------------------------------------------------

    async def find_conflicts(
        self,
        organization_id: str,
        apparatus: Dict[str, Apparatus],
        nights: Sequence[NightSpec],
        exclude_event_ids: Sequence[str] = (),
    ) -> List[ApparatusConflict]:
        """Every reason an apparatus might not be free on a night.

        Advisory, not a lock: an engine stays in service and can break off for
        a call, so the coordinator may schedule over a conflict once they have
        seen it. Shifts are deliberately not consulted — the in-service engine
        is on a shift every day, which would flag every night ever planned.
        """
        conflicts: List[ApparatusConflict] = []
        apparatus_ids = list(apparatus)

        for apparatus_id, unit in apparatus.items():
            status = unit.status_record
            if status is not None and not status.is_available:
                for index in range(len(nights)):
                    conflicts.append(
                        ApparatusConflict(
                            night_index=index,
                            apparatus_id=apparatus_id,
                            unit_number=unit.unit_number,
                            reason=f"{unit.unit_number} is currently {status.name}.",
                        )
                    )

        for index, night in enumerate(nights):
            start, end = _utc(night.start_datetime), _utc(night.end_datetime)
            query = (
                select(EventApparatusUnit.apparatus_id, Event.id, Event.title)
                .join(Event, Event.id == EventApparatusUnit.event_id)
                .where(
                    EventApparatusUnit.organization_id == str(organization_id),
                    EventApparatusUnit.apparatus_id.in_(apparatus_ids),
                    Event.organization_id == str(organization_id),
                    Event.is_cancelled.is_(False),
                    Event.start_datetime < end,
                    Event.end_datetime > start,
                )
            )
            if exclude_event_ids:
                query = query.where(
                    Event.id.notin_([str(e) for e in exclude_event_ids])
                )
            for apparatus_id, event_id, title in (await self.db.execute(query)).all():
                unit = apparatus[str(apparatus_id)]
                conflicts.append(
                    ApparatusConflict(
                        night_index=index,
                        apparatus_id=str(apparatus_id),
                        unit_number=unit.unit_number,
                        reason=f"{unit.unit_number} is already on {title}.",
                        conflicting_event_id=str(event_id),
                        conflicting_title=title,
                    )
                )

            # Two nights in the same request that overlap each other commit
            # the same apparatus twice just as surely.
            for other_index in range(index):
                other = nights[other_index]
                if (
                    _utc(other.start_datetime) < end
                    and _utc(other.end_datetime) > start
                ):
                    for apparatus_id, unit in apparatus.items():
                        conflicts.append(
                            ApparatusConflict(
                                night_index=index,
                                apparatus_id=apparatus_id,
                                unit_number=unit.unit_number,
                                reason=(
                                    f"Overlaps night {other_index + 1} in this "
                                    f"request, which also uses {unit.unit_number}."
                                ),
                            )
                        )
        return conflicts

    async def check_template_conflicts(
        self, template_id: str, nights: Sequence[NightSpec], organization_id: str
    ) -> Optional[List[ApparatusConflict]]:
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return None
        apparatus = await self._assert_apparatus(
            [unit.apparatus_id for unit in template.units], organization_id
        )
        return await self.find_conflicts(organization_id, apparatus, nights)

    async def schedule_nights(
        self,
        template_id: str,
        request: ScheduleNightsRequest,
        organization_id: str,
        created_by: str,
    ) -> Optional[Tuple[str, List[str]]]:
        """Create one event per night, each carrying a copy of the plan.

        All nights commit together or none do, so a failure never leaves half
        a run on the calendar.
        """
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return None
        # The template was valid when saved; an apparatus may have been
        # archived since.
        apparatus = await self._assert_apparatus(
            [unit.apparatus_id for unit in template.units], organization_id
        )
        conflicts = await self.find_conflicts(
            organization_id, apparatus, request.nights
        )
        if conflicts and not request.acknowledge_conflicts:
            raise ConflictsNotAcknowledged(conflicts)

        series_id = str(uuid.uuid4())
        event_ids: List[str] = []
        for night in request.nights:
            event = Event(
                organization_id=str(organization_id),
                title=request.title,
                description=template.description,
                event_type=EventType(template.event_type),
                location=night.location or template.location,
                start_datetime=_utc(night.start_datetime),
                end_datetime=_utc(night.end_datetime),
                created_by=str(created_by),
                organizer_id=str(created_by),
            )
            self.db.add(event)
            await self.db.flush()
            await self._build_plan(event, template, series_id, organization_id)
            event_ids.append(str(event.id))

        await self.db.commit()
        logger.info(
            "Scheduled {} apparatus event night(s) from template {} in org {}",
            len(event_ids),
            template.id,
            organization_id,
        )
        return series_id, event_ids

    async def _build_plan(
        self,
        event: Event,
        template: ApparatusEventTemplate,
        series_id: str,
        organization_id: str,
    ) -> EventApparatusPlan:
        """Copy a template's apparatus and seats onto one event. Shared by
        scheduling new nights and by attaching a crew to an event that
        already exists, so the two cannot build a plan differently."""
        plan = EventApparatusPlan(
            organization_id=str(organization_id),
            event_id=event.id,
            template_id=template.id,
            series_id=series_id,
            admin_hours_category_id=template.admin_hours_category_id,
            evoc_mode=template.evoc_mode,
            allow_self_signup=template.allow_self_signup,
            show_on_schedule=template.show_on_schedule,
        )
        self.db.add(plan)
        await self.db.flush()
        for unit_index, (apparatus_id, seats) in enumerate(
            _expand_seats(template.units)
        ):
            unit = EventApparatusUnit(
                organization_id=str(organization_id),
                plan_id=plan.id,
                event_id=event.id,
                apparatus_id=apparatus_id,
                sort_order=unit_index,
            )
            self.db.add(unit)
            await self.db.flush()
            for seat_index, (name, seat_type, note) in enumerate(seats):
                self.db.add(
                    EventApparatusSeat(
                        organization_id=str(organization_id),
                        event_id=event.id,
                        unit_id=unit.id,
                        name=name,
                        seat_type=seat_type,
                        note=note,
                        sort_order=seat_index,
                    )
                )
        await self.db.flush()
        return plan

    # ------------------------------------------------------------------
    # Attaching a crew to an event that already exists
    # ------------------------------------------------------------------

    async def _event_for_crew(
        self, event_id: str, organization_id: str, *, lock: bool = False
    ) -> Optional[Event]:
        """The event a crew is being attached to, refused when a crew cannot
        sensibly ride on it."""
        event = await self._get_event(event_id, organization_id, lock=lock)
        if event is None:
            return None
        self._assert_night_open(event)
        if _value(event.event_type) == EventType.TRAINING.value:
            raise ValueError(
                "A Training event cannot carry an apparatus crew: its hours go "
                "to training records, not Admin Hours"
            )
        return event

    async def check_attach_conflicts(
        self, event_id: str, template_id: str, organization_id: str
    ) -> Optional[List[ApparatusConflict]]:
        event = await self._event_for_crew(event_id, organization_id)
        template = await self.get_template(template_id, organization_id)
        if event is None or template is None:
            return None
        apparatus = await self._assert_apparatus(
            [unit.apparatus_id for unit in template.units], organization_id
        )
        night = NightSpec(
            start_datetime=_utc(event.start_datetime),
            end_datetime=_utc(event.end_datetime),
        )
        return await self.find_conflicts(
            organization_id, apparatus, [night], exclude_event_ids=[str(event.id)]
        )

    async def attach_template(
        self,
        event_id: str,
        template_id: str,
        organization_id: str,
        *,
        acknowledge_conflicts: bool,
    ) -> Optional[EventApparatusPlan]:
        """Give an existing event — a public request's calendar entry, say —
        the apparatus and seats of a template.

        The event keeps its own title, type, time and place; only the crew
        comes from the template. Rescheduling or cancelling the event then
        carries the crew with it, because the crew rides on the event.

        Does not commit: a caller recording the attachment elsewhere (the
        request's activity log) does so in the same transaction.
        """
        event = await self._event_for_crew(event_id, organization_id, lock=True)
        template = await self.get_template(template_id, organization_id)
        if event is None or template is None:
            return None
        if await self._plan_row(event_id, organization_id) is not None:
            raise ValueError(
                "This event already has an apparatus crew. Edit it from the "
                "event's crew card."
            )
        conflicts = await self.check_attach_conflicts(
            event_id, template_id, organization_id
        )
        if conflicts and not acknowledge_conflicts:
            raise ConflictsNotAcknowledged(conflicts or [])
        plan = await self._build_plan(
            event, template, str(uuid.uuid4()), organization_id
        )
        logger.info(
            "Attached apparatus template {} to event {} in org {}",
            template.id,
            event.id,
            organization_id,
        )
        return plan

    async def remove_plan(self, event_id: str, organization_id: str) -> bool:
        """Take an apparatus crew off an event, while nobody holds a seat.

        A filled seat is a member who was told they are on the crew; removing
        it from under them is refused, as dropping a filled seat is when a
        night is edited.
        """
        event = await self._get_event(event_id, organization_id, lock=True)
        if event is None:
            return False
        plan = await self.get_plan(event_id, organization_id)
        if plan is None:
            return False
        self._assert_night_open(event)
        if any(seat.user_id for unit in plan.units for seat in unit.seats):
            raise ValueError(
                "Someone already has a seat on this crew. Clear the seats "
                "before removing the crew."
            )
        await self.db.delete(plan)
        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # A night's plan and crew board
    # ------------------------------------------------------------------

    async def _get_event(
        self, event_id: str, organization_id: str, *, lock: bool = False
    ) -> Optional[Event]:
        query = select(Event).where(
            Event.id == str(event_id), Event.organization_id == str(organization_id)
        )
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return (await self.db.execute(query)).scalar_one_or_none()

    async def get_plan(
        self, event_id: str, organization_id: str
    ) -> Optional[EventApparatusPlan]:
        result = await self.db.execute(
            select(EventApparatusPlan)
            .options(
                selectinload(EventApparatusPlan.units)
                .selectinload(EventApparatusUnit.apparatus)
                .selectinload(Apparatus.required_evoc_level),
                selectinload(EventApparatusPlan.units).selectinload(
                    EventApparatusUnit.seats
                ),
            )
            .where(
                EventApparatusPlan.event_id == str(event_id),
                EventApparatusPlan.organization_id == str(organization_id),
            )
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_night(
        self, event_id: str, organization_id: str
    ) -> Optional[Tuple[Event, EventApparatusPlan]]:
        event = await self._get_event(event_id, organization_id)
        if event is None:
            return None
        plan = await self.get_plan(event_id, organization_id)
        if plan is None:
            return None
        return event, plan

    async def series_nights(
        self, organization_id: str, series_id: str
    ) -> List[Tuple[str, datetime, int, int]]:
        """(event id, start, filled, total) for every uncancelled night in a
        series, in date order."""
        filled = func.count(EventApparatusSeat.user_id)
        total = func.count(EventApparatusSeat.id)
        result = await self.db.execute(
            select(Event.id, Event.start_datetime, filled, total)
            .join(EventApparatusPlan, EventApparatusPlan.event_id == Event.id)
            .outerjoin(EventApparatusSeat, EventApparatusSeat.event_id == Event.id)
            .where(
                EventApparatusPlan.organization_id == str(organization_id),
                EventApparatusPlan.series_id == series_id,
                Event.organization_id == str(organization_id),
                Event.is_cancelled.is_(False),
            )
            .group_by(Event.id, Event.start_datetime)
            .order_by(Event.start_datetime)
        )
        return [
            (str(i), _utc(start), int(f), int(t)) for i, start, f, t in result.all()
        ]

    async def member_names(
        self, organization_id: str, user_ids: Iterable[Optional[str]]
    ) -> Dict[str, str]:
        """Display names by id, read as columns.

        Deliberately not through ``EventApparatusSeat.user``: the plan is
        re-read with ``populate_existing``, and a seat's ``User`` is often the
        request's own ``current_user`` — re-populating that object resets the
        ``positions`` it was authorized from, and the next permission check
        lazy-loads outside the event loop.
        """
        ids = sorted({str(u) for u in user_ids if u})
        if not ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name, User.preferred_name).where(
                User.organization_id == str(organization_id), User.id.in_(ids)
            )
        )
        return {
            str(uid): format_display_name(first, last, preferred)
            for uid, first, last, preferred in result.all()
        }

    async def checked_in_users(self, event_id: str, organization_id: str) -> set:
        result = await self.db.execute(
            select(EventRSVP.user_id).where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.organization_id == str(organization_id),
                EventRSVP.checked_in.is_(True),
            )
        )
        return {str(u) for u in result.scalars().all()}

    async def _event_local_date(self, event: Event, organization_id: str) -> date:
        """The department-local day of the night, which is the day the driving
        happens — an evening event is already tomorrow in UTC."""
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        return local_date(_utc(event.start_datetime), tz)

    async def evaluate_driver(
        self,
        event: Event,
        plan: EventApparatusPlan,
        unit: EventApparatusUnit,
        user_id: str,
        organization_id: str,
    ) -> Dict[str, Any]:
        """The Driver seat rule for this night, by the plan's EVOC mode.

        ``enforce`` is exactly the shift rule (``evaluate_driver_for_apparatus``
        — the department's ``enforce_evoc`` setting and approved exceptions
        included); ``warn`` reports what that rule says without blocking;
        ``ignore`` checks nothing.
        """
        mode = plan.evoc_mode
        if mode == ApparatusEventEvocMode.IGNORE.value:
            return ShiftEligibilityService._allowed_driver_outcome()
        outcome = await ShiftEligibilityService(self.db).evaluate_driver_for_apparatus(
            user_id=str(user_id),
            apparatus_id=str(unit.apparatus_id),
            organization_id=str(organization_id),
            on_date=await self._event_local_date(event, organization_id),
        )
        if mode == ApparatusEventEvocMode.WARN.value and not outcome["allowed"]:
            outcome = dict(outcome)
            outcome["allowed"] = True
            outcome["blocked_reason"] = None
            if not outcome["warnings"]:
                outcome["warnings"] = [
                    {
                        "type": "evoc_mismatch",
                        "message": "EVOC requirement not met.",
                        "severity": "warning",
                    }
                ]
        return outcome

    # ------------------------------------------------------------------
    # Seat writes
    # ------------------------------------------------------------------

    def _assert_night_open(self, event: Event) -> None:
        if event.is_cancelled:
            raise ValueError("This night has been cancelled")
        if event.is_draft:
            raise ValueError("This night has not been published")
        if attendance_is_finalized(event):
            raise ValueError(
                "Attendance for this night has been finalized, so its crew can "
                "no longer change. A department leader can reopen attendance to "
                "make corrections."
            )

    async def _locked_seat(
        self, event_id: str, seat_id: str, organization_id: str
    ) -> Optional[EventApparatusSeat]:
        # A locking read, taken after the event row is locked: under REPEATABLE
        # READ a plain SELECT would answer from the snapshot the request's
        # first read took, before a concurrent claim committed (pitfall #27).
        result = await self.db.execute(
            select(EventApparatusSeat)
            .where(
                EventApparatusSeat.id == str(seat_id),
                EventApparatusSeat.event_id == str(event_id),
                EventApparatusSeat.organization_id == str(organization_id),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def _locked_seat_of(
        self, event_id: str, user_id: str, organization_id: str
    ) -> Optional[EventApparatusSeat]:
        result = await self.db.execute(
            select(EventApparatusSeat)
            .where(
                EventApparatusSeat.event_id == str(event_id),
                EventApparatusSeat.user_id == str(user_id),
                EventApparatusSeat.organization_id == str(organization_id),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def _unit(self, unit_id: str, organization_id: str) -> EventApparatusUnit:
        result = await self.db.execute(
            select(EventApparatusUnit).where(
                EventApparatusUnit.id == str(unit_id),
                EventApparatusUnit.organization_id == str(organization_id),
            )
        )
        unit = result.scalar_one_or_none()
        if unit is None:
            raise ValueError("Seat not found")
        return unit

    async def _plan_row(
        self, event_id: str, organization_id: str
    ) -> Optional[EventApparatusPlan]:
        result = await self.db.execute(
            select(EventApparatusPlan).where(
                EventApparatusPlan.event_id == str(event_id),
                EventApparatusPlan.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def _rsvp(
        self, event_id: str, user_id: str, organization_id: str
    ) -> Optional[EventRSVP]:
        result = await self.db.execute(
            select(EventRSVP)
            .where(
                EventRSVP.event_id == str(event_id),
                EventRSVP.user_id == str(user_id),
                EventRSVP.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _ensure_going(
        self, event_id: str, user_id: str, organization_id: str, actor_id: str
    ) -> None:
        """A seat holder is attending, so they hold a GOING RSVP: that row is
        what check-in, finalization and the Admin Hours credit all work from."""
        rsvp = await self._rsvp(event_id, user_id, organization_id)
        old_status = _value(rsvp.status) if rsvp is not None else None
        if rsvp is None:
            rsvp = EventRSVP(
                organization_id=str(organization_id),
                event_id=str(event_id),
                user_id=str(user_id),
                status=RSVPStatus.GOING,
            )
            self.db.add(rsvp)
        elif old_status == RSVPStatus.GOING.value:
            return
        else:
            rsvp.status = RSVPStatus.GOING
        await self.db.flush()
        self.db.add(
            RSVPHistory(
                rsvp_id=rsvp.id,
                event_id=str(event_id),
                user_id=str(user_id),
                old_status=old_status,
                new_status=RSVPStatus.GOING.value,
                changed_at=datetime.now(dt_timezone.utc),
                changed_by=str(actor_id),
                is_automatic=True,
            )
        )

    async def _vacate(
        self,
        seat: EventApparatusSeat,
        organization_id: str,
        actor_id: str,
    ) -> None:
        """Empty a seat. The former occupant's RSVP goes to not going — they
        were attending as crew — unless they already checked in, which the
        caller refuses before getting here."""
        former = seat.user_id
        seat.user_id = None
        seat.assignment_method = None
        seat.assigned_by = None
        seat.assigned_at = None
        if not former:
            return
        await self.db.flush()
        rsvp = await self._rsvp(seat.event_id, former, organization_id)
        if rsvp is None or _value(rsvp.status) != RSVPStatus.GOING.value:
            return
        rsvp.status = RSVPStatus.NOT_GOING
        self.db.add(
            RSVPHistory(
                rsvp_id=rsvp.id,
                event_id=str(seat.event_id),
                user_id=str(former),
                old_status=RSVPStatus.GOING.value,
                new_status=RSVPStatus.NOT_GOING.value,
                changed_at=datetime.now(dt_timezone.utc),
                changed_by=str(actor_id),
                is_automatic=True,
            )
        )

    async def _assert_not_checked_in(
        self, event_id: str, user_id: Optional[str], organization_id: str
    ) -> None:
        if not user_id:
            return
        rsvp = await self._rsvp(event_id, user_id, organization_id)
        if rsvp is not None and rsvp.checked_in:
            raise ValueError(
                "This crew member has already checked in. Correct the night's "
                "attendance instead of changing the seat."
            )

    async def _commit_seat(self) -> None:
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            # ux_event_apparatus_seats_event_user: the member took another seat
            # on this night in a request that committed first.
            raise ValueError("That member already has a seat on this night") from exc

    async def claim_seat(
        self, event_id: str, seat_id: str, organization_id: str, user: User
    ) -> Optional[SeatOutcome]:
        """A member takes an open seat for themselves."""
        event = await self._get_event(event_id, organization_id, lock=True)
        if event is None:
            return None
        plan = await self._plan_row(event_id, organization_id)
        if plan is None:
            return None
        self._assert_night_open(event)
        if not plan.allow_self_signup:
            raise ValueError("Seats on this night are assigned by the coordinator")
        if _utc(event.end_datetime) <= datetime.now(dt_timezone.utc):
            raise ValueError("This night has already happened")

        seat = await self._locked_seat(event_id, seat_id, organization_id)
        if seat is None:
            return None
        if seat.user_id:
            if str(seat.user_id) == str(user.id):
                return SeatOutcome(warnings=[])
            raise ValueError("Someone else took that seat first")
        held = await self._locked_seat_of(event_id, str(user.id), organization_id)
        if held is not None:
            raise ValueError(
                f"You already have the {held.name} seat on this night. Leave it "
                "first to take a different one."
            )

        warnings: List[Dict[str, Any]] = []
        if seat.seat_type == ApparatusEventSeatType.DRIVER.value:
            unit = await self._unit(seat.unit_id, organization_id)
            outcome = await self.evaluate_driver(
                event, plan, unit, str(user.id), organization_id
            )
            if not outcome["allowed"]:
                raise ValueError(outcome["blocked_reason"])
            warnings = list(outcome["warnings"])

        seat.user_id = str(user.id)
        seat.assignment_method = ApparatusEventSeatMethod.SELF_SIGNUP.value
        seat.assigned_by = str(user.id)
        seat.assigned_at = datetime.now(dt_timezone.utc)
        await self._ensure_going(event_id, str(user.id), organization_id, str(user.id))
        await self._commit_seat()
        return SeatOutcome(warnings=warnings)

    async def release_seat(
        self,
        event_id: str,
        seat_id: str,
        organization_id: str,
        actor: User,
        *,
        as_manager: bool,
    ) -> Optional[SeatOutcome]:
        """The occupant leaves their seat, or a coordinator clears it."""
        event = await self._get_event(event_id, organization_id, lock=True)
        if event is None:
            return None
        self._assert_night_open(event)
        seat = await self._locked_seat(event_id, seat_id, organization_id)
        if seat is None:
            return None
        if not seat.user_id:
            return SeatOutcome(warnings=[])
        if str(seat.user_id) != str(actor.id) and not as_manager:
            raise PermissionError("Only the coordinator can clear someone else's seat")
        await self._assert_not_checked_in(event_id, seat.user_id, organization_id)
        await self._vacate(seat, organization_id, str(actor.id))
        await self._commit_seat()
        return SeatOutcome(warnings=[])

    async def assign_seat(
        self,
        event_id: str,
        seat_id: str,
        target_user_id: Optional[str],
        organization_id: str,
        actor: User,
    ) -> Optional[SeatOutcome]:
        """A coordinator puts a member in a seat, moves them, or clears it.

        A member already seated elsewhere on the night is moved, not
        duplicated — that is what Swap means on the crew board.
        """
        if target_user_id is None:
            return await self.release_seat(
                event_id, seat_id, organization_id, actor, as_manager=True
            )
        event = await self._get_event(event_id, organization_id, lock=True)
        if event is None:
            return None
        plan = await self._plan_row(event_id, organization_id)
        if plan is None:
            return None
        self._assert_night_open(event)
        seat = await self._locked_seat(event_id, seat_id, organization_id)
        if seat is None:
            return None
        if seat.user_id and str(seat.user_id) == str(target_user_id):
            return SeatOutcome(warnings=[])

        target = (
            await self.db.execute(
                select(User).where(
                    User.id == str(target_user_id),
                    User.organization_id == str(organization_id),
                    User.deleted_at.is_(None),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                )
            )
        ).scalar_one_or_none()
        if target is None:
            raise ValueError("Invalid member")

        warnings: List[Dict[str, Any]] = []
        if seat.seat_type == ApparatusEventSeatType.DRIVER.value:
            unit = await self._unit(seat.unit_id, organization_id)
            outcome = await self.evaluate_driver(
                event, plan, unit, str(target.id), organization_id
            )
            if not outcome["allowed"]:
                raise ValueError(outcome["blocked_reason"])
            warnings = list(outcome["warnings"])

        # Whoever is in the seat now gives it up, unless they are already on
        # the truck.
        await self._assert_not_checked_in(event_id, seat.user_id, organization_id)
        if seat.user_id:
            await self._vacate(seat, organization_id, str(actor.id))

        previous = await self._locked_seat_of(event_id, str(target.id), organization_id)
        if previous is not None and previous.id != seat.id:
            previous.user_id = None
            previous.assignment_method = None
            previous.assigned_by = None
            previous.assigned_at = None
            await self.db.flush()

        seat.user_id = str(target.id)
        seat.assignment_method = ApparatusEventSeatMethod.ASSIGNED.value
        seat.assigned_by = str(actor.id)
        seat.assigned_at = datetime.now(dt_timezone.utc)
        await self._ensure_going(
            event_id, str(target.id), organization_id, str(actor.id)
        )
        await self._commit_seat()
        return SeatOutcome(warnings=warnings)

    # ------------------------------------------------------------------
    # The template editor's pick-lists
    # ------------------------------------------------------------------

    async def editor_options(self, organization_id: str) -> Dict[str, Any]:
        """Apparatus and Admin Hours categories a coordinator can pick.

        Served here rather than from ``/apparatus`` and ``/admin-hours``:
        those need ``apparatus.view`` and an Admin Hours grant, and a
        coordinator who runs outreach need hold neither.
        """
        apparatus = (
            await self.db.execute(
                select(Apparatus)
                .options(
                    selectinload(Apparatus.required_evoc_level),
                    selectinload(Apparatus.status_record),
                )
                .where(
                    Apparatus.organization_id == str(organization_id),
                    Apparatus.is_archived.is_(False),
                )
                .order_by(Apparatus.unit_number)
            )
        ).scalars()
        categories = (
            await self.db.execute(
                select(AdminHoursCategory.id, AdminHoursCategory.name)
                .where(
                    AdminHoursCategory.organization_id == str(organization_id),
                    AdminHoursCategory.is_active.is_(True),
                )
                .order_by(AdminHoursCategory.name)
            )
        ).all()
        return {
            "apparatus": [
                {
                    "id": str(unit.id),
                    "unit_number": unit.unit_number,
                    "name": unit.name,
                    "required_evoc_level_name": (
                        unit.required_evoc_level.name
                        if unit.required_evoc_level
                        else None
                    ),
                    "status_name": (
                        unit.status_record.name if unit.status_record else None
                    ),
                    "is_available": (
                        unit.status_record.is_available if unit.status_record else True
                    ),
                }
                for unit in apparatus
            ],
            "categories": [
                {"id": str(category_id), "name": name}
                for category_id, name in categories
            ],
            # A night with no category of its own is credited through its event
            # type's mapping; the editor warns when neither would credit the
            # crew's hours.
            "mapped_event_types": await AdminHoursService(self.db).mapped_event_types(
                organization_id
            ),
        }

    # ------------------------------------------------------------------
    # Assignment pickers
    # ------------------------------------------------------------------

    async def assignable_members(self, organization_id: str) -> List[Tuple[str, str]]:
        result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            )
            .order_by(User.last_name, User.first_name)
        )
        return [
            (
                str(u.id),
                format_display_name(u.first_name, u.last_name, u.preferred_name),
            )
            for u in result.scalars().all()
        ]

    async def driver_candidates(
        self, event_id: str, unit_id: str, organization_id: str
    ) -> Optional[Tuple[EventApparatusPlan, EventApparatusUnit, List[Dict[str, Any]]]]:
        """Members with a reason to be considered for the Driver seat, each
        judged by the real rule.

        Considered: anyone holding a current operator certification or an
        approved driver exception. That narrows who is *evaluated*; the verdict
        on each is ``evaluate_driver``'s, so this list cannot say yes where the
        seat write would say no. A member outside it can still be picked from
        the full roster, and the write judges them the same way.
        """
        night = await self.get_night(event_id, organization_id)
        if night is None:
            return None
        event, plan = night
        unit = next((u for u in plan.units if str(u.id) == str(unit_id)), None)
        if unit is None:
            return None
        on_date = await self._event_local_date(event, organization_id)

        certified = select(ApparatusOperator.user_id).where(
            ApparatusOperator.organization_id == str(organization_id),
            ApparatusOperator.is_active.is_(True),
            ApparatusOperator.is_certified.is_(True),
            ApparatusOperator.evoc_level_id.is_not(None),
        )
        excepted = select(DriverException.user_id).where(
            DriverException.organization_id == str(organization_id),
            DriverException.status == DriverExceptionStatus.APPROVED,
            DriverException.valid_from <= on_date,
            DriverException.valid_until >= on_date,
            or_(
                DriverException.apparatus_id.is_(None),
                DriverException.apparatus_id == str(unit.apparatus_id),
            ),
        )
        result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                or_(User.id.in_(certified), User.id.in_(excepted)),
            )
            .order_by(User.last_name, User.first_name)
        )
        candidates = []
        for member in result.scalars().all():
            outcome = await self.evaluate_driver(
                event, plan, unit, str(member.id), organization_id
            )
            exception = outcome.get("exception")
            candidates.append(
                {
                    "user_id": str(member.id),
                    "name": format_display_name(
                        member.first_name, member.last_name, member.preferred_name
                    ),
                    "allowed": outcome["allowed"],
                    "blocked_reason": outcome["blocked_reason"],
                    "warnings": outcome["warnings"],
                    "exception_valid_until": (
                        exception.valid_until.isoformat() if exception else None
                    ),
                }
            )
        candidates.sort(key=lambda c: (not c["allowed"], c["name"].casefold()))
        return plan, unit, candidates

    # ------------------------------------------------------------------
    # Editing one night's plan
    # ------------------------------------------------------------------

    async def update_night_plan(
        self,
        event_id: str,
        data: NightPlanUpdate,
        organization_id: str,
    ) -> Optional[List[ApparatusConflict]]:
        """Reshape one night — seats added or removed, an apparatus swapped —
        without touching its template or its sibling nights.

        A filled seat is kept by naming its id; leaving a filled seat out is
        refused rather than silently dropping someone from the crew. Returns
        the conflicts the new apparatus line-up has, as warnings: the night is
        already on the calendar, so there is nothing to hold back.
        """
        event = await self._get_event(event_id, organization_id, lock=True)
        if event is None:
            return None
        plan = await self.get_plan(event_id, organization_id)
        if plan is None:
            return None
        self._assert_night_open(event)
        apparatus = await self._assert_apparatus(
            [unit.apparatus_id for unit in data.units], organization_id
        )
        await self._assert_category(data.admin_hours_category_id, organization_id)

        existing_units = {str(u.id): u for u in plan.units}
        existing_seats = {str(s.id): s for u in plan.units for s in u.seats}
        kept_seat_ids = {
            seat.id for unit in data.units for seat in unit.seats if seat.id
        }
        unknown = [s for s in kept_seat_ids if s not in existing_seats] + [
            u.id for u in data.units if u.id and u.id not in existing_units
        ]
        if unknown:
            raise ValueError("Seat not found")
        for seat_id, seat in existing_seats.items():
            if seat.user_id and seat_id not in kept_seat_ids:
                # The seat, not the member: a name of any length would push
                # the refusal past safe_error_detail's limit.
                raise ValueError(
                    f"Someone is in the {seat.name} seat. Move or clear them "
                    "before removing it."
                )

        plan.evoc_mode = _value(data.evoc_mode)
        plan.allow_self_signup = data.allow_self_signup
        plan.show_on_schedule = data.show_on_schedule
        plan.admin_hours_category_id = data.admin_hours_category_id

        kept_unit_ids = set()
        for unit_index, unit_spec in enumerate(data.units):
            unit = existing_units.get(unit_spec.id) if unit_spec.id else None
            if unit is None:
                unit = EventApparatusUnit(
                    organization_id=str(organization_id),
                    plan_id=plan.id,
                    event_id=event.id,
                    apparatus_id=unit_spec.apparatus_id,
                )
                plan.units.append(unit)
            unit.apparatus_id = unit_spec.apparatus_id
            unit.sort_order = unit_index
            await self.db.flush()
            kept_unit_ids.add(str(unit.id))
            for seat_index, seat_spec in enumerate(unit_spec.seats):
                seat_row = existing_seats.get(seat_spec.id) if seat_spec.id else None
                if seat_row is None:
                    seat_row = EventApparatusSeat(
                        organization_id=str(organization_id),
                        event_id=event.id,
                        unit_id=unit.id,
                        name=seat_spec.name,
                    )
                    self.db.add(seat_row)
                seat_row.unit_id = unit.id
                seat_row.name = seat_spec.name
                seat_row.seat_type = _value(seat_spec.seat_type)
                seat_row.note = seat_spec.note
                seat_row.sort_order = seat_index

        await self.db.flush()
        for seat_id, seat in existing_seats.items():
            if seat_id not in kept_seat_ids:
                await self.db.delete(seat)
        for unit_id, unit in existing_units.items():
            if unit_id not in kept_unit_ids:
                await self.db.delete(unit)
        await self.db.flush()

        # Every filled Driver seat is judged again against the night as it now
        # stands: a seat retyped as Driver, moved to another apparatus, or a
        # mode tightened from "don't check" to "enforce" can each leave
        # someone behind a wheel the rule would not let them take.
        plan = await self.get_plan(event_id, organization_id)
        if plan is None:
            return None
        units_by_id = {str(u.id): u for u in plan.units}
        for unit in units_by_id.values():
            for seat in unit.seats:
                if (
                    seat.user_id
                    and seat.seat_type == ApparatusEventSeatType.DRIVER.value
                ):
                    outcome = await self.evaluate_driver(
                        event, plan, unit, str(seat.user_id), organization_id
                    )
                    if not outcome["allowed"]:
                        raise ValueError(outcome["blocked_reason"])

        night = NightSpec(
            start_datetime=_utc(event.start_datetime),
            end_datetime=_utc(event.end_datetime),
        )
        conflicts = await self.find_conflicts(
            organization_id, apparatus, [night], exclude_event_ids=[str(event.id)]
        )
        await self.db.commit()
        return conflicts

    # ------------------------------------------------------------------
    # Lists
    # ------------------------------------------------------------------

    async def _night_rows(
        self, organization_id: str, *conditions: Any, order_desc: bool = False
    ) -> List[Dict[str, Any]]:
        order = Event.start_datetime.desc() if order_desc else Event.start_datetime
        result = await self.db.execute(
            select(Event, EventApparatusPlan)
            .join(EventApparatusPlan, EventApparatusPlan.event_id == Event.id)
            .where(
                Event.organization_id == str(organization_id),
                EventApparatusPlan.organization_id == str(organization_id),
                *conditions,
            )
            .order_by(order)
            .limit(200)
        )
        rows = result.all()
        if not rows:
            return []
        event_ids = [str(event.id) for event, _plan in rows]

        seat_counts = {
            str(event_id): (int(filled), int(total))
            for event_id, filled, total in (
                await self.db.execute(
                    select(
                        EventApparatusSeat.event_id,
                        func.count(EventApparatusSeat.user_id),
                        func.count(EventApparatusSeat.id),
                    )
                    .where(
                        EventApparatusSeat.organization_id == str(organization_id),
                        EventApparatusSeat.event_id.in_(event_ids),
                    )
                    .group_by(EventApparatusSeat.event_id)
                )
            ).all()
        }
        units: Dict[str, List[str]] = {}
        for event_id, unit_number in (
            await self.db.execute(
                select(EventApparatusUnit.event_id, Apparatus.unit_number)
                .join(Apparatus, Apparatus.id == EventApparatusUnit.apparatus_id)
                .where(
                    EventApparatusUnit.organization_id == str(organization_id),
                    EventApparatusUnit.event_id.in_(event_ids),
                )
                .order_by(EventApparatusUnit.sort_order)
            )
        ).all():
            units.setdefault(str(event_id), []).append(unit_number)
        checked_in = {
            str(event_id): int(count)
            for event_id, count in (
                await self.db.execute(
                    select(EventRSVP.event_id, func.count(EventRSVP.id))
                    .where(
                        EventRSVP.organization_id == str(organization_id),
                        EventRSVP.event_id.in_(event_ids),
                        EventRSVP.checked_in.is_(True),
                    )
                    .group_by(EventRSVP.event_id)
                )
            ).all()
        }
        names = await self.template_names(
            organization_id, [plan.template_id for _event, plan in rows]
        )
        out = []
        for event, plan in rows:
            filled, total = seat_counts.get(str(event.id), (0, 0))
            out.append(
                {
                    "event": event,
                    "plan": plan,
                    "event_id": str(event.id),
                    "title": event.title,
                    "start_datetime": _utc(event.start_datetime),
                    "end_datetime": _utc(event.end_datetime),
                    "template_name": names.get(str(plan.template_id)),
                    "unit_numbers": units.get(str(event.id), []),
                    "filled": filled,
                    "total": total,
                    "is_cancelled": bool(event.is_cancelled),
                    "attendance_finalized": attendance_is_finalized(event),
                    "checked_in": checked_in.get(str(event.id), 0),
                }
            )
        return out

    async def list_nights(
        self, organization_id: str, scope: str
    ) -> List[Dict[str, Any]]:
        """The coordinator's nights: ``upcoming``, ``needs_confirmation`` (over,
        not cancelled, attendance not yet finalized) or ``past``."""
        now = datetime.now(dt_timezone.utc)
        if scope == "upcoming":
            return await self._night_rows(
                organization_id,
                Event.end_datetime >= now,
                Event.is_cancelled.is_(False),
            )
        if scope == "needs_confirmation":
            rows = await self._night_rows(
                organization_id,
                Event.end_datetime < now,
                Event.is_cancelled.is_(False),
                Event.attendance_finalized_at.is_(None),
                order_desc=True,
            )
            return [row for row in rows if not row["attendance_finalized"]]
        if scope == "past":
            return await self._night_rows(
                organization_id,
                Event.end_datetime < now,
                or_(
                    Event.is_cancelled.is_(True),
                    Event.attendance_finalized_at.is_not(None),
                ),
                order_desc=True,
            )
        raise ValueError("Unknown list")

    async def calendar(
        self,
        organization_id: str,
        start: datetime,
        end: datetime,
        viewer_id: str,
    ) -> List[Dict[str, Any]]:
        """Nights shown on the scheduling calendar, read-only. Drafts,
        cancelled nights and plans that opted out are left off."""
        start, end = _utc(start), _utc(end)
        if end <= start:
            raise ValueError("The range must end after it starts")
        if end - start > timedelta(days=MAX_CALENDAR_RANGE_DAYS):
            raise ValueError(f"The range can be at most {MAX_CALENDAR_RANGE_DAYS} days")
        rows = await self._night_rows(
            organization_id,
            EventApparatusPlan.show_on_schedule.is_(True),
            Event.is_cancelled.is_(False),
            Event.is_draft.is_(False),
            and_(Event.start_datetime < end, Event.end_datetime > start),
        )
        if not rows:
            return []
        mine = {
            str(event_id)
            for event_id in (
                await self.db.execute(
                    select(EventApparatusSeat.event_id).where(
                        EventApparatusSeat.organization_id == str(organization_id),
                        EventApparatusSeat.user_id == str(viewer_id),
                        EventApparatusSeat.event_id.in_([r["event_id"] for r in rows]),
                    )
                )
            ).scalars()
        }
        for row in rows:
            row["is_mine"] = row["event_id"] in mine
        return rows
