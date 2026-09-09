"""Tests for the items CSV export.

The endpoint had no test at all, which is how three defects survived in it
together: it accepted three of the list's eleven filters, it did not apply the
medical-stock exclusion its own page applies, and it capped the file at 10,000
rows without saying so. A file that disagrees with the screen it was exported
from is read as the truth and acted on, so what these assert is the agreement
rather than the mechanics.

The endpoint function is driven directly and its ``body_iterator`` drained,
because the paging loop lives inside the generator: a test that stopped at the
response object would exercise none of it.
"""

import csv
import io
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import inventory as inventory_endpoints
from app.models.inventory import (
    InventoryCategory,
    InventoryItem,
    ItemCondition,
    ItemStatus,
    ItemType,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

# A real database: the export's population is decided by a NOT IN subquery over
# categories and by offset paging over a sorted select, neither of which a
# mocked session can have an opinion about. The unit CI job runs with no
# database service, so without this marker every test here errors on connect.
pytestmark = pytest.mark.integration


class _BorrowedSession:
    """Hands the fixture's transaction to the generator's own session context.

    The export deliberately opens its own session — a ``yield`` dependency's
    exit code runs before a streaming body is sent, so the request's session is
    already closed by then. In a test the seeded rows exist only inside the
    fixture's rolled-back transaction, so the generator is handed that session,
    and must not close it on the way out.
    """

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc_info):
        return False


async def _export(db, organization_id: str, **params) -> list[list[str]]:
    """Run the endpoint and return the parsed CSV, header row included."""
    current_user = SimpleNamespace(organization_id=organization_id)
    with patch.object(
        inventory_endpoints,
        "async_session_factory",
        return_value=_BorrowedSession(db),
    ):
        response = await inventory_endpoints.export_items_csv(
            current_user=current_user, **params
        )
        chunks = [chunk async for chunk in response.body_iterator]
    return list(csv.reader(io.StringIO("".join(chunks))))


def _names(rows: list[list[str]]) -> list[str]:
    """The Name column of every data row, in file order."""
    return [row[0] for row in rows[1:]]


async def _org(db, name: str = "Export FD") -> Organization:
    org = Organization(name=name, slug=f"export-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _category(db, org, name: str, item_type: ItemType) -> InventoryCategory:
    category = InventoryCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        item_type=item_type,
        active=True,
    )
    db.add(category)
    await db.flush()
    return category


