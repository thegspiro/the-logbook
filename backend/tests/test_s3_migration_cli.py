"""scripts/migrate_uploads_to_s3.py — the command line around s3_migration."""

import importlib.util
import os
import shlex
import sys

import pytest

pytestmark = pytest.mark.unit


def _cli():
    spec = importlib.util.spec_from_file_location(
        "migrate_uploads_to_s3",
        os.path.join(
            os.path.dirname(__file__), "..", "scripts", "migrate_uploads_to_s3.py"
        ),
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "argv",
    [
        ["--apply", "--buckets"],
        ["--rollback", "m.json", "--finalize", "m.json"],
        ["--org", "x", "--buckets"],
        ["--org", "x", "--rollback", "m.json"],
    ],
)
def test_conflicting_options_are_refused(monkeypatch, argv):
    monkeypatch.setattr(sys, "argv", ["migrate_uploads_to_s3.py", *argv])
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
