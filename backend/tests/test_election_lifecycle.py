"""
Integration tests for election lifecycle automation and non-voter reminders.

Covers:
  - remind_non_voters targets only members who have not voted
  - reminder stamps reminder_sent_at and merges email_recipients
  - reminders rejected for non-open elections
  - process_election_lifecycle auto-closes overdue open elections
    (finalization side effects: salt destruction for anonymous elections)
  - auto-open only for drafts explicitly flagged auto_open
  - the automatic pre-close reminder fires exactly once
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, ElectionStatus, VotingToken
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class TestLifecycleSetup:

    @pytest.fixture
    async def setup_org_and_users(self, db_session: AsyncSession):
        """Create an organization with two active members."""
        org_id = _uid()
        user1_id = _uid()
        user2_id = _uid()

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, :otype, :slug, :tz)"
            ),
            {
                "id": org_id,
                "name": "Lifecycle Test FD",
                "otype": "fire_department",
                "slug": f"lc-{org_id[:8]}",
                "tz": "UTC",
            },
        )
        for uid, uname, fn, ln in [
            (user1_id, f"lcvoter1-{user1_id[:8]}", "Alice", "Anderson"),
            (user2_id, f"lcvoter2-{user2_id[:8]}", "Bob", "Baker"),
        ]:
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status) "
                    "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": uname,
                    "fn": fn,
                    "ln": ln,
                    "em": f"{uname}@test.com",
                    "pw": "hashed",
                },
            )
        await db_session.flush()
        return org_id, user1_id, user2_id

    async def _insert_election(
        self,
        db_session: AsyncSession,
        org_id: str,
        creator_id: str,
        *,
        status: str = "open",
        start: datetime,
        end: datetime,
        auto_open: bool = False,
        reminder_hours: int | None = None,
        with_candidate: bool = True,
    ) -> str:
        """Insert an election (and optionally one candidate) via raw SQL."""
        election_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, auto_open, "
                "reminder_hours_before_close, created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :positions, "
                ":start, :end, :status, 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', "
                "3, 0, 0, :auto_open, :rem_hours, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": f"Lifecycle Election {election_id[:8]}",
                "etype": "officer",
                "positions": '["Chief"]',
                "start": start,
                "end": end,
                "status": status,
                "salt": secrets.token_hex(32),
                "creator": creator_id,
                "auto_open": auto_open,
                "rem_hours": reminder_hours,
            },
        )
        if with_candidate:
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
                    "NOW(), NOW(), NOW())"
                ),
                {"id": _uid(), "eid": election_id},
            )
        await db_session.flush()
        return election_id

    async def _get_election(self, db_session: AsyncSession, election_id: str):
        result = await db_session.execute(
            select(Election).where(Election.id == election_id)
        )
        return result.scalar_one()


# ── remind_non_voters ────────────────────────────────────────────────


class TestRemindNonVoters(TestLifecycleSetup):

    async def test_reminds_only_non_voters(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)

        cand = (
            await db_session.execute(
                text("SELECT id FROM candidates WHERE election_id = :eid"),
                {"eid": election_id},
            )
        ).scalar_one()
        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(user1_id),
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(cand),
            position="Chief",
            organization_id=uuid.UUID(org_id),
        )
        assert err is None, f"setup vote failed: {err}"

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            reminded, failed, skipped, _details = await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )

        assert reminded == 1, f"expected only the non-voter reminded, got {reminded}"
        assert failed == 0

        election = await self._get_election(db_session, election_id)
        assert election.reminder_sent_at is not None
        # Only the non-voter (user2) received a ballot email.
        assert election.email_recipients == [user2_id]

        # The reminder issued a fresh voting token.
        tokens = (
            (
                await db_session.execute(
                    select(VotingToken).where(VotingToken.election_id == election_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(tokens) == 1

    async def test_reminder_merges_email_recipients(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """A reminder must not erase the original send's recipient record."""
        org_id, user1_id, user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, _failed, _skipped, _details, _sent_ids = await svc.send_ballot_emails(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )
            assert sent == 2

            cand = (
                await db_session.execute(
                    text("SELECT id FROM candidates WHERE election_id = :eid"),
                    {"eid": election_id},
                )
            ).scalar_one()
            _vote, err = await svc.cast_vote(
                user_id=uuid.UUID(user1_id),
                election_id=uuid.UUID(election_id),
                candidate_id=uuid.UUID(cand),
                position="Chief",
                organization_id=uuid.UUID(org_id),
            )
            assert err is None

            reminded, _failed, _skipped, _details = await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )

        assert reminded == 1
        election = await self._get_election(db_session, election_id)
        assert sorted(election.email_recipients) == sorted([user1_id, user2_id])

    async def test_reminder_rejected_for_draft_election(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="draft",
            start=now + timedelta(days=1),
            end=now + timedelta(days=2),
        )
        svc = ElectionService(db_session)

        with pytest.raises(ValueError, match="open"):
            await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
            )


