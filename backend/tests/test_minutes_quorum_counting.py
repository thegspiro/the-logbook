"""Who counts toward quorum is the department's choice (owner decision 2026-11-01).

Bylaws differ on a member who left before the vote and on proxies, so the
department chooses under Minutes → Settings → Quorum. Absent settings must read
as what every department had before: present, late and left early count, and
there is no proxy status in use.

A proxy is a member who was not in the room but was represented. They are never
``present`` (that flag means in the room, for the roll-call vote and the
"majority of members present" threshold); whether they count toward quorum is
the department's switch.
"""

from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization
from app.schemas.minute import AttendeeEntry
from app.schemas.organization import MinutesSettingsUpdate
from app.services.onboarding import OnboardingService
from app.utils.minutes_attendance import (
    counts_toward_quorum,
    is_listed,
    normalize_attendee,
)
from app.utils.minutes_pdf import _STATUS_LABELS
from app.utils.minutes_public import narrow_for_public
from app.utils.minutes_settings import attendance_listing_in, quorum_counting_in
from app.utils.motion_votes import members_present, settle_roll_call
from tests.minutes_support import MANAGE, _client, _create, _org, _user, _World

ROLL = [
    {"name": "Pat", "status": "present"},
    {"name": "Lee", "status": "late"},
    {"name": "Ed", "status": "left_early"},
    {"name": "Pru", "status": "proxy"},
    {"name": "Xia", "status": "excused"},
    {"name": "Gus", "status": "guest"},
]


def _counted(settings: Any) -> set[str]:
    rule = quorum_counting_in(settings)
    return {e["name"] for e in ROLL if counts_toward_quorum(e, rule.statuses)}


@pytest.mark.unit
class TestTheRule:
    @pytest.mark.parametrize(
        "settings", [None, {}, {"minutes": None}, {"minutes": {}}, "junk"]
    )
    def test_absent_settings_count_who_they_always_counted(self, settings: Any):
        rule = quorum_counting_in(settings)
        assert (rule.late, rule.left_early, rule.proxies) == (True, True, False)
        assert _counted(settings) == {"Pat", "Lee", "Ed"}

    def test_a_department_can_stop_counting_members_who_left_early(self):
        settings = {"minutes": {"quorum_counts_left_early": False}}
        assert _counted(settings) == {"Pat", "Lee"}

    def test_a_department_can_stop_counting_late_arrivals(self):
        settings = {"minutes": {"quorum_counts_late": False}}
        assert _counted(settings) == {"Pat", "Ed"}

    def test_proxies_count_only_when_the_department_uses_them(self):
        assert "Pru" not in _counted({"minutes": {}})
        assert "Pru" in _counted({"minutes": {"proxy_attendance": True}})

    @pytest.mark.parametrize("value", [0, "false", "no", None, [], 1])
    def test_a_malformed_value_reads_as_the_default(self, value: Any):
        rule = quorum_counting_in(
            {
                "minutes": {
                    "quorum_counts_late": value,
                    "quorum_counts_left_early": value,
                    "proxy_attendance": value,
                }
            }
        )
        assert (rule.late, rule.left_early, rule.proxies) == (True, True, False)

    def test_present_always_counts_and_a_guest_never_does(self):
        settings = {
            "minutes": {
                "quorum_counts_late": False,
                "quorum_counts_left_early": False,
                "proxy_attendance": True,
            }
        }
        assert _counted(settings) == {"Pat", "Pru"}

    def test_the_default_rule_describes_nothing_extra(self):
        assert quorum_counting_in({}).note() == ""
        note = quorum_counting_in(
            {"minutes": {"quorum_counts_left_early": False, "proxy_attendance": True}}
        ).note()
        assert note == "members who left early not counted; proxies counted"


@pytest.mark.unit
class TestTheProxyStatus:
    def test_a_proxy_is_stored_as_such_and_is_not_in_the_room(self):
        stored = normalize_attendee({"name": "Pru", "status": "proxy"})
        assert stored["status"] == "proxy"
        assert stored["present"] is False

    def test_the_schema_accepts_a_proxy(self):
        entry = AttendeeEntry(name="Pru", status="proxy")
        assert entry.status == "proxy"
        assert entry.present is False

    def test_a_proxy_is_not_a_member_present_for_a_vote(self):
        assert members_present(ROLL) == 3
        with pytest.raises(ValueError, match="not recorded as present"):
            settle_roll_call([{"name": "Pru", "vote": "yes"}], ROLL)

    @pytest.mark.parametrize("listing", ["all", "present_excused", "present"])
    def test_every_listing_names_a_proxy(self, listing: str):
        # A proxy may have made the quorum; the minutes say who was represented.
        assert is_listed("proxy", listing)

    def test_the_printed_copy_labels_a_proxy(self):
        assert _STATUS_LABELS["proxy"] == "Represented by proxy"

    def test_the_public_copy_counts_proxies_apart_from_members_present(self):
        public = narrow_for_public(
            {"attendees": ROLL, "attendance_listing": "all", "sections": []}
        )
        assert public["attendance"]["present"] == 3
        assert public["attendance"]["proxies"] == 1

    def test_the_public_copy_says_nothing_of_proxies_when_there_are_none(self):
        roll = [e for e in ROLL if e["status"] != "proxy"]
        public = narrow_for_public(
            {"attendees": roll, "attendance_listing": "all", "sections": []}
        )
        assert "proxies" not in public["attendance"]


