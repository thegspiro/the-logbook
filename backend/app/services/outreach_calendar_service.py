"""The Outreach Overview's calendar: every outreach event in a range, with its staffing.

The Community Outreach Manager plans from one list that the rest of the app
keeps in three places: events scheduled from a public request, outreach events
created directly, and apparatus nights. Each is reported with how full its
volunteer signup sheet and its apparatus crew are, and whether it has been
closed out, so the overview can say what is short and what is waiting.

Nothing here decides anything of its own (pitfall #29). Which events count is
``outreach_event_clause``, the rule Outreach Impact counts by; sheet fill is
``staffing_counts_by_request``, which the requests list shows; crew fill is
``ApparatusEventService.crew_summary``, which the nights lists show; closed out
is ``attendance_is_finalized``.
"""

from datetime import datetime, timedelta
from typing import Any, Optional, Union

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apparatus_event import EventApparatusPlan
from app.models.event import Event
from app.models.event_request import EventRequest
from app.models.location import Location
from app.schemas.base import as_utc
from app.services.apparatus_event_service import ApparatusEventService
from app.services.dashboard_widget_service import outreach_event_clause
from app.services.event_request_service import staffing_counts_by_request
from app.services.event_service import attendance_is_finalized

#: Wide enough for a month grid plus the overview's look back and ahead
#: (30 days behind, 60 ahead), and no wider: every row costs a staffing lookup.
MAX_RANGE_DAYS = 93

#: A ceiling on rows, so a department that schedules outreach hourly cannot
#: turn one page load into an unbounded read. Far above a real quarter's count.
MAX_ROWS = 500


class OutreachCalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def calendar(
        self, organization_id: str, start: datetime, end: datetime
    ) -> list[dict[str, Any]]:
        """Outreach events overlapping ``[start, end)``, earliest first.

        Drafts are included and flagged: the manager is the one who publishes
        them, and a draft is still a date the department has committed to.
        Cancelled events are out, by ``outreach_event_clause``.
        """
        start, end = as_utc(start), as_utc(end)
        if end <= start:
            raise ValueError("The range must end after it starts")
        if end - start > timedelta(days=MAX_RANGE_DAYS):
            raise ValueError(f"The range can be at most {MAX_RANGE_DAYS} days")

        org_id = str(organization_id)
        events = list(
            (
                await self.db.execute(
                    select(Event)
                    .where(
                        Event.organization_id == org_id,
                        outreach_event_clause(org_id),
                        Event.start_datetime < end,
                        Event.end_datetime > start,
                    )
                    .order_by(Event.start_datetime, Event.id)
                    .limit(MAX_ROWS)
                )
            )
            .scalars()
            .all()
        )
        if not events:
            return []
        event_ids = [str(e.id) for e in events]

        requests: dict[str, EventRequest] = {}
        for request in (
            (
                await self.db.execute(
                    select(EventRequest)
                    .where(
                        EventRequest.organization_id == org_id,
                        EventRequest.event_id.in_(event_ids),
                    )
                    .order_by(EventRequest.created_at)
                )
            )
            .scalars()
            .all()
        ):
            # One request per event in practice; if two were ever linked, the
            # first one is the event's origin and the one its page links to.
            requests.setdefault(str(request.event_id), request)

        # Whichever owns the sheet: the request an event was scheduled from
        # keeps it there, an event created directly keeps its own.
        owners: dict[str, Union[EventRequest, Event]] = {
            str(e.id): requests.get(str(e.id), e) for e in events
        }
        sheets = await staffing_counts_by_request(
            db=self.db, organization_id=org_id, requests=owners.values()
        )

        planned = set(
            (
                await self.db.execute(
                    select(EventApparatusPlan.event_id).where(
                        EventApparatusPlan.organization_id == org_id,
                        EventApparatusPlan.event_id.in_(event_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        crew_counts, units = await ApparatusEventService(self.db).crew_summary(
            org_id, [eid for eid in event_ids if eid in planned]
        )

        location_ids = {str(e.location_id) for e in events if e.location_id}
        location_names: dict[str, str] = {}
        if location_ids:
            location_names = {
                str(lid): name
                for lid, name in (
                    await self.db.execute(
                        select(Location.id, Location.name).where(
                            Location.organization_id == org_id,
                            Location.id.in_(location_ids),
                        )
                    )
                ).all()
            }

        rows = []
        for event in events:
            eid = str(event.id)
            request = requests.get(eid)
            sheet = sheets.get(str(owners[eid].id))
            crew: Optional[tuple[int, int]] = (
                crew_counts.get(eid, (0, 0)) if eid in planned else None
            )
            event_type = getattr(event.event_type, "value", str(event.event_type))
            rows.append(
                {
                    "event_id": eid,
                    "title": event.title,
                    "event_type": event_type,
                    "start_datetime": as_utc(event.start_datetime),
                    "end_datetime": as_utc(event.end_datetime),
                    "location": (
                        location_names.get(str(event.location_id))
                        if event.location_id
                        else None
                    )
                    or event.location,
                    "is_draft": bool(event.is_draft),
                    "request_id": str(request.id) if request else None,
                    "request_organization": (
                        request.organization_name if request else None
                    ),
                    "volunteers_filled": sheet[0] if sheet else None,
                    "volunteers_total": sheet[1] if sheet else None,
                    "crew_filled": crew[0] if crew else None,
                    "crew_total": crew[1] if crew else None,
                    "unit_numbers": units.get(eid, []),
                    "attendance_finalized": attendance_is_finalized(event),
                }
            )
        return rows
