"""scripts/backup.sh must reach a remote database on the port in DB_PORT.

The script read DB_HOST from .env but never DB_PORT, and called `mysqldump`
and `mysql` with `-h` and no `-P`. Against a remote database on any port but
3306 — DigitalOcean's managed MySQL, for one — every backup and restore
connected to the wrong port and failed. These tests source the script's
functions with `mysqldump` and `mysql` replaced by stubs that log their
arguments, and check the port each one is given.
"""

import gzip
import subprocess
import tarfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
BACKUP_SH = REPO / "scripts" / "backup.sh"

# Logs its name and arguments, one per line; mysqldump also prints a dump.
CLIENT_STUB = r"""#!/bin/bash
{ echo "$(basename "$0")"; printf '%s\n' "$@"; echo "--"; } >> "$STUB_LOG"
if [[ "$(basename "$0")" == "mysqldump" ]]; then
    echo "-- dump"
else
    cat > /dev/null
fi
"""

pytestmark = pytest.mark.unit


@pytest.fixture
def env(tmp_path: Path) -> Iterator[dict[str, str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("mysqldump", "mysql"):
        stub = bin_dir / name
        stub.write_text(CLIENT_STUB)
        stub.chmod(0o755)
    (tmp_path / "project").mkdir()
    name = f"logbook_test_{uuid.uuid4().hex}"
    yield {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "STUB_LOG": str(tmp_path / "clients.log"),
        "TMP_ROOT": str(tmp_path),
        "TEST_BACKUP_NAME": name,
        # A remote host: the script talks to it directly, not via a container.
        "DB_HOST": "private-db.example.internal",
        "DB_USER": "logbook",
        "DB_PASSWORD": "secret",
        "DB_NAME": "the_logbook",
    }
    subprocess.run(["rm", "-rf", f"/tmp/{name}"], check=False)


def _run(
    env: dict[str, str], body: str, stdin: str = ""
) -> subprocess.CompletedProcess:
    script = (
        f'source "{BACKUP_SH}"\n'
        f'PROJECT_DIR="{env["TMP_ROOT"]}/project"\n'
        'BACKUP_NAME="$TEST_BACKUP_NAME"\n'
        'mkdir -p "/tmp/$BACKUP_NAME"\n'
        f"{body}\n"
    )
    return subprocess.run(
        ["/bin/bash", "-c", script],
        capture_output=True,
        text=True,
        env=env,
        input=stdin,
        timeout=20,
    )


def _calls(env: dict[str, str], client: str) -> list[list[str]]:
    """Each logged call of ``client``, as its argument list."""
    calls, current = [], None
    for line in Path(env["STUB_LOG"]).read_text().splitlines():
        if current is None:
            current = [] if line == client else None
            if current is None and line != "--":
                current = "skip"  # another client's call
            continue
        if line == "--":
            if current != "skip":
                calls.append(current)
            current = None
        elif current != "skip":
            current.append(line)
    return calls


def _restore_archive(tmp: Path) -> Path:
    src = tmp / "src" / "logbook_backup_test"
    src.mkdir(parents=True)
    with gzip.open(src / "database.sql.gz", "wt") as dump:
        dump.write("-- dump\n")
    archive = tmp / "logbook_backup_test.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(src, arcname=src.name)
    return archive


class TestBackupUsesDbPort:
    def test_mysqldump_is_given_db_port(self, env):
        env["DB_PORT"] = "25060"

        result = _run(env, "backup_database")

        assert result.returncode == 0, result.stderr + result.stdout
        [args] = _calls(env, "mysqldump")
        assert "-P25060" in args
        assert "-hprivate-db.example.internal" in args

    def test_no_port_is_passed_when_db_port_is_unset(self, env):
        # Leaves a port= in ~/.my.cnf in charge, rather than overriding it
        # with a guessed 3306.
        result = _run(env, "backup_database")

        assert result.returncode == 0, result.stderr + result.stdout
        [args] = _calls(env, "mysqldump")
        assert not [a for a in args if a.startswith("-P")]

    def test_a_non_numeric_db_port_stops_the_backup(self, env):
        env["DB_PORT"] = "25060x"

        result = _run(env, "backup_database")

        assert result.returncode != 0
        assert "DB_PORT" in result.stdout + result.stderr
        assert not Path(env["STUB_LOG"]).exists()


class TestRestoreUsesDbPort:
    def test_mysql_is_given_db_port(self, env):
        env["DB_PORT"] = "25060"
        archive = _restore_archive(Path(env["TMP_ROOT"]))

        result = _run(env, f'restore_backup "{archive}"', stdin="yes\n")

        assert result.returncode == 0, result.stderr + result.stdout
        [args] = _calls(env, "mysql")
        assert "-P25060" in args
        assert "-hprivate-db.example.internal" in args