async def _item(db, org, name: str, **kwargs) -> InventoryItem:
    item = InventoryItem(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        condition=kwargs.pop("condition", ItemCondition.GOOD),
        status=kwargs.pop("status", ItemStatus.AVAILABLE),
        active=kwargs.pop("active", True),
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


@pytest.fixture
async def org(db_session):
    return await _org(db_session)


@pytest.fixture
async def gear(db_session, org):
    """A uniform closet with two colours and two conditions."""
    category = await _category(db_session, org, "Class B Uniform", ItemType.UNIFORM)
    await _item(
        db_session,
        org,
        "Navy Long Sleeve",
        category_id=category.id,
        color="Navy",
        size="l",
    )
    await _item(
        db_session,
        org,
        "Navy Short Sleeve",
        category_id=category.id,
        color="Navy",
        size="m",
        condition=ItemCondition.FAIR,
    )
    await _item(
        db_session,
        org,
        "White Dress Shirt",
        category_id=category.id,
        color="White",
        size="l",
    )
    return category


class TestTheFileMatchesTheList:
    async def test_the_filters_the_page_offers_reach_the_file(
        self, db_session, org, gear
    ):
        # The original defect, stated as one assertion: narrowing the list to a
        # colour and a condition used to export the whole uniform closet,
        # because the handler named only category, status and search.
        rows = await _export(
            db_session, org.id, color="Navy", condition=ItemCondition.FAIR.value
        )
        assert _names(rows) == ["Navy Short Sleeve"]

    async def test_a_size_filter_narrows_the_file(self, db_session, org, gear):
        rows = await _export(db_session, org.id, size="m")
        assert _names(rows) == ["Navy Short Sleeve"]

    async def test_search_still_narrows_the_file(self, db_session, org, gear):
        rows = await _export(db_session, org.id, search="Dress")
        assert _names(rows) == ["White Dress Shirt"]

    async def test_the_sort_is_honoured(self, db_session, org, gear):
        ascending = _names(await _export(db_session, org.id, sort_by="name"))
        descending = _names(
            await _export(db_session, org.id, sort_by="name", sort_order="desc")
        )
        assert ascending == sorted(ascending)
        assert descending == list(reversed(ascending))

    async def test_medical_stock_stays_on_its_own_page(self, db_session, org, gear):
        medical = await _category(db_session, org, "EMS Supplies", ItemType.MEDICAL)
        await _item(db_session, org, "4x4 Gauze", category_id=medical.id)

        rows = await _export(db_session, org.id)

        # The list hard-codes the same exclusion. An export that carries EMS
        # consumables the page never showed is the disagreement this change
        # exists to remove -- not a permission bypass, since the medical
        # endpoints are already open to anyone holding inventory.manage.
        assert "4x4 Gauze" not in _names(rows)
        assert "Navy Long Sleeve" in _names(rows)

    async def test_an_uncategorized_item_is_not_mistaken_for_medical(
        self, db_session, org, gear
    ):
        # NULL NOT IN (...) is NULL, so a naive exclusion drops every item
        # nobody has filed yet. _outside_domains guards this; assert it here
        # too, since the export is the copy people reconcile against.
        await _item(db_session, org, "Unfiled Nozzle")
        assert "Unfiled Nozzle" in _names(await _export(db_session, org.id))

    async def test_another_org_stock_is_never_in_the_file(self, db_session, org, gear):
        other = await _org(db_session, "Neighbouring FD")
        await _item(db_session, other, "Their Helmet")

        assert "Their Helmet" not in _names(await _export(db_session, org.id))

    async def test_an_unknown_filter_value_is_rejected_not_ignored(
        self, db_session, org, gear
    ):
        # Silently dropping an unrecognized filter exports the whole catalogue
        # under a filename saying otherwise, which is worse than an error.
        with pytest.raises(HTTPException) as exc:
            await _export(db_session, org.id, status="bogus")
        assert exc.value.status_code == 400


class TestEveryRowLeaves:
    """The export used to stop at ``limit=10000`` with nothing saying so."""

    async def test_rows_past_one_page_still_appear(self, db_session, org):
        category = await _category(db_session, org, "Bulk", ItemType.EQUIPMENT)
        for i in range(7):
            await _item(db_session, org, f"Item {i:02d}", category_id=category.id)

        # The page size is patched rather than seeded past: what is under test
        # is that the loop keeps asking, not the particular number it asks for.
        with patch.object(inventory_endpoints, "_EXPORT_PAGE_SIZE", 3):
            rows = await _export(db_session, org.id, sort_by="name")

        assert _names(rows) == [f"Item {i:02d}" for i in range(7)]

    async def test_a_count_that_lands_on_the_page_boundary_ends_cleanly(
        self, db_session, org
    ):
        category = await _category(db_session, org, "Bulk", ItemType.EQUIPMENT)
        for i in range(6):
            await _item(db_session, org, f"Item {i:02d}", category_id=category.id)

        # An exact multiple is where a paging loop either repeats its last page
        # or never terminates; neither raises, both corrupt the file.
        with patch.object(inventory_endpoints, "_EXPORT_PAGE_SIZE", 3):
            rows = await _export(db_session, org.id, sort_by="name")

        assert _names(rows) == [f"Item {i:02d}" for i in range(6)]

    async def test_an_empty_catalogue_still_gets_its_header(self, db_session, org):
        rows = await _export(db_session, org.id)
        assert rows == [inventory_endpoints._EXPORT_COLUMNS]


class TestFormulaInjection:
    async def test_a_formula_name_is_still_neutralized(self, db_session, org):
        # The streaming rewrite must not have quietly dropped SafeCsvWriter:
        # this cell executes on whatever officer opens the file (pitfall #15).
        await _item(db_session, org, "=cmd|'/C calc'!A0")

        rows = await _export(db_session, org.id)

        assert _names(rows) == ["'=cmd|'/C calc'!A0"]


class TestTheExportDoesNotCount:
    """``get_items`` COUNTs the whole filtered set and the export discards it.

    Harmless when the export stopped at one capped page; once the cap came off,
    it became one catalogue-wide count per 500 rows.
    """

    async def test_the_counting_entry_point_is_never_reached(self, db_session, org):
        category = await _category(db_session, org, "Bulk", ItemType.EQUIPMENT)
        for i in range(7):
            await _item(db_session, org, f"Item {i:02d}", category_id=category.id)

        # Patched to raise rather than asserted on afterwards: a call count
        # says the count happened, this says the export cannot be written to
        # depend on it. One coroutine, so pitfall #22 does not apply.
        with patch.object(
            InventoryService,
            "get_items",
            side_effect=AssertionError("the export must not run the COUNT path"),
        ):
            with patch.object(inventory_endpoints, "_EXPORT_PAGE_SIZE", 3):
                rows = await _export(db_session, org.id, sort_by="name")

        assert _names(rows) == [f"Item {i:02d}" for i in range(7)]
