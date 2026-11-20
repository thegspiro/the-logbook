"""An apparatus crew on an event that already exists — a public request's
calendar entry in particular.

The crew rides on the request's own event, so the request has one calendar
entry, not two; a request can carry a crew and a volunteer signup sheet at
once; and attaching is refused where a crew cannot sensibly go.
"""

import json
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import AdminHoursEntry
from app.models.apparatus_event import EventApparatusPlan, EventApparatusSeat
from app.models.event import Event, EventRSVP, EventType
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestStatus,
)
from app.models.user import User
from app.services.admin_hours_service import AdminHoursService
from app.services.apparatus_event_service import ConflictsNotAcknowledged
from tests.test_apparatus_event_service import (
    FUTURE,
    _scheduled,
    _seat,
    _template_body,
    _world,
)

pytestmark = pytest.mark.integration


async def _event(db: AsyncSession, w, **overrides) -> Event:
    fields = {
        "id": str(uuid.uuid4()),
        "organization_id": w.org.id,
        "title": "Oakwood Elementary — holiday visit",
        "event_type": EventType.PUBLIC_EDUCATION,
        "location": "400 block of Maple Street",
        "start_datetime": FUTURE + timedelta(days=40),
        "end_datetime": FUTURE + timedelta(days=40, hours=1),
    }
    fields.update(overrides)
    event = Event(**fields)
    db.add(event)
    await db.flush()
    return event


async def _template(w):
    return await w.service.create_template(
        _template_body(w), w.org.id, w.coordinator.id
    )


class TestAttachingToAnExistingEvent:
    async def test_the_event_keeps_its_own_identity_and_gains_the_seats(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        event = await _event(db_session, w)
        template = await _template(w)
        events_before = await db_session.scalar(select(func.count(Event.id)))

        plan = await w.service.attach_template(
            event.id, template.id, w.org.id, acknowledge_conflicts=False
        )
        await db_session.commit()

        assert plan is not None
        refreshed = await db_session.get(Event, event.id)
        assert refreshed.title == "Oakwood Elementary — holiday visit"
        assert refreshed.location == "400 block of Maple Street"
        # No second calendar entry for the same visit.
        assert await db_session.scalar(select(func.count(Event.id))) == events_before
        seats = await db_session.scalar(
            select(func.count(EventApparatusSeat.id)).where(
                EventApparatusSeat.event_id == event.id
            )
        )
        assert seats == 4

    async def test_the_crew_is_credited_to_the_templates_category(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        event = await _event(db_session, w)
        template = await _template(w)
        await w.service.attach_template(
            event.id, template.id, w.org.id, acknowledge_conflicts=False
        )
        rsvp = EventRSVP(
            id=str(uuid.uuid4()),
            organization_id=w.org.id,
            event_id=event.id,
            user_id=w.santa.id,
            checked_in=True,
        )
        db_session.add(rsvp)
        await db_session.flush()

        await AdminHoursService(db_session).credit_event_attendance(
            organization_id=w.org.id,
            user_id=w.santa.id,
            event_id=event.id,
            rsvp_id=rsvp.id,
            event_title=event.title,
            check_in_at=event.start_datetime,
            check_out_at=event.end_datetime,
            duration_minutes=60,
            event_type=EventType.PUBLIC_EDUCATION.value,
            custom_category=None,
        )

        categories = (
            await db_session.execute(
                select(AdminHoursEntry.category_id).where(
                    AdminHoursEntry.source_event_id == event.id
                )
            )
        ).scalars()
        assert list(categories) == [w.outreach.id]

    async def test_a_second_crew_is_refused(self, db_session: AsyncSession):
        w = await _world(db_session)
        event = await _event(db_session, w)
        template = await _template(w)
        await w.service.attach_template(
            event.id, template.id, w.org.id, acknowledge_conflicts=False
        )

        with pytest.raises(ValueError, match="already has an apparatus crew"):
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=False
            )

    async def test_a_training_event_is_refused(self, db_session: AsyncSession):
        w = await _world(db_session)
        event = await _event(db_session, w, event_type=EventType.TRAINING)
        template = await _template(w)

        with pytest.raises(ValueError, match="Training event"):
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=False
            )

    async def test_a_cancelled_event_is_refused(self, db_session: AsyncSession):
        w = await _world(db_session)
        event = await _event(db_session, w, is_cancelled=True)
        template = await _template(w)

        with pytest.raises(ValueError, match="cancelled"):
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=False
            )

    async def test_an_overlapping_night_waits_for_acknowledgement(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        template, _series, (night_id,) = await _scheduled(w, db_session)
        night = await db_session.get(Event, night_id)
        event = await _event(
            db_session,
            w,
            start_datetime=night.start_datetime,
            end_datetime=night.end_datetime,
        )

        with pytest.raises(ConflictsNotAcknowledged):
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=False
            )
        assert (
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=True
            )
            is not None
        )

    async def test_another_departments_event_is_out_of_reach(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        other = await _world(db_session)
        event = await _event(db_session, other)
        template = await _template(w)

        assert (
            await w.service.attach_template(
                event.id, template.id, w.org.id, acknowledge_conflicts=False
            )
            is None
        )


class TestRemovingACrew:
    async def test_an_empty_crew_comes_off_and_the_event_stays(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        event = await _event(db_session, w)
        template = await _template(w)
        await w.service.attach_template(
            event.id, template.id, w.org.id, acknowledge_conflicts=False
        )
        await db_session.commit()

        assert await w.service.remove_plan(event.id, w.org.id) is True

        assert await db_session.get(Event, event.id) is not None
        assert (
            await db_session.scalar(
                select(func.count(EventApparatusPlan.id)).where(
                    EventApparatusPlan.event_id == event.id
                )
            )
            == 0
        )

    async def test_a_crew_with_someone_in_a_seat_is_kept(
        self, db_session: AsyncSession
    ):
        w = await _world(db_session)
        _t, _s, (night_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, night_id, "Santa")
        await w.service.claim_seat(night_id, santa.id, w.org.id, w.santa)

        with pytest.raises(ValueError, match="already has a seat"):
            await w.service.remove_plan(night_id, w.org.id)


# ---------------------------------------------------------------------------
# The request pipeline, over HTTP
# ---------------------------------------------------------------------------


@pytest.fixture
async def bench(db_session: AsyncSession):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import event_requests
    from app.core.database import get_db

    w = await _world(db_session)
    event = await _event(db_session, w)
    request = EventRequest(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        contact_name="M. Torres",
        contact_email="pta@example.test",
        description="A holiday visit for 320 students",
        status=EventRequestStatus.SCHEDULED,
        event_id=event.id,
        event_date=event.start_datetime,
    )
    db_session.add(request)
    template = await _template(w)
    await db_session.commit()
    ids = {
        "org": w.org.id,
        "coordinator": w.coordinator.id,
        "request": request.id,
        "event": event.id,
        "template": template.id,
    }
    holder: dict = {}

    async def get_session_like():
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    async def act_as(*permissions: str) -> None:
        position_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": ids["org"],
                "name": f"Bench {position_id[:6]}",
                "slug": f"bench_{position_id[:6]}",
                "perms": json.dumps(list(permissions)),
            },
        )
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"),
            {"u": ids["coordinator"]},
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": ids["coordinator"], "p": position_id},
        )
        await db_session.commit()
        user = await db_session.get(User, ids["coordinator"])
        await db_session.refresh(user, ["positions"])
        holder["user"] = user

    app = FastAPI()
    app.include_router(event_requests.router)
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, act_as, ids


