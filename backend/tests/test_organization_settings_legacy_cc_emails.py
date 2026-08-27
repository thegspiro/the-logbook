"""MSG-6 follow-up: get_organization_settings must tolerate a legacy invalid
`scheduling.cc_emails` entry rather than raising a ValidationError on every
read (including the read at the end of an unrelated settings update).

`cc_emails` was tightened from `List[str]` to `List[EmailStr]` (MSG-6, fixing
a header-injection gap in the shared email send layer). That tightening is
correct on writes, which go through the strictly-validated
`OrganizationSettingsUpdate` schema — but `get_organization_settings`
reconstructs the *entire* stored settings blob via Pydantic on every read,
including sections nobody touched in the current request. Without a
tolerant read path, an org that saved a malformed cc_emails value before the
tightening would find every future settings read broken, with no way to
correct it through the API.
"""

import pytest

from app.core.utils import generate_uuid
from app.models.user import Organization
from app.services.organization_service import OrganizationService


async def _make_org(db_session, scheduling_cc_emails):
    org = Organization(
        id=generate_uuid(),
        name="Test Fire Department",
        slug=f"test-fire-dept-{generate_uuid()[:8]}",
        settings={"scheduling": {"cc_emails": scheduling_cc_emails}},
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest.mark.integration
async def test_legacy_invalid_cc_email_does_not_crash_the_read(db_session):
    org = await _make_org(db_session, ["chief@example.com", "not-an-email", "also bad"])
    settings = await OrganizationService(db_session).get_organization_settings(org.id)
    assert settings.scheduling.cc_emails == ["chief@example.com"]


@pytest.mark.integration
async def test_valid_cc_emails_are_preserved(db_session):
    org = await _make_org(db_session, ["chief@example.com", "deputy@example.com"])
    settings = await OrganizationService(db_session).get_organization_settings(org.id)
    assert settings.scheduling.cc_emails == [
        "chief@example.com",
        "deputy@example.com",
    ]


@pytest.mark.integration
async def test_an_unrelated_settings_update_does_not_crash_on_legacy_data(
    db_session,
):
    """The exact failure mode Codex flagged: update_organization_settings
    round-trips through get_organization_settings at the end, so a legacy
    bad value elsewhere must not block an unrelated field's update."""
    org = await _make_org(db_session, ["not-an-email"])
    service = OrganizationService(db_session)
    result = await service.update_organization_settings(
        org.id, {"membership_id": {"enabled": True}}
    )
    assert result.membership_id.enabled is True
    assert result.scheduling.cc_emails == []
