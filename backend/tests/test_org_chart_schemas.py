"""
Organizational Chart request-schema contracts.

Two of these pin behaviour a reviewer questioned on PR #1796: a null title is
refused as a 400 rather than reaching the column, and a move request has to say
which parent it means.
"""

import pytest
from pydantic import ValidationError

from app.models.org_chart import OrgChartNode
from app.schemas.org_chart import (
    OrgChartNodeCreate,
    OrgChartNodeMove,
    OrgChartNodeUpdate,
)
from app.utils.model_updates import apply_updates


class TestCasing:
    def test_requests_accept_the_camelcase_the_frontend_sends(self):
        payload = OrgChartNodeCreate(
            **{"title": "Fire Chief", "parentId": "p1", "isPublished": False}
        )
        assert payload.parent_id == "p1"
        assert payload.is_published is False

    def test_requests_still_accept_snake_case_directly(self):
        payload = OrgChartNodeCreate(title="Fire Chief", parent_id="p1")
        assert payload.parent_id == "p1"


class TestBlankHandling:
    def test_a_whitespace_only_optional_field_is_stored_as_absent(self):
        payload = OrgChartNodeCreate(title=" Fire Chief ", responsibility="   ")
        assert payload.title == "Fire Chief"
        assert payload.responsibility is None

    def test_an_omitted_key_stays_omitted_on_an_update(self):
        payload = OrgChartNodeUpdate(**{"responsibility": None})
        assert payload.model_dump(exclude_unset=True) == {"responsibility": None}


class TestNullTitle:
    """A null title is a 400, not a 500.

    Raised in review as an uncaught IntegrityError. It is not: the schema lets
    the key through, and `apply_updates` refuses the null against the NOT NULL
    column with a ValueError, which the endpoint turns into a 400. This pins
    that chain so a future change to either half cannot quietly turn it into a
    flush-time server error.
    """

    def test_apply_updates_refuses_a_null_title(self):
        node = OrgChartNode(title="Fire Chief")
        payload = OrgChartNodeUpdate(**{"title": None})

        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(
                node,
                payload.model_dump(exclude_unset=True),
                skip={"id", "organization_id", "parent_id", "sort_order"},
            )

        assert node.title == "Fire Chief"

    def test_a_blank_title_is_refused_at_the_schema(self):
        with pytest.raises(ValidationError):
            OrgChartNodeUpdate(title="   ")


class TestMoveRequiresAParent:
    def test_a_move_must_say_which_parent_it_means(self):
        # `{"position": 2}` alone used to read as "promote to root", silently
        # detaching a subtree when the caller meant "reorder where it is".
        with pytest.raises(ValidationError):
            OrgChartNodeMove(**{"position": 2})

    def test_an_explicit_null_parent_still_means_the_top_of_the_chart(self):
        payload = OrgChartNodeMove(**{"parentId": None, "position": 0})
        assert payload.parent_id is None

    def test_a_blank_parent_is_read_as_the_top_of_the_chart(self):
        payload = OrgChartNodeMove(**{"parentId": "", "position": 0})
        assert payload.parent_id is None


class TestHolders:
    def test_a_seat_can_list_several_people(self):
        payload = OrgChartNodeCreate(
            **{
                "title": "Trustees",
                "holders": [
                    {"displayName": "Jonathan Green"},
                    {"userId": "u1", "displayName": "Chief Ramirez"},
                ],
            }
        )
        assert [h.display_name for h in payload.holders] == [
            "Jonathan Green",
            "Chief Ramirez",
        ]

    def test_a_person_with_neither_a_member_nor_a_name_is_refused(self):
        # An entry naming nobody would render as a blank line in the box, which
        # reads as a rendering bug rather than as an empty row somebody left.
        with pytest.raises(ValidationError):
            OrgChartNodeCreate(**{"title": "Trustees", "holders": [{}]})

    def test_an_omitted_holder_list_leaves_the_people_alone(self):
        payload = OrgChartNodeUpdate(**{"title": "Trustees"})
        assert "holders" not in payload.model_dump(exclude_unset=True)

    def test_an_empty_holder_list_is_a_deliberate_clear(self):
        payload = OrgChartNodeUpdate(**{"holders": []})
        assert payload.model_dump(exclude_unset=True) == {"holders": []}


class TestHolderSource:
    def test_a_seat_following_a_role_must_say_which_role(self):
        # Otherwise the seat resolves as permanently vacant with nothing on the
        # screen to explain why.
        with pytest.raises(ValidationError):
            OrgChartNodeCreate(**{"title": "Chief", "holderSource": "position"})

    def test_a_seat_following_a_rank_must_say_which_rank(self):
        with pytest.raises(ValidationError):
            OrgChartNodeCreate(**{"title": "Captains", "holderSource": "rank"})

    def test_an_unknown_source_is_refused(self):
        with pytest.raises(ValidationError):
            OrgChartNodeCreate(**{"title": "Chief", "holderSource": "vibes"})

    def test_the_unused_reference_is_cleared_rather_than_stored(self):
        # Kept, it would come back into effect the next time somebody switched
        # the source back, naming a role nobody chose.
        payload = OrgChartNodeCreate(
            **{
                "title": "Chief",
                "holderSource": "position",
                "positionId": "p1",
                "rankCode": "captain",
            }
        )
        assert payload.position_id == "p1"
        assert payload.rank_code is None

    def test_an_update_that_never_mentions_the_source_is_not_refused(self):
        # A rename must not be rejected for a reference it never sent.
        payload = OrgChartNodeUpdate(**{"title": "Fire Chief"})
        assert payload.model_dump(exclude_unset=True) == {"title": "Fire Chief"}
