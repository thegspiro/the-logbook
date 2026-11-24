"""The evaluations seed step takes last year's reviews through once, and resumes.

Guide 02 pictures Assign on a calibration step, the Last review card and Period
results. The step publishes the annual starter, finalizes three of last year's
reviews (the evaluator's part, then each member's own acknowledgement), leaves
a fourth in progress, publishes a version with a calibration step, and drafts
this year's review on it. Run twice it must make nothing new, and run after a
first attempt that stopped part-way it must carry on rather than start over.
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

USERNAMES = ("isolberg", "smarchetti", "mbell", "ytanaka")


class Department:
    """The evaluations API's state, shared by the administrator and members."""

    def __init__(self) -> None:
        self.templates: list[dict] = []
        self.versions = 0
        self.workflow = {
            "steps": [
                {"key": "self_evaluation", "type": "self_evaluation", "due_days": 14},
                {"key": "evaluator", "type": "evaluator", "due_days": 30},
                {
                    "key": "member_acknowledgement",
                    "type": "member_acknowledgement",
                    "due_days": 58,
                },
            ]
        }
        self.periods: list[dict] = []
        self.evaluations: list[dict] = []
        self.signed: list[str] = []


class FakeApi:
    def __init__(self, department: Department, user: str = "admin") -> None:
        self.d = department
        self.user = user

    # The seeder makes member sessions with Api(base_url); they share the
    # department and know who signed in.
    def login_as(self, username: str, _password: str) -> None:
        self.user = username

    def step_up(self) -> None:
        return None

    def get(self, path: str):
        d = self.d
        if path == "/auth/me":
            first, last = {"isolberg": ("Ingrid", "Solberg")}.get(self.user, ("A", "B"))
            return {"id": f"u-{self.user}", "first_name": first, "last_name": last}
        if path.startswith("/users?"):
            return [{"id": f"u-{n}", "username": n} for n in USERNAMES]
        if path == "/evaluations/templates":
            return list(d.templates)
        if path.startswith("/evaluations/templates/"):
            return {"published": {"definition": {}, "workflow": d.workflow}}
        if path == "/evaluations/periods":
            return list(d.periods)
        if path == "/evaluations":
            return [
                {"id": e["id"], "member": {"id": e["member_id"]}, "period_id": e["period_id"]}
                for e in d.evaluations
            ]
        evaluation = next(e for e in d.evaluations if path == f"/evaluations/{e['id']}")
        return {
            "status": evaluation["status"],
            "steps": [{"key": k, "status": v} for k, v in evaluation["steps"].items()],
        }

    def post(self, path: str, payload: dict):
        d = self.d
        if path == "/evaluations/templates":
            d.templates.append({"id": "tpl", "name": payload["name"]})
            return d.templates[-1]
        if path.endswith("/publish"):
            d.versions += 1
            return {"published": True}
        if path == "/evaluations/periods":
            d.periods.append({"id": f"p-{payload['name']}", **payload})
            return d.periods[-1]
        if path == "/evaluations":
            key = (payload["member_id"], payload["period_id"])
            if any((e["member_id"], e["period_id"]) == key for e in d.evaluations):
                raise seed.ApiError("POST", path, 400, "already has an evaluation")
            steps = {s["key"]: "pending" for s in d.workflow["steps"]}
            steps.update(self_evaluation="open", evaluator="open")
            evaluation = {"id": f"e{len(d.evaluations)}", "status": "in_progress",
                          "steps": steps, "version": d.versions, **payload}
            d.evaluations.append(evaluation)
            return evaluation
        evaluation = next(e for e in d.evaluations if f"/evaluations/{e['id']}/" in path)
        if path.endswith("/parts/evaluator/submit"):
            evaluation["steps"].update(
                self_evaluation="skipped", evaluator="done", member_acknowledgement="open"
            )
            return {"outcome": "submitted"}
        if path.endswith("/sign"):
            assert self.user != "admin", "only the member signs their acknowledgement"
            assert payload["disposition"] == "acknowledged"
            evaluation["steps"]["member_acknowledgement"] = "done"
            evaluation["status"] = "finalized"
            d.signed.append(self.user)
            return {"outcome": "finalized"}
        raise AssertionError(f"unexpected POST {path}")

    def put(self, path: str, payload: dict):
        if path.endswith("/draft"):
            self.d.workflow = payload["workflow"]
            return {}
        if path.endswith("/parts/evaluator"):
            return {}
        raise AssertionError(f"unexpected PUT {path}")


def _seed(department: Department) -> dict:
    original = seed.Api
    seed.Api = lambda _base: FakeApi(department, user="nobody")
    try:
        seeder = seed.Seeder(FakeApi(department), "http://127.0.0.1:3001")
        return seeder.seed_backlog_02_evaluations()
    finally:
        seed.Api = original


# A unittest.TestCase because CI collects scripts/ with `unittest discover`.
class TestTheEvaluationsSeed(unittest.TestCase):
    def test_last_year_is_finalized_by_its_members_and_this_year_drafted(self):
        d = Department()

        _seed(d)

        by_member = {(e["member_id"], e["period_id"]): e for e in d.evaluations}
        last = "p-2025"
        assert by_member[("u-isolberg", last)]["status"] == "finalized"
        assert by_member[("u-smarchetti", last)]["status"] == "finalized"
        assert by_member[("u-mbell", last)]["status"] == "finalized"
        assert by_member[("u-ytanaka", last)]["status"] == "in_progress"
        assert d.signed == ["isolberg", "smarchetti", "mbell"]
        this_year = by_member[("u-isolberg", "p-2026")]
        assert "calibration" in this_year["steps"]
        assert this_year["steps"]["calibration"] == "pending"

    def test_a_second_run_makes_nothing(self):
        d = Department()
        _seed(d)
        counts = (len(d.templates), len(d.periods), len(d.evaluations), d.versions)

        _seed(d)

        assert (len(d.templates), len(d.periods), len(d.evaluations), d.versions) == counts
        assert len(d.signed) == 3

    def test_a_run_stopped_after_the_evaluator_part_carries_on(self):
        d = Department()
        _seed(d)
        stopped = next(e for e in d.evaluations if e["member_id"] == "u-mbell")
        stopped["status"] = "in_progress"
        stopped["steps"]["member_acknowledgement"] = "open"
        d.signed.clear()

        _seed(d)

        assert stopped["status"] == "finalized"
        assert d.signed == ["mbell"]


if __name__ == "__main__":
    unittest.main()
