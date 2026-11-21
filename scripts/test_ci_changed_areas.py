"""Regression tests for the script that decides which CI suites a change skips.

The direction that matters is the unsafe one: a case here fails when a change
that can break a suite would leave that suite skipped. Running too much costs
runner time; running too little merges untested code.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from ci_changed_areas import MARIADB, MYSQL, changed_paths, classify, decide

EVERYTHING = {"backend": True, "frontend": True, "docker": True}
NOTHING = {"backend": False, "frontend": False, "docker": False}


class Classification(unittest.TestCase):
    def test_prose_runs_none_of_the_gated_suites(self):
        paths = [
            "docs/security-review/PROGRESS.md",
            "wiki/Home.md",
            "README.md",
            "CLAUDE.md",
            ".claude/skills/repo-tenancy/SKILL.md",
            "LICENSE",
        ]
        assert classify(paths) == NOTHING

    def test_a_backend_change_skips_only_the_frontend_suites(self):
        assert classify(["backend/app/services/event_service.py"]) == {
            "backend": True,
            "frontend": False,
            "docker": True,
        }

    def test_a_frontend_change_skips_only_the_backend_suites(self):
        assert classify(["frontend/src/App.tsx"]) == {
            "backend": False,
            "frontend": True,
            "docker": True,
        }

    def test_the_root_lockfile_is_a_frontend_change(self):
        # The root package-lock.json is the frontend's only lockfile.
        assert classify(["package-lock.json"])["frontend"] is True
        assert classify(["package.json"])["frontend"] is True

    def test_prose_beside_code_does_not_hide_the_code(self):
        flags = classify(["docs/UPGRADING.md", "backend/alembic/versions/a.py"])
        assert flags["backend"] is True

    def test_markdown_inside_an_area_belongs_to_that_area(self):
        # Only root-level Markdown is prose; a .md under frontend/ ships with
        # the frontend and its tests may read it.
        path = "frontend/src/modules/onboarding/SECURITY_BEST_PRACTICES.md"
        assert classify([path])["frontend"] is True
        assert classify(["backend/README.md"])["backend"] is True

    def test_an_unclassified_path_runs_everything(self):
        for path in (
            ".github/workflows/ci.yml",
            ".github/scripts/install-system-deps.sh",
            "scripts/ci_changed_areas.py",
            "docker-compose.yml",
            "infrastructure/nginx/nginx.conf",
            "unraid/template.xml",
            "Makefile",
            "a-directory-added-next-year/file.txt",
        ):
            with self.subTest(path=path):
                assert classify([path]) == EVERYTHING

    def test_one_unclassified_path_among_prose_runs_everything(self):
        assert classify(["docs/a.md", "docker-compose.prod.yml"]) == EVERYTHING

    def test_a_lookalike_prefix_is_not_the_area(self):
        # "docs-old/" is not "docs/", and "frontend.md" at the root is prose
        # while "frontendish/x" is unknown.
        assert classify(["docs-old/a.md"]) == EVERYTHING
        assert classify(["frontendish/x.ts"]) == EVERYTHING

    def test_an_empty_diff_runs_everything(self):
        assert classify([]) == EVERYTHING


class Decision(unittest.TestCase):
    def engines(self, outputs):
        return json.loads(outputs["db_matrix"])

    def test_a_pull_request_tests_mysql_alone(self):
        outputs, _ = decide("pull_request", ["backend/app/main.py"])
        assert self.engines(outputs) == [MYSQL]
        assert outputs["backend"] == "true"
        assert outputs["frontend"] == "false"

    def test_every_other_event_runs_everything_on_both_engines(self):
        for event in ("push", "merge_group", "workflow_dispatch"):
            with self.subTest(event=event):
                outputs, _ = decide(event, None)
                assert self.engines(outputs) == [MYSQL, MARIADB]
                assert {outputs[k] for k in EVERYTHING} == {"true"}

    def test_a_pull_request_with_no_usable_diff_runs_everything(self):
        outputs, reason = decide("pull_request", None)
        assert {outputs[k] for k in EVERYTHING} == {"true"}
        assert "could not establish" in reason

    def test_the_reason_names_the_unclassified_path(self):
        _, reason = decide("pull_request", ["docs/a.md", "Makefile"])
        assert "'Makefile'" in reason

    def test_the_matrix_is_one_line(self):
        # A multi-line value would need the heredoc form of $GITHUB_OUTPUT.
        outputs, _ = decide("push", None)
        assert "\n" not in outputs["db_matrix"]


def git(repo, *args):
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=ci",
            "-c",
            "user.email=ci@example.invalid",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        cwd=repo,
        check=True,
        capture_output=True,
    )


class ChangedPathsAgainstARealRepository(unittest.TestCase):
    """The merge commit actions/checkout hands a pull_request run."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        git(self.repo, "init", "-q", "-b", "main")
        (self.repo / "backend").mkdir()
        (self.repo / "docs").mkdir()
        (self.repo / "backend" / "old.py").write_text("x = 1\n")
        (self.repo / "README.md").write_text("readme\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "base")

    def tearDown(self):
        self.tmp.cleanup()

    def paths(self):
        def run(cmd, **kwargs):
            return subprocess.run(cmd, cwd=self.repo, **kwargs)

        return changed_paths(run=run)

    def merge_branch(self):
        # Move main on first, so the merge is a true two-parent commit and the
        # test would notice a diff taken against the wrong parent.
        git(self.repo, "checkout", "-q", "main")
        (self.repo / "README.md").write_text("readme, edited on main\n")
        git(self.repo, "commit", "-q", "-am", "main moves")
        git(self.repo, "merge", "-q", "--no-ff", "-m", "merge", "branch")

    def test_lists_what_the_branch_changes_and_not_what_main_did(self):
        git(self.repo, "checkout", "-q", "-b", "branch")
        (self.repo / "docs" / "note.md").write_text("note\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "docs")
        self.merge_branch()
        assert self.paths() == ["docs/note.md"]

    def test_a_file_moved_out_of_an_area_still_counts_against_it(self):
        git(self.repo, "checkout", "-q", "-b", "branch")
        git(self.repo, "mv", "backend/old.py", "docs/old.py")
        git(self.repo, "commit", "-q", "-m", "move")
        self.merge_branch()
        assert sorted(self.paths()) == ["backend/old.py", "docs/old.py"]

    def test_a_checkout_that_is_not_a_merge_commit_is_not_trusted(self):
        (self.repo / "docs" / "note.md").write_text("note\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "plain commit")
        assert self.paths() is None

    def test_a_git_failure_is_not_trusted(self):
        def run(cmd, **kwargs):
            raise subprocess.CalledProcessError(128, cmd)

        assert changed_paths(run=run) is None


if __name__ == "__main__":
    unittest.main()
