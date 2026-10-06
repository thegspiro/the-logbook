"""W50-9: a change to a closed election's result is marked, never silent.

Merge Write-Ins, Void a Vote and a paper-batch void stay allowed after close
— they are how a certified result is corrected — but they re-issued the
tally with the certified PDF unchanged. The owner chose (2026-10-05) to keep
the corrections and mark each one "Results revised <when> by <who>" on the
PDF and the Results tab.
"""

import json
import uuid
from io import BytesIO

import pytest
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election
from app.schemas.election import ElectionResponse
from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

pytestmark = [pytest.mark.integration]


async def _election(db: AsyncSession, election_id: str) -> Election:
    election = await db.get(Election, election_id)
    await db.refresh(election)
    return election


async def _vote(svc: ElectionService, data: dict, user_key: str, candidate_key: str):
    vote, err = await svc.cast_vote(
        user_id=uuid.UUID(data[user_key]),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(data[candidate_key]),
        position="Chief",
        organization_id=uuid.UUID(data["org_id"]),
    )
    assert err is None, err
    return vote


async def _close(svc: ElectionService, data: dict) -> None:
    _closed, err = await svc.close_election(
        uuid.UUID(data["election_id"]),
        uuid.UUID(data["org_id"]),
        closed_by=uuid.UUID(data["user1_id"]),
    )
    assert err is None, err


class TestResultsRevisedMark(TestElectionSetup):
    async def test_a_void_after_close_is_stamped_with_officer_and_reason(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        vote = await _vote(svc, data, "user2_id", "candidate_a_id")
        await _close(svc, data)

        voided = await svc.soft_delete_vote(
            vote_id=uuid.UUID(vote.id),
            deleted_by=uuid.UUID(data["user1_id"]),
            reason="cast by a member who had resigned",
            organization_id=uuid.UUID(data["org_id"]),
            election_id=uuid.UUID(data["election_id"]),
        )
        assert voided is not None

        election = await _election(db_session, data["election_id"])
        (revision,) = election.results_revisions
        assert revision["action"] == "vote_voided"
        assert revision["by_name"] == "Alice Anderson"
        assert revision["detail"] == "cast by a member who had resigned"
        response = ElectionResponse.model_validate(election)
        assert response.results_revisions[0].action == "vote_voided"

    async def test_a_void_while_open_is_not_a_revision(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        vote = await _vote(svc, data, "user2_id", "candidate_a_id")

        await svc.soft_delete_vote(
            vote_id=uuid.UUID(vote.id),
            deleted_by=uuid.UUID(data["user1_id"]),
            reason="duplicate",
            organization_id=uuid.UUID(data["org_id"]),
            election_id=uuid.UUID(data["election_id"]),
        )

        election = await _election(db_session, data["election_id"])
        assert not election.results_revisions

    async def test_merging_write_ins_after_close_is_stamped(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        ids = []
        for name in ("Dana Diaz", "Dana Dias"):
            cid = str(uuid.uuid4())
            ids.append(cid)
            await db_session.execute(
                text(
                    "INSERT INTO candidates (id, election_id, name, position, "
                    "accepted, is_write_in, display_order, nomination_date, "
                    "created_at, updated_at) VALUES (:id, :eid, :name, 'Chief', "
                    "1, 1, 999, NOW(), NOW(), NOW())"
                ),
                {"id": cid, "eid": data["election_id"], "name": name},
            )
        await _close(svc, data)

        merged, err = await svc.merge_write_in_candidates(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            source_candidate_ids=[ids[1]],
            target_candidate_id=ids[0],
            merged_by=data["user1_id"],
        )
        assert err is None, err
        assert merged == 1

        election = await _election(db_session, data["election_id"])
        (revision,) = election.results_revisions
        assert revision["action"] == "write_ins_merged"
        assert revision["detail"] == "Dana Dias merged into Dana Diaz"

    async def test_a_paper_batch_void_after_close_is_stamped(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {
                "s": json.dumps(
                    {"election_features": {"paper_ballot_attestations_required": 0}}
                ),
                "id": data["org_id"],
            },
        )
        svc = ElectionService(db_session)
        _count, batch_id, err = await svc.record_manual_ballots(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            recorded_by=data["user1_id"],
            entries=[{"candidate_id": data["candidate_b_id"], "count": 2}],
        )
        assert err is None, err
        await _close(svc, data)

        voided, err = await svc.void_manual_ballot_batch(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            batch_id,
            deleted_by=data["user1_id"],
            reason="tally sheet double-counted",
        )
        assert err is None, err
        assert voided == 2

        election = await _election(db_session, data["election_id"])
        (revision,) = election.results_revisions
        assert revision["action"] == "paper_batch_voided"
        assert "tally sheet double-counted" in revision["detail"]

    async def test_the_certified_pdf_prints_the_revision(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        vote = await _vote(svc, data, "user2_id", "candidate_a_id")
        await _close(svc, data)
        await svc.soft_delete_vote(
            vote_id=uuid.UUID(vote.id),
            deleted_by=uuid.UUID(data["user1_id"]),
            reason="ineligible voter",
            organization_id=uuid.UUID(data["org_id"]),
            election_id=uuid.UUID(data["election_id"]),
        )

        buf, err, _name = await svc.build_certified_results_pdf(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert err is None, err
        pdf_text = " ".join(
            (page.extract_text() or "")
            for page in PdfReader(BytesIO(buf.getvalue())).pages
        )
        assert "Results revised" in pdf_text
        assert "Alice Anderson" in pdf_text
        assert "a vote was voided" in pdf_text

    async def test_a_rollback_to_open_clears_the_marks(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await db_session.execute(
            text("UPDATE elections SET anonymous_voting = 0 WHERE id = :id"),
            {"id": data["election_id"]},
        )
        svc = ElectionService(db_session)
        vote = await _vote(svc, data, "user2_id", "candidate_a_id")
        await _close(svc, data)
        await svc.soft_delete_vote(
            vote_id=uuid.UUID(vote.id),
            deleted_by=uuid.UUID(data["user1_id"]),
            reason="ineligible voter",
            organization_id=uuid.UUID(data["org_id"]),
            election_id=uuid.UUID(data["election_id"]),
        )

        reopened, _n, err = await svc.rollback_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            uuid.UUID(data["user1_id"]),
            "recount at the next meeting",
        )

        assert err is None, err
        assert reopened.results_revisions is None
