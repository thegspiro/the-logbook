"""W50-11: a multi-seat race elects as many candidates as it has seats.

``max_votes_per_position`` let a voter pick two, but the tally had no seat
count, so "2027 Board of Directors (2 seats)" elected one person. The owner
chose a real ``seats_per_position`` (2026-10-05): schema, migration, tally
and UI. The victory condition decides who qualifies, the seats go to the
highest qualifiers, and a tie on the last seat is flagged and settled by the
tie policy exactly as a one-seat tie is.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import update_election
from app.schemas.election import ElectionCreate, ElectionUpdate, seat_rule_error
from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

NOW = datetime.now(timezone.utc)


def _election(**overrides):
    base = dict(
        seats_per_position=2,
        voting_method="simple_majority",
        victory_condition="most_votes",
        victory_percentage=None,
        victory_threshold=None,
        tie_policy="co_winners",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


_IDS: dict = {}


def _id(name: str) -> str:
    return _IDS.setdefault(name, str(uuid.uuid4()))


def _candidates(*names):
    return [SimpleNamespace(id=_id(n), name=n, position="Board") for n in names]


def _votes(**counts):
    return [
        SimpleNamespace(
            candidate_id=_id(name), voter_hash=f"{name}-{i}", is_manual=False
        )
        for name, n in counts.items()
        for i in range(n)
    ]


async def _tally(election, candidates, votes, item=None):
    service = ElectionService(db=None)
    results = await service._calculate_candidate_results(
        candidates, votes, election, total_eligible=10, item=item
    )
    return {r.candidate_name: (r.is_winner, r.is_tied) for r in results}


@pytest.mark.unit
class TestSeatRules:
    def test_rules(self):
        assert seat_rule_error(1, 1, "simple_majority") is None
        assert seat_rule_error(2, 2, "simple_majority") is None
        assert seat_rule_error(3, 1, "approval") is None
        assert "below seats" in seat_rule_error(2, 1, "simple_majority")
        assert "ranked-choice" in seat_rule_error(2, 2, "ranked_choice")
        assert "ranked-choice" in seat_rule_error(
            2, 2, "simple_majority", [{"voting_method": "ranked_choice"}]
        )

    def test_create_refuses_a_cap_below_the_seats(self):
        with pytest.raises(ValidationError, match="below seats"):
            ElectionCreate(
                title="Board",
                start_date=NOW + timedelta(days=1),
                end_date=NOW + timedelta(days=2),
                seats_per_position=2,
            )

    def test_create_accepts_a_two_seat_race(self):
        election = ElectionCreate(
            title="Board",
            start_date=NOW + timedelta(days=1),
            end_date=NOW + timedelta(days=2),
            seats_per_position=2,
            max_votes_per_position=2,
        )
        assert election.seats_per_position == 2

    def test_seats_are_bounded(self):
        with pytest.raises(ValidationError):
            ElectionUpdate(seats_per_position=0)


@pytest.mark.unit
class TestSeatTally:
    async def test_the_top_two_fill_two_seats(self):
        tally = await _tally(
            _election(), _candidates("A", "B", "C"), _votes(A=3, B=2, C=1)
        )
        assert tally == {"A": (True, False), "B": (True, False), "C": (False, False)}

    async def test_a_tie_on_the_last_seat_follows_the_policy(self):
        votes = _votes(A=3, B=1, C=1)
        co = await _tally(_election(), _candidates("A", "B", "C"), votes)
        assert co == {"A": (True, False), "B": (True, True), "C": (True, True)}

        runoff = await _tally(
            _election(tie_policy="runoff"), _candidates("A", "B", "C"), votes
        )
        assert runoff == {
            "A": (True, False),
            "B": (False, True),
            "C": (False, True),
        }

    async def test_a_candidate_with_no_votes_takes_no_seat(self):
        tally = await _tally(_election(), _candidates("A", "B"), _votes(A=2))
        assert tally == {"A": (True, False), "B": (False, False)}

    async def test_majority_seats_only_the_qualifiers(self):
        tally = await _tally(
            _election(victory_condition="majority"),
            _candidates("A", "B", "C"),
            _votes(A=6, B=3, C=1),
        )
        assert tally["A"] == (True, False)
        assert tally["B"][0] is False

    async def test_majority_is_measured_against_ballots_not_vote_rows(self):
        # Five voters each mark A and B: ten vote rows. Against rows, A and B
        # hold 50% each and neither clears a majority; against the five
        # ballots, both were chosen by every voter.
        votes = [
            SimpleNamespace(
                candidate_id=_id(name), voter_hash=f"voter-{i}", is_manual=False
            )
            for i in range(5)
            for name in ("A", "B")
        ]
        tally = await _tally(
            _election(victory_condition="majority"),
            _candidates("A", "B", "C"),
            votes,
        )
        assert tally == {"A": (True, False), "B": (True, False), "C": (False, False)}

    async def test_a_yes_no_item_is_one_question_whatever_the_seats(self):
        item = {"id": "budget", "vote_type": "approval"}
        tally = await _tally(
            _election(), _candidates("Approve", "Deny"), _votes(Approve=3, Deny=2), item
        )
        assert tally == {"Approve": (True, False), "Deny": (False, False)}

    async def test_one_seat_is_unchanged(self):
        tally = await _tally(
            _election(seats_per_position=1),
            _candidates("A", "B"),
            _votes(A=3, B=2),
        )
        assert tally == {"A": (True, False), "B": (False, False)}


@pytest.mark.integration
class TestSeatsEndToEnd(TestElectionSetup):
    async def test_a_two_seat_board_race_elects_two(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        third = str(uuid.uuid4())
        await db_session.execute(
            text(
                "UPDATE elections SET seats_per_position = 2, "
                "max_votes_per_position = 2 WHERE id = :id"
            ),
            {"id": data["election_id"]},
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, name, position, accepted, "
                "is_write_in, display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Carol Clark', 'Chief', 1, 0, 2, NOW(), NOW(), NOW())"
            ),
            {"id": third, "eid": data["election_id"]},
        )
        svc = ElectionService(db_session)
        for user, candidates in (
            ("user1_id", ("candidate_a_id", "candidate_b_id")),
            ("user2_id", ("candidate_a_id",)),
            ("user3_id", ("candidate_b_id",)),
        ):
            for cand in candidates:
                _vote, err = await svc.cast_vote(
                    user_id=uuid.UUID(data[user]),
                    election_id=uuid.UUID(data["election_id"]),
                    candidate_id=uuid.UUID(data[cand]),
                    position="Chief",
                    organization_id=uuid.UUID(data["org_id"]),
                )
                assert err is None, err

        results = await svc.get_election_results(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            _internal_bypass_visibility=True,
        )
        (race,) = results.results_by_position
        winners = {c.candidate_name for c in race.candidates if c.is_winner}
        assert winners == {"Alice Anderson", "Bob Baker"}

    async def test_switching_a_two_seat_race_to_ranked_choice_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await db_session.execute(
            text(
                "UPDATE elections SET status = 'draft', seats_per_position = 2, "
                "max_votes_per_position = 2 WHERE id = :id"
            ),
            {"id": data["election_id"]},
        )
        user = SimpleNamespace(
            id=uuid.UUID(data["user1_id"]),
            organization_id=uuid.UUID(data["org_id"]),
        )

        with pytest.raises(HTTPException) as refused:
            await update_election(
                uuid.UUID(data["election_id"]),
                ElectionUpdate(voting_method="ranked_choice"),
                db=db_session,
                current_user=user,
            )

        assert refused.value.status_code == 400
        assert "ranked-choice" in refused.value.detail
