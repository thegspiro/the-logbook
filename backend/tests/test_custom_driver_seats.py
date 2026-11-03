"""A custom seat marked "Drives apparatus" gets the driver EVOC check.

Owner decision 2026-10-31 (KNOWN_LIMITATIONS, shifts-module review item 8):
seat names are stored as typed, so a department calling its wheel seat
"Engineer" seated members with no EVOC level and no warning. The flag lives on
the custom position in Scheduling Settings; ``driver`` is always a driving
seat.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.error_codes import CodedValueError
from app.models.scheduling_module_config import SchedulingModuleConfig
from app.schemas.scheduling_module_config import CustomPositionSchema
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration

BLOCKED = {"allowed": False, "blocked_reason": "Requires EVOC Level 2.", "warnings": []}


async def _settings(db, org_id, custom_positions):
    db.add(
        SchedulingModuleConfig(
            organization_id=org_id, custom_positions=custom_positions
        )
    )
    await db.flush()


@pytest.fixture
def evoc_blocks(monkeypatch):
    evaluate = AsyncMock(return_value=BLOCKED)
    monkeypatch.setattr(
        "app.services.shift_eligibility_service.ShiftEligibilityService",
        lambda _db: MagicMock(evaluate_driver_assignment=evaluate),
    )
    return evaluate


class TestCustomDriverSeats:
    async def test_a_flagged_custom_seat_is_checked(
        self, db_session, setup_org_and_admin, evoc_blocks
    ):
        org_id, admin_id = setup_org_and_admin
        await _settings(
            db_session,
            org_id,
            [
                {"value": "engineer", "label": "Engineer", "drivesApparatus": True},
                {"value": "tillerman", "label": "Tillerman"},
            ],
        )
        service = SchedulingService(db_session)

        with pytest.raises(CodedValueError, match="Requires EVOC Level 2."):
            await service._check_driver_qualification(
                admin_id, "shift-1", org_id, position="Engineer"
            )
        evoc_blocks.assert_awaited_once()

    async def test_an_unflagged_custom_seat_is_not(
        self, db_session, setup_org_and_admin, evoc_blocks
    ):
        org_id, admin_id = setup_org_and_admin
        await _settings(
            db_session, org_id, [{"value": "tillerman", "label": "Tillerman"}]
        )
        service = SchedulingService(db_session)

        assert (
            await service._check_driver_qualification(
                admin_id, "shift-1", org_id, position="tillerman"
            )
            is None
        )
        evoc_blocks.assert_not_awaited()

    async def test_driver_is_checked_with_no_settings_saved(
        self, db_session, setup_org_and_admin, evoc_blocks
    ):
        org_id, admin_id = setup_org_and_admin
        service = SchedulingService(db_session)

        with pytest.raises(CodedValueError):
            await service._check_driver_qualification(
                admin_id, "shift-1", org_id, position="driver"
            )


@pytest.mark.unit
class TestTheFlagOnTheWire:
    def test_it_round_trips_camel_case_and_defaults_off(self):
        flagged = CustomPositionSchema.model_validate(
            {"value": "engineer", "label": "Engineer", "drivesApparatus": True}
        )
        assert flagged.model_dump(by_alias=True)["drivesApparatus"] is True
        legacy = CustomPositionSchema.model_validate(
            {"value": "tillerman", "label": "Tillerman"}
        )
        assert legacy.drives_apparatus is False
