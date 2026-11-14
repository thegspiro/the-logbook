"""W50-76: wording slips in what the elections module sends and says.

Each case printed a raw identifier or a plural that read "1 votes": the
ballot mail's "(candidate selection)", a results line "1 votes", and the
delete and roll-back notices' "1 leadership members".
"""

import uuid

import pytest

from app.api.v1.endpoints.elections import _leadership_notified
from app.schemas.election import CandidateResult, ElectionResults, PositionResults
from app.services.election_service import ElectionService

pytestmark = pytest.mark.unit


class TestBallotItemList:
    def test_an_item_says_what_the_voter_does_not_its_vote_type_id(self):
        html_out, text_out = ElectionService._build_ballot_items_lists(
            [
                {
                    "title": "Chief",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                },
                {"title": "Bylaw 4", "type": "general_vote", "vote_type": "approval"},
            ]
        )
        assert "(choose a candidate)" in text_out
        assert "(approve or deny)" in text_out
        assert "candidate selection" not in text_out
        assert "candidate selection" not in html_out

    def test_an_unknown_vote_type_is_left_out_rather_than_printed_raw(self):
        _html, text_out = ElectionService._build_ballot_items_lists(
            [{"title": "Odd", "type": "", "vote_type": "something_new"}]
        )
        assert text_out == "  - Odd"


class TestResultsLines:
    def test_one_vote_is_singular(self):
        results = ElectionResults(
            election_id=uuid.uuid4(),
            election_title="Captain 2027",
            status="closed",
            total_votes=1,
            total_eligible_voters=2,
            voter_turnout_percentage=50.0,
            results_by_position=[
                PositionResults(
                    position="Captain",
                    total_votes=1,
                    candidates=[
                        CandidateResult(
                            candidate_id=uuid.uuid4(),
                            candidate_name="Blair",
                            vote_count=1,
                            percentage=100.0,
                            is_winner=True,
                        )
                    ],
                )
            ],
            overall_results=[],
        )
        _html, text_out = ElectionService.__new__(
            ElectionService
        )._build_results_tables(results)
        assert "Blair — 1 vote (" in text_out
        assert "1 votes" not in text_out


class TestLeadershipNotified:
    @pytest.mark.parametrize(
        ("count", "expected"),
        [
            (0, "0 leadership members"),
            (1, "1 leadership member"),
            (3, "3 leadership members"),
        ],
    )
    def test_counts_read_as_words(self, count, expected):
        assert _leadership_notified(count) == expected
