"""
W50 S01 — ballot secrecy: the audit trail must not name the voter behind
an anonymous vote.

``close_election`` destroys ``voter_anonymity_salt`` so a voter hash can
never be reversed "even with full DB access", and ``_audit_ip`` keeps the
voter's IP out of the hash-chained audit log for the same reason. The
``vote_cast`` audit row must follow the same rule (``_audit_voter``): a row
naming ``user_id`` beside ``event_data.vote_id`` would undo both, since
``votes.candidate_id`` is one join away, audit rows are append-only so the
link would survive the close, and the forensics report hands them to any
``elections.manage`` holder. The row still stamps ``organization_id`` so it
stays visible in the org-scoped audit views.

Reuses the raw-SQL ``setup_election`` fixture (anonymous, OPEN, two
candidates for "Chief") from ``test_election_voting_flow``.
"""

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

pytestmark = [pytest.mark.integration]


async def _vote_cast_rows(db_session: AsyncSession, election_id: str):
    result = await db_session.execute(
        text(
            "SELECT user_id, organization_id, event_data FROM audit_logs "
            "WHERE event_type = 'vote_cast' "
            "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid "
            "ORDER BY id"
        ),
        {"eid": election_id},
    )
    rows = []
    for user_id, org_id, event_data in result.all():
        if isinstance(event_data, str):
            event_data = json.loads(event_data)
        rows.append((user_id, org_id, event_data))
    return rows


class TestAnonymousVoteAuditSecrecy(TestElectionSetup):
    async def test_anonymous_vote_audit_does_not_name_voter(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None
        assert vote.voter_id is None, "anonymous vote row must not carry voter_id"

        rows = await _vote_cast_rows(db_session, data["election_id"])
        assert len(rows) == 1
        user_id, org_id, event_data = rows[0]
        assert event_data["vote_id"] == str(vote.id)
        # The row is still the org's own audit event — it must stay visible
        # to the org-scoped audit views without the voter resolving it.
        assert org_id == data["org_id"]
        assert user_id is None, (
            "vote_cast audit row for an anonymous election names the voter "
            f"({user_id}) beside vote_id {vote.id}, whose candidate_id is "
            f"{vote.candidate_id}; the row outlives the salt destroyed at close"
        )
        assert data["user1_id"] not in json.dumps(event_data)

        # The forensics report echoes the same row to elections.manage.
        forensics = await svc.get_election_forensics(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        cast_entries = [
            e
            for e in forensics["audit_log"]["entries"]
            if e["event_type"] == "vote_cast"
        ]
        assert cast_entries
        assert all(e["user_id"] is None for e in cast_entries)

    async def test_anonymous_bulk_vote_audit_does_not_name_voter(
        self, db_session: AsyncSession, setup_election
    ):
        """The commit=False branch (bulk ballot) audits separately."""
        data = setup_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user2_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
            commit=False,
        )
        assert err is None
        await db_session.flush()

        rows = await _vote_cast_rows(db_session, data["election_id"])
        assert len(rows) == 1
        user_id, org_id, event_data = rows[0]
        assert event_data.get("bulk") is True
        assert event_data["vote_id"] == str(vote.id)
        assert org_id == data["org_id"]
        assert (
            user_id is None
        ), "bulk vote_cast audit row for an anonymous election names the voter"
        assert data["user2_id"] not in json.dumps(event_data)

    async def test_non_anonymous_vote_audit_keeps_voter(
        self, db_session: AsyncSession, setup_election
    ):
        """Boundary: a public-ballot election keeps the voter on the row —
        voter_id is on the vote itself, so the audit adds nothing new."""
        data = setup_election
        await db_session.execute(
            text("UPDATE elections SET anonymous_voting = 0 WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        svc = ElectionService(db_session)

        _, err = await svc.cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None

        rows = await _vote_cast_rows(db_session, data["election_id"])
        assert len(rows) == 1
        assert rows[0][0] == data["user1_id"]
