"""Coordinator approval of self sign-ups on apparatus nights (owner decisions
of 2026-11-23).

With approval on, Sign me up asks for the seat instead of taking it. The seat
stays open while requests wait, so several members can ask for one; approving
one seats that member and declines the rest. A request nobody answers lapses
when the night starts. The organizer and alternate are emailed each request,
and the member is emailed the answer.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.apparatus_event import (
    ApparatusEventSeatRequest,
    EventApparatusPlan,
)
from app.models.event import EventRSVP
from app.models.user import Position, User
from app.schemas.apparatus_event import NightPlanUpdate
from app.services.apparatus_event_service import (
    NOTE_NIGHT_CANCELLED,
    NOTE_NIGHT_STARTED,
    NOTE_SEAT_REMOVED,
    NOTE_SEAT_TAKEN,
)
from app.services.apparatus_seat_request_notices import deliver
from tests.clock_support import reread_each_test
from tests.test_apparatus_event_service import (
    _clock,
    _Http,
    _night,
    _scheduled,
    _seat,
    _world,
)

pytestmark = pytest.mark.integration

(FUTURE,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)
_reread_service_clock = reread_each_test("tests.test_apparatus_event_service", _clock)

SEND = "app.services.email_service.EmailService.send_email"


@pytest.fixture
async def bench(db_session: AsyncSession):
    """The seats module's HTTP harness (``_Http``) over the endpoints router."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.api.v1.endpoints import apparatus_events as endpoints
    from app.core.database import get_db

    w = await _world(db_session)
    await db_session.commit()
    w.ids = {
        name: getattr(w, name).id for name in ("coordinator", "santa", "elf", "org")
    }
    holder: dict = {}

    async def get_session_like():
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/apparatus-events")
    app.dependency_overrides[get_current_user] = lambda: holder["user"]
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Http(db_session, w, client, holder)


async def _approval_night(w, db: AsyncSession, **overrides):
    _t, _s, (event_id,) = await _scheduled(
        w, db, require_signup_approval=True, **overrides
    )
    return event_id


async def _requests(db: AsyncSession, event_id: str):
    return list(
        (
            await db.execute(
                select(ApparatusEventSeatRequest)
                .where(ApparatusEventSeatRequest.event_id == event_id)
                .order_by(ApparatusEventSeatRequest.requested_at)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )


async def _rsvp(db: AsyncSession, event_id: str, user_id: str):
    return await db.scalar(
        select(EventRSVP).where(
            EventRSVP.event_id == event_id, EventRSVP.user_id == user_id
        )
    )


async def _grant_manage(db: AsyncSession, w, user: User) -> None:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=w.org.id,
        name=f"Outreach {uuid.uuid4().hex[:6]}",
        slug=f"outreach_{uuid.uuid4().hex[:6]}",
        permissions=["apparatus_events.manage"],
    )
    db.add(position)
    await db.flush()
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user.id, "p": position.id},
    )
    await db.flush()


