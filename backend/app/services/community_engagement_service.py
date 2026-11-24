"""The Outreach Impact report: what public outreach reached, and at what cost.

The tab this feeds answers three questions a public-education officer is asked
for at budget time: how many events were held, how many people they reached,
and how many member hours they took. Two rules shape every figure.

**An event is counted once it has started.** A scheduled event has reached
nobody yet, and counting it as "held" both inflated the total and divided the
average across events with no audience.

**People reached is the guests who signed in, or, where nobody signed in, the
audience the requester told us to expect.** A school assembly of 120 children
does not pass a clipboard round, so a sign-in count alone reported a
department's largest audiences as zero. An estimate is never added to a
sign-in count for the same event — the sign-ins are what actually happened —
and the two are always reported separately so the screen can label which is
which. Where an event has both, the pair is kept as *turnout*: the gap between
what a requester expected and who actually came.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event import Event, EventExternalAttendee, EventRSVP
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.user import Organization
from app.services.crr_impact_service import CrrImpactService
from app.services.dashboard_widget_service import (
    is_outreach_event,
    outreach_event_clause,
    period_dates,
)
from app.services.event_request_service import outreach_type_label
from app.services.event_service import EventService
from app.utils.hours import hours_from_minutes, sum_hours_to_quarter
from app.utils.org_timezone import scheduling_timezone

#: The periods the tab offers. ``rolling_12`` starts on the first of the month
#: eleven months back so the chart's first bar is a whole month, not a stub.
REPORT_PERIODS = ("month", "quarter", "year", "rolling_12", "all")

#: How far back the comparison period sits. ``all`` has nothing before it.
_PERIOD_STEP = {
    "month": relativedelta(months=1),
    "quarter": relativedelta(months=3),
    "year": relativedelta(years=1),
    "rolling_12": relativedelta(years=1),
}

#: Past this many months an all-time chart is drawn by year: thirty-odd
#: monthly bars no longer fit a phone, and the trend a chief reads at that
#: range is year over year anyway.
_MAX_MONTHLY_BUCKETS = 36

#: The table lists the most recent events in the period, not every one: it
#: exists to explain the totals above it, and the CSV export carries the same
#: rows.
RECENT_EVENT_LIMIT = 50

_EVENT_TYPE_LABELS = {
    "public_education": "Public Education",
    "fundraiser": "Fundraiser",
    "ceremony": "Ceremony",
    "social": "Social",
    "recruitment": "Recruitment",
    "training": "Training",
    "business_meeting": "Business Meeting",
    "other": "Other",
}


@dataclass
class EventReach:
    """One held event's contribution to the report."""

    event_id: str
    title: str
    start: datetime
    type_label: str
    organization_name: Optional[str]
    request_id: Optional[str]
    signed_in: int
    expected: Optional[int]
    crew: int
    member_hours: float
    member_ids: set[str] = field(default_factory=set)
    headcount: Optional[int] = None
    #: "request" for an event a public request was scheduled onto, labelled by
    #: the request's outreach type; "department" for the rest, labelled by
    #: event type. Two vocabularies, so the breakdown keeps them apart.
    group: str = "department"
    #: What happened, recorded when the event closed (owner decision,
    #: 2026-11-20): carried to the export, and materials totalled on the report.
    outcome_note: Optional[str] = None
    materials: list[dict] = field(default_factory=list)
    photos: Optional[str] = None

    @property
    def has_actual(self) -> bool:
        """Whether anything was counted: a headcount, or any guest sign-in."""
        return self.headcount is not None or self.signed_in > 0

    @property
    def counted(self) -> int:
        """The actual audience. A coordinator's headcount, where one was
        recorded, is a count of the room; sign-ins are a count of the people
        who stopped at the sheet, so the headcount wins rather than adding."""
        return self.headcount if self.headcount is not None else self.signed_in

    @property
    def reach_is_estimate(self) -> bool:
        return not self.has_actual and self.expected is not None

    @property
    def people_reached(self) -> int:
        if self.has_actual:
            return self.counted
        return self.expected or 0


@dataclass
class Totals:
    events_held: int
    people_reached: int
    counted: int
    signed_in: int
    estimated: int
    member_hours: float
    members_involved: int
    requests_received: int
    requests_completed: int
    # Requester feedback received in the period, and the mean of the ratings
    # among it (None when no response carried one).
    feedback_responses: int = 0
    average_rating: Optional[float] = None


