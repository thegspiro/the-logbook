"""Election tally rules the count got wrong (app-review B5 pass 7).

Each case is a worked example that produced the wrong outcome on the code
before this change; the docstrings give the votes and what was declared.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.schemas.election import CandidateResult, ElectionResults, PositionResults
from app.services.election_service import ElectionService

pytestmark = pytest.mark.unit


def _candidate(name, position="Chief"):
    return SimpleNamespace(id=str(uuid4()), name=name, position=position)


def _election(**overrides):
    fields = dict(
        voting_method="simple_majority",
        victory_condition="most_votes",
        victory_percentage=None,
        victory_threshold=None,
        seats_per_position=1,
        max_votes_per_position=1,
        tie_policy="co_winners",
        ballot_items=None,
        anonymous_voting=False,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _vote(candidate, voter, position="Chief", rank=None):
    return SimpleNamespace(
        id=str(uuid4()),
        candidate_id=candidate.id,
        position=position,
        voter_hash=voter,
        voter_id=None,
        vote_rank=rank,
        paper_ballot_id=None,
        is_manual=False,
        manual_batch_id=None,
    )


def _service():
    return ElectionService(MagicMock())


def _winners(results):
    return {r.candidate_name for r in results if r.is_winner}


class TestOneSeatDeclaresAtMostOneWinner:
    """ELEC2-10: a one-seat race marked every candidate over the bar a winner.

    Only multi-seat races went through ``_declare_seat_winners``, which caps
    the winners at the seat count and applies the tie policy."""

    async def test_approval_majority_crowns_only_the_top_qualifier(self):
        """8 voters approve A, 7 approve B: both cleared a majority, and both
        were declared elected to one seat."""
        a, b, c = _candidate("A"), _candidate("B"), _candidate("C")
        votes = []
        for i in range(10):
            if i < 8:
                votes.append(_vote(a, f"v{i}"))
            if i < 7:
                votes.append(_vote(b, f"v{i}"))
            if i < 2:
                votes.append(_vote(c, f"v{i}"))
        election = _election(
            voting_method="approval",
            victory_condition="majority",
            max_votes_per_position=3,
        )

        results = await _service()._calculate_candidate_results(
            [a, b, c], votes, election, total_eligible=10
        )

        assert _winners(results) == {"A"}

    async def test_vote_threshold_crowns_only_the_top_qualifier(self):
        """A threshold of 3 votes: A 5, B 4 — both met it, both were elected."""
        a, b = _candidate("A"), _candidate("B")
        votes = [_vote(a, f"a{i}") for i in range(5)] + [
            _vote(b, f"b{i}") for i in range(4)
        ]
        election = _election(victory_condition="threshold", victory_threshold=3)

        results = await _service()._calculate_candidate_results(
            [a, b], votes, election, total_eligible=9
        )

        assert _winners(results) == {"A"}

    async def test_qualifiers_tied_for_the_seat_follow_the_tie_policy(self):
        """Two qualifiers level on the one seat are a tie, not two winners."""
        a, b = _candidate("A"), _candidate("B")
        votes = [_vote(a, f"a{i}") for i in range(4)] + [
            _vote(b, f"b{i}") for i in range(4)
        ]
        election = _election(
            victory_condition="threshold", victory_threshold=3, tie_policy="runoff"
        )

        results = await _service()._calculate_candidate_results(
            [a, b], votes, election, total_eligible=8
        )

        assert _winners(results) == set()
        assert {r.candidate_name for r in results if r.is_tied} == {"A", "B"}


class TestAMotionIsNeverCountedByInstantRunoff:
    """ELEC2-11: ``contest_is_ranked`` says an Approve/Deny item is never
    ranked, and the tally checked only the voting method, so a motion inside
    a ranked-choice election went through instant runoff — its tie broken by
    candidate id, its own victory condition ignored."""

    MOTION = {"id": "m1", "position": "m1", "vote_type": "approval", "title": "Bylaw"}

    def _options(self):
        return _candidate("Approve", "m1"), _candidate("Deny", "m1")

    async def test_an_even_split_is_a_tie_not_carried(self):
        approve, deny = self._options()
        votes = [_vote(approve, f"y{i}", "m1") for i in range(5)] + [
            _vote(deny, f"n{i}", "m1") for i in range(5)
        ]
        election = _election(voting_method="ranked_choice", tie_policy="runoff")

        results = await _service()._calculate_candidate_results(
            [approve, deny], votes, election, total_eligible=10, item=self.MOTION
        )

        assert _winners(results) == set()
        assert all(r.is_tied for r in results)

    async def test_the_motions_own_supermajority_applies(self):
        """Approve 6, Deny 4 is 60%: a 67% motion fails."""
        approve, deny = self._options()
        votes = [_vote(approve, f"y{i}", "m1") for i in range(6)] + [
            _vote(deny, f"n{i}", "m1") for i in range(4)
        ]
        election = _election(voting_method="ranked_choice")
        item = dict(
            self.MOTION, victory_condition="supermajority", victory_percentage=67
        )

        results = await _service()._calculate_candidate_results(
            [approve, deny], votes, election, total_eligible=10, item=item
        )

        assert _winners(results) == set()


class TestMergedWriteInsKeepTheirPaperBallot:
    """ELEC2-12: the copy made for a merged write-in's vote dropped
    ``paper_ballot_id``, and the instant-runoff count groups ranked paper
    ballots by it, so every row of a sheet carrying a merged write-in became a
    ballot of its own and its lower rankings counted as first choices."""

    def test_the_remapped_vote_keeps_every_field_the_count_reads(self):
        target, variant = _candidate("Smith"), _candidate("Smyth")
        vote = _vote(variant, None, rank=1)
        vote.paper_ballot_id = "sheet-7"
        vote.is_manual = True
        vote.manual_batch_id = "batch-1"

        (remapped,) = ElectionService._remap_merged_votes(
            [vote], {variant.id: target.id}
        )

        assert remapped.candidate_id == target.id
        assert remapped.paper_ballot_id == "sheet-7"
        assert remapped.vote_rank == 1
        assert remapped.manual_batch_id == "batch-1"

    def test_a_merged_sheet_still_counts_as_one_ballot(self):
        """7 sheets: 3x Smyth>King (Smyth a write-in merged into Smith),
        1x Jones>King, 3x King>Jones. No round is tied, so the count does not
        depend on how a tie is broken: Jones goes out first and King wins 4
        to 3. Split apart, the Smith sheets' King rankings counted as first
        choices and inflated King's count."""
        smith, smyth = _candidate("Smith"), _candidate("Smyth")
        jones, king = _candidate("Jones"), _candidate("King")

        def sheet(n, first, second):
            rows = []
            for rank, cand in ((1, first), (2, second)):
                row = _vote(cand, None, rank=rank)
                row.paper_ballot_id = f"sheet-{n}"
                row.is_manual = True
                rows.append(row)
            return rows

        votes = []
        for n in range(3):
            votes += sheet(n, smyth, king)
        votes += sheet(3, jones, king)
        for n in range(4, 7):
            votes += sheet(n, king, jones)
        remapped = ElectionService._remap_merged_votes(votes, {smyth.id: smith.id})

        results = _service()._calculate_ranked_choice_results(
            [smith, jones, king], remapped, _election(), 7
        )

        by_name = {r.candidate_name: r.vote_count for r in results}
        assert by_name["King"] == 4
        assert by_name["Smith"] == 3


