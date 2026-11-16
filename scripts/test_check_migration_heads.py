"""Regression tests for scripts/check-migration-heads.sh.

The case this exists for is two branches that are each valid alone: both add
a migration on the same parent, so each pull request's CI sees one head and
passes, and main forks when the second merges. Every test builds a throwaway
origin and clone so the script's fetch, merge and validation run for real.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-migration-heads.sh"
HOOK = REPO_ROOT / ".husky" / "pre-push"
VALIDATOR = REPO_ROOT / "backend" / "scripts" / "validate_migrations.py"
VERSIONS = Path("backend") / "alembic" / "versions"

GIT_ENV = {
    "GIT_AUTHOR_NAME": "test",
    "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "test",
    "GIT_COMMITTER_EMAIL": "test@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


def migration(revision, down_revision):
    down = "None" if down_revision is None else repr(down_revision)
    return (
        f"revision = {revision!r}\n"
        f"down_revision = {down}\n\n\n"
        "def upgrade():\n    pass\n\n\n"
        "def downgrade():\n    pass\n"
    )


class _RepoCase(unittest.TestCase):
    """A bare origin and a clone of it, with one base migration on main."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.env = {**os.environ, **GIT_ENV}
        self.env.pop("MIGRATION_HEADS_BASE", None)

        self.origin = self.tmp / "origin.git"
        self.git(
            "init", "--quiet", "--bare", "-b", "main", str(self.origin), cwd=self.tmp
        )

        self.work = self.tmp / "work"
        self.git("clone", "--quiet", str(self.origin), str(self.work), cwd=self.tmp)
        self.git("symbolic-ref", "HEAD", "refs/heads/main")
        (self.work / "scripts").mkdir()
        shutil.copy(SCRIPT, self.work / "scripts")
        (self.work / ".husky").mkdir()
        shutil.copy(HOOK, self.work / ".husky")
        (self.work / "backend" / "scripts").mkdir(parents=True)
        shutil.copy(VALIDATOR, self.work / "backend" / "scripts")
        self.add_migration("a1", None)
        self.commit("base")
        self.git("push", "--quiet", "-u", "origin", "main")

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.work,
            env=self.env,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def add_migration(self, revision, down_revision, suffix=""):
        path = self.work / VERSIONS / f"{revision}.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(migration(revision, down_revision) + suffix)

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", message)

    def land_on_main(self, revision, down_revision, body=None):
        """Add a migration to origin/main from a second clone, as another
        session merging its pull request would."""
        other = self.tmp / f"other-{revision}"
        self.git("clone", "--quiet", str(self.origin), str(other), cwd=self.tmp)
        path = other / VERSIONS / f"{revision}.py"
        path.write_text(body or migration(revision, down_revision))
        self.git("add", "-A", cwd=other)
        self.git("commit", "--quiet", "-m", f"add {revision}", cwd=other)
        self.git("push", "--quiet", "origin", "main", cwd=other)

    def start_branch(self):
        self.git("checkout", "--quiet", "-b", "feature")


class CheckMigrationHeads(_RepoCase):
    def run_check(self, *args):
        return subprocess.run(
            ["sh", "scripts/check-migration-heads.sh", *args],
            cwd=self.work,
            env=self.env,
            capture_output=True,
            text=True,
        )

    def test_branch_forking_against_main_is_rejected(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.land_on_main("c3", "a1")

        result = self.run_check()

        assert result.returncode == 1, result.stderr
        assert "Multiple heads" in result.stderr
        assert "git merge origin/main" in result.stderr

    def test_branch_alone_would_pass_the_ci_validator(self):
        """The precondition that makes the hook necessary: on its own, the
        branch's chain is valid, so the CI step would pass it."""
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.land_on_main("c3", "a1")

        alone = subprocess.run(
            ["python3", "-I", "backend/scripts/validate_migrations.py", "--strict"],
            cwd=self.work,
            capture_output=True,
            text=True,
        )

        assert alone.returncode == 0, alone.stdout
        assert self.run_check().returncode == 1

    def test_repointed_migration_passes(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.land_on_main("c3", "a1")
        self.git("merge", "--quiet", "--no-edit", "origin/main")
        self.add_migration("b2", "c3")
        self.commit("repoint b2 onto c3")

        result = self.run_check()

        assert result.returncode == 0, result.stderr

    def test_branch_extending_current_head_passes(self):
        self.land_on_main("c3", "a1")
        self.git("pull", "--quiet", "origin", "main")
        self.start_branch()
        self.add_migration("b2", "c3")
        self.commit("branch migration")

        assert self.run_check().returncode == 0

    def test_branch_without_migrations_is_not_checked(self):
        """A branch adding no migration cannot fork the chain, even when main
        itself is forked — blocking it would stop every unrelated push."""
        self.land_on_main("c3", "a1")
        self.land_on_main("d4", "a1")
        self.start_branch()
        (self.work / "README.md").write_text("unrelated\n")
        self.commit("docs")

        assert self.run_check().returncode == 0

    def test_checks_the_commit_it_is_given_not_head(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        forked = self.git("rev-parse", "HEAD").strip()
        self.land_on_main("c3", "a1")
        self.git("checkout", "--quiet", "main")

        assert self.run_check().returncode == 0
        assert self.run_check(forked).returncode == 1

    def test_unreachable_base_does_not_block(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.env["MIGRATION_HEADS_BASE"] = "origin/no-such-branch"

        result = self.run_check()

        assert result.returncode == 0, result.stderr
        assert "skipping" in result.stderr

    def test_working_tree_is_left_untouched(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.land_on_main("c3", "a1")
        (self.work / "uncommitted.txt").write_text("in progress\n")

        self.run_check()

        assert self.git("status", "--porcelain") == "?? uncommitted.txt\n"
        assert self.git("rev-parse", "--abbrev-ref", "HEAD").strip() == "feature"

    def test_conflicting_migration_file_is_rejected(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.add_migration("a1", None, suffix="# edited on the branch\n")
        self.commit("branch migration and an edit to a1")
        self.land_on_main("a1", None, body=migration("a1", None) + "# edited on main\n")

        result = self.run_check()

        assert result.returncode == 1, result.stderr
        assert "backend/alembic/versions/a1.py" in result.stderr


class PrePushHook(_RepoCase):
    """.husky/pre-push hands each pushed sha to the script."""

    def run_hook(self, stdin):
        return subprocess.run(
            ["sh", ".husky/pre-push", "origin", str(self.origin)],
            cwd=self.work,
            env=self.env,
            input=stdin,
            capture_output=True,
            text=True,
        )

    def forked_sha(self):
        self.start_branch()
        self.add_migration("b2", "a1")
        self.commit("branch migration")
        self.land_on_main("c3", "a1")
        return self.git("rev-parse", "HEAD").strip()

    def test_push_of_a_forking_commit_is_refused(self):
        sha = self.forked_sha()
        line = f"refs/heads/feature {sha} refs/heads/feature {'0' * 40}\n"

        assert self.run_hook(line).returncode == 1

    def test_branch_deletion_is_not_checked(self):
        self.forked_sha()
        line = f"(delete) {'0' * 40} refs/heads/feature {'1' * 40}\n"

        assert self.run_hook(line).returncode == 0

    def test_one_bad_ref_fails_the_whole_push(self):
        sha = self.forked_sha()
        good = self.git("rev-parse", "main").strip()
        lines = (
            f"refs/heads/feature {sha} refs/heads/feature {'0' * 40}\n"
            f"refs/heads/main {good} refs/heads/main {good}\n"
        )

        assert self.run_hook(lines).returncode == 1


if __name__ == "__main__":
    unittest.main()
