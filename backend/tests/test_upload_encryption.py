"""scripts/encrypt_uploads.py — encrypting files stored before encryption.

Unit: real files under a temporary uploads root, no database (paths do not
change, so no rows are read or written).
"""

import json
import os

import pytest

from app.core import file_encryption
from app.core.config import settings
from app.core.security import reset_encryption_ciphers
from app.services import file_storage_service, system_notices, upload_encryption

pytestmark = pytest.mark.unit

KEY_A = "a" * 64
KEY_B = "b" * 64


@pytest.fixture(autouse=True)
def root(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(uploads))
    monkeypatch.setattr(
        file_storage_service,
        "LEGACY_EMAIL_ATTACHMENT_DIR",
        str(tmp_path / "no-legacy-attachments"),
    )
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_A)
    monkeypatch.setattr(settings, "ENCRYPTION_SALT", "0" * 32)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
    reset_encryption_ciphers()
    upload_encryption._cache.clear()
    yield uploads
    upload_encryption._cache.clear()
    reset_encryption_ciphers()


def _plain(root, *parts, data=b"%PDF-1.4 stored before encryption"):
    path = root.joinpath(*parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


def _snapshot(root):
    return {str(p): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_a_dry_run_changes_nothing(root):
    _plain(root, "org", "documents", "a.pdf")
    file_storage_service.write_atomically(str(root / "org"), "new.pdf", b"new")
    before = _snapshot(root)

    report = upload_encryption.apply(dry_run=True)

    assert report.summary()["plain_files"] == 1
    assert report.summary()["encrypted_files"] == 1
    assert report.manifest_path is None
    assert _snapshot(root) == before


def test_apply_encrypts_in_place_and_keeps_the_original(root):
    data = os.urandom(file_encryption.CHUNK_SIZE + 11)
    path = _plain(root, "org", "suggestions", "shot.png", data=data)
    os.utime(path, (1_700_000_000, 1_700_000_000))

    report = upload_encryption.apply(dry_run=False)

    assert [e["path"] for e in report.encrypted] == [path]
    assert file_encryption.is_encrypted(path)
    assert file_encryption.read_plaintext(path) == data
    # Anonymous screenshots carry a deliberately coarse mtime.
    assert os.stat(path).st_mtime == 1_700_000_000
    backup = report.encrypted[0]["backup"]
    with open(backup, "rb") as handle:
        assert handle.read() == data
    manifest = json.loads(open(report.manifest_path).read())
    assert manifest["files"][0]["size"] == len(data)
    assert not [p for p in os.listdir(os.path.dirname(path)) if ".encrypting" in p]
    # Kept originals are not themselves files to encrypt.
    assert upload_encryption.apply(dry_run=True).survey.plain == []


def test_rollback_puts_the_originals_back(root):
    path = _plain(root, "org", "documents", "a.pdf", data=b"original")
    report = upload_encryption.apply(dry_run=False)

    result = upload_encryption.rollback(report.manifest_path)

    assert result == {"restored": 1, "originals_missing": 0}
    with open(path, "rb") as handle:
        assert handle.read() == b"original"
    with pytest.raises(ValueError, match="rolled back"):
        upload_encryption.finalize(report.manifest_path)


def test_finalize_removes_only_verified_originals(root):
    good = _plain(root, "org", "documents", "good.pdf", data=b"good")
    bad = _plain(root, "org", "documents", "bad.pdf", data=b"bad")
    report = upload_encryption.apply(dry_run=False)
    # Something replaced this file after the run: its original must survive.
    with open(bad, "wb") as handle:
        handle.write(file_encryption.encrypt_bytes(b"something else"))

    result = upload_encryption.finalize(report.manifest_path)

    assert result == {"originals_removed": 1, "kept_unverified": 1}
    entries = {e["path"]: e["backup"] for e in report.encrypted}
    assert not os.path.exists(entries[good])
    assert os.path.exists(entries[bad])
    with pytest.raises(ValueError, match="finalized"):
        upload_encryption.rollback(report.manifest_path)


def test_rewrap_moves_files_off_a_retired_key(root, monkeypatch):
    file_storage_service.write_atomically(str(root / "org"), "a.pdf", b"a")
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", KEY_A)
    reset_encryption_ciphers()

    assert upload_encryption.rewrap_all(dry_run=True) == {
        "dry_run": True,
        "under_a_retired_key": 1,
    }
    assert upload_encryption.rewrap_all(dry_run=False)["rewrapped"] == 1
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
    reset_encryption_ciphers()
    assert file_encryption.read_plaintext(str(root / "org" / "a.pdf")) == b"a"


def test_symlinks_and_housekeeping_are_left_alone(root, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"not an upload")
    (root / "org").mkdir()
    os.symlink(outside, root / "org" / "link.txt")
    _plain(root, ".relocation", "relocation-x.json", data=b"{}")

    assert upload_encryption.apply(dry_run=False).encrypted == []
    assert outside.read_bytes() == b"not an upload"


class TestTheNotice:
    def _keys(self):
        return [n.key for n in system_notices.current_notices()]

    def test_shown_while_plain_files_remain(self, root, monkeypatch):
        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
        _plain(root, "org", "documents", "a.pdf")
        assert self._keys() == [system_notices.FILES_NOT_ENCRYPTED]

    def test_stays_until_the_run_is_finalized(self, root, monkeypatch):
        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
        _plain(root, "org", "documents", "a.pdf")
        report = upload_encryption.apply(dry_run=False)
        upload_encryption._cache.clear()
        # The kept originals are still plaintext on disk.
        assert self._keys() == [system_notices.FILES_NOT_ENCRYPTED]

        upload_encryption.finalize(report.manifest_path)
        assert self._keys() == []
        # Recorded, so later checks do not walk the tree again.
        assert os.path.exists(root / ".encryption" / "state.json")

    def test_absent_on_an_installation_with_nothing_plain(self, root, monkeypatch):
        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
        file_storage_service.write_atomically(str(root / "org"), "a.pdf", b"a")
        assert self._keys() == []

    def test_rollback_brings_it_back(self, root, monkeypatch):
        monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
        _plain(root, "org", "documents", "a.pdf")
        report = upload_encryption.apply(dry_run=False)
        upload_encryption.finalize(report.manifest_path)
        assert self._keys() == []
        # A second run's rollback forgets the "complete" record.
        _plain(root, "org", "documents", "b.pdf")
        second = upload_encryption.apply(dry_run=False)
        upload_encryption.rollback(second.manifest_path)
        assert self._keys() == [system_notices.FILES_NOT_ENCRYPTED]


def test_the_cli_dry_run_exits_cleanly(root, monkeypatch, capsys):
    import importlib.util
    import sys

    _plain(root, "org", "documents", "a.pdf")
    spec = importlib.util.spec_from_file_location(
        "encrypt_uploads",
        os.path.join(os.path.dirname(__file__), "..", "scripts", "encrypt_uploads.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(sys, "argv", ["encrypt_uploads.py"])

    assert module.main() == 0
    out = capsys.readouterr().out
    assert '"plain_files": 1' in out
    assert "Dry run" in out
    assert not file_encryption.is_encrypted(str(root / "org" / "documents" / "a.pdf"))
