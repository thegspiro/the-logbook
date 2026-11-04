"""Public Information puts "set up the public portal" on the setup checklist.

Setup now asks about Public Information (owner decision 2026-11-01, W01-24),
and turning the module on publishes nothing: the portal has its own switch
(``public_portal_config.enabled``) and serves data only when both are on. So a
department that chose the module needs telling that the portal itself still
has to be set up, which is what the checklist is for.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.organizations import get_setup_checklist
from app.models.public_portal import PublicPortalConfig
from app.models.user import Organization, User
from app.schemas.organization import ModuleSettings

pytestmark = [pytest.mark.integration]


async def _org(db_session: AsyncSession, *, public_info: bool) -> Organization:
    unique = str(uuid.uuid4())[:8]
    org = Organization(
        name=f"Portal Checklist VFD {unique}",
        slug=f"portal-checklist-{unique}",
        # A complete module map: a partial one is read as never configured and
        # falls back to the declared defaults, which turn Public Information on.
        settings={"modules": ModuleSettings(public_info=public_info).model_dump()},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _portal_item(db_session: AsyncSession, org: Organization):
    caller = User(organization_id=org.id, username="officer", email="o@example.com")
    response = await get_setup_checklist(db_session, caller)
    return next((item for item in response.items if item.key == "public_info"), None)


class TestThePublicPortalItem:
    async def test_open_until_the_portal_is_switched_on(self, db_session: AsyncSession):
        org = await _org(db_session, public_info=True)

        item = await _portal_item(db_session, org)

        assert item is not None
        assert item.is_complete is False
        assert item.required is False
        assert item.path == "/admin/public-portal"

    async def test_complete_once_the_portal_is_enabled(self, db_session: AsyncSession):
        org = await _org(db_session, public_info=True)
        db_session.add(PublicPortalConfig(organization_id=org.id, enabled=True))
        await db_session.flush()

        item = await _portal_item(db_session, org)

        assert item is not None
        assert item.is_complete is True

    async def test_a_configured_but_switched_off_portal_is_not_complete(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, public_info=True)
        db_session.add(PublicPortalConfig(organization_id=org.id, enabled=False))
        await db_session.flush()

        item = await _portal_item(db_session, org)

        assert item is not None
        assert item.is_complete is False

    async def test_absent_when_the_module_is_off(self, db_session: AsyncSession):
        org = await _org(db_session, public_info=False)

        assert await _portal_item(db_session, org) is None
