"""W50-65: forensics and results counters must reconcile.

The forensics report said "Total Votes: 42" beside "2 vote(s) cast" (pending
paper ballots and test ballots are chained, so the integrity check saw them,
but nothing said so); "Unused 59" counted the links a reminder had retired;
a voided paper batch listed as N "voided votes"; turnout was rounded three
ways on one page; and one Run Check wrote three ``vote_integrity_check``
rows because the forensics GET re-ran and re-logged the check.

Reuses the raw-SQL ``setup_election`` fixture (anonymous, OPEN, two accepted
candidates for "Chief", three voters, org settings NULL so paper batches
need the default two attestations and start pending).
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote, VotingToken
from app.schemas.election import ForensicsResponse, VoteIntegrityResponse
from app.services import election_service as election_service_module
from app.services.election_service import ElectionService, round_percentage
from tests.test_election_voting_flow import TestElectionSetup


async def _integrity_check_rows(db_session: AsyncSession, election_id: str) -> int:
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM audit_logs "
            "WHERE event_type = 'vote_integrity_check' "
            "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid"
        ),
        {"eid": election_id},
    )
    return int(result.scalar() or 0)


def _token(data, **overrides) -> VotingToken:
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=data["org_id"],
        election_id=data["election_id"],
        token=uuid.uuid4().hex + uuid.uuid4().hex,
        voter_hash=uuid.uuid4().hex,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        used=False,
    )
    fields.update(overrides)
    return VotingToken(**fields)


@pytest.mark.integration
class TestForensicsCounts(TestElectionSetup):
    async def _cast_electronic(self, svc, data, count):
        for uid in (data["user1_id"], data["user2_id"], data["user3_id"])[:count]:
            _, err = await svc.cast_vote(
                user_id=uuid.UUID(uid),
                election_id=uuid.UUID(data["election_id"]),
                candidate_id=uuid.UUID(data["candidate_a_id"]),
                position="Chief",
                organization_id=uuid.UUID(data["org_id"]),
            )
            assert err is None, err

    async def _record_paper(self, svc, data, count):
        recorded, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            recorded_by=data["user1_id"],
            entries=[{"candidate_id": data["candidate_b_id"], "count": count}],
            allow_over_count=True,
        )
        assert err is None, err
        assert recorded == count
        return batch_id

    async def test_integrity_breaks_total_into_counted_pending_and_test(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)

        await self._cast_electronic(svc, data, 2)
        await self._record_paper(svc, data, 3)  # pending: two attestations owed
        db_session.add(
            Vote(
                election_id=data["election_id"],
                candidate_id=data["candidate_a_id"],
                position="Chief",
                voted_at=datetime.now(timezone.utc),
                is_test=True,
            )
        )
        await db_session.flush()

        integrity = VoteIntegrityResponse.model_validate(
            await svc.verify_vote_integrity(
                uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
            )
        )
        assert integrity.total_votes == 6
        assert integrity.counted_votes == 2
        assert integrity.pending_paper_votes == 3
        assert integrity.test_votes == 1
        assert (
            integrity.counted_votes
            + integrity.pending_paper_votes
            + integrity.test_votes
            == integrity.total_votes
        )

        # The tally on the same page counts only what the report calls counted
        total_votes, _voters, _turnout = await svc.get_vote_totals(
            await svc.get_election(
                uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
            ),
            uuid.UUID(data["org_id"]),
        )
        assert total_votes == integrity.counted_votes

    async def test_tokens_split_into_used_superseded_expired_and_live(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        now = datetime.now(timezone.utc)
        db_session.add_all(
            [
                _token(data, used=True, used_at=now),
                _token(data, superseded_at=now - timedelta(hours=1)),
                _token(data, superseded_at=now - timedelta(hours=1)),
                _token(data, expires_at=now - timedelta(hours=1)),
                _token(data),
                _token(data),
                _token(data),
            ]
        )
        await db_session.flush()

        report = ForensicsResponse.model_validate(
            await ElectionService(db_session).get_election_forensics(
                uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
            )
        )
        tokens = report.voting_tokens
        assert tokens.total_issued == 7
        assert tokens.total_used == 1
        assert tokens.total_superseded == 2
        assert tokens.total_expired == 1
        assert tokens.total_live == 3
        assert sum(1 for t in tokens.records if t.superseded_at) == 2

    async def test_voided_paper_batch_is_one_batch_not_n_votes(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        batch_id = await self._record_paper(svc, data, 3)
        voided, err = await svc.void_manual_ballot_batch(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            batch_id=batch_id,
            deleted_by=data["user1_id"],
            reason="Duplicate entry of box 2",
        )
        assert err is None, err
        assert voided == 3

        report = ForensicsResponse.model_validate(
            await svc.get_election_forensics(
                uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
            )
        )
        deleted = report.deleted_votes
        assert deleted.count == 3
        assert deleted.paper_batch_count == 1
        assert all(r.is_manual for r in deleted.records)
        assert {r.manual_batch_id for r in deleted.records} == {batch_id}
        assert report.voting_timeline_timezone == "America/New_York"

    async def test_forensics_read_does_not_log_an_integrity_check(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        await self._cast_electronic(svc, data, 1)
        before = await _integrity_check_rows(db_session, data["election_id"])

        for _ in range(2):
            report = await svc.get_election_forensics(
                uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
            )
            assert report["vote_integrity"]["integrity_status"] == "PASS"
        assert await _integrity_check_rows(db_session, data["election_id"]) == before

        # The officer's explicit Run Check is still the one row that is written
        await svc.verify_vote_integrity(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert (
            await _integrity_check_rows(db_session, data["election_id"]) == before + 1
        )


@pytest.mark.unit
class TestOneRounding:
    def test_two_decimals(self):
        assert round_percentage(9.5238) == 9.52
        assert round_percentage(100) == 100.0
        assert round_percentage(2 / 3 * 100) == 66.67

    def test_no_other_precision_for_percentages_in_the_service(self):
        # 9.5% / 10% / 9.52% on one page came from three call sites each
        # picking a precision; every percentage now goes through the helper.
        # Only a percentage-shaped rounding is a regression — an unrelated
        # round() elsewhere in the service is not this test's business.
        source = Path(election_service_module.__file__).read_text()
        stray = re.findall(
            r"\bround\((?=[^\n]*(?:percent|turnout))[^\n]*", source, re.IGNORECASE
        )
        assert stray == [], stray
        assert source.count("round_percentage(") >= 7  # def + six call sites
