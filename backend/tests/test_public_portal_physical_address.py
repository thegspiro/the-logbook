"""The public portal publishes a station's address when it is the mailing one.

Workflow review W76: "Physical address same as mailing" (the onboarding
default) keeps the address in the mailing columns only. The public
organization endpoint returned ``physical_address: null`` for such a
department, so enabling only the physical address under Data Control
published nothing, while onboarding and the email templates both read the
mailing address as the physical one.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public.portal import get_organization_info
from app.models.public_portal import (
    PublicPortalAPIKey,
    PublicPortalConfig,
    PublicPortalDataWhitelist,
)
from app.models.user import Organization

pytestmark = pytest.mark.integration

MAILING = {
    "line1": "100 Main Street",
    "line2": None,
    "city": "Springfield",
    "state": "IL",
    "zip_code": "62701",
    "country": "USA",
}


async def _portal(db: AsyncSession, *, same: bool, enabled_fields: list[str]):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Portal VFD",
        slug=f"portal-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
        mailing_address_line1="100 Main Street",
        mailing_city="Springfield",
        mailing_state="IL",
        mailing_zip="62701",
        mailing_country="USA",
        physical_address_same=same,
        physical_address_line1=None if same else "1 Station Road",
        physical_city=None if same else "Springfield",
        physical_state=None if same else "IL",
        physical_zip=None if same else "62702",
        physical_country=None if same else "USA",
    )
    db.add(org)
    await db.flush()
    config = PublicPortalConfig(organization_id=org.id, enabled=True)
    db.add(config)
    await db.flush()
    for field in enabled_fields:
        db.add(
            PublicPortalDataWhitelist(
                organization_id=org.id,
                config_id=config.id,
                data_category="organization",
                field_name=field,
                is_enabled=True,
            )
        )
    key = PublicPortalAPIKey(
        organization_id=org.id,
        config_id=config.id,
        key_hash="unused",
        key_prefix=f"logbook_{uuid.uuid4().hex[:8]}",
        name="Department website",
    )
    db.add(key)
    await db.flush()
    return key


async def _info(db: AsyncSession, key: PublicPortalAPIKey):
    # The access-log write commits; the row it records is not under test.
    with patch("app.api.public.portal.log_public_api_request", AsyncMock()):
        return await get_organization_info(request=MagicMock(), api_key=key, db=db)


class TestPhysicalAddress:
    async def test_same_as_mailing_publishes_the_mailing_address(self, db_session):
        key = await _portal(db_session, same=True, enabled_fields=["physical_address"])

        info = await _info(db_session, key)

        assert info.physical_address is not None
        assert info.physical_address == MAILING
        # Only the field that was enabled is published.
        assert "mailing_address" not in info.model_dump(exclude_unset=True)

    async def test_a_separate_physical_address_is_published_as_entered(
        self, db_session
    ):
        key = await _portal(db_session, same=False, enabled_fields=["physical_address"])

        info = await _info(db_session, key)

        assert info.physical_address is not None
        assert info.physical_address["line1"] == "1 Station Road"
        assert info.physical_address["zip_code"] == "62702"

    async def test_nothing_is_published_when_the_field_is_off(self, db_session):
        key = await _portal(db_session, same=True, enabled_fields=["name"])

        info = await _info(db_session, key)

        assert info.model_dump(exclude_unset=True) == {"name": "Portal VFD"}
