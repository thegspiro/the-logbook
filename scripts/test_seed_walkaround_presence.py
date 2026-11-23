"""A re-run of the seeder puts the walkaround's Present lines back to presence.

Guide 03 pictures the Utility 1 Walkaround check form with Present and Absent
buttons. `presence` was only added as a check type on 2026-10-18; before that
it collapsed into `function`, so a demo database seeded earlier holds the
walkaround with Pass/Fail lines. The seeder creates the template once and
skipped it on every later run, so the check form kept the old buttons and
shot 03-136 waited for an Absent button that never rendered.

Editing a line moves a published template back to draft, which takes it off
the member's Unscheduled checklist, so the seeder publishes it again.
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

WALKAROUND_ID = "walk-1"


class FakeApi:
    """The equipment-check templates API, holding an existing walkaround."""

    def __init__(self, cab_type: str, *, active: bool = True) -> None:
        self.active = active
        self.items = {
            "radio": {"id": "radio", "name": "Portable radio", "checkType": cab_type},
            "light": {"id": "light", "name": "Hand light", "checkType": cab_type},
            "vest": {"id": "vest", "name": "Traffic vest", "checkType": cab_type},
            "eyewash": {"id": "eyewash", "name": "Eyewash bottle", "checkType": "expiry"},
            "spill": {"id": "spill", "name": "Spill kit", "checkType": cab_type},
        }
        self.puts: list[tuple[str, dict]] = []
        self.posts: list[str] = []

    def get(self, path: str):
        if path == "/equipment-checks/templates":
            return [
                {"id": "draft-1", "name": seed.Seeder.BACKLOG_DRAFT_CHECKLIST},
                {"id": WALKAROUND_ID, "name": seed.Seeder.BACKLOG_CREW_CHECKLIST},
            ]
        if path == f"/equipment-checks/templates/{WALKAROUND_ID}":
            i = self.items
            return {
                "id": WALKAROUND_ID,
                "isActive": self.active,
                "compartments": [
                    {"name": "Cab", "items": [i["radio"], i["light"], i["vest"]]},
                    {"name": "Rear Compartment", "items": [i["eyewash"], i["spill"]]},
                ],
            }
        raise AssertionError(f"unexpected GET {path}")

    def put(self, path: str, payload: dict):
        self.puts.append((path, payload))
        if path == f"/equipment-checks/templates/{WALKAROUND_ID}":
            self.active = payload["is_active"]
            return {"id": WALKAROUND_ID, "isActive": self.active}
        item_id = path.rsplit("/", 1)[-1]
        self.items[item_id]["checkType"] = payload["check_type"]
        # The backend's _advance_content_revision: edited content is a draft.
        self.active = False
        return self.items[item_id]

    def post(self, path: str, payload: dict):
        self.posts.append(path)
        raise AssertionError(f"unexpected POST {path}: the templates already exist")


def _run(api: FakeApi) -> dict:
    return seed.Seeder(api, "http://127.0.0.1:3001").seed_backlog_03_checklist_lines()


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheWalkaroundKeepsItsPresentLines(unittest.TestCase):
    def test_lines_stored_as_function_are_put_back_to_presence(self):
        api = FakeApi(cab_type="function")

        _run(api)

        types = {item["name"]: item["checkType"] for item in api.items.values()}
        assert types == {
            "Portable radio": "presence",
            "Hand light": "presence",
            "Traffic vest": "presence",
            "Eyewash bottle": "expiry",
            "Spill kit": "presence",
        }

    def test_the_walkaround_is_published_again_after_the_edit(self):
        api = FakeApi(cab_type="function")

        _run(api)

        assert api.active is True

    def test_an_unpublished_walkaround_already_in_presence_is_published(self):
        api = FakeApi(cab_type="presence", active=False)

        _run(api)

        assert api.active is True
        assert [p for p, _ in api.puts] == [
            f"/equipment-checks/templates/{WALKAROUND_ID}"
        ]

    def test_the_date_line_is_left_alone(self):
        api = FakeApi(cab_type="function")

        _run(api)

        assert "/equipment-checks/items/eyewash" not in [p for p, _ in api.puts]

    def test_a_walkaround_already_in_presence_is_not_written(self):
        api = FakeApi(cab_type="presence")

        result = _run(api)

        assert api.puts == []
        assert result == {"crew": "already"}


if __name__ == "__main__":
    unittest.main()
