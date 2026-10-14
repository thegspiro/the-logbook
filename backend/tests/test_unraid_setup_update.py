"""Updating an existing Unraid install must stop when `git pull` fails.

setup_repository used to print a warning and carry on, so a failed pull
rebuilt the old code and reported the repository as updated. These tests run
the real function against a local git origin and check both halves: a pull
that cannot apply stops the script, and the docker-compose.yml copy the
installer itself leaves behind no longer blocks the pull.
"""

import re
import subprocess
from pathlib import Path

import pytest

UNRAID_SETUP = Path(__file__).parents[2] / "unraid" / "unraid-setup.sh"
GIT_ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/tmp",
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
    "GIT_CONFIG_NOSYSTEM": "1",
}


def _function(name: str) -> str:
    source = UNRAID_SETUP.read_text()
    match = re.search(rf"^{name}\(\) \{{.*?^\}}\n", source, re.S | re.M)
    assert match, f"{name}() not found in unraid-setup.sh"
    return match.group(0)


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args], cwd=cwd, env=GIT_ENV, check=True, capture_output=True
    )


def _commit(repo: Path, files: dict[str, str], message: str) -> None:
    for name, content in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", message)


@pytest.fixture
def install(tmp_path: Path) -> tuple[Path, Path]:
    """An origin with one commit and an install cloned from it."""
    origin = tmp_path / "origin"
    origin.mkdir()
    _git(origin, "init", "-q", "-b", "main")
    _commit(
        origin,
        {
            "docker-compose.yml": "root compose\n",
            "unraid/docker-compose-unraid.yml": "unraid compose\n",
            "README": "v1\n",
        },
        "v1",
    )
    install_dir = tmp_path / "install"
    _git(tmp_path, "clone", "-q", str(origin), str(install_dir))
    return origin, install_dir


def _run_setup_repository(install_dir: Path) -> subprocess.CompletedProcess:
    script = (
        "set -e\n"
        'print_header() { echo "== $1"; }\n'
        'print_info() { echo "INFO $1"; }\n'
        'print_success() { echo "OK $1"; }\n'
        'print_warning() { echo "WARN $1"; }\n'
        'print_error() { echo "ERR $1"; }\n'
        f"INSTALL_DIR={install_dir}\n"
        "INSTALL_TYPE=2\n"
        'COMPOSE="docker compose"\n'
        + _function("setup_repository")
        + "setup_repository\n"
        + "echo AFTER-SETUP-REPOSITORY\n"
    )
    return subprocess.run(
        ["bash"],
        input=script,
        capture_output=True,
        text=True,
        env=GIT_ENV,
        timeout=60,
    )


@pytest.mark.unit
class TestUpdateStopsOnFailedPull:
    def test_a_clean_install_updates(self, install):
        origin, install_dir = install
        _commit(origin, {"README": "v2\n"}, "v2")

        result = _run_setup_repository(install_dir)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "OK Repository updated" in result.stdout
        assert (install_dir / "README").read_text() == "v2\n"

    def test_a_pull_that_cannot_apply_stops_the_script(self, install):
        origin, install_dir = install
        _commit(origin, {"README": "v2\n"}, "v2")
        # A local edit to a tracked file the update also changes: git refuses
        # to overwrite it, so the pull fails.
        (install_dir / "README").write_text("edited on the server\n")

        result = _run_setup_repository(install_dir)

        assert result.returncode != 0
        assert "Repository updated" not in result.stdout
        assert "AFTER-SETUP-REPOSITORY" not in result.stdout
        assert "ERR Could not update the repository" in result.stdout
        # The operator's edit is untouched.
        assert (install_dir / "README").read_text() == "edited on the server\n"

    def test_the_installers_own_compose_copy_does_not_block_the_pull(self, install):
        origin, install_dir = install
        _commit(origin, {"docker-compose.yml": "root compose v2\n"}, "v2")
        # What setup_docker_compose leaves behind after every install.
        (install_dir / "docker-compose.yml").write_text("unraid compose\n")

        result = _run_setup_repository(install_dir)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "OK Repository updated" in result.stdout
        assert (install_dir / "docker-compose.yml").read_text() == "root compose v2\n"

    def test_a_customised_compose_file_is_not_discarded(self, install):
        origin, install_dir = install
        _commit(origin, {"docker-compose.yml": "root compose v2\n"}, "v2")
        (install_dir / "docker-compose.yml").write_text("my own changes\n")

        result = _run_setup_repository(install_dir)

        assert result.returncode != 0
        assert "ERR Could not update the repository" in result.stdout
        assert (install_dir / "docker-compose.yml").read_text() == "my own changes\n"