class TestTheRequestPipeline:
    async def test_a_coordinator_puts_a_crew_on_the_requests_own_event(
        self, bench, db_session: AsyncSession
    ):
        client, act_as, ids = bench
        await act_as("events.manage", "apparatus_events.manage")

        response = await client.post(
            f"/event-requests/{ids['request']}/apparatus-crew",
            json={"template_id": ids["template"]},
        )

        assert response.status_code == 201, response.text
        assert response.json()["event_id"] == ids["event"]
        activity = await db_session.scalar(
            select(EventRequestActivity).where(
                EventRequestActivity.request_id == ids["request"],
                EventRequestActivity.action == "apparatus_crew_attached",
            )
        )
        assert activity is not None
        assert "Santamobile — Full" in activity.notes

    async def test_both_permissions_are_needed(self, bench):
        client, act_as, ids = bench
        await act_as("apparatus_events.manage")

        response = await client.post(
            f"/event-requests/{ids['request']}/apparatus-crew",
            json={"template_id": ids["template"]},
        )

        assert response.status_code == 403

    async def test_an_unscheduled_request_is_refused(
        self, bench, db_session: AsyncSession
    ):
        client, act_as, ids = bench
        await db_session.execute(
            text("UPDATE event_requests SET status = 'in_progress' WHERE id = :id"),
            {"id": ids["request"]},
        )
        await db_session.commit()
        # The row changed underneath the session; drop what it had cached.
        db_session.expire_all()
        await act_as("events.manage", "apparatus_events.manage")

        response = await client.post(
            f"/event-requests/{ids['request']}/apparatus-crew",
            json={"template_id": ids["template"]},
        )

        assert response.status_code == 400
        assert "Confirm a date" in response.json()["detail"]

    async def test_a_request_without_a_calendar_event_is_refused(
        self, bench, db_session: AsyncSession
    ):
        client, act_as, ids = bench
        await db_session.execute(
            text("UPDATE event_requests SET event_id = NULL WHERE id = :id"),
            {"id": ids["request"]},
        )
        await db_session.commit()
        # The row changed underneath the session; drop what it had cached.
        db_session.expire_all()
        await act_as("events.manage", "apparatus_events.manage")

        response = await client.post(
            f"/event-requests/{ids['request']}/apparatus-crew",
            json={"template_id": ids["template"]},
        )

        assert response.status_code == 400
        assert "no calendar event" in response.json()["detail"]
