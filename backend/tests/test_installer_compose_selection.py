"""Static checks that the installers deploy the PRODUCTION compose stack.

Both installers layer ``docker-compose.prod.yml`` on the development base
file: the override drops ``uvicorn --reload`` and the source bind mounts,
unpublishes the backend port, turns docs off and enforces the production
security settings. Selecting it through ``COMPOSE_FILE`` in ``.env`` alone is
not enough — an operator's preserved ``.env`` may predate that key, and a
shell variable the installer sets is not exported to the ``docker compose``
child process. So every stack-touching invocation must name both files with
explicit ``-f`` flags, which take precedence over ``COMPOSE_FILE`` and cannot
be defeated by whatever the environment happens to hold.
"""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
UNIVERSAL = ROOT / "scripts" / "universal-install.sh"
INSTALL = ROOT / "install.sh"

# Lines that merely print or probe are not deployments.
_NOT_A_DEPLOYMENT = (
    "docker compose version",
    "command -v docker compose",
)
_OUTPUT_PREFIXES = ("#", "echo", "log_", "print_")


def _deployment_commands(script: str) -> list[str]:
    commands = []
    for raw in script.splitlines():
        line = raw.strip()
        if "docker compose" not in line:
            continue
        if line.startswith(_OUTPUT_PREFIXES):
            continue
        if any(skip in line for skip in _NOT_A_DEPLOYMENT):
            continue
        commands.append(line)
    return commands


def test_universal_installer_defines_both_compose_files() -> None:
    script = UNIVERSAL.read_text(encoding="utf-8")

    assert (
        "COMPOSE_FILE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml)" in script
    )
    assert 'COMPOSE_FILE_LIST="docker-compose.yml:docker-compose.prod.yml"' in script


def test_universal_installer_passes_compose_files_to_every_invocation() -> None:
    commands = _deployment_commands(UNIVERSAL.read_text(encoding="utf-8"))

    assert commands, "no docker compose invocations found — did the script move?"
    missing = [c for c in commands if '"${COMPOSE_FILE_ARGS[@]}"' not in c]
    assert missing == [], (
        "docker compose invocations that do not name both compose files "
        "explicitly (they would fall back to whatever COMPOSE_FILE the "
        "operator's .env holds, or to the development base file alone):\n"
        + "\n".join(f"  - {c}" for c in missing)
    )


def test_universal_installer_pins_compose_file_in_a_preserved_env() -> None:
    """A kept .env gets the key appended when absent — and nothing else.

    The operator's own values (secrets, passwords) are never rewritten, so the
    guard must be an append behind an absence check, not a sed replacement.
    """
    script = UNIVERSAL.read_text(encoding="utf-8")

    assert (
        "if ! grep -qE '^[[:space:]]*COMPOSE_FILE=' \"$INSTALL_DIR/.env\"; then"
        in script
    )
    assert 'cat >> "$INSTALL_DIR/.env"' in script
    assert "COMPOSE_FILE=$COMPOSE_FILE_LIST" in script
    assert 'sed -i "s|^COMPOSE_FILE=' not in script


def test_install_sh_passes_both_compose_files_to_every_invocation() -> None:
    script = INSTALL.read_text(encoding="utf-8")
    commands = _deployment_commands(script)

    assert commands, "no docker compose invocations found — did the script move?"
    assert 'COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"' in script
    missing = [c for c in commands if "$COMPOSE_FILES" not in c]
    assert missing == [], "\n".join(f"  - {c}" for c in missing)


def test_install_sh_pins_compose_file_in_a_preserved_env() -> None:
    script = INSTALL.read_text(encoding="utf-8")

    assert (
        "if ! grep -qE '^[[:space:]]*COMPOSE_FILE=' \"$SCRIPT_DIR/.env\"; then"
        in script
    )
    assert "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml" in script


# ---------------------------------------------------------------------------
# docker-compose.proxy.yml — the operator's opt-in to the bundled nginx as the
# only way in. The explicit -f flags above ignore COMPOSE_FILE, so without
# these checks every installer re-run would publish port 3000 again.
# ---------------------------------------------------------------------------

_PINNED = "docker-compose.yml:docker-compose.prod.yml:docker-compose.proxy.yml"
_BASE = "docker-compose.yml:docker-compose.prod.yml"


def _shell_function(script: Path, name: str) -> str:
    match = re.search(
        rf"^{name}\(\) \{{\n.*?^\}}\n", script.read_text(encoding="utf-8"), re.M | re.S
    )
    assert match, f"{name} not found in {script.name}"
    return match.group(0)


def test_both_installers_carry_the_same_proxy_detection() -> None:
    """A fix to one copy that misses the other would split their behaviour."""
    assert _shell_function(UNIVERSAL, "env_pins_proxy_override") == _shell_function(
        INSTALL, "env_pins_proxy_override"
    )


