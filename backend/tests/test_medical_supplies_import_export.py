"""
Medical Supplies import and export.

The medical page's CSV routes share the general inventory import's parser but
pin the domain: every imported row must land in a medical supply category,
because an uncategorized item is filed as gear and vanishes from the page that
imported it. These tests pin that, the auto-created categories, and that the
exports read only the medical domain.

Mocked service and session — no DB — except the final class, which runs the
lot export query against the database.
"""

import csv
import io
import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import medical_supplies as ms
from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    ItemType,
    TrackingType,
)
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

ORG = "org-1"
MEDICAL_CAT = "11111111-1111-1111-1111-111111111111"


def _user():
    user = MagicMock()
    user.id = "u-1"
    user.username = "supply"
    user.organization_id = ORG
    return user


def _upload(text: str, filename: str = "supplies.csv"):
    upload = MagicMock()
    upload.filename = filename
    upload.data = text.encode("utf-8")
    return upload


def _csv(*rows: list[str]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue()


async def _body(response) -> str:
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, str) else chunk.decode())
    return "".join(chunks)


def _service():
    svc = AsyncMock()

    async def get_categories(**kwargs):
        if kwargs.get("item_types"):
            return [SimpleNamespace(id=MEDICAL_CAT, name="Airway")]
        if kwargs.get("exclude_item_types"):
            return [SimpleNamespace(id="gear-cat", name="Turnout Gear")]
        return []

    svc.get_categories = AsyncMock(side_effect=get_categories)
    svc.list_vendors = AsyncMock(
        return_value=[SimpleNamespace(id="v-1", name="MedSupply Co")]
    )
    svc.category_in_domain = AsyncMock(
        side_effect=lambda cid, org, types: str(cid) == MEDICAL_CAT
    )
    svc.create_item = AsyncMock(
        side_effect=lambda **kw: (
            SimpleNamespace(id="i-new", name=kw["item_data"]["name"]),
            None,
        )
    )
    svc.pool_item_ids_by_name = AsyncMock(return_value={"gauze pads 4x4": "i-old"})
    svc.item_ids_kept_in_stock = AsyncMock(return_value=["i-old"])
    svc.add_lot = AsyncMock(side_effect=lambda **kw: SimpleNamespace(id="lot-1"))
    svc.create_category = AsyncMock(
        side_effect=lambda **kw: (
            SimpleNamespace(id="c-new", name=kw["category_data"]["name"]),
            None,
        )
    )
    return svc


@pytest.fixture
def svc():
    service = _service()

    async def read_limited(upload, _max):
        return upload.data

    with patch.object(ms, "InventoryService", return_value=service), patch.object(
        ms, "log_audit_event", new=AsyncMock()
    ) as audit, patch.object(ms, "reject_if_malicious", new=AsyncMock()), patch.object(
        ms, "read_upload_limited", new=read_limited
    ):
        service.audit = audit
        yield service


async def _import(text: str, filename: str = "supplies.csv"):
    return await ms.import_medical_items_csv(
        file=_upload(text, filename), db=AsyncMock(), current_user=_user()
    )


