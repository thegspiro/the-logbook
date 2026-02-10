"""
Integration Tests for Onboarding Flow

This module tests the critical onboarding process, especially the admin user
creation with async role assignment that was causing the MissingGreenlet error.

To run these tests:
    pytest tests/test_onboarding_integration.py -v -s

Test Coverage:
- Admin user creation with async role assignment (MissingGreenlet fix)
- Organization creation
- Default role creation
- Onboarding status tracking
"""

import pytest
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.onboarding import OnboardingService
from app.models.user import Organization, User, Role
from app.models.onboarding import OnboardingStatus


class TestOnboardingIntegration:
    """Integration tests for the onboarding flow"""

    @pytest.mark.asyncio
    async def test_admin_user_creation_with_role_assignment(
        self,
        db_session: AsyncSession,
    ):
        """
        CRITICAL TEST: Validates the fix for SQLAlchemy MissingGreenlet error.

        This test ensures that admin user creation with role assignment works
        correctly using async-compatible methods (await db.refresh(user, ['roles'])).
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

        # Verify Super Admin role exists (created automatically by create_organization)
        result = await db_session.execute(
            select(Role).where(
                Role.organization_id == org_id,
                Role.slug == "super_admin"
            )
        )
        super_admin_role = result.scalar_one_or_none()
        assert super_admin_role is not None, "Super Admin role should be created"

        # Create admin user - THIS IS THE CRITICAL TEST
        # This should NOT raise MissingGreenlet error
        admin_data = {
            "organization_id": org_id,
            "email": "admin@test.com",
            "username": "testadmin",
            "password": "SecureP@ssw0rd!",
            "first_name": "Test",
            "last_name": "Admin",
            "badge_number": "ADMIN-001",
        }

        try:
            user = await service.create_admin_user(**admin_data)
        except Exception as e:
            pytest.fail(f"Admin user creation raised exception: {type(e).__name__}: {e}")

        # Verify success
        assert user is not None
        assert user.email == admin_data["email"]
        assert user.username == admin_data["username"]

        # CRITICAL: Verify the user has the Super Admin role
        # This tests that await db.refresh(user, ['roles']) worked correctly
        await db_session.refresh(user, ['roles'])
        assert len(user.roles) > 0, "User should have at least one role assigned"

        role_slugs = [role.slug for role in user.roles]
        assert "super_admin" in role_slugs, "User should have Super Admin role"

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
    async def test_default_roles_creation(
        self,
        db_session: AsyncSession,
    ):
        """Test that default roles are created correctly"""
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

        # Verify roles were created (automatically by create_organization)
        result = await db_session.execute(
            select(Role).where(Role.organization_id == org.id)
        )
        roles = result.scalars().all()

        assert len(roles) > 0, "Default roles should be created"

        # Verify Super Admin role exists (critical for admin user creation)
        role_slugs = [r.slug for r in roles]
        assert "super_admin" in role_slugs, "Super Admin role must exist"

        # Find Super Admin role and verify its properties
        super_admin = next(r for r in roles if r.slug == "super_admin")
        assert super_admin.name == "Super Administrator"
        assert super_admin.priority == 100

    @pytest.mark.asyncio
    async def test_duplicate_admin_user_prevention(
        self,
        db_session: AsyncSession,
    ):
        """Test that duplicate admin users are prevented"""
        service = OnboardingService(db_session)

        # Create organization and roles
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

        # Create first admin user (roles already created by create_organization)
        admin_data = {
            "organization_id": org.id,
            "email": "admin4@test.com",
            "username": "testadmin4",
            "password": "SecureP@ssw0rd!",
            "first_name": "Test",
            "last_name": "Admin",
            "badge_number": "ADMIN-004",
        }

        user1 = await service.create_admin_user(**admin_data)
        assert user1 is not None

        # Try to create duplicate with same username
        # Should raise ValueError since create_admin_user raises exceptions on error
        with pytest.raises(ValueError):
            user2 = await service.create_admin_user(**admin_data)

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
