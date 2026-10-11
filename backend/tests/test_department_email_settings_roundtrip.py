"""The Department Email settings screen writes what the generator reads.

The screen saves ``{"department_email": {...}}`` through the general settings
PATCH. These tests pin that the write lands where
``_generate_department_email`` looks, that the other settings keys survive it,
and that switching it off stops generation (pitfall #19: the switch has a
reader).
"""

import uuid

import pytest

from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService
from app.services.organization_service import OrganizationService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Dept Email FD",
        slug=f"deptemail-{uuid.uuid4().hex[:8]}",
        settings={"membership_id": {"enabled": True}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def test_a_saved_setting_drives_the_generated_address(db_session):
    org = await _org(db_session)

    await OrganizationService(db_session).update_organization_settings(
        org.id,
        {
            "department_email": {
                "enabled": True,
                "domain": "firedept.org",
                "format": "flast",
            }
        },
    )

    settings = await OrganizationService(db_session).get_organization_settings(org.id)
    assert settings.department_email.enabled is True
    assert settings.department_email.domain == "firedept.org"
    assert settings.membership_id.enabled is True

    address = await MembershipPipelineService(db_session)._generate_department_email(
        "Jane", "Doe", org.id
    )
    assert address == "jdoe@firedept.org"


async def test_switching_it_off_stops_generation(db_session):
    org = await _org(db_session)
    service = OrganizationService(db_session)
    await service.update_organization_settings(
        org.id,
        {"department_email": {"enabled": True, "domain": "firedept.org"}},
    )
    await service.update_organization_settings(
        org.id,
        {"department_email": {"enabled": False, "domain": "firedept.org"}},
    )

    address = await MembershipPipelineService(db_session)._generate_department_email(
        "Jane", "Doe", org.id
    )
    assert address is None
