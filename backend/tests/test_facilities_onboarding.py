"""
Tests for Facilities ↔ Onboarding Data Flow

Verifies that data collected during onboarding is correctly propagated to the
Facilities module — covering facility creation, location linking, address
resolution (mailing vs. physical), type/status defaults, and null-safety.

To run:
    pytest tests/test_facilities_onboarding.py -v
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.facilities import (
    Facility,
    FacilityStatus,
    FacilityType,
)
from app.models.location import Location
from app.models.user import Organization
from app.services.onboarding import OnboardingService


def _unique_slug(prefix: str = "test") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Shared org-data builders
# ---------------------------------------------------------------------------

def _org_data(
    *,
    slug: str | None = None,
    organization_type: str = "fire_department",
    physical_address_same: bool = True,
    physical_address_line1: str | None = None,
    physical_city: str | None = None,
    physical_state: str | None = None,
    physical_zip: str | None = None,
    mailing_address_line1: str = "100 Main St",
    mailing_city: str = "Springfield",
    mailing_state: str = "IL",
    mailing_zip: str = "62701",
    phone: str = "555-0100",
    email: str = "hq@dept.example",
    county: str = "Sangamon",
    fax: str | None = None,
) -> dict:
    return {
        "name": "Test Fire Dept",
        "slug": slug or _unique_slug(),
        "organization_type": organization_type,
        "identifier_type": "fdid",
        "fdid": "99999",
        "timezone": "America/Chicago",
        "mailing_address_line1": mailing_address_line1,
        "mailing_city": mailing_city,
        "mailing_state": mailing_state,
        "mailing_zip": mailing_zip,
        "mailing_country": "USA",
        "physical_address_same": physical_address_same,
        "physical_address_line1": physical_address_line1,
        "physical_city": physical_city,
        "physical_state": physical_state,
        "physical_zip": physical_zip,
        "phone": phone,
        "fax": fax,
        "email": email,
        "county": county,
    }


# ===================================================================
# 1. Headquarters facility is created with correct mailing address
# ===================================================================
class TestHeadquartersFacilityCreation:
    """Verify that create_organization auto-creates a Facility + Location."""

    async def test_facility_created_with_mailing_address(
        self, db_session: AsyncSession
    ):
        """When physical_address_same=True the facility should carry the
        mailing address fields verbatim."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one_or_none()

        assert facility is not None, "Headquarters facility must be created"
        assert facility.name == org.name
        assert facility.facility_number == "Station 1"
        assert facility.address_line1 == "100 Main St"
        assert facility.city == "Springfield"
        assert facility.state == "IL"
        assert facility.zip_code == "62701"
        assert facility.county == "Sangamon"
        assert facility.phone == "555-0100"
        assert facility.email == "hq@dept.example"
        assert facility.is_owned is True
        assert facility.is_archived is False

    async def test_location_created_and_linked(self, db_session: AsyncSession):
        """A Location record must be created and linked to the facility."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()

        location = (
            await db_session.execute(
                select(Location).where(Location.facility_id == facility.id)
            )
        ).scalar_one_or_none()

        assert location is not None, "Location linked to facility must exist"
        assert location.organization_id == org.id
        assert location.name == org.name
        assert location.address == "100 Main St"
        assert location.city == "Springfield"
        assert location.state == "IL"
        assert location.zip == "62701"
        assert location.is_active is True
        assert location.display_code is not None
        assert len(location.display_code) >= 8

    async def test_facility_has_valid_type_and_status(
        self, db_session: AsyncSession
    ):
        """Facility must be assigned an active type and status."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()

        assert facility.facility_type_id is not None
        assert facility.status_id is not None

        fac_type = (
            await db_session.execute(
                select(FacilityType).where(
                    FacilityType.id == facility.facility_type_id
                )
            )
        ).scalar_one()
        assert fac_type.is_active is True
        assert fac_type.name == "Fire Station"

        fac_status = (
            await db_session.execute(
                select(FacilityStatus).where(
                    FacilityStatus.id == facility.status_id
                )
            )
        ).scalar_one()
        assert fac_status.is_active is True
        assert fac_status.name == "Operational"

    async def test_status_changed_at_set(self, db_session: AsyncSession):
        """status_changed_at must be set when facility is created."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()

        assert facility.status_changed_at is not None


# ===================================================================
# 2. Physical vs. mailing address handling
# ===================================================================
class TestPhysicalAddressHandling:

    async def test_physical_address_used_when_different(
        self, db_session: AsyncSession
    ):
        """When physical_address_same=False and physical fields are provided,
        the facility should use the physical address."""
        data = _org_data(
            physical_address_same=False,
            physical_address_line1="200 Elm Ave",
            physical_city="Shelbyville",
            physical_state="IN",
            physical_zip="46176",
        )
        service = OnboardingService(db_session)
        org = await service.create_organization(**data)

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()

        assert facility.address_line1 == "200 Elm Ave"
        assert facility.city == "Shelbyville"
        assert facility.state == "IN"
        assert facility.zip_code == "46176"

    async def test_fallback_to_mailing_when_physical_fields_null(
        self, db_session: AsyncSession
    ):
        """If physical_address_same=False but physical fields are None
        (e.g. direct API call bypassing frontend validation), the service
        must fall back to the mailing address instead of storing nulls."""
        data = _org_data(
            physical_address_same=False,
            # physical fields intentionally left None
        )
        service = OnboardingService(db_session)
        org = await service.create_organization(**data)

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()

        # Should have fallen back to mailing
        assert facility.address_line1 == "100 Main St"
        assert facility.city == "Springfield"
        assert facility.state == "IL"
        assert facility.zip_code == "62701"

    async def test_location_uses_same_address_as_facility(
        self, db_session: AsyncSession
    ):
        """The Location record address must match the resolved facility
        address (whether physical or mailing fallback)."""
        data = _org_data(
            physical_address_same=False,
            physical_address_line1="300 Oak Dr",
            physical_city="Capital City",
            physical_state="OH",
            physical_zip="43215",
        )
        service = OnboardingService(db_session)
        org = await service.create_organization(**data)

        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        location = (
            await db_session.execute(
                select(Location).where(Location.facility_id == facility.id)
            )
        ).scalar_one()

        assert location.address == facility.address_line1
        assert location.city == facility.city
        assert location.state == facility.state
        assert location.zip == facility.zip_code


# ===================================================================
# 3. Organization type → facility type mapping
# ===================================================================
class TestFacilityTypeMapping:

    async def test_fire_department_gets_fire_station_type(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(organization_type="fire_department")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        ftype = (
            await db_session.execute(
                select(FacilityType).where(
                    FacilityType.id == facility.facility_type_id
                )
            )
        ).scalar_one()
        assert ftype.name == "Fire Station"

    async def test_ems_only_gets_ems_station_type(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(organization_type="ems_only")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        ftype = (
            await db_session.execute(
                select(FacilityType).where(
                    FacilityType.id == facility.facility_type_id
                )
            )
        ).scalar_one()
        assert ftype.name == "EMS Station"

    async def test_combined_gets_fire_station_type(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(organization_type="fire_ems_combined")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        ftype = (
            await db_session.execute(
                select(FacilityType).where(
                    FacilityType.id == facility.facility_type_id
                )
            )
        ).scalar_one()
        assert ftype.name == "Fire Station"


# ===================================================================
# 4. Contact info propagation
# ===================================================================
class TestContactInfoPropagation:

    async def test_phone_and_email_carried_over(
        self, db_session: AsyncSession
    ):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(phone="555-1234", email="ops@dept.example")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        assert facility.phone == "555-1234"
        assert facility.email == "ops@dept.example"

    async def test_fax_carried_over(self, db_session: AsyncSession):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(fax="555-9999")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        assert facility.fax == "555-9999"

    async def test_optional_contact_fields_can_be_none(
        self, db_session: AsyncSession
    ):
        data = _org_data(phone=None, email=None, fax=None)
        service = OnboardingService(db_session)
        org = await service.create_organization(**data)
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        assert facility.phone is None
        assert facility.email is None
        assert facility.fax is None


# ===================================================================
# 5. Facility module can start up / data is usable
# ===================================================================
class TestFacilityModuleUsability:
    """Simulate that the facilities module can load and work with
    the auto-created headquarters data."""

    async def test_facility_queryable_by_org(self, db_session: AsyncSession):
        """Facilities module list endpoint filters by org — verify it works."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        result = await db_session.execute(
            select(Facility).where(
                Facility.organization_id == org.id,
                Facility.is_archived.is_(False),
            )
        )
        facilities = result.scalars().all()
        assert len(facilities) == 1
        assert facilities[0].name == org.name

    async def test_location_queryable_for_events(
        self, db_session: AsyncSession
    ):
        """Events module location picker queries active locations by org."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        result = await db_session.execute(
            select(Location).where(
                Location.organization_id == org.id,
                Location.is_active.is_(True),
            )
        )
        locations = result.scalars().all()
        assert len(locations) == 1
        assert locations[0].facility_id is not None

    async def test_facility_type_and_status_accessible(
        self, db_session: AsyncSession
    ):
        """The facilities page loads types and statuses — verify they exist
        for the organization or as system defaults."""
        service = OnboardingService(db_session)
        org = await service.create_organization(**_org_data())

        from sqlalchemy import or_

        types = (
            await db_session.execute(
                select(FacilityType).where(
                    or_(
                        FacilityType.organization_id == org.id,
                        FacilityType.organization_id.is_(None),
                    ),
                    FacilityType.is_active.is_(True),
                )
            )
        ).scalars().all()

        statuses = (
            await db_session.execute(
                select(FacilityStatus).where(
                    or_(
                        FacilityStatus.organization_id == org.id,
                        FacilityStatus.organization_id.is_(None),
                    ),
                    FacilityStatus.is_active.is_(True),
                )
            )
        ).scalars().all()

        assert len(types) > 0, "At least one facility type must be available"
        assert len(statuses) > 0, "At least one facility status must be available"

    async def test_display_code_unique_and_present(
        self, db_session: AsyncSession
    ):
        """Each location must have a unique display_code for the kiosk URL."""
        service = OnboardingService(db_session)

        org1 = await service.create_organization(**_org_data(slug=_unique_slug("a")))
        org2 = await service.create_organization(**_org_data(slug=_unique_slug("b")))

        loc1 = (
            await db_session.execute(
                select(Location).where(Location.organization_id == org1.id)
            )
        ).scalar_one()
        loc2 = (
            await db_session.execute(
                select(Location).where(Location.organization_id == org2.id)
            )
        ).scalar_one()

        assert loc1.display_code is not None
        assert loc2.display_code is not None
        assert loc1.display_code != loc2.display_code


# ===================================================================
# 6. County propagation
# ===================================================================
class TestCountyPropagation:

    async def test_county_set_on_facility(self, db_session: AsyncSession):
        service = OnboardingService(db_session)
        org = await service.create_organization(
            **_org_data(county="Cook")
        )
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        assert facility.county == "Cook"

    async def test_county_none_when_not_provided(
        self, db_session: AsyncSession
    ):
        data = _org_data(county=None)
        service = OnboardingService(db_session)
        org = await service.create_organization(**data)
        facility = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org.id)
            )
        ).scalar_one()
        assert facility.county is None


# ===================================================================
# 7. Multiple org isolation
# ===================================================================
class TestOrgIsolation:

    async def test_facilities_isolated_between_orgs(
        self, db_session: AsyncSession
    ):
        """Facilities from one org must not appear in another org's queries."""
        service = OnboardingService(db_session)
        org1 = await service.create_organization(
            **_org_data(slug=_unique_slug("iso1"))
        )
        org2 = await service.create_organization(
            **_org_data(slug=_unique_slug("iso2"))
        )

        fac1 = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org1.id)
            )
        ).scalars().all()
        fac2 = (
            await db_session.execute(
                select(Facility).where(Facility.organization_id == org2.id)
            )
        ).scalars().all()

        assert len(fac1) == 1
        assert len(fac2) == 1
        assert fac1[0].id != fac2[0].id
