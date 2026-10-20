"""Motions an outline prepares with the minutes, and accepting the previous ones.

A section marked "needs a motion" gets its motion from the day the minutes are
made, as a *pending* record: wording only. It never reaches a printed,
published or sealed copy until the meeting acts on it. The motion that accepts
the previous minutes names and links them, and passing it (as submitted or as
revised) pre-fills their adoption; an officer other than whoever circulated
them still has to confirm it.
"""

from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.document_service import DocumentService
from app.services.minute_service import MinuteService
from app.services.minutes_print_data import build_print_data
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _fill_required_sections,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

SEPT = datetime(2026, 9, 3, 19, 0, tzinfo=timezone.utc)
OCT = datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc)


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _get(w: _World, minutes_id: str, who=None) -> dict[str, Any]:
    async with _client(w.db, who or w.secretary) as c:
        resp = await c.get(f"/minutes/{minutes_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_section(minutes: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {m["section_key"]: m for m in minutes["motions"] if m["section_key"]}


async def _circulate(w: _World, minutes_id: str) -> None:
    await _fill_required_sections(w, minutes_id)
    async with _client(w.db, w.secretary) as c:
        assert (await c.post(f"/minutes/{minutes_id}/submit")).status_code == 200


async def _record(w: _World, minutes_id: str, motion_id: str, **fields: Any):
    async with _client(w.db, w.secretary) as c:
        return await c.put(
            f"/minutes/{minutes_id}/motions/{motion_id}",
            json={"moved_by": "Secretary", "seconded_by": "A visitor", **fields},
        )


class TestPreparedMotions:
    async def test_each_section_that_needs_a_motion_has_one_from_the_start(self, world):
        minutes = await _create(world)

        motions = _by_section(minutes)

        assert set(motions) == {"approval_of_previous", "adjournment"}
        for motion in motions.values():
            assert motion["status"] == "pending"
            assert motion["moved_by"] is None
            assert motion["motion_text"]

    async def test_a_pending_motion_is_not_a_recorded_one(self, world):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            listed = (await c.get("/minutes")).json()

        row = next(m for m in listed if m["id"] == minutes["id"])
        assert row["motions_count"] == 0

    async def test_nothing_pending_is_printed_or_published(self, world):
        minutes = await _create(world)
        record = await MinuteService(world.db).get_minutes(minutes["id"], world.org_id)
        assert record is not None

        printed = await build_print_data(
            world.db, record, world.org_id, restricted=False
        )
        html = DocumentService(None)._generate_minutes_html(record)  # type: ignore[arg-type]

        assert printed.data["motions"] == []
        assert "Motions (" not in html

    async def test_recording_a_motion_fills_in_the_prepared_one(self, world):
        minutes = await _create(world)
        prepared = _by_section(minutes)["adjournment"]

        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={
                    "motion_text": "Motion to adjourn at 8:30.",
                    "section_key": "adjournment",
                    "moved_by": "Secretary",
                    "seconded_by": "A visitor",
                    "status": "passed",
                },
            )

        assert resp.status_code == 201, resp.text
        assert resp.json()["id"] == prepared["id"]
        after = await _get(world, minutes["id"])
        assert [m["section_key"] for m in after["motions"]].count("adjournment") == 1
        assert _by_section(after)["adjournment"]["status"] == "passed"

    async def test_updating_a_prepared_motion_records_it(self, world):
        minutes = await _create(world)
        prepared = _by_section(minutes)["adjournment"]

        resp = await _record(
            world, minutes["id"], prepared["id"], status="passed", votes_for=9
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "passed"
        printed = await build_print_data(
            world.db,
            await MinuteService(world.db).get_minutes(minutes["id"], world.org_id),
            world.org_id,
            restricted=False,
        )
        assert [m["number"] for m in printed.data["motions"]] == [1]

    async def test_a_result_of_pending_cannot_be_set_by_a_client(self, world):
        minutes = await _create(world)
        prepared = _by_section(minutes)["adjournment"]

        resp = await _record(world, minutes["id"], prepared["id"], status="pending")

        assert resp.status_code == 400

    async def test_removing_the_flag_removes_only_the_unacted_motion(self, world):
        minutes = await _create(world)
        decided = _by_section(minutes)["adjournment"]
        await _record(world, minutes["id"], decided["id"], status="passed")
        sections = [
            {**s, "needs_motion": False}
            for s in (await _get(world, minutes["id"]))["sections"]
        ]

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})

        assert resp.status_code == 200, resp.text
        after = _by_section(await _get(world, minutes["id"]))
        assert set(after) == {"adjournment"}
        assert after["adjournment"]["status"] == "passed"

    async def test_the_update_response_itself_drops_the_removed_motion(self, world):
        """The PUT's own body, not just a later GET, must not list it.

        ``ensure_section_motions`` deletes a stale motion by a raw query, not
        through the ``MeetingMinutes.motions`` collection. If that collection
        was already loaded earlier in this same request (the GET this test
        makes before the PUT loads it), the delete does not by itself update
        the loaded list, and the response this endpoint builds from
        ``minutes.motions`` would still name the just-deleted motion — in the
        same response, not merely until a later unrelated query happens to
        reload it. This must hold deterministically, not only on a lucky
        read, so it is asserted directly on the PUT body.
        """
        minutes = await _create(world)
        decided = _by_section(minutes)["adjournment"]
        await _record(world, minutes["id"], decided["id"], status="passed")
        # Loads minutes.motions for this request's session before the PUT,
        # the same way the test's own "sections" GET always does.
        await _get(world, minutes["id"])
        sections = [
            {**s, "needs_motion": False}
            for s in (await _get(world, minutes["id"]))["sections"]
        ]

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})

        assert resp.status_code == 200, resp.text
        in_response = _by_section(resp.json())
        assert set(in_response) == {"adjournment"}

    async def test_a_section_flagged_later_gets_its_motion(self, world):
        minutes = await _create(world)
        sections = [
            (
                {**s, "needs_motion": True, "motion_text": "Motion to buy hose."}
                if s["key"] == "new_business"
                else s
            )
            for s in minutes["sections"]
        ]
        async with _client(world.db, world.secretary) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})

        after = _by_section(await _get(world, minutes["id"]))

        assert after["new_business"]["motion_text"] == "Motion to buy hose."
        assert after["new_business"]["status"] == "pending"


