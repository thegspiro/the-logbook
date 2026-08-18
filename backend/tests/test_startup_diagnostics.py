"""A dropped setting must be named, not silently absorbed into a default.

Once pydantic applies defaults, "the operator set this to the default" and
"this never reached the process" are the same value. That ambiguity turned a
two-minute configuration fix into a nine-hour outage: the boot log reported
the effective value, the operator edited a .env the container never read, and
nothing anywhere said the value was not arriving.
"""

import pathlib

import pytest

from app.core.config import Settings
from app.core.startup_diagnostics import (
    boot_blocking_setting_names,
    env_presence_report,
    missing_from_compose,
    settings_named_in,
    would_block_startup,
)

_PROD = dict(
    ENVIRONMENT="production",
    DEBUG=False,
    ENABLE_DOCS=False,
    SECRET_KEY="k" * 64,
    ENCRYPTION_KEY="a" * 64,
    ENCRYPTION_SALT="b" * 32,
    DB_PASSWORD="pw",
    REDIS_PASSWORD="pw",
    RATE_LIMIT_ENABLED=True,
    SECURITY_ENFORCE_HTTPS=True,
)


class TestSettingsNamedIn:
    def test_finds_the_setting_a_message_is_about(self):
        msg = "CRITICAL: SECURITY_REQUIRE_TLS blah"
        assert "SECURITY_REQUIRE_TLS" in settings_named_in(msg, Settings(**_PROD))

    def test_word_boundaries_keep_prefixes_from_swallowing_suffixes(self):
        # DB_SSL is a prefix of DB_SSL_CA; a substring match would report the
        # CA setting as implicated in every bare DB_SSL message.
        named = settings_named_in("CRITICAL: DB_SSL is off", Settings(**_PROD))
        assert "DB_SSL" in named
        assert "DB_SSL_CA" not in named

    def test_unknown_capitalised_words_are_not_reported_as_settings(self):
        assert (
            settings_named_in("CRITICAL: HTTPS and TLS and MITM", Settings(**_PROD))
            == []
        )


class TestEnvPresenceReport:
    def test_absent_setting_is_called_out_as_not_present(self, monkeypatch):
        monkeypatch.delenv("SECURITY_REQUIRE_TLS", raising=False)
        lines = env_presence_report(
            ["CRITICAL: SECURITY_REQUIRE_TLS is the reason"], Settings(**_PROD)
        )
        joined = "\n".join(lines)
        assert "NOT PRESENT" in joined
        # The actionable half: say where the value is being lost.
        assert "whitelist" in joined
        assert "not reaching the container" in joined.lower()

    def test_present_setting_is_distinguished_from_a_default(self, monkeypatch):
        monkeypatch.setenv("SECURITY_REQUIRE_TLS", "false")
        joined = "\n".join(
            env_presence_report(
                ["CRITICAL: SECURITY_REQUIRE_TLS is the reason"], Settings(**_PROD)
            )
        )
        assert "set in environment" in joined
        assert "NOT PRESENT" not in joined

    def test_secret_values_are_never_written_to_the_log(self, monkeypatch):
        # These lines go to stdout and log files; presence is useful, the
        # value is a credential leak.
        monkeypatch.setenv("SECRET_KEY", "super-secret-value")
        joined = "\n".join(
            env_presence_report(["CRITICAL: SECRET_KEY is weak"], Settings(**_PROD))
        )
        assert "super-secret-value" not in joined
        assert "value hidden" in joined
        assert "SECRET_KEY" in joined

    def test_no_criticals_produces_no_noise(self):
        assert env_presence_report([], Settings(**_PROD)) == []


