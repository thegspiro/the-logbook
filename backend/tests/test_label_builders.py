"""
Integration tests for the per-module label builders
(app/services/label_service.py) — apparatus, prospective members, facilities,
and members.

Each test feeds a *real* ORM model instance (constructed in memory, so any
mis-named attribute the builder reads would raise) through a mocked query, then
exercises the real builder via LabelService.preview()/generate(): asserting the
record→label field mapping and that a valid PDF is produced by the shared
renderer. No MySQL required.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.label_service import LabelService
from app.utils.member_badge import is_badge_code


def _service_returning(*records):
    """A LabelService whose db.scalars(...) resolves to the given records."""
    db = MagicMock()
    result = MagicMock()
    result.all.return_value = list(records)
    db.scalars = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    return LabelService(db)


class TestApparatusBuilder:
    def _apparatus(self, **kw):
        from app.models.apparatus import Apparatus

        return Apparatus(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            unit_number=kw.get("unit_number", "E5"),
            name=kw.get("name", "Engine 5"),
            asset_tag=kw.get("asset_tag", "A-100"),
        )

    async def test_maps_fields(self):
        a = self._apparatus()
        preview = await _service_returning(a).preview(uuid4(), "apparatus", [a.id])
        assert preview[0]["name"] == "Engine 5"
        assert preview[0]["barcode_value"] == "A-100"  # asset_tag preferred
        assert preview[0]["subtitle"] == "A-100"

    async def test_falls_back_to_unit_number(self):
        a = self._apparatus(asset_tag=None)
        preview = await _service_returning(a).preview(uuid4(), "apparatus", [a.id])
        assert preview[0]["barcode_value"] == "E5"

    async def test_renders_pdf(self):
        a = self._apparatus()
        pdf, _, _ = await _service_returning(a).generate(
            uuid4(), "apparatus", [a.id], "letter"
        )
        assert pdf.getvalue()[:4] == b"%PDF"


class TestProspectBuilder:
    def _prospect(self, **kw):
        from app.models.membership_pipeline import ProspectiveMember

        return ProspectiveMember(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            first_name=kw.get("first_name", "Jane"),
            last_name=kw.get("last_name", "Applicant"),
            status_token=kw.get("status_token", "TOK12345"),
        )

    async def test_maps_name_and_short_id_never_the_status_token(self):
        """The status token is the applicant's credential for their public
        status page (it withdraws the application); printing it put it in the
        hands of anyone who previewed or held a label (workflow review W17-3).
        """
        p = self._prospect(status_token="SecretStatusToken123")
        preview = await _service_returning(p).preview(
            uuid4(), "prospective_members", [p.id]
        )
        assert preview[0]["name"] == "Jane Applicant"
        assert preview[0]["barcode_value"] == p.id.replace("-", "")[:12].upper()
        assert "SecretStatusToken123" not in str(preview)

    async def test_renders_pdf(self):
        p = self._prospect()
        pdf, _, _ = await _service_returning(p).generate(
            uuid4(), "prospective_members", [p.id], "rollo_2x1"
        )
        assert pdf.getvalue()[:4] == b"%PDF"


class TestFacilityBuilder:
    def _facility(self, **kw):
        from app.models.facilities import Facility

        return Facility(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            name=kw.get("name", "Station 1"),
            facility_number=kw.get("facility_number", "ST-1"),
        )

    async def test_maps_fields(self):
        f = self._facility()
        preview = await _service_returning(f).preview(uuid4(), "facilities", [f.id])
        assert preview[0]["name"] == "Station 1"
        assert preview[0]["barcode_value"] == "ST-1"
        assert preview[0]["subtitle"] == "ST-1"

    async def test_renders_pdf(self):
        f = self._facility()
        pdf, _, _ = await _service_returning(f).generate(
            uuid4(), "facilities", [f.id], "dymo_30334"
        )
        assert pdf.getvalue()[:4] == b"%PDF"


class TestMemberBuilder:
    def _user(self, **kw):
        from app.models.user import User

        return User(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            first_name=kw.get("first_name", "John"),
            last_name=kw.get("last_name", "Smith"),
            membership_number=kw.get("membership_number", "M-042"),
            badge_code=kw.get("badge_code"),
        )

    async def test_encodes_the_issued_badge_code_not_the_membership_number(self):
        """The membership number is in the directory; a badge that encoded it
        could be printed by any member. It stays on the label as text only."""
        u = self._user(badge_code="MB-23456789AB")
        preview = await _service_returning(u).preview(uuid4(), "membership", [u.id])
        assert preview[0]["name"] == "John Smith"
        assert preview[0]["barcode_value"] == "MB-23456789AB"
        assert preview[0]["subtitle"] == "M-042"

    async def test_issues_a_code_for_a_member_without_one(self):
        u = self._user(membership_number=None)
        preview = await _service_returning(u).preview(uuid4(), "membership", [u.id])
        assert is_badge_code(preview[0]["barcode_value"])
        assert preview[0]["barcode_value"] == u.badge_code
        assert preview[0]["subtitle"] is None

    async def test_renders_pdf(self):
        u = self._user()
        pdf, _, _ = await _service_returning(u).generate(
            uuid4(), "membership", [u.id], "letter"
        )
        assert pdf.getvalue()[:4] == b"%PDF"
