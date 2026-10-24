"""Votes on motions over HTTP: thresholds, roll calls and what is kept.

The roll call is checked against the minutes' own roll, its totals are
counted by the server, and the names stay off the copies that leave the app.
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


def _roll(world: _World) -> list[dict[str, Any]]:
    return [
        {"user_id": str(world.secretary.id), "name": "Pat Chief", "status": "present"},
        {"user_id": str(world.approver.id), "name": "Lee Treasurer", "status": "late"},
        {"user_id": str(world.member.id), "name": "Max Early", "status": "left_early"},
        {"user_id": str(world.assignee.id), "name": "Sam Excused", "status": "excused"},
        {"name": "A visitor", "status": "guest"},
    ]


async def _minutes(world: _World) -> dict[str, Any]:
    return await _create(world, attendees=_roll(world))


async def _motion(world: _World, minutes_id: str, **extra: Any):
    payload = {"motion_text": "Motion to buy hose.", **extra}
    async with _client(world.db, world.secretary) as c:
        return await c.post(f"/minutes/{minutes_id}/motions", json=payload)


class TestRollCall:
    async def test_totals_are_counted_from_the_roll_call(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            roll_call=[
                {"name": "Pat Chief", "vote": "yes"},
                {"name": "Lee Treasurer", "vote": "no"},
                {"name": "Max Early", "vote": "recuse"},
            ],
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["votes_for"], body["votes_against"]) == (1, 1)
        assert (body["votes_abstain"], body["votes_recused"]) == (0, 1)
        assert [r["name"] for r in body["roll_call"]] == [
            "Pat Chief",
            "Lee Treasurer",
            "Max Early",
        ]

    async def test_totals_sent_with_a_roll_call_are_ignored(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            votes_for=99,
            votes_against=99,
            roll_call=[{"name": "Pat Chief", "vote": "yes"}],
        )

        assert resp.status_code == 201, resp.text
        assert (resp.json()["votes_for"], resp.json()["votes_against"]) == (1, 0)

    async def test_the_member_id_is_taken_from_the_minutes_roll(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            roll_call=[
                {"name": "Pat Chief", "vote": "yes", "user_id": str(world.outsider.id)}
            ],
        )

        assert resp.json()["roll_call"][0]["user_id"] == str(world.secretary.id)

    @pytest.mark.parametrize("name", ["Sam Excused", "A visitor", "Nobody"])
    async def test_only_those_recorded_present_can_vote(self, world, name):
        minutes = await _minutes(world)
        resp = await _motion(
            world, minutes["id"], roll_call=[{"name": name, "vote": "yes"}]
        )

        assert resp.status_code == 400
        assert "not recorded as present" in resp.json()["detail"]
        async with _client(world.db, world.secretary) as c:
            listed = (await c.get(f"/minutes/{minutes['id']}")).json()["motions"]
            assert [m for m in listed if m["status"] != "pending"] == []

    async def test_a_member_cannot_vote_twice(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            roll_call=[
                {"name": "Pat Chief", "vote": "yes"},
                {"name": "Pat Chief", "vote": "no"},
            ],
        )

        assert resp.status_code == 400
        assert "twice" in resp.json()["detail"]

    async def test_an_unknown_vote_is_refused(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world, minutes["id"], roll_call=[{"name": "Pat Chief", "vote": "maybe"}]
        )

        assert resp.status_code == 422

    async def test_a_roll_call_can_be_replaced_and_totals_follow(self, world):
        minutes = await _minutes(world)
        motion = (
            await _motion(
                world, minutes["id"], roll_call=[{"name": "Pat Chief", "vote": "yes"}]
            )
        ).json()

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}/motions/{motion['id']}",
                json={
                    "roll_call": [
                        {"name": "Pat Chief", "vote": "no"},
                        {"name": "Lee Treasurer", "vote": "no"},
                    ]
                },
            )

        assert resp.status_code == 200, resp.text
        assert (resp.json()["votes_for"], resp.json()["votes_against"]) == (0, 2)

    async def test_clearing_the_roll_call_keeps_the_totals(self, world):
        minutes = await _minutes(world)
        motion = (
            await _motion(
                world,
                minutes["id"],
                roll_call=[
                    {"name": "Pat Chief", "vote": "yes"},
                    {"name": "Lee Treasurer", "vote": "yes"},
                ],
            )
        ).json()

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}/motions/{motion['id']}",
                json={"roll_call": None},
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["roll_call"] is None
        assert resp.json()["votes_for"] == 2

    async def test_a_roll_call_is_checked_against_the_roll_as_it_stands(self, world):
        minutes = await _minutes(world)
        async with _client(world.db, world.secretary) as c:
            await c.put(
                f"/minutes/{minutes['id']}",
                json={
                    "attendees": [
                        {"name": "Pat Chief", "status": "present"},
                    ]
                },
            )
        resp = await _motion(
            world, minutes["id"], roll_call=[{"name": "Lee Treasurer", "vote": "yes"}]
        )

        assert resp.status_code == 400


class TestThresholdAndSuggestion:
    async def test_the_threshold_is_stored_and_a_result_suggested(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            threshold="two_thirds",
            votes_for=2,
            votes_against=1,
            status="passed",
        )

        body = resp.json()
        assert resp.status_code == 201, resp.text
        assert body["threshold"] == "two_thirds"
        assert body["suggested_status"] == "passed"

    async def test_the_suggestion_does_not_overwrite_the_secretarys_result(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            threshold="two_thirds",
            votes_for=1,
            votes_against=2,
            status="passed",
        )

        assert resp.json()["status"] == "passed"
        assert resp.json()["suggested_status"] == "failed"

    async def test_majority_of_those_present_counts_the_minutes_roll(self, world):
        minutes = await _minutes(world)
        resp = await _motion(
            world,
            minutes["id"],
            threshold="majority_present",
            votes_for=1,
            votes_against=0,
        )

        assert resp.json()["suggested_status"] == "failed"

        resp = await _motion(
            world,
            minutes["id"],
            threshold="majority_present",
            votes_for=2,
            votes_against=0,
        )
        assert resp.json()["suggested_status"] == "passed"

    async def test_a_motion_with_no_count_has_no_suggestion(self, world):
        minutes = await _minutes(world)
        resp = await _motion(world, minutes["id"])

        assert resp.json()["suggested_status"] is None
        assert resp.json()["threshold"] is None

    async def test_an_unknown_threshold_is_refused(self, world):
        minutes = await _minutes(world)
        resp = await _motion(world, minutes["id"], threshold="unanimous")

        assert resp.status_code == 422

    async def test_the_suggestion_appears_when_the_minutes_are_read(self, world):
        minutes = await _minutes(world)
        await _motion(world, minutes["id"], votes_for=3, votes_against=1)

        async with _client(world.db, world.secretary) as c:
            listed = (await c.get(f"/minutes/{minutes['id']}")).json()["motions"]

        assert listed[0]["suggested_status"] == "passed"


class TestWhatLeavesTheApp:
    async def test_the_printed_vote_has_totals_and_no_names(self, world):
        minutes = await _minutes(world)
        await _motion(
            world,
            minutes["id"],
            threshold="two_thirds",
            roll_call=[
                {"name": "Pat Chief", "vote": "yes"},
                {"name": "Lee Treasurer", "vote": "yes"},
                {"name": "Max Early", "vote": "recuse"},
            ],
        )
        await _approve(world, minutes["id"])

        async with _client(world.db, world.secretary) as c:
            pdf = await c.get(f"/minutes/{minutes['id']}/pdf")
            revisions = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()

        assert pdf.status_code == 200
        assert b"Pat Chief" not in pdf.content
        assert revisions
        assert verify["verified"] is True

    async def test_the_roll_call_is_sealed_in_the_record(self, world):
        from sqlalchemy import select

        from app.models.minute import MinutesRevision

        minutes = await _minutes(world)
        await _motion(
            world,
            minutes["id"],
            roll_call=[{"name": "Pat Chief", "vote": "yes"}],
        )
        await _approve(world, minutes["id"])

        snapshot = (
            await world.db.execute(
                select(MinutesRevision.snapshot).where(
                    MinutesRevision.minutes_id == minutes["id"]
                )
            )
        ).scalar_one()

        assert snapshot["motions"][0]["roll_call"][0]["name"] == "Pat Chief"
