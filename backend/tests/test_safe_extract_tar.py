"""Security regression tests for backup archive extraction."""

import importlib.util
import io
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "safe_extract_tar.py"

_spec = importlib.util.spec_from_file_location("safe_extract_tar", SCRIPT)
safe_extract_tar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(safe_extract_tar)


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


# ---------------------------------------------------------------------------
# Fallback path (Python < 3.12 without the extraction-filter backport):
# extract_validated() must reject malicious members BEFORE extracting anything.
# ---------------------------------------------------------------------------


def _extract_via_fallback(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source, mode="r:*") as archive:
        safe_extract_tar.extract_validated(archive, destination)


def test_fallback_extracts_regular_members(tmp_path: Path) -> None:
    source = tmp_path / "backup.tar.gz"
    destination = tmp_path / "restore"
    _archive(source, "logbook_backup/database.sql")

    _extract_via_fallback(source, destination)

    restored = destination / "logbook_backup" / "database.sql"
    assert restored.read_bytes() == b"backup data"


def test_fallback_rejects_path_traversal(tmp_path: Path) -> None:
    source = tmp_path / "malicious.tar.gz"
    destination = tmp_path / "restore"
    _archive(source, "../../escaped.txt")

    with pytest.raises(ValueError, match="traversal"):
        _extract_via_fallback(source, destination)

    assert not (tmp_path / "escaped.txt").exists()


def test_fallback_rejects_absolute_paths(tmp_path: Path) -> None:
    source = tmp_path / "malicious.tar.gz"
    destination = tmp_path / "restore"
    _archive(source, "/etc/hijacked.txt")

    with pytest.raises(ValueError, match="absolute"):
        _extract_via_fallback(source, destination)


def test_fallback_rejects_symlink_members(tmp_path: Path) -> None:
    source = tmp_path / "malicious.tar.gz"
    destination = tmp_path / "restore"
    with tarfile.open(source, "w:gz") as archive:
        link = tarfile.TarInfo("logbook_backup/evil_link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        archive.addfile(link)

    with pytest.raises(ValueError, match="link"):
        _extract_via_fallback(source, destination)


def test_fallback_rejects_late_malicious_member_without_partial_extract(
    tmp_path: Path,
) -> None:
    source = tmp_path / "malicious.tar.gz"
    destination = tmp_path / "restore"
    with tarfile.open(source, "w:gz") as archive:
        good = tarfile.TarInfo("logbook_backup/database.sql")
        content = b"backup data"
        good.size = len(content)
        archive.addfile(good, io.BytesIO(content))
        bad = tarfile.TarInfo("../escaped.txt")
        bad.size = len(content)
        archive.addfile(bad, io.BytesIO(content))

    with pytest.raises(ValueError, match="traversal"):
        _extract_via_fallback(source, destination)

    # All members are validated up front, so the benign member must not have
    # been extracted either.
    assert not (destination / "logbook_backup" / "database.sql").exists()
    assert not (tmp_path / "escaped.txt").exists()
