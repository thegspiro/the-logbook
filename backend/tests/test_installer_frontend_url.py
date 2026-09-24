"""Both installers must leave FRONTEND_URL pointing at the public site.

Every link the app emails is built from FRONTEND_URL. Before this, neither
installer wrote it, so every installed system mailed password resets and
ballots that linked to localhost. These tests run the installers' own shell
functions under bash rather than asserting on the script text alone.
"""

import re
import subprocess
from pathlib import Path

import pytest

from app.core.config import _is_loopback_url

REPO = Path(__file__).parents[2]
UNRAID_SETUP = REPO / "unraid" / "unraid-setup.sh"
UNIVERSAL_INSTALL = REPO / "scripts" / "universal-install.sh"

# Stand-ins for the scripts' logging helpers, so extracted functions run alone.
_LOG_STUBS = """
print_success() { echo "OK:$1"; }
print_warning() { echo "WARN:$1"; }
log_error() { echo "ERROR:$1"; }
log_warning() { echo "WARN:$1"; }
log_info() { echo "INFO:$1"; }
"""


def _functions(script: Path, *names: str) -> str:
    source = script.read_text()
    bodies = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{.*?^\}}\n", source, re.S | re.M)
        assert match, f"{name}() not found in {script.name}"
        bodies.append(match.group(0))
    return _LOG_STUBS + "".join(bodies)


def _bash(prelude: str, command: str, *args: str, cwd: Path | None = None):
    return subprocess.run(
        ["bash", "-c", f"{prelude}\n{command}", "_", *args],
        capture_output=True,
        text=True,
        cwd=cwd,
        timeout=20,
    )


LOOPBACK_CASES = [
    "http://localhost:3000",
    "https://LOCALHOST",
    "http://app.localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.1.2.3",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://user@localhost:3000",
    "",
]
PUBLIC_CASES = [
    "https://logbook.yourdept.org",
    "https://logbook.yourdept.org/",
    "http://192.168.1.50:7880",
    "https://localhost.example.com",
]


@pytest.mark.unit
class TestLoopbackCheckMatchesTheBackend:
    """The installers decide whether to overwrite FRONTEND_URL with the same rule
    the backend uses to warn about it; a drift would leave a value the backend
    warns about, or overwrite one it accepts."""

    @pytest.mark.parametrize("script", [UNRAID_SETUP, UNIVERSAL_INSTALL])
    @pytest.mark.parametrize("url", LOOPBACK_CASES + PUBLIC_CASES)
    def test_agrees_with_backend(self, script, url):
        result = _bash(
            _functions(script, "frontend_url_is_loopback"),
            'frontend_url_is_loopback "$1"',
            url,
        )
        assert (result.returncode == 0) == _is_loopback_url(url)


@pytest.mark.unit
class TestUnraidSetup:
    def test_new_env_uses_the_https_origin(self):
        assert "FRONTEND_URL=${HTTPS_ORIGIN}" in UNRAID_SETUP.read_text()

    def _ensure(self, tmp_path, env: str, *args: str) -> str:
        env_file = tmp_path / ".env"
        env_file.write_text(env)
        result = _bash(
            _functions(UNRAID_SETUP, "frontend_url_is_loopback", "ensure_frontend_url"),
            f'ENV_FILE="{env_file}"; ensure_frontend_url "$@"',
            *args,
        )
        assert result.returncode == 0, result.stderr
        return env_file.read_text()

    def test_absent_value_is_added(self, tmp_path):
        out = self._ensure(tmp_path, "A=1\n", "https://logbook.org")
        assert out == "A=1\nFRONTEND_URL=https://logbook.org\n"

    def test_localhost_value_is_replaced_and_other_lines_kept(self, tmp_path):
        out = self._ensure(
            tmp_path,
            "A=1\nFRONTEND_URL=http://localhost:3000\nB=2\n",
            "https://logbook.org",
        )
        assert out == "A=1\nB=2\nFRONTEND_URL=https://logbook.org\n"

    def test_operator_public_value_is_kept(self, tmp_path):
        env = "FRONTEND_URL=https://mine.example.org\n"
        assert self._ensure(tmp_path, env, "https://logbook.org") == env

    def test_plain_http_value_is_kept_outside_a_migration(self, tmp_path):
        env = "FRONTEND_URL=http://192.168.1.5:7880\n"
        assert self._ensure(tmp_path, env, "https://logbook.org") == env

    def test_plain_http_value_is_replaced_during_https_migration(self, tmp_path):
        out = self._ensure(
            tmp_path,
            "FRONTEND_URL=http://192.168.1.5:7880\n",
            "https://logbook.org",
            "yes",
        )
        assert out == "FRONTEND_URL=https://logbook.org\n"

    def test_sed_metacharacters_in_the_url_survive(self, tmp_path):
        out = self._ensure(tmp_path, "", "https://a.org/x|y&z")
        assert out == "FRONTEND_URL=https://a.org/x|y&z\n"

    @pytest.mark.parametrize("origin", ["", '["https://logbook.org"]', "x y"])
    def test_unusable_origin_leaves_the_file_alone(self, tmp_path, origin):
        env = "FRONTEND_URL=http://localhost:3000\n"
        assert self._ensure(tmp_path, env, origin) == env

    def test_every_existing_env_path_reconciles_it(self):
        body = _functions(UNRAID_SETUP, "validate_existing_env")
        assert body.count("ensure_frontend_url") == 3
        assert 'ensure_frontend_url "$HTTPS_ORIGIN" yes' in body


