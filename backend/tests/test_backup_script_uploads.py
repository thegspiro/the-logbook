"""scripts/backup.sh must back up uploads where a Docker install keeps them.

Every upload writer uses /app/uploads inside the backend container: a named
volume in the main compose stack, a bind from /mnt/user/appdata on Unraid.
Neither leaves anything at $PROJECT_DIR/uploads, which is the only place the
script used to look, so every Docker backup silently went out without the
uploaded files. These tests source the script's functions with `docker`
replaced by a stub that serves a fake /app from a temporary directory, and
check the archive each layout produces and where a restore writes it.
"""

import os
import shutil
import subprocess
import sys
import tarfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
BACKUP_SH = REPO / "scripts" / "backup.sh"

# Answers `docker ps` from $STUB_PS_NAMES and runs `docker exec` commands on
# the host with /app mapped to $STUB_ROOT/app, logging every call.
DOCKER_STUB = r"""#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
case "$1" in
    ps)
        [[ -n "${STUB_PS_NAMES:-}" ]] && printf '%s\n' $STUB_PS_NAMES
        exit 0
        ;;
    exec)
        shift
        [[ "$1" == "-i" ]] && shift
        shift  # container name
        if [[ -n "${STUB_TAR_FAIL:-}" && "$1" == "tar" ]]; then
            exit 2
        fi
        args=()
        for a in "$@"; do
            args+=("${a/#\/app/$STUB_ROOT/app}")
        done
        exec "${args[@]}"
        ;;
esac
exit 1
"""


@pytest.fixture
def env(tmp_path: Path) -> Iterator[dict[str, str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "project").mkdir()
    (tmp_path / "work").mkdir()
    (tmp_path / "container" / "app").mkdir(parents=True)
    values = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "STUB_LOG": str(tmp_path / "docker.log"),
        "STUB_ROOT": str(tmp_path / "container"),
        "TMP_ROOT": str(tmp_path),
        "TEST_BACKUP_NAME": f"logbook_test_{uuid.uuid4().hex}",
    }
    yield values
    shutil.rmtree(Path("/tmp") / values["TEST_BACKUP_NAME"], ignore_errors=True)


def _install_docker(env: dict[str, str], names: str) -> None:
    stub = Path(env["PATH"].split(":", 1)[0]) / "docker"
    stub.write_text(DOCKER_STUB)
    stub.chmod(0o755)
    env["STUB_PS_NAMES"] = names


def _run(env: dict[str, str], body: str) -> subprocess.CompletedProcess:
    root = env["TMP_ROOT"]
    script = (
        f'source "{BACKUP_SH}"\n'
        f'PROJECT_DIR="{root}/project"\n'
        'BACKUP_NAME="$TEST_BACKUP_NAME"\n'
        f'mkdir -p "/tmp/$BACKUP_NAME"\n'
        f"{body}\n"
    )
    return subprocess.run(
        ["/bin/bash", "-c", script],
        capture_output=True,
        text=True,
        env=env,
        timeout=20,
    )


def _archive_members(path: Path) -> set[str]:
    with tarfile.open(path) as archive:
        return set(archive.getnames())


def _write(base: Path, files: dict[str, str]) -> None:
    for name, content in files.items():
        target = base / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)


def _archive(env: dict[str, str]) -> Path:
    return Path("/tmp") / env["TEST_BACKUP_NAME"] / "uploads.tar.gz"


@pytest.mark.unit
class TestBackupUploads:
    def test_docker_install_archives_the_backend_containers_uploads(self, env):
        _install_docker(env, "logbook-db intranet-backend")
        _write(
            Path(env["STUB_ROOT"]) / "app" / "uploads",
            {"documents/report.pdf": "pdf", "photos/a.jpg": "jpg"},
        )

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        log = Path(env["STUB_LOG"]).read_text()
        assert "docker exec intranet-backend tar -czf - -C /app uploads" in log, log
        assert {
            "uploads/documents/report.pdf",
            "uploads/photos/a.jpg",
        } <= _archive_members(_archive(env))

    def test_unraid_container_name_is_found(self, env):
        _install_docker(env, "logbook-db logbook-backend")
        _write(Path(env["STUB_ROOT"]) / "app" / "uploads", {"x.txt": "x"})

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "docker exec logbook-backend tar" in Path(env["STUB_LOG"]).read_text()
        assert "uploads/x.txt" in _archive_members(_archive(env))

    def test_backend_container_override_wins(self, env):
        _install_docker(env, "intranet-backend")
        _write(Path(env["STUB_ROOT"]) / "app" / "uploads", {"x.txt": "x"})
        env["BACKEND_CONTAINER"] = "custom-api"

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "docker exec custom-api tar" in Path(env["STUB_LOG"]).read_text()

    def test_failed_container_archive_fails_the_backup(self, env):
        _install_docker(env, "intranet-backend")
        (Path(env["STUB_ROOT"]) / "app" / "uploads").mkdir()
        env["STUB_TAR_FAIL"] = "1"

        result = _run(env, "backup_uploads")

        assert result.returncode != 0
        assert "Archiving uploads from container intranet-backend failed" in (
            result.stdout
        )
        assert not _archive(env).exists()

    def test_traditional_install_archives_the_project_directory(self, env):
        _write(Path(env["TMP_ROOT"]) / "project" / "uploads", {"a/b.txt": "b"})

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "uploads/a/b.txt" in _archive_members(_archive(env))

    def test_docker_without_a_backend_falls_back_to_the_project_directory(self, env):
        _install_docker(env, "logbook-db")
        _write(Path(env["TMP_ROOT"]) / "project" / "uploads", {"a.txt": "a"})

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "uploads/a.txt" in _archive_members(_archive(env))

    def test_neither_present_says_uploads_were_not_backed_up(self, env):
        _install_docker(env, "logbook-db")

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "Uploaded files were NOT backed up" in result.stdout
        assert "no running backend container" in result.stdout
        assert not _archive(env).exists()