# ── process_election_lifecycle ───────────────────────────────────────


class TestElectionLifecycleTask(TestLifecycleSetup):

    async def test_auto_close_overdue_election(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=2),
            end=now - timedelta(hours=1),
        )
        svc = ElectionService(db_session)

        actions = await svc.process_election_lifecycle(uuid.UUID(org_id))

        assert actions >= 1
        election = await self._get_election(db_session, election_id)
        assert election.status == ElectionStatus.CLOSED
        # Closing an anonymous election destroys the anonymity salt.
        assert election.voter_anonymity_salt is None

    async def test_auto_open_only_when_flagged(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        flagged_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="draft",
            start=now - timedelta(minutes=5),
            end=now + timedelta(days=1),
            auto_open=True,
        )
        unflagged_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="draft",
            start=now - timedelta(minutes=5),
            end=now + timedelta(days=1),
            auto_open=False,
        )
        svc = ElectionService(db_session)

        await svc.process_election_lifecycle(uuid.UUID(org_id))

        flagged = await self._get_election(db_session, flagged_id)
        unflagged = await self._get_election(db_session, unflagged_id)
        assert flagged.status == ElectionStatus.OPEN
        assert unflagged.status == ElectionStatus.DRAFT

    async def test_auto_open_skips_future_start(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="draft",
            start=now + timedelta(hours=2),
            end=now + timedelta(days=1),
            auto_open=True,
        )
        svc = ElectionService(db_session)

        await svc.process_election_lifecycle(uuid.UUID(org_id))

        election = await self._get_election(db_session, election_id)
        assert election.status == ElectionStatus.DRAFT

    async def test_auto_reminder_fires_exactly_once(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(hours=1),
            reminder_hours=2,  # window opened an hour ago
        )
        svc = ElectionService(db_session)

        send_batch = AsyncMock(side_effect=lambda batch: [True] * len(batch))
        with patch(
            "app.services.email_service.EmailService.send_batch", new=send_batch
        ):
            first = await svc.process_election_lifecycle(uuid.UUID(org_id))
            second = await svc.process_election_lifecycle(uuid.UUID(org_id))

        assert first >= 1
        assert send_batch.await_count == 1, "reminder must fire exactly once"
        election = await self._get_election(db_session, election_id)
        assert election.reminder_sent_at is not None
        assert election.status == ElectionStatus.OPEN
        assert second == 0

    async def test_no_reminder_outside_window(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(days=1),
            end=now + timedelta(hours=10),
            reminder_hours=2,  # window opens in 8 hours
        )
        svc = ElectionService(db_session)

        send_batch = AsyncMock(side_effect=lambda batch: [True] * len(batch))
        with patch(
            "app.services.email_service.EmailService.send_batch", new=send_batch
        ):
            await svc.process_election_lifecycle(uuid.UUID(org_id))

        assert send_batch.await_count == 0
        election = await self._get_election(db_session, election_id)
        assert election.reminder_sent_at is None
