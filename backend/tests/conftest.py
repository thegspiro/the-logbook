"""
Test Configuration and Fixtures

This module provides pytest fixtures and configuration for all tests.
It sets up test database, async sessions, and common test data.
"""

import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import configure_mappers

# PyJWT >= 2.13 rejects empty HMAC signing keys. Outside production the
# app's Settings allow an unset SECRET_KEY (startup validation enforces it
# in production), so give the test process a deterministic key BEFORE any
# app import loads Settings. setdefault keeps a real environment-provided
# key (e.g. in CI) authoritative.
os.environ.setdefault("SECRET_KEY", "test-secret-key-" + "x" * 48)

# Point the suite at its own database BEFORE Settings is constructed.
#
# Without this, DB_NAME resolves from .env — the developer's working database.
# The per-test transaction is rolled back, so tests do not write to it, but they
# still *read* it, and several assert on a clean slate: `create_organization`
# refuses to create a second organization, so twenty facilities-onboarding tests
# fail the moment the developer has an organization on their machine. The
# failures look like product bugs and are nothing of the kind.
#
# setdefault, so CI (or anyone) can still name the database explicitly by
# exporting DB_NAME; only the implicit .env value is overridden.
os.environ.setdefault("DB_NAME", "intranet_test")

# Eagerly register EVERY model and resolve all mappers at import time, before any
# test module is collected. String-based relationships (e.g.
# Organization.relationship("PublicPortalConfig")) can only resolve once every
# referenced class is in the shared declarative registry. Some test modules stub
# a model submodule in sys.modules to skip heavy imports; if such a module is
# collected first, the real class never registers and the first mapper
# configuration in a *later* module fails with "failed to locate a name". Doing
# it here — like the app does at startup — makes mapper resolution independent of
# test collection order.
import app.models  # noqa: E402,F401
from app.core.database import database_manager
from tests.patch_leak_guard import find_leaks
from tests.patch_leak_guard import install as _install_patch_leak_guard

configure_mappers()


def _ensure_test_database() -> None:
    """Create the test database and its schema if they are not there yet.

    The application builds its own schema at startup, so a developer's working
    database is always ready; the dedicated test database has nothing to do
    that for it. Creating it here keeps `pytest` a single command on a fresh
    checkout instead of a documented setup ritual.

    Both steps are idempotent — an existing database and existing tables are
    left exactly as they are.

    Only model-defined tables are created. main.py additionally replays the
    migration-only files and the seed-data files; if a test ever needs one of
    those lookup tables (apparatus types, facility types, …) this is where that
    would be added.

    `create_all(checkfirst=True)` adds missing *tables*, never missing columns,
    so a test database built before a schema change keeps the old shape and the
    suite then fails in ways that look nothing like schema drift — after merging
    a branch that alters models, drop it and let this rebuild:

        mysql -e 'DROP DATABASE intranet_test'
    """
    from sqlalchemy import create_engine, text

    from app.core.config import settings
    from app.core.database import Base

    server_url = settings.SYNC_DATABASE_URL.rsplit("/", 1)[0] + "/"
    server = create_engine(server_url, isolation_level="AUTOCOMMIT")
    with server.connect() as conn:
        conn.execute(
            text(
                f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
    server.dispose()

    engine = create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        # Models carry circular foreign keys, so constraint checking has to be
        # off while the tables are created — the same thing main.py does.
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        Base.metadata.create_all(conn, checkfirst=True)
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
    engine.dispose()


_install_patch_leak_guard()


@pytest.fixture(autouse=True)
def _fail_the_test_that_leaks_a_patch():
    """Make a leaked patch fail its own test instead of a later, innocent one.

    ``unittest.mock.patch`` records whatever it finds as "the original", so two
    patches of one target that are open at the same time restore each other's
    mock and the target keeps it for the rest of the session. Combined with
    ``pytest-randomly``, the victim is whichever test happens to be scheduled
    next, which is how one such leak masqueraded as a flaky suite for a day.

    See tests/patch_leak_guard.py for the full mechanism.
    """
    yield
    leaks = find_leaks()
    if leaks:
        pytest.fail(
            "This test left a mock installed on "
            + ", ".join(leaks)
            + ". A patch of a module- or class-level target escaped — most often "
            "because two coroutines entered the same patch() concurrently (e.g. "
            "under asyncio.gather), so they restored each other's mock instead "
            "of the real value. Patch per-instance with patch.object, or set up "
            "the patch once outside the concurrent section. The original value "
            "has been restored so the rest of the run stays meaningful.",
            pytrace=False,
        )


@pytest.fixture(scope="session")
async def _initialize_database():
    """
    Initialize database connection for all tests.
    This runs once per test session.
    """
    _ensure_test_database()
    await database_manager.connect()
    yield
    await database_manager.disconnect()


@pytest.fixture
async def db_session(_initialize_database) -> AsyncGenerator[AsyncSession]:
    """
    Create a new database session for each test, isolated by an outer
    connection-level transaction that is ALWAYS rolled back at teardown.

    join_transaction_mode="create_savepoint" is what makes service-level
    ``commit()`` calls safe: because the session joins the connection's
    already-begun transaction, each ``commit()`` releases a SAVEPOINT and
    opens a new one instead of committing for real. The outer rollback then
    discards everything the test wrote. (The previous implementation used
    ``session.begin()`` on a pooled connection, so every service commit —
    and even a clean fixture exit — committed permanently, leaking state
    like unique organizations across tests.)
    """
    async with database_manager.engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        try:
            yield session
        finally:
            await session.close()
            if outer.is_active:
                await outer.rollback()


@pytest.fixture
async def setup_org_and_admin(db_session: AsyncSession):
    """Insert a minimal organization plus one active admin, returning their ids.

    Raw INSERTs rather than the ORM: this only needs the two rows that
    foreign keys point at, and going through the models would drag in
    password hashing and the onboarding defaults that the tests using this
    are not exercising.

    Shared here rather than redefined per module — it started in
    test_membership_pipeline_flow.py, and a second file that wanted it got
    "fixture not found" instead of the rows.
    """
    org_id = str(uuid.uuid4())
    admin_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "fn": "Admin",
            "ln": "User",
            "em": f"admin-{org_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, admin_id


@pytest.fixture
def sample_org_data():
    """
    Sample organization data for testing.
    Matches the OrganizationCreate schema used by onboarding.
    """
    return {
        "name": "Test Fire Department",
        "organization_type": "fire_department",
        "slug": "test-fire-dept",
        "timezone": "America/New_York",
    }


@pytest.fixture
def sample_admin_data():
    """
    Sample admin user data for testing.
    """
    return {
        "email": "admin@test.com",
        "username": "testadmin",
        "password": "SecurePass123!",
        "first_name": "Test",
        "last_name": "Admin",
        "membership_number": "ADMIN-001",
    }


@pytest.fixture
def sample_roles_data():
    """
    Sample roles configuration for testing.
    """
    return {
        "selected_roles": ["admin", "chief", "captain", "member"],
        "custom_roles": [],
    }


@pytest.fixture
def sample_departments_data():
    """
    Sample departments configuration for testing.
    """
    return {
        "departments": [
            {
                "name": "Operations",
                "description": "Fire suppression and emergency response",
            },
            {
                "name": "Training",
                "description": "Member training and certification",
            },
        ]
    }


@pytest.fixture
def sample_stations_data():
    """
    Sample stations configuration for testing.
    """
    return {
        "stations": [
            {
                "name": "Station 1",
                "station_number": "1",
            }
        ]
    }
