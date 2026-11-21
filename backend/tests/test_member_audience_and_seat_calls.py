"""Choosing which members an email goes to, and the open-seat email for an
apparatus run (owner decisions of 2026-11-20).

The picker narrows by member class, membership status and positions; within a
filter any match counts, across filters every one must. Only current members
with an address are emailed, and the Volunteer calls opt-out applies.
"""

import json
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apparatus_event import ApparatusEventSeatCall
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.user import Organization, Position, User
from app.services.apparatus_seat_call_service import (
    ApparatusSeatCallService,
    SeatCallNotSent,
)
from app.services.member_audience import (
    AudienceFilter,
    audience_options,
    resolve_audience,
)
from tests.clock_support import reread_each_test
from tests.test_apparatus_event_service import (
    _clock,
    _night,
    _scheduled,
    _seat,
    _user,
    _world,
)

pytestmark = pytest.mark.integration

# The helpers imported above read FUTURE from their own module, so it is
# refreshed there as well as here.
(FUTURE,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)
_reread_service_clock = reread_each_test("tests.test_apparatus_event_service", _clock)

SEND = "app.services.email_service.EmailService.send_email"


async def _set(db: AsyncSession, user: User, **columns) -> None:
    """Write membership columns as raw SQL, bypassing the reconcile listener,
    so a test can hold exactly the stored state it names."""
    assignments = ", ".join(f"{name} = :{name}" for name in columns)
    await db.execute(
        text(f"UPDATE users SET {assignments} WHERE id = :id"),
        {**columns, "id": user.id},
    )
    await db.refresh(user)


async def _position(db: AsyncSession, org: Organization, name: str) -> Position:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        slug=f"{name.lower()}_{uuid.uuid4().hex[:6]}",
        permissions=[],
    )
    db.add(position)
    await db.flush()
    return position


async def _hold(db: AsyncSession, user: User, position: Position) -> None:
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user.id, "p": position.id},
    )


async def _emails(db, w, audience=AudienceFilter()) -> set[str]:
    result = await resolve_audience(db, w.org, w.org.id, audience)
    return set(result.emails)


class TestWhoIsEmailed:
    async def test_no_choice_reaches_every_current_member(self, db_session):
        w = await _world(db_session)
        away = await _user(db_session, w.org, "away")
        await db_session.flush()
        await _set(db_session, away, status="leave")

        emails = await _emails(db_session, w)

        everyone = {
            m.email for m in (w.coordinator, w.santa, w.elf, w.driver, w.rookie)
        }
        assert emails == everyone

    async def test_a_probationary_account_is_a_current_member(self, db_session):
        w = await _world(db_session)
        await _set(db_session, w.rookie, status="probationary")

        assert w.rookie.email in await _emails(db_session, w)

    async def test_classes_narrow_by_any_match(self, db_session):
        w = await _world(db_session)
        await _set(db_session, w.elf, member_class="administrative")
        await _set(db_session, w.santa, member_class="social")

        emails = await _emails(
            db_session, w, AudienceFilter(member_classes=("administrative", "social"))
        )

        assert emails == {w.elf.email, w.santa.email}

    async def test_status_is_read_the_way_the_rest_of_the_app_reads_it(
        self, db_session
    ):
        w = await _world(db_session)
        await _set(db_session, w.santa, member_status="life")
        # Written before member_status existed: the standing is in the legacy
        # field, and a raw-column filter would miss this member.
        await _set(db_session, w.elf, member_status=None, membership_type="life")
        # Nothing recorded at all stands on the regular rung.
        await _set(db_session, w.driver, member_status=None, membership_type=None)

        life = await _emails(db_session, w, AudienceFilter(member_statuses=("life",)))
        regular = await _emails(
            db_session, w, AudienceFilter(member_statuses=("regular",))
        )

        assert life == {w.santa.email, w.elf.email}
        assert w.driver.email in regular

    async def test_filters_combine_so_every_one_must_match(self, db_session):
        w = await _world(db_session)
        lieutenant = await _position(db_session, w.org, "Lieutenant")
        await _hold(db_session, w.driver, lieutenant)
        await _hold(db_session, w.santa, lieutenant)
        await _set(db_session, w.santa, member_status="life")

        emails = await _emails(
            db_session,
            w,
            AudienceFilter(member_statuses=("regular",), position_ids=(lieutenant.id,)),
        )

        assert emails == {w.driver.email}

    async def test_an_opted_out_member_is_counted_not_emailed(self, db_session):
        w = await _world(db_session)
        await _set(
            db_session,
            w.elf,
            notification_preferences=json.dumps(
                {"email_kinds": {"volunteer_calls": False}}
            ),
        )

        result = await resolve_audience(db_session, w.org, w.org.id, AudienceFilter())

        assert w.elf.email not in result.emails
        assert result.skipped_opted_out == 1

    async def test_another_departments_position_is_refused(self, db_session):
        w = await _world(db_session)
        other = await _world(db_session)
        theirs = await _position(db_session, other.org, "Captain")

        with pytest.raises(ValueError, match="not in this department"):
            await _emails(db_session, w, AudienceFilter(position_ids=(theirs.id,)))

    async def test_an_unknown_class_is_refused(self, db_session):
        w = await _world(db_session)

        with pytest.raises(ValueError, match="member classes"):
            await _emails(db_session, w, AudienceFilter(member_classes=("captain",)))


