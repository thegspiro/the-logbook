"""A closed election's result files itself with the minutes of its meeting.

At the two moments it becomes possible — the election closes with minutes
already made, or minutes are made after it closed — and never so that a problem
filing it can fail the close or the creation. Circulated or adopted minutes
take it as a permanent addendum; a department can switch it off.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus
from app.models.event import Event, EventType
from app.models.minute import MeetingMinutes
from app.models.user import Organization
from app.services import minutes_record_service
from app.services.election_service import ElectionService
from tests.minutes_support import (
    _approve,
    _client,
    _closed_election,
    _create,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _event(w: _World, title: str = "October business meeting") -> str:
    now = datetime.now(timezone.utc)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=w.org_id,
        title=title,
        event_type=EventType.BUSINESS_MEETING,
        start_datetime=now,
        end_datetime=now + timedelta(hours=2),
    )
    w.db.add(event)
    await w.db.flush()
    return event.id


async def _settings(w: _World, minutes_settings: dict[str, Any]) -> None:
    org = await w.db.get(Organization, w.org_id)
    assert org is not None
    org.settings = {**(org.settings or {}), "minutes": minutes_settings}
    await w.db.flush()


async def _close(w: _World, election: Election) -> Election:
    closed, error = await ElectionService(w.db).close_election(
        election.id, w.org_id, closed_by=w.approver.id
    )
    assert error is None, error
    assert closed is not None
    return closed


async def _filed(w: _World, minutes_id: str) -> list[dict[str, Any]]:
    async with _client(w.db, w.secretary) as c:
        resp = await c.get(f"/minutes/{minutes_id}/election-results")
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestWhenTheElectionCloses:
    async def test_the_result_is_filed_with_draft_minutes_for_that_meeting(self, world):
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )

        await _close(world, election)

        (row,) = await _filed(world, minutes["id"])
        assert row["election_id"] == election.id
        assert row["is_addendum"] is False
        assert row["captured_by"] == str(world.approver.id)

    async def test_circulated_minutes_take_it_as_a_permanent_addendum(self, world):
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        await _approve(world, minutes["id"])
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )

        await _close(world, election)

        (row,) = await _filed(world, minutes["id"])
        assert row["is_addendum"] is True

    async def test_the_newest_minutes_for_the_meeting_take_it(self, world):
        event_id = await _event(world)
        older = await _create(world, event_id=event_id, title="First draft")
        # created_at has one-second resolution; make the order unambiguous.
        await world.db.execute(
            update(MeetingMinutes)
            .where(MeetingMinutes.id == older["id"])
            .values(created_at=datetime.now(timezone.utc) - timedelta(hours=1))
        )
        newer = await _create(world, event_id=event_id, title="Second draft")
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )

        await _close(world, election)

        assert await _filed(world, older["id"]) == []
        assert len(await _filed(world, newer["id"])) == 1

    async def test_an_election_held_at_no_meeting_files_nothing(self, world):
        minutes = await _create(world)
        election = await _closed_election(world.db, world.org_id, closed=False)

        await _close(world, election)

        assert await _filed(world, minutes["id"]) == []

    async def test_minutes_of_another_meeting_are_left_alone(self, world):
        minutes = await _create(world, event_id=await _event(world, "Other meeting"))
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=await _event(world)
        )

        await _close(world, election)

        assert await _filed(world, minutes["id"]) == []

    async def test_a_filing_that_breaks_never_fails_the_close(self, world, monkeypatch):
        async def boom(*_a: Any, **_k: Any):
            raise RuntimeError("filing exploded")

        monkeypatch.setattr(
            minutes_record_service.MinutesRecordService, "capture_election_result", boom
        )
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )

        closed = await _close(world, election)

        assert closed.status == ElectionStatus.CLOSED
        # Read through the service: the failed filing rolled this test's session
        # back, expiring the signed-in user a request would read, and a real
        # request has a session of its own.
        rows = await minutes_record_service.MinutesRecordService(
            world.db
        ).list_election_results(minutes["id"], world.org_id)
        assert rows == []

    async def test_a_department_can_switch_it_off(self, world):
        await _settings(world, {"auto_file_election_results": False})
        event_id = await _event(world)
        minutes = await _create(world, event_id=event_id)
        election = await _closed_election(
            world.db, world.org_id, closed=False, event_id=event_id
        )

        await _close(world, election)

        assert await _filed(world, minutes["id"]) == []


class TestWhenTheMinutesAreMade:
    async def test_an_election_already_closed_is_filed_into_new_minutes(self, world):
        event_id = await _event(world)
        election = await _closed_election(
            world.db, world.org_id, event_id=event_id, title="Officer election"
        )

        minutes = await _create(world, event_id=event_id)

        (row,) = await _filed(world, minutes["id"])
        assert row["election_id"] == election.id
        assert row["is_addendum"] is False
        assert row["captured_by"] == str(world.secretary.id)

    async def test_a_result_already_filed_is_not_filed_twice_by_hand(self, world):
        event_id = await _event(world)
        election = await _closed_election(world.db, world.org_id, event_id=event_id)
        minutes = await _create(world, event_id=event_id)

        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )

        assert resp.status_code == 400
        assert len(await _filed(world, minutes["id"])) == 1

    async def test_only_closed_elections_of_this_meeting_are_filed(self, world):
        event_id = await _event(world)
        await _closed_election(world.db, world.org_id, closed=False, event_id=event_id)
        await _closed_election(
            world.db, world.org_id, event_id=await _event(world, "Other meeting")
        )

        minutes = await _create(world, event_id=event_id)

        assert await _filed(world, minutes["id"]) == []

    async def test_another_departments_election_is_never_filed(self, world):
        event_id = await _event(world)
        await _closed_election(world.db, world.other_org_id, event_id=event_id)

        minutes = await _create(world, event_id=event_id)

        assert await _filed(world, minutes["id"]) == []

    async def test_a_department_can_switch_it_off(self, world):
        await _settings(world, {"auto_file_election_results": False})
        event_id = await _event(world)
        await _closed_election(world.db, world.org_id, event_id=event_id)

        minutes = await _create(world, event_id=event_id)

        assert await _filed(world, minutes["id"]) == []

    async def test_manual_import_still_works_with_it_off(self, world):
        await _settings(world, {"auto_file_election_results": False})
        event_id = await _event(world)
        election = await _closed_election(world.db, world.org_id, event_id=event_id)
        minutes = await _create(world, event_id=event_id)

        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )

        assert resp.status_code == 201, resp.text
        assert len(await _filed(world, minutes["id"])) == 1


class TestTheSetting:
    async def test_it_reads_as_on_when_unset_or_malformed(self, world):
        async with _client(world.db, world.secretary) as c:
            assert (await c.get("/minutes/settings")).json()[
                "auto_file_election_results"
            ] is True
        for value in ("false", 0, None, "no", [False]):
            await _settings(world, {"auto_file_election_results": value})
            async with _client(world.db, world.secretary) as c:
                body = (await c.get("/minutes/settings")).json()
            assert body["auto_file_election_results"] is True, value

    async def test_only_a_literal_false_turns_it_off(self, world):
        await _settings(world, {"auto_file_election_results": False})

        async with _client(world.db, world.secretary) as c:
            body = (await c.get("/minutes/settings")).json()

        assert body["auto_file_election_results"] is False
