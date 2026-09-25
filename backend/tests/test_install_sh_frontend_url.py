"""install.sh must leave FRONTEND_URL pointing at the public site.

Every link the app emails is built from FRONTEND_URL, and install.sh copied
.env.example — which ships it as localhost — without ever changing it. These
tests run the script's own shell functions under bash.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core.config import _is_loopback_url

REPO = Path(__file__).parents[2]
INSTALL = REPO / "install.sh"
ENV_EXAMPLE = REPO / ".env.example"

# Stand-ins for the script's logging helpers, so extracted functions run alone.
_LOG_STUBS = """
print_success() { echo "OK:$1"; }
print_error() { echo "ERROR:$1"; }
print_warning() { echo "WARN:$1"; }
print_info() { echo "INFO:$1"; }
"""

_HELPERS = (
    "frontend_url_is_loopback",
    "env_has_public_frontend_url",
    "validate_public_url",
    "prompt_public_url",
    "write_frontend_url",
    "reconcile_frontend_url",
)


def _functions(*names: str) -> str:
    source = INSTALL.read_text()
    bodies = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{.*?^\}}\n", source, re.S | re.M)
        assert match, f"{name}() not found in install.sh"
        bodies.append(match.group(0))
    return _LOG_STUBS + "".join(bodies)


def _bash(prelude: str, command: str, *args: str, stdin: str = ""):
    # stdin is a pipe, never a terminal, so prompt_public_url stays silent.
    return subprocess.run(
        ["bash", "-c", f"{prelude}\n{command}", "_", *args],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=20,
    )


def _frontend_url(env_text: str) -> list[str]:
    return re.findall(r"^FRONTEND_URL=(.*)$", env_text, re.M)


@pytest.mark.unit
@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:3000",
        "https://LOCALHOST",
        "http://app.localhost:8080",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
        "http://0.0.0.0:3000",
        "http://user@localhost:3000",
        "",
        "https://logbook.yourdept.org",
        "http://192.168.1.50:7880",
        "https://localhost.example.com",
    ],
)
def test_loopback_check_agrees_with_the_backend(url):
    result = _bash(
        _functions("frontend_url_is_loopback"), 'frontend_url_is_loopback "$1"', url
    )
    assert (result.returncode == 0) == _is_loopback_url(url)


@pytest.mark.unit
class TestPublicUrlArgument:
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
            "https://a`.org",
            "http://localhost:3000",
            "https://127.0.0.1",
        ],
    )
    def test_urls_that_would_corrupt_the_env_file_or_not_boot_are_refused(self, url):
        result = _bash(
            _functions("frontend_url_is_loopback", "validate_public_url"),
            'validate_public_url "$1"',
            url,
        )
        assert result.returncode == 1

    def test_a_bad_url_fails_before_anything_is_checked_or_installed(self):
        result = subprocess.run(
            ["bash", str(INSTALL), "--public-url", "ftp://x", "--docker"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert result.returncode == 1
        assert "must start with http:// or https://" in result.stdout
        assert "INSTALLATION" not in result.stdout

    def test_the_prefixed_environment_variable_is_read(self):
        assert 'PUBLIC_URL="${LOGBOOK_PUBLIC_URL:-}"' in INSTALL.read_text()
        result = subprocess.run(
            ["bash", str(INSTALL), "--docker"],
            capture_output=True,
            text=True,
            timeout=20,
            env={"PATH": "/usr/bin:/bin", "LOGBOOK_PUBLIC_URL": "ftp://x"},
        )
        assert result.returncode == 1
        assert "must start with http:// or https://" in result.stdout

    def test_no_url_without_a_terminal_fails_before_anything_is_installed(
        self, tmp_path
    ):
        # A copy, so SCRIPT_DIR (and the .env it looks for) is the empty tmp dir.
        script = tmp_path / "install.sh"
        shutil.copy(INSTALL, script)
        result = subprocess.run(
            ["bash", str(script), "--docker"],
            input="",
            capture_output=True,
            text=True,
            timeout=20,
            env={"PATH": "/usr/bin:/bin"},
        )
        assert result.returncode == 1
        assert "A public URL is required" in result.stdout
        assert "INSTALLATION" not in result.stdout

    def test_help_needs_no_url(self, tmp_path):
        script = tmp_path / "install.sh"
        shutil.copy(INSTALL, script)
        result = subprocess.run(
            ["bash", str(script), "--help"],
            input="",
            capture_output=True,
            text=True,
            timeout=20,
            env={"PATH": "/usr/bin:/bin"},
        )
        assert "A public URL is required" not in result.stdout

    def test_missing_value_is_an_error(self):
        result = subprocess.run(
            ["bash", str(INSTALL), "--public-url"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert result.returncode == 1
        assert "needs a value" in result.stdout

    def test_mode_argument_still_reaches_main_alongside_it(self):
        prelude = _functions("frontend_url_is_loopback")
        source = INSTALL.read_text()
        extract = re.search(
            r"^MODE_ARGS=\(\)\n^extract_public_url_arg\(\) \{.*?^\}\n",
            source,
            re.S | re.M,
        ).group(0)
        result = _bash(
            prelude + extract,
            'extract_public_url_arg "$@"; echo "URL=$PUBLIC_URL"; '
            'echo "MODE=${MODE_ARGS[*]}"',
            "--docker",
            "--public-url",
            "https://l.org",
        )
        assert "URL=https://l.org" in result.stdout
        assert "MODE=--docker" in result.stdout


@pytest.mark.unit
class TestSetupEnvironment:
    def _run(self, tmp_path, public_url: str, stdin: str = "", ok: bool = True) -> str:
        shutil.copy(ENV_EXAMPLE, tmp_path / ".env.example")
        result = _bash(
            _functions(*_HELPERS, "setup_environment"),
            'print_header() { :; }; SCRIPT_DIR="$1"; PUBLIC_URL="$2"; '
            "setup_environment",
            str(tmp_path),
            public_url,
            stdin=stdin,
        )
        assert (result.returncode == 0) == ok, result.stdout + result.stderr
        return (tmp_path / ".env").read_text()

    def test_new_env_takes_the_public_url(self, tmp_path):
        env = self._run(tmp_path, "https://logbook.org")
        assert _frontend_url(env) == ["https://logbook.org"]

    def test_new_env_without_one_stops_the_install(self, tmp_path):
        # Reachable only when a .env existed and was then overwritten without
        # a terminal; require_public_url stops every other route earlier.
        self._run(tmp_path, "", ok=False)

    def test_url_with_sed_metacharacters_survives(self, tmp_path):
        env = self._run(tmp_path, "https://a.org/x|y&z")
        assert _frontend_url(env) == ["https://a.org/x|y&z"]

    def test_kept_env_localhost_is_replaced(self, tmp_path):
        (tmp_path / ".env").write_text(
            "A=1\nFRONTEND_URL=http://localhost:3000\nSECURITY_REQUIRE_TLS=false\n"
            "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml\n"
        )
        env = self._run(tmp_path, "https://l.org", stdin="n")
        assert _frontend_url(env) == ["https://l.org"]
        assert env.startswith("A=1\n")

    def test_kept_env_localhost_without_a_url_stops_the_install(self, tmp_path):
        original = (
            "FRONTEND_URL=http://localhost:3000\nSECURITY_REQUIRE_TLS=false\n"
            "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml\n"
        )
        (tmp_path / ".env").write_text(original)
        assert self._run(tmp_path, "", stdin="n", ok=False) == original

    def test_kept_env_public_value_is_never_rewritten(self, tmp_path):
        original = (
            "FRONTEND_URL=https://mine.org\nSECURITY_REQUIRE_TLS=false\n"
            "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml\n"
        )
        (tmp_path / ".env").write_text(original)
        assert self._run(tmp_path, "https://l.org", stdin="n") == original


@pytest.mark.unit
class TestRequirePublicUrl:
    def _require(self, tmp_path, env: str | None, public_url: str = ""):
        if env is not None:
            (tmp_path / ".env").write_text(env)
        return _bash(
            _functions(
                "frontend_url_is_loopback",
                "env_has_public_frontend_url",
                "require_public_url",
            ),
            'SCRIPT_DIR="$1"; PUBLIC_URL="$2"; require_public_url',
            str(tmp_path),
            public_url,
        )

    @pytest.mark.parametrize(
        "env", [None, "FRONTEND_URL=http://localhost:3000\n", "A=1\n"]
    )
    def test_refuses_without_one(self, tmp_path, env):
        result = self._require(tmp_path, env)
        assert result.returncode == 1
        assert "--public-url" in result.stdout

    def test_accepts_the_flag(self, tmp_path):
        assert self._require(tmp_path, None, "https://l.org").returncode == 0

    def test_accepts_a_preserved_public_env(self, tmp_path):
        env = "FRONTEND_URL=https://mine.org\n"
        assert self._require(tmp_path, env).returncode == 0

    def test_the_closing_localhost_warning_is_gone(self):
        # Superseded: an install can no longer finish with a loopback URL.
        assert "warn_if_frontend_url_is_loopback" not in INSTALL.read_text()
