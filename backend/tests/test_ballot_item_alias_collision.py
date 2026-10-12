"""ELEC-40: a ballot item's title or position may not equal another item's id.

``Candidate`` and ``Vote`` record only a position string, and a legacy item is
matched by its title or its id, so a collision makes rows stored under that
string ambiguous between two items. The owner chose (2026-10-05) to refuse the
collision when a ballot is written — create, update and saved template alike —
rather than add a ``ballot_item_id`` column.
"""

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas.election import (
    ElectionCreate,
    ElectionUpdate,
    SavedBallotTemplateCreate,
)

pytestmark = pytest.mark.unit

NOW = datetime.now(timezone.utc)


def _item(item_id: str, title: str, position=None) -> dict:
    item = {
        "id": item_id,
        "type": "general_vote",
        "title": title,
        "vote_type": "approval",
    }
    if position is not None:
        item["position"] = position
    return item


def _create(items):
    return ElectionCreate(
        title="Annual meeting",
        start_date=NOW + timedelta(days=1),
        end_date=NOW + timedelta(days=2),
        ballot_items=items,
    )


COLLIDING_TITLE = [_item("budget", "Budget"), _item("bylaws", "budget")]
COLLIDING_POSITION = [_item("chief", "Chief"), _item("c2", "Captain", "chief")]


@pytest.mark.parametrize("items", [COLLIDING_TITLE, COLLIDING_POSITION])
def test_create_refuses_an_alias_naming_another_items_id(items):
    with pytest.raises(ValidationError, match="another ballot item's id"):
        _create(items)


@pytest.mark.parametrize("items", [COLLIDING_TITLE, COLLIDING_POSITION])
def test_update_refuses_an_alias_naming_another_items_id(items):
    with pytest.raises(ValidationError, match="another ballot item's id"):
        ElectionUpdate(ballot_items=items)


@pytest.mark.parametrize("items", [COLLIDING_TITLE, COLLIDING_POSITION])
def test_saved_template_refuses_an_alias_naming_another_items_id(items):
    with pytest.raises(ValidationError, match="another ballot item's id"):
        SavedBallotTemplateCreate(name="Template", ballot_items=items)


def test_an_item_may_be_titled_with_its_own_id():
    election = _create([_item("budget", "budget"), _item("bylaws", "Bylaws")])
    assert [i.id for i in election.ballot_items] == ["budget", "bylaws"]


def test_duplicate_ids_are_still_refused():
    with pytest.raises(ValidationError, match="must be unique"):
        ElectionUpdate(ballot_items=[_item("a", "One"), _item("a", "Two")])


def test_distinct_items_are_accepted():
    update = ElectionUpdate(
        ballot_items=[_item("budget", "Budget"), _item("c1", "Chief", "Chief")]
    )
    assert len(update.ballot_items) == 2
