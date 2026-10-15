"""Recording when the meeting began and ended.

The times are set from the call-to-order and adjournment sections. What matters
server-side is that they persist, that an end at or before the start is refused
whichever of the two is being changed, and that a time can be cleared.
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import _client, _create, _World, build_world

pytestmark = [pytest.mark.integration]

START = "2026-10-01T19:02:00+00:00"
END = "2026-10-01T20:41:00+00:00"


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _put(world: _World, minutes_id: str, body: dict[str, Any]):
    async with _client(world.db, world.secretary) as c:
        return await c.put(f"/minutes/{minutes_id}", json=body)


async def _get(world: _World, minutes_id: str) -> dict[str, Any]:
    async with _client(world.db, world.secretary) as c:
        return (await c.get(f"/minutes/{minutes_id}")).json()


class TestRecordingTimes:
    async def test_both_times_are_saved(self, world):
        minutes = await _create(world)
        resp = await _put(
            world,
            minutes["id"],
            {"called_to_order_at": START, "adjourned_at": END},
        )

        assert resp.status_code == 200, resp.text
        saved = await _get(world, minutes["id"])
        assert saved["called_to_order_at"].startswith("2026-10-01T19:02")
        assert saved["adjourned_at"].startswith("2026-10-01T20:41")

    async def test_the_start_can_be_recorded_before_the_end_exists(self, world):
        minutes = await _create(world)
        resp = await _put(world, minutes["id"], {"called_to_order_at": START})

        assert resp.status_code == 200, resp.text
        saved = await _get(world, minutes["id"])
        assert saved["called_to_order_at"] is not None
        assert saved["adjourned_at"] is None

    async def test_a_time_can_be_cleared(self, world):
        minutes = await _create(world, called_to_order_at=START)
        resp = await _put(world, minutes["id"], {"called_to_order_at": None})

        assert resp.status_code == 200, resp.text
        assert (await _get(world, minutes["id"]))["called_to_order_at"] is None


class TestOrdering:
    async def test_an_end_before_the_start_is_refused(self, world):
        minutes = await _create(world)
        resp = await _put(
            world,
            minutes["id"],
            {"called_to_order_at": END, "adjourned_at": START},
        )

        assert resp.status_code == 400
        assert "adjourned after" in resp.json()["detail"]
        saved = await _get(world, minutes["id"])
        assert saved["called_to_order_at"] is None

    async def test_an_end_equal_to_the_start_is_refused(self, world):
        minutes = await _create(world)
        resp = await _put(
            world,
            minutes["id"],
            {"called_to_order_at": START, "adjourned_at": START},
        )

        assert resp.status_code == 400

    async def test_a_new_end_is_checked_against_the_saved_start(self, world):
        minutes = await _create(world, called_to_order_at=START)
        resp = await _put(
            world, minutes["id"], {"adjourned_at": "2026-10-01T18:00:00+00:00"}
        )

        assert resp.status_code == 400
        assert (await _get(world, minutes["id"]))["adjourned_at"] is None

    async def test_a_new_start_is_checked_against_the_saved_end(self, world):
        minutes = await _create(world, adjourned_at=END)
        resp = await _put(
            world, minutes["id"], {"called_to_order_at": "2026-10-01T22:00:00+00:00"}
        )

        assert resp.status_code == 400

    async def test_a_naive_time_is_read_as_utc(self, world):
        minutes = await _create(world, called_to_order_at="2026-10-01T19:02:00")
        resp = await _put(
            world, minutes["id"], {"adjourned_at": "2026-10-01T20:41:00+00:00"}
        )

        assert resp.status_code == 200, resp.text

    async def test_creating_minutes_with_an_end_before_the_start_is_refused(
        self, world
    ):
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                "/minutes",
                json={
                    "title": "Bad times",
                    "meeting_type": "business",
                    "meeting_date": START,
                    "called_to_order_at": END,
                    "adjourned_at": START,
                },
            )

        assert resp.status_code == 400
        assert "adjourned after" in resp.json()["detail"]


class TestLegacyMinutes:
    async def test_saved_times_out_of_order_do_not_block_other_edits(self, world):
        from datetime import datetime, timezone

        from sqlalchemy import update

        from app.models.minute import MeetingMinutes

        minutes = await _create(world)
        await world.db.execute(
            update(MeetingMinutes)
            .where(MeetingMinutes.id == minutes["id"])
            .values(
                called_to_order_at=datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc),
                adjourned_at=datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc),
            )
        )
        await world.db.flush()

        resp = await _put(world, minutes["id"], {"location": "Station 2"})

        assert resp.status_code == 200, resp.text