class TestTheSetting:
    async def test_a_night_copies_it_from_the_template(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)

        plan = await db_session.scalar(
            select(EventApparatusPlan).where(EventApparatusPlan.event_id == event_id)
        )
        assert plan.require_signup_approval is True

    async def test_it_is_off_unless_chosen(self, db_session):
        w = await _world(db_session)
        _t, _s, (event_id,) = await _scheduled(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        outcome = await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        assert outcome.requested is False
        assert (await _seat(w, event_id, "Santa")).user_id == w.santa.id
        assert await _requests(db_session, event_id) == []

    async def test_saving_a_night_without_the_field_leaves_it_alone(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        _event, plan = await w.service.get_night(event_id, w.org.id)
        body = {
            "evoc_mode": "enforce",
            "allow_self_signup": True,
            "show_on_schedule": True,
            "admin_hours_category_id": w.outreach.id,
            "units": [
                {
                    "id": u.id,
                    "apparatus_id": u.apparatus_id,
                    "seats": [
                        {"id": s.id, "name": s.name, "seat_type": s.seat_type}
                        for s in u.seats
                    ],
                }
                for u in plan.units
            ],
        }

        await w.service.update_night_plan(event_id, NightPlanUpdate(**body), w.org.id)
        _event, plan = await w.service.get_night(event_id, w.org.id)
        assert plan.require_signup_approval is True

        body["require_signup_approval"] = False
        await w.service.update_night_plan(event_id, NightPlanUpdate(**body), w.org.id)
        _event, plan = await w.service.get_night(event_id, w.org.id)
        assert plan.require_signup_approval is False


class TestAsking:
    async def test_signing_up_asks_and_leaves_the_seat_open(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        outcome = await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        assert outcome.requested is True
        assert (await _seat(w, event_id, "Santa")).user_id is None
        (request,) = await _requests(db_session, event_id)
        assert (request.status, request.user_id) == ("pending", w.santa.id)
        assert w.service.new_request_ids == [request.id]
        # Not going until a coordinator says yes.
        assert await _rsvp(db_session, event_id, w.santa.id) is None

    async def test_several_members_can_ask_for_one_seat(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.elf)

        requests = await _requests(db_session, event_id)
        # Both asked within the same second, and requested_at is stored to the
        # second, so which one lists first is not defined; both waiting is.
        assert {r.user_id for r in requests} == {w.santa.id, w.elf.id}
        assert {r.status for r in requests} == {"pending"}

    async def test_asking_twice_for_one_seat_changes_nothing(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")

        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        again = await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        assert again.requested is True
        assert len(await _requests(db_session, event_id)) == 1

    async def test_one_waiting_request_per_member_per_night(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        elf = await _seat(w, event_id, "Elf")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        with pytest.raises(ValueError, match="Withdraw that request first"):
            await w.service.claim_seat(event_id, elf.id, w.org.id, w.santa)

    async def test_the_database_refuses_a_second_waiting_request(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        elf = await _seat(w, event_id, "Elf")
        for seat in (santa, elf):
            db_session.add(
                ApparatusEventSeatRequest(
                    organization_id=w.org.id,
                    event_id=event_id,
                    seat_id=seat.id,
                    user_id=w.santa.id,
                    status="pending",
                    pending_user_id=w.santa.id,
                )
            )
        with pytest.raises(IntegrityError):
            await db_session.flush()

    async def test_the_driver_seat_rule_applies_before_asking(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        driver = await _seat(w, event_id, "Driver")

        with pytest.raises(ValueError, match="EVOC"):
            await w.service.claim_seat(event_id, driver.id, w.org.id, w.rookie)
        assert await _requests(db_session, event_id) == []


class TestAnswering:
    async def test_approving_seats_the_member_and_declines_the_rest(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.elf)
        by_user = {r.user_id: r for r in await _requests(db_session, event_id)}
        first = by_user[w.santa.id]

        await w.service.approve_request(event_id, first.id, w.org.id, w.coordinator)

        seat = await _seat(w, event_id, "Santa")
        assert (seat.user_id, seat.assignment_method, seat.assigned_by) == (
            w.santa.id,
            "self_signup",
            w.coordinator.id,
        )
        assert (await _rsvp(db_session, event_id, w.santa.id)).status.value == "going"
        by_user = {r.user_id: r for r in await _requests(db_session, event_id)}
        first, second = by_user[w.santa.id], by_user[w.elf.id]
        assert (first.status, first.decided_by) == ("approved", w.coordinator.id)
        assert (second.status, second.decision_note) == ("declined", NOTE_SEAT_TAKEN)
        assert first.pending_user_id is None
        assert second.pending_user_id is None
        assert sorted((d.user_id, d.status) for d in w.service.decisions) == sorted(
            [(w.santa.id, "approved"), (w.elf.id, "declined")]
        )

    async def test_an_answered_request_cannot_be_answered_again(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        (request,) = await _requests(db_session, event_id)
        await w.service.decline_request(
            event_id, request.id, w.org.id, w.coordinator, "Santa is booked."
        )

        with pytest.raises(ValueError, match="already been answered"):
            await w.service.approve_request(
                event_id, request.id, w.org.id, w.coordinator
            )
        (request,) = await _requests(db_session, event_id)
        assert (request.status, request.decision_note) == (
            "declined",
            "Santa is booked.",
        )
        assert (await _seat(w, event_id, "Santa")).user_id is None

    async def test_a_seat_filled_meanwhile_is_not_overwritten(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        (request,) = await _requests(db_session, event_id)
        await db_session.execute(
            text("UPDATE event_apparatus_seats SET user_id = :u WHERE id = :s"),
            {"u": w.elf.id, "s": santa.id},
        )

        with pytest.raises(ValueError, match="already filled"):
            await w.service.approve_request(
                event_id, request.id, w.org.id, w.coordinator
            )

    async def test_a_member_withdraws_only_their_own(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        (request,) = await _requests(db_session, event_id)

        assert (
            await w.service.withdraw_request(event_id, request.id, w.org.id, w.elf)
            is None
        )
        await w.service.withdraw_request(event_id, request.id, w.org.id, w.santa)

        (request,) = await _requests(db_session, event_id)
        assert request.status == "withdrawn"
        # Withdrawing is the member's own act: nobody is emailed about it.
        assert w.service.decisions == []

    async def test_another_departments_request_is_not_found(self, db_session):
        w = await _world(db_session)
        other = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        (request,) = await _requests(db_session, event_id)

        assert (
            await other.service.approve_request(
                event_id, request.id, other.org.id, other.coordinator
            )
            is None
        )


class TestOtherWaysASeatChanges:
    async def test_assigning_the_seat_declines_who_was_waiting(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        elf = await _seat(w, event_id, "Elf")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.elf)

        await w.service.assign_seat(event_id, elf.id, w.elf.id, w.org.id, w.coordinator)
        await w.service.assign_seat(
            event_id, santa.id, w.driver.id, w.org.id, w.coordinator
        )

        by_user = {r.user_id: r for r in await _requests(db_session, event_id)}
        assert by_user[w.elf.id].status == "declined"
        assert by_user[w.elf.id].decision_note == (
            "The coordinator gave you the Elf seat instead."
        )
        assert (by_user[w.santa.id].status, by_user[w.santa.id].decision_note) == (
            "declined",
            NOTE_SEAT_TAKEN,
        )

    async def test_removing_the_seat_declines_who_was_waiting(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        elf = await _seat(w, event_id, "Elf", 1)
        await w.service.claim_seat(event_id, elf.id, w.org.id, w.elf)
        _event, plan = await w.service.get_night(event_id, w.org.id)
        body = NightPlanUpdate(
            evoc_mode="enforce",
            allow_self_signup=True,
            show_on_schedule=True,
            admin_hours_category_id=w.outreach.id,
            units=[
                {
                    "id": u.id,
                    "apparatus_id": u.apparatus_id,
                    "seats": [
                        {"id": s.id, "name": s.name, "seat_type": s.seat_type}
                        for s in u.seats
                        if s.id != elf.id
                    ],
                }
                for u in plan.units
            ],
        )

        await w.service.update_night_plan(event_id, body, w.org.id)

        assert [(d.user_id, d.note) for d in w.service.decisions] == [
            (w.elf.id, NOTE_SEAT_REMOVED)
        ]
        assert await _requests(db_session, event_id) == []

    async def test_with_approval_switched_off_a_sign_up_takes_the_seat(
        self, db_session
    ):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        santa = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, santa.id, w.org.id, w.elf)
        await db_session.execute(
            text(
                "UPDATE event_apparatus_plans SET require_signup_approval = 0 "
                "WHERE event_id = :e"
            ),
            {"e": event_id},
        )

        await w.service.claim_seat(event_id, santa.id, w.org.id, w.santa)

        assert (await _seat(w, event_id, "Santa")).user_id == w.santa.id
        (request,) = await _requests(db_session, event_id)
        assert (request.status, request.decision_note) == ("declined", NOTE_SEAT_TAKEN)


class TestLapsing:
    async def _start_now(self, db, event_id, **columns):
        sets = ", ".join(
            ["start_datetime = UTC_TIMESTAMP() - INTERVAL 5 MINUTE"]
            if not columns
            else [f"{k} = :{k}" for k in columns]
        )
        await db.execute(
            text(f"UPDATE events SET {sets} WHERE id = :id"),
            {**columns, "id": event_id},
        )

    async def test_a_request_unanswered_at_the_start_lapses_once(self, db_session):
        w = await _world(db_session)
        started = await _approval_night(w, db_session)
        later = (
            await _scheduled(
                w, db_session, nights=[_night(4)], require_signup_approval=True
            )
        )[2][0]
        for event_id in (started, later):
            seat = await _seat(w, event_id, "Santa")
            await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        await self._start_now(db_session, started)

        assert await w.service.lapse_unanswered_requests(w.org.id) == 1
        assert [(d.event_id, d.note) for d in w.service.decisions] == [
            (started, NOTE_NIGHT_STARTED)
        ]
        w.service.decisions.clear()
        assert await w.service.lapse_unanswered_requests(w.org.id) == 0
        assert w.service.decisions == []
        (lapsed,) = await _requests(db_session, started)
        (waiting,) = await _requests(db_session, later)
        assert (lapsed.status, waiting.status) == ("lapsed", "pending")

    async def test_a_cancelled_night_lapses_its_requests(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        await self._start_now(db_session, event_id, is_cancelled=True)

        assert await w.service.lapse_unanswered_requests(w.org.id) == 1
        assert w.service.decisions[0].note == NOTE_NIGHT_CANCELLED

    async def test_a_started_night_refuses_approval(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        (request,) = await _requests(db_session, event_id)
        await self._start_now(db_session, event_id)

        with pytest.raises(ValueError, match="already started"):
            await w.service.approve_request(
                event_id, request.id, w.org.id, w.coordinator
            )

    async def test_the_sweep_is_a_scheduled_task(self):
        from app.services import scheduled_tasks

        assert (
            scheduled_tasks.TASK_RUNNERS["apparatus_seat_request_lapse"]
            is scheduled_tasks.run_apparatus_seat_request_lapse
        )
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[
            "apparatus_seat_request_lapse"
        ] == (900)
        assert "apparatus_seat_request_lapse" in scheduled_tasks.SCHEDULE


class TestEmails:
    async def test_the_organizer_who_can_answer_is_told_of_a_request(self, db_session):
        w = await _world(db_session)
        await _grant_manage(db_session, w, w.coordinator)
        event_id = await _approval_night(w, db_session)
        await db_session.execute(
            text("UPDATE events SET alternate_organizer_id = :u WHERE id = :e"),
            {"u": w.driver.id, "e": event_id},
        )
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send):
            sent = await deliver(
                db_session, w.org.id, list(w.service.new_request_ids), []
            )

        # The alternate cannot answer it, so is not asked to.
        assert sent == 1
        assert send.await_args.kwargs["to_emails"] == [w.coordinator.email]
        assert "Santa" in send.await_args.kwargs["text_body"]

    async def test_the_member_is_told_the_answer_unless_they_opted_out(
        self, db_session
    ):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.elf)
        await db_session.execute(
            text("UPDATE users SET notification_preferences = :p WHERE id = :u"),
            {"p": '{"email_kinds": {"event_changes": false}}', "u": w.elf.id},
        )
        await db_session.refresh(w.elf)
        by_user = {r.user_id: r for r in await _requests(db_session, event_id)}
        first = by_user[w.santa.id]
        await w.service.approve_request(event_id, first.id, w.org.id, w.coordinator)
        send = AsyncMock(return_value=(1, 0))

        with patch(SEND, send):
            sent = await deliver(db_session, w.org.id, [], list(w.service.decisions))

        assert sent == 1
        assert send.await_args.kwargs["to_emails"] == [w.santa.email]
        assert "You are marked as going" in send.await_args.kwargs["text_body"]

    async def test_a_mail_failure_does_not_raise(self, db_session):
        w = await _world(db_session)
        await _grant_manage(db_session, w, w.coordinator)
        event_id = await _approval_night(w, db_session)
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)

        with patch(SEND, AsyncMock(side_effect=RuntimeError("smtp down"))):
            sent = await deliver(
                db_session, w.org.id, list(w.service.new_request_ids), []
            )
        assert sent == 0


class TestNightsList:
    async def test_counts_the_requests_waiting(self, db_session):
        w = await _world(db_session)
        event_id = await _approval_night(w, db_session)
        seat = await _seat(w, event_id, "Santa")
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.santa)
        await w.service.claim_seat(event_id, seat.id, w.org.id, w.elf)

        (row,) = await w.service.list_nights(w.org.id, "upcoming")
        assert row["pending_requests"] == 2


class TestOverHttp:
    async def test_members_see_their_own_request_and_coordinators_answer(
        self, bench: _Http
    ):
        http = bench
        w = http.w
        event_id = await _approval_night(w, http.db)
        seat_id = (await _seat(w, event_id, "Santa")).id
        await http.db.commit()

        await http.act_as("santa", "events.view", "apparatus_events.signup")
        asked = await http.call(
            "POST", f"/apparatus-events/events/{event_id}/seats/{seat_id}/claim"
        )
        assert asked.status_code == 200, asked.text
        body = asked.json()
        assert body["require_signup_approval"] is True
        assert body["my_seat_id"] is None
        assert body["my_request"]["seat_id"] == seat_id
        request_id = body["my_request"]["id"]
        seat = next(s for u in body["units"] for s in u["seats"] if s["id"] == seat_id)
        assert seat["requests"] == []

        denied = await http.call(
            "POST", f"/apparatus-events/events/{event_id}/requests/{request_id}/approve"
        )
        assert denied.status_code == 403

        await http.act_as("coordinator", "events.view", "apparatus_events.manage")
        board = await http.call("GET", f"/apparatus-events/events/{event_id}")
        seat = next(
            s for u in board.json()["units"] for s in u["seats"] if s["id"] == seat_id
        )
        assert [r["user_id"] for r in seat["requests"]] == [w.ids["santa"]]

        with patch(SEND, AsyncMock(return_value=(1, 0))):
            approved = await http.call(
                "POST",
                f"/apparatus-events/events/{event_id}/requests/{request_id}/approve",
            )
        assert approved.status_code == 200, approved.text
        seat = next(
            s
            for u in approved.json()["units"]
            for s in u["seats"]
            if s["id"] == seat_id
        )
        assert (seat["user_id"], seat["requests"]) == (w.ids["santa"], [])

        again = await http.call(
            "POST",
            f"/apparatus-events/events/{event_id}/requests/{request_id}/decline",
            json={"note": "No"},
        )
        assert again.status_code == 400

    async def test_an_unknown_request_is_not_found(self, bench: _Http):
        http = bench
        w = http.w
        event_id = await _approval_night(w, http.db)
        await http.db.commit()
        await http.act_as("santa", "events.view", "apparatus_events.signup")

        missing = await http.call(
            "POST",
            f"/apparatus-events/events/{event_id}/requests/{uuid.uuid4()}/withdraw",
        )
        assert missing.status_code == 404
