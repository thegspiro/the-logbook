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


class TestTheLink:
    def test_a_seat_can_be_linked_to_a_role_and_still_name_people(self):
        # The whole distinction: the application supports the chart rather than
        # defining it, so both travel in one payload.
        payload = OrgChartNodeCreate(
            **{
                "title": "Chief",
                "positionId": "pos-1",
                "holders": [{"displayName": "Rev. J. Alvarez"}],
            }
        )
        assert payload.position_id == "pos-1"
        assert [h.display_name for h in payload.holders] == ["Rev. J. Alvarez"]

    def test_a_seat_cannot_be_linked_to_both_a_role_and_a_rank(self):
        with pytest.raises(ValidationError):
            OrgChartNodeCreate(
                **{"title": "Chief", "positionId": "pos-1", "rankCode": "captain"}
            )

    def test_an_unlinked_seat_is_the_default(self):
        payload = OrgChartNodeCreate(title="Trustees")
        assert payload.position_id is None
        assert payload.rank_code is None

    def test_an_explicit_null_is_how_a_seat_is_unlinked(self):
        # `exclude_unset` on the backend means an omitted key leaves the link
        # alone, so unlinking has to be a null the payload actually carries.
        payload = OrgChartNodeUpdate(**{"positionId": None})
        assert payload.model_dump(exclude_unset=True) == {"position_id": None}

    def test_an_update_that_never_mentions_the_link_leaves_it_alone(self):
        payload = OrgChartNodeUpdate(**{"title": "Fire Chief"})
        assert payload.model_dump(exclude_unset=True) == {"title": "Fire Chief"}
