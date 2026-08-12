"""Turnout must count paper ballots, which carry no voter identity.

A paper batch is recorded as an attested *count* — `record_manual_ballots`
writes one vote row per ballot with no `voter_id` and no `voter_hash`, by
design, because the officer attests a tally rather than a roster. Turnout was
computed by deduplicating those two fields, so an in-room election counted
**zero** voters however full the box was.

That was not merely a cosmetic turnout figure. A percentage quorum compares
against turnout, so it failed for every paper election, and a failed quorum
clears `is_winner` on every candidate and stamps the result "advisory only" —
a department that votes on paper never saw a winner declared.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from uuid import uuid4

from app.services.election_service import ElectionService


def _election(
    anonymous_voting=True,
    voting_method="simple_majority",
    max_votes_per_position=1,
):
    return SimpleNamespace(
        anonymous_voting=anonymous_voting,
        voting_method=voting_method,
        max_votes_per_position=max_votes_per_position,
    )


def _electronic(position="Chief"):
    voter = str(uuid4())
    return SimpleNamespace(
        position=position,
        voter_hash=voter,
        voter_id=voter,
        is_manual=False,
    )


def _paper(position="Chief", candidate_id="candidate-1"):
    return SimpleNamespace(
        position=position,
        candidate_id=candidate_id,
        voter_hash=None,
        voter_id=None,
        is_manual=True,
    )


class TestPaperBallotsCountAsVoters:
    def test_paper_only_election_counts_its_ballots(self):
        votes = [_paper() for _ in range(19)]
        assert ElectionService._count_ballots_cast(_election(), votes) == 19

    def test_paper_ballots_are_not_deduplicated_to_one(self):
        # The whole failure mode: every paper row looks identical, so any
        # identity-based count collapses the box to nothing.
        votes = [_paper() for _ in range(19)]
        assert ElectionService._count_ballots_cast(_election(), votes) != 0

    def test_electronic_votes_still_deduplicate_by_voter(self):
        # One member voting in three positions is one voter.
        voter = str(uuid4())
        votes = [
            SimpleNamespace(
                position=position,
                voter_hash=voter,
                voter_id=voter,
                is_manual=False,
            )
            for position in ("Chief", "Deputy", "Captain")
        ]
        assert ElectionService._count_ballots_cast(_election(), votes) == 1

    def test_a_paper_ballot_spanning_positions_is_one_voter(self):
        # Three positions on one physical ballot produce three manual rows.
        # Summing them would report three voters for one person in the room.
        votes = [_paper(position) for position in ("Chief", "Deputy", "Captain")]
        assert ElectionService._count_ballots_cast(_election(), votes) == 1

    def test_largest_position_tally_is_the_single_choice_ballot_count(self):
        # Not every ballot marks every position: 5 voted for Chief, 3 of them
        # also for Deputy. Five people were in the room.
        votes = [_paper("Chief") for _ in range(5)] + [
            _paper("Deputy") for _ in range(3)
        ]
        assert ElectionService._count_ballots_cast(_election(), votes) == 5

    def test_approval_selections_do_not_inflate_paper_turnout(self):
        # Three physical ballots approving two candidates produce six rows,
        # but must not satisfy quorum as though six people voted.
        votes = [
            _paper("Board", candidate_id)
            for candidate_id in ("candidate-1", "candidate-2")
            for _ in range(3)
        ]
        election = _election(voting_method="approval")
        assert ElectionService._count_ballots_cast(election, votes) == 3

    def test_multi_vote_selections_do_not_inflate_paper_turnout(self):
        votes = [
            _paper("Board", candidate_id)
            for candidate_id in ("candidate-1", "candidate-2")
            for _ in range(3)
        ]
        election = _election(max_votes_per_position=2)
        assert ElectionService._count_ballots_cast(election, votes) == 3

    def test_mixed_election_adds_paper_to_electronic(self):
        votes = [_electronic() for _ in range(4)] + [_paper() for _ in range(6)]
        assert ElectionService._count_ballots_cast(_election(), votes) == 10

    def test_named_voting_counts_the_same_way(self):
        votes = [_electronic() for _ in range(2)] + [_paper() for _ in range(3)]
        assert (
            ElectionService._count_ballots_cast(
                _election(anonymous_voting=False), votes
            )
            == 5
        )

    def test_no_votes_is_zero(self):
        assert ElectionService._count_ballots_cast(_election(), []) == 0
