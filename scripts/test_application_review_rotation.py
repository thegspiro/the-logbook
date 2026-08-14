import json
import tempfile
import unittest
from pathlib import Path

from application_review_rotation import (
    GitHubClient,
    feature_marker,
    load_config,
    select_next_feature,
)


class ApplicationReviewRotationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = load_config(Path(".github/application-review-rotation.json"))

    def issue(self, feature_id, state="closed"):
        return {"body": feature_marker(feature_id), "state": state}

    def test_starts_with_first_feature(self):
        state, feature = select_next_feature(self.config, [])

        assert state == "create"
        assert feature["id"] == "inventory"

    def test_open_issue_blocks_advancement(self):
        state, feature = select_next_feature(
            self.config, [self.issue("inventory", state="open")]
        )

        assert state == "waiting"
        assert feature is None

    def test_closed_issue_advances_queue(self):
        state, feature = select_next_feature(self.config, [self.issue("inventory")])

        assert state == "create"
        assert feature["id"] == "facilities"

    def test_pull_requests_do_not_count_as_review_issues(self):
        issue = self.issue("inventory")
        issue["pull_request"] = {"url": "https://example.invalid"}

        state, feature = select_next_feature(self.config, [issue])

        assert state == "create"
        assert feature["id"] == "inventory"

    def test_all_closed_completes_rotation(self):
        issues = [self.issue(feature["id"]) for feature in self.config["features"]]

        state, feature = select_next_feature(self.config, issues)

        assert state == "complete"
        assert feature is None

    def test_config_rejects_marker_unsafe_feature_id(self):
        config = {
            "label": "review",
            "title_prefix": "Review:",
            "features": [
                {"id": "unsafe -->", "name": "Unsafe", "scope": "Invalid marker"}
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(config), encoding="utf-8")

            error_message = ""
            try:
                load_config(path)
            except ValueError as error:
                error_message = str(error)

            assert "feature 1 id" in error_message


class GitHubClientTest(unittest.TestCase):
    def test_issues_reads_every_page(self):
        client = GitHubClient("owner/repo", "token")
        first_page = [{"number": index} for index in range(100)]
        calls = []

        def request(method, path, payload=None):
            calls.append((method, path, payload))
            return first_page if path.endswith("page=1") else [{"number": 100}]

        client.request = request

        issues = client.issues("application review")

        assert len(issues) == 101
        assert calls == [
            (
                "GET",
                "/issues?state=all&labels=application%20review&per_page=100&page=1",
                None,
            ),
            (
                "GET",
                "/issues?state=all&labels=application%20review&per_page=100&page=2",
                None,
            ),
        ]


class WorkflowTest(unittest.TestCase):
    def test_pull_requests_validate_without_creating_issues(self):
        workflow = Path(".github/workflows/application-review-rotation.yml").read_text(
            encoding="utf-8"
        )
        assert "  pull_request:\n" in workflow
        assert "  validate:\n" in workflow
        assert "    if: github.event_name != 'pull_request'\n" in workflow
        assert "    needs: validate\n" in workflow
        assert "      issues: write\n" in workflow
        assert "      - name: Open the next review rotation\n" in workflow


if __name__ == "__main__":
    unittest.main()
