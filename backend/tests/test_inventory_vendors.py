"""
Vendor tracking in the inventory module.

Vendors replace the free-text supplier name that used to sit on items and
reorder requests, so the rules that matter are the ones that keep the list
usable: one row per supplier per organization, exactly one primary contact,
deactivation that preserves purchase history, and org-scoped FK validation on
the ids the client supplies.

Mocked sessions — no DB — so they run in the sandbox.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints.inventory import _vendor_response
from app.models.inventory import InventoryVendor, InventoryVendorContact
from app.schemas.inventory import InventoryVendorCreate, InventoryVendorUpdate
from app.services.inventory_service import InventoryService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.flush = AsyncMock()
    db.execute = AsyncMock()
    db.delete = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return InventoryService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


def _first(value):
    """A result whose .scalars().first() yields `value`."""
    result = MagicMock()
    result.scalars.return_value.first.return_value = value
    return result


def _all(values):
    """A result whose .scalars().all() yields `values`."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = values
    return result


def _rows(rows):
    """A result whose .all() yields raw tuples (grouped aggregate queries)."""
    result = MagicMock()
    result.all.return_value = rows
    return result


def _rowcount(n):
    """A result from an UPDATE, whose .rowcount reports the rows touched."""
    result = MagicMock()
    result.rowcount = n
    return result


