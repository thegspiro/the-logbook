"""
Every backend setting reaches the container, and an unset one changes nothing.

The backend service's ``environment:`` block in each compose file is a
whitelist: there is no ``env_file`` (one would hand the backend
MYSQL_ROOT_PASSWORD and every other secret in .env), .env is excluded from the
image, and the production override drops the source bind-mount, so pydantic's
own ``env_file=".env"`` finds nothing inside the container. A ``Settings``
field missing from the block therefore keeps its built-in default whatever the
operator wrote in .env, silently. That was measured at 33 of 170 fields for
``docker-compose.yml``.

Two guarantees are held here, per compose file that runs the backend:

1. Every ``Settings`` field not on ``NOT_PASSED_THROUGH`` is listed.
2. Interpolating the file with nothing set yields, field for field, the same
   ``Settings`` the bare application builds with nothing set — apart from the
   values the file deliberately sets for its own deployment
   (``DEPLOYMENT_VALUES``). This is what makes passing a setting through safe:
   an operator who does not configure it gets exactly what they got before.
   Compose cannot omit a key, so this is also what proves an empty string
   parses back to an optional setting's None, a list setting's [] and so on.

No database and no Docker daemon are needed.
"""

import re
from pathlib import Path

import pytest
import yaml

from app.core.config import Settings

pytestmark = pytest.mark.unit

ROOT_DIR = Path(__file__).resolve().parents[2]

# Compose files that define a complete backend service, which builds Settings
# from its environment. No compose file defines a Celery or other worker
# service; if one is added it belongs here too.
BACKEND_COMPOSE_FILES = [
    "docker-compose.yml",
    "unraid/docker-compose-unraid.yml",
    "unraid/docker-compose-build-from-source.yml",
]

# Override files, layered on docker-compose.yml with -f. Their backend
# entries are partial by design; the base file carries the passthrough.
OVERRIDE_COMPOSE_FILES = [
    "docker-compose.prod.yml",
    "docker-compose.minimal.yml",
    "docker-compose.arm.yml",
    "docker-compose.proxy.yml",
    "docker-compose.external-services.yml",
]

# Settings fields deliberately not passed through. Keep this short: a
# security-relevant knob is never an exclusion.
NOT_PASSED_THROUGH = {
    "VERSION": (
        "build metadata identifying the running code; a stale .env value "
        "would misreport the version in /health and the API docs"
    ),
    "LDAP_ENABLED": "LDAP is not implemented; nothing reads this setting",
    "LDAP_SERVER": "LDAP is not implemented; nothing reads this setting",
    "LDAP_BIND_DN": "LDAP is not implemented; nothing reads this setting",
    "LDAP_BIND_PASSWORD": (
        "LDAP is not implemented; passing it would carry a secret into the "
        "container for no effect"
    ),
    "LDAP_SEARCH_BASE": "LDAP is not implemented; nothing reads this setting",
}

# Secrets the files require (`${NAME:?...}`) or ship placeholders for. Given
# dummy values for interpolation; they differ from the app's empty defaults
# by necessity, not by choice.
DUMMY_SECRETS = {
    "SECRET_KEY": "dummy-secret-key-" + "x" * 48,
    "ENCRYPTION_KEY": "a" * 64,
    "ENCRYPTION_SALT": "b" * 32,
    "DB_PASSWORD": "dummy-db-password",
    "REDIS_PASSWORD": "dummy-redis-password",
    "MYSQL_ROOT_PASSWORD": "dummy-root-password",
}

