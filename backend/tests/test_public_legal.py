"""Tests for the public legal-text endpoint backing /privacy and /terms."""

import pytest

from app.api.public.legal import get_legal_text
from app.models.user import Organization

pytestmark = pytest.mark.integration


async def _make_org(db, name: str, slug: str, legal: dict | None = None):
    org = Organization(name=name, slug=slug)
    if legal is not None:
        org.settings = {"legal": legal}
    db.add(org)
    await db.flush()
    return org


class TestGetLegalText:
    async def test_no_orgs_returns_defaults(self, db_session):
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result == {
            "organizationName": None,
            "privacyPolicy": None,
            "termsOfService": None,
            "lastUpdated": None,
        }

    async def test_single_org_without_custom_text(self, db_session):
        await _make_org(db_session, "Falls Church VFD", "fcvfd")
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None
        assert result["lastUpdated"] is None

    async def test_single_org_with_custom_text(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": "Our custom privacy wording.",
                "terms_of_service": "Our custom terms.",
                "last_updated": "March 3, 2026",
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["privacyPolicy"] == "Our custom privacy wording."
        assert result["termsOfService"] == "Our custom terms."
        assert result["lastUpdated"] == "March 3, 2026"

    async def test_multiple_orgs_returns_defaults(self, db_session):
        # Anonymous endpoint has no org context on a multi-tenant install:
        # never leak one org's configured text to another's visitors.
        await _make_org(db_session, "Org A", "org-a", legal={"privacy_policy": "A"})
        await _make_org(db_session, "Org B", "org-b")
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result == {
            "organizationName": None,
            "privacyPolicy": None,
            "termsOfService": None,
            "lastUpdated": None,
        }

    async def test_blank_and_whitespace_text_falls_back_to_defaults(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={"privacy_policy": "   \n ", "terms_of_service": ""},
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None

    async def test_non_string_settings_values_fall_back_to_defaults(self, db_session):
        # settings["legal"] is unvalidated JSON; a wrong type must not 500 a
        # public page that anonymous visitors reach.
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": 42,
                "terms_of_service": ["a"],
                "last_updated": None,
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None
        assert result["lastUpdated"] is None

    async def test_non_dict_legal_key_falls_back_to_defaults(self, db_session):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"legal": "not a dict"}
        db_session.add(org)
        await db_session.flush()
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None

    async def test_oversized_custom_text_is_truncated(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={"privacy_policy": "x" * 150_000},
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert len(result["privacyPolicy"]) == 100_000
