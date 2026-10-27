"""A business, foundation or government donor may be recorded by organization
name alone (W69-6).

First and last name were required on every donor, so a business went in under
its contact ("Dale Harmon (Valley Hardware)") and one with no named contact
could not be added at all. Owner decision: every non-individual type may give
only its organization name; an individual still needs both names. The rule is
checked on create and on update, since an update can change the type or clear
a name.
"""

import uuid

import pytest

from app.models.user import Organization
from app.services.fundraising_service import FundraisingService

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def org_id(db_session):
    org = Organization(name="Donor FD", slug=f"donor-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    return str(org.id)


@pytest.mark.parametrize(
    "donor_type", ["business", "foundation", "government", "other"]
)
async def test_an_organization_needs_only_its_name(db_session, org_id, donor_type):
    donor = await FundraisingService(db_session).create_donor(
        org_id, {"donor_type": donor_type, "company_name": "Valley Hardware"}
    )

    assert donor.first_name is None
    assert donor.last_name is None
    assert donor.company_name == "Valley Hardware"


async def test_an_organization_may_still_be_recorded_by_its_contact(db_session, org_id):
    donor = await FundraisingService(db_session).create_donor(
        org_id, {"donor_type": "business", "first_name": "Dale", "last_name": "Harmon"}
    )

    assert donor.last_name == "Harmon"


@pytest.mark.parametrize(
    "data",
    [
        {"donor_type": "individual", "company_name": "Valley Hardware"},
        {"donor_type": "individual", "first_name": "Dale"},
        {"company_name": "Valley Hardware"},  # type defaults to individual
    ],
)
async def test_an_individual_needs_both_names(db_session, org_id, data):
    with pytest.raises(ValueError, match="first and last name"):
        await FundraisingService(db_session).create_donor(org_id, data)


async def test_an_organization_with_no_name_at_all_is_refused(db_session, org_id):
    with pytest.raises(ValueError, match="organization's name"):
        await FundraisingService(db_session).create_donor(
            org_id, {"donor_type": "foundation", "first_name": "Dale"}
        )


async def test_switching_an_organization_to_individual_needs_names(db_session, org_id):
    service = FundraisingService(db_session)
    donor = await service.create_donor(
        org_id, {"donor_type": "business", "company_name": "Valley Hardware"}
    )

    with pytest.raises(ValueError, match="first and last name"):
        await service.update_donor(donor.id, org_id, {"donor_type": "individual"})


async def test_an_organization_is_listed_by_its_name_among_the_surnames(
    db_session, org_id
):
    service = FundraisingService(db_session)
    await service.create_donor(org_id, {"first_name": "Ann", "last_name": "Zeller"})
    await service.create_donor(
        org_id, {"donor_type": "business", "company_name": "Main Street Bakery"}
    )
    await service.create_donor(org_id, {"first_name": "Bo", "last_name": "Adams"})

    donors = await service.list_donors(org_id)

    assert [d.last_name or d.company_name for d in donors] == [
        "Adams",
        "Main Street Bakery",
        "Zeller",
    ]


async def test_clearing_an_individuals_name_is_refused(db_session, org_id):
    service = FundraisingService(db_session)
    donor = await service.create_donor(
        org_id, {"first_name": "Ann", "last_name": "Zeller"}
    )

    with pytest.raises(ValueError, match="first and last name"):
        await service.update_donor(donor.id, org_id, {"last_name": None})


async def test_clearing_an_organizations_contact_is_accepted(db_session, org_id):
    service = FundraisingService(db_session)
    donor = await service.create_donor(
        org_id,
        {
            "donor_type": "business",
            "company_name": "Valley Hardware",
            "first_name": "Dale",
            "last_name": "Harmon",
        },
    )

    updated = await service.update_donor(
        donor.id, org_id, {"first_name": None, "last_name": None}
    )

    assert updated is not None
    assert (updated.first_name, updated.last_name) == (None, None)
