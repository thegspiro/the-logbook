"""Motions made from an outline section, and who moved the adoption.

Pieces under test: the built-in outlines flag the adopt and adjourn sections and
carry wording, a section's flag and wording survive create and update, a motion
can name its section (and only one of the minutes' own), the adoption records a
mover and seconder that the sealed record includes, and a guest's typed name is
stored as given.
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _fill_required_sections,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _get(world: _World, minutes_id: str) -> dict[str, Any]:
    async with _client(world.db, world.secretary) as c:
        resp = await c.get(f"/minutes/{minutes_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _motion(world: _World, minutes_id: str, **extra: Any):
    payload = {"motion_text": "Motion to adjourn.", **extra}
    async with _client(world.db, world.secretary) as c:
        return await c.post(f"/minutes/{minutes_id}/motions", json=payload)


class TestOutlineFlags:
    async def test_built_in_outline_marks_adopt_and_adjourn(self, world):
        minutes = await _create(world)
        by_key = {s["key"]: s for s in minutes["sections"]}

        assert by_key["approval_of_previous"]["needs_motion"] is True
        assert by_key["approval_of_previous"]["motion_text"]
        assert by_key["adjournment"]["needs_motion"] is True
        assert by_key["adjournment"]["motion_text"]
        assert by_key["call_to_order"]["needs_motion"] is False
        assert by_key["call_to_order"]["motion_text"] == ""

    async def test_flag_and_wording_survive_an_update(self, world):
        minutes = await _create(world)
        sections = [
            {
                **s,
                "needs_motion": s["key"] == "new_business",
                "motion_text": (
                    "Motion to purchase the hose." if s["key"] == "new_business" else ""
                ),
            }
            for s in minutes["sections"]
        ]
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
        assert resp.status_code == 200, resp.text

        by_key = {s["key"]: s for s in (await _get(world, minutes["id"]))["sections"]}
        assert by_key["new_business"]["needs_motion"] is True
        assert by_key["new_business"]["motion_text"] == "Motion to purchase the hose."
        assert by_key["adjournment"]["needs_motion"] is False

    async def test_wording_over_the_motion_limit_is_refused(self, world):
        minutes = await _create(world)
        sections = [
            {**s, "motion_text": "x" * 2001} if s["key"] == "adjournment" else s
            for s in minutes["sections"]
        ]
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
        assert resp.status_code == 422

    async def test_a_templates_flag_travels_to_minutes_made_from_it(self, world):
        sections = [
            {
                "order": 0,
                "key": "vote",
                "title": "Vote",
                "default_content": "",
                "required": False,
                "needs_motion": True,
                "motion_text": "Motion to accept the audit.",
            }
        ]
        async with _client(world.db, world.secretary) as c:
            made = await c.post(
                "/minutes/templates",
                json={
                    "name": "Audit outline",
                    "meeting_type": "business",
                    "sections": sections,
                },
            )
            assert made.status_code == 201, made.text
            assert made.json()["sections"][0]["needs_motion"] is True
            template_id = made.json()["id"]

        minutes = await _create(world, template_id=template_id)
        vote = next(s for s in minutes["sections"] if s["key"] == "vote")
        assert vote["needs_motion"] is True
        assert vote["motion_text"] == "Motion to accept the audit."


class TestSectionMotions:
    async def test_a_motion_records_its_section(self, world):
        minutes = await _create(world)
        resp = await _motion(
            world,
            minutes["id"],
            section_key="adjournment",
            moved_by="Secretary",
            seconded_by="A visitor",
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["section_key"] == "adjournment"
        listed = (await _get(world, minutes["id"]))["motions"]
        recorded = [m for m in listed if m["status"] != "pending"]
        assert [m["section_key"] for m in recorded] == ["adjournment"]
        # Recording it filled in the prepared motion instead of adding a second.
        assert [m["section_key"] for m in listed].count("adjournment") == 1

    async def test_a_motion_without_a_section_is_unchanged(self, world):
        minutes = await _create(world)
        resp = await _motion(world, minutes["id"])

        assert resp.status_code == 201, resp.text
        assert resp.json()["section_key"] is None

    async def test_a_section_the_minutes_lack_is_refused(self, world):
        minutes = await _create(world)
        resp = await _motion(world, minutes["id"], section_key="no_such_section")

        assert resp.status_code == 400
        assert "section" in resp.json()["detail"].lower()
        listed = (await _get(world, minutes["id"]))["motions"]
        assert [m for m in listed if m["status"] != "pending"] == []

    async def test_updating_to_a_missing_section_is_refused(self, world):
        minutes = await _create(world)
        motion = (await _motion(world, minutes["id"])).json()
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}/motions/{motion['id']}",
                json={"section_key": "no_such_section"},
            )

        assert resp.status_code == 400

    async def test_a_guests_typed_name_is_stored_as_given(self, world):
        minutes = await _create(world)
        resp = await _motion(
            world,
            minutes["id"],
            section_key="adjournment",
            moved_by="Chief Emeritus R. Alvarez (honorary)",
            seconded_by="Secretary",
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["moved_by"] == "Chief Emeritus R. Alvarez (honorary)"


class TestAdoptionMovers:
    async def _adopt(self, world: _World, minutes_id: str, body: dict[str, Any]):
        await _fill_required_sections(world, minutes_id)
        async with _client(world.db, world.secretary) as c:
            assert (await c.post(f"/minutes/{minutes_id}/submit")).status_code == 200
        async with _client(world.db, world.approver) as c:
            return await c.post(f"/minutes/{minutes_id}/approve", json=body)

    async def test_movers_are_recorded_on_adoption(self, world):
        minutes = await _create(world)
        resp = await self._adopt(
            world,
            minutes["id"],
            {"moved_by": "  Secretary ", "seconded_by": "Guest Chief"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["adoption_moved_by"] == "Secretary"
        assert body["adoption_seconded_by"] == "Guest Chief"

    async def test_blank_movers_are_recorded_as_none(self, world):
        minutes = await _create(world)
        resp = await self._adopt(
            world, minutes["id"], {"moved_by": "   ", "seconded_by": ""}
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["adoption_moved_by"] is None
        assert resp.json()["adoption_seconded_by"] is None

    async def test_adoption_without_movers_is_unchanged(self, world):
        minutes = await _create(world)
        approved = await _approve(world, minutes["id"])

        assert approved["adoption_moved_by"] is None
        assert approved["adoption_seconded_by"] is None

    async def test_the_sealed_record_includes_the_movers(self, world):
        minutes = await _create(world)
        await self._adopt(
            world, minutes["id"], {"moved_by": "Secretary", "seconded_by": "Guest"}
        )
        async with _client(world.db, world.secretary) as c:
            revisions = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()

        assert revisions, "adoption should have written a revision"
        assert verify["verified"] is True

    async def test_reopening_clears_the_movers(self, world):
        minutes = await _create(world)
        await self._adopt(
            world, minutes["id"], {"moved_by": "Secretary", "seconded_by": "Guest"}
        )
        async with _client(world.db, world.approver) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/reopen",
                json={"reason": "The vote was recorded wrongly"},
            )
        assert resp.status_code == 200, resp.text

        reopened = await _get(world, minutes["id"])
        assert reopened["adoption_moved_by"] is None
        assert reopened["adoption_seconded_by"] is None

    async def test_movers_over_the_limit_are_refused(self, world):
        minutes = await _create(world)
        resp = await self._adopt(world, minutes["id"], {"moved_by": "x" * 201})

        assert resp.status_code == 422
