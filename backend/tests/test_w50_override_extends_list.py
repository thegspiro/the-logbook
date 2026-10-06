"""W50-13: a voter override extends a restricted eligible-voter list.

The roster read "Override" and counted the member as eligible, while every
vote path still refused them as "restricted to a specific voter list". The
owner decided (2026-10-05) that the override admits the member, so the vote,
the non-voter list and the turnout denominator all agree with the roster.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from tests.test_election_lifecycle import TestLifecycleSetup

pytestmark = [pytest.mark.integration]


class TestOverrideExtendsRestrictedList(TestLifecycleSetup):
    async def _restricted_election(self, db: AsyncSession, org_id, user1_id, user2_id):
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db,
            org_id,
            user1_id,
            start=now - timedelta(hours=1),
            end=now + timedelta(days=1),
        )
        await db.execute(
            text("UPDATE elections SET eligible_voters = :ev WHERE id = :id"),
            {"ev": json.dumps([user1_id]), "id": election_id},
        )
        await db.flush()
        return election_id

    async def _override(self, db: AsyncSession, election_id, user_id, by_id):
        await db.execute(
            text("UPDATE elections SET voter_overrides = :ov WHERE id = :id"),
            {
                "ov": json.dumps(
                    [
                        {
                            "user_id": user_id,
                            "member_name": "Bob Baker",
                            "reason": "Excused absence approved",
                            "overridden_by": by_id,
                        }
                    ]
                ),
                "id": election_id,
            },
        )
        await db.flush()

    async def _candidate_id(self, db: AsyncSession, election_id) -> str:
        result = await db.execute(
            text("SELECT id FROM candidates WHERE election_id = :id"),
            {"id": election_id},
        )
        return result.scalar_one()

    async def test_member_off_the_list_without_override_is_refused(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._restricted_election(
            db_session, org_id, user1_id, user2_id
        )
        svc = ElectionService(db_session)

        verdict = await svc.check_voter_eligibility(
            uuid.UUID(user2_id), uuid.UUID(election_id), uuid.UUID(org_id)
        )

        assert verdict.is_eligible is False
        assert "specific voter list" in verdict.reason

    async def test_override_admits_the_member_and_their_vote_counts(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._restricted_election(
            db_session, org_id, user1_id, user2_id
        )
        await self._override(db_session, election_id, user2_id, user1_id)
        svc = ElectionService(db_session)

        verdict = await svc.check_voter_eligibility(
            uuid.UUID(user2_id), uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert verdict.is_eligible is True, verdict.reason

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(user2_id),
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(await self._candidate_id(db_session, election_id)),
            position="Chief",
            organization_id=uuid.UUID(org_id),
        )
        assert err is None, err
        assert vote is not None

    async def test_denominator_and_non_voters_include_the_overridden_member(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._restricted_election(
            db_session, org_id, user1_id, user2_id
        )
        await self._override(db_session, election_id, user2_id, user1_id)
        svc = ElectionService(db_session)
        election = await self._get_election(db_session, election_id)

        assert await svc._count_eligible_voters(election, uuid.UUID(org_id)) == 2

        non_voters = await svc.get_non_voters(uuid.UUID(election_id), uuid.UUID(org_id))
        assert {nv["id"] for nv in non_voters} == {user1_id, user2_id}

    async def test_denominator_without_override_is_the_list(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._restricted_election(
            db_session, org_id, user1_id, user2_id
        )
        svc = ElectionService(db_session)
        election = await self._get_election(db_session, election_id)

        assert await svc._count_eligible_voters(election, uuid.UUID(org_id)) == 1
