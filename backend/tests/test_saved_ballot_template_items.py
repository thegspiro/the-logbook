"""A saved ballot template refuses unknown keys inside its ballot items.

An item carrying ``candidates`` was answered 201 and stored without them, so
the caller was told a write succeeded that had silently dropped part of the
request. The owner chose (2026-10-05) to forbid extras on the template's items
only: election create/update keep accepting them, because tightening the
shared input schema would reject clients accepted today.
"""

import pytest
from pydantic import ValidationError

from app.schemas.election import (
    BallotItem,
    ElectionUpdate,
    SavedBallotTemplateCreate,
)

pytestmark = pytest.mark.unit

ITEM = {
    "id": "chief-2027",
    "type": "officer_election",
    "title": "Fire Chief",
    "position": "Chief",
    "vote_type": "candidate_selection",
}


def test_template_item_with_unknown_key_is_rejected():
    with pytest.raises(ValidationError) as refused:
        SavedBallotTemplateCreate(
            name="Annual officers",
            ballot_items=[{**ITEM, "candidates": [{"name": "Casey"}]}],
        )
    errors = refused.value.errors()
    assert any(
        e["type"] == "extra_forbidden" and e["loc"][-1] == "candidates" for e in errors
    ), errors


def test_template_item_with_known_keys_is_accepted():
    template = SavedBallotTemplateCreate(
        name="Annual officers",
        ballot_items=[{**ITEM, "description": None, "require_attendance": True}],
    )
    assert template.ballot_items[0].position == "Chief"


def test_election_update_still_tolerates_unknown_item_keys():
    update = ElectionUpdate(ballot_items=[{**ITEM, "candidates": []}])
    assert update.ballot_items[0].id == "chief-2027"


def test_response_item_round_trips_into_a_new_template():
    """An item as the API returns it (every field, nulls included) can be
    saved as a template unchanged — the strict input knows every key the
    response emits."""
    as_returned = BallotItem.model_validate(ITEM).model_dump()
    template = SavedBallotTemplateCreate(name="Copy", ballot_items=[as_returned])
    assert template.ballot_items[0].id == "chief-2027"
