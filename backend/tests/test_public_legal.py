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
    # DOC-10 replaced the single shared "lastUpdated" field with one date per
    # document type (privacy and terms are independent documents with
    # independent revision histories) -- these fixtures/assertions were not
    # updated for that response-shape change until DOC-21 (Codex round-2 on
    # #1826) caught it.

    async def test_no_orgs_returns_defaults(self, db_session):
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result == {
            "organizationName": None,
            "privacyPolicy": None,
            "termsOfService": None,
            "privacyPolicyLastUpdated": None,
            "termsOfServiceLastUpdated": None,
            "lastUpdated": None,
        }

    async def test_single_org_without_custom_text(self, db_session):
        await _make_org(db_session, "Falls Church VFD", "fcvfd")
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None
        assert result["privacyPolicyLastUpdated"] is None
        assert result["termsOfServiceLastUpdated"] is None
        assert result["lastUpdated"] is None

    async def test_single_org_with_custom_text_and_per_type_dates(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": "Our custom privacy wording.",
                "privacy_policy_effective_date": "March 3, 2026",
                "terms_of_service": "Our custom terms.",
                "terms_of_service_effective_date": "Jan 1, 2026",
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["privacyPolicy"] == "Our custom privacy wording."
        assert result["termsOfService"] == "Our custom terms."
        # Each document type reads its own key -- publishing one never
        # misdates the other (DOC-10 finding #3).
        assert result["privacyPolicyLastUpdated"] == "March 3, 2026"
        assert result["termsOfServiceLastUpdated"] == "Jan 1, 2026"
        # Deprecated back-compat field for external v1 clients (DOC-25):
        # prefers the privacy policy's date, same ambiguity the original
        # shared key always had.
        assert result["lastUpdated"] == "March 3, 2026"

    async def test_legacy_shared_date_falls_back_for_both_types(self, db_session):
        # An install that published under the pre-DOC-10 shared key, and
        # hasn't republished either document since, still shows a date on
        # both -- the migration-era fallback in effective_date_for.
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
        assert result["privacyPolicyLastUpdated"] == "March 3, 2026"
        assert result["termsOfServiceLastUpdated"] == "March 3, 2026"
        assert result["lastUpdated"] == "March 3, 2026"

    async def test_republishing_one_document_stops_its_legacy_fallback(
        self, db_session
    ):
        # DOC-19/DOC-20 regression (Codex round-2 on #1826): once a document
        # type is republished under the per-type scheme -- even with the date
        # left blank -- its own key must win, and an explicitly-cleared date
        # must not resurrect the legacy shared value. The *other*,
        # never-republished document type still reads the legacy key.
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": "Republished notice.",
                "privacy_policy_effective_date": None,
                "terms_of_service": "Original terms.",
                "last_updated": "Jan 1, 2026",
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["privacyPolicyLastUpdated"] is None
        assert result["termsOfServiceLastUpdated"] == "Jan 1, 2026"
        # Back-compat field falls through to whichever document has a date.
        assert result["lastUpdated"] == "Jan 1, 2026"

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
            "privacyPolicyLastUpdated": None,
            "termsOfServiceLastUpdated": None,
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
                "privacy_policy_effective_date": 12345,
                "terms_of_service_effective_date": {"not": "a string"},
                "last_updated": None,
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None
        assert result["privacyPolicyLastUpdated"] is None
        assert result["termsOfServiceLastUpdated"] is None

    async def test_non_dict_legal_key_falls_back_to_defaults(self, db_session):
        org = Organization(name="Falls Church VFD", slug="fcvfd")
        org.settings = {"legal": "not a dict"}
        db_session.add(org)
        await db_session.flush()
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert result["organizationName"] == "Falls Church VFD"
        assert result["privacyPolicy"] is None
        assert result["termsOfService"] is None
        assert result["privacyPolicyLastUpdated"] is None
        assert result["termsOfServiceLastUpdated"] is None

    async def test_oversized_custom_text_is_truncated(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={"privacy_policy": "x" * 150_000},
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert len(result["privacyPolicy"]) == 100_000

    async def test_oversized_effective_date_is_truncated(self, db_session):
        await _make_org(
            db_session,
            "Falls Church VFD",
            "fcvfd",
            legal={
                "privacy_policy": "Notice.",
                "privacy_policy_effective_date": "x" * 200,
            },
        )
        result = await get_legal_text(request=None, db=db_session, _=None)
        assert len(result["privacyPolicyLastUpdated"]) == 64
