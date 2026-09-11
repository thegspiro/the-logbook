"""The navigation layout is a department-wide decision, not a personal one.

The setup wizard has always asked for it, but the answer only ever reached the
browser that gave it: the wizard wrote `localStorage`, which is where AppLayout
read it, and the copy POSTed to the server was stored on the ephemeral
onboarding session and read by nothing. Every member other than the officer who
ran setup got the default. See KNOWN_LIMITATIONS ONBOARD-5.

DB mocked; no MySQL.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import onboarding as onboarding_api
from app.api.v1.endpoints.auth import get_login_branding
from app.schemas.organization import AppearanceSettings, OrganizationSettings
from app.services.onboarding import OnboardingService


def _db_returning(row):
    db = MagicMock()
    result = MagicMock()
    result.first.return_value = row
    db.execute = AsyncMock(return_value=result)
    return db


def _org(settings):
    return SimpleNamespace(name="Engine Co.", logo=None, settings=settings)


@pytest.mark.unit
class TestAppearanceSettings:
    def test_defaults_to_the_left_sidebar(self):
        # The layout every install has had; an absent setting must not move it.
        assert AppearanceSettings().navigation_layout == "left"

    def test_is_part_of_organization_settings(self):
        assert OrganizationSettings().appearance.navigation_layout == "left"

    def test_rejects_a_layout_that_is_not_offered(self):
        # The specific exception and a match, so this cannot pass on some
        # unrelated ValueError raised while building the model.
        with pytest.raises(ValidationError, match="navigation_layout"):
            AppearanceSettings(navigation_layout="diagonal")


@pytest.mark.unit
class TestBrandingServesTheLayout:
    async def test_reports_the_departments_choice(self):
        db = _db_returning(_org({"appearance": {"navigation_layout": "top"}}))

        body = await get_login_branding(db)

        assert body["navigation_layout"] == "top"

    async def test_falls_back_when_no_appearance_block_is_stored(self):
        # Every organization created before this setting existed.
        db = _db_returning(_org({"modules": {"training": True}}))

        body = await get_login_branding(db)

        assert body["navigation_layout"] == "left"

    async def test_falls_back_on_a_malformed_value(self):
        # settings is free-form JSON; a bad value must not take the login page
        # down, which is what this endpoint exists to render.
        db = _db_returning(_org({"appearance": {"navigation_layout": "sideways"}}))

        body = await get_login_branding(db)

        assert body["navigation_layout"] == "left"

    async def test_falls_back_with_no_organization_yet(self):
        db = _db_returning(None)

        body = await get_login_branding(db)

        assert body == {"name": None, "logo": None, "navigation_layout": "left"}

    async def test_still_reports_name_and_logo(self):
        db = _db_returning(_org({"appearance": {"navigation_layout": "top"}}))

        body = await get_login_branding(db)

        assert body["name"] == "Engine Co."
        assert "logo" in body


async def _create_org(db_session: AsyncSession):
    service = OnboardingService(db_session)
    unique = str(uuid.uuid4())[:8]
    org = await service.create_organization(
        name=f"Layout Test VFD {unique}",
        slug=f"layout-test-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
    )
    await db_session.flush()
    return org


# Real rows, so a real database. The no-DB job selects on this marker;
# without it these run there and fail on `db_session` rather than on
# anything they assert.
@pytest.mark.integration
@pytest.mark.onboarding
class TestCompletionCarriesTheAnswerOntoTheOrganization:
    async def test_the_wizards_choice_reaches_the_organization(
        self, db_session: AsyncSession
    ):
        org = await _create_org(db_session)
        session = SimpleNamespace(
            data={"department": {"name": "Engine Co.", "navigation_layout": "top"}}
        )

        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert org.settings["appearance"]["navigation_layout"] == "top"

    async def test_an_unanswered_step_stores_nothing(self, db_session: AsyncSession):
        # Absent must mean "current behaviour", never a written-in default that
        # looks like a decision nobody made.
        org = await _create_org(db_session)
        session = SimpleNamespace(data={"department": {"name": "Engine Co."}})

        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert "appearance" not in (org.settings or {})

    async def test_a_malformed_answer_is_ignored(self, db_session: AsyncSession):
        org = await _create_org(db_session)
        session = SimpleNamespace(
            data={"department": {"navigation_layout": "sideways"}}
        )

        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert "appearance" not in (org.settings or {})

    async def test_other_appearance_keys_survive(self, db_session: AsyncSession):
        # The block is merged, not replaced — a sibling setting added later
        # must not be dropped by an onboarding completion.
        org = await _create_org(db_session)
        org.settings = {**(org.settings or {}), "appearance": {"accent": "red"}}
        await db_session.flush()

        session = SimpleNamespace(data={"department": {"navigation_layout": "top"}})
        await onboarding_api._persist_session_data_to_org(session, db_session)

        await db_session.refresh(org)
        assert org.settings["appearance"]["accent"] == "red"
        assert org.settings["appearance"]["navigation_layout"] == "top"
