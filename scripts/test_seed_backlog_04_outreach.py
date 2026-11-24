"""The guide 04 outreach seed steps make their state once and keep it.

Three steps feed the outreach screenshots: role presets on two request types,
an outreach event whose signup sheet is three of five filled, and the pre-K
tour's close-out. Each runs on every seed, so a second run must add nothing:
no second preset over one somebody edited, no member seated twice, no close-out
written over one already recorded.
"""

from __future__ import annotations

import copy
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

USERS = [
    {"id": f"u-{name}", "username": name}
    for name in ("isolberg", "ytanaka", "mbell")
]


class FakeApi:
    """Event settings, events, staffing, assignments and the close-out."""

    def __init__(self) -> None:
        self.settings = {
            "outreach_event_types": [
                {"value": "fire_safety_demo", "label": "Fire Safety Demo"},
                {"value": "station_tour", "label": "Station Tour"},
                {"value": "other", "label": "Other"},
            ]
        }
        self.events = [{"id": "tour", "title": "Pre-K station tour"}]
        self.event_detail = {"tour": {"id": "tour", "outreach_outcome_note": None}}
        self.staffing: dict[str, dict] = {}
        self.assignments: dict[str, list[dict]] = {}
        self.writes: list[tuple[str, str]] = []

    def get(self, path: str):
        if path == "/events/settings":
            return copy.deepcopy(self.settings)
        if path.startswith("/events?"):
            return list(self.events)
        if path.startswith("/users?"):
            return USERS
        if path == "/scheduling/apparatus-options":
            return {"options": [{"id": "e1", "name": "Engine 1"}]}
        if path.endswith("/staffing"):
            return self.staffing.get(path.split("/")[2], {})
        if path.endswith("/assignments"):
            return self.assignments.get(path.split("/")[3], [])
        if path.startswith("/events/"):
            return self.event_detail[path.split("/")[2]]
        raise AssertionError(f"unexpected GET {path}")

    def patch(self, path: str, payload: dict):
        self.writes.append(("PATCH", path))
        assert path == "/events/settings", path
        self.settings.update(payload)
        return self.settings

    def put(self, path: str, payload: dict):
        self.writes.append(("PUT", path))
        event_id = path.split("/")[2]
        self.event_detail[event_id]["outreach_outcome_note"] = payload["outcome_note"]
        return self.event_detail[event_id]

    def post(self, path: str, payload: dict):
        self.writes.append(("POST", path))
        if path == "/events":
            event = {"id": "story", **payload}
            self.events.append(event)
            return event
        if path.endswith("/staffing"):
            event_id = path.split("/")[2]
            self.staffing[event_id] = {"shift_id": "sheet"}
            return self.staffing[event_id]
        if path.endswith("/assignments"):
            self.assignments.setdefault("sheet", []).append(payload)
            return payload
        raise AssertionError(f"unexpected POST {path}")


def _seeder(api: FakeApi):
    return seed.Seeder(api, "http://127.0.0.1:3001")


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheOutreachStepsRunOnce(unittest.TestCase):
    def test_presets_go_on_the_two_types_and_are_not_rewritten(self):
        api = FakeApi()

        _seeder(api).seed_backlog_04_type_role_preset()
        presets = {
            t["value"]: t.get("default_roles")
            for t in api.settings["outreach_event_types"]
        }
        api.writes.clear()
        second = _seeder(api).seed_backlog_04_type_role_preset()

        assert presets == {
            "fire_safety_demo": [
                {"role": "demonstrator", "count": 2},
                {"role": "educator", "count": 1},
            ],
            "station_tour": [
                {"role": "tour_guide", "count": 2},
                {"role": "greeter", "count": 1},
            ],
            "other": None,
        }
        assert second == "already"
        assert api.writes == []

    def test_an_edited_preset_is_kept(self):
        api = FakeApi()
        api.settings["outreach_event_types"][1]["default_roles"] = [
            {"role": "greeter", "count": 4}
        ]

        _seeder(api).seed_backlog_04_type_role_preset()

        station_tour = api.settings["outreach_event_types"][1]
        assert station_tour["default_roles"] == [{"role": "greeter", "count": 4}]

    def test_the_sheet_seats_three_volunteers_once(self):
        api = FakeApi()

        _seeder(api).seed_backlog_04_volunteer_staffing()
        _seeder(api).seed_backlog_04_volunteer_staffing()

        seated = [(a["user_id"], a["outreach_role"]) for a in api.assignments["sheet"]]
        assert seated == [
            ("u-isolberg", "educator"),
            ("u-ytanaka", "educator"),
            ("u-mbell", "greeter"),
        ]
        assert [p for m, p in api.writes if p == "/events"] == ["/events"]

    def test_a_recorded_closeout_is_not_written_again(self):
        api = FakeApi()

        first = _seeder(api).seed_backlog_04_outreach_closeout()
        second = _seeder(api).seed_backlog_04_outreach_closeout()

        assert (first, second) == ("recorded", "already")
        assert api.writes == [("PUT", "/events/tour/outreach-closeout")]


if __name__ == "__main__":
    unittest.main()
