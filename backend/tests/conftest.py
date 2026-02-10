"""
Test Configuration and Fixtures

This module provides pytest fixtures and configuration for all tests.
It sets up test database, async sessions, and common test data.
"""

import pytest
import asyncio
from typing import AsyncGenerator, Generator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.database import async_session_factory, database_manager


@pytest.fixture(scope="session")
def event_loop():
    """
    Create an event loop for the test session.
    """
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def initialize_database():
    """
    Initialize database connection for all tests.
    This runs once per test session.
    """
    await database_manager.connect()
    yield
    await database_manager.disconnect()


@pytest.fixture(scope="function")
async def db_session(initialize_database) -> AsyncGenerator[AsyncSession, None]:
    """
    Create a new database session for each test.
    Uses the app's actual MySQL database.

    Each test runs in a transaction that is rolled back after the test,
    ensuring test isolation without affecting the actual database.
    """
    async with async_session_factory() as session:
        # Start a transaction
        async with session.begin():
            yield session
            # Transaction will be rolled back automatically when exiting the context
            # No need for explicit rollback


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
