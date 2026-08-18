"""Preflight must answer "will this start?" without starting anything.

The failure mode it exists to remove: the first time a configuration is
validated is when the container boots with it, so a bad value is discovered
by losing the service rather than before touching it.
"""

import pytest

from app.preflight import main as preflight_main

_PROD_ENV = {
    "ENVIRONMENT": "production",
    "DEBUG": "false",
    "ENABLE_DOCS": "false",
    "SECRET_KEY": "k" * 64,
    "ENCRYPTION_KEY": "a" * 64,
    "ENCRYPTION_SALT": "b" * 32,
    "DB_PASSWORD": "pw",
    "REDIS_PASSWORD": "pw",
    "RATE_LIMIT_ENABLED": "true",
    "ALLOWED_ORIGINS": "https://example.org",
}


@pytest.fixture
def prod_env(monkeypatch):
    for key, value in _PROD_ENV.items():
        monkeypatch.setenv(key, value)
    for key in (
        "DB_SSL",
        "REDIS_SSL",
        "SECURITY_REQUIRE_TLS",
        "SECURITY_ENFORCE_HTTPS",
        "SECURITY_BLOCK_INSECURE_DEFAULTS",
        "COOKIE_SECURE",
    ):
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


class TestExitStatus:
    def test_blocking_configuration_exits_nonzero(self, prod_env, capsys):
        # The outage configuration: TLS gate on by default, HTTPS unattested.
        assert preflight_main([]) == 1
        assert "will NOT start" in capsys.readouterr().out

    def test_fixed_configuration_exits_zero(self, prod_env, capsys):
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        assert preflight_main([]) == 0
        assert "this configuration starts" in capsys.readouterr().out

    def test_malformed_value_is_reported_not_raised(self, prod_env, capsys):
        # An empty string for a bool otherwise surfaces as a pydantic
        # traceback during startup, which reads as a crash rather than as a
        # configuration mistake.
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "not-a-bool")
        assert preflight_main([]) == 2
        assert "CONFIGURATION ERROR" in capsys.readouterr().out


class TestOutputNamesTheCause:
    def test_it_reports_which_values_never_arrived(self, prod_env, capsys):
        preflight_main([])
        out = capsys.readouterr().out
        assert "SECURITY_REQUIRE_TLS" in out
        assert "NOT PRESENT" in out

    def test_development_run_admits_it_checked_nothing(self, prod_env, capsys):
        # Every blocking check is gated on production/staging, so a clean dev
        # run is silence, not evidence. Saying only "starts" here is how the
        # surprise gets deferred to the next deploy instead of prevented.
        prod_env.setenv("ENVIRONMENT", "development")
        assert preflight_main([]) == 0
        out = capsys.readouterr().out
        assert "no blocking checks run" in out
        assert "--as production" in out


class TestAsEnvironment:
    def test_as_production_catches_what_a_dev_run_cannot(self, prod_env, capsys):
        """The point of the flag: test a production config before deploying it."""
        prod_env.setenv("ENVIRONMENT", "development")
        assert preflight_main(["--as", "production"]) == 1
        out = capsys.readouterr().out
        assert "forced via --as" in out
        assert "SECURITY_REQUIRE_TLS" in out
        assert "will NOT start" in out

    def test_as_production_passes_once_the_values_are_set(self, prod_env):
        prod_env.setenv("ENVIRONMENT", "development")
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        assert preflight_main(["--as", "production"]) == 0


class TestUnknownAsEnvironmentIsRejected:
    """A typo must not certify an unchecked production configuration.

    Blocking checks run only for production/staging, so `--as produciton`
    would run none of them and still print "starts" with exit 0.
    """

    @pytest.mark.parametrize("bad", ["produciton", "Production", "prod", ""])
    def test_unrecognised_target_is_an_error_not_a_pass(self, prod_env, bad: str):
        with pytest.raises(SystemExit) as excinfo:
            preflight_main(["--as", bad])
        assert excinfo.value.code != 0


class TestTlsCertificatePaths:
    """A CA path produces no critical, so without an explicit check preflight
    exits 0 for a configuration whose startup dies opening the file.
    """

    def test_unreadable_ca_blocks_and_is_named(self, prod_env, capsys, tmp_path):
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        prod_env.setenv("DB_SSL", "true")
        prod_env.setenv("DB_SSL_CA", str(tmp_path / "absent-ca.pem"))
        assert preflight_main([]) == 1
        out = capsys.readouterr().out
        assert "DB_SSL_CA" in out
        assert "FileNotFoundError" in out
        # The actionable half: the path resolves inside the container.
        assert "INSIDE the container" in out

    def test_readable_ca_is_accepted(self, prod_env, tmp_path):
        ca = tmp_path / "ca.pem"
        ca.write_text("-----BEGIN CERTIFICATE-----\n")
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        prod_env.setenv("DB_SSL", "true")
        prod_env.setenv("DB_SSL_CA", str(ca))
        assert preflight_main([]) == 0

    def test_tls_disabled_does_not_check_paths(self, prod_env):
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        prod_env.setenv("DB_SSL", "false")
        prod_env.setenv("DB_SSL_CA", "/nonexistent/ca.pem")
        assert preflight_main([]) == 0


class TestComposeCheck:
    def test_it_names_the_setting_that_caused_the_outage(
        self, prod_env, capsys, tmp_path
    ):
        compose = tmp_path / "compose.yaml"
        compose.write_text(
            "services:\n"
            "  backend:\n"
            "    environment:\n"
            "      ENVIRONMENT: ${ENVIRONMENT}\n"
            "      SECURITY_ENFORCE_HTTPS: ${SECURITY_ENFORCE_HTTPS}\n"
        )
        prod_env.setenv("SECURITY_ENFORCE_HTTPS", "true")
        prod_env.setenv("SECURITY_REQUIRE_TLS", "false")
        preflight_main(["--compose", str(compose)])
        out = capsys.readouterr().out
        assert "COMPOSE PASSTHROUGH CHECK" in out
        assert "SECURITY_REQUIRE_TLS" in out

    def test_unreadable_compose_path_is_reported_not_raised(self, prod_env, capsys):
        assert preflight_main(["--compose", "/nonexistent/compose.yaml"]) == 2
        out = capsys.readouterr().out
        assert "COMPOSE FILE UNREADABLE" in out
        # A host path is the likely mistake; name the mount.
        assert "bind-mount" in out