class TestWhatThePickerOffers:
    async def test_the_departments_own_tiers_and_positions(self, db_session):
        w = await _world(db_session)
        w.org.settings = {
            "membership_tiers": {
                "tiers": [
                    {"id": "active", "name": "Active", "sort_order": 1},
                    {"id": "senior", "name": "Senior", "sort_order": 2},
                ]
            }
        }
        await _position(db_session, w.org, "Lieutenant")
        other = await _world(db_session)
        await _position(db_session, other.org, "Not Ours")

        options = await audience_options(db_session, w.org, w.org.id)

        statuses = {s["value"]: s["label"] for s in options["member_statuses"]}
        assert statuses["senior"] == "Senior"
        assert "prospective" not in statuses
        # "active" is the regular rung, already offered under that name.
        assert "active" not in statuses
        names = [p["name"] for p in options["positions"]]
        assert "Lieutenant" in names
        assert "Not Ours" not in names


class TestTheOpenSeatEmail:
    async def test_lists_upcoming_nights_with_a_seat_a_member_can_take(
        self, db_session
    ):
        w = await _world(db_session)
        _t, series_id, (first, full, open_) = await _scheduled(
            w, db_session, nights=[_night(0), _night(2), _night(4)]
        )
        for name, index in (("Driver", 0), ("Santa", 0), ("Elf", 0), ("Elf", 1)):
            crew = await _user(db_session, w.org, f"crew{uuid.uuid4().hex[:4]}")
            await db_session.flush()
            seat = await _seat(w, full, name, index)
            seat.user_id = crew.id
        await db_session.flush()

        nights = await ApparatusSeatCallService(db_session).open_nights(
            series_id, w.org.id
        )

        assert [n.event_id for n in nights] == [first, open_]
        assert nights[0].units[0][1] == "Driver (needs EVOC 3), Santa, Elf × 2"

    async def test_a_night_without_self_signup_or_already_started_is_left_out(
        self, db_session
    ):
        w = await _world(db_session)
        _t, series_id, (only,) = await _scheduled(
            w, db_session, allow_self_signup=False
        )
        service = ApparatusSeatCallService(db_session)

        assert await service.open_nights(series_id, w.org.id) == []
        assert (
            await service.open_nights(
                series_id, w.org.id, now=FUTURE + timedelta(days=30)
            )
            == []
        )

    async def test_a_send_emails_the_chosen_members_and_is_recorded(self, db_session):
        w = await _world(db_session)
        _t, series_id, (event_id,) = await _scheduled(w, db_session)
        await _set(db_session, w.santa, member_class="social")
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send):
            result = await ApparatusSeatCallService(db_session).send(
                event_id,
                w.org,
                w.org.id,
                w.coordinator.id,
                AudienceFilter(member_classes=("social",)),
                "Bring a warm coat",
                "https://logbook.example",
            )

        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == [w.santa.email]
        assert f"https://logbook.example/events/{event_id}" in kwargs["html_body"]
        assert "Bring a warm coat" in kwargs["text_body"]
        assert result["recipients"] == 1
        assert result["nights_listed"] == 1
        call = (
            await db_session.execute(
                select(ApparatusEventSeatCall).where(
                    ApparatusEventSeatCall.series_id == series_id
                )
            )
        ).scalar_one()
        assert call.recipients == 1
        assert call.audience["member_classes"] == ["social"]
        last = await ApparatusSeatCallService(db_session).last_call(series_id, w.org.id)
        assert last["recipients"] == 1
        assert last["sent_by_name"] == "Coordinator Tester"

    async def test_nothing_delivered_records_nothing(self, db_session):
        w = await _world(db_session)
        _t, series_id, (event_id,) = await _scheduled(w, db_session)

        with patch(SEND, AsyncMock(return_value=(0, 5))):
            with pytest.raises(SeatCallNotSent):
                await ApparatusSeatCallService(db_session).send(
                    event_id,
                    w.org,
                    w.org.id,
                    w.coordinator.id,
                    AudienceFilter(),
                    None,
                    "https://logbook.example",
                )

        count = await db_session.scalar(
            select(func.count(ApparatusEventSeatCall.id)).where(
                ApparatusEventSeatCall.series_id == series_id
            )
        )
        assert count == 0

    async def test_no_open_night_is_refused_before_anyone_is_emailed(self, db_session):
        w = await _world(db_session)
        _t, _series, (event_id,) = await _scheduled(
            w, db_session, allow_self_signup=False
        )
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send), pytest.raises(ValueError, match="nothing to ask"):
            await ApparatusSeatCallService(db_session).send(
                event_id,
                w.org,
                w.org.id,
                w.coordinator.id,
                AudienceFilter(),
                None,
                "https://logbook.example",
            )
        send.assert_not_awaited()


