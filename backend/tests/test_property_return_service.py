"""
Tests for the property return report service
(app/services/property_return_service.py).

This generates the formal property-return letter (with itemized dollar
values) when a member is dropped. Covers address formatting, the report
data assembly from assignments + checkouts, total-value math, the
voluntary/involuntary letter variations, HTML escaping of member-supplied
text, and document persistence. DB mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.property_return_service import PropertyReturnService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _member(name="Jane Smith", **kw):
    return SimpleNamespace(
        id="u1",
        full_name=name,
        email="jane@x.org",
        membership_number=kw.get("membership_number", "M-100"),
        rank="Firefighter",
        address_street=kw.get("address_street", "1 Main St"),
        address_city=kw.get("address_city", "Town"),
        address_state=kw.get("address_state", "VA"),
        address_zip=kw.get("address_zip", "22000"),
    )


def _org():
    return SimpleNamespace(
        id="org-1",
        name="Falls Church Fire",
        timezone="America/New_York",
        physical_address_same=True,
        mailing_address_line1="10 Dept Rd",
        mailing_address_line2=None,
        mailing_city="Town",
        mailing_state="VA",
        mailing_zip="22000",
    )


def _item(name="Helmet", value=100.0, condition="good"):
    return SimpleNamespace(
        name=name,
        serial_number="SN1",
        asset_tag="AT1",
        condition=SimpleNamespace(value=condition),
        current_value=value,
        purchase_price=None,
    )


def _assignment(item):
    return SimpleNamespace(
        item=item,
        assigned_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def _checkout(item):
    return SimpleNamespace(
        item=item,
        checkout_condition=None,
        checked_out_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
    )


def _db(member, org, officer, assignments, checkouts):
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _one(member),
            _one(org),
            _one(officer),
            _scalars(assignments),
            _scalars(checkouts),
        ]
    )
    return db


class TestFormatAddress:
    def test_full_address(self):
        out = PropertyReturnService._format_address(_member())
        assert out == "1 Main St\nTown, VA 22000"

    def test_missing_zip_omits_it(self):
        m = _member(address_zip=None)
        assert PropertyReturnService._format_address(m) == "1 Main St\nTown, VA"

    def test_empty_when_no_fields(self):
        m = _member(
            address_street=None,
            address_city=None,
            address_state=None,
            address_zip=None,
        )
        assert PropertyReturnService._format_address(m) == ""


class TestFormatOrgAddress:
    def test_uses_mailing_when_physical_same(self):
        out = PropertyReturnService._format_org_address(_org())
        assert out == "10 Dept Rd\nTown, VA 22000"

    def test_prefers_physical_when_different(self):
        org = _org()
        org.physical_address_same = False
        org.physical_address_line1 = "99 Engine Way"
        org.physical_address_line2 = None
        org.physical_city = "City"
        org.physical_state = "VA"
        org.physical_zip = "22001"
        out = PropertyReturnService._format_org_address(org)
        assert out == "99 Engine Way\nCity, VA 22001"


class TestGenerateReport:
    async def test_raises_when_member_missing(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        with pytest.raises(ValueError, match="not found"):
            await PropertyReturnService(db).generate_report(
                "u1", "org-1", "dropped_voluntary", "officer-1"
            )

    async def test_assembles_items_and_total(self):
        officer = SimpleNamespace(full_name="Chief Bob", rank="Chief")
        db = _db(
            _member(),
            _org(),
            officer,
            [_assignment(_item("Helmet", 100.0))],
            [_checkout(_item("Radio", 250.0))],
        )
        data, html = await PropertyReturnService(db).generate_report(
            "u1", "org-1", "dropped_voluntary", "officer-1"
        )
        assert data["item_count"] == 2
        assert data["total_value"] == 350.0
        assert data["drop_type_display"] == "Voluntary Separation"
        assert data["performed_by_name"] == "Chief Bob"
        # Both items render in the letter with a formatted total.
        assert "Helmet" in html
        assert "Radio" in html
        assert "$350.00" in html

    async def test_involuntary_adds_legal_notice(self):
        db = _db(_member(), _org(), None, [], [])
        data, html = await PropertyReturnService(db).generate_report(
            "u1", "org-1", "dropped_involuntary", "officer-1"
        )
        assert data["drop_type_display"] == "Involuntary Separation"
        assert "legal remedies" in html
        # No items -> the "no property" row is shown.
        assert "No department property" in html
        # Missing officer falls back to a default signature.
        assert data["performed_by_name"] == "Department Administration"

    async def test_voluntary_has_no_legal_notice(self):
        db = _db(_member(), _org(), None, [], [])
        _, html = await PropertyReturnService(db).generate_report(
            "u1", "org-1", "dropped_voluntary", "officer-1"
        )
        assert "legal remedies" not in html

    async def test_member_name_is_html_escaped(self):
        evil = "Jane <script>alert(1)</script>"
        db = _db(_member(name=evil), _org(), None, [], [])
        _, html = await PropertyReturnService(db).generate_report(
            "u1", "org-1", "dropped_voluntary", "officer-1"
        )
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html


class TestSaveAsDocument:
    async def test_saves_into_reports_folder(self):
        folder = SimpleNamespace(id="folder-1")
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(folder))
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        doc = await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )
        assert doc.folder_id == "folder-1"
        assert doc.organization_id == "org-1"
        db.add.assert_called_once()
        db.commit.assert_awaited()

    async def test_folder_id_none_when_no_reports_folder(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        doc = await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )
        assert doc.folder_id is None


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
