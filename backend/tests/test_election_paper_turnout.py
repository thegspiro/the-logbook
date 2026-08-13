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


def _paper_in_batch(position="Chief", candidate_id="candidate-1", batch_id="batch-1"):
    vote = _paper(position, candidate_id)
    vote.manual_batch_id = batch_id
    return vote


class TestRecordedPhysicalBallotCounts:
    """The recorder can attest the physical ballot count for a batch
    (ManualBallotBatch.ballots_cast); turnout prefers it over the
    tally-derived estimate, which is only a lower bound for multi-vote
    methods."""

    def test_recorded_count_replaces_the_approval_estimate(self):
        # Ten approval ballots split 5/5 across two candidates: the tally
        # alone proves only five voters; the attested physical count
        # restores the real ten.
        election = _election(voting_method="approval")
        votes = [_paper_in_batch(candidate_id="a") for _ in range(5)] + [
            _paper_in_batch(candidate_id="b") for _ in range(5)
        ]
        assert ElectionService._count_ballots_cast(election, votes) == 5
        assert (
            ElectionService._count_ballots_cast(election, votes, {"batch-1": 10}) == 10
        )

    def test_recorded_counts_combine_via_max_not_sum(self):
        # Separate batches may tally the SAME physical ballots (e.g. one
        # batch per position), so recorded counts must never be added.
        election = _election(voting_method="approval")
        votes = [_paper_in_batch("Chief", "a", batch_id="b1") for _ in range(4)] + [
            _paper_in_batch("Deputy", "c", batch_id="b2") for _ in range(4)
        ]
        assert (
            ElectionService._count_ballots_cast(election, votes, {"b1": 6, "b2": 5})
            == 6
        )

    def test_recorded_count_never_lowers_the_estimate(self):
        # A recorded count for one batch cannot hide voters another,
        # unrecorded batch already proves.
        election = _election(voting_method="approval")
        votes = [_paper_in_batch(candidate_id="a", batch_id="b1") for _ in range(3)] + [
            _paper_in_batch(candidate_id="a", batch_id="b2") for _ in range(9)
        ]
        assert ElectionService._count_ballots_cast(election, votes, {"b1": 4}) == 12

    def test_counts_for_absent_batches_are_ignored(self):
        # A voided or unattested batch's votes are filtered out upstream;
        # its recorded count must not resurrect it.
        election = _election(voting_method="approval")
        votes = [_paper_in_batch(candidate_id="a", batch_id="b1") for _ in range(2)]
        assert (
            ElectionService._count_ballots_cast(election, votes, {"ghost": 50, "b1": 2})
            == 2
        )

    def test_recorded_count_applies_to_single_choice_too(self):
        # Not every single-choice ballot marks every position, so even here
        # the attested count can exceed the largest position tally.
        votes = [_paper_in_batch(candidate_id="a") for _ in range(3)]
        assert (
            ElectionService._count_ballots_cast(_election(), votes, {"batch-1": 5}) == 5
        )

    def test_electronic_voters_still_added_on_top(self):
        election = _election(voting_method="approval")
        votes = [_electronic() for _ in range(2)] + [
            _paper_in_batch(candidate_id="a") for _ in range(3)
        ]
        assert ElectionService._count_ballots_cast(election, votes, {"batch-1": 7}) == 9