@pytest.mark.unit
class TestTheSettingsSchema:
    def test_the_switches_are_typed(self):
        with pytest.raises(ValidationError):
            MinutesSettingsUpdate(quorum_counts_left_early="maybe")
        with pytest.raises(ValidationError):
            MinutesSettingsUpdate(proxy_attendance="sometimes")

    def test_the_switches_are_accepted(self):
        update = MinutesSettingsUpdate(
            quorum_counts_late=False,
            quorum_counts_left_early=False,
            proxy_attendance=True,
        )
        assert update.model_dump(exclude_unset=True) == {
            "quorum_counts_late": False,
            "quorum_counts_left_early": False,
            "proxy_attendance": True,
        }


# ── Over HTTP, against the real schema ──────────────────────────────


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


async def _department(w: _World, **minutes: Any) -> None:
    org = await w.db.get(Organization, w.org_id)
    assert org is not None
    org.settings = {**(org.settings or {}), "minutes": minutes}
    await w.db.flush()


async def _quorum(w: _World) -> dict[str, Any]:
    minutes = await _create(w, attendees=ROLL)
    async with _client(w.db, w.secretary) as c:
        resp = await c.patch(
            f"/minutes/{minutes['id']}/quorum-config",
            params={"quorum_type": "count", "quorum_threshold": 3},
        )
        assert resp.status_code == 200, resp.text
        resp = await c.get(f"/minutes/{minutes['id']}/quorum")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.integration
class TestQuorumReadsTheSetting:
    async def test_an_untouched_department_counts_as_before(self, world: _World):
        result = await _quorum(world)
        assert result["present_count"] == 3
        assert result["quorum_met"] is True

    async def test_members_who_left_early_can_be_left_out(self, world: _World):
        await _department(world, quorum_counts_left_early=False)
        result = await _quorum(world)
        assert result["present_count"] == 2
        assert result["quorum_met"] is False

    async def test_proxies_count_when_the_department_uses_them(self, world: _World):
        await _department(world, proxy_attendance=True)
        result = await _quorum(world)
        assert result["present_count"] == 4

    async def test_the_settings_screen_is_told_what_is_applied(self, world: _World):
        async with _client(world.db, world.secretary) as c:
            resp = await c.get("/minutes/settings")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["quorum_counts_late"] is True
        assert body["quorum_counts_left_early"] is True
        assert body["proxy_attendance"] is False

        await _department(world, quorum_counts_late=False, proxy_attendance=True)
        async with _client(world.db, world.secretary) as c:
            body = (await c.get("/minutes/settings")).json()
        assert body["quorum_counts_late"] is False
        assert body["proxy_attendance"] is True


@pytest.mark.integration
class TestANewInstallListsPresentOnly:
    """Owner decision 2026-11-01: present only for new installs, existing ones
    unchanged. A department that never chose reads ``all`` (the upgrade case);
    a department created now has ``present`` written into its settings."""

    async def test_a_department_created_by_setup_lists_present_only(
        self, db_session: AsyncSession
    ):
        org = await OnboardingService(db_session).create_organization(
            name="New Department", slug="new-department-listing"
        )
        assert org.settings["minutes"]["attendance_listing"] == "present"
        assert attendance_listing_in(org.settings) == "present"

    async def test_a_caller_that_chose_keeps_its_choice(self, db_session: AsyncSession):
        org = await OnboardingService(db_session).create_organization(
            name="Chooser",
            slug="chooser-listing",
            settings_dict={"minutes": {"attendance_listing": "all"}},
        )
        assert attendance_listing_in(org.settings) == "all"

    async def test_an_existing_department_that_never_chose_is_unchanged(
        self, world: _World
    ):
        org = await world.db.get(Organization, world.org_id)
        assert org is not None
        assert "attendance_listing" not in (org.settings or {}).get("minutes", {})
        assert attendance_listing_in(org.settings) == "all"
