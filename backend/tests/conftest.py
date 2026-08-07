"""
Test Configuration and Fixtures

This module provides pytest fixtures and configuration for all tests.
It sets up test database, async sessions, and common test data.
"""

import os
from collections.abc import AsyncGenerator

import pytest
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