class TestWouldBlockStartup:
    @pytest.mark.parametrize("env", ["production", "staging"])
    def test_criticals_block_production_and_staging(self, env: str):
        settings = Settings(**{**_PROD, "ENVIRONMENT": env})
        assert would_block_startup(["CRITICAL: x"], settings) is True

    def test_development_does_not_block_by_default(self):
        settings = Settings(**{**_PROD, "ENVIRONMENT": "development"})
        assert would_block_startup(["CRITICAL: x"], settings) is False

    def test_development_blocks_when_the_flag_opts_in(self):
        settings = Settings(
            **{
                **_PROD,
                "ENVIRONMENT": "development",
                "SECURITY_BLOCK_INSECURE_DEFAULTS": True,
            }
        )
        assert would_block_startup(["CRITICAL: x"], settings) is True

    def test_no_criticals_never_blocks(self):
        assert would_block_startup([], Settings(**_PROD)) is False

    def test_predicate_still_matches_the_real_startup_gate(self):
        """Canary: preflight must not drift from main.validate_security_configuration.

        A preflight that reports "starts" for a configuration the real gate
        refuses is worse than no preflight — it certifies the outage.
        """
        main_py = (pathlib.Path(__file__).resolve().parents[1] / "main.py").read_text()
        gate = main_py[main_py.index("def validate_security_configuration") :]
        gate = gate[: gate.index("\n@asynccontextmanager")]
        assert '("production", "staging")' in gate
        assert "SECURITY_BLOCK_INSECURE_DEFAULTS" in gate


class TestDotenvIsNotReportedAsMissing:
    """Settings declares env_file=".env", which pydantic reads WITHOUT
    exporting into os.environ. Treating absent-from-environ as defaulted would
    tell an operator their .env is being ignored at the moment it is being
    honoured — the precise false claim this report exists to prevent.
    """

    def test_value_from_dotenv_is_not_called_missing(self, monkeypatch):
        monkeypatch.delenv("DB_SSL_CA", raising=False)
        # Simulates pydantic having loaded the value from a .env file: the
        # setting differs from its default while absent from os.environ.
        settings = Settings(**{**_PROD, "DB_SSL_CA": "/etc/ssl/logbook/ca.pem"})
        joined = "\n".join(
            env_presence_report(["CRITICAL: DB_SSL_CA is set"], settings)
        )
        assert "NOT PRESENT" not in joined
        assert ".env file read by the application" in joined
        # And no advice claiming the value fails to arrive.
        assert "not reaching the container" not in joined.lower()

    def test_a_genuinely_absent_setting_is_still_reported(self, monkeypatch):
        monkeypatch.delenv("SECURITY_REQUIRE_TLS", raising=False)
        joined = "\n".join(
            env_presence_report(["CRITICAL: SECURITY_REQUIRE_TLS"], Settings(**_PROD))
        )
        assert "NOT PRESENT" in joined


class TestBootBlockingSettingNames:
    def test_it_finds_the_settings_that_can_block_a_boot(self):
        names = boot_blocking_setting_names(Settings(**_PROD))
        for expected in ("SECURITY_REQUIRE_TLS", "DB_SSL", "SECURITY_ENFORCE_HTTPS"):
            assert expected in names

    def test_names_are_real_settings_not_stray_words(self):
        names = boot_blocking_setting_names(Settings(**_PROD))
        fields = set(Settings.model_fields)
        assert set(names) <= fields


class TestMissingFromCompose:
    def test_it_names_what_a_compose_file_cannot_pass_through(self):
        compose = """
services:
  backend:
    environment:
      ENVIRONMENT: ${ENVIRONMENT}
      SECURITY_ENFORCE_HTTPS: ${SECURITY_ENFORCE_HTTPS}
"""
        missing = missing_from_compose(
            compose, ["ENVIRONMENT", "SECURITY_ENFORCE_HTTPS", "SECURITY_REQUIRE_TLS"]
        )
        # Exactly the gap that caused the 2026-08-18 outage.
        assert missing == ["SECURITY_REQUIRE_TLS"]

    def test_a_name_only_in_a_comment_does_not_count_as_present(self):
        compose = """
services:
  backend:
    # SECURITY_REQUIRE_TLS could go here one day
    environment:
      ENVIRONMENT: ${ENVIRONMENT}
"""
        assert "SECURITY_REQUIRE_TLS" in missing_from_compose(
            compose, ["SECURITY_REQUIRE_TLS"]
        )

    def test_nothing_missing_returns_empty(self):
        compose = "environment:\n  DB_SSL: ${DB_SSL:-false}\n"
        assert missing_from_compose(compose, ["DB_SSL"]) == []
