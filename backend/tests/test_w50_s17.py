"""W50-S17: robustness of four ``elections.manage`` endpoints.

- ``DELETE /elections/{election_id}/votes/{vote_id}`` resolves the vote
  through the election in the path, so a ``vote_id`` from another election
  is 404 rather than voided under the wrong URL, and a blank reason is
  rejected before anything reaches the audit row.
- ``POST /elections/{id}/attendees`` answers a malformed ``user_id`` with a
  validation error, not a 500.
- ``open`` / ``rollback`` answer 404, not 400, for an unknown election.
- ``PATCH`` refuses to drop a position that already has a nominee, so no
  candidate is orphaned off the ballot.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import (
    check_in_attendee,
    open_election,
    rollback_election,
    soft_delete_vote,
    update_election,
)
from app.models.election import Candidate, Vote
from app.schemas.election import AttendeeCheckIn, ElectionRollback, ElectionUpdate

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'S17 FD', 'fire_department', :slug, 'UTC', NULL)"
        ),
        {"id": org_id, "slug": f"s17-{org_id[:8]}"},
    )
    return org_id


async def _make_user(db: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'S17', 'Member', :em, 'hashed', "
            "'active', 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"s17-{user_id[:8]}",
            "em": f"s17-{user_id[:8]}@test.com",
        },
    )
    return user_id


async def _make_election(
    db: AsyncSession,
    org_id: str,
    creator: str,
    *,
    status: str,
    positions: list,
    ballot_items: list | None = None,
) -> str:
    election_id = _uid()
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, "
            "ballot_items, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, "
            "created_by, email_sent, results_visible_immediately, "
            "enable_runoffs, runoff_type, max_runoff_rounds, is_runoff, "
            "runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'S17 Election', 'general', :positions, :items, "
            ":start, :end, :status, 1, 0, 1, 'simple_majority', 'most_votes', "
            "'salt', 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), "
            "NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "positions": json.dumps(positions),
            "items": json.dumps(ballot_items or []),
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "status": status,
            "creator": creator,
        },
    )
    return election_id


async def _make_candidate(db: AsyncSession, election_id: str, position: str) -> str:
    candidate_id = _uid()
    await db.execute(
        text(
            "INSERT INTO candidates "
            "(id, election_id, name, position, accepted, is_write_in, "
            "display_order, nomination_date, created_at, updated_at) "
            "VALUES (:id, :eid, 'Nominee', :pos, 1, 0, 0, NOW(), NOW(), NOW())"
        ),
        {"id": candidate_id, "eid": election_id, "pos": position},
    )
    return candidate_id


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = await _make_org(db_session)
    admin_id = await _make_user(db_session, org_id)
    await db_session.flush()
    return SimpleNamespace(
        id=uuid.UUID(admin_id), organization_id=uuid.UUID(org_id), org_id=org_id
    )


class TestSoftDeleteVoteHonoursPathElection:
    async def test_vote_from_another_election_is_not_deleted(
        self, db_session: AsyncSession, org
    ):
        target = await _make_election(
            db_session, org.org_id, str(org.id), status="open", positions=["A"]
        )
        other = await _make_election(
            db_session, org.org_id, str(org.id), status="open", positions=["A"]
        )
        cand = await _make_candidate(db_session, other, "A")
        vote = Vote(election_id=other, candidate_id=cand, position="A")
        db_session.add(vote)
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await soft_delete_vote(
                election_id=uuid.UUID(target),
                vote_id=uuid.UUID(vote.id),
                reason="mis-keyed",
                db=db_session,
                current_user=org,
            )
        assert exc.value.status_code == 404

        await db_session.refresh(vote)
        assert vote.deleted_at is None, (
            "A vote_id that belongs to a different election than the path "
            "names must not be voided"
        )

    async def test_blank_reason_is_rejected(self, db_session: AsyncSession, org):
        election = await _make_election(
            db_session, org.org_id, str(org.id), status="open", positions=["A"]
        )
        cand = await _make_candidate(db_session, election, "A")
        vote = Vote(election_id=election, candidate_id=cand, position="A")
        db_session.add(vote)
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await soft_delete_vote(
                election_id=uuid.UUID(election),
                vote_id=uuid.UUID(vote.id),
                reason="   ",
                db=db_session,
                current_user=org,
            )
        assert exc.value.status_code in (400, 422)


class TestCheckInRejectsMalformedUserId:
    async def test_malformed_user_id_is_a_client_error(
        self, db_session: AsyncSession, org
    ):
        election = await _make_election(
            db_session, org.org_id, str(org.id), status="open", positions=["A"]
        )
        with pytest.raises(HTTPException) as exc:
            await check_in_attendee(
                election_id=uuid.UUID(election),
                check_in=AttendeeCheckIn(user_id="not-a-uuid"),
                db=db_session,
                current_user=org,
            )
        assert exc.value.status_code in (400, 422)


class TestUnknownElectionIs404:
    async def test_open(self, db_session: AsyncSession, org):
        with pytest.raises(HTTPException) as exc:
            await open_election(
                election_id=uuid.uuid4(), db=db_session, current_user=org
            )
        assert exc.value.status_code == 404

    async def test_rollback(self, db_session: AsyncSession, org):
        with pytest.raises(HTTPException) as exc:
            await rollback_election(
                election_id=uuid.uuid4(),
                rollback_data=ElectionRollback(reason="testing the unknown id"),
                db=db_session,
                current_user=org,
            )
        assert exc.value.status_code == 404


class TestPatchCannotOrphanNominees:
    async def test_removing_a_nominated_position_is_refused(
        self, db_session: AsyncSession, org
    ):
        election = await _make_election(
            db_session,
            org.org_id,
            str(org.id),
            status="nominations",
            positions=["Chief", "Captain"],
        )
        cand = await _make_candidate(db_session, election, "Chief")
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await update_election(
                election_id=uuid.UUID(election),
                election_update=ElectionUpdate(positions=["Captain"]),
                db=db_session,
                current_user=org,
            )
        assert exc.value.status_code == 400

        row = await db_session.execute(
            select(Candidate.position).where(Candidate.id == cand)
        )
        assert row.scalar_one() == "Chief"

    async def test_ballot_item_candidates_are_not_orphans(
        self, db_session: AsyncSession, org
    ):
        """A ballot-item candidate is keyed by its item, not by
        election.positions, so a PATCH carrying positions (here: adding one)
        must not report it as orphaned."""
        election = await _make_election(
            db_session,
            org.org_id,
            str(org.id),
            status="nominations",
            positions=["Chief"],
            ballot_items=[
                {
                    "id": "bylaw_amendment",
                    "type": "general_vote",
                    "title": "Bylaw amendment",
                    "vote_type": "approval",
                }
            ],
        )
        await _make_candidate(db_session, election, "bylaw_amendment")
        await db_session.flush()

        updated = await update_election(
            election_id=uuid.UUID(election),
            election_update=ElectionUpdate(positions=["Chief", "Captain"]),
            db=db_session,
            current_user=org,
        )
        assert updated.positions == ["Chief", "Captain"]
