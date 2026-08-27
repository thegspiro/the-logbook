"""
Boot-time checks added by the 2026-08-27 core-infrastructure security review
(CI2-33). Each of these previously had a gap where a misconfiguration would
either boot silently and break something at runtime with no signal (ALGORITHM,
CAPTCHA), or boot silently with a control weaker than intended (a dedicated
audit-log signing key, a sane TRUSTED_PROXY_IPS range).
"""

from app.core.config import Settings


def _prod(**overrides) -> Settings:
    """Production settings with every unrelated CRITICAL/WARNING satisfied."""
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
        VOTE_SIGNING_KEY="v" * 32,
        AUDIT_LOG_SIGNING_KEY="s" * 32,
    )
    base.update(overrides)
    return Settings(**base)


class TestAlgorithmMustBeHS256:
    def test_the_pinned_value_reports_no_algorithm_warning(self):
        warnings = _prod(ALGORITHM="HS256").validate_security_config()
        assert not any("ALGORITHM" in w for w in warnings)

    def test_a_null_signature_spelling_is_still_caught(self):
        warnings = _prod(ALGORITHM="none").validate_security_config()
        assert any("CRITICAL" in w and "ALGORITHM" in w for w in warnings)

    def test_an_unsupported_but_not_blocklisted_algorithm_is_now_caught(self):
        # This is the gap: decode_token()'s allowlist is hardcoded to
        # ["HS256"], so anything else boots silently and then rejects every
        # token at verification — total auth outage with no boot signal.
        warnings = _prod(ALGORITHM="HS384").validate_security_config()
        assert any("CRITICAL" in w and "ALGORITHM" in w for w in warnings)


class TestAuditLogSigningKeyIsWarnedLikeItsSibling:
    def test_unset_reports_a_warning(self):
        warnings = _prod(AUDIT_LOG_SIGNING_KEY="").validate_security_config()
        assert any("WARNING" in w and "AUDIT_LOG_SIGNING_KEY" in w for w in warnings)

    def test_set_reports_no_warning(self):
        warnings = _prod(AUDIT_LOG_SIGNING_KEY="k" * 32).validate_security_config()
        assert not any("AUDIT_LOG_SIGNING_KEY" in w for w in warnings)


class TestCaptchaSecretKeyPairing:
    def test_enabled_with_no_secret_reports_a_warning(self):
        warnings = _prod(
            CAPTCHA_ENABLED=True, CAPTCHA_SECRET_KEY=""
        ).validate_security_config()
        assert any("CAPTCHA" in w for w in warnings)

    def test_enabled_with_a_secret_but_no_site_key_reports_a_warning(self):
        # A secret with no site key still leaves is_captcha_configured()
        # True, but the browser can never obtain a token to submit — every
        # gated public form fails closed (Codex, PR #1917).
        warnings = _prod(
            CAPTCHA_ENABLED=True, CAPTCHA_SECRET_KEY="s" * 20, CAPTCHA_SITE_KEY=""
        ).validate_security_config()
        assert any("CAPTCHA_SITE_KEY" in w for w in warnings)

    def test_enabled_with_secret_and_site_key_reports_no_warning(self):
        warnings = _prod(
            CAPTCHA_ENABLED=True,
            CAPTCHA_SECRET_KEY="s" * 20,
            CAPTCHA_SITE_KEY="k" * 20,
            CAPTCHA_PROVIDER="turnstile",
        ).validate_security_config()
        assert not any("CAPTCHA" in w for w in warnings)

    def test_enabled_with_unsupported_provider_reports_a_warning(self):
        # app/core/captcha.py's is_captcha_configured() silently treats an
        # unrecognized provider as "not configured" and skips the challenge
        # on every request (Codex, PR #1917).
        warnings = _prod(
            CAPTCHA_ENABLED=True,
            CAPTCHA_SECRET_KEY="s" * 20,
            CAPTCHA_SITE_KEY="k" * 20,
            CAPTCHA_PROVIDER="not-a-real-provider",
        ).validate_security_config()
        assert any("CAPTCHA_PROVIDER" in w for w in warnings)

    def test_disabled_with_no_secret_reports_no_warning(self):
        # The pairing only matters once CAPTCHA is actually turned on.
        warnings = _prod(
            CAPTCHA_ENABLED=False, CAPTCHA_SECRET_KEY=""
        ).validate_security_config()
        assert not any("CAPTCHA" in w for w in warnings)


class TestTrustedProxyRangeSanity:
    def test_an_overly_broad_range_reports_a_warning(self):
        warnings = _prod(TRUSTED_PROXY_IPS="0.0.0.0/0").validate_security_config()
        assert any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_a_typical_container_network_range_reports_no_warning(self):
        # 10.0.0.0/8 is exactly the boundary — a common, legitimate Docker/K8s
        # private network and must not be flagged.
        warnings = _prod(TRUSTED_PROXY_IPS="10.0.0.0/8").validate_security_config()
        assert not any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_an_exact_ip_reports_no_warning(self):
        warnings = _prod(TRUSTED_PROXY_IPS="203.0.113.5").validate_security_config()
        assert not any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_no_configured_range_reports_no_warning(self):
        warnings = _prod(TRUSTED_PROXY_IPS="").validate_security_config()
        assert not any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_an_ipv6_slash_8_reports_a_warning(self):
        # A single IPv4-scaled /8 threshold is far too permissive for IPv6:
        # /8 there still leaves 120 free host bits (Codex, PR #1917).
        warnings = _prod(TRUSTED_PROXY_IPS="2001:db8::/8").validate_security_config()
        assert any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_an_ipv6_slash_48_reports_a_warning(self):
        warnings = _prod(TRUSTED_PROXY_IPS="2001:db8::/48").validate_security_config()
        assert any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_a_typical_ipv6_subnet_range_reports_no_warning(self):
        # /64 is exactly the boundary — a single site subnet, and typical for
        # a reverse proxy's own /64 allocation.
        warnings = _prod(TRUSTED_PROXY_IPS="2001:db8::/64").validate_security_config()
        assert not any("TRUSTED_PROXY_IPS" in w for w in warnings)

    def test_an_exact_ipv6_address_reports_no_warning(self):
        warnings = _prod(TRUSTED_PROXY_IPS="2001:db8::1").validate_security_config()
        assert not any("TRUSTED_PROXY_IPS" in w for w in warnings)
