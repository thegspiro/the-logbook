"""W50-31: a sanctioned void no longer certifies an election CHAIN_BROKEN.

``verify_vote_integrity`` dropped voided (soft-deleted) rows before walking
the hash chain, so an officer's own void in the middle of the chain read
"Vote chain is broken — votes may have been deleted or reordered" and the
certified PDF printed CHAIN_BROKEN under "We certify that the results above
are true and correct", while voiding the chain's tail left a silent PASS.
The owner's decision: walk the voids and report them. Voided rows are now
verified with the chain, and the result names each void by officer and
reason, on the forensics panel and the certificate.
"""

import uuid

import pytest
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote
from app.services.election_service import ElectionService
from app.utils.certified_results_pdf import render_certified_results_pdf
from tests.test_election_voting_flow import TestElectionSetup


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


async def _void(svc: ElectionService, data: dict, vote, reason: str):
    voided = await svc.soft_delete_vote(
        vote_id=uuid.UUID(str(vote.id)),
        deleted_by=uuid.UUID(data["user1_id"]),
        reason=reason,
        organization_id=uuid.UUID(data["org_id"]),
        election_id=uuid.UUID(data["election_id"]),
    )
    assert voided is not None


async def _check(svc: ElectionService, data: dict) -> dict:
    return await svc.verify_vote_integrity(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"]), audit=False
    )


@pytest.mark.integration
class TestIntegrityWalksVoids(TestElectionSetup):
    async def test_a_void_mid_chain_passes_and_is_reported(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        await _vote(svc, data, "user1_id", "candidate_a_id")
        middle = await _vote(svc, data, "user2_id", "candidate_b_id")
        await _vote(svc, data, "user3_id", "candidate_a_id")

        await _void(svc, data, middle, "keyed against the wrong member")
        result = await _check(svc, data)

        assert result["integrity_status"] == "PASS"
        assert result["chain_verified"] is True
        assert result["total_votes"] == 2
        assert result["valid_signatures"] == 2
        assert result["voided_votes"] == 1
        [void] = result["voids"]
        assert void["count"] == 1
        assert void["voided_by_name"] == "Alice Anderson"
        assert void["reason"] == "keyed against the wrong member"
        assert void["voided_at"]

    async def test_a_tail_void_is_no_longer_silent(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        await _vote(svc, data, "user1_id", "candidate_a_id")
        tail = await _vote(svc, data, "user2_id", "candidate_b_id")

        await _void(svc, data, tail, "duplicate paper entry")
        result = await _check(svc, data)

        assert result["integrity_status"] == "PASS"
        assert result["voided_votes"] == 1
        assert result["voids"][0]["reason"] == "duplicate paper entry"

    async def test_a_tampered_voided_row_still_fails(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        await _vote(svc, data, "user1_id", "candidate_a_id")
        voided = await _vote(svc, data, "user2_id", "candidate_b_id")
        await _void(svc, data, voided, "keyed against the wrong member")

        row = (
            await db_session.execute(select(Vote).where(Vote.id == str(voided.id)))
        ).scalar_one()
        row.candidate_id = data["candidate_a_id"]
        await db_session.flush()

        result = await _check(svc, data)
        assert result["integrity_status"] == "FAIL"
        assert str(voided.id) in result["tampered_vote_ids"]

    async def test_no_voids_reports_none(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        await _vote(svc, data, "user1_id", "candidate_a_id")

        result = await _check(svc, data)
        assert result["integrity_status"] == "PASS"
        assert result["voided_votes"] == 0
        assert result["voids"] == []


@pytest.mark.unit
class TestCertificateNamesVoids:
    def test_each_void_is_printed_beside_the_pass(self):
        buf = render_certified_results_pdf(
            {
                "election": {"title": "Officer Election", "anonymous_voting": False},
                "results": {"results_by_position": []},
                "stats": {},
                "batches": [],
                "integrity": {
                    "integrity_status": "PASS",
                    "total_votes": 11,
                    "voided_votes": 12,
                    "voids": [
                        {
                            "count": 12,
                            "voided_by_name": "Alice Anderson",
                            "reason": "batch entered twice",
                        }
                    ],
                },
            },
            {"org_name": "W50-31 FD", "generated_at": ""},
        )
        out = " ".join(p.extract_text() for p in PdfReader(buf).pages).replace(
            "\n", " "
        )
        assert "PASS" in out
        assert "12 vote(s) voided by Alice Anderson: batch entered twice" in out
        assert "CHAIN_BROKEN" not in out
