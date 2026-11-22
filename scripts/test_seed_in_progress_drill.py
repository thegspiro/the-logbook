"""The seeder keeps its in-progress drill live across re-runs.

The check-in monitor pictures "Company Drill — In Progress", so each seed run
slides it to start two hours ago. The first run checks nine members in to it.
On the next run the API refuses to move an event whose members are checked in
at a time outside its new schedule ("Postpone the event instead ... or remove
or correct those check-ins first"), so the slide failed and the drill stayed
on the day it was first seeded, with the monitor showing a closed event.

Postponing cannot be used: it refuses a new start in the past, and the drill
has to have started already. So the old window's check-ins are removed first,
the way the refusal names, and the seeder's check-in step rebuilds them
against the new window on the same run. A capture can also finalize the drill
once it has ended; that is reopened first, as the other live fixtures do.
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

DRILL_ID = "drill-1"


class FakeApi:
    """The slice of the events API the slide touches, with its refusals.

    A finalized event refuses removing an attendee as well as moving, as the
    real API does ("Attendance for this event has been finalized, so removing
    an attendee is no longer available"). An earlier version of this fake
    refused only the move, so it passed a seeder that removed check-ins before
    reopening, which the real API refused on every run after a capture had
    finalized the drill.
    """

    def __init__(self, *, finalized: bool = False) -> None:
        stale_start = seed.NOW - timedelta(days=8)
        self.events = [
            {
                "id": DRILL_ID,
                "title": seed.IN_PROGRESS_EVENT_TITLE,
                "start_datetime": seed.iso(stale_start),
                "end_datetime": seed.iso(stale_start + timedelta(hours=4)),
            }
        ]
        # Every other planned event already exists, so seed_events creates
        # nothing and the test is about the slide alone.
        for title in (
            "Winter Drill Series",
            "Quarterly Business Meeting",
            "Hose Testing Day",
            "Monthly Business Meeting",
            "Q3 Ladder Operations Drill",
            "Pump Operations Refresher",
            "Live Fire Evolutions",
            "Station 2 Open House",
            "Officer Development Session",
            "Annual Awards Banquet",
            seed.Seeder.RECURRING_SERIES_TITLE,
        ):
            self.events.append({"id": title, "title": title})
        self.rsvps = {
            f"member-{n}": {
                "user_id": f"member-{n}",
                "checked_in": True,
                "checked_in_at": seed.iso(stale_start + timedelta(minutes=5)),
            }
            for n in range(9)
        }
        self.finalized = finalized
        self.calls: list[tuple[str, str]] = []

    def get(self, path: str):
        self.calls.append(("GET", path))
        if path.startswith("/events?"):
            return self.events
        if path == f"/events/{DRILL_ID}/rsvps":
            return list(self.rsvps.values())
        if path == f"/events/{DRILL_ID}":
            return {
                **self.events[0],
                "attendance_finalized_at": (
                    seed.iso(seed.NOW - timedelta(days=7)) if self.finalized else None
                ),
            }
        raise AssertionError(f"unexpected GET {path}")

    def patch(self, path: str, payload: dict):
        self.calls.append(("PATCH", path))
        assert path == f"/events/{DRILL_ID}", path
        if self.finalized:
            raise seed.ApiError(
                "PATCH", path, 409, "Attendance has been finalized for this event."
            )
        if any(r["checked_in"] for r in self.rsvps.values()):
            raise seed.ApiError(
                "PATCH",
                path,
                400,
                f"{len(self.rsvps)} members are already checked in at a time "
                "outside the new schedule",
            )
        drill = self.events[0]
        drill.update(payload)
        return drill

    def post(self, path: str, payload: dict):
        self.calls.append(("POST", path))
        if path == f"/events/{DRILL_ID}/reopen-attendance":
            self.finalized = False
            return {}
        raise AssertionError(f"unexpected POST {path}")

    def delete(self, path: str):
        self.calls.append(("DELETE", path))
        prefix = f"/events/{DRILL_ID}/rsvps/"
        assert path.startswith(prefix), path
        if self.finalized:
            raise seed.ApiError(
                "DELETE",
                path,
                409,
                "Attendance for this event has been finalized, so removing an "
                "attendee is no longer available.",
            )
        self.rsvps.pop(path[len(prefix) :])
        return None


def _slide(api: FakeApi) -> dict:
    seed.Seeder(api, "http://127.0.0.1:3001").seed_events()
    return api.events[0]


# A unittest.TestCase because CI collects scripts/ with `unittest discover`,
# which does not see plain pytest functions; plain asserts inside it fail the
# test all the same.
class TestTheDrillSlidesForwardOnARerun(unittest.TestCase):
    def test_a_drill_with_last_runs_check_ins_moves_to_now(self):
        api = FakeApi()

        drill = _slide(api)

        start = (seed.NOW - timedelta(hours=2)).replace(
            minute=0, second=0, microsecond=0
        )
        assert drill["start_datetime"] == seed.iso(start)
        # The old window's attendance is gone; the check-in step rebuilds it.
        assert api.rsvps == {}

    def test_a_finalized_drill_is_reopened_before_it_moves(self):
        api = FakeApi(finalized=True)

        drill = _slide(api)

        assert ("POST", f"/events/{DRILL_ID}/reopen-attendance") in api.calls
        assert drill["end_datetime"] > seed.iso(seed.NOW)

    def test_a_drill_still_running_is_left_alone(self):
        api = FakeApi()
        live_start = seed.NOW - timedelta(hours=1)
        api.events[0].update(
            start_datetime=seed.iso(live_start),
            end_datetime=seed.iso(live_start + timedelta(hours=4)),
        )

        _slide(api)

        assert "PATCH" not in [method for method, _ in api.calls]
        assert len(api.rsvps) == 9


if __name__ == "__main__":
    unittest.main()