@pytest.mark.unit
class TestMedicalImport:
    async def test_a_row_in_a_medical_category_is_created_there(self, svc):
        result = await _import(
            _csv(
                ["Name", "Category", "Quantity", "Tracking Type"],
                ["Nasal Cannula", "airway", "10", "pool"],
            )
        )

        assert result["imported"] == 1
        assert result["categories_created"] == []
        stored = svc.create_item.await_args.kwargs["item_data"]
        assert stored["category_id"] == MEDICAL_CAT
        assert stored["quantity"] == 10
        svc.create_category.assert_not_awaited()

    async def test_an_unknown_category_is_created_as_medical_once(self, svc):
        """Two rows naming one new category create it once, filed medical."""
        result = await _import(
            _csv(
                ["Name", "Category", "Quantity"],
                ["Tourniquet", "Trauma", "6"],
                ["Trauma Shears", "TRAUMA", "4"],
            )
        )

        assert result["imported"] == 2
        assert result["categories_created"] == ["Trauma"]
        assert svc.create_category.await_count == 1
        data = svc.create_category.await_args.kwargs["category_data"]
        assert data["item_type"] == "medical"
        assert data["name"] == "Trauma"
        ids = {
            call.kwargs["item_data"]["category_id"]
            for call in svc.create_item.await_args_list
        }
        assert ids == {"c-new"}
        assert "Created 1 new medical supply category" in result["warnings"][0]

    async def test_a_row_without_a_category_is_refused(self, svc):
        """An uncategorized item would be filed as gear."""
        result = await _import(
            _csv(["Name", "Category", "Quantity"], ["Gauze", "", "5"])
        )

        assert result["imported"] == 0
        assert result["failed"] == 1
        assert "Category is required" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()

    async def test_a_gear_category_name_is_refused_not_duplicated(self, svc):
        result = await _import(
            _csv(["Name", "Category", "Quantity"], ["Gloves", "Turnout Gear", "5"])
        )

        assert result["failed"] == 1
        assert "gear and uniforms" in result["errors"][0]["error"]
        svc.create_category.assert_not_awaited()
        svc.create_item.assert_not_awaited()

    async def test_a_non_medical_item_type_is_refused(self, svc):
        result = await _import(
            _csv(
                ["Name", "Category", "Item Type", "Quantity"],
                ["Radio", "Airway", "electronics", "1"],
            )
        )

        assert result["failed"] == 1
        assert "not medical" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()

    async def test_reorder_point_and_unit_are_read(self, svc):
        await _import(
            _csv(
                ["Name", "Category", "Quantity", "Reorder Point", "Unit of Measure"],
                ["Gauze", "Airway", "50", "10", "box"],
            )
        )

        stored = svc.create_item.await_args.kwargs["item_data"]
        assert stored["reorder_point"] == 10
        assert stored["unit_of_measure"] == "box"

    async def test_a_negative_reorder_point_fails_the_row(self, svc):
        result = await _import(
            _csv(
                ["Name", "Category", "Quantity", "Reorder Point"],
                ["Gauze", "Airway", "50", "-1"],
            )
        )

        assert result["failed"] == 1
        assert "negative" in result["errors"][0]["error"]

    async def test_a_failing_row_does_not_leave_a_new_category_behind(self, svc):
        """A pool row with no stock is refused before its category is made."""
        result = await _import(
            _csv(
                ["Name", "Category", "Tracking Type", "Quantity"],
                ["Gauze", "Brand New", "pool", "0"],
            )
        )

        assert result["failed"] == 1
        svc.create_category.assert_not_awaited()

    async def test_a_known_vendor_is_linked(self, svc):
        await _import(
            _csv(
                ["Name", "Category", "Quantity", "Vendor"],
                ["Gauze", "Airway", "5", "medsupply co"],
            )
        )

        assert svc.create_item.await_args.kwargs["item_data"]["vendor_id"] == "v-1"

    async def test_a_service_error_is_reported_per_row(self, svc):
        svc.create_item = AsyncMock(return_value=(None, "Duplicate serial number"))

        result = await _import(
            _csv(["Name", "Category", "Quantity"], ["Monitor", "Airway", "1"])
        )

        assert result["failed"] == 1
        assert result["errors"][0] == {"row": 2, "error": "Duplicate serial number"}

    async def test_a_successful_import_is_audited(self, svc):
        await _import(_csv(["Name", "Category", "Quantity"], ["Gauze", "Airway", "5"]))

        kwargs = svc.audit.await_args.kwargs
        assert kwargs["event_type"] == "medical_items_imported"
        assert kwargs["event_data"]["imported"] == 1

    async def test_a_file_without_a_category_column_is_refused(self, svc):
        with pytest.raises(HTTPException) as err:
            await _import(_csv(["Name", "Quantity"], ["Gauze", "5"]))
        assert err.value.status_code == 400
        assert "Category" in err.value.detail

    async def test_a_non_csv_file_is_refused(self, svc):
        with pytest.raises(HTTPException) as err:
            await _import(_csv(["Name"], ["Gauze"]), filename="supplies.xlsx")
        assert err.value.status_code == 400


LOT_HEADER = ["Name", "Category", "Quantity", "Lot Number", "Expiration Date"]