class TestPackageStatusFollowsTheResult:
    """ELEC2-13: the membership-package status was decided by its own
    ``approve > deny`` count, ignoring the item's victory condition, quorum
    and write-in merges. A 67% membership vote at 6 to 4 was reported failed
    on the results screen and set the prospect's package to elected."""

    def _results(self, approve_wins: bool) -> ElectionResults:
        return ElectionResults(
            election_id=uuid4(),
            election_title="Membership",
            status="closed",
            total_votes=10,
            total_eligible_voters=10,
            voter_turnout_percentage=100.0,
            results_by_position=[
                PositionResults(
                    position="m1",
                    total_votes=10,
                    candidates=[
                        CandidateResult(
                            candidate_id=uuid4(),
                            candidate_name="Approve",
                            position="m1",
                            vote_count=6,
                            percentage=60.0,
                            is_winner=approve_wins,
                        ),
                        CandidateResult(
                            candidate_id=uuid4(),
                            candidate_name="Deny",
                            position="m1",
                            vote_count=4,
                            percentage=40.0,
                            is_winner=False,
                        ),
                    ],
                )
            ],
            overall_results=[],
        )

    async def _sync(self, approve_wins: bool):
        package = SimpleNamespace(id="pkg-1", prospect_id="p-1", status="on_ballot")
        db = MagicMock()
        packages = MagicMock()
        packages.scalars.return_value.all.return_value = [package]
        db.execute = AsyncMock(return_value=packages)
        db.commit = AsyncMock()
        service = ElectionService(db)
        service.get_election_results = AsyncMock(
            return_value=self._results(approve_wins)
        )
        service._audit = AsyncMock()
        election = SimpleNamespace(
            id="e-1",
            ballot_items=[
                {
                    "id": "m1",
                    "position": "m1",
                    "type": "membership_approval",
                    "prospect_package_id": "pkg-1",
                    "vote_type": "approval",
                }
            ],
        )
        await service._sync_package_statuses(election, "org-1")
        return package

    async def test_a_vote_the_results_call_failed_does_not_elect(self):
        package = await self._sync(approve_wins=False)

        assert package.status == "not_elected"

    async def test_a_vote_the_results_call_carried_elects(self):
        package = await self._sync(approve_wins=True)

        assert package.status == "elected"
