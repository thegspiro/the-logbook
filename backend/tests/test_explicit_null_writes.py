"""An explicit null for a NOT NULL column is refused with a 400, on every path.

Revision 6dce1364ff7e made 99 columns NOT NULL in the models, matching what the
migration chain had always created. Before it, the models said nullable, so
``apply_updates`` passed an explicit ``null`` straight through: an upgraded
database rejected it at flush with MySQL 1048 (a 500, or a generic 400) and a
fresh install stored a meaningless NULL.

These tests pin both halves of the fix without a database:

- the models agree with the migration's frozen column list, so a column cannot
  quietly be relaxed again while the migration still enforces it;
- every update path that writes these columns refuses the null with a clear
  error instead of reaching the flush, including the hand-written ``setattr``
  loops that bypass ``apply_updates``.

The objects are real, unsaved model instances. ``reject_null_for_required``
reads nullability from the mapper, so a ``SimpleNamespace`` stand-in would make
every one of these tests pass for the wrong reason.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import inventory as inventory_endpoints
from app.api.v1.endpoints import training_module_config as module_config_endpoints
from app.core.database import Base
from app.models.inventory import (
    EquipmentKit,
    ItemVariantGroup,
    MaintenanceRecord,
    NFPAItemCompliance,
)
from app.models.notification import DepartmentMessage
from app.models.training import (
    SelfReportConfig,
    ShiftCompletionReport,
    ShiftTemplate,
    TrainingModuleConfig,
)
from app.schemas.inventory import NFPAComplianceUpdate
from app.schemas.training_module_config import TrainingModuleConfigUpdate
from app.services.inventory_service import InventoryService
from app.services.messaging_service import MessagingService
from app.services.scheduling_service import SchedulingService
from app.services.shift_completion_service import ShiftCompletionService
from app.utils.model_updates import apply_updates

pytestmark = pytest.mark.unit

_MIGRATION = next(
    (Path(__file__).resolve().parent.parent / "alembic" / "versions").glob(
        "*_6dce1364ff7e_*.py"
    )
)


def _frozen_columns() -> list[tuple[str, str]]:
    spec = importlib.util.spec_from_file_location("_sweep_6dce1364ff7e", _MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return [
        (table, column)
        for table, columns in module._COLUMNS.items()
        for column, _ in columns
    ]


def _db_returning(obj):
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=obj))
    )
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


class TestModelsMatchTheMigration:
    def test_every_swept_column_is_not_null_with_a_server_default(self):
        columns = _frozen_columns()
        assert len(columns) == 99
        loose = [
            f"{t}.{c}"
            for t, c in columns
            if Base.metadata.tables[t].c[c].nullable
            or Base.metadata.tables[t].c[c].server_default is None
        ]
        assert not loose, "Relaxed while the migration enforces NOT NULL: " + ", ".join(
            loose
        )


class TestApplyUpdatesPaths:
    """Paths that already used apply_updates now refuse the null themselves."""

    @pytest.mark.parametrize(
        ("model", "field"),
        [
            (TrainingModuleConfig, "show_training_hours"),
            (TrainingModuleConfig, "rating_label"),
            (SelfReportConfig, "approval_deadline_days"),
        ],
    )
    def test_apply_updates_refuses_the_null(self, model, field):
        with pytest.raises(ValueError, match=f"Field '{field}' cannot be cleared"):
            apply_updates(model(), {field: None})

    async def test_module_config_endpoint_returns_400(self):
        service = MagicMock()
        service.update_config = AsyncMock(
            side_effect=ValueError("Field 'show_training_hours' cannot be cleared")
        )
        user = SimpleNamespace(id="u1", organization_id="org-1")
        with (
            patch.object(
                module_config_endpoints,
                "TrainingModuleConfigService",
                return_value=service,
            ),
            patch.object(
                module_config_endpoints, "user_has_permission", return_value=True
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await module_config_endpoints.update_training_module_config(
                    updates=TrainingModuleConfigUpdate(show_training_hours=None),
                    db=MagicMock(),
                    current_user=user,
                )
        assert exc.value.status_code == 400
        assert exc.value.detail == "Field 'show_training_hours' cannot be cleared"


class TestHandWrittenUpdateLoops:
    """Loops that setattr from the payload, bypassing apply_updates."""

    async def test_department_message_is_persistent(self):
        message = DepartmentMessage(
            id="m1", organization_id="org-1", scheduled_at=None, target_type=None
        )
        db = _db_returning(message)
        result, err = await MessagingService(db).update_message(
            "m1", "org-1", {"is_persistent": None}
        )
        assert result is None
        assert err == "Field 'is_persistent' cannot be cleared"
        db.commit.assert_not_awaited()

    async def test_variant_group_active(self):
        service = InventoryService(_db_returning(None))
        with patch.object(
            service,
            "get_variant_group_by_id",
            AsyncMock(return_value=ItemVariantGroup()),
        ):
            group, err = await service.update_variant_group(
                uuid.uuid4(), "org-1", {"active": None}
            )
        assert group is None
        assert err == "Field 'active' cannot be cleared"

    async def test_equipment_kit_active(self):
        service = InventoryService(_db_returning(None))
        with patch.object(
            service, "get_equipment_kit_by_id", AsyncMock(return_value=EquipmentKit())
        ):
            kit, err = await service.update_equipment_kit(
                uuid.uuid4(), "org-1", {"active": None}
            )
        assert kit is None
        assert err == "Field 'active' cannot be cleared"

    async def test_maintenance_record_is_completed(self):
        db = _db_returning(MaintenanceRecord(is_completed=False))
        record, err = await InventoryService(db).update_maintenance_record(
            uuid.uuid4(), uuid.uuid4(), "org-1", {"is_completed": None}
        )
        assert record is None
        assert err == "Field 'is_completed' cannot be cleared"
        db.commit.assert_not_awaited()

    async def test_nfpa_compliance_is_retired_by_age(self):
        db = _db_returning(NFPAItemCompliance())
        user = SimpleNamespace(id="u1", organization_id="org-1", username="u")
        with pytest.raises(HTTPException) as exc:
            await inventory_endpoints.update_nfpa_compliance(
                item_id=uuid.uuid4(),
                data=NFPAComplianceUpdate(is_retired_by_age=None),
                db=db,
                current_user=user,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail == "Field 'is_retired_by_age' cannot be cleared"
        db.commit.assert_not_awaited()

    @pytest.mark.parametrize("field", ["calls_responded", "review_status"])
    async def test_shift_report(self, field):
        report = ShiftCompletionReport(
            organization_id="org-1", officer_id="officer-1", review_status="approved"
        )
        service = ShiftCompletionService(_db_returning(report))
        with patch.object(service, "get_report", AsyncMock(return_value=report)):
            with pytest.raises(ValueError, match=f"Field '{field}' cannot be cleared"):
                await service.update_report("r1", "org-1", "officer-1", {field: None})

    @pytest.mark.parametrize("field", ["min_staffing", "is_default"])
    async def test_shift_template(self, field):
        db = _db_returning(None)
        record, err = await SchedulingService(db)._crud_update(
            ShiftTemplate(), {field: None}
        )
        assert record is None
        assert err == f"Field '{field}' cannot be cleared"
        db.commit.assert_not_awaited()


class TestBulkItemCreate:
    async def test_explicit_null_quantity_is_refused(self):
        db = MagicMock()
        db.execute = AsyncMock(
            return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=list)))
        )
        db.add = MagicMock()
        db.commit = AsyncMock()
        service = InventoryService(db)
        with (
            patch.object(
                service, "_validate_category_requirements", AsyncMock(return_value=None)
            ),
            patch.object(service, "_assert_item_fks_in_org", AsyncMock()),
        ):
            with pytest.raises(ValueError, match="Gloves: quantity cannot be empty"):
                await service.create_items_bulk(
                    "org-1",
                    [{"name": "Gloves", "quantity": None, "tracking_type": "pool"}],
                    "u1",
                )
        db.add.assert_not_called()
        db.commit.assert_not_awaited()