@pytest.mark.unit
class TestMedicalLotImport:
    async def test_a_new_supply_gets_its_first_lot(self, svc):
        result = await _import(
            _csv(LOT_HEADER, ["Tourniquet", "Airway", "6", "TQ-1", "2029-05-31"])
        )

        assert result["imported"] == 1
        assert result["lots_added"] == 1
        stored = svc.create_item.await_args.kwargs["item_data"]
        assert stored["tracking_type"] == "pool"
        # The count lives in the lot. Left in the column, add_lot would carry
        # it forward into a second, undated lot and double the stock.
        assert stored["quantity"] == 0
        lot = svc.add_lot.await_args.kwargs
        assert lot["item_id"] == "i-new"
        assert lot["required_item_types"] == MEDICAL_ITEM_TYPES
        assert lot["data"] == {
            "quantity": 6,
            "lot_number": "TQ-1",
            "expiration_date": date(2029, 5, 31),
        }

    async def test_a_name_on_file_adds_a_lot_and_changes_nothing_else(self, svc):
        """Matched through normalize_name, and no category is needed."""
        result = await _import(
            _csv(LOT_HEADER, ["Gauze Pads, 4x4", "", "40", "GZ-9", "2028-01-31"])
        )

        assert result == {
            "imported": 0,
            "lots_added": 1,
            "failed": 0,
            "total_rows": 1,
            "categories_created": [],
            "errors": [],
            "warnings": [],
        }
        svc.create_item.assert_not_awaited()
        assert svc.add_lot.await_args.kwargs["item_id"] == "i-old"
        assert svc.add_lot.await_args.kwargs["data"]["quantity"] == 40

    async def test_naming_a_new_supply_twice_records_two_lots_on_one(self, svc):
        result = await _import(
            _csv(
                LOT_HEADER,
                ["Trauma Dressing", "Airway", "6", "TD-1", "2028-01-31"],
                ["Trauma Dressing", "Airway", "4", "TD-2", "2029-01-31"],
            )
        )

        assert result["imported"] == 1
        assert result["lots_added"] == 2
        assert svc.create_item.await_count == 1
        assert [c.kwargs["item_id"] for c in svc.add_lot.await_args_list] == [
            "i-new",
            "i-new",
        ]

    async def test_a_received_date_alone_is_lot_data(self, svc):
        await _import(
            _csv(
                ["Name", "Category", "Quantity", "Received Date"],
                ["Gauze Pads 4x4", "Airway", "10", "2026-10-01"],
            )
        )

        assert svc.add_lot.await_args.kwargs["data"] == {
            "quantity": 10,
            "received_date": date(2026, 10, 1),
        }

    async def test_a_non_iso_date_fails_the_row(self, svc):
        """03/04/2027 is a different day in different locales."""
        result = await _import(
            _csv(LOT_HEADER, ["Tourniquet", "Airway", "6", "TQ-1", "03/04/2027"])
        )

        assert result["failed"] == 1
        assert "YYYY-MM-DD" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()
        svc.add_lot.assert_not_awaited()

    async def test_a_lot_row_needs_a_quantity(self, svc):
        result = await _import(
            _csv(LOT_HEADER, ["Gauze Pads 4x4", "Airway", "", "GZ-1", "2028-01-31"])
        )

        assert result["failed"] == 1
        assert "Quantity of 1 or more" in result["errors"][0]["error"]
        svc.add_lot.assert_not_awaited()

    async def test_an_individual_row_with_a_lot_is_refused(self, svc):
        result = await _import(
            _csv(
                LOT_HEADER + ["Tracking Type"],
                ["Monitor", "Airway", "1", "M-1", "2028-01-31", "individual"],
            )
        )

        assert result["failed"] == 1
        assert "pool-tracked" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()

    async def test_a_lot_that_cannot_be_added_is_reported(self, svc):
        svc.add_lot = AsyncMock(return_value=None)

        result = await _import(
            _csv(LOT_HEADER, ["Gauze Pads 4x4", "", "5", "GZ-1", "2028-01-31"])
        )

        assert result["lots_added"] == 0
        assert result["failed"] == 1

    async def test_lots_added_is_audited(self, svc):
        await _import(_csv(LOT_HEADER, ["Gauze Pads 4x4", "", "5", "GZ-1", ""]))

        assert svc.audit.await_args.kwargs["event_data"]["lots_added"] == 1