@pytest.fixture
async def bench(db_session: AsyncSession):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import apparatus_events, event_requests, member_audience
    from app.core.database import get_db

    w = await _world(db_session)
    _t, series_id, (event_id,) = await _scheduled(w, db_session)
    request = EventRequest(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        contact_name="M. Torres",
        contact_email="pta@example.test",
        description="A station tour",
        status=EventRequestStatus.SCHEDULED,
        event_date=FUTURE + timedelta(days=40),
    )
    db_session.add(request)
    await db_session.commit()
    ids = {
        "org": w.org.id,
        "coordinator": w.coordinator.id,
        "santa": w.santa.id,
        "santa_email": w.santa.email,
        "event": event_id,
        "series": series_id,
        "request": request.id,
    }
    holder: dict = {}

    async def get_session_like():
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    async def act_as(member: str, *permissions: str) -> None:
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
            text("DELETE FROM user_positions WHERE user_id = :u"), {"u": ids[member]}
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": ids[member], "p": position_id},
        )
        await db_session.commit()
        user = await db_session.get(User, ids[member])
        await db_session.refresh(user, ["positions"])
        holder["user"] = user

    app = FastAPI()
    app.include_router(apparatus_events.router, prefix="/apparatus-events")
    app.include_router(member_audience.router, prefix="/member-audience")
    app.include_router(event_requests.router)
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, act_as, ids, db_session


class TestOverHttp:
    async def test_a_coordinator_sends_and_the_board_shows_it(self, bench):
        client, act_as, ids, db = bench
        await act_as("coordinator", "apparatus_events.manage", "events.view")

        with patch(SEND, AsyncMock(return_value=(4, 0))):
            sent = await client.post(
                f"/apparatus-events/events/{ids['event']}/seat-call",
                json={"member_classes": ["operational"], "message": "  "},
            )
        board = await client.get(f"/apparatus-events/events/{ids['event']}")

        assert sent.status_code == 200, sent.text
        assert sent.json()["nights_listed"] == 1
        assert board.json()["last_seat_call"]["recipients"] == 4

    async def test_a_member_cannot_send_or_see_the_last_send(self, bench):
        client, act_as, ids, db = bench
        await act_as("coordinator", "apparatus_events.manage", "events.view")
        with patch(SEND, AsyncMock(return_value=(4, 0))):
            await client.post(
                f"/apparatus-events/events/{ids['event']}/seat-call", json={}
            )
        await act_as("santa", "apparatus_events.signup", "events.view")

        # The board first: a refused request rolls the shared test session
        # back, which expires the acting member.
        board = await client.get(f"/apparatus-events/events/{ids['event']}")
        refused = await client.post(
            f"/apparatus-events/events/{ids['event']}/seat-call", json={}
        )

        assert refused.status_code == 403
        assert board.json()["last_seat_call"] is None

    async def test_email_not_set_up_answers_503_with_a_sentence(self, bench):
        client, act_as, ids, db = bench
        await act_as("coordinator", "apparatus_events.manage", "events.view")

        with patch(SEND, AsyncMock(return_value=(0, 5))):
            response = await client.post(
                f"/apparatus-events/events/{ids['event']}/seat-call", json={}
            )

        assert response.status_code == 503
        assert "No email went out" in response.json()["detail"]

    async def test_the_picker_options_and_count_need_an_events_permission(self, bench):
        client, act_as, ids, db = bench
        await act_as("santa", "events.view")
        assert (await client.get("/member-audience/options")).status_code == 403

        await act_as("coordinator", "events.manage")
        options = await client.get("/member-audience/options")
        preview = await client.post(
            "/member-audience/preview", json={"member_classes": ["operational"]}
        )

        assert options.status_code == 200
        assert options.json()["member_classes"] == [
            "operational",
            "administrative",
            "social",
        ]
        assert preview.status_code == 200
        assert preview.json()["recipients"] >= 1

    async def test_the_volunteer_call_uses_the_same_choices(self, bench):
        client, act_as, ids, db = bench
        await db.execute(
            text("UPDATE users SET member_class = 'social' WHERE id = :id"),
            {"id": ids["santa"]},
        )
        await db.commit()
        db.expire_all()
        await act_as("coordinator", "events.manage")
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send):
            response = await client.post(
                f"/event-requests/{ids['request']}/volunteer-call",
                json={"member_classes": ["social"]},
            )

        assert response.status_code == 200, response.text
        assert send.await_args.kwargs["to_emails"] == [ids["santa_email"]]

    async def test_the_volunteer_calls_legacy_filter_still_works(self, bench):
        client, act_as, ids, db = bench
        await db.execute(
            text(
                "UPDATE users SET membership_type = 'honorary', "
                "member_status = 'honorary' WHERE id = :id"
            ),
            {"id": ids["santa"]},
        )
        await db.commit()
        db.expire_all()
        await act_as("coordinator", "events.manage")
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send):
            response = await client.post(
                f"/event-requests/{ids['request']}/volunteer-call",
                json={"membership_types": ["honorary"]},
            )

        assert response.status_code == 200, response.text
        assert send.await_args.kwargs["to_emails"] == [ids["santa_email"]]
