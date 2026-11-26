"""The public website's settings: the service and its admin endpoints."""

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.endpoints import public_site as endpoints
from app.models.public_site import PublicSiteSettings, PublicSiteTheme
from app.models.user import Organization, User
from app.schemas.public_site import PublicSiteSettingsUpdate
from app.services.public_site_service import (
    SWITCHES,
    THEMES,
    PublicSiteService,
    paragraphs,
)


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PUT",
            "path": "/",
            "headers": [],
            "query_string": b"",
            "client": ("203.0.113.9", 4000),
        }
    )


@pytest.mark.unit
class TestTheShape:
    def test_the_switches_are_the_models_boolean_columns(self):
        booleans = {
            column.name
            for column in PublicSiteSettings.__table__.columns
            if column.type.python_type is bool
        }
        assert set(SWITCHES) == booleans

    def test_the_themes_on_offer_are_the_enums(self):
        assert [theme["value"] for theme in THEMES] == [
            theme.value for theme in PublicSiteTheme
        ]

    def test_the_schema_accepts_exactly_the_themes_on_offer(self):
        for theme in PublicSiteTheme:
            assert PublicSiteSettingsUpdate(theme=theme.value).theme == theme.value
        with pytest.raises(ValidationError):
            PublicSiteSettingsUpdate(theme="retired")

    def test_text_longer_than_its_column_is_refused(self):
        with pytest.raises(ValidationError):
            PublicSiteSettingsUpdate(tagline="x" * 201)

    def test_paragraphs_split_on_blank_lines(self):
        assert paragraphs("One\r\nstill one\r\n\r\n\r\nTwo\n\n") == [
            "One\nstill one",
            "Two",
        ]
        assert paragraphs(None) == []
        assert paragraphs("   ") == []


@pytest.mark.integration
class TestTheService:
    async def test_an_unsaved_department_reads_as_everything_off(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        row = await PublicSiteService(db_session).settings(org_id)
        assert row.id is None
        assert [getattr(row, name) for name in SWITCHES] == [False] * len(SWITCHES)
        assert row.theme == "classic"

    async def test_only_the_fields_sent_change(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        service = PublicSiteService(db_session)
        await service.update_settings(
            org_id, {"enabled": True, "tagline": "  Since 1925  "}, admin_id
        )
        await service.update_settings(org_id, {"theme": "modern"}, admin_id)
        row = await service.settings(org_id)
        assert (row.enabled, row.tagline, row.theme) == (True, "Since 1925", "modern")
        assert row.updated_by == admin_id
        count = len(
            (await db_session.execute(select(PublicSiteSettings))).scalars().all()
        )
        assert count == 1

    @pytest.mark.parametrize("cleared", [None, "", "   "])
    async def test_a_text_field_sent_empty_is_cleared(
        self, db_session, setup_org_and_admin, cleared
    ):
        org_id, admin_id = setup_org_and_admin
        service = PublicSiteService(db_session)
        await service.update_settings(org_id, {"about_text": "Our story."}, admin_id)
        await service.update_settings(org_id, {"about_text": cleared}, admin_id)
        assert (await service.settings(org_id)).about_text is None

    async def test_a_switch_cannot_be_cleared(self, db_session, setup_org_and_admin):
        org_id, admin_id = setup_org_and_admin
        with pytest.raises(ValueError, match="cannot be cleared"):
            await PublicSiteService(db_session).update_settings(
                org_id, {"enabled": None}, admin_id
            )

    async def test_servable_only_with_exactly_one_department(
        self, db_session, setup_org_and_admin
    ):
        service = PublicSiteService(db_session)
        assert await service.is_servable() is True
        db_session.add(Organization(name="Other", slug="other"))
        await db_session.flush()
        assert await service.is_servable() is False


@pytest.mark.integration
class TestTheEndpoints:
    async def _admin(self, db, admin_id) -> User:
        return (await db.execute(select(User).where(User.id == admin_id))).scalar_one()

    async def test_the_view_before_anything_is_saved(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        org = await db_session.get(Organization, org_id)
        org.phone = "(703) 555-0100"
        org.mailing_address_line1 = "6950 Little Falls Rd"
        org.mailing_city = "Arlington"
        org.mailing_state = "VA"
        await db_session.flush()
        view = await endpoints.get_public_site_settings(
            db=db_session, current_user=await self._admin(db_session, admin_id)
        )
        assert view.enabled is False
        assert view.servable is True
        assert [theme.value for theme in view.themes] == [
            "classic",
            "modern",
            "heritage",
        ]
        assert view.contact_on_record.phone == "(703) 555-0100"
        assert view.contact_on_record.address_lines == [
            "6950 Little Falls Rd",
            "Arlington, VA",
        ]

    async def test_an_update_is_saved_for_the_callers_department_only(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        other = Organization(name="Other", slug="other")
        db_session.add(other)
        await db_session.flush()
        view = await endpoints.update_public_site_settings(
            payload=PublicSiteSettingsUpdate(enabled=True, show_about=True),
            request=_request(),
            db=db_session,
            current_user=await self._admin(db_session, admin_id),
        )
        assert (view.enabled, view.show_about, view.show_contact) == (
            True,
            True,
            False,
        )
        assert view.servable is False
        rows = (await db_session.execute(select(PublicSiteSettings))).scalars().all()
        assert [row.organization_id for row in rows] == [org_id]

    async def test_a_null_for_a_switch_is_a_400(self, db_session, setup_org_and_admin):
        from fastapi import HTTPException

        _, admin_id = setup_org_and_admin
        with pytest.raises(HTTPException) as refused:
            await endpoints.update_public_site_settings(
                payload=PublicSiteSettingsUpdate(enabled=None),
                request=_request(),
                db=db_session,
                current_user=await self._admin(db_session, admin_id),
            )
        assert refused.value.status_code == 400
