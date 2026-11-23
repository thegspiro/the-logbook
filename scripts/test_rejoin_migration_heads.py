"""Tests for scripts/rejoin_migration_heads.py.

Each test builds a throwaway alembic directory of tiny revision files, so the
chain the script reads is exactly the one the test describes.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import ast
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "rejoin_migration_heads.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "rejoin-migration-heads.yml"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
REQUIREMENTS = REPO_ROOT / "backend" / "requirements.txt"

sys.path.insert(0, str(REPO_ROOT / "scripts"))
import rejoin_migration_heads as rejoin  # noqa: E402

from alembic.script import ScriptDirectory  # noqa: E402


def _revision(stamp: str, rev: str, down, message: str) -> str:
    down_literal = repr(down)
    return (
        f'"""{message}\n\nRevision ID: {rev}\n"""\n\n'
        f'revision = "{rev}"\n'
        f"down_revision = {down_literal}\n"
        "branch_labels = None\n"
        "depends_on = None\n\n\n"
        "def upgrade():\n    pass\n\n\n"
        "def downgrade():\n    pass\n"
    )


class _Chain:
    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="rejoin-heads-"))
        (self.root / "versions").mkdir()

    def add(self, stamp: str, rev: str, down, message: str = "a change") -> None:
        path = self.root / "versions" / f"{stamp}_{rev}_change.py"
        path.write_text(_revision(stamp, rev, down, message), encoding="utf-8")

    def heads(self) -> list:
        return sorted(ScriptDirectory(str(self.root)).get_heads())

    def merges(self) -> list:
        return sorted((self.root / "versions").glob("*_merge_heads_*.py"))

    def run(self, *args: str) -> subprocess.CompletedProcess:
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_OUTPUT"}
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--script-location", str(self.root), *args],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


def _forked(chain: _Chain, extra: int = 0) -> None:
    chain.add("20261101_1000", "aaaaaaaaaaaa", None, "Base")
    chain.add("20261102_1000", "bbbbbbbbbbbb", "aaaaaaaaaaaa", "Branch one")
    chain.add("20261103_0930", "cccccccccccc", "aaaaaaaaaaaa", "Branch two")
    if extra:
        chain.add("20261103_1200", "dddddddddddd", "aaaaaaaaaaaa", "Branch three")


class RejoinMigrationHeadsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.chain = _Chain()
        self.addCleanup(self.chain.cleanup)

    def test_one_head_writes_nothing(self) -> None:
        self.chain.add("20261101_1000", "aaaaaaaaaaaa", None)
        self.chain.add("20261102_1000", "bbbbbbbbbbbb", "aaaaaaaaaaaa")

        result = self.chain.run("--write")

        assert result.returncode == rejoin.EXIT_ONE_HEAD, result.stderr
        assert self.chain.merges() == []

    def test_two_heads_without_write_reports_and_writes_nothing(self) -> None:
        _forked(self.chain)

        result = self.chain.run()

        assert result.returncode == rejoin.EXIT_FORKED, result.stderr
        assert "bbbbbbbbbbbb cccccccccccc" in result.stdout
        assert self.chain.merges() == []

    def test_two_heads_are_joined_into_one(self) -> None:
        _forked(self.chain)

        result = self.chain.run("--write")

        assert result.returncode == rejoin.EXIT_WROTE, result.stderr
        merge_files = self.chain.merges()
        assert len(merge_files) == 1
        revision = rejoin.revision_id_for(["bbbbbbbbbbbb", "cccccccccccc"])
        assert self.chain.heads() == [revision]

        source = merge_files[0].read_text(encoding="utf-8")
        ast.parse(source)
        assert (
            'down_revision: Union[str, Sequence[str], None] = ("bbbbbbbbbbbb", "cccccccccccc")'
            in source
        )
        assert "Revises: bbbbbbbbbbbb, cccccccccccc" in source
        assert '``bbbbbbbbbbbb`` ("Branch one")' in source
        assert "# fmt: off" in source
        assert "import sqlalchemy" not in source
        assert "from alembic import op" not in source

    def test_merge_file_sorts_after_the_newest_head(self) -> None:
        _forked(self.chain)

        self.chain.run("--write")

        name = self.chain.merges()[0].name
        assert name.startswith("20261103_0931_"), name
        assert re.match(
            r"^\d{8}_\d{4}_[0-9a-f]{12}_merge_heads_bbbbbb_cccccc\.py$", name
        ), name

    def test_three_heads_are_joined_in_one_revision(self) -> None:
        _forked(self.chain, extra=1)

        result = self.chain.run("--write")

        assert result.returncode == rejoin.EXIT_WROTE, result.stderr
        assert len(self.chain.merges()) == 1
        revision = rejoin.revision_id_for(
            ["bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd"]
        )
        assert self.chain.heads() == [revision]

    def test_a_second_run_changes_nothing(self) -> None:
        _forked(self.chain)
        self.chain.run("--write")
        first = self.chain.merges()[0].read_text(encoding="utf-8")

        result = self.chain.run("--write")

        assert result.returncode == rejoin.EXIT_ONE_HEAD, result.stderr
        assert len(self.chain.merges()) == 1
        assert self.chain.merges()[0].read_text(encoding="utf-8") == first

    def test_the_revision_id_depends_only_on_the_heads(self) -> None:
        one = rejoin.revision_id_for(["bbbbbbbbbbbb", "cccccccccccc"])
        assert one == rejoin.revision_id_for(["cccccccccccc", "bbbbbbbbbbbb"])
        assert one != rejoin.revision_id_for(["bbbbbbbbbbbb", "dddddddddddd"])
        assert re.fullmatch(r"^[0-9a-f]{12}$", one)

    def test_two_separate_rejoins_write_the_same_file(self) -> None:
        other = _Chain()
        self.addCleanup(other.cleanup)
        _forked(self.chain)
        _forked(other)

        self.chain.run("--write")
        other.run("--write")

        mine, theirs = self.chain.merges()[0], other.merges()[0]
        assert mine.name == theirs.name
        assert mine.read_text(encoding="utf-8") == theirs.read_text(encoding="utf-8")

    def test_a_missing_versions_directory_is_an_error(self) -> None:
        shutil.rmtree(self.chain.root / "versions")

        result = self.chain.run("--write")

        assert result.returncode == rejoin.EXIT_ERROR
        assert "no versions directory" in result.stderr

    def test_github_output_names_the_written_revision(self) -> None:
        _forked(self.chain)
        output = self.chain.root / "github_output"
        env = dict(os.environ, GITHUB_OUTPUT=str(output))

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--script-location",
                str(self.chain.root),
                "--write",
            ],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )

        assert result.returncode == rejoin.EXIT_WROTE, result.stderr
        lines = dict(line.split("=", 1) for line in output.read_text().splitlines())
        assert lines["heads"] == "bbbbbbbbbbbb cccccccccccc"
        assert lines["revision"] == rejoin.revision_id_for(
            ["bbbbbbbbbbbb", "cccccccccccc"]
        )
        assert lines["path"].endswith(".py")


class WorkflowPinTest(unittest.TestCase):
    """The workflow installs the alembic the backend pins, so both read alike."""

    def test_workflow_pins_match_backend_requirements(self) -> None:
        requirements = REQUIREMENTS.read_text(encoding="utf-8")
        for package in ("alembic", "sqlalchemy"):
            pinned = re.search(
                rf"^{package}==(\S+)$", requirements, re.MULTILINE | re.IGNORECASE
            )
            assert (
                pinned is not None
            ), f"{package} is not pinned in backend/requirements.txt"
            wanted = f"'{package}=={pinned.group(1)}'"
            for workflow in (WORKFLOW, CI_WORKFLOW):
                installs = re.findall(
                    rf"'{package}==[^']+'",
                    workflow.read_text(encoding="utf-8"),
                    re.IGNORECASE,
                )
                assert installs, f"{workflow.name} does not install {package}"
                assert {i.lower() for i in installs} == {
                    wanted.lower()
                }, f"{workflow.name} installs {installs}, not {wanted}"


if __name__ == "__main__":
    unittest.main()
