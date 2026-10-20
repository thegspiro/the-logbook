"""Removing a candidate or an attendee respects where the election stands.

* A candidate's votes cascade with it, so deleting a candidate who held only
  voided ballots erased those rows — the record of a voided ballot with
  them. Any real vote row, voided included, now blocks the delete; test
  (rehearsal) ballots do not, as they do not when editing a candidate.
* The ballot is set once voting opens, and Close Nominations freezes the
  slate; a candidate could still be deleted through both.
* An election's attendance list could be edited after it closed, rewriting
  who was present for a finished, certified vote.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import delete_candidate
from app.models.election import Candidate, Election, ElectionStatus, Vote
from app.models.user import User
from app.services.election_service import ElectionService
from tests.test_election_nominations import TestNominationSetup

pytestmark = [pytest.mark.integration]


async def _user(db: AsyncSession, user_id: str) -> User:
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one()


async def _candidate_exists(db: AsyncSession, candidate_id: str) -> bool:
    result = await db.execute(select(Candidate.id).where(Candidate.id == candidate_id))
    return result.scalar_one_or_none() is not None


class _Base(TestNominationSetup):
    async def _with_candidate(self, db, setup, *, status="draft") -> tuple:
        org_id, manager_id, _member_id = setup
        election_id = await self._insert_election(db, org_id, manager_id, status=status)
        candidate = Candidate(election_id=election_id, name="Pat", position="Chief")
        db.add(candidate)
        await db.flush()
        return org_id, manager_id, election_id, candidate.id

    async def _delete(self, db, manager_id, election_id, candidate_id):
        return await delete_candidate(
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(candidate_id),
            db=db,
            current_user=await _user(db, manager_id),
        )


class TestCandidateDelete(_Base):
    async def test_a_candidate_with_no_votes_on_a_draft_can_go(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        _org, manager_id, election_id, cand_id = await self._with_candidate(
            db_session, setup_org_and_users
        )
        await self._delete(db_session, manager_id, election_id, cand_id)
        assert not await _candidate_exists(db_session, cand_id)

    async def test_a_voided_vote_blocks_the_delete(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        _org, manager_id, election_id, cand_id = await self._with_candidate(
            db_session, setup_org_and_users
        )
        vote = Vote(
            election_id=election_id,
            candidate_id=cand_id,
            position="Chief",
            deleted_at=datetime.now(timezone.utc),
        )
        db_session.add(vote)
        await db_session.flush()
        vote_id = vote.id

        with pytest.raises(HTTPException) as exc:
            await self._delete(db_session, manager_id, election_id, cand_id)
        assert exc.value.status_code == 400
        assert "recorded votes" in exc.value.detail

        assert await _candidate_exists(db_session, cand_id)
        kept = await db_session.execute(select(Vote.id).where(Vote.id == vote_id))
        assert kept.scalar_one_or_none() == vote_id

    async def test_a_rehearsal_vote_does_not_block_the_delete(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        _org, manager_id, election_id, cand_id = await self._with_candidate(
            db_session, setup_org_and_users
        )
        db_session.add(
            Vote(
                election_id=election_id,
                candidate_id=cand_id,
                position="Chief",
                is_test=True,
            )
        )
        await db_session.flush()

        await self._delete(db_session, manager_id, election_id, cand_id)

        assert not await _candidate_exists(db_session, cand_id)

    @pytest.mark.parametrize("status", ["open", "closed", "cancelled"])
    async def test_not_once_the_election_has_left_draft(
        self, db_session: AsyncSession, setup_org_and_users, status
    ):
        _org, manager_id, election_id, cand_id = await self._with_candidate(
            db_session, setup_org_and_users, status=status
        )
        with pytest.raises(HTTPException) as exc:
            await self._delete(db_session, manager_id, election_id, cand_id)
        assert exc.value.status_code == 400
        assert "draft or taking nominations" in exc.value.detail
        assert await _candidate_exists(db_session, cand_id)

    async def test_not_once_nominations_have_closed(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, manager_id, election_id, cand_id = await self._with_candidate(
            db_session, setup_org_and_users
        )
        svc = ElectionService(db_session)
        _opened, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        closed, err = await svc.close_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert closed.status == ElectionStatus.DRAFT

        with pytest.raises(HTTPException) as exc:
            await self._delete(db_session, manager_id, election_id, cand_id)
        assert exc.value.status_code == 400
        assert "slate is final" in exc.value.detail
        assert await _candidate_exists(db_session, cand_id)


class TestAttendeeRemoval(_Base):
    async def _checked_in(self, db, setup) -> tuple:
        org_id, manager_id, member_id = setup
        election_id = await self._insert_election(db, org_id, manager_id)
        record, err = await ElectionService(db).check_in_attendee(
            uuid.UUID(election_id), org_id, uuid.UUID(member_id), manager_id
        )
        assert err is None, err
        assert record is not None
        return org_id, manager_id, member_id, election_id

    async def _set_status(self, db, election_id, status) -> None:
        await db.execute(
            update(Election).where(Election.id == election_id).values(status=status)
        )
        await db.flush()

    async def _attendee_ids(self, db, election_id) -> list:
        result = await db.execute(
            select(Election.attendees).where(Election.id == election_id)
        )
        return [a.get("user_id") for a in result.scalar_one() or []]

    @pytest.mark.parametrize(
        "status", [ElectionStatus.CLOSED, ElectionStatus.CANCELLED]
    )
    async def test_refused_once_the_election_has_ended(
        self, db_session: AsyncSession, setup_org_and_users, status
    ):
        org_id, manager_id, member_id, election_id = await self._checked_in(
            db_session, setup_org_and_users
        )
        await self._set_status(db_session, election_id, status)

        ok, err = await ElectionService(db_session).remove_attendee(
            uuid.UUID(election_id), org_id, uuid.UUID(member_id), manager_id
        )
        assert ok is False
        assert err is not None
        assert "has ended" in err
        assert member_id in await self._attendee_ids(db_session, election_id)

    async def test_allowed_while_the_election_is_open(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, manager_id, member_id, election_id = await self._checked_in(
            db_session, setup_org_and_users
        )
        await self._set_status(db_session, election_id, ElectionStatus.OPEN)

        ok, err = await ElectionService(db_session).remove_attendee(
            uuid.UUID(election_id), org_id, uuid.UUID(member_id), manager_id
        )
        assert ok, err
        assert member_id not in await self._attendee_ids(db_session, election_id)
