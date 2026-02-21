"""
Integration Tests for Onboarding Flow

This module tests the critical onboarding process, especially the system owner
creation with async position assignment that was causing the MissingGreenlet error.

To run these tests:
    pytest tests/test_onboarding_integration.py -v -s

Test Coverage:
- System owner creation with async position assignment (MissingGreenlet fix)
- Organization creation
- Default position creation
- Onboarding status tracking
"""

import pytest
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.onboarding import OnboardingService
from app.models.user import Organization, User, Position
from app.models.onboarding import OnboardingStatus


class TestOnboardingIntegration:
    """Integration tests for the onboarding flow"""

    @pytest.mark.asyncio
    async def test_system_owner_creation_with_position_assignment(
        self,
        db_session: AsyncSession,
    ):
        """
        CRITICAL TEST: Validates the fix for SQLAlchemy MissingGreenlet error.

        This test ensures that system owner creation with position assignment works
        correctly using async-compatible methods (await db.refresh(user, ['positions'])).
        """
        service = OnboardingService(db_session)

        # Create organization first
        unique_id = str(uuid.uuid4())[:8]
        org_data = {
            "name": "Test Fire Department",
            "slug": f"test-fire-dept-{unique_id}",
            "organization_type": "fire_department",
            "identifier_type": "fdid",
            "fdid": "12345",
            "mailing_address_line1": "123 Test St",
            "mailing_city": "Test City",
            "mailing_state": "NY",
            "mailing_zip": "12345",
            "mailing_country": "USA",
            "phone": "555-0100",
            "email": "test@example.com",
            "timezone": "America/New_York",
        }

        org = await service.create_organization(**org_data)
        assert org is not None
        org_id = org.id

        # Verify IT Manager position exists (created automatically by create_organization)
        result = await db_session.execute(
            select(Position).where(
                Position.organization_id == org_id,
                Position.slug == "it_manager"
            )
        )
        it_manager_position = result.scalar_one_or_none()
        assert it_manager_position is not None, "IT Manager position should be created"

        # Create system owner - THIS IS THE CRITICAL TEST
        # This should NOT raise MissingGreenlet error
        owner_data = {
            "organization_id": org_id,
            "email": "admin@test.com",
            "username": "testadmin",
            "password": "SecureP@ssw0rd!",
            "first_name": "Test",
            "last_name": "Admin",
            "membership_number": "ADMIN-001",
        }

        try:
            user = await service.create_system_owner(**owner_data)
        except Exception as e:
            pytest.fail(f"System owner creation raised exception: {type(e).__name__}: {e}")

        # Verify success
        assert user is not None
        assert user.email == owner_data["email"]
        assert user.username == owner_data["username"]

        # CRITICAL: Verify the user has the IT Manager position
        # This tests that await db.refresh(user, ['positions']) worked correctly
        await db_session.refresh(user, ['positions'])
        assert len(user.positions) > 0, "User should have at least one position assigned"

        position_slugs = [pos.slug for pos in user.positions]
        assert "it_manager" in position_slugs, "User should have IT Manager position"

    @pytest.mark.asyncio
    async def test_create_organization(
        self,
        db_session: AsyncSession,
    ):
        """Test organization creation"""
        service = OnboardingService(db_session)

        unique_id = str(uuid.uuid4())[:8]
        org_data = {
            "name": "Test Fire Department 2",
            "slug": f"test-fire-dept-2-{unique_id}",
            "organization_type": "fire_department",
            "identifier_type": "fdid",
            "fdid": "54321",
            "mailing_address_line1": "456 Test Ave",
            "mailing_city": "Test Town",
            "mailing_state": "CA",
            "mailing_zip": "90210",
            "mailing_country": "USA",
            "phone": "555-0200",
            "email": "test2@example.com",
            "timezone": "America/Los_Angeles",
        }

        org = await service.create_organization(**org_data)

        assert org is not None
        assert org.name == org_data["name"]
        assert org.phone == org_data["phone"]

        # Verify organization exists in database
        result = await db_session.execute(
            select(Organization).where(Organization.id == org.id)
        )
        db_org = result.scalar_one_or_none()
        assert db_org is not None
        assert db_org.name == org_data["name"]

    @pytest.mark.asyncio
    async def test_default_positions_creation(
        self,
        db_session: AsyncSession,
    ):
        """Test that default positions are created correctly"""
        service = OnboardingService(db_session)

        # Create organization
        unique_id = str(uuid.uuid4())[:8]
        org_data = {
            "name": "Test Fire Department 3",
            "slug": f"test-fire-dept-3-{unique_id}",
            "organization_type": "fire_department",
            "identifier_type": "state_id",
            "state_id": "STATE-001",
            "mailing_address_line1": "789 Test Blvd",
            "mailing_city": "Test Village",
            "mailing_state": "TX",
            "mailing_zip": "75001",
            "mailing_country": "USA",
            "phone": "555-0300",
            "email": "test3@example.com",
            "timezone": "America/Chicago",
        }

        org = await service.create_organization(**org_data)
        assert org is not None

        # Verify positions were created (automatically by create_organization)
        result = await db_session.execute(
            select(Position).where(Position.organization_id == org.id)
        )
        positions = result.scalars().all()

        assert len(positions) > 0, "Default positions should be created"

        # Verify IT Manager position exists (critical for system owner creation)
        position_slugs = [p.slug for p in positions]
        assert "it_manager" in position_slugs, "IT Manager position must exist"

        # Find IT Manager position and verify its properties
        it_manager = next(p for p in positions if p.slug == "it_manager")
        assert it_manager.name == "IT Manager"
        assert it_manager.priority == 100

    @pytest.mark.asyncio
    async def test_duplicate_system_owner_prevention(
        self,
        db_session: AsyncSession,
    ):
        """Test that duplicate system owners are prevented"""
        service = OnboardingService(db_session)

        # Create organization and positions
        unique_id = str(uuid.uuid4())[:8]
        org_data = {
            "name": "Test Fire Department 4",
            "slug": f"test-fire-dept-4-{unique_id}",
            "organization_type": "fire_department",
            "identifier_type": "fdid",
            "fdid": "99999",
            "mailing_address_line1": "999 Test Dr",
            "mailing_city": "Test City",
            "mailing_state": "FL",
            "mailing_zip": "33101",
            "mailing_country": "USA",
            "phone": "555-0400",
            "email": "test4@example.com",
            "timezone": "America/New_York",
        }

        org = await service.create_organization(**org_data)

        # Create first system owner (positions already created by create_organization)
        owner_data = {
            "organization_id": org.id,
            "email": "admin4@test.com",
            "username": "testadmin4",
            "password": "SecureP@ssw0rd!",
            "first_name": "Test",
            "last_name": "Admin",
            "membership_number": "ADMIN-004",
        }

        user1 = await service.create_system_owner(**owner_data)
        assert user1 is not None

        # Try to create duplicate with same username
        # Should raise ValueError since create_system_owner raises exceptions on error
        with pytest.raises(ValueError):
            user2 = await service.create_system_owner(**owner_data)

    @pytest.mark.asyncio
    async def test_onboarding_status_tracking(
        self,
        db_session: AsyncSession,
    ):
        """Test that onboarding status is tracked correctly"""
        service = OnboardingService(db_session)

        # Check if onboarding is needed
        needs_onboarding = await service.needs_onboarding()
        assert isinstance(needs_onboarding, bool)

        # Get current status
        status = await service.get_onboarding_status()

        # Status might not exist in clean test DB
        if status is None:
            # Create initial status by starting onboarding
            initial_status = await service.start_onboarding(
                ip_address="127.0.0.1",
                user_agent="pytest"
            )
            assert initial_status is not None
            assert not initial_status.is_completed
