"""
Shift-assignment notifications name the position in prose, so the label has to
be the seat's display name ("Firefighter"), never the enum's repr and never
the stored token where the two differ.

`ShiftPosition` is declared twice — `app.models.training` and
`app.schemas.scheduling` — and the service imports the model one while request
schemas parse into the schema one. An `isinstance` guard against either class
misses members of the other, which is how members came to be told they had been
assigned to the "ShiftPosition.FIREFIGHTER position". No DB; pure function.
"""

from app.models.training import ShiftPosition as ModelShiftPosition
from app.schemas.scheduling import ShiftPosition as SchemaShiftPosition
from app.services.scheduling_service import _position_label


class TestPositionLabel:
    def test_model_enum_yields_its_label(self):
        assert _position_label(ModelShiftPosition.FIREFIGHTER) == "Firefighter"

    def test_schema_enum_yields_its_label(self):
        # The regression: a schema member reaching a service that only knew the
        # model class fell through to str() and printed the repr.
        assert _position_label(SchemaShiftPosition.FIREFIGHTER) == "Firefighter"

    def test_plain_string_resolves_to_its_label(self):
        assert _position_label("officer") == "Officer"

    def test_ems_seat_is_named_the_way_the_department_names_it(self):
        # The seat is stored as "ems" and called EMT on every screen that
        # creates or fills it; a notification saying "the ems position" reads
        # as some other seat.
        assert _position_label(ModelShiftPosition.EMS) == "EMT"
        assert _position_label("ems") == "EMT"

    def test_missing_position_reads_as_unspecified(self):
        assert _position_label(None) == "unspecified"
        assert _position_label("") == "unspecified"

    def test_no_label_carries_the_class_name(self):
        for position in (
            ModelShiftPosition.OFFICER,
            SchemaShiftPosition.OFFICER,
            "driver",
            None,
        ):
            assert "ShiftPosition" not in _position_label(position)
