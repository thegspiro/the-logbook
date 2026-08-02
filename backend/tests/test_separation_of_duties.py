"""
Separation of duties.

One person must not occupy both sides of a control — raise a payment and
approve it, examine themselves, or sign off their own hours. ISO 27001 A.5.3
asks for this by name, and a department's bylaws normally require it for
disbursements specifically.
"""

import uuid

import pytest

from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)

pytestmark = [pytest.mark.unit]

_ALICE = str(uuid.uuid4())
_BOB = str(uuid.uuid4())


class TestAssertDifferentPerson:
    def test_rejects_the_same_person_on_both_sides(self):
        with pytest.raises(SeparationOfDutiesError) as exc:
            assert_different_person(
                _ALICE, _ALICE, action="approve", record="check request"
            )

        message = str(exc.value)
        assert "approve" in message
        assert "check request" in message

    def test_allows_two_different_people(self):
        assert_different_person(_ALICE, _BOB, action="approve", record="check request")

    def test_compares_as_strings(self):
        # ids arrive as UUID objects from path params and as str from the ORM;
        # comparing those directly would silently never match and disable the
        # control.
        with pytest.raises(SeparationOfDutiesError):
            assert_different_person(
                uuid.UUID(_ALICE), _ALICE, action="approve", record="expense report"
            )

    def test_is_a_value_error_so_endpoints_return_400(self):
        # The endpoint layer's existing `except ValueError` handling turns this
        # into a 400 with the message intact; if it stopped being a ValueError
        # those handlers would let it escape as a 500.
        assert issubclass(SeparationOfDutiesError, ValueError)

    @pytest.mark.parametrize(
        ("actor", "subject"),
        [(None, _ALICE), (_ALICE, None), (None, None), ("", _ALICE)],
    )
    def test_no_ops_when_either_side_is_unknown(self, actor, subject):
        # An unattributed record cannot be shown to be self-approval. Blocking
        # on absence would wedge legacy rows that predate the field.
        assert_different_person(actor, subject, action="approve", record="entry")
