"""The guide 01 leave seed steps keep their dates current and their state once.

Rafael Duarte's three leaves were made once, dated from that first seed, and
never moved: a week later the one meant to be in progress had ended, so 01-57's
Active badge and 01-61's "Your leave" both lost their subject. They are now
dated from today on every seed.

Leave requests are opt-in, and on they add Leave Requests to every sidebar. The
step switches them on only to file its two requests, then puts the setting
back, and a member with a request already pending gets no second one.
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


class LeaveApi:
    """Rafael Duarte's recorded leaves, seeded a week ago."""

    def __init__(self) -> None:
        stale = seed.TODAY - timedelta(days=7)
        self.leaves = [
            {
                "id": f"leave-{n}",
                "reason": reason,
                "start_date": str(stale + timedelta(days=start)),
                "end_date": str(stale + timedelta(days=end)),
            }
            for n, (start, end, _kind, reason) in enumerate(
                seed.Seeder.BACKLOG_01_LEAVES
            )
        ]
        self.posts: list[str] = []

    def get(self, path: str):
        if path.startswith("/users?"):
            return [{"id": "rafael", "username": "rduarte"}]
        if path == "/users/rafael/leaves-of-absence":
            return list(self.leaves)
        raise AssertionError(f"unexpected GET {path}")

    def patch(self, path: str, payload: dict):
        leave = next(lv for lv in self.leaves if path.endswith(lv["id"]))
        leave.update(payload)
        return leave

    def post(self, path: str, payload: dict):
        self.posts.append(path)
        return payload


class RequestsApi:
    """The administrator's view of leave settings and requests."""

    def __init__(self, *, enabled: bool = False) -> None:
        self.settings = {
            "requests_enabled": enabled,
            "request_escalation_days": 21,
            "available_positions": [{"id": "p", "name": "Chief", "holder_count": 0}],
        }
        self.puts: list[bool] = []

    def get(self, path: str):
        assert path == "/users/leaves-of-absence/settings", path
        return dict(self.settings)

    def put(self, path: str, payload: dict):
        assert "available_positions" not in payload
        self.puts.append(payload["requests_enabled"])
        self.settings.update(payload)
        return self.settings


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheLeaveBadgesStayCurrent(unittest.TestCase):
    def test_a_week_old_set_is_dated_from_today_again(self):
        api = LeaveApi()

        seed.Seeder(api, "http://127.0.0.1:3001").seed_backlog_01_leave_badges()

        dates = [(lv["start_date"], lv["end_date"]) for lv in api.leaves]
        assert dates == [
            (str(seed.TODAY + timedelta(days=s)), str(seed.TODAY + timedelta(days=e)))
            for s, e, _kind, _reason in seed.Seeder.BACKLOG_01_LEAVES
        ]
        assert api.posts == []


class TestTheRequestsSwitchIsPutBack(unittest.TestCase):
    def _seeder(self, api: RequestsApi, opened: list[bool]):
        seeder = seed.Seeder(api, "http://127.0.0.1:3001")

        def open_requests() -> dict[str, str]:
            opened.append(api.settings["requests_enabled"])
            return {"leave requests": "already"}

        seeder._backlog01_open_leave_requests = open_requests
        return seeder

    def test_requests_are_on_while_filed_and_off_afterwards(self):
        api = RequestsApi(enabled=False)
        opened: list[bool] = []

        self._seeder(api, opened).seed_backlog_01_leave_requests()

        assert opened == [True]
        assert api.puts == [True, False]
        assert api.settings["requests_enabled"] is False

    def test_a_department_that_takes_requests_is_left_on(self):
        api = RequestsApi(enabled=True)
        opened: list[bool] = []

        self._seeder(api, opened).seed_backlog_01_leave_requests()

        assert opened == [True]
        assert api.puts == []

    def test_the_switch_is_put_back_when_filing_fails(self):
        api = RequestsApi(enabled=False)
        seeder = seed.Seeder(api, "http://127.0.0.1:3001")

        def fail() -> dict[str, str]:
            raise seed.ApiError("POST", "/users/leave-requests", 400, "refused")

        seeder._backlog01_open_leave_requests = fail

        raised = False
        try:
            seeder.seed_backlog_01_leave_requests()
        except seed.ApiError:
            raised = True

        assert raised
        assert api.settings["requests_enabled"] is False


if __name__ == "__main__":
    unittest.main()
