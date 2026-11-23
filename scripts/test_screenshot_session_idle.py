"""capture.mjs signs a context in again before the backend's idle logoff ends it.

The backend ends a session after HIPAA_SESSION_TIMEOUT_MINUTES of inactivity.
capture.mjs kept each signed-in context for the whole run, and the officer
accounts are used by a few shots each across a run of two hours or more, so by
their next shot the session had lapsed and fifteen shots failed on /login. It
now rebuilds a context idle for longer than SESSION_IDLE_LIMIT_MS. That limit
only works while it stays under the backend's timeout, and the two live in
different files, so this test reads both.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAPTURE = ROOT / "scripts" / "screenshots" / "capture.mjs"
CONFIG = ROOT / "backend" / "app" / "core" / "config.py"


def _idle_limit_minutes() -> float:
    match = re.search(
        r"const SESSION_IDLE_LIMIT_MS = (\d+) \* 60 \* 1000;",
        CAPTURE.read_text(encoding="utf-8"),
    )
    assert match, "SESSION_IDLE_LIMIT_MS is not defined in capture.mjs"
    return float(match.group(1))


def _backend_timeout_minutes() -> int:
    match = re.search(
        r"HIPAA_SESSION_TIMEOUT_MINUTES: int = \(\s*(\d+)",
        CONFIG.read_text(encoding="utf-8"),
    )
    assert match, "HIPAA_SESSION_TIMEOUT_MINUTES is not defined in config.py"
    return int(match.group(1))


def test_contexts_are_signed_in_again_before_the_idle_logoff() -> None:
    assert _idle_limit_minutes() < _backend_timeout_minutes()


def test_a_cached_context_is_reused_only_while_fresh() -> None:
    source = CAPTURE.read_text(encoding="utf-8")
    assert "Date.now() - cached.lastUsed < SESSION_IDLE_LIMIT_MS" in source
