"""Deleting the target of a write-in merge must not lose the merged votes.

Merging write-ins sets ``merged_into_candidate_id`` on each variant, and the
tally then counts their votes under the target. That column has no foreign key,
so deleting the target left the variants pointing at nothing: the tally still
sent their votes to the missing id, so the votes counted toward the position's
total but went to no candidate. The delete endpoint only refused a candidate
with votes of its own, and an election can be rolled back from open to draft
with votes on file, so a nominee who received none could be deleted.
"""

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import delete_candidate
from app.models.election import Candidate
from app.services.election_service import ElectionService
from tests.test_election_enhancements import EnhancementSetup

pytestmark = [pytest.mark.integration]


def _chief(results):
    chief = results.results_by_position[0]
    return chief, {c.candidate_name: c.vote_count for c in chief.candidates}


class TestDeletingAMergeTarget(EnhancementSetup):
    async def _merged_into_a_nominee(self, db_session, org_id, user_id):
        election_id = await self._insert_election(
            db_session, org_id, user_id, status="open", allow_write_ins=True
        )
        nominee = await self._insert_candidate(db_session, election_id, "Bob Baker")
        variant = await self._insert_candidate(
            db_session, election_id, "bob baker", is_write_in=True
        )
        svc = ElectionService(db_session)
        await self._record_ballots(
            svc,
            election_id,
            org_id,
            user_id,
            [{"candidate_id": variant, "count": 2}],
        )
        merged, err = await svc.merge_write_in_candidates(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            source_candidate_ids=[variant],
            target_candidate_id=nominee,
            merged_by=user_id,
        )
        assert err is None, err
        assert merged == 1
        return svc, election_id, nominee, variant

    async def test_the_merged_write_in_keeps_its_votes(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user_id, _ = setup_org_and_users
        svc, election_id, nominee, variant = await self._merged_into_a_nominee(
            db_session, org_id, user_id
        )
        # Rolled back to draft to edit the ballot; the nominee has no votes of
        # their own, so the endpoint allows the delete.
        await db_session.execute(
            text("UPDATE elections SET status = 'draft' WHERE id = :id"),
            {"id": election_id},
        )
        await delete_candidate(
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(nominee),
            db=db_session,
            current_user=SimpleNamespace(id=user_id, organization_id=org_id),
        )

        merged_into = await db_session.scalar(
            select(Candidate.merged_into_candidate_id)
            .where(Candidate.id == variant)
            .execution_options(populate_existing=True)
        )
        assert merged_into is None
        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        chief, counts = _chief(results)
        assert counts == {"bob baker": 2}
        assert chief.total_votes == 2

    async def test_a_merge_whose_target_is_gone_is_ignored(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user_id, _ = setup_org_and_users
        svc, election_id, _, variant = await self._merged_into_a_nominee(
            db_session, org_id, user_id
        )
        # A row left dangling by a delete made before the fix.
        await db_session.execute(
            text(
                "UPDATE candidates SET merged_into_candidate_id = :gone "
                "WHERE id = :id"
            ),
            {"gone": str(uuid.uuid4()), "id": variant},
        )
        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        _, counts = _chief(results)
        assert counts["bob baker"] == 2

    async def test_a_nominee_declining_releases_the_merge(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user_id, _ = setup_org_and_users
        svc, election_id, nominee, variant = await self._merged_into_a_nominee(
            db_session, org_id, user_id
        )
        await db_session.execute(
            text("UPDATE elections SET status = 'draft' WHERE id = :id"),
            {"id": election_id},
        )
        await db_session.execute(
            text("UPDATE candidates SET user_id = :uid WHERE id = :id"),
            {"uid": user_id, "id": nominee},
        )
        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=org_id,
            candidate_id=uuid.UUID(nominee),
            user_id=user_id,
            accept=False,
        )
        assert ok, err

        merged_into = await db_session.scalar(
            select(Candidate.merged_into_candidate_id)
            .where(Candidate.id == variant)
            .execution_options(populate_existing=True)
        )
        assert merged_into is None