@pytest.mark.unit
class TestUniversalInstall:
    @pytest.mark.parametrize(
        "url", ["https://logbook.org", "http://10.0.0.5:3000", "http://localhost"]
    )
    def test_plain_urls_are_accepted(self, url):
        result = _bash(
            _functions(
                UNIVERSAL_INSTALL, "frontend_url_is_loopback", "validate_public_url"
            ),
            'validate_public_url "$1"',
            url,
        )
        assert result.returncode == 0

    @pytest.mark.parametrize(
        "url",
        [
            "logbook.org",
            "ftp://logbook.org",
            "https://",
            "https://a b.org",
            "https://a.org/$HOME",
            "https://a.org/#x",
            "https://a'.org",
            'https://a".org',
            "https://a`.org",
            "https://a\\b.org",
        ],
    )
    def test_urls_that_would_corrupt_the_env_file_are_refused(self, url):
        result = _bash(
            _functions(
                UNIVERSAL_INSTALL, "frontend_url_is_loopback", "validate_public_url"
            ),
            'validate_public_url "$1"',
            url,
        )
        assert result.returncode == 1

    def test_a_bad_public_url_fails_before_anything_is_installed(self):
        result = subprocess.run(
            ["bash", str(UNIVERSAL_INSTALL), "--public-url", "ftp://x"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert result.returncode == 1
        assert "must start with http:// or https://" in result.stdout
        assert "Detected" not in result.stdout

    def test_public_url_is_read_from_a_prefixed_variable(self):
        source = UNIVERSAL_INSTALL.read_text()
        assert 'PUBLIC_URL="${LOGBOOK_PUBLIC_URL:-}"' in source
        result = subprocess.run(
            ["bash", str(UNIVERSAL_INSTALL)],
            capture_output=True,
            text=True,
            timeout=20,
            env={"PATH": "/usr/bin:/bin", "LOGBOOK_PUBLIC_URL": "ftp://x"},
        )
        assert result.returncode == 1
        assert "must start with http:// or https://" in result.stdout

    def test_public_url_without_a_value_is_an_error(self):
        result = subprocess.run(
            ["bash", str(UNIVERSAL_INSTALL), "--public-url"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert result.returncode == 1
        assert "needs a value" in result.stdout

    def _create_env(self, tmp_path, public_url: str) -> str:
        prelude = _functions(
            UNIVERSAL_INSTALL,
            "frontend_url_is_loopback",
            "write_frontend_url",
            "reconcile_frontend_url",
            "create_env_file",
        )
        result = _bash(
            prelude,
            'generate_secrets() { :; }; INSTALL_DIR="$1"; PROFILE=standard; '
            'PUBLIC_URL="$2"; DEFAULT_FRONTEND_URL=http://localhost:3000; '
            "COMPOSE_FILE_LIST=x; create_env_file",
            str(tmp_path),
            public_url,
        )
        assert result.returncode == 0, result.stderr
        return (tmp_path / ".env").read_text()

    def test_new_env_takes_the_public_url(self, tmp_path):
        env = self._create_env(tmp_path, "https://logbook.org")
        assert "\nFRONTEND_URL=https://logbook.org\n" in env

    def test_new_env_without_public_url_writes_the_default_explicitly(self, tmp_path):
        env = self._create_env(tmp_path, "")
        assert "\nFRONTEND_URL=http://localhost:3000\n" in env

    def _reconcile(self, tmp_path, env: str, public_url: str):
        env_file = tmp_path / ".env"
        env_file.write_text(env)
        result = _bash(
            _functions(
                UNIVERSAL_INSTALL,
                "frontend_url_is_loopback",
                "write_frontend_url",
                "reconcile_frontend_url",
            ),
            'PUBLIC_URL="$2"; reconcile_frontend_url "$1"',
            str(env_file),
            public_url,
        )
        assert result.returncode == 0, result.stderr
        return env_file.read_text(), result.stdout

    def test_preserved_env_localhost_is_replaced_by_public_url(self, tmp_path):
        env, _ = self._reconcile(
            tmp_path, "A=1\nFRONTEND_URL=http://localhost:3000\n", "https://l.org"
        )
        assert env == "A=1\nFRONTEND_URL=https://l.org\n"

    def test_preserved_env_public_value_is_never_rewritten(self, tmp_path):
        env, out = self._reconcile(
            tmp_path, "FRONTEND_URL=https://mine.org\n", "https://l.org"
        )
        assert env == "FRONTEND_URL=https://mine.org\n"
        assert "keeping it" in out

    def test_preserved_env_localhost_without_public_url_warns(self, tmp_path):
        env, out = self._reconcile(tmp_path, "FRONTEND_URL=http://localhost:3000\n", "")
        assert env == "FRONTEND_URL=http://localhost:3000\n"
        assert "--public-url" in out
