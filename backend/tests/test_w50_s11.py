"""Approval tally: paper ballots must be in the percentage denominator.

For approval voting `_calculate_candidate_results` sets ``total_votes`` to the
number of *identified* voters (unique voter_hash / voter_id). A paper ballot
recorded through ``record_manual_ballots`` carries neither, so in a mixed
election every paper approval lands in the numerator and none in the
denominator, and a candidate's percentage climbs past 100%.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.election_service import ElectionService

pytestmark = pytest.mark.unit


def _candidate(name):
    return SimpleNamespace(id=str(uuid4()), name=name, position="President")


def _election(anonymous):
    return SimpleNamespace(
        voting_method="approval",
        victory_condition="most_votes",
        anonymous_voting=anonymous,
        victory_percentage=None,
        victory_threshold=None,
        tie_policy="co_winners",
    )


def _electronic(cand, voter):
    return SimpleNamespace(
        candidate_id=cand.id,
        voter_hash=voter,
        voter_id=voter,
        position=cand.position,
        is_manual=False,
    )


def _paper(cand):
    # Shape written by record_manual_ballots: no voter identity at all.
    return SimpleNamespace(
        candidate_id=cand.id,
        voter_hash=None,
        voter_id=None,
        position=cand.position,
        is_manual=True,
    )


@pytest.mark.parametrize("anonymous", [True, False])
async def test_mixed_approval_percentages_stay_within_100(anonymous):
    a, b = _candidate("A"), _candidate("B")
    voter = str(uuid4())
    votes = [_electronic(a, voter), _electronic(b, voter)]
    votes += [_paper(a) for _ in range(5)]

    svc = ElectionService(MagicMock())
    results = await svc._calculate_candidate_results(
        [a, b], votes, _election(anonymous), total_eligible=10
    )

    by_name = {r.candidate_name: r for r in results}
    assert by_name["A"].vote_count == 6
    # One electronic voter plus five paper ballots: six approving voters at
    # most, so A is at 100%, never 600%, and B's one approval is 1 of 6.
    assert by_name["A"].percentage == pytest.approx(100.0)
    assert by_name["B"].percentage == pytest.approx(100.0 / 6, abs=0.01)
