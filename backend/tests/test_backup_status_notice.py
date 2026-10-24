"""The administrator notice for backups that are not encrypted.

The backup sidecar records each run in a small status file on the backups
volume; the application reads it and raises a notice only when it says the
archive was written as plaintext.
"""

import json
from pathlib import Path

import pytest

from app.services import system_notices


@pytest.fixture
def status_file(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / ".backup_status"
    monkeypatch.setattr(system_notices, "BACKUP_STATUS_PATH", path)
    return path


def _keys() -> list[str]:
    return [n.key for n in system_notices.current_notices()]


@pytest.mark.unit
class TestBackupsNotEncryptedNotice:
    def test_raised_when_the_last_run_was_plaintext(self, status_file):
        status_file.write_text(json.dumps({"ok": True, "encrypted": False}))

        notices = system_notices.current_notices()

        match = [n for n in notices if n.key == system_notices.BACKUPS_NOT_ENCRYPTED]
        assert len(match) == 1
        assert match[0].severity == "critical"
        assert "backup-keygen.sh" in match[0].detail

    def test_cleared_once_backups_are_encrypted(self, status_file):
        status_file.write_text(json.dumps({"ok": True, "encrypted": True}))

        assert system_notices.BACKUPS_NOT_ENCRYPTED not in _keys()

    def test_no_status_file_means_nothing_to_judge(self, status_file):
        assert not status_file.exists()
        assert system_notices.BACKUPS_NOT_ENCRYPTED not in _keys()

    @pytest.mark.parametrize("content", ["", "not json", "[]", '"x"', '{"ok": true}'])
    def test_an_unreadable_or_incomplete_file_raises_nothing(
        self, status_file, content
    ):
        status_file.write_text(content)

        assert system_notices.BACKUPS_NOT_ENCRYPTED not in _keys()

    def test_a_failed_run_alone_is_not_this_notice(self, status_file):
        status_file.write_text(json.dumps({"ok": False, "encrypted": True}))

        assert system_notices.BACKUPS_NOT_ENCRYPTED not in _keys()

    def test_an_unreadable_path_raises_nothing(self, status_file, monkeypatch):
        monkeypatch.setattr(system_notices, "BACKUP_STATUS_PATH", status_file.parent)

        assert system_notices.BACKUPS_NOT_ENCRYPTED not in _keys()
