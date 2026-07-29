"""
Test Configuration and Fixtures

This module provides pytest fixtures and configuration for all tests.
It sets up test database, async sessions, and common test data.
"""

from collections.abc import AsyncGenerator

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import configure_mappers

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


@pytest.fixture(scope="session")
async def _initialize_database():
    """
    Initialize database connection for all tests.
    This runs once per test session.
    """
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
