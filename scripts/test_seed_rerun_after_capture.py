"""The demo seeder re-runs cleanly on a database a capture has already used.

The screenshot README says to seed before every capture, and a capture leaves
state behind: it moves applicants on (`15-09` runs a real bulk advance), checks
members in to live events, and finalizes events. Each case below failed a seed
run that followed a full capture. The in-progress drill has its own file,
test_seed_in_progress_drill.py.
"""

from __future__ import annotations

import sys
import unittest
from datetime import timedelta
from pathlib import Path

SCREENSHOTS = Path(__file__).resolve().parent / "screenshots"


def _load_seeder():
    # The seeder imports its sibling bootstrap_demo by bare name, so its
    # directory has to be importable first.
    sys.path.insert(0, str(SCREENSHOTS))
    import seed_demo_data

    return seed_demo_data


seed = _load_seeder()

STAGES = ["Interest Form", "Welcome Call", "Follow-up Form", "Welcome Packet Email"]


class FakePipelineApi:
    """A pipeline's stages and one applicant's position, moved by the API."""

    def __init__(self, stage: str) -> None:
        self.stage = stage
        self.calls: list[str] = []

    def get(self, path: str):
        assert path == "/prospective-members/pipelines/pipe-1", path
        # Out of order on purpose: the walk must sort by sort_order.
        return {
            "steps": [
                {"name": name, "sort_order": i}
                for i, name in reversed(list(enumerate(STAGES)))
            ]
        }

    def post(self, path: str, payload: dict):
        self.calls.append(path)
        index = STAGES.index(self.stage)
        if path.endswith("/advance"):
            if index == len(STAGES) - 1:
                raise seed.ApiError(
                    "POST", path, 409, "Prospect is already at the final stage"
                )
            self.stage = STAGES[index + 1]
        elif path.endswith("/regress"):
            self.stage = STAGES[index - 1]
        return {}


def _walk(api: FakePipelineApi) -> dict:
    seeder = seed.Seeder(api, "http://127.0.0.1:3001")
    seeder.BACKLOG15_FOLLOW_UP_STAGE = "Follow-up Form"
    seeder._backlog15_applicant = lambda who, pipeline_id: {
        "id": "p-1",
        "current_step_name": api.stage,
    }
    return seeder._backlog15_walk_to_follow_up(
        {"id": "p-1", "current_step_name": api.stage}, "pipe-1"
    )


class TestTheFollowUpApplicantIsWalkedToTheirStage(unittest.TestCase):
    def test_an_applicant_a_capture_moved_to_the_final_stage_is_walked_back(self):
        # 15-09's bulk advance left them here, where an advance is refused.
        api = FakePipelineApi("Welcome Packet Email")

        prospect = _walk(api)

        assert prospect["current_step_name"] == "Follow-up Form"
        assert api.calls == ["/prospective-members/prospects/p-1/regress"]

    def test_a_new_applicant_one_stage_short_is_advanced(self):
        api = FakePipelineApi("Welcome Call")

        prospect = _walk(api)

        assert prospect["current_step_name"] == "Follow-up Form"
        assert api.calls == ["/prospective-members/prospects/p-1/advance"]


ENGINE_TEMPLATE = "tmpl-engine"
DAY = (seed.TODAY + timedelta(days=1)).isoformat()


class FakeMember:
    """The demo member's side: their shifts, their checklists, submitting."""

    def __init__(self, shifts: list[dict], checklists: list[dict]) -> None:
        self.shifts = shifts
        self.checklists = checklists
        self.checks: dict[str, list[dict]] = {}
        self.engine_ids: set[str] = {s["id"] for s in shifts if s["engine"]}

    def login_as(self, username: str, password: str) -> None:
        pass

    def get(self, path: str):
        if path.startswith("/scheduling/my-shifts"):
            return [{"id": s["id"], "shift_date": s["date"]} for s in self.shifts]
        if path == "/equipment-checks/my-checklists":
            return self.checklists
        if path.startswith("/equipment-checks/shifts/") and path.endswith("/checks"):
            return self.checks.get(path.split("/")[3], [])
        raise AssertionError(f"unexpected member GET {path}")

    def post(self, path: str, payload: dict):
        shift_id = path.split("/")[3]
        if shift_id not in self.engine_ids:
            raise seed.ApiError(
                "POST", path, 400, "Template is not applicable to this shift"
            )
        answered = all(row.get("status") != "not_checked" for row in payload["items"])
        self.checks.setdefault(shift_id, []).append(
            {"status": "pass" if answered else "incomplete"}
        )
        return {}


class FakeAdmin:
    """The administrator's side: the roster, every shift, seating a member."""

    def __init__(self, member: FakeMember, open_engine_shifts: list[str]) -> None:
        self.member = member
        self.open_engine_shifts = open_engine_shifts
        self.seated: list[str] = []

    def get(self, path: str):
        if path.startswith("/users"):
            return [{"id": "u-member", "username": seed.DEMO_MEMBER_USERNAME}]
        if path.startswith("/scheduling/shifts?"):
            return [
                {"id": sid, "shift_date": DAY, "apparatus_unit_number": "E-1"}
                for sid in self.open_engine_shifts
            ]
        if path == f"/equipment-checks/templates/{ENGINE_TEMPLATE}":
            return {}
        raise AssertionError(f"unexpected admin GET {path}")

    def post(self, path: str, payload: dict):
        shift_id = path.split("/")[3]
        assert payload["user_id"] == "u-member"
        self.seated.append(shift_id)
        self.member.shifts.append({"id": shift_id, "date": DAY, "engine": True})
        self.member.engine_ids.add(shift_id)
        return {}


