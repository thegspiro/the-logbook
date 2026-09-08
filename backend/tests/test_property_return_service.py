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

from app.models.document import SYSTEM_FOLDERS, DocumentFolder, FolderVisibility
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


def _issuance(item, quantity_issued=1):
    return SimpleNamespace(
        item=item,
        quantity_issued=quantity_issued,
        issued_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )


def _db(member, org, officer, assignments, checkouts, issuances=None):
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _one(member),
            _one(org),
            _one(officer),
            _scalars(assignments),
            _scalars(checkouts),
            _scalars(issuances or []),
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

    async def test_includes_unreturned_pool_issuances(self):
        # Pool-issued items are accountable property and must appear in the
        # letter (count, value x quantity, and an "Issued" row label).
        db = _db(
            _member(),
            _org(),
            None,
            [_assignment(_item("Helmet", 100.0))],
            [],
            issuances=[_issuance(_item("Dept T-Shirt", 20.0), quantity_issued=3)],
        )
        data, html = await PropertyReturnService(db).generate_report(
            "u1", "org-1", "dropped_voluntary", "officer-1"
        )
        # Helmet (100) + 3 x T-Shirt (60) = 160.
        assert data["item_count"] == 2
        assert data["total_value"] == 160.0
        assert "Dept T-Shirt (x3)" in html
        assert "Issued" in html

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
    """Where the saved report lands, which is an access-control decision.

    The report prints the departed member's home address and the stated reason
    for the separation. It used to be filed in the ``Reports`` system folder,
    whose ORGANIZATION visibility makes it readable by every ``documents.view``
    holder, and fell back to ``folder_id = None`` — which
    ``DocumentsService.can_access_document`` also treats as organization-level
    — when that folder was missing. Both are asserted against here.
    """

    async def test_saves_into_existing_separations_folder(self):
        folder = SimpleNamespace(id="folder-1")
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(folder))
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.flush = AsyncMock()
        doc = await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )
        assert doc.folder_id == "folder-1"
        assert doc.organization_id == "org-1"
        # Only the document is added; the folder already existed.
        db.add.assert_called_once()
        db.commit.assert_awaited()

    async def test_creates_leadership_folder_when_absent(self):
        """A department onboarded before this folder existed still gets one.

        ``initialize_system_folders`` returns early for any organization that
        already has system folders, so relying on it would leave every
        existing department without the folder — and the report in whatever
        the fallback was.
        """
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.flush = AsyncMock()

        doc = await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )

        added = [c.args[0] for c in db.add.call_args_list]
        folders = [o for o in added if isinstance(o, DocumentFolder)]
        assert len(folders) == 1
        folder = folders[0]
        assert folder.slug == "member-separations"
        assert folder.visibility is FolderVisibility.LEADERSHIP
        assert folder.organization_id == "org-1"
        assert folder.is_system is True

        # Never organization-level: a null folder_id reads as org-wide.
        assert doc.folder_id is not None
        assert doc.folder_id == str(folder.id)

    async def test_registry_entry_is_leadership_only(self):
        """The seeded definition itself, so a fresh org is not the exception."""
        entry = next(s for s in SYSTEM_FOLDERS if s["slug"] == "member-separations")
        assert entry["visibility"] is FolderVisibility.LEADERSHIP

    async def test_reuses_folder_a_concurrent_drop_created(self):
        """The re-check under the organization lock, not just the fast path.

        ``(organization_id, slug)`` has no uniqueness constraint, so two
        members dropped at once would otherwise both insert and every later
        read of the folder would raise ``MultipleResultsFound`` — permanently,
        for that department. The first read misses, the loser waits on the
        organization row, and the second read must see the winner's folder.
        """
        winner = SimpleNamespace(id="folder-created-by-the-other-request")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(None),  # fast-path check: nothing yet
                _one(None),  # the organization row, locked
                _one(winner),  # re-check: the concurrent drop got there first
            ]
        )
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.flush = AsyncMock()

        doc = await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )

        assert doc.folder_id == "folder-created-by-the-other-request"
        added = [c.args[0] for c in db.add.call_args_list]
        assert not [o for o in added if isinstance(o, DocumentFolder)]

    async def test_existence_checks_lock_their_rows(self):
        """Both folder reads are locking reads (pitfall #27's second half).

        The caller has already read the member, the organization and the
        assignment rows, so the transaction's REPEATABLE READ snapshot
        predates the lock. A plain SELECT would report "no folder yet" even
        after waiting for the transaction that created one.
        """
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(None))
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.flush = AsyncMock()

        await PropertyReturnService(db).save_as_document(
            "org-1", "Jane Smith", "<html></html>", "officer-1"
        )

        statements = [str(c.args[0]) for c in db.execute.call_args_list]
        assert len(statements) == 3
        assert all("FOR UPDATE" in s for s in statements)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