def _pins_proxy(tmp_path: Path, env_text: str | None) -> bool:
    env_file = tmp_path / ".env"
    if env_text is not None:
        env_file.write_bytes(env_text.encode("utf-8"))
    body = _shell_function(INSTALL, "env_pins_proxy_override")
    result = subprocess.run(
        ["bash", "-c", body + 'env_pins_proxy_override "$1"', "_", str(env_file)],
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


# Each verdict below was checked against `docker compose config` itself: the
# function must read COMPOSE_FILE the way Compose does, or the installer and
# the operator's own `docker compose` commands would run different stacks.
@pytest.mark.parametrize(
    ("env_text", "expected"),
    [
        (f"COMPOSE_FILE={_PINNED}\n", True),
        (f"COMPOSE_FILE={_BASE}\n", False),
        ("SECRET_KEY=x\n", False),
        (f'COMPOSE_FILE="{_PINNED}"\n', True),
        (f"COMPOSE_FILE='{_PINNED}'\n", True),
        (f"  COMPOSE_FILE={_PINNED}\n", True),
        (f"COMPOSE_FILE={_PINNED}  # bundled proxy\n", True),
        (f"COMPOSE_FILE={_BASE} # add docker-compose.proxy.yml later\n", False),
        (f"# COMPOSE_FILE={_PINNED}\n", False),
        (f"COMPOSE_FILE={_PINNED}\nCOMPOSE_FILE={_BASE}\n", False),
        (f"COMPOSE_FILE={_BASE}\nCOMPOSE_FILE={_PINNED}\n", True),
        (f"COMPOSE_FILE={_PINNED}\r\n", True),
        (f"COMPOSE_FILE={_BASE}:./docker-compose.proxy.yml\n", True),
        (f"COMPOSE_FILE={_BASE}:docker-compose.proxy.yml.bak\n", False),
    ],
    ids=[
        "pinned",
        "base-and-prod",
        "no-key",
        "double-quoted",
        "single-quoted",
        "indented",
        "inline-comment",
        "named-only-in-comment",
        "commented-out",
        "last-wins-base",
        "last-wins-proxy",
        "crlf",
        "dot-slash",
        "lookalike",
    ],
)
def test_proxy_pin_is_read_the_way_compose_reads_it(
    tmp_path: Path, env_text: str, expected: bool
) -> None:
    assert _pins_proxy(tmp_path, env_text) is expected


def test_no_env_file_is_not_a_pin(tmp_path: Path) -> None:
    assert _pins_proxy(tmp_path, None) is False


@pytest.mark.parametrize(
    ("script", "dir_var", "logger"),
    [(UNIVERSAL, "INSTALL_DIR", "log_error"), (INSTALL, "SCRIPT_DIR", "print_error")],
    ids=["universal-install", "install.sh"],
)
@pytest.mark.parametrize(
    ("has_proxy_file", "certs", "expected_ok"),
    [
        (True, {"fullchain.pem": b"x", "privkey.pem": b"x"}, True),
        (True, {"fullchain.pem": b"x"}, False),
        (True, {"fullchain.pem": b"x", "privkey.pem": b""}, False),
        (True, {}, False),
        (False, {"fullchain.pem": b"x", "privkey.pem": b"x"}, False),
    ],
    ids=["ready", "no-key", "empty-key", "no-certs", "no-proxy-file"],
)
def test_proxy_mode_refuses_to_start_without_its_certificates(
    tmp_path: Path, script, dir_var, logger, has_proxy_file, certs, expected_ok
) -> None:
    """In proxy mode nginx is the only way in, and it will not start without a
    certificate — so the installer must stop before building, not report
    success on an install nobody can reach."""
    if has_proxy_file:
        (tmp_path / "docker-compose.proxy.yml").write_text("services: {}\n")
    ssl_dir = tmp_path / "infrastructure" / "nginx" / "ssl"
    ssl_dir.mkdir(parents=True)
    for name, content in certs.items():
        (ssl_dir / name).write_bytes(content)

    body = _shell_function(script, "require_proxy_certificates")
    result = subprocess.run(
        [
            "bash",
            "-c",
            f'{logger}() {{ echo "$1"; }}\n{dir_var}="$1"\n{body}require_proxy_certificates',
            "_",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert (result.returncode == 0) is expected_ok, result.stdout


def test_universal_installer_adds_the_proxy_file_when_pinned() -> None:
    script = UNIVERSAL.read_text(encoding="utf-8")
    assert 'if env_pins_proxy_override "$INSTALL_DIR/.env"; then' in script
    assert "require_proxy_certificates || exit 1" in script
    assert "COMPOSE_FILE_ARGS+=(-f docker-compose.proxy.yml)" in script


def test_install_sh_adds_the_proxy_file_when_pinned() -> None:
    script = INSTALL.read_text(encoding="utf-8")
    assert 'if env_pins_proxy_override "$SCRIPT_DIR/.env"; then' in script
    assert "require_proxy_certificates || exit 1" in script
    assert 'COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.proxy.yml"' in script
