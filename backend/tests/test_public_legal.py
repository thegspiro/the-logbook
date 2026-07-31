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
        }

    async def test_single_org_without_custom_text(self, db_session):
        await _make_org(db_session, "Falls Church VFD", "fcvfd")
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None

    async def test_single_org_with_custom_text(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": "Our custom privacy wording.",
                "terms_of_service": "Our custom terms.",
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["privacyPolicy"] == "Our custom privacy wording."
        assert result["termsOfService"] == "Our custom terms."

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
        }
