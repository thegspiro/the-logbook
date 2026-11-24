"""The officer close-out fixture is made once and topped up, never doubled.

Guide 03 pictures close-out step 1 as a Shift Officer without
scheduling.manage. The fixture is an ended shift whose officer is a
firefighter. Naming the officer on the shift seats them already, so seating
them again is refused, and a candidate on another shift at those hours is
refused too; the step takes the next candidate. A re-run finds the shift by
its note and adds only what is missing.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCREENSHOTS = Path(__file__).resolve().parent / "screenshots"


def _load_seeder():
    # The seeder imports its sibling bootstrap_demo by bare name, so its
    # directory has to be importable first.
    sys.path.insert(0, str(SCREENSHOTS))
    import seed_demo_data

    return seed_demo_data


seed = _load_seeder()

USERNAMES = ("ytanaka", "isolberg", "smarchetti", "vbrennan", "rduarte")
# Already on another shift at the fixture's hours.
BUSY = {"u-isolberg"}


class FakeApi:
    def __init__(self) -> None:
        self.shifts: list[dict] = []
        self.assignments: list[dict] = []
        self.attendance: list[dict] = []

    def get(self, path: str):
        if path.startswith("/scheduling/shifts?"):
            return list(self.shifts)
        if path.startswith("/users?"):
            return [{"id": f"u-{name}", "username": name} for name in USERNAMES]
        if path.endswith("/assignments"):
            return list(self.assignments)
        if path.endswith("/attendance"):
            return list(self.attendance)
        raise AssertionError(f"unexpected GET {path}")

    def post(self, path: str, payload: dict):
        if path == "/scheduling/shifts":
            shift = {"id": "fixture", **payload}
            self.shifts.append(shift)
            # Naming the Shift Officer seats them, as the API does.
            self.assignments.append({"user_id": payload["shift_officer_id"]})
            return shift
        if path.endswith("/assignments"):
            seated = {a["user_id"] for a in self.assignments}
            if payload["user_id"] in seated:
                raise seed.ApiError("POST", path, 400, "already assigned")
            if payload["user_id"] in BUSY:
                raise seed.ApiError("POST", path, 409, "on another shift")
            self.assignments.append(payload)
            return payload
        if path.endswith("/attendance"):
            self.attendance.append(payload)
            return payload
        raise AssertionError(f"unexpected POST {path}")


def _run(api: FakeApi) -> str:
    return seed.Seeder(api, "http://127.0.0.1:3001").seed_backlog_03_officer_closeout()


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheOfficerCloseoutFixture(unittest.TestCase):
    def test_the_officer_and_two_free_members_are_seated_and_checked_in(self):
        api = FakeApi()

        _run(api)

        crew = [a["user_id"] for a in api.assignments]
        assert crew == ["u-ytanaka", "u-smarchetti", "u-vbrennan"]
        assert sorted(a["user_id"] for a in api.attendance) == sorted(crew)
        assert api.shifts[0]["shift_officer_id"] == "u-ytanaka"

    def test_a_rerun_adds_nothing(self):
        api = FakeApi()
        _run(api)

        result = _run(api)

        assert len(api.shifts) == 1
        assert len(api.assignments) == 3
        assert len(api.attendance) == 3
        assert result == "3 on the crew, 0 check-ins added"


if __name__ == "__main__":
    unittest.main()
