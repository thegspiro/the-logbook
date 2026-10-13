"""The update schemas' list of NOT NULL fields cannot drift from the models.

``ElectionUpdate`` and ``CandidateUpdate`` refuse an explicit ``null`` for a field
whose column is NOT NULL, using a hand-kept set because the schema cannot see the
column. A set kept by hand is only as good as the thing that notices it going
stale, so this derives the truth from the models and compares: add a NOT NULL
column to either table and forget the set, and this fails -- rather than the new
field quietly answering 500 to a null.

Database-free: it reads table metadata, never a connection.
"""

import pytest
from pydantic import ValidationError

from app.models.election import Candidate, Election
from app.schemas.election import (
    CANDIDATE_UPDATE_REQUIRED_FIELDS,
    ELECTION_UPDATE_REQUIRED_FIELDS,
    CandidateUpdate,
    ElectionUpdate,
)

pytestmark = [pytest.mark.unit]


def _not_null(schema, model) -> set[str]:
    columns = model.__table__.columns
    return {
        name
        for name in schema.model_fields
        if name in columns and not columns[name].nullable
    }


class TestRequiredFieldSetsMatchTheModels:
    def test_election_set_is_exactly_the_not_null_columns(self):
        assert ELECTION_UPDATE_REQUIRED_FIELDS == _not_null(ElectionUpdate, Election)

    def test_candidate_set_is_the_not_null_columns_less_accepted(self):
        # `accepted` is NOT NULL as well, but `update_candidate` refuses its null
        # itself, with its own message, after routing acceptance through the
        # service. Listing it here would make that guard dead code.
        assert CANDIDATE_UPDATE_REQUIRED_FIELDS == (
            _not_null(CandidateUpdate, Candidate) - {"accepted"}
        )


class TestTheValidatorDistinguishesOmittedFromNull:
    def test_an_update_that_sends_nothing_is_valid(self):
        assert ElectionUpdate().model_fields_set == set()
        assert CandidateUpdate().model_fields_set == set()

    def test_a_null_for_a_required_field_is_refused_and_named(self):
        with pytest.raises(ValidationError, match="title cannot be null"):
            ElectionUpdate(title=None)
        with pytest.raises(ValidationError, match="name cannot be null"):
            CandidateUpdate(name=None)

    def test_every_cleared_field_is_named_in_one_message(self):
        with pytest.raises(ValidationError, match="end_date, title cannot be null"):
            ElectionUpdate(title=None, end_date=None)

    def test_a_null_for_a_nullable_field_is_still_a_clear(self):
        election = ElectionUpdate(description=None, meeting_id=None)
        assert election.model_fields_set == {"description", "meeting_id"}

        candidate = CandidateUpdate(statement=None, position=None)
        assert candidate.model_fields_set == {"statement", "position"}

    def test_a_real_value_for_a_required_field_is_accepted(self):
        assert ElectionUpdate(title="Annual officer election").title is not None
        assert CandidateUpdate(display_order=3).display_order == 3
