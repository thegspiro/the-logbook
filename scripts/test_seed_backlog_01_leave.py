"""The guide 01 leave badges are dated from today on every seed.

Rafael Duarte's three leaves were made once, dated from that first seed, and
never moved: a week later the one meant to be in progress had ended, so 01-57's
Active badge and 01-61's "Your leave" both lost their subject. They are now
dated from today on every seed.
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


if __name__ == "__main__":
    unittest.main()