def _install_bucket_check(env: dict[str, str], output: str, exit_code: int = 0):
    """The backend's ``migrate_uploads_to_s3.py --buckets``, as the docker
    stub runs it: a host ``python`` on a script under the fake /app."""
    script = Path(env["STUB_ROOT"]) / "app" / "scripts" / "migrate_uploads_to_s3.py"
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(
        f"import sys\nsys.stdout.write({output!r})\nsys.exit({exit_code})\n"
    )
    python = Path(env["PATH"].split(":", 1)[0]) / "python"
    if not python.exists():
        python.symlink_to(sys.executable)


@pytest.mark.unit
class TestBucketNotice:
    """A department's own bucket is not on the uploads volume, so the backup
    says which buckets it left out."""

    def _uploads(self, env):
        _install_docker(env, "intranet-backend")
        _write(Path(env["STUB_ROOT"]) / "app" / "uploads", {"a/b.pdf": "pdf"})

    def test_buckets_holding_files_are_named(self, env):
        self._uploads(env)
        _install_bucket_check(
            env,
            '[{"organization_id": "org-1", "bucket": "dept-files", "files": 3}]',
        )

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "NOT in this backup" in result.stdout
        assert "dept-files: 3 file(s) of organization org-1" in result.stdout
        log = Path(env["STUB_LOG"]).read_text()
        assert "migrate_uploads_to_s3.py --buckets" in log

    def test_no_bucket_files_says_nothing(self, env):
        self._uploads(env)
        _install_bucket_check(env, "[]")

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "NOT in this backup" not in result.stdout
        assert "Could not" not in result.stdout

    def test_a_failed_check_does_not_fail_the_backup(self, env):
        self._uploads(env)
        _install_bucket_check(env, "", exit_code=2)

        result = _run(env, "backup_uploads")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "Could not check for files kept" in result.stdout
        assert _archive(env).exists()


@pytest.mark.unit
class TestRestoreUploads:
    def _make_archive(self, tmp: Path) -> Path:
        src = tmp / "src"
        _write(src / "uploads", {"documents/r.pdf": "restored"})
        archive = tmp / "uploads.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(src / "uploads", arcname="uploads")
        return archive

    def test_docker_restore_writes_into_the_backend_container(self, env):
        tmp = Path(env["TMP_ROOT"])
        archive = self._make_archive(tmp)
        _install_docker(env, "intranet-backend")
        (Path(env["STUB_ROOT"]) / "app" / "uploads").mkdir()

        result = _run(env, f'restore_uploads "{archive}" "{tmp}/work"')

        assert result.returncode == 0, result.stderr + result.stdout
        restored = Path(env["STUB_ROOT"]) / "app" / "uploads" / "documents" / "r.pdf"
        assert restored.read_text() == "restored"
        assert not (tmp / "project" / "uploads").exists()
        assert (
            "docker exec -i intranet-backend tar -xf - --no-overwrite-dir "
            "-C /app/uploads" in Path(env["STUB_LOG"]).read_text()
        )

    def test_docker_restore_refuses_an_unsafe_archive(self, env):
        tmp = Path(env["TMP_ROOT"])
        archive = tmp / "evil.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            info = tarfile.TarInfo("uploads/link")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)
        _install_docker(env, "intranet-backend")
        (Path(env["STUB_ROOT"]) / "app" / "uploads").mkdir()

        result = _run(env, f'restore_uploads "{archive}" "{tmp}/work"')

        assert result.returncode != 0
        assert "exec -i" not in Path(env["STUB_LOG"]).read_text()

    def test_traditional_restore_writes_into_the_project_directory(self, env):
        tmp = Path(env["TMP_ROOT"])
        archive = self._make_archive(tmp)

        result = _run(env, f'restore_uploads "{archive}" "{tmp}/work"')

        assert result.returncode == 0, result.stderr + result.stdout
        restored = tmp / "project" / "uploads" / "documents" / "r.pdf"
        assert restored.read_text() == "restored"


@pytest.mark.unit
def test_sourcing_the_script_does_not_run_a_backup(env):
    result = _run(env, "true")

    assert result.returncode == 0, result.stderr
    assert "Starting backup process" not in result.stdout
    assert not os.path.exists(env["STUB_LOG"])
