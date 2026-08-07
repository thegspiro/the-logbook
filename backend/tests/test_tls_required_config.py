"""
Tests for SECURITY_REQUIRE_TLS (CI-9).

Absent transport TLS in production means PHI, sessions and cached queries cross
the network in cleartext. That was reported at boot as a WARNING, which never
blocks anything — so a HIPAA deployment could run that way indefinitely.

SECURITY_REQUIRE_TLS promotes those two checks to CRITICAL, and main.py refuses
to start in production/staging when any CRITICAL is present. It is opt-in and
defaults to False so that upgrading cannot refuse to boot an existing
deployment that terminates TLS elsewhere (a private VPC, a service mesh).

The distinct "TLS on but unverified peer" case is CRITICAL regardless — that
one looks secure and is not — and is asserted here so the two don't get
conflated.
"""

import pytest

from app.core.config import Settings


def _prod(**overrides) -> Settings:
    """Production settings with every unrelated CRITICAL satisfied."""
    base = dict(
        ENVIRONMENT="production",
        DEBUG=False,
        SECRET_KEY="k" * 64,
        ENCRYPTION_KEY="a" * 64,
        ENCRYPTION_SALT="b" * 32,
        DB_PASSWORD="db-password",
        REDIS_PASSWORD="redis-password",
        RATE_LIMIT_ENABLED=True,
        ENABLE_DOCS=False,
        SECURITY_ENFORCE_HTTPS=True,
        DB_SSL=True,
        DB_SSL_CA="/etc/ssl/db-ca.pem",
        REDIS_SSL=True,
        REDIS_SSL_CA="/etc/ssl/redis-ca.pem",
    )
    base.update(overrides)
    return Settings(**base)


def _criticals(settings: Settings) -> list[str]:
    """CRITICALs about transport TLS only.

    Scoped deliberately: validate_security_config also reports unrelated
    production requirements, and a test that asserted on the whole list would
    fail the next time an unrelated check is added.
    """
    return [
        w
        for w in settings.validate_security_config()
        if "CRITICAL" in w and ("DB_SSL" in w or "REDIS_SSL" in w)
    ]


class TestTlsNotConfigured:
    @pytest.mark.parametrize("disabled", ["DB_SSL", "REDIS_SSL"])
    def test_warns_but_does_not_block_by_default(self, disabled):
        """Default behavior is unchanged — a warning, not a boot blocker."""
        settings = _prod(**{disabled: False})
        joined = " ".join(settings.validate_security_config())
        assert disabled in joined
        assert not _criticals(settings)

    @pytest.mark.parametrize("disabled", ["DB_SSL", "REDIS_SSL"])
    def test_blocks_when_require_tls_is_set(self, disabled):
        settings = _prod(SECURITY_REQUIRE_TLS=True, **{disabled: False})
        criticals = _criticals(settings)
        assert any(disabled in c for c in criticals), criticals

    def test_fully_configured_tls_is_clean_under_require_tls(self):
        assert not _criticals(_prod(SECURITY_REQUIRE_TLS=True))

    def test_flag_is_off_by_default(self):
        assert _prod().SECURITY_REQUIRE_TLS is False


class TestTlsEnabledButUnverified:
    """Independent of SECURITY_REQUIRE_TLS — this case always blocks."""

    def test_db_ssl_without_ca_is_critical_even_without_require_tls(self):
        criticals = _criticals(_prod(DB_SSL_CA=""))
        assert any("DB_SSL_CA" in c for c in criticals), criticals

    def test_redis_ssl_without_ca_is_critical_even_without_require_tls(self):
        criticals = _criticals(_prod(REDIS_SSL_CA=""))
        assert any("REDIS_SSL_CA" in c for c in criticals), criticals

    def test_waivable_via_allow_unverified_tls(self):
        settings = _prod(
            DB_SSL_CA="", REDIS_SSL_CA="", SECURITY_ALLOW_UNVERIFIED_TLS=True
        )
        assert not _criticals(settings)