def _scalar_one_or_none(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _vendor(org_id, **kwargs):
    defaults = {
        "id": str(uuid4()),
        "organization_id": org_id,
        "name": "Galls",
        "is_active": True,
        "is_preferred": False,
    }
    defaults.update(kwargs)
    return InventoryVendor(**defaults)


def _contact(vendor_id, org_id, **kwargs):
    defaults = {
        "id": str(uuid4()),
        "organization_id": org_id,
        "vendor_id": vendor_id,
        "name": "Dana Reyes",
        "is_primary": False,
    }
    defaults.update(kwargs)
    return InventoryVendorContact(**defaults)


class TestVendorWebsiteValidation:
    @pytest.mark.parametrize("schema", [InventoryVendorCreate, InventoryVendorUpdate])
    @pytest.mark.parametrize(
        "website",
        [
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "/relative",
        ],
    )
    def test_rejects_non_http_website_links(self, schema, website):
        with pytest.raises(ValueError, match="absolute HTTP or HTTPS URL"):
            schema(name="Galls", website=website)

    @pytest.mark.parametrize("schema", [InventoryVendorCreate, InventoryVendorUpdate])
    @pytest.mark.parametrize(
        "website", ["https://example.com/path", "http://localhost:8080"]
    )
    def test_accepts_absolute_http_website_links(self, schema, website):
        assert schema(name="Galls", website=website).website == website


class TestVendorNameUniqueness:
    """One row per supplier per org — the reason the table exists."""

    async def test_duplicate_name_is_rejected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(_vendor(org_id, name="Galls"))]
        vendor, error = await service.create_vendor(org_id, {"name": "Galls"})
        assert vendor is None
        assert "already exists" in error

    async def test_duplicate_differing_only_in_case_is_rejected(
        self, service, mock_db, org_id
    ):
        # The lookup is case-folded, so "galls" resolves to the existing "Galls"
        # rather than creating a second supplier that pickers show twice.
        mock_db.execute.side_effect = [_first(_vendor(org_id, name="Galls"))]
        vendor, error = await service.create_vendor(org_id, {"name": "galls"})
        assert vendor is None
        assert "Galls" in error

    async def test_clash_with_inactive_vendor_points_at_reactivation(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [
            _first(_vendor(org_id, name="Galls", is_active=False))
        ]
        vendor, error = await service.create_vendor(org_id, {"name": "Galls"})
        assert vendor is None
        assert "Reactivate" in error

    async def test_blank_name_is_rejected(self, service, org_id):
        vendor, error = await service.create_vendor(org_id, {"name": "   "})
        assert vendor is None
        assert error == "Vendor name is required"

    async def test_rename_onto_another_vendor_is_rejected(
        self, service, mock_db, org_id
    ):
        target = _vendor(org_id, name="Galls")
        other = _vendor(org_id, name="Fire Supply Co")
        mock_db.execute.side_effect = [_first(target), _first(other)]
        vendor, error = await service.update_vendor(
            target.id, org_id, {"name": "Fire Supply Co"}
        )
        assert vendor is None
        assert "already exists" in error


class TestVendorCreate:
    async def test_name_is_trimmed_and_contacts_are_created(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [
            _first(None),  # no name clash
            _all([]),  # _normalize_primary_contact
            _first(None),  # get_vendor re-read
        ]
        await service.create_vendor(
            org_id,
            {
                "name": "  Fire Supply Co  ",
                "contacts": [{"name": "Alex Chen"}, {"name": "Dana Reyes"}],
            },
        )
        added = mock_db.add.call_args_list
        vendor = added[0][0][0]
        contacts = [call[0][0] for call in added[1:]]
        assert vendor.name == "Fire Supply Co"
        assert [c.name for c in contacts] == ["Alex Chen", "Dana Reyes"]
        # The first contact entered is the one to call: a vendor whose only
        # contact is unflagged would otherwise show none on its card.
        assert contacts[0].is_primary is True
        # Left unset, so the column default (False) applies at flush.
        assert not contacts[1].is_primary

    async def test_explicit_primary_is_respected(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(None), _all([]), _first(None)]
        await service.create_vendor(
            org_id,
            {
                "name": "Fire Supply Co",
                "contacts": [
                    {"name": "Alex Chen"},
                    {"name": "Dana Reyes", "is_primary": True},
                ],
            },
        )
        contacts = [call[0][0] for call in mock_db.add.call_args_list[1:]]
        assert not contacts[0].is_primary
        assert contacts[1].is_primary is True


class TestPrimaryContactNormalization:
    async def test_flagging_one_demotes_the_others(self, service, mock_db, org_id):
        vendor_id = str(uuid4())
        keep = _contact(vendor_id, org_id, name="Dana", is_primary=True)
        other = _contact(vendor_id, org_id, name="Alex", is_primary=True)
        mock_db.execute.side_effect = [_all([other, keep])]

        await service._normalize_primary_contact(
            vendor_id, org_id, keep_contact_id=keep.id
        )

        assert keep.is_primary is True
        assert other.is_primary is False

    async def test_first_contact_is_promoted_when_none_is_flagged(
        self, service, mock_db, org_id
    ):
        vendor_id = str(uuid4())
        alex = _contact(vendor_id, org_id, name="Alex")
        dana = _contact(vendor_id, org_id, name="Dana")
        mock_db.execute.side_effect = [_all([alex, dana])]

        await service._normalize_primary_contact(vendor_id, org_id)

        assert alex.is_primary is True
        assert dana.is_primary is False

    async def test_extra_flags_are_cleared_when_several_claim_primary(
        self, service, mock_db, org_id
    ):
        vendor_id = str(uuid4())
        alex = _contact(vendor_id, org_id, name="Alex", is_primary=True)
        dana = _contact(vendor_id, org_id, name="Dana", is_primary=True)
        mock_db.execute.side_effect = [_all([alex, dana])]

        await service._normalize_primary_contact(vendor_id, org_id)

        assert alex.is_primary is True
        assert dana.is_primary is False

    async def test_no_contacts_is_a_no_op(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_all([])]
        await service._normalize_primary_contact(str(uuid4()), org_id)


class TestVendorUpdateAndDeactivate:
    async def test_explicit_null_clears_a_field(self, service, mock_db, org_id):
        vendor = _vendor(org_id, account_number="FCFD-2201")
        mock_db.execute.side_effect = [_first(vendor), _first(vendor)]

        updated, error = await service.update_vendor(
            vendor.id, org_id, {"account_number": None}
        )

        assert error is None
        assert updated.account_number is None

    async def test_update_of_missing_vendor_reports_not_found(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [_first(None)]
        vendor, error = await service.update_vendor(
            str(uuid4()), org_id, {"city": "DC"}
        )
        assert vendor is None
        assert error == "Vendor not found"

    async def test_deactivation_keeps_the_row(self, service, mock_db, org_id):
        vendor = _vendor(org_id)
        mock_db.execute.side_effect = [_first(vendor)]

        ok, error = await service.deactivate_vendor(vendor.id, org_id)

        assert ok is True
        assert error is None
        # Deactivated, not deleted: the items bought from them keep their link,
        # so equipment in service can still say where it came from.
        assert vendor.is_active is False
        mock_db.delete.assert_not_called()

    async def test_deactivating_a_missing_vendor_reports_not_found(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [_first(None)]
        ok, error = await service.deactivate_vendor(str(uuid4()), org_id)
        assert ok is False
        assert error == "Vendor not found"


class TestVendorStats:
    """The card's two numbers count different rows on purpose: "items" is the
    catalog as it stands, spend is every item ever bought from the vendor."""

    async def test_counts_and_spend_are_grouped_per_vendor(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [
            _rows([("v-1", 4, 1200), ("v-2", 1, None)]),
            _rows([("v-1", 2)]),
        ]

        stats = await service.get_vendor_stats(org_id, ["v-1", "v-2"])

        assert stats["v-1"] == {
            "item_count": 4,
            "open_reorder_count": 2,
            "total_purchase_value": 1200,
        }
        assert stats["v-2"]["item_count"] == 1
        assert stats["v-2"]["open_reorder_count"] == 0

    async def test_no_vendors_runs_no_queries(self, service, mock_db, org_id):
        assert await service.get_vendor_stats(org_id, []) == {}
        mock_db.execute.assert_not_called()


class TestUnlinkedVendorNames:
    """The rows still carrying a typed-in supplier name and nothing else."""

    async def test_items_and_reorders_fold_into_one_entry_per_name(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [
            _rows([("Corner Medical Supply", 4)]),
            _rows([("corner medical supply", 2)]),
        ]

        names = await service.list_unlinked_vendor_names(org_id)

        # One supplier, two spellings, one row to act on.
        assert names == [
            {"name": "Corner Medical Supply", "item_count": 4, "reorder_count": 2}
        ]

    async def test_busiest_name_comes_first(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [
            _rows([("Ace Hardware", 1), ("Corner Medical Supply", 9)]),
            _rows([]),
        ]

        names = await service.list_unlinked_vendor_names(org_id)

        assert [n["name"] for n in names] == ["Corner Medical Supply", "Ace Hardware"]

    async def test_blank_names_are_not_offered(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_rows([("   ", 3), (None, 2)]), _rows([])]
        assert await service.list_unlinked_vendor_names(org_id) == []


class TestAttachVendorName:
    async def test_links_items_and_reorders_and_reports_counts(
        self, service, mock_db, org_id
    ):
        vendor = _vendor(org_id)
        mock_db.execute.side_effect = [_first(vendor), _rowcount(4), _rowcount(2)]

        result, error = await service.attach_vendor_name(
            vendor.id, org_id, "Corner Medical Supply"
        )

        assert error is None
        assert result == {"items_linked": 4, "reorders_linked": 2}

    async def test_blank_name_is_rejected(self, service, org_id):
        result, error = await service.attach_vendor_name(str(uuid4()), org_id, "   ")
        assert result is None
        assert error == "A supplier name is required"

    async def test_missing_vendor_is_reported(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(None)]
        result, error = await service.attach_vendor_name(str(uuid4()), org_id, "Galls")
        assert result is None
        assert error == "Vendor not found"


class TestMergeVendors:
    async def test_moves_everything_and_removes_the_duplicate(
        self, service, mock_db, org_id
    ):
        target = _vendor(org_id, name="Galls")
        source = _vendor(org_id, name="Galls Inc.")
        mock_db.execute.side_effect = [
            _first(target),
            _first(source),
            _rowcount(12),
            _rowcount(3),
            _all([]),  # _normalize_primary_contact on the target
        ]

        result, error = await service.merge_vendors(target.id, source.id, org_id)

        assert error is None
        assert result["items_moved"] == 12
        assert result["reorders_moved"] == 3
        # Counted from the collection that was re-parented, not from a bulk
        # UPDATE's rowcount; this source had no contacts loaded.
        assert result["contacts_moved"] == 0
        # Named, so the confirmation can say what happened.
        assert result["merged_name"] == "Galls Inc."
        assert result["vendor_name"] == "Galls"
        # Removed rather than deactivated: a merged duplicate left on file keeps
        # its name reserved and haunts "show inactive" forever.
        mock_db.delete.assert_awaited_once_with(source)

    async def test_contacts_are_reparented_rather_than_cascade_deleted(
        self, service, mock_db, org_id
    ):
        target = _vendor(org_id, name="Galls")
        source = _vendor(org_id, name="Galls Inc.")
        contact = _contact(source.id, org_id, name="Ray Whitfield")
        source.contacts.append(contact)
        mock_db.execute.side_effect = [
            _first(target),
            _first(source),
            _rowcount(1),
            _rowcount(0),
            _all([]),
        ]

        result, error = await service.merge_vendors(target.id, source.id, org_id)

        assert error is None
        # The relationship cascades delete-orphan, so a contact still sitting in
        # the source's loaded collection when the source is deleted is deleted
        # with it — reported as moved, gone from the database. Re-parenting on
        # both sides is what keeps the merge honest.
        assert contact in target.contacts
        assert list(source.contacts) == []
        assert result["contacts_moved"] == 1

    async def test_a_vendor_cannot_be_merged_into_itself(self, service, org_id):
        vendor_id = str(uuid4())
        result, error = await service.merge_vendors(vendor_id, vendor_id, org_id)
        assert result is None
        assert error == "A vendor cannot be merged into itself"

    async def test_missing_target_is_reported(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(None)]
        result, error = await service.merge_vendors(str(uuid4()), str(uuid4()), org_id)
        assert result is None
        assert error == "Vendor not found"

    async def test_missing_source_is_reported_distinctly(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [_first(_vendor(org_id)), _first(None)]
        result, error = await service.merge_vendors(str(uuid4()), str(uuid4()), org_id)
        assert result is None
        assert error == "The vendor to merge was not found"

    async def test_nothing_is_deleted_when_the_source_is_missing(
        self, service, mock_db, org_id
    ):
        mock_db.execute.side_effect = [_first(_vendor(org_id)), _first(None)]
        await service.merge_vendors(str(uuid4()), str(uuid4()), org_id)
        mock_db.delete.assert_not_called()


class TestReorderRelationshipRefresh:
    """A second query returns the same identity-mapped row and leaves loaded
    relationships alone, so a changed vendor_id would otherwise be serialized
    beside the previous vendor's name."""

    async def test_refresh_asks_for_populate_existing(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(None)]
        await service.get_reorder_request(str(uuid4()), org_id, refresh_loaded=True)
        query = mock_db.execute.await_args[0][0]
        assert query.get_execution_options().get("populate_existing") is True

    async def test_plain_reads_do_not_force_a_refresh(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_first(None)]
        await service.get_reorder_request(str(uuid4()), org_id)
        query = mock_db.execute.await_args[0][0]
        assert "populate_existing" not in query.get_execution_options()


class TestVendorFkScoping:
    """XC-1: a vendor id from the client must belong to the caller's org."""

    async def test_item_rejects_a_foreign_vendor(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_scalar_one_or_none(None)]
        with pytest.raises(ValueError, match="vendor"):
            await service._assert_item_fks_in_org({"vendor_id": str(uuid4())}, org_id)

    async def test_reorder_rejects_a_foreign_vendor(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_scalar_one_or_none(None)]
        with pytest.raises(ValueError, match="vendor"):
            await service._assert_reorder_fks_in_org(
                {"vendor_id": str(uuid4())}, org_id
            )

    async def test_in_org_vendor_passes(self, service, mock_db, org_id):
        mock_db.execute.side_effect = [_scalar_one_or_none("v-1")]
        await service._assert_item_fks_in_org({"vendor_id": str(uuid4())}, org_id)

    async def test_unlinking_is_allowed(self, service, mock_db, org_id):
        # An explicit null means "unlink", not "look up the row None".
        await service._assert_item_fks_in_org({"vendor_id": None}, org_id)
        mock_db.execute.assert_not_called()


class TestFinancialRedaction:
    """`inventory.view` is a broad member-level grant. What we pay a supplier,
    on what terms, and under which account number rides with
    `inventory.manage` instead — the rest of the record stays readable so the
    directory still answers "who do I call"."""

    def _built(self, org_id, **kwargs):
        vendor = _vendor(
            org_id,
            account_number="FCFD-2201",
            payment_terms="Net 30",
            phone="703-555-0100",
            email="orders@galls.example",
            city="Falls Church",
            created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            **kwargs,
        )
        return vendor

    def test_viewer_gets_no_money(self, org_id):
        payload = _vendor_response(
            self._built(org_id),
            {"item_count": 4, "open_reorder_count": 1, "total_purchase_value": 1200},
            include_financials=False,
        )
        assert payload.account_number is None
        assert payload.payment_terms is None
        assert payload.total_purchase_value is None

    def test_viewer_still_gets_the_directory(self, org_id):
        payload = _vendor_response(
            self._built(org_id),
            {"item_count": 4, "open_reorder_count": 1, "total_purchase_value": 1200},
            include_financials=False,
        )
        assert payload.name == "Galls"
        assert payload.phone == "703-555-0100"
        assert payload.email == "orders@galls.example"
        assert payload.city == "Falls Church"
        # Counts say "we buy from them"; only the amount is withheld.
        assert payload.item_count == 4
        assert payload.open_reorder_count == 1

    def test_manager_gets_everything(self, org_id):
        payload = _vendor_response(
            self._built(org_id),
            {"item_count": 4, "open_reorder_count": 1, "total_purchase_value": 1200},
            include_financials=True,
        )
        assert payload.account_number == "FCFD-2201"
        assert payload.payment_terms == "Net 30"
        assert payload.total_purchase_value == 1200

    def test_redaction_survives_a_missing_stats_row(self, org_id):
        # A vendor with no purchase history gets no stats dict at all; the
        # stored account number must still be withheld.
        payload = _vendor_response(self._built(org_id), None, include_financials=False)
        assert payload.account_number is None
        assert payload.payment_terms is None

    def test_clearance_has_no_default(self):
        # The flag is keyword-only and required: a call site that forgets it
        # should fail loudly rather than leak by default.
        with pytest.raises(TypeError):
            _vendor_response(MagicMock())
