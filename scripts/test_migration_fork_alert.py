"""Tests for scripts/migration_fork_alert.py and its workflow.

The head count is read from the real validator's report, run over throwaway
migration trees, so a change to how validate_migrations.py prints heads fails
here rather than silently reporting no fork. The GitHub side runs against an
in-memory fake, and the double-delivery cases are the point (CLAUDE.md
pitfall #36): a second push while main is forked must update the one issue.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any

import migration_fork_alert as alert
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "migration-fork-alert.yml"

ENV = {
    "GITHUB_REPOSITORY": "owner/repo",
    "GITHUB_TOKEN": "token",
    "GITHUB_SHA": "abc1234",
    "GITHUB_RUN_ID": "42",
}


def migration(revision: str, down_revision: Any) -> str:
    return (
        f"revision = {revision!r}\n"
        f"down_revision = {down_revision!r}\n\n\n"
        "def upgrade():\n    pass\n\n\n"
        "def downgrade():\n    pass\n"
    )


class ValidatorTree:
    """A copy of the real validator beside a migration tree it reads."""

    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp())
        scripts = self.root / "backend" / "scripts"
        scripts.mkdir(parents=True)
        self.validator = scripts / "validate_migrations.py"
        shutil.copy(alert.VALIDATOR, self.validator)
        self.versions = self.root / "backend" / "alembic" / "versions"
        self.versions.mkdir(parents=True)

    def add(self, revision: str, down_revision: Any) -> None:
        (self.versions / f"{revision}_m.py").write_text(
            migration(revision, down_revision)
        )

    def run(self) -> tuple[int, str]:
        return alert.run_validator(self.validator)

    def cleanup(self) -> None:
        shutil.rmtree(self.root)


class FakeGitHub:
    def __init__(self, issues: list[dict[str, Any]] | None = None) -> None:
        self.issues = issues or []
        self.comments: list[tuple[int, str]] = []
        self.labels_created = 0
        self.label_exists = False

    # GitHubClient's interface, as main() uses it.
    def ensure_label(self) -> None:
        if not self.label_exists:
            self.label_exists = True
            self.labels_created += 1

    def open_issues(self) -> list[dict[str, Any]]:
        return [i for i in self.issues if i["state"] == "open"]

    def create_issue(self, body: str) -> dict[str, Any]:
        issue = {
            "number": 100 + len(self.issues),
            "title": alert.TITLE,
            "body": body,
            "state": "open",
        }
        self.issues.append(issue)
        return issue

    def update_issue(self, number: int, fields: dict[str, Any]) -> dict[str, Any]:
        issue = next(i for i in self.issues if i["number"] == number)
        issue.update(fields)
        return issue

    def comment(self, number: int, body: str) -> None:
        self.comments.append((number, body))

    def open(self) -> list[dict[str, Any]]:
        return self.open_issues()


class ParseHeadsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = ValidatorTree()
        self.addCleanup(self.tree.cleanup)
        self.tree.add("base0001", None)

    def test_one_head(self) -> None:
        self.tree.add("aaaa1111", "base0001")
        status, report = self.tree.run()
        assert status == 0
        assert alert.parse_heads(report) == [("aaaa1111", "aaaa1111_m.py")]

    def test_three_heads(self) -> None:
        for revision in ("cccc3333", "aaaa1111", "bbbb2222"):
            self.tree.add(revision, "base0001")
        status, report = self.tree.run()
        assert status == 1
        assert [revision for revision, _ in alert.parse_heads(report)] == [
            "aaaa1111",
            "bbbb2222",
            "cccc3333",
        ]

    def test_merge_revision_rejoins(self) -> None:
        self.tree.add("aaaa1111", "base0001")
        self.tree.add("bbbb2222", "base0001")
        self.tree.add("mmmm9999", ("aaaa1111", "bbbb2222"))
        status, report = self.tree.run()
        assert status == 0
        assert alert.parse_heads(report) == [("mmmm9999", "mmmm9999_m.py")]

    def test_rejects_a_revision_that_is_not_an_id(self) -> None:
        # Stdlib unittest runs these, with no pytest.raises to hand.
        try:
            alert.parse_heads("  head -> abc;rm  (x.py)\n")
        except ValueError:
            return
        raise AssertionError("expected parse_heads to reject the revision")

    def test_merge_command_names_every_head(self) -> None:
        heads = [("aaaa1111", "a.py"), ("bbbb2222", "b.py")]
        assert (
            alert.merge_command(heads)
            == 'cd backend && alembic merge -m "merge heads" aaaa1111 bbbb2222'
        )


class MainTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = ValidatorTree()
        self.addCleanup(self.tree.cleanup)
        self.tree.add("base0001", None)
        self.github = FakeGitHub()

    def run_main(self, env: dict[str, str] | None = None) -> int:
        return alert.main(
            environ=dict(ENV if env is None else env),
            client_factory=lambda _repo, _token: self.github,
            validator=self.tree.run,
        )

    def fork(self) -> None:
        self.tree.add("aaaa1111", "base0001")
        self.tree.add("bbbb2222", "base0001")

    def test_a_fork_opens_one_issue_and_fails(self) -> None:
        self.fork()
        assert self.run_main() == 1
        [issue] = self.github.open()
        assert "aaaa1111" in issue["body"]
        assert "bbbb2222" in issue["body"]
        assert 'alembic merge -m "merge heads" aaaa1111 bbbb2222' in issue["body"]
        assert alert.MARKER in issue["body"]
        assert self.github.labels_created == 1

    def test_a_second_push_updates_the_same_issue(self) -> None:
        self.fork()
        assert self.run_main() == 1
        assert self.run_main({**ENV, "GITHUB_SHA": "def5678"}) == 1
        [issue] = self.github.open()
        assert len(self.github.issues) == 1
        assert "def5678" in issue["body"]
        # Same heads: the body is refreshed, but nobody is pinged again.
        assert self.github.comments == []

    def test_a_new_head_on_an_open_fork_is_commented(self) -> None:
        self.fork()
        self.run_main()
        self.tree.add("cccc3333", "base0001")
        assert self.run_main() == 1
        [issue] = self.github.open()
        assert "cccc3333" in issue["body"]
        [(number, body)] = self.github.comments
        assert number == issue["number"]
        assert "aaaa1111 bbbb2222 cccc3333" in body

    def test_one_head_closes_the_issue(self) -> None:
        self.fork()
        self.run_main()
        self.tree.add("mmmm9999", ("aaaa1111", "bbbb2222"))
        assert self.run_main() == 0
        assert self.github.open() == []
        assert self.github.issues[0]["state_reason"] == "completed"
        assert "mmmm9999" in self.github.comments[-1][1]
        # And again: nothing left to close, nothing done.
        comments = len(self.github.comments)
        assert self.run_main() == 0
        assert len(self.github.comments) == comments

    def test_one_head_with_no_issue_touches_nothing(self) -> None:
        self.tree.add("aaaa1111", "base0001")
        assert self.run_main() == 0
        assert self.github.issues == []
        assert self.github.labels_created == 0

    def test_duplicate_issues_collapse_onto_the_oldest(self) -> None:
        body = alert.MARKER + "\n<!-- migration-fork-heads: aaaa1111,bbbb2222 -->"
        self.github.issues = [
            {"number": 7, "body": body, "state": "open"},
            {"number": 5, "body": body, "state": "open"},
            # Not ours: no marker, so left alone.
            {"number": 6, "body": "something else", "state": "open"},
        ]
        self.fork()
        assert self.run_main() == 1
        assert sorted(i["number"] for i in self.github.open()) == [5, 6]
        assert (7, "Duplicate of #5.") in self.github.comments

    def test_a_pull_request_carrying_the_marker_is_ignored(self) -> None:
        self.github.issues = [
            {
                "number": 3,
                "body": alert.MARKER,
                "state": "open",
                "pull_request": {},
            }
        ]
        self.fork()
        self.run_main()
        assert len(self.github.open()) == 2
        assert self.github.issues[0]["body"] == alert.MARKER

    def test_no_heads_in_the_report_touches_no_issue(self) -> None:
        result = alert.main(
            environ=dict(ENV),
            client_factory=lambda _repo, _token: self.github,
            validator=lambda: (1, "Traceback: boom"),
        )
        assert result == 1
        assert self.github.issues == []

    def test_missing_token_fails_without_calling_github(self) -> None:
        self.fork()
        env = {k: v for k, v in ENV.items() if k != "GITHUB_TOKEN"}
        assert self.run_main(env) == 1
        assert self.github.issues == []


class WorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = yaml.safe_load(WORKFLOW.read_text())

    def test_runs_on_push_to_main(self) -> None:
        # PyYAML reads the bare key `on` as the boolean True.
        triggers = self.workflow[True]
        assert triggers["push"]["branches"] == ["main"]

    def test_permissions_are_the_narrowest(self) -> None:
        assert self.workflow["permissions"] == {"contents": "read"}
        [job] = self.workflow["jobs"].values()
        assert job["permissions"] == {"contents": "read", "issues": "write"}

    def test_runs_serialize_rather_than_cancel(self) -> None:
        concurrency = self.workflow["concurrency"]
        assert not concurrency["cancel-in-progress"]

    def test_actions_are_pinned_like_the_rest_of_the_repo(self) -> None:
        [job] = self.workflow["jobs"].values()
        uses = [step["uses"] for step in job["steps"] if "uses" in step]
        assert uses == ["actions/checkout@v7", "actions/setup-python@v7"]

    def test_runs_the_alert_script(self) -> None:
        [job] = self.workflow["jobs"].values()
        runs = " ".join(step.get("run", "") for step in job["steps"])
        assert "scripts/migration_fork_alert.py" in runs


if __name__ == "__main__":
    unittest.main()