class TestPreviousMinutes:
    async def test_with_no_earlier_minutes_the_wording_is_generic(self, world):
        minutes = await _create(world, when=OCT)

        motion = _by_section(minutes)["approval_of_previous"]

        assert motion["previous_minutes_id"] is None
        assert (
            motion["motion_text"]
            == "Motion to approve the minutes of the previous meeting."
        )

    async def test_it_names_and_links_the_previous_circulated_minutes(self, world):
        earlier = await _create(world, when=SEPT, title="September business")
        await _circulate(world, earlier["id"])

        later = await _create(world, when=OCT)
        motion = _by_section(later)["approval_of_previous"]

        assert motion["previous_minutes_id"] == earlier["id"]
        assert motion["previous_minutes_title"] == "September business"
        assert motion["previous_minutes_status"] == "submitted"
        assert "September 3, 2026" in motion["motion_text"]
        assert "business meeting" in motion["motion_text"]

    async def test_draft_minutes_are_not_offered_for_acceptance(self, world):
        await _create(world, when=SEPT)

        later = await _create(world, when=OCT)

        assert _by_section(later)["approval_of_previous"]["previous_minutes_id"] is None

    async def test_a_later_or_different_kind_of_meeting_is_not_the_previous_one(
        self, world
    ):
        special = await _create(world, when=SEPT, meeting_type="special")
        await _circulate(world, special["id"])
        future = await _create(
            world, when=datetime(2026, 11, 5, 19, 0, tzinfo=timezone.utc)
        )
        await _circulate(world, future["id"])

        minutes = await _create(world, when=OCT)

        assert (
            _by_section(minutes)["approval_of_previous"]["previous_minutes_id"] is None
        )

    async def test_another_departments_minutes_are_never_linked(self, world):
        async with _client(world.db, world.outsider) as c:
            resp = await c.post(
                "/minutes",
                json={
                    "title": "Their minutes",
                    "meeting_type": "business",
                    "meeting_date": SEPT.isoformat(),
                },
            )
        assert resp.status_code == 201, resp.text

        minutes = await _create(world, when=OCT)

        assert (
            _by_section(minutes)["approval_of_previous"]["previous_minutes_id"] is None
        )

    async def test_a_department_wording_is_kept(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        sections = [
            {
                "order": 0,
                "key": "approval_of_previous",
                "title": "Approval of Previous Minutes",
                "content": "",
                "needs_motion": True,
                "motion_text": "Move to receive the prior minutes.",
            }
        ]

        minutes = await _create(world, when=OCT, sections=sections)
        motion = _by_section(minutes)["approval_of_previous"]

        assert motion["motion_text"] == "Move to receive the prior minutes."
        assert motion["previous_minutes_id"] == earlier["id"]


class TestAcceptance:
    async def _setup(self, world):
        earlier = await _create(world, when=SEPT, title="September business")
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT)
        return earlier, later, _by_section(later)["approval_of_previous"]

    async def test_it_is_recorded_as_submitted_or_as_revised(self, world):
        _, later, motion = await self._setup(world)

        resp = await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_revised"
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["acceptance"] == "as_revised"

    async def test_an_unknown_choice_is_refused(self, world):
        _, later, motion = await self._setup(world)

        resp = await _record(
            world, later["id"], motion["id"], status="passed", acceptance="sort_of"
        )

        assert resp.status_code == 422

    async def test_only_the_previous_minutes_motion_has_one(self, world):
        minutes = await _create(world, when=OCT)
        adjourn = _by_section(minutes)["adjournment"]

        resp = await _record(
            world,
            minutes["id"],
            adjourn["id"],
            status="passed",
            acceptance="as_submitted",
        )

        assert resp.status_code == 400

    async def test_the_printed_copy_says_how_they_were_accepted(self, world):
        _, later, motion = await self._setup(world)
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_submitted"
        )
        record = await MinuteService(world.db).get_minutes(later["id"], world.org_id)
        assert record is not None

        printed = await build_print_data(
            world.db, record, world.org_id, restricted=False
        )
        html = DocumentService(None)._generate_minutes_html(record)  # type: ignore[arg-type]

        assert (
            printed.data["motions"][0]["acceptance_display"] == "Accepted as submitted"
        )
        assert "Accepted as submitted" in html

    async def test_a_failed_motion_is_not_called_accepted(self, world):
        _, later, motion = await self._setup(world)
        await _record(
            world, later["id"], motion["id"], status="failed", acceptance="as_submitted"
        )
        record = await MinuteService(world.db).get_minutes(later["id"], world.org_id)
        assert record is not None

        printed = await build_print_data(
            world.db, record, world.org_id, restricted=False
        )

        assert printed.data["motions"][0]["acceptance_display"] is None


