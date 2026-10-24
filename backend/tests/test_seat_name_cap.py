"""A seat list cannot name a seat longer than an assignment can store.

Seats live in JSON on a shift, template or apparatus, with no length limit,
but the member filling one is stored in VARCHAR(100) and every request naming
a seat is capped there. A longer seat could be created and never filled.
"""

from datetime import date, datetime, timezone

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.scheduling import (
    BasicApparatusCreate,
    ShiftCreate,
    ShiftResponse,
    ShiftTemplateCreate,
    ShiftUpdate,
)
from app.utils.positions import SEAT_NAME_MAX_LENGTH

pytestmark = pytest.mark.unit

TOO_LONG = "x" * (SEAT_NAME_MAX_LENGTH + 1)
AT_CAP = "y" * SEAT_NAME_MAX_LENGTH
START = datetime(2026, 11, 1, 11, tzinfo=timezone.utc)


@pytest.mark.parametrize("entry", [TOO_LONG, {"position": TOO_LONG}])
def test_a_shift_refuses_an_overlong_seat(entry):
    with pytest.raises(ValidationError, match="at most 100 characters"):
        ShiftCreate(shift_date=date(2026, 11, 1), start_time=START, positions=[entry])
    with pytest.raises(ValidationError, match="at most 100 characters"):
        ShiftUpdate(positions=[entry])


def test_a_template_and_an_apparatus_refuse_one_too():
    with pytest.raises(ValidationError, match="at most 100 characters"):
        ShiftTemplateCreate(
            name="Day",
            start_time_of_day="07:00",
            end_time_of_day="19:00",
            duration_hours=12,
            positions=[{"position": TOO_LONG, "required": True}],
        )
    with pytest.raises(ValidationError, match="at most 100 characters"):
        BasicApparatusCreate(unit_number="E1", name="Engine 1", positions=[TOO_LONG])


def test_a_seat_at_the_cap_and_event_metadata_still_pass():
    shift = ShiftUpdate(positions=[{"position": AT_CAP, "required": True}])
    assert shift.positions[0].position == AT_CAP
    # A template's event metadata is a dict, not a seat list.
    metadata = {"resources": [{"positions": [{"position": "support"}]}]}
    assert (
        ShiftTemplateCreate(
            name="Event",
            start_time_of_day="07:00",
            end_time_of_day="19:00",
            duration_hours=12,
            positions=metadata,
        ).positions
        == metadata
    )


def test_a_stored_overlong_seat_still_reads():
    # Responses keep the plain type: a row written before the cap must not
    # fail on the way out.
    field = ShiftResponse.model_fields["positions"]
    stored = TypeAdapter(field.annotation).validate_python([{"position": TOO_LONG}])
    assert stored[0].position == TOO_LONG
