"""The sample CSV a department downloads before uploading its own data.

A template is only worth shipping if it survives the import it teaches. Every
row here is run through the import's own validation, and the whole file is fed
back through the real import endpoint, so a rename in the import (a column, a
valid value) cannot quietly leave the sample producing row errors.

Two properties of the import shape what the sample can promise, and are pinned
here so the sample never overstates them:

* The "Category" cell is a NAME matched against categories the department has
  already created. An unmatched name imports the row with no category, and an
  uncategorized item reads as gear, not medical.
* "Item Type" is validated and then ignored: an item's type comes from its
  category. "medical" is a legal value so a department that writes it is not
  rejected.
"""

import io
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.datastructures import UploadFile

from app.api.v1.endpoints import inventory as inventory_endpoints
from app.api.v1.endpoints.inventory import (
    _IMPORT_TEMPLATE_HEADER,
    _IMPORT_TEMPLATE_ROWS,
    _coerce_csv_row,
    download_import_template,
    import_items_csv,
)
from app.models.inventory import MEDICAL_ITEM_TYPES
from app.services.inventory_service import InventoryService

# Generic names the medical sample rows use. A department renames them in the
# file to match its own categories.
MEDICAL_CATEGORIES = {
    "Airway & Breathing",
    "Bleeding Control & Trauma",
    "Dressings & Bandages",
    "Diagnostics",
    "Infection Control",
}
GEAR_CATEGORIES = {"Portable Radios"}


def _as_row(row):
    return {column: row.get(column, "") for column in _IMPORT_TEMPLATE_HEADER}


def _medical_rows():
    return [r for r in _IMPORT_TEMPLATE_ROWS if r.get("Item Type") == "medical"]


@pytest.mark.unit
class TestTemplateShape:
    def test_every_cell_belongs_to_a_known_column(self):
        for row in _IMPORT_TEMPLATE_ROWS:
            assert set(row) <= set(_IMPORT_TEMPLATE_HEADER), row["Name"]

    @pytest.mark.parametrize("row", _IMPORT_TEMPLATE_ROWS, ids=lambda r: r["Name"])
    def test_each_row_passes_the_imports_own_validation(self, row):
        _item, _category, errors, fatal = _coerce_csv_row(_as_row(row), 2)

        assert errors == []
        assert fatal is False

    def test_names_are_unique(self):
        names = [r["Name"] for r in _IMPORT_TEMPLATE_ROWS]
        assert len(names) == len(set(names))

    def test_serial_numbers_and_asset_tags_are_unique(self):
        # A duplicate serial number is refused by the import, so a sample that
        # repeated one would fail on its own second row.
        for column in ("Serial Number", "Asset Tag"):
            values = [r[column] for r in _IMPORT_TEMPLATE_ROWS if r.get(column)]
            assert len(values) == len(set(values)), column

    def test_counted_rows_carry_a_quantity_and_individual_rows_exactly_one(self):
        for row in _IMPORT_TEMPLATE_ROWS:
            quantity = int(row["Quantity"])
            if row["Tracking Type"] == "pool":
                assert quantity >= 1, row["Name"]
            else:
                assert quantity == 1, row["Name"]

    def test_medical_rows_only_use_the_documented_generic_categories(self):
        assert {r["Category"] for r in _medical_rows()} <= MEDICAL_CATEGORIES
        assert {r["Category"] for r in _IMPORT_TEMPLATE_ROWS} <= (
            MEDICAL_CATEGORIES | GEAR_CATEGORIES
        )

    def test_the_sample_covers_every_generic_medical_category(self):
        assert {r["Category"] for r in _medical_rows()} == MEDICAL_CATEGORIES

    def test_it_stays_a_sample_with_a_gear_row_beside_the_medical_ones(self):
        assert any(r["Category"] in GEAR_CATEGORIES for r in _IMPORT_TEMPLATE_ROWS)
        assert len(_medical_rows()) >= 10

    def test_medical_is_an_accepted_item_type(self):
        # A department uploading medical stock writes "medical" in this column.
        row = dict(_as_row(_medical_rows()[0]), **{"Item Type": "medical"})
        _item, _category, errors, fatal = _coerce_csv_row(row, 2)
        assert errors == []
        assert fatal is False

    def test_an_unknown_item_type_is_still_refused(self):
        row = dict(_as_row(_medical_rows()[0]), **{"Item Type": "pharmaceutical"})
        _item, _category, errors, fatal = _coerce_csv_row(row, 2)
        assert fatal is True
        assert "Invalid item type" in errors[0]["error"]