# Values a file sets on purpose for the deployment it describes, which are
# not the application's defaults. Everything else must round-trip.
DEPLOYMENT_VALUES = {
    "docker-compose.yml": {
        "DB_HOST": "the bundled mysql service",
        "REDIS_HOST": "the bundled redis service",
    },
    "unraid/docker-compose-unraid.yml": {
        "DB_HOST": "the bundled db service",
        "REDIS_HOST": "the bundled redis service",
        "DB_NAME": "Unraid install's database name",
        "DB_USER": "Unraid install's database user",
        "ENVIRONMENT": "the Unraid stack runs in production posture",
        "ENABLE_DOCS": "production posture: API docs off",
        "COOKIE_SECURE": "production posture: Secure cookies",
        "SECURITY_REQUIRE_TLS": "bundled plaintext db/redis, accepted risk",
        "ALLOWED_ORIGINS": "example LAN origins for the Unraid web UI port",
        "ACCESS_TOKEN_EXPIRE_MINUTES": "existing Unraid session length",
        "UPLOAD_DIR": "absolute container path of the uploads mount",
        "SMTP_HOST": "existing placeholder; inert while EMAIL_ENABLED=false",
    },
    "unraid/docker-compose-build-from-source.yml": {
        "DB_HOST": "the bundled db service",
        "REDIS_HOST": "the bundled redis service",
        "DB_NAME": "Unraid install's database name",
        "DB_USER": "Unraid install's database user",
        "ENVIRONMENT": "the Unraid stack runs in production posture",
        "ENABLE_DOCS": "production posture: API docs off",
        "COOKIE_SECURE": "production posture: Secure cookies",
        "ALLOWED_ORIGINS": "must be set in .env; no default in this file",
        "SMTP_HOST": "existing empty value; inert while EMAIL_ENABLED=false",
        "SMTP_FROM_EMAIL": "existing empty value; inert while EMAIL_ENABLED=false",
    },
}

_VAR = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])([^}]*))?\}")


def _interpolate(value: str, env: dict[str, str]) -> str:
    """Compose's variable substitution, for the forms these files use."""

    def sub(match: re.Match) -> str:
        name, op, arg = match.group(1), match.group(2), match.group(3) or ""
        is_set = name in env
        is_nonempty = bool(env.get(name))
        if op == ":-":
            return env[name] if is_nonempty else arg
        if op == "-":
            return env[name] if is_set else arg
        if op in (":?", "?"):
            if (is_nonempty if op == ":?" else is_set) is False:
                raise AssertionError(f"compose requires {name}: {arg}")
            return env[name]
        if op == ":+":
            return arg if is_nonempty else ""
        if op == "+":
            return arg if is_set else ""
        return env.get(name, "")

    placeholder = "\0"
    return _VAR.sub(sub, value.replace("$$", placeholder)).replace(placeholder, "$")


def _backend_env(rel: str) -> dict:
    compose = yaml.safe_load((ROOT_DIR / rel).read_text(encoding="utf-8"))
    env = compose["services"]["backend"]["environment"]
    assert isinstance(env, dict), f"{rel}: backend environment must be a mapping"
    return env


def _settings_from(env: dict[str, str], monkeypatch) -> Settings:
    """Build Settings from exactly *env*, the way the container does."""
    for name in Settings.model_fields:
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return Settings(_env_file=None)


def _env_from_compose(rel: str) -> dict[str, str]:
    """The backend's settings as Compose hands them over with .env empty."""
    raw = _backend_env(rel)
    return {
        name: _interpolate(str(value), DUMMY_SECRETS)
        for name, value in raw.items()
        if name in Settings.model_fields
    }


def test_every_compose_file_is_classified():
    found = {
        str(p.relative_to(ROOT_DIR))
        for pattern in ("docker-compose*.yml", "unraid/docker-compose*.yml")
        for p in ROOT_DIR.glob(pattern)
    }
    assert found == set(BACKEND_COMPOSE_FILES) | set(OVERRIDE_COMPOSE_FILES)


def test_exclusions_name_real_settings():
    assert set(NOT_PASSED_THROUGH) <= set(Settings.model_fields)


