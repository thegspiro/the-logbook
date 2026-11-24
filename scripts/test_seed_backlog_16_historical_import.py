"""The seeder commits guide 16's legacy import, and puts it right after a capture.

Guide 16's undo shots undo the import's drills and training steps for real and
commit them again afterwards. The seeder has to leave the same state from any
starting point: no import yet, both steps committed, or a capture stopped part
way with a step undone.

Two rules carry the weight:

* The drills step links its held drill to a session-attendance requirement,
  which must be active to be chosen and to commit. An active one would grade
  every current member on attendance, so it is active only around the commit,
  and switched off again even when the commit fails.
* After an undo, a member the import created is either gone (their decision
  back to a bare "create", the typed name dropped) or kept because a record of
  theirs was edited (still mapped). Only the first kind gets a decision again:
  a second "create" for a kept member collides on the membership number.
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

BASE = "/integrations/historical-imports"
IMPORT_ID = "imp-1"
REQUIREMENT_ID = "req-1"
ALL_KEYS = {f"number:{n}" for n in seed.Seeder.HISTORICAL_MEMBERS}


class FakeApi:
    """The historical import and requirement endpoints the step uses."""

    def __init__(
        self,
        *,
        uploaded: bool = False,
        training: bool = False,
        drills: bool = False,
        waiting: set[str] | None = None,
        requirement: bool = False,
        fail_drills: bool = False,
    ) -> None:
        self.uploaded = uploaded
        self.training = training
        self.drills = drills
        self.waiting = set(ALL_KEYS if waiting is None else waiting)
        self.requirement = (
            {"id": REQUIREMENT_ID, "name": seed.Seeder.HISTORICAL_DRILL_REQUIREMENT}
            if requirement
            else None
        )
        self.requirement_active = False
        self.fail_drills = fail_drills
        self.calls: list[tuple[str, str]] = []
        self.decisions: dict = {}
        self.active_at_commit: bool | None = None
        self.active_at_settings: bool | None = None

    def get(self, path: str):
        self.calls.append(("GET", path))
        if path == BASE:
            return {
                "imports": (
                    [{"id": IMPORT_ID, "source_system": seed.Seeder.HISTORICAL_SOURCE}]
                    if self.uploaded
                    else [{"id": "other", "source_system": "Some other system"}]
                )
            }
        if path == f"{BASE}/{IMPORT_ID}/undo":
            return {
                "steps": {
                    "training": {"committed": self.training},
                    "drills": {"committed": self.drills},
                },
                "members_created": 4,
            }
        if path == f"{BASE}/{IMPORT_ID}/training":
            return {"members": [{"key": k} for k in sorted(self.waiting)]}
        if path == "/training/requirements?active_only=false":
            return [self.requirement] if self.requirement else []
        raise AssertionError(f"unexpected GET {path}")

    def post_file(self, path, fields, filename, file_bytes, mime_type):
        self.calls.append(("UPLOAD", path))
        assert path == BASE
        assert fields == {"source_system": seed.Seeder.HISTORICAL_SOURCE}
        assert file_bytes.decode().startswith("VID,Date,")
        self.uploaded = True
        return {"id": IMPORT_ID}

    def post(self, path: str, payload=None):
        self.calls.append(("POST", path))
        if path == f"{BASE}/{IMPORT_ID}/training/commit":
            self.training = True
            self.waiting = set()
            return {}
        if path == f"{BASE}/{IMPORT_ID}/drills/commit":
            self.active_at_commit = self.requirement_active
            if self.fail_drills:
                raise seed.ApiError("POST", path, 400, "refused")
            self.drills = True
            return {}
        if path == "/training/requirements":
            self.requirement = {"id": REQUIREMENT_ID, "name": payload["name"]}
            self.requirement_active = True
            assert payload["requirement_type"] == "session_attendance"
            return self.requirement
        raise AssertionError(f"unexpected POST {path}")

    def put(self, path: str, payload: dict):
        self.calls.append(("PUT", path))
        assert path == f"{BASE}/{IMPORT_ID}/members"
        self.decisions.update(payload["members"])
        return {}

    def patch(self, path: str, payload: dict):
        self.calls.append(("PATCH", path))
        if path == f"/training/requirements/{REQUIREMENT_ID}":
            self.requirement_active = payload["active"]
            return {}
        if path == f"{BASE}/{IMPORT_ID}/training-settings":
            self.active_at_settings = self.requirement_active
            assert payload == {"drill_requirement_ids": [REQUIREMENT_ID]}
            return {}
        raise AssertionError(f"unexpected PATCH {path}")


def _run(api: FakeApi) -> dict:
    return seed.Seeder(api, "http://127.0.0.1:3001").seed_backlog_16_historical_import()


def _writes(api: FakeApi) -> list[tuple[str, str]]:
    return [c for c in api.calls if c[0] != "GET"]


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheLegacyImportIsCommitted(unittest.TestCase):
    def test_a_new_import_is_uploaded_and_both_steps_committed(self):
        api = FakeApi()

        _run(api)

        assert api.uploaded
        assert api.training
        assert api.drills
        assert ("UPLOAD", BASE) in api.calls

    def test_every_member_is_created_with_their_name(self):
        api = FakeApi()

        _run(api)

        assert api.decisions == {
            f"number:{number}": {
                "action": "create",
                "first_name": first,
                "last_name": last,
            }
            for number, (first, last) in seed.Seeder.HISTORICAL_MEMBERS.items()
        }

    def test_a_committed_import_is_left_alone(self):
        api = FakeApi(uploaded=True, training=True, drills=True, requirement=True)

        result = _run(api)

        assert _writes(api) == []
        assert result == {"id": IMPORT_ID, "steps": "already committed"}


class TestTheDrillRequirementIsOnOnlyForTheCommit(unittest.TestCase):
    def test_it_is_active_when_chosen_and_committed_and_off_after(self):
        api = FakeApi(uploaded=True, training=True, requirement=True)

        _run(api)

        assert api.active_at_settings is True
        assert api.active_at_commit is True
        assert api.requirement_active is False

    def test_a_failed_commit_still_switches_it_off(self):
        api = FakeApi(uploaded=True, training=True, requirement=True, fail_drills=True)

        try:
            _run(api)
        except seed.ApiError:
            pass
        else:
            raise AssertionError("the refused drills commit was swallowed")

        assert api.requirement_active is False

    def test_a_new_requirement_starts_inactive_and_is_reused_after(self):
        api = FakeApi(uploaded=True, training=True)

        _run(api)

        assert api.requirement_active is False
        created = [c for c in api.calls if c == ("POST", "/training/requirements")]
        assert len(created) == 1

        api.drills = False
        _run(api)

        created = [c for c in api.calls if c == ("POST", "/training/requirements")]
        assert len(created) == 1


class TestARerunAfterACaptureUndid(unittest.TestCase):
    def test_only_the_drills_are_committed_when_only_they_were_undone(self):
        api = FakeApi(uploaded=True, training=True, requirement=True)

        _run(api)

        assert api.drills is True
        assert ("POST", f"{BASE}/{IMPORT_ID}/training/commit") not in api.calls
        assert api.decisions == {}

    def test_a_member_kept_by_the_undo_is_not_created_again(self):
        # Marta Cole's record was edited, so the undo kept her and her decision
        # still maps to her; the other three are waiting to be created.
        kept = "number:504"
        api = FakeApi(uploaded=True, requirement=True, waiting=ALL_KEYS - {kept})

        _run(api)

        assert set(api.decisions) == ALL_KEYS - {kept}
        assert all(d["first_name"] for d in api.decisions.values())
        assert api.training
        assert api.drills


if __name__ == "__main__":
    unittest.main()