@pytest.mark.unit
class TestKeptOnApparatusOnlyColumn:
    """A supply with no stock room (a LUCAS device) round-trips through the
    file, and the import refuses to give it stock lots."""

    async def test_yes_marks_the_supply_and_allows_a_zero_count(self, svc):
        result = await _import(
            _csv(
                [
                    "Name",
                    "Category",
                    "Quantity",
                    "Tracking Type",
                    "Kept on Apparatus Only",
                ],
                ["LUCAS device", "Airway", "0", "pool", "Yes"],
            )
        )

        assert result["imported"] == 1
        assert result["errors"] == []
        stored = svc.create_item.await_args.kwargs["item_data"]
        assert stored["apparatus_only"] is True
        assert stored["quantity"] == 0

    @pytest.mark.parametrize("value", ["no", "N", "false", "0"])
    async def test_no_keeps_it_in_stock(self, svc, value):
        await _import(
            _csv(
                ["Name", "Category", "Quantity", "Kept on Apparatus Only"],
                ["Gauze", "Airway", "5", value],
            )
        )

        assert svc.create_item.await_args.kwargs["item_data"]["apparatus_only"] is False

    async def test_a_blank_leaves_it_unset(self, svc):
        await _import(
            _csv(
                ["Name", "Category", "Quantity", "Kept on Apparatus Only"],
                ["Gauze", "Airway", "5", ""],
            )
        )

        assert "apparatus_only" not in svc.create_item.await_args.kwargs["item_data"]

    async def test_another_value_fails_the_row(self, svc):
        result = await _import(
            _csv(
                ["Name", "Category", "Quantity", "Kept on Apparatus Only"],
                ["LUCAS device", "Airway", "1", "maybe"],
            )
        )

        assert result["failed"] == 1
        assert "must be Yes or No" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()

    async def test_a_row_marked_yes_may_not_carry_a_lot(self, svc):
        result = await _import(
            _csv(
                LOT_HEADER + ["Kept on Apparatus Only"],
                ["LUCAS device", "Airway", "1", "LC-1", "2029-01-31", "Yes"],
            )
        )

        assert result["failed"] == 1
        assert "has no stock lots" in result["errors"][0]["error"]
        svc.create_item.assert_not_awaited()
        svc.add_lot.assert_not_awaited()

    async def test_a_lot_row_may_not_name_a_supply_kept_on_the_apparatus(self, svc):
        svc.item_ids_kept_in_stock = AsyncMock(return_value=[])

        result = await _import(
            _csv(LOT_HEADER, ["Gauze Pads, 4x4", "", "40", "GZ-9", "2028-01-31"])
        )

        assert result["failed"] == 1
        assert "kept on the apparatus only" in result["errors"][0]["error"]
        svc.add_lot.assert_not_awaited()

    def test_the_export_says_yes(self):
        item = SimpleNamespace(
            name="LUCAS device",
            category=None,
            also_called=None,
            description=None,
            size=None,
            unit_of_measure=None,
            tracking_type=TrackingType.POOL,
            quantity=0,
            reorder_point=None,
            apparatus_only=True,
            status=SimpleNamespace(value="available"),
            condition=SimpleNamespace(value="good"),
            manufacturer=None,
            model_number=None,
            serial_number=None,
            asset_tag=None,
            barcode=None,
            storage_location=None,
            station=None,
            vendor=None,
            purchase_date=None,
            purchase_price=None,
            notes=None,
        )

        record = dict(zip(ms._MEDICAL_EXPORT_COLUMNS, ms._medical_export_row(item)))

        assert record["Kept on Apparatus Only"] == "Yes"

    def test_the_template_offers_the_column(self):
        assert "Kept on Apparatus Only" in ms._MEDICAL_TEMPLATE_HEADER