def _as_utc(value: datetime) -> datetime:
    """MySQL DATETIME reads back naive; every instant here is UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def event_type_label(value: object) -> str:
    """An event type as people read it. Also used by the evaluation data
    source ``events.attended_by_type``, so both name a type alike."""
    raw = str(getattr(value, "value", value) or "other")
    return _EVENT_TYPE_LABELS.get(raw, raw.replace("_", " ").title())


def report_bounds(
    period: str, now: datetime, tz: ZoneInfo
) -> tuple[Optional[datetime], datetime, Optional[tuple[datetime, datetime]]]:
    """The period's UTC start (None for all time), its end, and the comparison.

    The comparison covers the same elapsed span one period earlier — the first
    40 days of last quarter against the first 40 of this one — because a
    period still in progress set against a finished one always reads as a
    decline.
    """
    local_now = now.astimezone(tz)
    today = local_now.date()
    start_day: Optional[date]
    if period == "all":
        start_day = None
    elif period == "rolling_12":
        start_day = date(today.year, today.month, 1) - relativedelta(months=11)
    else:
        start_day, _ = period_dates(period, today)
    if start_day is None:
        return None, now, None
    start_local = datetime.combine(start_day, time.min, tz)
    step = _PERIOD_STEP[period]
    previous = (
        (start_local - step).astimezone(timezone.utc),
        (local_now - step).astimezone(timezone.utc),
    )
    return start_local.astimezone(timezone.utc), now, previous


class CommunityEngagementService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _held_events(
        self,
        organization_id: str,
        org: Optional[Organization],
        start: Optional[datetime],
        end: datetime,
    ) -> list[EventReach]:
        query = select(Event).where(
            outreach_event_clause(organization_id),
            Event.start_datetime < end,
        )
        if start is not None:
            query = query.where(Event.start_datetime >= start)
        events = list((await self.db.execute(query)).scalars().all())
        if not events:
            return []
        ids = [str(e.id) for e in events]

        # A request can be re-pointed at an event another request already
        # names; the most recent one is the requester whose expectation the
        # event was scheduled against.
        request_for_event: dict[str, EventRequest] = {}
        request_rows = await self.db.execute(
            select(EventRequest)
            .where(
                EventRequest.organization_id == organization_id,
                EventRequest.event_id.in_(ids),
            )
            .order_by(EventRequest.created_at.asc())
        )
        for linked in request_rows.scalars().all():
            request_for_event[str(linked.event_id)] = linked

        guest_rows = await self.db.execute(
            select(EventExternalAttendee.event_id, func.count())
            .where(
                EventExternalAttendee.organization_id == organization_id,
                EventExternalAttendee.event_id.in_(ids),
                EventExternalAttendee.checked_in.is_(True),
            )
            .group_by(EventExternalAttendee.event_id)
        )
        guests = {str(eid): int(n) for eid, n in guest_rows.all()}

        rsvps_by_event: dict[str, list[EventRSVP]] = {}
        rsvp_rows = await self.db.execute(
            select(EventRSVP).where(
                EventRSVP.organization_id == organization_id,
                EventRSVP.event_id.in_(ids),
                # Present by scan or by an officer's override: the events
                # list's rule (user_attended) and the attendance-waiver
                # check's. An override writes override_check_in_at without
                # setting checked_in, and a member an officer recorded after
                # the fact gave the same hours as one who tapped in.
                or_(
                    EventRSVP.checked_in.is_(True),
                    EventRSVP.override_check_in_at.is_not(None),
                ),
            )
        )
        for rsvp in rsvp_rows.scalars().all():
            rsvps_by_event.setdefault(str(rsvp.event_id), []).append(rsvp)

        rows: list[EventReach] = []
        for event in events:
            eid = str(event.id)
            req = request_for_event.get(eid)
            crew = rsvps_by_event.get(eid, [])
            effective_end = EventService.effective_end(event)
            # The same credited-minutes rule the training ledger and admin
            # hours use (pitfall #29), so an officer's corrected times are what
            # this report totals rather than the raw tap-in.
            hours = sum_hours_to_quarter(
                hours_from_minutes(
                    EventService.credited_minutes(event, r, effective_end)
                )
                for r in crew
            )
            if req is not None:
                type_label = outreach_type_label(org, req.outreach_type)
                org_name = req.organization_name or req.contact_name
            else:
                type_label = event_type_label(event.event_type)
                org_name = None
            expected = req.audience_size if req is not None else None
            rows.append(
                EventReach(
                    event_id=eid,
                    title=event.title,
                    start=_as_utc(event.start_datetime),
                    type_label=type_label,
                    organization_name=org_name,
                    request_id=str(req.id) if req is not None else None,
                    signed_in=guests.get(eid, 0),
                    expected=expected if expected and expected > 0 else None,
                    crew=len(crew),
                    member_hours=hours,
                    member_ids={str(r.user_id) for r in crew},
                    headcount=event.guest_headcount,
                    group="request" if req is not None else "department",
                    outcome_note=event.outreach_outcome_note,
                    materials=list(event.outreach_materials or []),
                    photos=event.outreach_photos,
                )
            )
        rows.sort(key=lambda r: r.start, reverse=True)
        return rows

    async def _request_counts(
        self, organization_id: str, start: Optional[datetime], end: datetime
    ) -> tuple[int, int]:
        """Requests received in the period, and requests completed in it.

        Two populations, deliberately: a request received in December and
        finished in January is January's completion. The request row keeps no
        completion date, but every move to Completed goes through the status
        endpoint, which logs it, and Completed is terminal — so the activity
        row's time is the completion time.
        """
        received_conditions = [
            EventRequest.organization_id == organization_id,
            EventRequest.created_at < end,
        ]
        completed_conditions = [
            EventRequest.organization_id == organization_id,
            EventRequestActivity.new_status == EventRequestStatus.COMPLETED.value,
            EventRequestActivity.created_at < end,
        ]
        if start is not None:
            received_conditions.append(EventRequest.created_at >= start)
            completed_conditions.append(EventRequestActivity.created_at >= start)
        received = await self.db.scalar(
            select(func.count(EventRequest.id)).where(*received_conditions)
        )
        completed = await self.db.scalar(
            select(func.count(func.distinct(EventRequestActivity.request_id)))
            .join(EventRequest, EventRequest.id == EventRequestActivity.request_id)
            .where(*completed_conditions)
        )
        return int(received or 0), int(completed or 0)

    async def _rating_scale_max(self, org: Optional[Organization]) -> Optional[int]:
        from app.services.outreach_feedback_service import (
            OutreachFeedbackService,
            rating_scale_max,
        )

        if org is None:
            return None
        found = await OutreachFeedbackService(self.db).configured(org)
        if found is None or found[1] is None:
            return None
        return rating_scale_max(found[1])

    async def _feedback(
        self, organization_id: str, start: Optional[datetime], end: datetime
    ) -> tuple[int, Optional[float]]:
        """Responses received in the period, and their average rating."""
        from app.services.outreach_feedback_service import OutreachFeedbackService

        responses, rated, total = await OutreachFeedbackService(self.db).rating_totals(
            organization_id, start, end
        )
        return responses, (round(total / rated, 1) if rated else None)

    @staticmethod
    def _totals(
        rows: list[EventReach],
        request_counts: tuple[int, int],
        feedback: tuple[int, Optional[float]] = (0, None),
    ) -> Totals:
        members: set[str] = set()
        for r in rows:
            members |= r.member_ids
        return Totals(
            events_held=len(rows),
            people_reached=sum(r.people_reached for r in rows),
            counted=sum(r.counted for r in rows if r.has_actual),
            signed_in=sum(r.signed_in for r in rows),
            estimated=sum(r.expected or 0 for r in rows if r.reach_is_estimate),
            member_hours=sum_hours_to_quarter(r.member_hours for r in rows),
            members_involved=len(members),
            requests_received=request_counts[0],
            requests_completed=request_counts[1],
            feedback_responses=feedback[0],
            average_rating=feedback[1],
        )

    @staticmethod
    def _buckets(
        rows: list[EventReach], start: Optional[datetime], now: datetime, tz: ZoneInfo
    ) -> tuple[str, list[dict]]:
        """Reach per month (or per year, for a long all-time span), oldest first.

        Every bucket in the span is returned, empty ones included: a month
        with no outreach is information, and a chart that skips it draws the
        months either side as neighbours.
        """
        local_now = now.astimezone(tz)
        if start is not None:
            first = start.astimezone(tz).date()
        elif rows:
            first = min(r.start for r in rows).astimezone(tz).date()
        else:
            first = local_now.date()
        months = (local_now.year - first.year) * 12 + (local_now.month - first.month)
        by_year = months >= _MAX_MONTHLY_BUCKETS

        def key(d: date) -> str:
            return f"{d.year:04d}" if by_year else f"{d.year:04d}-{d.month:02d}"

        buckets: dict[str, dict] = {}
        cursor = date(first.year, 1 if by_year else first.month, 1)
        step = relativedelta(years=1) if by_year else relativedelta(months=1)
        while cursor <= local_now.date():
            k = key(cursor)
            buckets[k] = {
                "period": k,
                "events": 0,
                "counted": 0,
                "signed_in": 0,
                "estimated": 0,
            }
            cursor += step
        for r in rows:
            bucket = buckets.get(key(r.start.astimezone(tz).date()))
            if bucket is None:
                continue
            bucket["events"] += 1
            bucket["signed_in"] += r.signed_in
            if r.reach_is_estimate:
                bucket["estimated"] += r.expected or 0
            elif r.has_actual:
                bucket["counted"] += r.counted
        return ("year" if by_year else "month"), list(buckets.values())

    @staticmethod
    def _by_type(rows: list[EventReach]) -> list[dict]:
        grouped: dict[tuple[str, str], dict] = {}
        for r in rows:
            entry = grouped.setdefault(
                (r.group, r.type_label),
                {
                    "group": r.group,
                    "label": r.type_label,
                    "events": 0,
                    "people_reached": 0,
                },
            )
            entry["events"] += 1
            entry["people_reached"] += r.people_reached
        return sorted(
            grouped.values(),
            key=lambda e: (-e["people_reached"], -e["events"], e["label"]),
        )

    async def _context(self, organization_id: str, period: str) -> tuple[
        Optional[Organization],
        ZoneInfo,
        datetime,
        Optional[datetime],
        datetime,
        Optional[tuple[datetime, datetime]],
    ]:
        if period not in REPORT_PERIODS:
            raise ValueError(f"Unknown period: {period}")
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        tz = scheduling_timezone(org)
        now = datetime.now(timezone.utc)
        start, end, previous = report_bounds(period, now, tz)
        return org, tz, now, start, end, previous

    @staticmethod
    def _row(r: EventReach) -> dict:
        return {
            "event_id": r.event_id,
            "title": r.title,
            "start_datetime": r.start,
            "type_label": r.type_label,
            "organization_name": r.organization_name,
            "request_id": r.request_id,
            "signed_in": r.signed_in,
            "headcount": r.headcount,
            "counted": r.counted if r.has_actual else None,
            "expected": r.expected,
            "people_reached": r.people_reached,
            "reach_is_estimate": r.reach_is_estimate,
            "crew": r.crew,
            "member_hours": r.member_hours,
            "outcome_note": r.outcome_note,
            "materials": r.materials,
            "photos": r.photos,
        }

    @staticmethod
    def _materials(rows: list[EventReach]) -> list[dict]:
        """What was handed out across the period, one line per item, most
        first. Items are matched case-insensitively, as they are when saved,
        and named as the earliest event spelled them, so a new event does not
        relabel a running total. ``rows`` arrive newest first."""
        totals: dict[str, dict] = {}
        for r in reversed(rows):
            for entry in r.materials:
                item = str(entry.get("item") or "").strip()
                quantity = int(entry.get("quantity") or 0)
                if not item or quantity < 1:
                    continue
                line = totals.setdefault(item.casefold(), {"item": item, "quantity": 0})
                line["quantity"] += quantity
        return sorted(totals.values(), key=lambda line: -line["quantity"])

    async def events(self, organization_id: str, period: str) -> list[dict]:
        """Every held outreach event in the period, newest first — the rows
        the report's table shows the first RECENT_EVENT_LIMIT of, in full for
        the export, so a spreadsheet totals to the figures on the screen."""
        org, _, _, start, end, _ = await self._context(organization_id, period)
        return [
            self._row(r)
            for r in await self._held_events(organization_id, org, start, end)
        ]

    async def report(self, organization_id: str, period: str) -> dict:
        org, tz, now, start, end, previous = await self._context(
            organization_id, period
        )

        rows = await self._held_events(organization_id, org, start, end)
        current = self._totals(
            rows,
            await self._request_counts(organization_id, start, end),
            await self._feedback(organization_id, start, end),
        )
        previous_totals: Optional[Totals] = None
        if previous is not None:
            prev_rows = await self._held_events(organization_id, org, *previous)
            previous_totals = self._totals(
                prev_rows,
                await self._request_counts(organization_id, *previous),
                await self._feedback(organization_id, *previous),
            )

        upcoming = await self.db.scalar(
            select(func.count(Event.id)).where(
                outreach_event_clause(organization_id),
                Event.start_datetime >= now,
            )
        )

        both = [r for r in rows if r.has_actual and r.expected is not None]
        granularity, buckets = self._buckets(rows, start, now, tz)
        return {
            "period": period,
            "period_start": start,
            "period_end": end,
            "current": current.__dict__,
            "previous": previous_totals.__dict__ if previous_totals else None,
            "upcoming_events": int(upcoming or 0),
            "turnout": {
                "events": len(both),
                "counted": sum(r.counted for r in both),
                "signed_in": sum(r.signed_in for r in both),
                "expected": sum(r.expected or 0 for r in both),
            },
            "granularity": granularity,
            "rating_scale_max": await self._rating_scale_max(org),
            "by_period": buckets,
            "by_type": self._by_type(rows),
            "materials": self._materials(rows),
            "recent_events": [self._row(r) for r in rows[:RECENT_EVENT_LIMIT]],
            "crr": await CrrImpactService(self.db).breakdown(
                organization_id, start, end, previous
            ),
        }

    async def load_event(self, organization_id: str, event_id: str) -> Optional[Event]:
        """This department's event, with the location the response names."""
        result = await self.db.execute(
            select(Event)
            .where(
                Event.id == str(event_id),
                Event.organization_id == str(organization_id),
            )
            .options(selectinload(Event.location_obj))
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def set_guest_headcount(
        self, organization_id: str, event_id: str, headcount: Optional[int]
    ) -> Optional[Event]:
        """Record (or clear, with None) the guests counted at an outreach event.

        None when the event is not this department's. Refused for an event
        that is not outreach — the count would be stored and read by nothing —
        for a cancelled one, and before the event has started, when there is
        nobody to count yet.
        """
        event = (
            await self.db.execute(
                select(Event)
                .where(
                    Event.id == str(event_id),
                    Event.organization_id == str(organization_id),
                )
                .options(selectinload(Event.location_obj))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if event is None:
            return None
        if event.is_cancelled:
            raise ValueError("A cancelled event has no guests to count")
        if not await is_outreach_event(self.db, organization_id, event_id):
            raise ValueError("Only community outreach events take a guest headcount")
        if _as_utc(event.start_datetime) > datetime.now(timezone.utc):
            raise ValueError("A headcount can be recorded once the event has started")
        event.guest_headcount = headcount
        await self.db.flush()
        return event

    async def set_outreach_closeout(
        self,
        organization_id: str,
        event_id: str,
        outcome_note: Optional[str],
        apparatus_ids: list[str],
        materials: list[dict],
        photos: Optional[str],
    ) -> Optional[Event]:
        """Record what happened at an outreach event (owner decision, 2026-11-20).

        Replaces what was recorded. None when the event is not this
        department's; refused, as a headcount is, for an event that is not
        outreach, a cancelled one, and one that has not started. Apparatus ids
        must each name this department's apparatus, in either table (pitfall
        #14c). Materials are settled to one entry per item, case-insensitively,
        quantities summed (pitfall #20). Not locked by finalized attendance,
        which governs members' credited time, not this record.
        """
        from app.models.event import OUTREACH_PHOTO_CHOICES
        from app.utils.apparatus_ref import resolve_apparatus_ref

        event = (
            await self.db.execute(
                select(Event)
                .where(
                    Event.id == str(event_id),
                    Event.organization_id == str(organization_id),
                )
                .options(selectinload(Event.location_obj))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if event is None:
            return None
        if event.is_cancelled:
            raise ValueError("A cancelled event has nothing to close out")
        if not await is_outreach_event(self.db, organization_id, event_id):
            raise ValueError("Only community outreach events are closed out here")
        if _as_utc(event.start_datetime) > datetime.now(timezone.utc):
            raise ValueError("An event can be closed out once it has started")
        if photos is not None and photos not in OUTREACH_PHOTO_CHOICES:
            raise ValueError("Unknown photo choice")

        settled_apparatus: list[str] = []
        for apparatus_id in apparatus_ids:
            if apparatus_id in settled_apparatus:
                continue
            ref = await resolve_apparatus_ref(self.db, apparatus_id, organization_id)
            if ref.full is None and ref.basic is None:
                raise ValueError("Apparatus not found")
            settled_apparatus.append(apparatus_id)

        merged: dict[str, dict] = {}
        for entry in materials:
            item = str(entry.get("item") or "").strip()
            quantity = int(entry.get("quantity") or 0)
            if not item or quantity < 1:
                continue
            key = item.casefold()
            if key in merged:
                merged[key]["quantity"] += quantity
            else:
                merged[key] = {"item": item, "quantity": quantity}

        event.outreach_outcome_note = (outcome_note or "").strip() or None
        event.outreach_apparatus_ids = settled_apparatus or None
        event.outreach_materials = list(merged.values()) or None
        event.outreach_photos = photos
        await self.db.flush()
        return event


__all__ = [
    "CommunityEngagementService",
    "REPORT_PERIODS",
    "RECENT_EVENT_LIMIT",
    "report_bounds",
]
