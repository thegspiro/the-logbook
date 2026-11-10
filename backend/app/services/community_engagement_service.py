"""The Community Engagement report: what public outreach reached, and at what cost.

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
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventExternalAttendee, EventRSVP
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.user import Organization
from app.services.dashboard_widget_service import outreach_event_clause, period_dates
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

    @property
    def reach_is_estimate(self) -> bool:
        return self.signed_in == 0 and self.expected is not None

    @property
    def people_reached(self) -> int:
        if self.signed_in > 0:
            return self.signed_in
        return self.expected or 0


@dataclass
class Totals:
    events_held: int
    people_reached: int
    signed_in: int
    estimated: int
    member_hours: float
    members_involved: int
    requests_received: int
    requests_completed: int


def _as_utc(value: datetime) -> datetime:
    """MySQL DATETIME reads back naive; every instant here is UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _event_type_label(value: object) -> str:
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
        requests: dict[str, EventRequest] = {}
        request_rows = await self.db.execute(
            select(EventRequest)
            .where(
                EventRequest.organization_id == organization_id,
                EventRequest.event_id.in_(ids),
            )
            .order_by(EventRequest.created_at.asc())
        )
        for linked in request_rows.scalars().all():
            requests[str(linked.event_id)] = linked

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
                EventRSVP.checked_in.is_(True),
            )
        )
        for rsvp in rsvp_rows.scalars().all():
            rsvps_by_event.setdefault(str(rsvp.event_id), []).append(rsvp)

        rows: list[EventReach] = []
        for event in events:
            eid = str(event.id)
            req = requests.get(eid)
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
                type_label = _event_type_label(event.event_type)
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
                )
            )
        rows.sort(key=lambda r: r.start, reverse=True)
        return rows

    async def _request_counts(
        self, organization_id: str, start: Optional[datetime], end: datetime
    ) -> tuple[int, int]:
        conditions = [
            EventRequest.organization_id == organization_id,
            EventRequest.created_at < end,
        ]
        if start is not None:
            conditions.append(EventRequest.created_at >= start)
        received, completed = (
            await self.db.execute(
                select(
                    func.count(EventRequest.id),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    EventRequest.status
                                    == EventRequestStatus.COMPLETED.value,
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ),
                ).where(*conditions)
            )
        ).one()
        return int(received or 0), int(completed or 0)

    @staticmethod
    def _totals(rows: list[EventReach], requests: tuple[int, int]) -> Totals:
        members: set[str] = set()
        for r in rows:
            members |= r.member_ids
        return Totals(
            events_held=len(rows),
            people_reached=sum(r.people_reached for r in rows),
            signed_in=sum(r.signed_in for r in rows),
            estimated=sum(r.expected or 0 for r in rows if r.reach_is_estimate),
            member_hours=sum_hours_to_quarter(r.member_hours for r in rows),
            members_involved=len(members),
            requests_received=requests[0],
            requests_completed=requests[1],
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
            buckets[k] = {"period": k, "events": 0, "signed_in": 0, "estimated": 0}
            cursor += step
        for r in rows:
            bucket = buckets.get(key(r.start.astimezone(tz).date()))
            if bucket is None:
                continue
            bucket["events"] += 1
            if r.reach_is_estimate:
                bucket["estimated"] += r.expected or 0
            else:
                bucket["signed_in"] += r.signed_in
        return ("year" if by_year else "month"), list(buckets.values())

    @staticmethod
    def _by_type(rows: list[EventReach]) -> list[dict]:
        grouped: dict[str, dict] = {}
        for r in rows:
            entry = grouped.setdefault(
                r.type_label, {"label": r.type_label, "events": 0, "people_reached": 0}
            )
            entry["events"] += 1
            entry["people_reached"] += r.people_reached
        return sorted(
            grouped.values(),
            key=lambda e: (-e["people_reached"], -e["events"], e["label"]),
        )

    async def report(self, organization_id: str, period: str) -> dict:
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

        rows = await self._held_events(organization_id, org, start, end)
        current = self._totals(
            rows, await self._request_counts(organization_id, start, end)
        )
        previous_totals: Optional[Totals] = None
        if previous is not None:
            prev_rows = await self._held_events(organization_id, org, *previous)
            previous_totals = self._totals(
                prev_rows, await self._request_counts(organization_id, *previous)
            )

        upcoming = await self.db.scalar(
            select(func.count(Event.id)).where(
                outreach_event_clause(organization_id),
                Event.start_datetime >= now,
            )
        )

        both = [r for r in rows if r.signed_in > 0 and r.expected is not None]
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
                "signed_in": sum(r.signed_in for r in both),
                "expected": sum(r.expected or 0 for r in both),
            },
            "granularity": granularity,
            "by_period": buckets,
            "by_type": self._by_type(rows),
            "recent_events": [
                {
                    "event_id": r.event_id,
                    "title": r.title,
                    "start_datetime": r.start,
                    "type_label": r.type_label,
                    "organization_name": r.organization_name,
                    "request_id": r.request_id,
                    "signed_in": r.signed_in,
                    "expected": r.expected,
                    "people_reached": r.people_reached,
                    "reach_is_estimate": r.reach_is_estimate,
                    "crew": r.crew,
                    "member_hours": r.member_hours,
                }
                for r in rows[:RECENT_EVENT_LIMIT]
            ],
        }


__all__ = [
    "CommunityEngagementService",
    "REPORT_PERIODS",
    "RECENT_EVENT_LIMIT",
    "report_bounds",
]
