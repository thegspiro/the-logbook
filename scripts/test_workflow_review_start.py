"""Guards in the workflow-review launcher that protect real data.

``scripts/workflow-review/start.sh --reset`` drops a database. The review has
its own, and the launcher must refuse to be pointed at the application or test
database: a review onboards a department, and an organization left in the test
database fails the onboarding tests; a reset there would delete the rows the
suite needs. These cases pin the refusals, which all happen before the
launcher connects to anything, so they need no MySQL.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import os
import subprocess
import tempfile
import unittest

START = os.path.join(os.path.dirname(__file__), "workflow-review", "start.sh")


def run_start(*args: str, **env_overrides: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as state_dir:
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "WR_STATE_DIR": state_dir,
        }
        env.update(env_overrides)
        return subprocess.run(
            ["sh", START, *args],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )


class TestDatabaseGuards(unittest.TestCase):
    def test_refuses_the_default_application_database(self):
        result = run_start("--reset", WR_DB_NAME="intranet_db")

        assert result.returncode != 0
        assert "must not be the application or test database" in result.stderr

    def test_refuses_whatever_db_name_the_backend_uses(self):
        result = run_start("--reset", WR_DB_NAME="dept_prod", DB_NAME="dept_prod")

        assert result.returncode != 0
        assert "must not be the application or test database" in result.stderr

    def test_refuses_a_name_that_is_not_an_identifier(self):
        # The name is interpolated into DROP DATABASE.
        result = run_start("--reset", WR_DB_NAME="review`; DROP DATABASE x; --")

        assert result.returncode != 0
        assert "letters, digits and underscores" in result.stderr

    def test_refuses_a_redis_db_that_is_not_a_number(self):
        result = run_start(WR_REDIS_DB="0 FLUSHALL")

        assert result.returncode != 0
        assert "WR_REDIS_DB must be a number" in result.stderr


class TestArguments(unittest.TestCase):
    def test_rejects_an_unknown_argument(self):
        result = run_start("--rest")

        assert result.returncode != 0
        assert "unknown argument" in result.stderr

    def test_requires_a_database_password_from_the_environment(self):
        result = run_start()

        assert result.returncode != 0
        assert "DB_PASSWORD is not set" in result.stderr

    def test_stop_with_nothing_running_succeeds(self):
        result = run_start("--stop")

        assert result.returncode == 0, result.stderr


if __name__ == "__main__":
    unittest.main()
