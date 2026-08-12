"""Security regression tests for backup archive extraction."""

import io
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "safe_extract_tar.py"


def _archive(path: Path, member_name: str) -> None:
    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo(member_name)
        content = b"backup data"
        info.size = len(content)
        archive.addfile(info, io.BytesIO(content))


def test_extracts_regular_backup_members(tmp_path: Path) -> None:
    source = tmp_path / "backup.tar.gz"
    destination = tmp_path / "restore"
    _archive(source, "logbook_backup/database.sql")

    subprocess.run(
        [sys.executable, str(SCRIPT), str(source), str(destination)], check=True
    )

    restored = destination / "logbook_backup" / "database.sql"
    assert restored.read_bytes() == b"backup data"


def test_rejects_path_traversal_members(tmp_path: Path) -> None:
    source = tmp_path / "malicious.tar.gz"
    destination = tmp_path / "restore"
    _archive(source, "../../escaped.txt")

    with pytest.raises(subprocess.CalledProcessError):
        subprocess.run(
            [sys.executable, str(SCRIPT), str(source), str(destination)], check=True
        )

    assert not (tmp_path / "escaped.txt").exists()
