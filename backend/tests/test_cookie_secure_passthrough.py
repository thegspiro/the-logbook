"""COOKIE_SECURE must survive being passed through Docker Compose.

COOKIE_SECURE is the only tri-state setting: None means auto-detect the
Secure flag, False forces it off for a LAN deployment on plain HTTP, True
forces it on. There is no env-var spelling for None, and Compose cannot
conditionally omit a key from a mapping-form `environment:` block — so
passing the variable through injects "" whenever the operator left it alone.
Pydantic rejects "" for `bool | None`, which would abort startup for every
deployment that never touched the setting.
"""

import pytest

from app.core.config import Settings

_BASE = dict(
    SECRET_KEY="k" * 64,
    ENCRYPTION_KEY="a" * 64,
    ENCRYPTION_SALT="b" * 32,
    DB_PASSWORD="pw",
    REDIS_PASSWORD="pw",
)


class TestCookieSecureTriState:
    @pytest.mark.parametrize("blank", ["", "   ", "\t"])
    def test_blank_means_auto_detect_not_a_startup_crash(self, blank: str):
        assert Settings(COOKIE_SECURE=blank, **_BASE).COOKIE_SECURE is None

    def test_omitted_still_means_auto_detect(self):
        assert Settings(**_BASE).COOKIE_SECURE is None

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [("false", False), ("true", True), (False, False), (True, True)],
    )
    def test_explicit_values_are_preserved(self, raw, expected: bool):
        # The LAN-over-HTTP case (False) must stay distinguishable from unset,
        # or auto-detect would force Secure cookies and break those logins.
        assert Settings(COOKIE_SECURE=raw, **_BASE).COOKIE_SECURE is expected
