"""
Validation tests for the shift-call request schemas
(app/schemas/scheduling.py).

The ShiftCall DB columns are String(100) for incident fields, Text for
notes, and JSON for responding_members. The request schemas bound each of
these so oversized payloads are rejected with a clean 422 instead of a
DB-level error (incident fields) or unbounded storage (notes, members).
"""

import pytest
from pydantic import ValidationError

from app.schemas.scheduling import ShiftCallCreate, ShiftCallUpdate


class TestShiftCallCreateBounds:
    def test_minimal_valid_payload(self):
        call = ShiftCallCreate(incident_type="Structure fire")
        assert call.incident_type == "Structure fire"
        assert call.cancelled_en_route is False
        assert call.medical_refusal is False

    def test_full_valid_payload(self):
        call = ShiftCallCreate(
            incident_type="EMS",
            incident_number="2026-00123",
            notes="Patient transported.",
            responding_members=["a" * 36, "b" * 36],
            cancelled_en_route=True,
            medical_refusal=False,
        )
        assert call.incident_number == "2026-00123"
        assert len(call.responding_members or []) == 2

    def test_rejects_empty_incident_type(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="")

    def test_rejects_incident_type_over_column_size(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="x" * 101)

    def test_rejects_incident_number_over_column_size(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="EMS", incident_number="x" * 101)

    def test_rejects_oversized_notes(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="EMS", notes="x" * 2001)

    def test_accepts_notes_at_limit(self):
        call = ShiftCallCreate(incident_type="EMS", notes="x" * 2000)
        assert len(call.notes or "") == 2000

    def test_rejects_oversized_member_list(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="EMS", responding_members=["id"] * 101)

    def test_rejects_oversized_member_entry(self):
        with pytest.raises(ValidationError):
            ShiftCallCreate(incident_type="EMS", responding_members=["x" * 65])


class TestShiftCallUpdateBounds:
    def test_empty_update_is_valid(self):
        update = ShiftCallUpdate()
        assert update.incident_type is None

    def test_rejects_empty_incident_type_when_provided(self):
        with pytest.raises(ValidationError):
            ShiftCallUpdate(incident_type="")

    def test_rejects_oversized_notes(self):
        with pytest.raises(ValidationError):
            ShiftCallUpdate(notes="x" * 2001)

    def test_rejects_oversized_incident_number(self):
        with pytest.raises(ValidationError):
            ShiftCallUpdate(incident_number="x" * 101)
