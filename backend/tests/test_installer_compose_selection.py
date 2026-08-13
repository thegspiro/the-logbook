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

from pathlib import Path

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
