"""W50-32: a tied race must read as a tie in the results and the close report.

Before the fix a most_votes tie under the co_winners policy set ``is_winner``
on every tied candidate and left ``is_tied`` / ``is_tie`` False, and the close
report printed two 50% rows each marked ELECTED with no word about the tie —
or, under the runoff policy, two bare 50% rows with nothing saying that no
winner was declared and a runoff round was created.

DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.schemas.election import CandidateResult, ElectionResults, PositionResults
from app.services.election_service import ElectionService

pytestmark = pytest.mark.unit


def _candidate(name, position="Chief"):
    return SimpleNamespace(id=str(uuid4()), name=name, position=position)


def _election(tie_policy="co_winners"):
    return SimpleNamespace(
        voting_method="simple_majority",
        victory_condition="most_votes",
        anonymous_voting=False,
        victory_percentage=None,
        victory_threshold=None,
        tie_policy=tie_policy,
    )


def _votes(*pairs):
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


def _results(candidates, tie_policy):
    return ElectionResults(
        election_id=uuid4(),
        election_title="Officer Election",
        status="closed",
        total_votes=sum(c.vote_count for c in candidates),
        total_eligible_voters=10,
        voter_turnout_percentage=20.0,
        results_by_position=[
            PositionResults(
                position="Chief",
                total_votes=sum(c.vote_count for c in candidates),
                candidates=candidates,
                is_tie=any(c.is_tied for c in candidates),
            )
        ],
        overall_results=candidates,
        tie_policy=tie_policy,
    )


def _cand(name, is_winner, is_tied):
    return CandidateResult(
        candidate_id=uuid4(),
        candidate_name=name,
        position="Chief",
        vote_count=1,
        percentage=50.0,
        is_winner=is_winner,
        is_tied=is_tied,
    )


async def test_co_winners_tie_is_flagged_and_both_elected():
    a, b = _candidate("Blair"), _candidate("Devon")
    results = await _tally([a, b], _votes((a, 1), (b, 1)), _election("co_winners"))
    assert all(r.is_winner for r in results)
    assert all(r.is_tied for r in results)


async def test_runoff_tie_is_flagged_with_no_winner():
    a, b = _candidate("Blair"), _candidate("Devon")
    results = await _tally([a, b], _votes((a, 1), (b, 1)), _election("runoff"))
    assert not any(r.is_winner for r in results)
    assert all(r.is_tied for r in results)


async def test_clear_win_is_not_a_tie():
    a, b = _candidate("Blair"), _candidate("Devon")
    results = await _tally([a, b], _votes((a, 2), (b, 1)), _election("co_winners"))
    assert [r.candidate_name for r in results if r.is_winner] == ["Blair"]
    assert not any(r.is_tied for r in results)


def test_report_names_co_winner_tie():
    svc = ElectionService(MagicMock())
    tally = [_cand("Blair", True, True), _cand("Devon", True, True)]
    html_table, text_table = svc._build_results_tables(_results(tally, "co_winners"))

    assert "Tie — co-winners per the election's tie policy" in text_table
    assert "Tie — co-winners per the election&#x27;s tie policy" in html_table
    assert text_table.count("ELECTED (tie — co-winner)") == 2
    assert "Elected (tie — co-winner)" in html_table


def test_report_names_runoff_tie_and_created_round():
    svc = ElectionService(MagicMock())
    tally = [_cand("Blair", False, True), _cand("Devon", False, True)]

    _, with_runoff = svc._build_results_tables(
        _results(tally, "runoff"), runoff_created=True
    )
    assert "Tie — no winner declared; runoff round created" in with_runoff
    assert "ELECTED" not in with_runoff
    assert with_runoff.count("— TIED") == 2

    _, without_runoff = svc._build_results_tables(
        _results(tally, "runoff"), runoff_created=False
    )
    assert "but none was created" in without_runoff


def test_report_says_nothing_about_a_tie_when_there_is_none():
    svc = ElectionService(MagicMock())
    tally = [_cand("Blair", True, False), _cand("Devon", False, False)]
    html_table, text_table = svc._build_results_tables(_results(tally, "co_winners"))
    assert "Tie" not in text_table
    assert "Tie" not in html_table
    assert text_table.count("ELECTED") == 1
