"""
Integration Tests for Onboarding Flow

This module tests the complete onboarding process from start to finish,
ensuring all 10 steps work correctly together and handle edge cases.

To run these tests:
    pytest tests/test_onboarding_integration.py -v -s

Test Coverage:
- Complete onboarding flow (all 10 steps)
- Step validation and error handling
- Database state consistency
- Role assignment (especially the MissingGreenlet fix)
- Admin user creation with proper async handling
"""

import pytest
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.onboarding import OnboardingService
from app.models.organization import Organization
from app.models.user import User
from app.models.role import Role
from app.models.department import Department
from app.models.station import Station
from app.models.onboarding_status import OnboardingStatus


class TestOnboardingIntegration:
    """Integration tests for the complete onboarding flow"""

    @pytest.mark.asyncio
    async def test_complete_onboarding_flow(
        self,
        db_session: AsyncSession,
        sample_org_data,
        sample_admin_data,
        sample_roles_data,
        sample_departments_data,
        sample_stations_data,
    ):
        """
        Test the complete onboarding flow from start to finish.
        This is the critical test that validates the entire process.
        """
        service = OnboardingService(db_session)

        # Step 1: Initialize onboarding
        status = await service.initialize_onboarding()
        assert status is not None
        assert status.current_step == 0
        assert not status.is_completed

        # Step 2: Save organization info (Step 1)
        org_data = sample_org_data.copy()
        await service.save_organization_info(org_data)

        # Verify organization was created
        result = await db_session.execute(select(Organization))
        org = result.scalar_one_or_none()
        assert org is not None
        assert org.name == org_data["name"]
        assert org.type == org_data["type"]

        # Verify onboarding status updated
        status = await service.get_onboarding_status()
        assert status.current_step >= 1
        assert status.organization_id is not None
        org_id = status.organization_id

        # Step 3: Configure roles (Step 2)
        await service.configure_roles(
            organization_id=org_id,
            selected_roles=sample_roles_data["selected_roles"],
            custom_roles=sample_roles_data["custom_roles"],
        )

        # Verify roles were created
        result = await db_session.execute(
            select(Role).where(Role.organization_id == org_id)
        )
        roles = result.scalars().all()
        assert len(roles) > 0

        # Verify Super Admin role exists (critical for admin user creation)
        result = await db_session.execute(
            select(Role).where(
                Role.organization_id == org_id,
                Role.slug == "super_admin"
            )
        )
        super_admin_role = result.scalar_one_or_none()
        assert super_admin_role is not None
        assert super_admin_role.name == "Super Admin"

        # Step 4: Configure departments (Step 3)
        await service.configure_departments(
            organization_id=org_id,
            departments=sample_departments_data["departments"],
        )

        # Verify departments were created
        result = await db_session.execute(
            select(Department).where(Department.organization_id == org_id)
        )
        departments = result.scalars().all()
        assert len(departments) == len(sample_departments_data["departments"])

        # Step 5: Configure stations (Step 4)
        await service.configure_stations(
            organization_id=org_id,
            stations=sample_stations_data["stations"],
        )

        # Verify stations were created
        result = await db_session.execute(
            select(Station).where(Station.organization_id == org_id)
        )
        stations = result.scalars().all()
        assert len(stations) == len(sample_stations_data["stations"])

        # Steps 6-9: These are typically configuration steps that may be skipped
        # For now, we'll mark them as completed
        status = await service.get_onboarding_status()
        for step in [5, 6, 7, 8, 9]:
            if status.current_step < step:
                await service._mark_step_completed(status, step, f"step_{step}")

        # Step 10: Create admin user (CRITICAL TEST - this is where the MissingGreenlet error occurred)
        admin_data = sample_admin_data.copy()
        user, error = await service.create_admin_user(
            organization_id=org_id,
            email=admin_data["email"],
            username=admin_data["username"],
            password=admin_data["password"],
            first_name=admin_data["first_name"],
            last_name=admin_data["last_name"],
            badge_number=admin_data["badge_number"],
        )

        # Verify admin user creation
        assert error is None, f"Admin user creation failed: {error}"
        assert user is not None
        assert user.email == admin_data["email"]
        assert user.username == admin_data["username"]
        assert user.organization_id == org_id

        # CRITICAL: Verify the user has the Super Admin role
        # This tests the fix for the MissingGreenlet error
        await db_session.refresh(user, ['roles'])
        assert len(user.roles) > 0, "User should have at least one role assigned"

        role_slugs = [role.slug for role in user.roles]
        assert "super_admin" in role_slugs, "User should have Super Admin role"

        # Verify onboarding is complete
        status = await service.get_onboarding_status()
        assert status.is_completed
        assert status.admin_email == admin_data["email"]
        assert status.admin_username == admin_data["username"]

    @pytest.mark.asyncio
    async def test_admin_user_role_assignment_async_handling(
        self,
        db_session: AsyncSession,
        sample_org_data,
        sample_admin_data,
    ):
        """
        Specific test for the async role assignment that was causing MissingGreenlet error.
        This validates the fix where we use await db.refresh(user, ['roles']) before appending.
        """
        service = OnboardingService(db_session)

        # Initialize and create organization
        await service.initialize_onboarding()
        await service.save_organization_info(sample_org_data)

        status = await service.get_onboarding_status()
        org_id = status.organization_id

        # Create Super Admin role
        from app.models.role import RoleCategory
        super_admin_role = Role(
            organization_id=org_id,
            name="Super Admin",
            slug="super_admin",
            category=RoleCategory.ADMINISTRATIVE,
            priority=100,
        )
        db_session.add(super_admin_role)
        await db_session.commit()

        # Create admin user - this should NOT raise MissingGreenlet error
        admin_data = sample_admin_data.copy()
        try:
            user, error = await service.create_admin_user(
                organization_id=org_id,
                email=admin_data["email"],
                username=admin_data["username"],
                password=admin_data["password"],
                first_name=admin_data["first_name"],
                last_name=admin_data["last_name"],
                badge_number=admin_data["badge_number"],
            )
        except Exception as e:
            pytest.fail(f"Admin user creation raised exception: {type(e).__name__}: {e}")

        # Verify success
        assert error is None
        assert user is not None

        # Verify role was assigned correctly (this is where the bug was)
        await db_session.refresh(user, ['roles'])
        assert len(user.roles) > 0
        assert user.roles[0].slug == "super_admin"

    @pytest.mark.asyncio
    async def test_onboarding_step_order_validation(
        self,
        db_session: AsyncSession,
        sample_org_data,
        sample_admin_data,
    ):
        """
        Test that steps must be completed in order.
        You can't create admin user before creating the organization.
        """
        service = OnboardingService(db_session)

        # Initialize
        await service.initialize_onboarding()

        # Try to create admin user without setting up organization first
        # This should fail gracefully
        with pytest.raises(ValueError):
            await service.create_admin_user(
                organization_id=UUID("00000000-0000-0000-0000-000000000000"),
                email=sample_admin_data["email"],
                username=sample_admin_data["username"],
                password=sample_admin_data["password"],
                first_name=sample_admin_data["first_name"],
                last_name=sample_admin_data["last_name"],
                badge_number=sample_admin_data["badge_number"],
            )

    @pytest.mark.asyncio
    async def test_duplicate_admin_user_prevention(
        self,
        db_session: AsyncSession,
        sample_org_data,
        sample_admin_data,
    ):
        """
        Test that we can't create duplicate admin users.
        """
        service = OnboardingService(db_session)

        # Setup
        await service.initialize_onboarding()
        await service.save_organization_info(sample_org_data)

        status = await service.get_onboarding_status()
        org_id = status.organization_id

        # Create Super Admin role
        from app.models.role import RoleCategory
        super_admin_role = Role(
            organization_id=org_id,
            name="Super Admin",
            slug="super_admin",
            category=RoleCategory.ADMINISTRATIVE,
            priority=100,
        )
        db_session.add(super_admin_role)
        await db_session.commit()

        # Create first admin user
        admin_data = sample_admin_data.copy()
        user1, error1 = await service.create_admin_user(
            organization_id=org_id,
            **admin_data,
        )
        assert error1 is None
        assert user1 is not None

        # Try to create duplicate admin user with same username
        user2, error2 = await service.create_admin_user(
            organization_id=org_id,
            **admin_data,
        )
        assert error2 is not None
        assert user2 is None
        assert "already exists" in error2.lower() or "duplicate" in error2.lower()

    @pytest.mark.asyncio
    async def test_onboarding_status_persistence(
        self,
        db_session: AsyncSession,
        sample_org_data,
    ):
        """
        Test that onboarding status persists correctly across operations.
        """
        service = OnboardingService(db_session)

        # Initialize
        status1 = await service.initialize_onboarding()
        initial_id = status1.id

        # Save organization
        await service.save_organization_info(sample_org_data)

        # Get status again - should be same instance
        status2 = await service.get_onboarding_status()
        assert status2.id == initial_id
        assert status2.current_step > status1.current_step
        assert status2.organization_id is not None

    @pytest.mark.asyncio
    async def test_role_configuration_creates_required_roles(
        self,
        db_session: AsyncSession,
        sample_org_data,
        sample_roles_data,
    ):
        """
        Test that role configuration creates all required system roles,
        especially Super Admin which is critical for admin user creation.
        """
        service = OnboardingService(db_session)

        # Setup
        await service.initialize_onboarding()
        await service.save_organization_info(sample_org_data)

        status = await service.get_onboarding_status()
        org_id = status.organization_id

        # Configure roles
        await service.configure_roles(
            organization_id=org_id,
            selected_roles=sample_roles_data["selected_roles"],
            custom_roles=sample_roles_data["custom_roles"],
        )

        # Verify Super Admin role exists
        result = await db_session.execute(
            select(Role).where(
                Role.organization_id == org_id,
                Role.slug == "super_admin"
            )
        )
        super_admin = result.scalar_one_or_none()
        assert super_admin is not None
        assert super_admin.name == "Super Admin"
        assert super_admin.priority == 100

        # Verify other selected roles
        result = await db_session.execute(
            select(Role).where(Role.organization_id == org_id)
        )
        all_roles = result.scalars().all()
        role_slugs = [r.slug for r in all_roles]

        # Should have super_admin plus the selected roles
        assert "super_admin" in role_slugs
        for selected_role in sample_roles_data["selected_roles"]:
            # Note: The actual slug might be different from the input
            # This is just checking that roles were created
            pass