@pytest.mark.unit
class TestMedicalExports:
    async def test_the_items_export_is_pinned_to_the_medical_domain(self, svc):
        item = SimpleNamespace(
            name="=HYPERLINK(1)",
            category=SimpleNamespace(name="Airway"),
            also_called=["BVM", "Ambu bag"],
            description="Adult BVM",
            size="Adult",
            unit_of_measure="each",
            tracking_type=TrackingType.POOL,
            quantity=2,
            is_lot_stocked=True,
            lot_stock=7,
            reorder_point=1,
            apparatus_only=False,
            status=SimpleNamespace(value="available"),
            condition=SimpleNamespace(value="good"),
            manufacturer=None,
            model_number=None,
            serial_number=None,
            asset_tag=None,
            barcode="MED-1",
            storage_location="Airway Bag",
            station=None,
            vendor="Free text vendor",
            purchase_date=None,
            purchase_price=None,
            notes=None,
        )
        svc.get_items_page = AsyncMock(return_value=[item])

        class _Session:
            async def __aenter__(self):
                return AsyncMock()

            async def __aexit__(self, *exc):
                return False

        with patch.object(ms, "async_session_factory", return_value=_Session()):
            response = await ms.export_medical_items_csv(
                category_id=None,
                status_filter=None,
                condition=None,
                location_id=None,
                storage_area_id=None,
                search=None,
                active_only=True,
                sort_by=None,
                sort_order=None,
                db=AsyncMock(),
                current_user=_user(),
            )
            text = await _body(response)

        assert svc.get_items_page.await_args.kwargs["item_types"] == MEDICAL_ITEM_TYPES
        rows = list(csv.reader(io.StringIO(text)))
        assert rows[0] == ms._MEDICAL_EXPORT_COLUMNS
        record = dict(zip(rows[0], rows[1]))
        assert record["Also Called"] == "BVM; Ambu bag"
        assert record["Ready Lot Stock"] == "7"
        assert record["Reorder Point"] == "1"
        assert record["Kept on Apparatus Only"] == "No"
        # SafeCsvWriter neutralizes a formula-looking cell.
        assert not record["Name"].startswith("=")

    async def test_the_items_export_refuses_a_gear_category_filter(self, svc):
        with pytest.raises(HTTPException) as err:
            await ms.export_medical_items_csv(
                category_id="22222222-2222-2222-2222-222222222222",
                status_filter=None,
                condition=None,
                location_id=None,
                storage_area_id=None,
                search=None,
                active_only=True,
                sort_by=None,
                sort_order=None,
                db=AsyncMock(),
                current_user=_user(),
            )
        assert err.value.status_code == 404

    async def test_the_lot_export_counts_days_from_the_department_date(self, svc):
        today = date(2026, 10, 15)
        lot = SimpleNamespace(
            lot_number="L-1",
            expiration_date=date(2026, 10, 20),
            quantity=4,
            received_date=None,
            storage_location=None,
            unit_cost=None,
            notes=None,
        )
        svc.get_lots_for_export = AsyncMock(return_value=[(lot, "Gauze", "Airway")])

        with patch.object(ms, "resolve_org_today", AsyncMock(return_value=today)):
            response = await ms.export_medical_lots_csv(
                db=AsyncMock(), current_user=_user()
            )
            text = await _body(response)

        assert svc.get_lots_for_export.await_args.args == (ORG, MEDICAL_ITEM_TYPES)
        rows = list(csv.reader(io.StringIO(text)))
        record = dict(zip(rows[0], rows[1]))
        assert record["Item"] == "Gauze"
        assert record["Days Until Expiration"] == "5"
        assert record["Quantity"] == "4"

    async def test_the_template_carries_only_medical_rows(self):
        response = await ms.download_medical_import_template(current_user=_user())
        rows = list(csv.reader(io.StringIO(await _body(response))))

        assert rows[0] == ms._MEDICAL_TEMPLATE_HEADER
        names = {row[0] for row in rows[1:]}
        assert "Nitrile Gloves (Box)" in names
        assert "Motorola APX 8000" not in names
        assert all(row[1] for row in rows[1:]), "every sample row names a category"
        lots = [
            dict(zip(rows[0], row))
            for row in rows[1:]
            if row[0] == "Gauze Pads, 4x4 Sterile"
        ]
        # Named twice: the second row shows how to add another lot.
        assert [lot["Lot Number"] for lot in lots] == ["GZ-24117", "GZ-25002"]

    def test_an_export_is_importable_column_for_column(self):
        """Every exported column but the two derived ones is read on import."""
        assert set(ms._MEDICAL_TEMPLATE_HEADER) == (
            set(ms._MEDICAL_EXPORT_COLUMNS) - {"Ready Lot Stock", "Barcode"}
        ) | set(ms._LOT_IMPORT_COLUMNS)


