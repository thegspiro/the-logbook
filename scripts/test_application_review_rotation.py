import json
import tempfile
import unittest
from pathlib import Path

from application_review_rotation import (
    feature_marker,
    issue_feature_id,
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
        assert feature["id"] == "baseline"

    def test_open_issue_blocks_advancement(self):
        state, feature = select_next_feature(
            self.config, [self.issue("baseline", state="open")]
        )

        assert state == "waiting"
        assert feature is None

    def test_closed_issue_advances_queue(self):
        state, feature = select_next_feature(self.config, [self.issue("baseline")])

        assert state == "create"
        assert feature["id"] == "architecture"

    def test_pull_requests_do_not_count_as_review_issues(self):
        issue = self.issue("baseline")
        issue["pull_request"] = {"url": "https://example.invalid"}

        state, feature = select_next_feature(self.config, [issue])

        assert state == "create"
        assert feature["id"] == "baseline"

    def test_all_closed_completes_rotation(self):
        issues = [self.issue(feature["id"]) for feature in self.config["features"]]

        state, feature = select_next_feature(self.config, issues)

        assert state == "complete"
        assert feature is None

    def test_unmarked_issues_are_ignored(self):
        state, feature = select_next_feature(
            self.config, [{"body": "unrelated issue", "state": "open"}]
        )

        assert state == "create"
        assert feature["id"] == "baseline"

    def test_open_issue_for_retired_feature_still_blocks(self):
        state, feature = select_next_feature(
            self.config, [self.issue("since-removed", state="open")]
        )

        assert state == "waiting"
        assert feature is None

    def test_closed_issue_for_retired_feature_does_not_advance_queue(self):
        state, feature = select_next_feature(self.config, [self.issue("since-removed")])

        assert state == "create"
        assert feature["id"] == "baseline"


class IssueFeatureIdTest(unittest.TestCase):
    def test_reads_marker_without_consulting_the_config(self):
        issue = {"body": f"{feature_marker('auth-security')}\nbody text"}

        assert issue_feature_id(issue) == "auth-security"

    def test_returns_none_for_an_unmarked_issue(self):
        assert issue_feature_id({"body": "no marker here"}) is None
        assert issue_feature_id({}) is None


class LoadConfigTest(unittest.TestCase):
    def write_config(self, config):
        directory = tempfile.mkdtemp()
        path = Path(directory) / "rotation.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return path

    def valid_config(self, **overrides):
        config = {
            "label": "application-review",
            "title_prefix": "Application review:",
            "features": [{"id": "baseline", "name": "Baseline", "scope": "Scope."}],
        }
        config.update(overrides)
        return config

    def test_accepts_a_valid_config(self):
        path = self.write_config(self.valid_config())

        assert load_config(path)["features"][0]["id"] == "baseline"

    def test_rejects_a_feature_id_that_is_not_a_slug(self):
        path = self.write_config(
            self.valid_config(
                features=[{"id": "Base Line", "name": "Baseline", "scope": "Scope."}]
            )
        )

        with self.assertRaises(ValueError):
            load_config(path)

    def test_rejects_duplicate_feature_ids(self):
        path = self.write_config(
            self.valid_config(
                features=[
                    {"id": "baseline", "name": "Baseline", "scope": "Scope."},
                    {"id": "baseline", "name": "Repeat", "scope": "Scope."},
                ]
            )
        )

        with self.assertRaises(ValueError):
            load_config(path)

    def test_rejects_a_missing_label(self):
        path = self.write_config(self.valid_config(label="  "))

        with self.assertRaises(ValueError):
            load_config(path)


if __name__ == "__main__":
    unittest.main()