ROWS = [
    {"compartment_name": "Cab", "item_id": "a", "status": "pass"},
    {"compartment_name": "As-Carried Kit", "item_id": "b", "status": "pass"},
]


def _run_checklist_step(member: FakeMember, admin: FakeAdmin) -> seed.Seeder:
    original = seed.Api
    seed.Api = lambda base_url: member
    try:
        seeder = seed.Seeder(admin, "http://127.0.0.1:3001")
        seeder._checkable_rows = lambda detail: [dict(row) for row in ROWS]
        seeder._seed_member_checklist_states(ENGINE_TEMPLATE)
        return seeder
    finally:
        seed.Api = original


def _results(member: FakeMember) -> list[str]:
    return sorted(c["status"] for checks in member.checks.values() for c in checks)


class TestTheMemberChecklistStatesSurviveARerun(unittest.TestCase):
    def test_a_finished_check_from_an_earlier_run_is_not_made_again(self):
        # The list says "pass", in camelCase, with no completion flag; the
        # finished check went unnoticed and each run spent the member's one
        # free engine shift on another, leaving none for the part-answered one.
        member = FakeMember(
            shifts=[
                {"id": "engine-done", "date": DAY, "engine": True},
                {"id": "engine-free", "date": DAY, "engine": True},
                {"id": "ladder", "date": DAY, "engine": False},
            ],
            checklists=[{"shiftId": "engine-done", "status": "pass"}],
        )
        member.checks["engine-done"] = [{"status": "pass"}]

        seeder = _run_checklist_step(member, FakeAdmin(member, []))

        assert seeder.blocked == []
        assert member.checks["engine-free"] == [{"status": "incomplete"}]

    def test_a_member_with_no_free_engine_shift_is_seated_on_one(self):
        # Their own spare shifts are a ladder and a brush unit, which the
        # engine-only template refuses.
        member = FakeMember(
            shifts=[
                {"id": "engine-done", "date": DAY, "engine": True},
                {"id": "ladder", "date": DAY, "engine": False},
                {"id": "brush", "date": DAY, "engine": False},
            ],
            checklists=[{"shiftId": "engine-done", "status": "pass"}],
        )
        member.checks["engine-done"] = [{"status": "pass"}]
        admin = FakeAdmin(member, ["engine-open"])

        seeder = _run_checklist_step(member, admin)

        assert seeder.blocked == []
        assert admin.seated == ["engine-open"]
        assert _results(member) == ["incomplete", "pass"]


GUEST_EVENT = "guest-1"


class FakeEventsApi:
    """A guest open house that ended, with a member a capture checked in."""

    def __init__(self, *, finalized: bool) -> None:
        stale = seed.NOW - timedelta(days=2)
        self.event = {
            "id": GUEST_EVENT,
            "title": seed.Seeder.GUEST_EVENT_TITLE,
            "start_datetime": seed.iso(stale),
            "end_datetime": seed.iso(stale + timedelta(hours=4)),
        }
        self.finalized = finalized
        self.rsvps = {"member-1": {"user_id": "member-1", "checked_in": True}}
        self.calls: list[tuple[str, str]] = []

    def get(self, path: str):
        self.calls.append(("GET", path))
        if path.startswith("/events?"):
            return [self.event]
        if path == f"/events/{GUEST_EVENT}":
            return {
                **self.event,
                "attendance_finalized_at": (
                    "2026-01-01T00:00:00Z" if self.finalized else None
                ),
            }
        if path == f"/events/{GUEST_EVENT}/rsvps":
            return list(self.rsvps.values())
        raise AssertionError(f"unexpected GET {path}")

    def post(self, path: str, payload: dict):
        self.calls.append(("POST", path))
        assert path == f"/events/{GUEST_EVENT}/reopen-attendance", path
        self.finalized = False
        return {}

    def delete(self, path: str):
        self.calls.append(("DELETE", path))
        if self.finalized:
            raise seed.ApiError("DELETE", path, 409, "Attendance ... finalized")
        self.rsvps.pop(path.rsplit("/", 1)[1])

    def patch(self, path: str, payload: dict):
        self.calls.append(("PATCH", path))
        if "start_datetime" in payload and any(
            r["checked_in"] for r in self.rsvps.values()
        ):
            raise seed.ApiError(
                "PATCH",
                path,
                400,
                "1 member is already checked in at a time " "outside the new schedule",
            )
        self.event.update(payload)
        return self.event


def _seed_guest_event(api: FakeEventsApi) -> None:
    seeder = seed.Seeder(api, "http://127.0.0.1:3001")
    seeder._sign_a_guest_in = lambda event_id, code: None
    seeder.seed_guest_check_in_event(
        [{"id": "loc-1", "name": "Training Centre", "display_code": "TC1"}]
    )


class TestTheGuestOpenHouseMovesPastACapturesCheckIns(unittest.TestCase):
    def test_an_ended_open_house_with_a_member_checked_in_moves_to_now(self):
        api = FakeEventsApi(finalized=False)

        _seed_guest_event(api)

        assert api.event["end_datetime"] > seed.iso(seed.NOW)
        assert api.rsvps == {}

    def test_a_finalized_open_house_is_reopened_before_its_check_in_goes(self):
        api = FakeEventsApi(finalized=True)

        _seed_guest_event(api)

        reopen = api.calls.index(("POST", f"/events/{GUEST_EVENT}/reopen-attendance"))
        delete = next(i for i, c in enumerate(api.calls) if c[0] == "DELETE")
        assert reopen < delete
        assert api.event["end_datetime"] > seed.iso(seed.NOW)


if __name__ == "__main__":
    unittest.main()
