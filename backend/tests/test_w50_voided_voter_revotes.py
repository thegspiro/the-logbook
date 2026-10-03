"""W50-6: a member whose vote an officer voided can vote again.

``votes.vote_dedup_hash`` is UNIQUE and stayed on a soft-deleted row, so the
replacement ballot the void was meant to allow collided with it. The
collision was then answered with a 500 rather than a 400: the ``except
IntegrityError`` branches read ``election`` after the rollback had expired
it, which lazy-loads under asyncio and raises ``MissingGreenlet``.

Three regressions here:

- in-app vote, void, vote again: accepted and counted once;
- token ballot, void, a fresh token's ballot: accepted and counted once;
- a genuine dedup collision that reaches the constraint still comes back
  as a plain "already voted" error rather than an exception.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


ITEM_ID = "chief"


class TestVoidedVoterRevotes:
    @pytest.fixture
    async def setup(self, db_session: AsyncSession):
        """Open anonymous election with one 'Chief' ballot item, two candidates
        and two members (a voter and the officer who voids)."""
        org_id, voter_id, officer_id = _uid(), _uid(), _uid()
        election_id, cand_a, cand_b = _uid(), _uid(), _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York')"
            ),
            {"id": org_id, "name": "W50-6 FD", "slug": f"w506-{org_id[:8]}"},
        )
        for uid, uname in [(voter_id, "voter"), (officer_id, "officer")]:
            await db_session.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) "
                    "VALUES (:id, :org, :un, :un, 'Member', :em, 'hashed', 'active')"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": f"{uname}-{uid[:6]}",
                    "em": f"{uname}-{uid[:6]}@test.com",
                },
            )
        ballot_items = (
            f'[{{"id": "{ITEM_ID}", "type": "officer_election", "title": "Chief", '
            '"eligible_voter_types": ["all"], "vote_type": "candidate_selection", '
            '"position": "Chief"}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, ballot_items, "
                "start_date, end_date, status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Chief 2026', 'officer', '[\"Chief\"]', :items, "
                ":start, :end, 'open', 1, 0, 1, 'simple_majority', 'most_votes', "
                ":salt, 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": officer_id,
            },
        )
        for i, (cid, name) in enumerate([(cand_a, "Alpha"), (cand_b, "Bravo")]):
            await db_session.execute(
                text(
                    "INSERT INTO candidates (id, election_id, name, position, accepted, "
                    "is_write_in, display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, 'Chief', 1, 0, :ord, NOW(), NOW(), NOW())"
                ),
                {"id": cid, "eid": election_id, "name": name, "ord": i},
            )
        await db_session.flush()
        return {
            "org_id": org_id,
            "voter_id": voter_id,
            "officer_id": officer_id,
            "election_id": election_id,
            "cand_a": cand_a,
            "cand_b": cand_b,
            "salt": salt,
        }

    async def _counts(self, db_session: AsyncSession, election_id: str):
        row = (
            await db_session.execute(
                text(
                    "SELECT SUM(deleted_at IS NULL), SUM(deleted_at IS NOT NULL), "
                    "SUM(deleted_at IS NOT NULL AND vote_dedup_hash IS NOT NULL) "
                    "FROM votes WHERE election_id = :eid"
                ),
                {"eid": election_id},
            )
        ).one()
        return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)

    async def _cast(self, svc: ElectionService, data, candidate: str):
        return await svc.cast_vote(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(candidate),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )

    async def _void(self, svc: ElectionService, data, vote_id: str):
        voided = await svc.soft_delete_vote(
            vote_id=uuid.UUID(vote_id),
            deleted_by=uuid.UUID(data["officer_id"]),
            reason="keyed against the wrong member",
            organization_id=uuid.UUID(data["org_id"]),
            election_id=uuid.UUID(data["election_id"]),
        )
        assert voided is not None
        return voided

    async def test_in_app_vote_after_void_is_accepted_and_counted_once(
        self, db_session: AsyncSession, setup
    ):
        data = setup
        svc = ElectionService(db_session)

        first, err = await self._cast(svc, data, data["cand_a"])
        assert err is None, err
        voided = await self._void(svc, data, str(first.id))
        assert voided.vote_dedup_hash is None

        eligibility = await svc.check_voter_eligibility(
            uuid.UUID(data["voter_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            position="Chief",
        )
        assert eligibility.is_eligible, eligibility.reason

        second, err = await self._cast(svc, data, data["cand_b"])
        assert err is None, f"voided voter refused a replacement ballot: {err}"
        assert second is not None
        assert second.vote_dedup_hash is not None

        active, deleted, deleted_with_hash = await self._counts(
            db_session, data["election_id"]
        )
        assert (active, deleted, deleted_with_hash) == (1, 1, 0)

    async def test_token_ballot_after_void_is_accepted_and_counted_once(
        self, db_session: AsyncSession, setup
    ):
        data = setup
        svc = ElectionService(db_session)

        async def issue():
            _, raw = await svc._generate_voting_token(
                user_id=uuid.UUID(data["voter_id"]),
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
                anonymity_salt=data["salt"],
            )
            await db_session.flush()
            return raw

        result, err = await svc.submit_ballot_with_token(
            token=await issue(),
            votes=[{"ballot_item_id": ITEM_ID, "choice": data["cand_a"]}],
        )
        assert err is None, err
        assert result["votes_cast"] == 1
        vote_id = (
            await db_session.execute(
                text(
                    "SELECT id FROM votes WHERE election_id = :eid "
                    "AND deleted_at IS NULL"
                ),
                {"eid": data["election_id"]},
            )
        ).scalar_one()
        await self._void(svc, data, vote_id)

        result, err = await svc.submit_ballot_with_token(
            token=await issue(),
            votes=[{"ballot_item_id": ITEM_ID, "choice": data["cand_b"]}],
        )
        assert err is None, f"voided token voter refused a fresh ballot: {err}"
        assert result["votes_cast"] == 1

        active, deleted, deleted_with_hash = await self._counts(
            db_session, data["election_id"]
        )
        assert (active, deleted, deleted_with_hash) == (1, 1, 0)

    async def test_constraint_collision_is_an_error_not_an_exception(
        self, db_session: AsyncSession, setup
    ):
        """Force the UNIQUE constraint to fire past the application pre-check
        (the stored row's voter hash is rewritten so the pre-check cannot see
        it, while its dedup hash still matches) and assert the failure comes
        back as a message instead of MissingGreenlet."""
        data = setup
        svc = ElectionService(db_session)

        first, err = await self._cast(svc, data, data["cand_a"])
        assert err is None, err
        await db_session.execute(
            text("UPDATE votes SET voter_hash = :vh, voter_id = NULL WHERE id = :id"),
            {"vh": secrets.token_hex(32), "id": str(first.id)},
        )
        await db_session.flush()

        vote, err = await self._cast(svc, data, data["cand_a"])
        assert vote is None
        assert err is not None
        assert "already voted" in err

        active, _, _ = await self._counts(db_session, data["election_id"])
        assert active == 1
