"""scripts/migrate_uploads_to_remote.py — the command line around
remote_migration — and its former name, migrate_uploads_to_s3.py."""

import importlib.util
import os
import shlex
import subprocess
import sys

import pytest

pytestmark = pytest.mark.unit


SCRIPTS = os.path.join(os.path.dirname(__file__), "..", "scripts")


def _cli():
    spec = importlib.util.spec_from_file_location(
        "migrate_uploads_to_remote",
        os.path.join(SCRIPTS, "migrate_uploads_to_remote.py"),
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "argv",
    [
        ["--apply", "--stores"],
        ["--apply", "--buckets"],
        ["--rollback", "m.json", "--finalize", "m.json"],
        ["--org", "x", "--buckets"],
        ["--org", "x", "--rollback", "m.json"],
    ],
)
def test_conflicting_options_are_refused(monkeypatch, argv):
    monkeypatch.setattr(sys, "argv", ["migrate_uploads_to_remote.py", *argv])
    with pytest.raises(SystemExit) as caught:
        _cli().main()
    assert caught.value.code == 2


def test_next_steps_are_ready_to_paste():
    manifest = "/app/uploads/.s3-migration/s3-migration-20261022T120000Z-1a2b.json"
    text = _cli().next_steps(manifest)
    finalize = next(line for line in text.splitlines() if "--finalize" in line)
    rollback = next(line for line in text.splitlines() if "--rollback" in line)
    assert shlex.split(finalize)[-1] == manifest
    assert shlex.split(rollback)[-1] == manifest
    assert shlex.split(finalize)[0:2] == [
        "python",
        "scripts/migrate_uploads_to_remote.py",
    ]


@pytest.mark.parametrize("flag", ["--stores", "--buckets"])
def test_the_inventory_flag_keeps_its_old_name(monkeypatch, flag):
    """``--buckets`` is what backup.sh on a host that has not been updated
    still sends; it must select the same inventory as ``--stores``."""
    cli = _cli()
    seen = {}

    async def fake_run(args):
        seen["stores"] = args.stores
        return 0

    monkeypatch.setattr(cli, "_run", fake_run)
    monkeypatch.setattr(sys, "argv", ["migrate_uploads_to_remote.py", flag])
    assert cli.main() == 0
    assert seen == {"stores": True}


def test_the_old_script_name_runs_the_same_command():
    """Run as a separate process, as ``docker exec`` runs it: the options are
    parsed by the renamed command and its exit code comes back unchanged."""
    result = subprocess.run(
        [
            sys.executable,
            os.path.join(SCRIPTS, "migrate_uploads_to_s3.py"),
            "--apply",
            "--buckets",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )
    assert result.returncode == 2
    assert "choose one of --apply, --rollback, --finalize or --stores" in (
        result.stderr
    )
