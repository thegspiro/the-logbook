"""Which attendance statuses the minutes name.

The roll is always recorded in full (quorum and the attendance reports read
it); the department, or one set of minutes, chooses what a reader is shown.
Unset has to read as today's behaviour, everyone named, so an upgrade changes
nothing on a printed copy.
"""

import itertools
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization
from app.services.document_service import DocumentService
from app.services.minute_service import MinuteService
from app.services.minutes_print_data import build_print_data
from app.utils.minutes_attendance import (
    ATTENDANCE_LISTINGS,
    ATTENDANCE_STATUSES,
    effective_listing,
    is_listed,
    listed_attendees,
    normalize_listing,
)
from app.utils.minutes_public import narrow_for_public
from app.utils.minutes_settings import attendance_listing_in
from tests.minutes_support import (
    MANAGE,
    _approve,
    _client,
    _create,
    _org,
    _user,
    _World,
)

ROLL = [
    {"name": "Pat Present", "status": "present"},
    {"name": "Lee Late", "status": "late"},
    {"name": "Ed Early", "status": "left_early"},
    {"name": "Xia Excused", "status": "excused"},
    {"name": "Abe Absent", "status": "absent"},
    {"name": "Gus Guest", "status": "guest"},
]


def _names(entries: Any) -> set[str]:
    return {e["name"] for e in entries}


@pytest.mark.unit
class TestListing:
    @pytest.mark.parametrize(
        ("listing", "expected"),
        [
            ("present", {"Pat Present", "Lee Late", "Ed Early", "Gus Guest"}),
            (
                "present_excused",
                {"Pat Present", "Lee Late", "Ed Early", "Gus Guest", "Xia Excused"},
            ),
            ("all", {e["name"] for e in ROLL}),
        ],
    )
    def test_each_listing_names_what_it_says(self, listing, expected):
        assert _names(listed_attendees(ROLL, listing)) == expected

    def test_every_status_is_covered_by_every_listing_decision(self):
        for status, listing in itertools.product(
            ATTENDANCE_STATUSES, ATTENDANCE_LISTINGS
        ):
            assert isinstance(is_listed(status, listing), bool)

    def test_guests_are_in_the_room_so_every_listing_names_them(self):
        assert all(is_listed("guest", listing) for listing in ATTENDANCE_LISTINGS)

    @pytest.mark.parametrize("bad", [None, "", "everyone", 1, ["all"], {"a": 1}])
    def test_anything_unrecognised_reads_as_everyone(self, bad):
        assert normalize_listing(bad) == "all"
        assert is_listed("absent", bad)

    def test_the_minutes_own_choice_beats_the_department(self):
        assert effective_listing("all", "present") == "all"
        assert effective_listing(None, "present") == "present"
        assert effective_listing("junk", "present") == "present"
        assert effective_listing(None, None) == "all"

    def test_legacy_entries_without_a_status_are_judged_by_present_flag(self):
        legacy = [{"name": "Old", "present": True}, {"name": "Gone", "present": False}]
        assert _names(listed_attendees(legacy, "present")) == {"Old"}

    def test_a_missing_roll_is_an_empty_list(self):
        assert listed_attendees(None, "present") == []


@pytest.mark.unit
class TestSettingReader:
    @pytest.mark.parametrize(
        "settings",
        [None, {}, [], {"minutes": None}, {"minutes": []}, {"minutes": {}}],
    )
    def test_unset_reads_as_everyone(self, settings):
        assert attendance_listing_in(settings) == "all"

    @pytest.mark.parametrize("value", ["present", "present_excused", "all"])
    def test_a_known_value_is_read(self, value):
        assert (
            attendance_listing_in({"minutes": {"attendance_listing": value}}) == value
        )

    @pytest.mark.parametrize("value", ["PRESENT", True, 3, "none"])
    def test_a_mistyped_value_reads_as_everyone(self, value):
        assert (
            attendance_listing_in({"minutes": {"attendance_listing": value}}) == "all"
        )


@pytest.mark.unit
class TestPublicCopyCounts:
    def _data(self, listing: str) -> dict[str, Any]:
        return {
            "attendees": listed_attendees(ROLL, listing),
            "attendance_listing": listing,
        }

    def test_present_only_reports_no_absent_or_excused_count_at_all(self):
        attendance = narrow_for_public(self._data("present"))["attendance"]
        assert "absent" not in attendance
        assert "excused" not in attendance
        assert attendance["present"] == 3
        assert attendance["guests"] == 1

    def test_present_and_excused_reports_excused_but_not_absent(self):
        attendance = narrow_for_public(self._data("present_excused"))["attendance"]
        assert attendance["excused"] == 1
        assert "absent" not in attendance

    def test_everyone_reports_all_four(self):
        attendance = narrow_for_public(self._data("all"))["attendance"]
        assert {"present", "excused", "absent", "guests"} <= set(attendance)

    def test_a_copy_built_before_this_setting_reports_everything(self):
        data = {"attendees": ROLL}
        assert "absent" in narrow_for_public(data)["attendance"]


def _minutes(attendees):
    return SimpleNamespace(
        get_effective_header=lambda: {"org_name": "FD", "subtitle": "Minutes"},
        get_effective_footer=lambda: {},
        get_sections=lambda: [],
        meeting_type="business_meeting",
        meeting_date=datetime(2026, 1, 15, 19, 0, tzinfo=timezone.utc),
        title="Monthly",
        location=None,
        called_by=None,
        called_to_order_at=None,
        adjourned_at=None,
        attendees=attendees,
        quorum_met=True,
        quorum_count=3,
        motions=[],
        action_items=[],
        approved_at=None,
        status="published",
        id="m",
        published_document_id=None,
    )