@pytest.mark.parametrize("rel", BACKEND_COMPOSE_FILES)
def test_every_setting_is_passed_through(rel: str):
    env = _backend_env(rel)
    missing = [
        name
        for name in Settings.model_fields
        if name not in env and name not in NOT_PASSED_THROUGH
    ]
    assert not missing, (
        f"{rel}: these settings cannot be set from .env, because the backend "
        f"environment block is a whitelist: {missing}. Add each as "
        "`NAME: ${NAME:-<application default>}`."
    )


@pytest.mark.parametrize("rel", BACKEND_COMPOSE_FILES)
def test_deployment_values_are_present(rel: str):
    env = _backend_env(rel)
    assert set(DEPLOYMENT_VALUES[rel]) <= set(env)


@pytest.mark.parametrize("rel", BACKEND_COMPOSE_FILES)
def test_unconfigured_stack_round_trips_to_app_defaults(rel: str, monkeypatch):
    compose_env = _env_from_compose(rel)
    kept = set(DEPLOYMENT_VALUES[rel]) | set(DUMMY_SECRETS)
    actual = _settings_from(compose_env, monkeypatch)
    expected = _settings_from(
        {k: v for k, v in compose_env.items() if k in kept}, monkeypatch
    )
    differing = {
        name: (getattr(actual, name), getattr(expected, name))
        for name in Settings.model_fields
        if getattr(actual, name) != getattr(expected, name)
        or type(getattr(actual, name)) is not type(getattr(expected, name))
    }
    assert not differing, (
        f"{rel}: with nothing set in .env these settings differ from the "
        f"application default (compose value, default): {differing}"
    )


@pytest.mark.parametrize(
    ("name", "default"),
    [
        (name, field.default)
        for name, field in Settings.model_fields.items()
        if field.default is None
    ],
)
def test_empty_optional_setting_reads_as_unset(name: str, default, monkeypatch):
    """Compose cannot omit a key, so "" is what an unset optional arrives as."""
    assert getattr(_settings_from({name: ""}, monkeypatch), name) is default


def test_explicit_values_still_reach_settings(monkeypatch):
    """The empty-means-unset handling must not swallow real values."""
    settings = _settings_from(
        {
            "SMTP_USER": "relay@example.org",
            "TRUSTED_HOSTS": "a.example.org,b.example.org",
            "BLOCKED_COUNTRIES": "",
            "COOKIE_SECURE": "false",
        },
        monkeypatch,
    )
    assert settings.SMTP_USER == "relay@example.org"
    assert settings.TRUSTED_HOSTS == ["a.example.org", "b.example.org"]
    assert settings.get_blocked_countries_set() == set()
    assert settings.COOKIE_SECURE is False


@pytest.mark.parametrize("rel", BACKEND_COMPOSE_FILES)
def test_blocked_countries_can_be_emptied(rel: str):
    """``${X:-d}`` replaces an empty value; an empty blocklist must survive."""
    raw = str(_backend_env(rel)["BLOCKED_COUNTRIES"])
    assert _interpolate(raw, {"BLOCKED_COUNTRIES": ""}) == ""


@pytest.mark.parametrize("template", [".env.example", ".env.example.full"])
def test_env_templates_have_no_comment_on_an_empty_assignment(template: str):
    """Compose reads ``NAME=   # text`` as the value "# text", not as empty.

    python-dotenv (what the bare app reads) strips it, so the line looks
    harmless until the value is passed through to the container.
    """
    text = (ROOT_DIR / template).read_text(encoding="utf-8")
    offenders = re.findall(r"^[A-Z][A-Z0-9_]*=[ \t]*#.*$", text, re.MULTILINE)
    assert not offenders, offenders


def test_full_env_example_documents_every_passed_through_setting():
    text = (ROOT_DIR / ".env.example.full").read_text(encoding="utf-8")
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]*)=", text, re.MULTILINE))
    passed = set().union(*(_backend_env(rel) for rel in BACKEND_COMPOSE_FILES))
    undocumented = sorted(
        name for name in passed & set(Settings.model_fields) if name not in documented
    )
    assert not undocumented, f".env.example.full does not mention: {undocumented}"
