"""
Database Seed Script

Seeds the database with default roles and test data.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid
from typing import Optional

from app.models.user import Organization, Role
from app.core.permissions import DEFAULT_ROLES, get_admin_role_slugs
from loguru import logger


async def seed_organization(db: AsyncSession, org_id: Optional[uuid.UUID] = None) -> Organization:
    """
    Create or get a test organization

    Args:
        db: Database session
        org_id: Optional specific organization ID to use

    Returns:
        Organization instance
    """
    # Check if organization already exists
    if org_id:
        result = await db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        existing_org = result.scalar_one_or_none()
        if existing_org:
            logger.info(f"Organization already exists: {existing_org.name}")
            return existing_org

    # Create new organization
    organization = Organization(
        id=org_id or uuid.uuid4(),
        name="Test Fire Department",
        slug="test-fire-dept",
        description="A test fire department for development",
        type="fire_department",
        settings={
            "contact_info_visibility": {
                "enabled": False,
                "show_email": True,
                "show_phone": True,
                "show_mobile": True,
            }
        },
        active=True,
    )

    db.add(organization)
    await db.commit()
    await db.refresh(organization)

    logger.info(f"Created organization: {organization.name} ({organization.id})")
    return organization


async def seed_roles(db: AsyncSession, organization_id: uuid.UUID):
    """
    Seed default roles for an organization

    Args:
        db: Database session
        organization_id: Organization to create roles for
    """
    logger.info(f"Seeding roles for organization {organization_id}")

    for role_slug, role_data in DEFAULT_ROLES.items():
        # Check if role already exists
        result = await db.execute(
            select(Role).where(
                Role.organization_id == organization_id,
                Role.slug == role_slug
            )
        )
        existing_role = result.scalar_one_or_none()

        if existing_role:
            logger.info(f"Role already exists: {role_data['name']}")
            # Update permissions in case they changed
            existing_role.permissions = role_data['permissions']
            existing_role.priority = role_data['priority']
            await db.commit()
            continue

        # Create new role
        role = Role(
            id=uuid.uuid4(),
            organization_id=organization_id,
            name=role_data['name'],
            slug=role_data['slug'],
            description=role_data['description'],
            permissions=role_data['permissions'],
            is_system=role_data['is_system'],
            priority=role_data['priority'],
        )

        db.add(role)
        logger.info(f"Created role: {role.name}")

    await db.commit()
    logger.info("Roles seeded successfully")


async def seed_database(db: AsyncSession):
    """
    Main seed function - seeds organization and roles

    Args:
        db: Database session
    """
    logger.info("Starting database seeding...")

    # Use a fixed UUID for testing
    test_org_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

    # Seed organization
    organization = await seed_organization(db, test_org_id)

    # Seed roles
    await seed_roles(db, organization.id)

    logger.info("Database seeding completed!")


# Command-line script
if __name__ == "__main__":
    import asyncio
    from app.core.database import database_manager

    async def run_seed():
        """Run the seed script"""
        await database_manager.connect()
        async for session in database_manager.get_session():
            try:
                await seed_database(session)
                break
            except Exception as e:
                logger.error(f"Seeding failed: {e}")
                raise
        await database_manager.disconnect()

    asyncio.run(run_seed())
