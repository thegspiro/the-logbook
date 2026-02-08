"""
Test that all enum values work correctly end-to-end.

This test verifies that:
1. Python enum definitions have correct values
2. SQLAlchemy models use values_callable correctly
3. Database accepts lowercase enum values
4. Enum values can be read back correctly
"""
import pytest
from sqlalchemy import text
from app.models.user import Organization, OrganizationType, IdentifierType, UserStatus


def test_organization_type_enum_values():
    """Test that OrganizationType enum has correct lowercase values"""
    assert OrganizationType.FIRE_DEPARTMENT.value == "fire_department"
    assert OrganizationType.EMS_ONLY.value == "ems_only"
    assert OrganizationType.FIRE_EMS_COMBINED.value == "fire_ems_combined"


def test_identifier_type_enum_values():
    """Test that IdentifierType enum has correct lowercase values"""
    assert IdentifierType.FDID.value == "fdid"
    assert IdentifierType.STATE_ID.value == "state_id"
    assert IdentifierType.DEPARTMENT_ID.value == "department_id"


def test_user_status_enum_values():
    """Test that UserStatus enum has correct lowercase values"""
    assert UserStatus.ACTIVE.value == "active"
    assert UserStatus.INACTIVE.value == "inactive"
    assert UserStatus.SUSPENDED.value == "suspended"
    assert UserStatus.PROBATIONARY.value == "probationary"
    assert UserStatus.RETIRED.value == "retired"


@pytest.mark.asyncio
async def test_organization_type_database_insert(db_session):
    """Test that organization_type enum values can be inserted into database"""
    from app.models.user import generate_uuid

    # Test all organization types
    for org_type in OrganizationType:
        org = Organization(
            id=generate_uuid(),
            name=f"Test {org_type.value} Org",
            slug=f"test-{org_type.value}-{generate_uuid()[:8]}",
            organization_type=org_type,
            identifier_type=IdentifierType.DEPARTMENT_ID,
            timezone="America/New_York"
        )
        db_session.add(org)

    await db_session.commit()

    # Verify all were inserted
    result = await db_session.execute(
        text("SELECT organization_type, COUNT(*) FROM organizations GROUP BY organization_type")
    )
    rows = result.fetchall()

    # Should have 3 different organization types
    assert len(rows) == 3

    # Verify values are lowercase
    org_types = {row[0] for row in rows}
    assert org_types == {"fire_department", "ems_only", "fire_ems_combined"}


@pytest.mark.asyncio
async def test_organization_type_query_by_enum(db_session):
    """Test that we can query using enum members"""
    from app.models.user import generate_uuid

    # Create test organization
    org = Organization(
        id=generate_uuid(),
        name="Test Fire Department",
        slug=f"test-fire-{generate_uuid()[:8]}",
        organization_type=OrganizationType.FIRE_DEPARTMENT,
        identifier_type=IdentifierType.FDID,
        timezone="America/New_York"
    )
    db_session.add(org)
    await db_session.commit()

    # Query using enum member
    from sqlalchemy import select
    result = await db_session.execute(
        select(Organization).where(
            Organization.organization_type == OrganizationType.FIRE_DEPARTMENT
        )
    )
    found_orgs = result.scalars().all()

    assert len(found_orgs) > 0
    assert all(org.organization_type == OrganizationType.FIRE_DEPARTMENT for org in found_orgs)


@pytest.mark.asyncio
async def test_organization_type_database_enum_definition(db_session):
    """Test that the database ENUM type has correct lowercase values"""

    result = await db_session.execute(text("""
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'organizations'
        AND COLUMN_NAME = 'organization_type'
    """))

    row = result.fetchone()
    assert row is not None, "organization_type column not found"

    column_type = row[0]
    assert column_type.startswith("enum("), f"Expected ENUM type, got {column_type}"

    # Parse enum values
    values_str = column_type[5:-1]  # Remove "enum(" and ")"
    values = [v.strip("'") for v in values_str.split(",")]

    # Verify all values are lowercase
    expected_values = ["fire_department", "ems_only", "fire_ems_combined"]
    assert set(values) == set(expected_values), \
        f"ENUM values mismatch. Expected {expected_values}, got {values}"

    # Verify NO uppercase values exist
    uppercase_values = ["FIRE_DEPARTMENT", "EMS_ONLY", "FIRE_EMS_COMBINED"]
    for uppercase_val in uppercase_values:
        assert uppercase_val not in values, \
            f"Found uppercase value '{uppercase_val}' in ENUM - this should not exist!"
