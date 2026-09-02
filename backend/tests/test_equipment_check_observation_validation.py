"""Focused validation tests for template-aware equipment check observations."""

import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.equipment_check import CheckItemResultSubmit
from app.services.equipment_check_service import EquipmentCheckService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentCheckService(mock_db)


class TestSubmissionObservationValidation:
    @staticmethod
    def template_item(check_type, **overrides):
        values = {
            "id": "item-1",
            "name": "Oxygen cylinder",
            "_check_compartment_name": "Medical",
            "check_type": check_type,
            "required_quantity": None,
            "expected_quantity": None,
            "critical_minimum_quantity": None,
            "min_level": None,
            "level_unit": None,
            "serial_number": None,
            "lot_number": None,
            "has_expiration": False,
            "expiration_date": None,
            "deployed_lots": [],
            "quantity_on_truck": None,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    @staticmethod
    def submission(**overrides):
        item = {
            "template_item_id": "item-1",
            "status": "pass",
            "quantity_found": None,
            "level_reading": None,
        }
        item.update(overrides)
        return item

    def test_schema_rejects_negative_count_and_non_finite_level(self):
        base = {
            "template_item_id": "item-1",
            "compartment_name": "Medical",
            "item_name": "Oxygen cylinder",
            "status": "pass",
        }
        with pytest.raises(ValueError, match="greater than or equal to 0"):
            CheckItemResultSubmit(**base, quantity_found=-3)
        with pytest.raises(ValueError, match="finite number"):
            CheckItemResultSubmit(**base, level_reading=math.inf)

    def test_schema_rejects_fractional_count(self):
        with pytest.raises(ValueError, match="valid integer"):
            CheckItemResultSubmit(
                template_item_id="item-1",
                compartment_name="Medical",
                item_name="Oxygen cylinder",
                status="pass",
                quantity_found=1.5,
            )

    @pytest.mark.parametrize("quantity", [-1, 1.5, True])
    def test_service_rejects_invalid_count_without_schema_boundary(self, quantity):
        item = self.submission(quantity_found=quantity)
        with pytest.raises(ValueError, match="integers|non-negative"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [item], {"item-1": self.template_item("count")}
            )

    @pytest.mark.parametrize("reading", [math.inf, -math.inf, math.nan])
    def test_service_rejects_non_finite_level(self, reading):
        item = self.submission(level_reading=reading)
        with pytest.raises(ValueError, match="must be finite"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [item], {"item-1": self.template_item("level")}
            )

    def test_rejects_level_below_configured_minimum(self):
        reading = 49.9
        item = self.submission(level_reading=reading)
        with pytest.raises(ValueError, match="contradicts"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [item],
                {"item-1": self.template_item("level", min_level=50.0)},
            )

    def test_irrelevant_observations_are_removed(self):
        item = self.submission(quantity_found=4, level_reading=75)
        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"item-1": self.template_item("function")}
        )
        assert item["quantity_found"] is None
        assert item["level_reading"] is None

    @pytest.mark.parametrize(
        ("check_type", "irrelevant_field", "relevant_field"),
        [
            ("count", "level_reading", "quantity_found"),
            ("level", "quantity_found", "level_reading"),
        ],
    )
    def test_only_the_template_observation_shape_survives(
        self, check_type, irrelevant_field, relevant_field
    ):
        item = self.submission(quantity_found=2, level_reading=75)
        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"item-1": self.template_item(check_type)}
        )
        assert item[irrelevant_field] is None
        assert item[relevant_field] is not None

    async def test_snapshot_and_inventory_receive_same_count(self, service):
        template_item = self.template_item(
            "count", required_quantity=2, quantity_on_truck=7
        )
        item = self.submission(quantity_found=3)
        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"item-1": template_item}
        )
        created = await service._create_check_items(
            "check-1", [item], {"item-1": template_item}, "org-1"
        )
        assert created[0].quantity_found == 3
        assert template_item.quantity_on_truck == created[0].quantity_found

    def test_count_status_cannot_contradict_required_quantity(self):
        item = self.submission(quantity_found=1)
        with pytest.raises(ValueError, match="contradicts"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [item],
                {"item-1": self.template_item("count", required_quantity=2)},
            )

    def test_a_crew_may_fail_an_item_the_numbers_say_is_fine(self):
        """A measurement can refute a pass. It cannot refute a fail.

        An AED-pad packet is torn open a year before the pads expire; a
        regulator is cracked on a full cylinder; a full drawer holds the wrong
        size. Rejecting those answers 400s the entire checklist — every other
        answer on a sixty-item form goes with it — and the message names no
        action the crew can take. Offline the same payload is retried to the
        queue ceiling and then discarded, so the finding is lost rather than
        filed.
        """
        item = self.submission(status="fail", level_reading=2000.0)

        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"item-1": self.template_item("level", min_level=1500.0)}
        )

        assert item["status"] == "fail"

    def test_a_crew_may_fail_an_unexpired_item(self):
        from datetime import date, timedelta

        item = self.submission(status="fail")

        EquipmentCheckService._validate_and_snapshot_submission(
            [item],
            {
                "item-1": self.template_item(
                    "expiry",
                    has_expiration=True,
                    expiration_date=date.today() + timedelta(days=365),
                )
            },
        )

        assert item["status"] == "fail"

    def test_a_crew_may_fail_an_item_that_is_fully_stocked(self):
        item = self.submission(status="fail", quantity_found=4)

        EquipmentCheckService._validate_and_snapshot_submission(
            [item], {"item-1": self.template_item("count", required_quantity=2)}
        )

        assert item["status"] == "fail"

    def test_an_expired_item_still_cannot_be_passed(self):
        """The direction that is safety-critical is untouched."""
        from datetime import date, timedelta

        item = self.submission(status="pass")

        with pytest.raises(ValueError, match="contradicts"):
            EquipmentCheckService._validate_and_snapshot_submission(
                [item],
                {
                    "item-1": self.template_item(
                        "expiry",
                        has_expiration=True,
                        expiration_date=date.today() - timedelta(days=1),
                    )
                },
            )
