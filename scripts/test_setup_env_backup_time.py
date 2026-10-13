"""setup-env.py writes the backup setting the backup service actually reads.

It used to prompt for BACKUP_ENABLED and a cron BACKUP_SCHEDULE, neither of
which anything reads; the sidecar runs on BACKUP_TIME (HH:MM, UTC).
"""

import importlib.util
import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "setup_env", REPO / "scripts" / "setup-env.py"
)
setup_env = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(setup_env)


def _run_wizard(answers, argv=()):
    """Run main() in a scratch directory; every other prompt takes its default."""
    pending = list(answers)
    calls = []

    def fake_input(prompt):
        # A required prompt with no default re-asks forever on an empty
        # answer; fail the test instead of hanging the job.
        calls.append(prompt)
        if len(calls) > 200:
            raise AssertionError(f"wizard kept asking: {prompt!r}")
        for key in list(pending):
            if key[0] in prompt:
                pending.remove(key)
                return key[1]
        return ""

    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(REPO / ".env.example", Path(tmp) / ".env.example")
        (Path(tmp) / "unraid").mkdir()
        shutil.copy(
            REPO / "unraid" / ".env.example", Path(tmp) / "unraid" / ".env.example"
        )
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            with mock.patch("builtins.input", fake_input), mock.patch.object(
                sys, "argv", ["setup-env.py", *argv]
            ), redirect_stdout(io.StringIO()) as out:
                setup_env.main()
            env_path = Path("unraid/.env") if "--unraid" in argv else Path(".env")
            return env_path.read_text(), out.getvalue()
        finally:
            os.chdir(cwd)


class BackupTimeValidationTest(unittest.TestCase):
    def test_accepts_24_hour_times(self):
        for value in ("00:00", "02:00", "09:05", "23:59"):
            assert setup_env.BACKUP_TIME_RE.match(value), value

    def test_rejects_anything_the_sidecar_cannot_schedule(self):
        for value in ("2:00", "24:00", "02:60", "0 2 * * *", "2am", "02:00:00", ""):
            assert not setup_env.BACKUP_TIME_RE.match(value), value


class WizardOutputTest(unittest.TestCase):
    def test_writes_backup_time_and_drops_the_unread_settings(self):
        env, _ = _run_wizard([("backup time", "03:30")])

        assert "BACKUP_TIME=03:30" in env
        assert "BACKUP_ENABLED" not in env
        assert "BACKUP_SCHEDULE" not in env

    def test_default_is_two_in_the_morning(self):
        env, _ = _run_wizard([])

        assert "BACKUP_TIME=02:00" in env

    def test_asks_again_after_an_invalid_time(self):
        env, out = _run_wizard([("backup time", "0 2 * * *"), ("backup time", "04:15")])

        assert "BACKUP_TIME=04:15" in env
        assert "Enter a 24-hour time" in out

    def test_unraid_template_carries_the_setting_too(self):
        env, _ = _run_wizard(
            [("Unraid IP", "192.168.1.10"), ("backup time", "01:45")],
            argv=["--unraid"],
        )

        assert "BACKUP_TIME=01:45" in env
        assert "BACKUP_ENABLED" not in env
        assert "BACKUP_SCHEDULE" not in env


if __name__ == "__main__":
    unittest.main()
