"""
Numeric request fields must fit the column they are stored in.

A field typed ``int`` / ``Decimal`` / ``float`` with no upper bound passes
validation for a value its column cannot hold, and then fails at flush as MySQL
error 1264, which an endpoint can only report as "An unexpected error
occurred". Two guards:

  - ``TestEveryNumericRequestFieldIsBounded`` builds the OpenAPI document for
    the inventory-backed routers and fails on any numeric field a request body
    can reach that lacks a bound on either side, so a field added later cannot
    quietly bring the problem back.
  - ``TestBoundsMatchTheColumn`` ties each bounded field to the column it is
    stored in, so a bound that is present but wrong (too loose, or copied from
    the wrong type) fails too.
"""

from decimal import Decimal
from typing import Annotated, Any, Dict, List, Tuple

import pytest
from fastapi import FastAPI
from pydantic import BaseModel, TypeAdapter, ValidationError
from sqlalchemy import Float, Integer, Numeric

from app.api.v1.endpoints import (
    equipment_check,
    inventory,
    inventory_kiosk,
    inventory_last_seen,
    inventory_nfc,
    medical_supplies,
)
from app.models.apparatus import (
    CheckItemDeployedLot,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.inventory import (
    EquipmentKit,
    EquipmentKitItem,
    EquipmentRequest,
    InventoryCategory,
    InventoryItem,
    InventoryLot,
    IssuanceAllowance,
    ItemIssuance,
    ItemVariantGroup,
    MaintenanceRecord,
    NFPAInspectionDetail,
    ReorderReceipt,
    ReorderRequest,
    ReturnRequest,
    StorageArea,
)
from app.models.training import ShiftEquipmentCheckItem, ShiftEquipmentCheckSeal
from app.schemas import equipment_check as ec_schemas
from app.schemas import inventory as inv_schemas

pytestmark = pytest.mark.unit


# ============================================
# OpenAPI sweep
# ============================================

# Router prefixes as mounted in app/api/v1/api.py; the document is built from
# these routers alone because the whole API takes ~30s, over the per-test limit.
_ROUTERS = (
    (inventory, "/inventory"),
    (inventory_kiosk, "/inventory"),
    (inventory_last_seen, "/inventory"),
    (inventory_nfc, "/inventory"),
    (medical_supplies, "/medical-supplies"),
    (equipment_check, "/equipment-checks"),
)


def _numeric_variants(prop: Dict[str, Any]):
    """The integer/number branches of a property, looking through Optional,
    Decimal's number-or-string union, and arrays of numbers."""
    for variant in prop.get("anyOf", [prop]):
        if variant.get("type") in ("integer", "number"):
            yield variant
        elif variant.get("type") == "array" and isinstance(variant.get("items"), dict):
            yield from _numeric_variants(variant["items"])


def unbounded_numeric_fields(spec: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    """(schema, field, "below"/"above"/"both") for each request-body number
    that has no bound on a side."""
    schemas = spec["components"]["schemas"]

    reachable: Dict[str, str] = {}

    def walk(node: Any, origin: str) -> None:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].rsplit("/", 1)[-1]
                if name not in reachable:
                    reachable[name] = origin
                    walk(schemas[name], origin)
            for value in node.values():
                walk(value, origin)
        elif isinstance(node, list):
            for value in node:
                walk(value, origin)

    for path, operations in spec["paths"].items():
        for method, operation in operations.items():
            if "requestBody" in operation:
                walk(operation["requestBody"], f"{method.upper()} {path}")

    found = []
    for name in sorted(reachable):
        for field, prop in schemas[name].get("properties", {}).items():
            for variant in _numeric_variants(prop):
                has_low = "minimum" in variant or "exclusiveMinimum" in variant
                has_high = "maximum" in variant or "exclusiveMaximum" in variant
                if not (has_low and has_high):
                    side = (
                        "both"
                        if not (has_low or has_high)
                        else ("below" if not has_low else "above")
                    )
                    found.append((name, field, side))
    return found


@pytest.fixture(scope="module")
def inventory_spec() -> Dict[str, Any]:
    app = FastAPI()
    for module, prefix in _ROUTERS:
        app.include_router(module.router, prefix=prefix)
    return app.openapi()


class TestEveryNumericRequestFieldIsBounded:
    def test_no_request_field_is_left_unbounded(self, inventory_spec):
        found = unbounded_numeric_fields(inventory_spec)
        assert not found, (
            "These request fields accept a number their column cannot hold. "
            "Give each a ge/le matching its column (see app/schemas/"
            "column_bounds.py), then add it to BOUNDED_FIELDS below:\n"
            + "\n".join(f"  {n}.{f} (no bound {s})" for n, f, s in found)
        )

    def test_the_sweep_detects_an_unbounded_field(self):
        """Guards the guard: a sweep that finds nothing proves nothing."""

        class Loose(BaseModel):
            count: int
            ratio: float = 1.0

        app = FastAPI()

        @app.post("/loose")
        def post_loose(body: Loose):  # pragma: no cover - never called
            return body

        assert {(n, f) for n, f, _ in unbounded_numeric_fields(app.openapi())} == {
            ("Loose", "count"),
            ("Loose", "ratio"),
        }

    def test_the_sweep_looks_through_optional_and_decimal(self):
        class Wrapped(BaseModel):
            maybe: int | None = None
            money: Decimal = Decimal(0)
            many: List[int] = []

        app = FastAPI()

        @app.post("/wrapped")
        def post_wrapped(body: Wrapped):  # pragma: no cover - never called
            return body

        flagged = {f for _, f, _ in unbounded_numeric_fields(app.openapi())}
        assert {"maybe", "money", "many"} <= flagged

    def test_the_inventory_routers_are_actually_swept(self, inventory_spec):
        paths = inventory_spec["paths"]
        assert "/inventory/items" in paths
        assert any(p.startswith("/equipment-checks/") for p in paths)


# ============================================
# Bounds match the column
# ============================================

I, E = inv_schemas, ec_schemas

# (schema, field, model, column). Add a row here for every field the sweep
# above would otherwise flag, so its bound is checked against the real column.
BOUNDED_FIELDS = [
    *[
        (schema, field, InventoryItem, field)
        for schema in (I.InventoryItemBase, I.InventoryItemUpdate)
        for field in (
            "quantity",
            "reorder_point",
            "expected_lifetime_years",
            "inspection_interval_days",
            "purchase_price",
            "current_value",
            "replacement_cost",
            "weight",
        )
    ],
    (
        I.InventoryCategoryBase,
        "low_stock_threshold",
        InventoryCategory,
        "low_stock_threshold",
    ),
    (
        I.InventoryCategoryUpdate,
        "low_stock_threshold",
        InventoryCategory,
        "low_stock_threshold",
    ),
    (I.InventoryItemBase, "min_rank_order", InventoryItem, "min_rank_order"),
    (I.InventoryItemUpdate, "min_rank_order", InventoryItem, "min_rank_order"),
    (I.InventoryItemBulkEntry, "quantity", InventoryItem, "quantity"),
    (I.InventoryItemBulkEntry, "reorder_point", InventoryItem, "reorder_point"),
    (I.InventoryLotBase, "quantity", InventoryLot, "quantity"),
    (I.InventoryLotBulkEntry, "quantity", InventoryLot, "quantity"),
    (I.InventoryLotUpdate, "quantity", InventoryLot, "quantity"),
    (I.ItemIssuanceCreate, "quantity", ItemIssuance, "quantity_issued"),
    (I.ItemIssuanceReturnRequest, "quantity_returned", ItemIssuance, "quantity_issued"),
    (
        I.NFPAInspectionDetailCreate,
        "cylinder_pressure",
        NFPAInspectionDetail,
        "cylinder_pressure",
    ),
    (I.MaintenanceRecordBase, "cost", MaintenanceRecord, "cost"),
    (I.MaintenanceRecordBase, "parts_cost", MaintenanceRecord, "parts_cost"),
    (I.MaintenanceRecordBase, "labor_hours", MaintenanceRecord, "labor_hours"),
    (I.MaintenanceRecordUpdate, "cost", MaintenanceRecord, "cost"),
    (I.MaintenanceRecordUpdate, "parts_cost", MaintenanceRecord, "parts_cost"),
    (I.MaintenanceRecordUpdate, "labor_hours", MaintenanceRecord, "labor_hours"),
    (I.BatchScanItem, "quantity", ItemIssuance, "quantity_issued"),
    (I.BatchReturnItem, "quantity", ItemIssuance, "quantity_issued"),
    (I.EquipmentRequestCreate, "quantity", EquipmentRequest, "quantity"),
    (I.EquipmentRequestFulfill, "quantity", EquipmentRequest, "quantity"),
    (I.StorageAreaCreate, "sort_order", StorageArea, "sort_order"),
    (I.StorageAreaUpdate, "sort_order", StorageArea, "sort_order"),
    (I.SizeVariantCreate, "quantity_per_variant", InventoryItem, "quantity"),
    (I.SizeVariantCreate, "replacement_cost", InventoryItem, "replacement_cost"),
    (I.SizeVariantCreate, "purchase_price", InventoryItem, "purchase_price"),
    (I.BulkIssuanceTarget, "quantity", ItemIssuance, "quantity_issued"),
    (I.IssuanceAllowanceCreate, "max_quantity", IssuanceAllowance, "max_quantity"),
    (I.IssuanceAllowanceUpdate, "max_quantity", IssuanceAllowance, "max_quantity"),
    (I.IssuanceChargeRequest, "charge_amount", ItemIssuance, "charge_amount"),
    (I.ReturnRequestCreate, "quantity_returning", ReturnRequest, "quantity_returning"),
    (I.ReturnRequestReview, "received_quantity", ReturnRequest, "received_quantity"),
    (
        I.ReorderRequestCreate,
        "quantity_requested",
        ReorderRequest,
        "quantity_requested",
    ),
    (
        I.ReorderRequestCreate,
        "estimated_unit_cost",
        ReorderRequest,
        "estimated_unit_cost",
    ),
    (
        I.ReorderRequestUpdate,
        "quantity_requested",
        ReorderRequest,
        "quantity_requested",
    ),
    (I.ReorderRequestUpdate, "quantity_received", ReorderRequest, "quantity_received"),
    (
        I.ReorderRequestUpdate,
        "estimated_unit_cost",
        ReorderRequest,
        "estimated_unit_cost",
    ),
    (I.ReorderRequestUpdate, "actual_unit_cost", ReorderRequest, "actual_unit_cost"),
    (I.ReorderTransitionRequest, "expected_version", ReorderRequest, "version"),
    (I.ReorderCorrectionRequest, "expected_version", ReorderRequest, "version"),
    (I.ReorderReceiptCreate, "quantity", ReorderReceipt, "quantity"),
    (I.ReorderReceiptCreate, "expected_version", ReorderRequest, "version"),
    (I.ReorderReceiptCreate, "unit_cost", ReorderReceipt, "unit_cost"),
    (I.ItemVariantGroupCreate, "base_price", ItemVariantGroup, "base_price"),
    (
        I.ItemVariantGroupCreate,
        "base_replacement_cost",
        ItemVariantGroup,
        "base_replacement_cost",
    ),
    (I.ItemVariantGroupUpdate, "base_price", ItemVariantGroup, "base_price"),
    (
        I.ItemVariantGroupUpdate,
        "base_replacement_cost",
        ItemVariantGroup,
        "base_replacement_cost",
    ),
    (I.EquipmentKitItemCreate, "quantity", EquipmentKitItem, "quantity"),
    (I.EquipmentKitCreate, "min_rank_order", EquipmentKit, "min_rank_order"),
    (I.EquipmentKitUpdate, "min_rank_order", EquipmentKit, "min_rank_order"),
    *[
        (schema, field, CheckTemplateItem, field)
        for schema in (E.CheckTemplateItemCreate, E.CheckTemplateItemUpdate)
        for field in (
            "sort_order",
            "required_quantity",
            "expected_quantity",
            "critical_minimum_quantity",
            "min_level",
            "expiration_warning_days",
        )
    ],
    (
        E.CheckTemplateCompartmentCreate,
        "sort_order",
        CheckTemplateCompartment,
        "sort_order",
    ),
    (
        E.CheckTemplateCompartmentUpdate,
        "sort_order",
        CheckTemplateCompartment,
        "sort_order",
    ),
    (
        E.CheckTemplateCompartmentClone,
        "sort_order",
        CheckTemplateCompartment,
        "sort_order",
    ),
    (
        E.EquipmentCheckTemplateCreate,
        "sort_order",
        EquipmentCheckTemplate,
        "sort_order",
    ),
    (
        E.EquipmentCheckTemplateUpdate,
        "sort_order",
        EquipmentCheckTemplate,
        "sort_order",
    ),
    (
        E.CheckItemResultSubmit,
        "quantity_found",
        ShiftEquipmentCheckItem,
        "quantity_found",
    ),
    (
        E.CheckItemResultSubmit,
        "required_quantity",
        ShiftEquipmentCheckItem,
        "required_quantity",
    ),
    (
        E.CheckItemResultSubmit,
        "critical_minimum_quantity",
        ShiftEquipmentCheckItem,
        "critical_minimum_quantity",
    ),
    (
        E.CheckItemResultSubmit,
        "level_reading",
        ShiftEquipmentCheckItem,
        "level_reading",
    ),
    (
        E.CheckSealSubmit,
        "cleared_item_count",
        ShiftEquipmentCheckSeal,
        "cleared_item_count",
    ),
    (E.DeployedLotUpdateRequest, "quantity", CheckItemDeployedLot, "quantity"),
    (E.ItemUsedRequest, "quantity_used", CheckTemplateItem, "quantity_on_truck"),
    (E.ItemQuantityRequest, "quantity", CheckTemplateItem, "quantity_on_truck"),
    (E.LotSwapRequest, "quantity", CheckItemDeployedLot, "quantity"),
]

# The largest round figure inside MySQL FLOAT's range (single precision, max
# 3.402823466e38) -- what the schema promises to accept.
_FLOAT32_LIMIT = 3.4e38


def _column_range(model: Any, column: str):
    """(lowest, highest, just_above, just_below) the stored column can hold."""
    col_type = model.__table__.c[column].type
    if isinstance(col_type, Integer):
        low, high = -(2**31), 2**31 - 1
        return low, high, high + 1, low - 1
    # Float is a subclass of Numeric, so it has to be asked first.
    if isinstance(col_type, Float):
        return -_FLOAT32_LIMIT, _FLOAT32_LIMIT, 1e39, -1e39
    if isinstance(col_type, Numeric):
        step = Decimal(1).scaleb(-col_type.scale)
        high = Decimal(10) ** (col_type.precision - col_type.scale) - step
        return -high, high, high + step, -high - step
    raise AssertionError(f"{model.__name__}.{column} is {col_type!r}, not numeric")


def _validator(schema: Any, field: str) -> TypeAdapter:
    info = schema.model_fields[field]
    if not info.metadata:
        return TypeAdapter(info.annotation)
    return TypeAdapter(Annotated[info.annotation, *info.metadata])


def _accepts(adapter: TypeAdapter, value: Any) -> bool:
    try:
        adapter.validate_python(value)
        return True
    except ValidationError:
        return False


def _id(entry) -> str:
    schema, field, model, column = entry
    return f"{schema.__name__}.{field}->{model.__name__}.{column}"


class TestBoundsMatchTheColumn:
    @pytest.mark.parametrize(
        ("schema", "field", "model", "column"),
        BOUNDED_FIELDS,
        ids=[_id(e) for e in BOUNDED_FIELDS],
    )
    def test_refuses_what_the_column_cannot_hold(self, schema, field, model, column):
        _, high, above, below = _column_range(model, column)
        adapter = _validator(schema, field)

        assert not _accepts(adapter, above), "one past the column's maximum is accepted"
        assert not _accepts(adapter, below), "one past the column's minimum is accepted"
        assert _accepts(
            adapter, high
        ), "the column's own maximum is refused, so the bound is tighter than the column"
