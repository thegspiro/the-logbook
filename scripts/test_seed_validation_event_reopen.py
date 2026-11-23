"""The seeder unlocks the attendance-validation event a capture finalized.

Shot 19-31 pictures the inbox prompt to validate a finished event's attendance,
and 19-32 finalizes that attendance to picture the inbox afterwards. The lock
is `attendance_finalized_at`, which only reopening clears. The seeder emptied
`custom_fields` instead, which is where the lock was kept before that column
existed, so after one capture the event stayed finalized: the validation task
skipped it, and the next 19-32 was refused with a 400.
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

EVENT_ID = "drill-9"


class FakeApi:
    """The events API around the validation fixture, with the lock enforced."""

    def __init__(self, *, finalized: bool) -> None:
        self.event = {
            "id": EVENT_ID,
            "title": seed.Seeder.VALIDATION_EVENT_TITLE,
            "attendance_finalized_at": "2026-11-20T21:00:00Z" if finalized else None,
            "custom_fields": {},
        }
        self.calls: list[tuple[str, str]] = []

    def get(self, path: str):
        self.calls.append(("GET", path))
        assert path.startswith("/events?"), path
        return [self.event]

    def post(self, path: str, payload: dict):
        self.calls.append(("POST", path))
        if path == f"/events/{EVENT_ID}/reopen-attendance":
            self.event["attendance_finalized_at"] = None
            return self.event
        if path.startswith("/scheduled/run-task"):
            return {}
        raise AssertionError(f"unexpected POST {path}")

    def patch(self, path: str, payload: dict):
        self.calls.append(("PATCH", path))
        assert path == f"/events/{EVENT_ID}", path
        self.event.update(payload)
        return self.event


def _seed(api: FakeApi) -> dict:
    return seed.Seeder(api, "http://127.0.0.1:3001").seed_event_validation_notification()


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheValidationEventIsUnlockedOnARerun(unittest.TestCase):
    def test_a_finalized_event_is_reopened_before_it_moves(self):
        api = FakeApi(finalized=True)

        event = _seed(api)

        assert event["attendance_finalized_at"] is None
        reopen = api.calls.index(("POST", f"/events/{EVENT_ID}/reopen-attendance"))
        assert reopen < api.calls.index(("PATCH", f"/events/{EVENT_ID}"))

    def test_an_open_event_is_not_reopened(self):
        api = FakeApi(finalized=False)

        _seed(api)

        assert ("POST", f"/events/{EVENT_ID}/reopen-attendance") not in api.calls


if __name__ == "__main__":
    unittest.main()