@pytest.mark.unit
class TestLibraryCopy:
    def _html(self, listing: str) -> str:
        return DocumentService(None)._generate_minutes_html(  # type: ignore[arg-type]
            _minutes(ROLL), None, (), (), listing
        )

    def test_present_only_leaves_excused_and_absent_names_out(self):
        html = self._html("present")
        assert "Pat Present" in html
        assert "Gus Guest" in html
        assert "Xia Excused" not in html
        assert "Abe Absent" not in html
        assert "Excused (" not in html
        assert "Absent (" not in html

    def test_everyone_names_every_group(self):
        html = self._html("all")
        assert "Xia Excused" in html
        assert "Abe Absent" in html

    def test_the_quorum_line_still_prints(self):
        assert "Quorum met" in self._html("present")

    def test_the_default_is_everyone(self):
        html = DocumentService(None)._generate_minutes_html(_minutes(ROLL))  # type: ignore[arg-type]
        assert "Abe Absent" in html


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    w = _World()
    w.db = db_session
    w.org_id = await _org(db_session, "solo")
    w.other_org_id = ""
    w.secretary = await _user(db_session, w.org_id, "Secretary", MANAGE)
    w.approver = await _user(db_session, w.org_id, "Approver", MANAGE)
    w.member = await _user(db_session, w.org_id, "Member", ["minutes.view"])
    w.assignee = w.member
    w.outsider = w.member
    return w


async def _department(w: _World, listing: Any) -> None:
    org = await w.db.get(Organization, w.org_id)
    assert org is not None
    org.settings = {**(org.settings or {}), "minutes": {"attendance_listing": listing}}
    await w.db.flush()


async def _get(w: _World, minutes_id: str, who=None) -> dict[str, Any]:
    async with _client(w.db, who or w.secretary) as c:
        resp = await c.get(f"/minutes/{minutes_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.integration
class TestOverHttp:
    async def test_unset_department_lists_everyone(self, world):
        minutes = await _create(world)
        assert minutes["attendance_listing"] is None
        assert minutes["attendance_listing_effective"] == "all"

    async def test_the_department_default_is_reported_to_every_viewer(self, world):
        await _department(world, "present")
        minutes = await _create(world)
        await _approve(world, minutes["id"])

        as_member = await _get(world, minutes["id"], world.member)

        assert as_member["attendance_listing_effective"] == "present"

    async def test_the_roll_is_still_recorded_in_full(self, world):
        await _department(world, "present")
        minutes = await _create(world)

        body = await _get(world, minutes["id"])

        assert {a["status"] for a in body["attendees"]} == {
            "present",
            "excused",
            "guest",
        }

    async def test_one_set_of_minutes_can_override_the_department(self, world):
        await _department(world, "present")
        minutes = await _create(world)

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}", json={"attendance_listing": "all"}
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["attendance_listing"] == "all"
        assert resp.json()["attendance_listing_effective"] == "all"

    async def test_clearing_the_override_follows_the_department_again(self, world):
        await _department(world, "present")
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"attendance_listing": "all"})
            resp = await c.put(
                f"/minutes/{minutes['id']}", json={"attendance_listing": None}
            )

        assert resp.json()["attendance_listing"] is None
        assert resp.json()["attendance_listing_effective"] == "present"

    async def test_an_unknown_listing_is_refused(self, world):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}", json={"attendance_listing": "nobody"}
            )
        assert resp.status_code == 422

    async def test_adopted_minutes_cannot_change_their_listing(self, world):
        minutes = await _create(world)
        await _approve(world, minutes["id"])

        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}", json={"attendance_listing": "present"}
            )

        assert resp.status_code == 400

    async def test_a_member_cannot_set_it(self, world):
        minutes = await _create(world)
        async with _client(world.db, world.member) as c:
            resp = await c.put(
                f"/minutes/{minutes['id']}", json={"attendance_listing": "present"}
            )
        assert resp.status_code == 403

    async def test_the_settings_endpoint_reports_what_the_server_reads(self, world):
        await _department(world, "present_excused")
        async with _client(world.db, world.secretary) as c:
            resp = await c.get("/minutes/settings")
        assert resp.json()["attendance_listing"] == "present_excused"

    async def test_a_mistyped_department_value_reads_as_everyone(self, world):
        await _department(world, "PRESENT")
        async with _client(world.db, world.secretary) as c:
            resp = await c.get("/minutes/settings")
        assert resp.json()["attendance_listing"] == "all"

    async def test_quorum_does_not_depend_on_what_is_listed(self, world):
        minutes = await _create(world)
        before = (await _get(world, minutes["id"]))["quorum_count"]
        await _department(world, "present")
        after = (await _get(world, minutes["id"]))["quorum_count"]
        assert before == after

    async def test_the_printed_copy_names_only_what_the_listing_names(self, world):
        await _department(world, "present")
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        record = await MinuteService(world.db).get_minutes(minutes["id"], world.org_id)
        assert record is not None

        printed = await build_print_data(
            world.db, record, world.org_id, restricted=False
        )

        assert {a["status"] for a in printed.data["attendees"]} == {"present", "guest"}
        assert printed.data["attendance_listing"] == "present"

    async def test_one_sets_own_choice_reaches_the_printed_copy(self, world):
        await _department(world, "present")
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"attendance_listing": "all"})
        await _approve(world, minutes["id"])
        record = await MinuteService(world.db).get_minutes(minutes["id"], world.org_id)
        assert record is not None

        printed = await build_print_data(
            world.db, record, world.org_id, restricted=False
        )

        assert "excused" in {a["status"] for a in printed.data["attendees"]}
