"""Election tally: the 'majority' victory condition must mean strictly >50%.

_calculate_candidate_results decides winners. The majority threshold used to be
the float (total/2)+1, which over-required by a full vote for odd vote totals:
with 3 votes it demanded 2.5 → 3, so a candidate with 2 of 3 (66% — a clear
majority) was denied the win and a real election outcome could flip. The fix
uses floor(total/2)+1. These tests pin the boundary for odd and even totals.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from app.services.election_service import ElectionService


def _candidate(name, position="President"):
    return SimpleNamespace(id=str(uuid4()), name=name, position=position)


def _election(victory_condition="majority"):
    return SimpleNamespace(
        voting_method="simple_majority",
        victory_condition=victory_condition,
        anonymous_voting=False,
        victory_percentage=None,
        victory_threshold=None,
    )


def _votes(*pairs):
    """pairs of (candidate, count) -> flat vote list."""
    votes = []
    for cand, count in pairs:
        for _ in range(count):
            votes.append(
                SimpleNamespace(
                    candidate_id=cand.id,
                    voter_hash=str(uuid4()),
                    voter_id=str(uuid4()),
                )
            )
    return votes


async def _tally(candidates, votes, election):
    svc = ElectionService(MagicMock())
    return await svc._calculate_candidate_results(
        candidates, votes, election, total_eligible=len(votes)
    )


def _winners(results):
    return {r.candidate_name for r in results if r.is_winner}


async def test_majority_odd_total_two_of_three_wins():
    a, b = _candidate("A"), _candidate("B")
    results = await _tally([a, b], _votes((a, 2), (b, 1)), _election())
    # 2 of 3 is a 66% majority — must win (regression: float form denied it).
    assert _winners(results) == {"A"}


async def test_majority_odd_total_near_split_loses():
    a, b = _candidate("A"), _candidate("B")
    # 3 of 5 wins (>2.5); 2 of 5 does not.
    results = await _tally([a, b], _votes((a, 3), (b, 2)), _election())
    assert _winners(results) == {"A"}


async def test_majority_even_exact_half_is_not_a_majority():
    a, b = _candidate("A"), _candidate("B")
    # 2 of 4 is exactly half, not a majority -> no winner.
    results = await _tally([a, b], _votes((a, 2), (b, 2)), _election())
    assert _winners(results) == set()


async def test_majority_even_just_over_half_wins():
    a, b = _candidate("A"), _candidate("B")
    results = await _tally([a, b], _votes((a, 3), (b, 1)), _election())
    assert _winners(results) == {"A"}


async def test_most_votes_tie_marks_both():
    a, b = _candidate("A"), _candidate("B")
    results = await _tally(
        [a, b], _votes((a, 2), (b, 2)), _election(victory_condition="most_votes")
    )
    assert _winners(results) == {"A", "B"}
