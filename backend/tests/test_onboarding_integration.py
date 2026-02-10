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
from uuid import UUID
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
        org_data = {
            "name": "Test Fire Department",
            "type": "fire_department",
            "identifier_type": "fdid",
            "identifier_value": "12345",
            "street_address": "123 Test St",
            "city": "Test City",
            "state": "NY",
            "zip_code": "12345",
            "country": "USA",
            "phone": "555-0100",
            "email": "test@example.com",
            "timezone": "America/New_York",
        }

        org, error = await service.create_organization(**org_data)
        assert error is None, f"Organization creation failed: {error}"
        assert org is not None
        org_id = org.id

        # Create default roles (including Super Admin)
        await service._create_default_roles(org_id)

        # Verify Super Admin role exists
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
            "password": "SecurePass123!",
            "first_name": "Test",
            "last_name": "Admin",
            "badge_number": "ADMIN-001",
        }

        try:
            user, error = await service.create_admin_user(**admin_data)
        except Exception as e:
            pytest.fail(f"Admin user creation raised exception: {type(e).__name__}: {e}")

        # Verify success
        assert error is None, f"Admin user creation failed: {error}"
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

        org_data = {
            "name": "Test Fire Department 2",
            "type": "fire_department",
            "identifier_type": "fdid",
            "identifier_value": "54321",
            "street_address": "456 Test Ave",
            "city": "Test Town",
            "state": "CA",
            "zip_code": "90210",
            "country": "USA",
            "phone": "555-0200",
            "email": "test2@example.com",
            "timezone": "America/Los_Angeles",
        }

        org, error = await service.create_organization(**org_data)

        assert error is None
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
        org_data = {
            "name": "Test Fire Department 3",
            "type": "fire_department",
            "identifier_type": "state_id",
            "identifier_value": "STATE-001",
            "street_address": "789 Test Blvd",
            "city": "Test Village",
            "state": "TX",
            "zip_code": "75001",
            "country": "USA",
            "phone": "555-0300",
            "email": "test3@example.com",
            "timezone": "America/Chicago",
        }

        org, error = await service.create_organization(**org_data)
        assert error is None

        # Create default roles
        await service._create_default_roles(org.id)

        # Verify roles were created
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
        assert super_admin.name == "Super Admin"
        assert super_admin.priority == 100

    @pytest.mark.asyncio
    async def test_duplicate_admin_user_prevention(
        self,
        db_session: AsyncSession,
    ):
        """Test that duplicate admin users are prevented"""
        service = OnboardingService(db_session)

        # Create organization and roles
        org_data = {
            "name": "Test Fire Department 4",
            "type": "fire_department",
            "identifier_type": "fdid",
            "identifier_value": "99999",
            "street_address": "999 Test Dr",
            "city": "Test City",
            "state": "FL",
            "zip_code": "33101",
            "country": "USA",
            "phone": "555-0400",
            "email": "test4@example.com",
            "timezone": "America/New_York",
        }

        org, _ = await service.create_organization(**org_data)
        await service._create_default_roles(org.id)

        # Create first admin user
        admin_data = {
            "organization_id": org.id,
            "email": "admin4@test.com",
            "username": "testadmin4",
            "password": "SecurePass123!",
            "first_name": "Test",
            "last_name": "Admin",
            "badge_number": "ADMIN-004",
        }

        user1, error1 = await service.create_admin_user(**admin_data)
        assert error1 is None
        assert user1 is not None

        # Try to create duplicate with same username
        user2, error2 = await service.create_admin_user(**admin_data)
        assert error2 is not None, "Should return error for duplicate user"
        assert user2 is None

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
                session_id="test-session",
                ip_address="127.0.0.1",
                user_agent="pytest"
            )
            assert initial_status is not None
            assert not initial_status.is_completed