def _user(org_id, user_id):
    user = MagicMock()
    user.id = user_id
    user.organization_id = org_id
    user.username = "admin"
    return user


async def _template_csv(user) -> bytes:
    response = await download_import_template(current_user=user)
    chunks = [chunk async for chunk in response.body_iterator]
    return "".join(c.decode() if isinstance(c, bytes) else c for c in chunks).encode()


async def _import(db, user, data: bytes):
    upload = UploadFile(file=io.BytesIO(data), filename="inventory.csv")
    return await import_items_csv(file=upload, db=db, current_user=user)


@pytest.fixture(autouse=True)
def _no_websocket_publish(monkeypatch):
    monkeypatch.setattr(inventory_endpoints, "_publish_inventory_event", AsyncMock())


@pytest.mark.integration
class TestTemplateThroughTheRealImport:
    async def test_the_downloaded_file_is_the_template_rows(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        data = await _template_csv(_user(org_id, admin_id))

        lines = data.decode().strip().splitlines()
        assert lines[0].split(",")[0] == "Name"
        assert len(lines) == 1 + len(_IMPORT_TEMPLATE_ROWS)

    async def test_it_imports_cleanly_into_a_department_with_matching_categories(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        service = InventoryService(db_session)
        for name in sorted(MEDICAL_CATEGORIES):
            _cat, error = await service.create_category(
                org_id, {"name": name, "item_type": "medical"}, admin_id
            )
            assert error is None
        _cat, error = await service.create_category(
            org_id, {"name": "Portable Radios", "item_type": "electronics"}, admin_id
        )
        assert error is None
        user = _user(org_id, admin_id)

        result = await _import(db_session, user, await _template_csv(user))

        assert result["failed"] == 0
        assert result["errors"] == []
        assert result["imported"] == len(_IMPORT_TEMPLATE_ROWS)
        # Every category matched. The one warning left is the sample's two
        # fictional vendors, which a new department does not have on file.
        assert [w for w in result["warnings"] if "Category" in w] == []
        assert all("vendor name" in w for w in result["warnings"])

        # The point of using the right category names: the supplies land on the
        # medical page, and only the radio is gear.
        _items, medical_total = await service.get_items(
            organization_id=org_id, item_types=MEDICAL_ITEM_TYPES
        )
        _items, gear_total = await service.get_items(
            organization_id=org_id, exclude_item_types=MEDICAL_ITEM_TYPES
        )
        assert medical_total == len(_medical_rows())
        assert gear_total == len(_IMPORT_TEMPLATE_ROWS) - len(_medical_rows())

    async def test_without_matching_categories_rows_import_uncategorized_with_a_warning(
        self, db_session, setup_org_and_admin
    ):
        # What a department sees if it has not created categories with these
        # names: the import still succeeds, says so per row, and the supplies
        # are not on the medical page until they are categorized.
        org_id, admin_id = setup_org_and_admin
        user = _user(org_id, admin_id)

        result = await _import(db_session, user, await _template_csv(user))

        assert result["failed"] == 0
        assert result["imported"] == len(_IMPORT_TEMPLATE_ROWS)
        unmatched = [w for w in result["warnings"] if "Category" in w]
        assert len(unmatched) == len(_IMPORT_TEMPLATE_ROWS)
        assert all("not found" in w for w in unmatched)

        service = InventoryService(db_session)
        _items, medical_total = await service.get_items(
            organization_id=org_id, item_types=MEDICAL_ITEM_TYPES
        )
        assert medical_total == 0

    async def test_importing_the_sample_twice_is_refused_on_serial_numbers_not_silently_doubled(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        user = _user(org_id, admin_id)
        data = await _template_csv(user)

        await _import(db_session, user, data)
        second = await _import(db_session, user, data)

        # The two individually tracked rows carry serial numbers, and the
        # import refuses a duplicate; the counted supplies carry none.
        assert second["failed"] == 2
