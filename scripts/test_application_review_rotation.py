import unittest
from pathlib import Path

from application_review_rotation import feature_marker, load_config, select_next_feature


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


if __name__ == "__main__":
    unittest.main()
