"""
Sealed containers on an equipment check.

A container closed with a numbered tamper seal can have its contents count
cleared by the seal rather than counted by hand. These tests cover the parts
that decide what reaches the record: which seals are accepted, and what the
submit schemas carry.
"""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.equipment_check import (
    CheckSealSubmit,
    CheckTemplateCompartmentCreate,
    CheckTemplateCompartmentResponse,
    LastSealRecord,
    ShiftEquipmentCheckCreate,
    StandaloneEquipmentCheckCreate,
)


def _item(**over):
    payload = {
        "template_item_id": "item-1",
        "compartment_name": "Medic 2 › Drug Bag",
        "item_name": "Gauze",
        "status": "pass",
    }
    payload.update(over)
    return payload


class TestCompartmentSchema:
    def test_a_compartment_is_unsealed_unless_it_says_otherwise(self):
        # Every compartment that existed before seals must keep behaving
        # exactly as it did; the shortcut only appears once somebody opts in.
        created = CheckTemplateCompartmentCreate(name="Cab")
        assert created.is_sealed is False

    def test_a_row_written_before_the_column_existed_reads_as_unsealed(self):
        # MySQL stores NULL for rows that predate the column. A None there must
        # not become a truthy "sealed" and offer a shortcut nobody configured.
        response = CheckTemplateCompartmentResponse.model_validate(
            {
                "id": "c1",
                "template_id": "t1",
                "name": "Cab",
                "sort_order": 0,
                "is_sealed": None,
            }
        )
        assert response.is_sealed is False

    def test_a_sealed_compartment_round_trips(self):
        created = CheckTemplateCompartmentCreate(name="Drug Bag", is_sealed=True)
        assert created.is_sealed is True


class TestSealSubmission:
    def test_a_check_carries_no_seals_by_default(self):
        # A truck without a drug bag submits exactly what it always did.
        payload = ShiftEquipmentCheckCreate(template_id="t1", items=[_item()])
        assert payload.seals == []

    def test_a_broken_seal_is_recorded_and_clears_nothing(self):
        seal = CheckSealSubmit(
            template_compartment_id="c1",
            compartment_name="Medic 2 › Drug Bag",
            seal_number="M2-40817",
            intact=False,
            cleared_item_count=0,
        )
        assert seal.intact is False
        assert seal.cleared_item_count == 0

    def test_a_seal_may_be_recorded_without_a_number(self):
        # A tag that is missing entirely is the case the record most needs to
        # capture; refusing it would push the crew to invent a number.
        seal = CheckSealSubmit(
            template_compartment_id="c1",
            compartment_name="Drug Bag",
            intact=False,
        )
        assert seal.seal_number is None

    def test_a_negative_cleared_count_is_rejected(self):
        with pytest.raises(ValidationError):
            CheckSealSubmit(
                template_compartment_id="c1",
                compartment_name="Drug Bag",
                cleared_item_count=-1,
            )

    def test_standalone_checks_carry_seals_too(self):
        payload = StandaloneEquipmentCheckCreate(
            template_id="t1",
            items=[_item()],
            seals=[
                CheckSealSubmit(
                    template_compartment_id="c1",
                    compartment_name="Drug Bag",
                    seal_number="M2-40817",
                    intact=True,
                    cleared_item_count=4,
                )
            ],
        )
        assert payload.seals[0].cleared_item_count == 4


class TestLastSealRecord:
    def test_the_previous_seal_serialises_camelCase_for_the_form(self):
        record = LastSealRecord(
            seal_number="M2-40817",
            intact=True,
            checked_at=datetime(2026, 8, 9, tzinfo=timezone.utc),
        )
        dumped = record.model_dump(by_alias=True)
        assert dumped["sealNumber"] == "M2-40817"
        assert dumped["intact"] is True
        assert "checkedAt" in dumped
