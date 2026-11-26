"""The systemd unit install.sh --traditional writes for the backend.

The HEIC decoder runs in a child process that raises its own OOM score, so
when memory runs out the kernel kills the conversion rather than the server.
systemd's default ``OOMPolicy=stop`` would then stop the whole backend
service for that one kill; the unit must say ``continue``.
"""

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

INSTALL = Path(__file__).parents[2] / "install.sh"


def _backend_unit() -> str:
    text = INSTALL.read_text(encoding="utf-8")
    match = re.search(
        r"logbook-backend\.service > /dev/null <<EOF\n(.*?)\nEOF\n", text, re.S
    )
    assert match, "the backend unit heredoc was not found in install.sh"
    return match.group(1)


def _section(unit: str, name: str) -> list[str]:
    lines, current = [], None
    for line in unit.splitlines():
        if line.startswith("[") and line.endswith("]"):
            current = line
        elif current == f"[{name}]" and line.strip():
            lines.append(line.strip())
    return lines


def test_an_oom_kill_of_the_decoder_does_not_stop_the_backend():
    assert "OOMPolicy=continue" in _section(_backend_unit(), "Service")