@pytest.mark.integration
class TestLotExportQuery:
    async def _setup(self, db):
        org = Organization(name="Lot FD", slug=f"lot-{uuid.uuid4().hex[:8]}")
        db.add(org)
        await db.flush()
        categories = {}
        for item_type in (ItemType.MEDICAL, ItemType.EQUIPMENT):
            category = InventoryCategory(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                name=f"{item_type.value}-{uuid.uuid4().hex[:6]}",
                item_type=item_type,
            )
            db.add(category)
            categories[item_type] = category
        await db.flush()
        return org, categories

    async def _item(self, db, org, category, name, active=True):
        item = InventoryItem(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            category_id=category.id,
            name=name,
            tracking_type=TrackingType.POOL,
            quantity=1,
            active=active,
        )
        db.add(item)
        await db.flush()
        return item

    async def _lot(self, db, org, item, quantity, expires):
        lot = InventoryLot(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            inventory_item_id=item.id,
            quantity=quantity,
            expiration_date=expires,
        )
        db.add(lot)
        await db.flush()
        return lot

    async def test_only_stocked_medical_lots_soonest_first(self, db_session):
        org, cats = await self._setup(db_session)
        gauze = await self._item(db_session, org, cats[ItemType.MEDICAL], "Gauze")
        retired = await self._item(
            db_session, org, cats[ItemType.MEDICAL], "Old", active=False
        )
        rope = await self._item(db_session, org, cats[ItemType.EQUIPMENT], "Rope")
        soon = date.today() + timedelta(days=5)
        later = date.today() + timedelta(days=50)

        undated = await self._lot(db_session, org, gauze, 3, None)
        late = await self._lot(db_session, org, gauze, 2, later)
        early = await self._lot(db_session, org, gauze, 1, soon)
        await self._lot(db_session, org, gauze, 0, soon)
        await self._lot(db_session, org, retired, 5, soon)
        await self._lot(db_session, org, rope, 5, soon)

        rows = await InventoryService(db_session).get_lots_for_export(
            str(org.id), MEDICAL_ITEM_TYPES
        )

        assert [row[0].id for row in rows] == [early.id, late.id, undated.id]
        assert {row[1] for row in rows} == {"Gauze"}
        assert {row[2] for row in rows} == {cats[ItemType.MEDICAL].name}

    async def test_pool_names_are_medical_pool_rows_only(self, db_session):
        org, cats = await self._setup(db_session)
        gauze = await self._item(
            db_session, org, cats[ItemType.MEDICAL], "Gauze Pads, 4x4"
        )
        await self._item(
            db_session, org, cats[ItemType.MEDICAL], "Retired Gauze", active=False
        )
        await self._item(db_session, org, cats[ItemType.EQUIPMENT], "Rope")
        monitor = await self._item(db_session, org, cats[ItemType.MEDICAL], "Monitor")
        monitor.tracking_type = TrackingType.INDIVIDUAL
        await db_session.flush()

        by_name = await InventoryService(db_session).pool_item_ids_by_name(
            str(org.id), MEDICAL_ITEM_TYPES
        )

        assert by_name == {"gauze pads 4x4": gauze.id}

    async def test_an_imported_lot_is_the_only_stock(self, db_session):
        """The row's Quantity becomes one lot — never a lot plus an opening
        balance carried forward from the column."""
        org, cats = await self._setup(db_session)
        existing = await self._item(
            db_session, org, cats[ItemType.MEDICAL], "Gauze Pads, 4x4"
        )
        user = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"supply-{uuid.uuid4().hex[:8]}",
            email=f"{uuid.uuid4().hex[:8]}@example.test",
            first_name="Pat",
            last_name="Quinn",
            password_hash="x",
        )
        db_session.add(user)
        await db_session.flush()
        text = _csv(
            ["Name", "Category", "Quantity", "Lot Number", "Expiration Date"],
            ["Tourniquet", cats[ItemType.MEDICAL].name, "6", "TQ-1", "2029-05-31"],
            ["Tourniquet", "", "4", "TQ-2", "2030-05-31"],
            ["gauze pads 4x4", "", "20", "GZ-1", "2028-01-31"],
        )

        async def read_limited(upload, _max):
            return upload.data

        with patch.object(ms, "reject_if_malicious", new=AsyncMock()), patch.object(
            ms, "read_upload_limited", new=read_limited
        ), patch.object(ms, "log_audit_event", new=AsyncMock()):
            result = await ms.import_medical_items_csv(
                file=_upload(text), db=db_session, current_user=user
            )

        assert result["imported"] == 1, result
        assert result["lots_added"] == 3, result
        lots = (
            await db_session.execute(
                select(InventoryLot, InventoryItem.name)
                .join(InventoryItem, InventoryItem.id == InventoryLot.inventory_item_id)
                .where(InventoryLot.organization_id == org.id)
            )
        ).all()
        by_item: dict[str, list[int]] = {}
        for lot, name in lots:
            by_item.setdefault(name, []).append(lot.quantity)
        assert sorted(by_item["Tourniquet"]) == [4, 6]
        # The existing item's column count (1) is carried into an opening
        # balance, as a first delivery always does; the imported 20 is not.
        assert sorted(by_item[existing.name]) == [1, 20]
