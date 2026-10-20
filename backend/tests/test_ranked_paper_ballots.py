"""
Ranked-choice paper ballots are entered ballot by ballot and counted by
instant runoff.

Record Paper Ballots took only per-candidate totals, which cannot carry a
ballot's order, and the runoff grouped votes by voter: a paper vote has no
voter, ``str(None)`` turned that into the key "None", and every paper vote in
a ranked race pooled into a single ballot — a stack of thirty counted as one.

A ranked race now takes ``ranked_ballots``: each physical ballot becomes one
row per ranked candidate sharing a ``paper_ballot_id``, which the count groups
by and the vote signature covers.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote
from app.schemas.election import ManualBallotsRequest
from app.services.election_service import ElectionService


def _uid() -> str:
    return str(uuid.uuid4())


def _vote(candidate_id, *, rank=None, paper_ballot_id=None):
    return SimpleNamespace(
        id=_uid(),
        candidate_id=candidate_id,
        voter_hash=None,
        voter_id=None,
        vote_rank=rank,
        paper_ballot_id=paper_ballot_id,
        position="Chief",
    )


def _counted(votes, candidate_ids):
    candidates = [
        SimpleNamespace(id=cid, name=name, position="Chief")
        for name, cid in candidate_ids.items()
    ]
    results = ElectionService(MagicMock())._calculate_ranked_choice_results(
        candidates, votes, SimpleNamespace(), 20
    )
    return {r.candidate_name: (r.vote_count, r.is_winner) for r in results}


def _ranked(rankings, copies):
    """``copies`` paper ballots ranking ``rankings``, as stored."""
    votes = []
    for _ in range(copies):
        ballot = _uid()
        votes += [
            _vote(cid, rank=rank, paper_ballot_id=ballot)
            for rank, cid in enumerate(rankings, start=1)
        ]
    return votes


@pytest.mark.unit
class TestRunoffGroupsPaperBallots:
    def test_unranked_paper_votes_each_count_as_a_ballot(self):
        a, b = _uid(), _uid()
        votes = [_vote(a) for _ in range(3)] + [_vote(b) for _ in range(2)]
        # Before the fix: Alex 1, Blair 0 — the whole stack was one ballot.
        assert _counted(votes, {"Alex": a, "Blair": b}) == {
            "Alex": (3, True),
            "Blair": (2, False),
        }

    def test_ranked_paper_ballots_transfer_on_elimination(self):
        a, b, c = _uid(), _uid(), _uid()
        votes = _ranked([a, b], 4) + _ranked([b, a], 3) + _ranked([c, b], 2)
        # First choices alone would make Alex the winner, 4-3-2. The runoff
        # eliminates Casey and moves those two ballots to Blair, 5-4.
        assert _counted(votes, {"Alex": a, "Blair": b, "Casey": c}) == {
            "Alex": (4, False),
            "Blair": (5, True),
            "Casey": (0, False),
        }


@pytest.mark.unit
class TestSignatureCoversTheGrouping:
    def _signed(self, **fields):
        vote = SimpleNamespace(
            id="v-1",
            election_id="e-1",
            candidate_id="c-1",
            voter_hash=None,
            voter_id=None,
            position="Chief",
            vote_rank=2,
            is_proxy_vote=False,
            proxy_delegating_user_id=None,
            voted_at=datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc),
            is_manual=True,
            **fields,
        )
        return ElectionService(MagicMock())._sign_vote(vote, "k" * 64)

    def test_a_vote_without_a_paper_ballot_signs_as_it_always_did(self):
        # Every existing vote has no paper_ballot_id: its signature must not
        # change, or integrity verification would flag the whole ballot box.
        assert self._signed() == self._signed(paper_ballot_id=None)

    def test_regrouping_a_ranked_row_changes_its_signature(self):
        assert self._signed(paper_ballot_id="ballot-1") != self._signed(
            paper_ballot_id="ballot-2"
        )
        assert self._signed(paper_ballot_id="ballot-1") != self._signed()


@pytest.mark.integration
class TestRecordRankedPaperBallots:
    @pytest.fixture
    async def org_and_user(self, db_session: AsyncSession):
        org_id, user_id = _uid(), _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, 'Ranked FD', 'fire_department', :slug, 'UTC', :s)"
            ),
            {
                "id": org_id,
                "slug": f"rpb-{org_id[:8]}",
                # No attestation step, so a batch counts as soon as it is keyed.
                "s": json.dumps(
                    {"election_features": {"paper_ballot_attestations_required": 0}}
                ),
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Sec', 'Retary', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"rpb-{user_id[:8]}",
                "em": f"rpb-{user_id[:8]}@test.com",
            },
        )
        await db_session.flush()
        return org_id, user_id

    async def _election(self, db, org_id, creator_id, *, method, items=None):
        now = datetime.now(timezone.utc)
        election_id = _uid()
        await db.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, tie_policy, created_at, updated_at) "
                "VALUES (:id, :org, 'Ranked Election', 'officer', :positions, "
                ":items, :start, :end, 'open', 1, 0, 1, :method, "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
                "0, 0, 'co_winners', NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps(["Chief", "Captain"]),
                "items": json.dumps(items or []),
                "method": method,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": secrets.token_hex(32),
                "creator": creator_id,
            },
        )
        ids = {}
        for name, position in (
            ("Alex", "Chief"),
            ("Blair", "Chief"),
            ("Casey", "Chief"),
            ("Pat", "Captain"),
            ("Quinn", "Captain"),
        ):
            ids[name] = _uid()
            await db.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, :pos, 1, 0, 0, NOW(), NOW())"
                ),
                {"id": ids[name], "eid": election_id, "name": name, "pos": position},
            )
        await db.flush()
        return election_id, ids

    async def _record(self, db, org_id, user_id, election_id, **kwargs):
        kwargs.setdefault("entries", [])
        return await ElectionService(db).record_manual_ballots(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            recorded_by=user_id,
            allow_over_count=True,
            **kwargs,
        )

    async def test_ranked_ballots_are_stored_grouped_and_counted_by_runoff(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="ranked_choice"
        )
        a, b, c = ids["Alex"], ids["Blair"], ids["Casey"]
        recorded, batch_id, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            ranked_ballots=[
                {"rankings": [a, b], "count": 4},
                {"rankings": [b, a], "count": 3},
                {"rankings": [c, b], "count": 2},
            ],
        )
        assert err is None, err
        assert recorded == 9  # ballots, not rows

        rows = (
            (
                await db_session.execute(
                    select(Vote).where(Vote.manual_batch_id == batch_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 18
        by_ballot: dict = {}
        for row in rows:
            by_ballot.setdefault(row.paper_ballot_id, []).append(row)
        assert len(by_ballot) == 9
        for ballot in by_ballot.values():
            assert sorted(r.vote_rank for r in ballot) == [1, 2]

        svc = ElectionService(db_session)
        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        (chief,) = [r for r in results.results_by_position if r.position == "Chief"]
        winners = [c.candidate_name for c in chief.candidates if c.is_winner]
        assert winners == ["Blair"]

        (batch,) = await svc.list_manual_ballot_batches(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert batch["total_ballots"] == 9

        integrity = await svc.verify_vote_integrity(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert integrity["integrity_status"] == "PASS", integrity

    async def test_moving_a_ranked_row_to_another_ballot_fails_verification(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="ranked_choice"
        )
        _, batch_id, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            ranked_ballots=[{"rankings": [ids["Alex"], ids["Blair"]], "count": 2}],
        )
        assert err is None, err
        row = (
            (
                await db_session.execute(
                    select(Vote)
                    .where(Vote.manual_batch_id == batch_id)
                    .where(Vote.vote_rank == 2)
                )
            )
            .scalars()
            .first()
        )
        await db_session.execute(
            text("UPDATE votes SET paper_ballot_id = :b WHERE id = :id"),
            {"b": _uid(), "id": row.id},
        )
        await db_session.flush()
        db_session.expire_all()

        integrity = await ElectionService(db_session).verify_vote_integrity(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert integrity["integrity_status"] != "PASS"

    async def test_totals_are_refused_for_a_ranked_race(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="ranked_choice"
        )
        recorded, _, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            entries=[{"candidate_id": ids["Alex"], "count": 3}],
        )
        assert recorded == 0
        assert "ranked-choice race" in err

    async def test_rankings_are_refused_for_a_race_that_is_not_ranked(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="simple_majority"
        )
        recorded, _, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            ranked_ballots=[{"rankings": [ids["Alex"], ids["Blair"]], "count": 1}],
        )
        assert recorded == 0
        assert "not a ranked-choice race" in err

    async def test_a_ballot_item_override_decides_which_entry_a_race_takes(
        self, db_session: AsyncSession, org_and_user
    ):
        # Plurality election, but the Chief race is ranked through its item.
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session,
            org_id,
            user_id,
            method="simple_majority",
            items=[
                {
                    "id": "chief",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                    "title": "Chief",
                    "position": "Chief",
                    "voting_method": "ranked_choice",
                }
            ],
        )
        recorded, _, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            entries=[{"candidate_id": ids["Pat"], "count": 2}],
            ranked_ballots=[{"rankings": [ids["Alex"], ids["Blair"]], "count": 3}],
        )
        assert err is None, err
        assert recorded == 5

    async def test_one_ballot_cannot_rank_two_races(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="ranked_choice"
        )
        recorded, _, err = await self._record(
            db_session,
            org_id,
            user_id,
            election_id,
            ranked_ballots=[{"rankings": [ids["Alex"], ids["Pat"]], "count": 1}],
        )
        assert recorded == 0
        assert "one race only" in err

    async def test_a_multi_choice_ballot_counts_once_against_the_cap(
        self, db_session: AsyncSession, org_and_user
    ):
        # One eligible member: one three-choice ballot is one ballot, not
        # three, and must pass the over-count guard unaided.
        org_id, user_id = org_and_user
        election_id, ids = await self._election(
            db_session, org_id, user_id, method="ranked_choice"
        )
        recorded, _, err = await ElectionService(db_session).record_manual_ballots(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            recorded_by=user_id,
            entries=[],
            ranked_ballots=[
                {"rankings": [ids["Alex"], ids["Blair"], ids["Casey"]], "count": 1}
            ],
        )
        assert err is None, err
        assert recorded == 1


@pytest.mark.unit
class TestRequestShape:
    def test_a_candidate_ranked_twice_is_refused(self):
        cid = uuid.uuid4()
        with pytest.raises(ValidationError, match="ranked only once"):
            ManualBallotsRequest(ranked_ballots=[{"rankings": [cid, cid]}])

    def test_an_empty_request_is_refused(self):
        with pytest.raises(ValidationError, match="No ballot entries provided"):
            ManualBallotsRequest()

    def test_totals_alone_still_validate(self):
        # The request existing callers send is unchanged.
        request = ManualBallotsRequest(
            entries=[{"candidate_id": uuid.uuid4(), "count": 3}]
        )
        assert request.ranked_ballots == []

    def test_a_ranked_ballot_defaults_to_one_copy(self):
        request = ManualBallotsRequest(ranked_ballots=[{"rankings": [uuid.uuid4()]}])
        assert request.ranked_ballots[0].count == 1
