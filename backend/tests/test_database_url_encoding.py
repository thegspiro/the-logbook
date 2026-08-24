"""
Tests that DSN credentials survive characters that are reserved in a URL.

DATABASE_URL / SYNC_DATABASE_URL interpolate DB_USER and DB_PASSWORD into the
userinfo section of a URL. That section ends at the first unescaped ``@``, so a
password containing one truncates the DSN and the driver reads the remainder as
the hostname: ``DemoDbP@ss2026`` produced

    Can't connect to MySQL server on 'ss2026@127.0.0.1'

which names neither the password nor the quoting as the cause, and reads as an
unreachable database server. ``@`` is common in generated secrets, so this is
reachable from an ordinary deployment rather than from a hostile one.

The Alembic half is the same defect one layer up: ``set_main_option`` writes
through ConfigParser, whose interpolation reads ``%`` as the start of a
``%(name)s`` reference, so percent-encoding the password made every Alembic
command fail with "invalid interpolation syntax" until env.py doubled it.
"""

from configparser import ConfigParser
from urllib.parse import urlsplit

import pytest
from sqlalchemy.engine.url import make_url

from app.core.config import Settings

# Each character terminates or re-parses some part of the URL grammar, so each
# corrupts the DSN in its own way if it reaches the userinfo section raw.
RESERVED = ["@", ":", "/", "?", "#", "%", "@:/?#%"]


def _settings(password: str, user: str = "intranet_user") -> Settings:
    return Settings(
        _env_file=None,
        DB_USER=user,
        DB_PASSWORD=password,
        DB_HOST="127.0.0.1",
        DB_PORT=3306,
        DB_NAME="intranet_db",
    )


@pytest.mark.parametrize("password", RESERVED)
@pytest.mark.parametrize("attr", ["DATABASE_URL", "SYNC_DATABASE_URL"])
def test_reserved_characters_round_trip(password: str, attr: str):
    """The driver must read back the host and password it was given."""
    settings = _settings(f"pw{password}2026")
    url = make_url(getattr(settings, attr))

    assert url.host == "127.0.0.1"
    assert url.port == 3306
    assert url.database == "intranet_db"
    assert url.username == "intranet_user"
    assert url.password == f"pw{password}2026"


def test_reserved_characters_in_username_round_trip():
    """A username is interpolated into the same section and needs the same care."""
    url = make_url(_settings("plainpassword", user="svc@corp").DATABASE_URL)

    assert url.username == "svc@corp"
    assert url.host == "127.0.0.1"


def test_host_is_not_absorbed_into_the_password():
    """The regression itself: an unescaped '@' moved the host into the password.

    Asserted through a URL parser rather than on the DSN text. The broken DSN's
    signature, ``ss2026@127.0.0.1``, is also a substring of the correct one —
    the encoded password ends in ``ss2026`` and the real ``@host`` follows it —
    so a textual check passes on both and proves nothing.
    """
    settings = _settings("DemoDbP@ss2026")

    parts = urlsplit(settings.DATABASE_URL)
    assert parts.hostname == "127.0.0.1"
    assert parts.port == 3306
    assert make_url(settings.DATABASE_URL).password == "DemoDbP@ss2026"


def test_percent_encoded_dsn_survives_configparser():
    """
    Alembic writes the DSN through ConfigParser, which reads '%' as
    interpolation. env.py doubles it; this asserts the doubling is enough to
    get the original string back, which is what Alembic then connects with.
    """
    dsn = _settings("DemoDbP@ss2026").SYNC_DATABASE_URL
    assert "%40" in dsn, "the '@' should have been percent-encoded"

    parser = ConfigParser()
    parser.add_section("alembic")
    parser.set("alembic", "sqlalchemy.url", dsn.replace("%", "%%"))

    assert parser.get("alembic", "sqlalchemy.url") == dsn
