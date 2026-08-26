"""The credential-side seat grant on a training course.

``TrainingCourse.target_position`` is what makes a certification confer a shift
position. It is the only eligibility term that can lapse on its own -- rank,
held positions and completed programs all persist until somebody edits a record
-- so it is what separates "was a paramedic" from "is a paramedic".

These cover the API surface. The resolution itself is in
tests/test_shift_eligibility_service.py.
"""

import re
from pathlib import Path

import pydantic
import pytest

from app.schemas.training import TrainingCourseCreate, TrainingCourseUpdate
from app.utils.positions import TRAINING_TARGET_VALUES, training_target_to_position


def _course(**kwargs):
    return TrainingCourseCreate(
        name="Paramedic", training_type="certification", **kwargs
    )


class TestTargetPositionValidation:
    def test_omitted_is_none(self):
        # A course that confers no seat is the norm, not an error: most
        # continuing education teaches something without qualifying anyone.
        assert _course().target_position is None

    def test_accepted_and_normalized(self):
        assert _course(target_position="Paramedic").target_position == "paramedic"
        assert _course(target_position="  EMT  ").target_position == "emt"

    def test_blank_clears_rather_than_storing_empty(self):
        # An emptied form field means "no seat", not a target_position of "".
        assert _course(target_position="   ").target_position is None

    def test_unknown_value_is_rejected(self):
        # The failure this guards is silent: an unresolvable value is stored,
        # shown back as configured, and confers nothing -- so the training
        # officer believes the seat is wired when it is not.
        with pytest.raises(
            pydantic.ValidationError, match="target_position must be one of"
        ):
            _course(target_position="medic")

    @pytest.mark.parametrize("value", sorted(TRAINING_TARGET_VALUES))
    def test_every_resolvable_value_is_accepted(self, value):
        # The validator and the resolver must agree in both directions: a
        # value the service can resolve must not be refused at the door.
        assert _course(target_position=value).target_position == value
        assert training_target_to_position(
            value
        ), "the API accepts a value that confers no seat"

    def test_update_accepts_an_explicit_null_to_clear_the_grant(self):
        # model_dump(exclude_unset=True) keeps an explicitly-passed None, so
        # this reaches the column and revokes the seat.
        payload = TrainingCourseUpdate(target_position=None)
        assert "target_position" in payload.model_dump(exclude_unset=True)

    def test_update_omitting_the_field_leaves_it_alone(self):
        assert "target_position" not in TrainingCourseUpdate().model_dump(
            exclude_unset=True
        )


class TestTheCourseFormOffersOnlyResolvableTargets:
    """A seat the form offers and the API refuses is a dead option.

    Parsed from source in the manner of ``test_position_slots.py``: the two
    lists live in different languages and nothing else makes them agree, so a
    value added to the dropdown alone would 422 on save, and one whose spelling
    the resolver does not understand would save and confer nothing.
    """

    def _offered(self):
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "constants"
            / "enums.ts"
        ).read_text()
        block = re.search(
            r"export const COURSE_TARGET_POSITIONS[^=]*=\s*\[(.*?)\n\];",
            source,
            re.S,
        )
        assert block, "COURSE_TARGET_POSITIONS not found in enums.ts"
        values = re.findall(r"value:\s*'([^']+)'", block.group(1))
        assert values, "no target values parsed"
        return values

    def test_every_offered_value_is_accepted_by_the_api(self):
        offered = set(self._offered())
        assert offered <= set(TRAINING_TARGET_VALUES), (
            "the course form offers target_position values the API rejects: "
            f"{sorted(offered - set(TRAINING_TARGET_VALUES))}"
        )

    def test_every_offered_value_confers_a_seat(self):
        for value in self._offered():
            assert training_target_to_position(value), (
                f"{value!r} is offered in the course form but resolves to no "
                "seat, so a course configured with it would confer nothing"
            )
