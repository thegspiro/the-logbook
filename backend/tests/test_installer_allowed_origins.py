"""The universal installer must leave ALLOWED_ORIGINS naming the public site.

In production the backend builds its Host allowlist from ALLOWED_ORIGINS'
hostnames (Settings.get_trusted_hosts) plus localhost. The installer wrote
only the localhost defaults, so every request arriving under the public
hostname was refused with 400 until someone edited .env by hand. These tests
run the installer's own shell functions under bash.
"""

import re
import subprocess
from pathlib import Path

import pytest

UNIVERSAL_INSTALL = Path(__file__).parents[2] / "scripts" / "universal-install.sh"

_LOG_STUBS = """
log_error() { echo "ERROR:$1"; }
log_warning() { echo "WARN:$1"; }
log_info() { echo "INFO:$1"; }
"""


def _functions(*names: str) -> str:
    source = UNIVERSAL_INSTALL.read_text()
    bodies = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{.*?^\}}\n", source, re.S | re.M)
        assert match, f"{name}() not found in universal-install.sh"
        bodies.append(match.group(0))
    return _LOG_STUBS + "".join(bodies)


def _bash(prelude: str, command: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", f"{prelude}\n{command}", "_", *args],
        capture_output=True,
        text=True,
        timeout=20,
    )


@pytest.mark.unit
class TestUrlOrigin:
    @pytest.mark.parametrize(
        ("url", "origin"),
        [
            ("https://logbook.yourdept.org", "https://logbook.yourdept.org"),
            ("https://logbook.yourdept.org/", "https://logbook.yourdept.org"),
            ("http://192.168.1.50:7880/app/", "http://192.168.1.50:7880"),
            ("https://user@logbook.org", "https://logbook.org"),
        ],
    )
    def test_origin_drops_path_and_userinfo(self, url, origin):
        result = _bash(_functions("url_origin"), 'url_origin "$1"', url)
        assert result.returncode == 0, result.stderr
        assert result.stdout == origin


@pytest.mark.unit
class TestNewEnv:
    def test_new_env_allows_the_public_origin(self, tmp_path):
        result = _bash(
            _functions("url_origin", "create_env_file"),
            'generate_secrets() { :; }; INSTALL_DIR="$1"; PROFILE=standard; '
            'PUBLIC_URL="$2"; COMPOSE_FILE_LIST=x; create_env_file',
            str(tmp_path),
            "https://logbook.org/members",
        )
        assert result.returncode == 0, result.stderr
        env = (tmp_path / ".env").read_text()
        assert "\nALLOWED_ORIGINS=https://logbook.org\n" in env
        assert "ALLOWED_ORIGINS=http://localhost" not in env


@pytest.mark.unit
class TestPreservedEnv:
    def _reconcile(self, tmp_path, env: str):
        env_file = tmp_path / ".env"
        env_file.write_text(env)
        result = _bash(
            _functions(
                "frontend_url_is_loopback", "url_origin", "reconcile_allowed_origins"
            ),
            'reconcile_allowed_origins "$1"',
            str(env_file),
        )
        return result, env_file.read_text()

    def test_localhost_only_list_gains_the_public_origin(self, tmp_path):
        result, env = self._reconcile(
            tmp_path,
            "A=1\nALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000\n"
            "FRONTEND_URL=https://logbook.org/\n",
        )
        assert result.returncode == 0, result.stdout
        assert env == (
            "A=1\nFRONTEND_URL=https://logbook.org/\n"
            "ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,"
            "https://logbook.org\n"
        )

    def test_absent_value_is_added(self, tmp_path):
        result, env = self._reconcile(tmp_path, "FRONTEND_URL=https://l.org\n")
        assert result.returncode == 0, result.stdout
        assert env == "FRONTEND_URL=https://l.org\nALLOWED_ORIGINS=https://l.org\n"

    def test_a_list_with_a_public_origin_is_never_rewritten(self, tmp_path):
        original = (
            "ALLOWED_ORIGINS=http://localhost:3000, https://mine.org\n"
            "FRONTEND_URL=https://l.org\n"
        )
        result, env = self._reconcile(tmp_path, original)
        assert result.returncode == 0, result.stdout
        assert env == original

    def test_no_public_frontend_url_is_an_error(self, tmp_path):
        original = "ALLOWED_ORIGINS=http://localhost:3000\n"
        result, env = self._reconcile(tmp_path, original)
        assert result.returncode == 1
        assert "ERROR:Cannot set ALLOWED_ORIGINS" in result.stdout
        assert env == original

    def test_the_existing_env_path_reconciles_after_frontend_url(self):
        body = _functions("create_env_file")
        frontend = body.index('reconcile_frontend_url "$INSTALL_DIR/.env"')
        origins = body.index('reconcile_allowed_origins "$INSTALL_DIR/.env"')
        assert frontend < origins
