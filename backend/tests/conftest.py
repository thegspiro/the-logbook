"""
Test Configuration and Fixtures

This module provides pytest fixtures and configuration for all tests.
It sets up test database, async sessions, and common test data.
"""

import pytest
import asyncio
from typing import AsyncGenerator, Generator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy import text

from app.core.database import Base
from app.core.config import settings


# Test database URL (use in-memory SQLite for fast tests or separate MySQL test DB)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# For more realistic tests with MySQL:
# TEST_DATABASE_URL = f"mysql+aiomysql://{settings.DB_USER}:{settings.DB_PASSWORD}@{settings.DB_HOST}:3306/test_{settings.DB_NAME}"


@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """
    Create an event loop for the test session.
    This allows us to use async fixtures and tests.
    """
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def test_engine():
    """
    Create a test database engine.
    Uses SQLite in-memory for fast tests.
    """
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=NullPool,
    )

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    # Drop all tables after tests
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.fixture(scope="function")
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """
    Create a new database session for each test.
    This ensures test isolation - each test gets a clean database state.
    """
    async_session_maker = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_maker() as session:
        # Start a transaction
        await session.begin()

        yield session

        # Rollback the transaction to clean up
        await session.rollback()


@pytest.fixture(scope="function")
async def clean_db(db_session: AsyncSession):
    """
    Ensure the database is completely clean before each test.
    This fixture can be used when you need guaranteed empty tables.
    """
    # Delete all data from all tables (in correct order to respect foreign keys)
    tables = [
        "audit_logs",
        "user_roles",
        "permissions",
        "roles",
        "users",
        "organization_settings",
        "organizations",
        "onboarding_status",
    ]

    for table in tables:
        try:
            await db_session.execute(text(f"DELETE FROM {table}"))
        except Exception:
            # Table might not exist in SQLite test DB
            pass

    await db_session.commit()
    return db_session


@pytest.fixture
def sample_org_data():
    """
    Sample organization data for testing.
    """
    return {
        "name": "Test Fire Department",
        "type": "fire_department",
        "address": "123 Test St",
        "city": "Test City",
        "state": "NY",
        "zip_code": "12345",
        "country": "USA",
        "phone": "555-0100",
        "email": "test@example.com",
        "website": "https://test.example.com",
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
        "badge_number": "ADMIN-001",
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
                "type": "operations",
                "description": "Fire suppression and emergency response",
            },
            {
                "name": "Training",
                "type": "training",
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
                "address": "100 Main St",
                "city": "Test City",
                "state": "NY",
                "zip_code": "12345",
                "station_number": "1",
            }
        ]
    }