class TestAdoptionProposal:
    async def test_there_is_none_until_the_motion_passes(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        await _create(world, when=OCT)

        async with _client(world.db, world.approver) as c:
            resp = await c.get(f"/minutes/{earlier['id']}/adoption-proposal")

        assert resp.status_code == 200
        assert resp.json() is None

    async def test_a_passed_motion_fills_in_the_adoption(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT, title="October business")
        motion = _by_section(later)["approval_of_previous"]
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_revised"
        )

        async with _client(world.db, world.approver) as c:
            proposal = (
                await c.get(f"/minutes/{earlier['id']}/adoption-proposal")
            ).json()

        assert proposal["adopting_minutes_id"] == later["id"]
        assert proposal["adopting_minutes_title"] == "October business"
        assert proposal["as_amended"] is True
        assert proposal["moved_by"] == "Secretary"
        assert proposal["seconded_by"] == "A visitor"
        assert proposal["adopted_on"].startswith("2026-10-01")

    async def test_as_submitted_is_not_as_amended(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT)
        motion = _by_section(later)["approval_of_previous"]
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_submitted"
        )

        async with _client(world.db, world.approver) as c:
            proposal = (
                await c.get(f"/minutes/{earlier['id']}/adoption-proposal")
            ).json()

        assert proposal["as_amended"] is False

    async def test_a_failed_or_unanswered_motion_proposes_nothing(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT)
        motion = _by_section(later)["approval_of_previous"]
        await _record(
            world, later["id"], motion["id"], status="failed", acceptance="as_submitted"
        )
        async with _client(world.db, world.approver) as c:
            failed = (await c.get(f"/minutes/{earlier['id']}/adoption-proposal")).json()
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance=None
        )
        async with _client(world.db, world.approver) as c:
            unanswered = (
                await c.get(f"/minutes/{earlier['id']}/adoption-proposal")
            ).json()

        assert failed is None
        assert unanswered is None

    async def test_the_officer_who_circulated_still_cannot_adopt_them(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT)
        motion = _by_section(later)["approval_of_previous"]
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_submitted"
        )

        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{earlier['id']}/approve", json={})

        assert resp.status_code in (400, 403)
        assert (await _get(world, earlier["id"]))["status"] == "submitted"

    async def test_a_second_officer_confirms_the_proposal(self, world):
        earlier = await _create(world, when=SEPT)
        await _circulate(world, earlier["id"])
        later = await _create(world, when=OCT)
        motion = _by_section(later)["approval_of_previous"]
        await _record(
            world, later["id"], motion["id"], status="passed", acceptance="as_revised"
        )
        async with _client(world.db, world.approver) as c:
            proposal = (
                await c.get(f"/minutes/{earlier['id']}/adoption-proposal")
            ).json()
            resp = await c.post(
                f"/minutes/{earlier['id']}/approve",
                json={
                    "adopted_on": proposal["adopted_on"],
                    "adopting_minutes_id": proposal["adopting_minutes_id"],
                    "as_amended": proposal["as_amended"],
                    "moved_by": proposal["moved_by"],
                    "seconded_by": proposal["seconded_by"],
                },
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "approved"
        assert body["adopted_as_amended"] is True
        assert body["adopting_minutes_id"] == later["id"]
        accepted = _by_section(await _get(world, later["id"]))["approval_of_previous"]
        assert accepted["previous_minutes_status"] == "approved"

    async def test_another_department_cannot_read_a_proposal(self, world):
        earlier = await _create(world, when=SEPT)

        async with _client(world.db, world.outsider) as c:
            resp = await c.get(f"/minutes/{earlier['id']}/adoption-proposal")

        assert resp.status_code == 404

    async def test_a_member_cannot_read_one(self, world):
        earlier = await _create(world, when=SEPT)
        async with _client(world.db, world.member) as c:
            resp = await c.get(f"/minutes/{earlier['id']}/adoption-proposal")
        assert resp.status_code == 403


class TestSealedRecord:
    async def test_a_pending_motion_is_not_sealed_into_the_adopted_record(self, world):
        minutes = await _create(world)
        await _approve(world, minutes["id"])

        async with _client(world.db, world.approver) as c:
            verify = await c.get(f"/minutes/{minutes['id']}/verify")

        assert verify.status_code == 200, verify.text
        assert verify.json()["verified"] is True
