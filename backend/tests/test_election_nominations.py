"""
Integration tests for the nomination phase and manual (paper) ballot entry.

Covers:
  - open_nominations gating (draft-only, positional elections only)
  - member nomination (third-party pending, self-nomination accepted)
  - duplicate nomination rejection
  - nominee accept/decline (and only the nominee may respond)
  - close_nominations returns to draft; open_election then proceeds
  - lifecycle task auto-closes nominations past the deadline
  - record_manual_ballots creates flagged, signed, chained votes that
    count in results and pass full integrity verification
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate, Election, ElectionStatus, Vote
from app.services.election_service import ElectionService
from tests.queued_send_runner import capture_queued_sends

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class TestNominationSetup:

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
                "name": "Nomination Test FD",
                "otype": "fire_department",
                "slug": f"nom-{org_id[:8]}",
                "tz": "UTC",
            },
        )
        for uid, uname, fn, ln in [
            (user1_id, f"nom1-{user1_id[:8]}", "Alice", "Anderson"),
            (user2_id, f"nom2-{user2_id[:8]}", "Bob", "Baker"),
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
        status: str = "draft",
        positions: str = '["Chief"]',
        nomination_deadline: datetime | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> str:
        now = datetime.now(timezone.utc)
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
                "is_runoff, runoff_round, nomination_deadline, "
                "created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :positions, "
                ":start, :end, :status, 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', "
                "3, 0, 0, :nom_deadline, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": f"Nomination Election {election_id[:8]}",
                "etype": "officer",
                "positions": positions,
                "start": start or (now + timedelta(days=1)),
                "end": end or (now + timedelta(days=2)),
                "status": status,
                "salt": secrets.token_hex(32),
                "creator": creator_id,
                "nom_deadline": nomination_deadline,
            },
        )
        await db_session.flush()
        return election_id

    async def _get_election(self, db_session: AsyncSession, election_id: str):
        result = await db_session.execute(
            select(Election).where(Election.id == election_id)
        )
        return result.scalar_one()


class TestNominationPhase(TestNominationSetup):

    async def test_open_nominations_requires_positions(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, positions="null"
        )
        svc = ElectionService(db_session)

        election, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert election is None
        assert "position" in err

    async def test_open_nominations_requires_draft(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="open",
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)

        election, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert election is None
        assert "draft" in err.lower()

    async def test_third_party_nomination_pending_until_accepted(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)

        opened, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None
        assert opened.status == ElectionStatus.NOMINATIONS

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
            statement="Great leadership",
        )
        assert err is None
        assert candidate.accepted is False
        assert candidate.nominated_by == user1_id
        assert candidate.user_id == user2_id
        assert candidate.name == "Bob Baker"

        # Nominee accepts
        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(candidate.id),
            user_id=user2_id,
            accept=True,
        )
        assert ok is True
        refreshed = (
            await db_session.execute(
                select(Candidate).where(Candidate.id == candidate.id)
            )
        ).scalar_one()
        assert refreshed.accepted is True

    async def test_self_nomination_accepted_implicitly(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
        )
        assert err is None
        assert candidate.accepted is True
        assert candidate.user_id == user1_id

    async def test_duplicate_nomination_rejected(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        _c, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        assert err is None
        dup, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user2_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        assert dup is None
        assert "already nominated" in err

    async def test_only_nominee_can_respond(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        candidate, _err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(candidate.id),
            user_id=user1_id,  # the nominator, not the nominee
            accept=True,
        )
        assert ok is False
        assert "nominee" in err

    async def test_decline_removes_candidate(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        candidate, _err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(candidate.id),
            user_id=user2_id,
            accept=False,
        )
        assert ok is True, err
        remaining = (
            await db_session.execute(
                select(Candidate).where(Candidate.id == candidate.id)
            )
        ).scalar_one_or_none()
        assert remaining is None

    async def test_close_nominations_then_open_election(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=now - timedelta(minutes=5),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        _c, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
        )
        assert err is None

        closed, err = await svc.close_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None
        assert closed.status == ElectionStatus.DRAFT

        opened, err = await svc.open_election(uuid.UUID(election_id), uuid.UUID(org_id))
        assert err is None
        assert opened.status == ElectionStatus.OPEN

    async def test_nomination_rejected_outside_phase(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)

        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
        )
        assert candidate is None
        assert "not open" in err.lower()

    async def test_lifecycle_auto_closes_nominations_past_deadline(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="nominations",
            nomination_deadline=now - timedelta(minutes=10),
        )
        control_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="nominations",
            nomination_deadline=now + timedelta(hours=4),
        )
        svc = ElectionService(db_session)

        actions = await svc.process_election_lifecycle(uuid.UUID(org_id))

        assert actions >= 1
        past = await self._get_election(db_session, election_id)
        future = await self._get_election(db_session, control_id)
        assert past.status == ElectionStatus.DRAFT
        assert future.status == ElectionStatus.NOMINATIONS


class TestNominationsAnnouncement(TestNominationSetup):
    """The nominations-open announcement goes to each member separately,
    after the open-nominations response rather than inside it."""

    @staticmethod
    def _accept_all():
        async def send(**kwargs):
            kwargs["results_out"].extend([True] * len(kwargs["to_emails"]))
            return len(kwargs["to_emails"]), 0

        return AsyncMock(side_effect=send)

    async def test_each_member_gets_their_own_message(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        send_email = self._accept_all()
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            await svc.announce_nominations_open(election_id, org_id, user1_id)

        assert send_email.await_count == 1
        kwargs = send_email.await_args.kwargs
        # Every member is a To of their own message; nobody is BCC'd.
        assert sorted(e.split("-")[0] for e in kwargs["to_emails"]) == ["nom1", "nom2"]
        assert not kwargs.get("bcc_emails")
        assert kwargs["subject"].startswith("Nominations Open:")

    async def test_opening_nominations_does_not_send_inline(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)

        send_email = self._accept_all()
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            opened, err = await ElectionService(db_session).open_nominations(
                uuid.UUID(election_id), uuid.UUID(org_id)
            )

        assert err is None
        assert opened is not None
        assert send_email.await_count == 0

    async def test_nothing_is_announced_once_nominations_have_closed(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        await svc.close_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        send_email = self._accept_all()
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            await svc.announce_nominations_open(election_id, org_id, user1_id)

        assert send_email.await_count == 0

    async def test_the_endpoint_queues_the_announcement_as_a_job(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from app.api.v1.endpoints.elections import (
            open_nominations as open_nominations_endpoint,
        )
        from app.services.ballot_send_jobs import NominationsAnnouncementSend

        org_id, user1_id, _user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)

        send_email = self._accept_all()
        async with capture_queued_sends(db_session) as queued:
            with patch(
                "app.services.email_service.EmailService.send_email", new=send_email
            ):
                response = await open_nominations_endpoint(
                    election_id=uuid.UUID(election_id),
                    db=db_session,
                    current_user=SimpleNamespace(id=user1_id, organization_id=org_id),
                )
                # Nothing is mailed inside the request.
                assert send_email.await_count == 0
                assert response.nominations_announcement is not None
                assert response.nominations_announcement.kind == "announcement"
                assert response.nominations_announcement.status == "queued"
                assert len(queued.queued) == 1
                _job_id, _org, send = queued.queued[0]
                assert send == NominationsAnnouncementSend(acting_user_id=user1_id)
                assert await queued.drain() == 1

        assert send_email.await_count == 1


class TestNominationsAnnouncementJob(TestNominationSetup):
    """The announcement runs as a job the election page reads, and a miss
    reaches the managers."""

    @staticmethod
    def _send_email(refuse: int = 0, raises: bool = False):
        async def send(**kwargs):
            if raises:
                raise RuntimeError("SMTP down")
            outcomes = [i >= refuse for i in range(len(kwargs["to_emails"]))]
            kwargs["results_out"].extend(outcomes)
            return sum(outcomes), len(outcomes) - sum(outcomes)

        return AsyncMock(side_effect=send)

    async def _open_and_run(
        self, db_session, org_id, user_id, election_id, send_email, *, close=False
    ):
        from app.api.v1.endpoints.elections import (
            _build_election_response,
        )
        from app.api.v1.endpoints.elections import (
            open_nominations as open_nominations_endpoint,
        )

        alert = AsyncMock(return_value=1)
        async with capture_queued_sends(db_session) as queued:
            with (
                patch(
                    "app.services.email_service.EmailService.send_email",
                    new=send_email,
                ),
                patch.object(ElectionService, "_email_election_managers", new=alert),
            ):
                await open_nominations_endpoint(
                    election_id=uuid.UUID(election_id),
                    db=db_session,
                    current_user=SimpleNamespace(id=user_id, organization_id=org_id),
                )
                if close:
                    await ElectionService(db_session).close_nominations(
                        uuid.UUID(election_id), uuid.UUID(org_id)
                    )
                await queued.drain()
        election = await db_session.get(Election, election_id)
        await db_session.refresh(election)
        response = await _build_election_response(db_session, election)
        return response.nominations_announcement, alert

    async def _audit_events(self, db_session, event_type, election_id):
        rows = await db_session.execute(
            text(
                "SELECT organization_id, event_data FROM audit_logs "
                "WHERE event_type = :type "
                "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid"
            ),
            {"type": event_type, "eid": election_id},
        )
        return rows.all()

    async def test_a_complete_announcement_reports_who_was_told(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)

        job, alert = await self._open_and_run(
            db_session, org_id, user1_id, election_id, self._send_email()
        )

        assert job is not None
        assert job.status == "completed"
        assert job.result is not None
        assert job.result.success
        assert job.result.recipients_count == 2
        assert job.result.message == "Nominations announcement emailed to 2 member(s)."
        alert.assert_not_awaited()

    async def test_a_missed_member_is_counted_audited_and_alerted(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)

        job, alert = await self._open_and_run(
            db_session, org_id, user1_id, election_id, self._send_email(refuse=1)
        )

        assert job is not None
        assert job.status == "completed"
        assert job.result is not None
        assert not job.result.success
        assert (job.result.recipients_count, job.result.failed_count) == (1, 1)
        assert job.result.message == (
            "Nominations announcement emailed to 1 member(s); 1 could not be "
            "reached."
        )
        alert.assert_awaited_once()
        assert "did not reach everyone" in alert.await_args.kwargs["subject"]
        [(audit_org, data)] = await self._audit_events(
            db_session, "nominations_announcement_failed", election_id
        )
        assert audit_org == org_id
        assert '"unreached": 1' in data

    async def test_a_send_that_fails_outright_fails_the_job_and_alerts(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)

        job, alert = await self._open_and_run(
            db_session, org_id, user1_id, election_id, self._send_email(raises=True)
        )

        assert job is not None
        assert job.status == "failed"
        assert job.error
        alert.assert_awaited_once()
        [(audit_org, data)] = await self._audit_events(
            db_session, "nominations_announcement_failed", election_id
        )
        assert audit_org == org_id
        assert '"raised": true' in data
        # The phase stays open: the announcement never undoes the transition.
        election = await db_session.get(Election, election_id)
        assert election.status == ElectionStatus.NOMINATIONS

    async def test_nominations_closed_before_it_ran_sends_nothing_quietly(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        send_email = self._send_email()

        job, alert = await self._open_and_run(
            db_session, org_id, user1_id, election_id, send_email, close=True
        )

        assert job is not None
        assert job.status == "completed"
        assert job.result is not None
        assert job.result.message.startswith("Nominations closed before")
        send_email.assert_not_awaited()
        alert.assert_not_awaited()

    async def test_a_second_opening_does_not_overlap_a_running_announcement(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from app.api.v1.endpoints.elections import (
            open_nominations as open_nominations_endpoint,
        )

        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        user = SimpleNamespace(id=user1_id, organization_id=org_id)
        svc = ElectionService(db_session)

        async with capture_queued_sends(db_session) as queued:
            await open_nominations_endpoint(
                election_id=uuid.UUID(election_id), db=db_session, current_user=user
            )
            await svc.close_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
            await open_nominations_endpoint(
                election_id=uuid.UUID(election_id), db=db_session, current_user=user
            )
            assert len(queued.queued) == 1

    async def test_members_without_manage_do_not_see_the_announcement(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from app.api.v1.endpoints.elections import _build_election_response

        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        await self._open_and_run(
            db_session, org_id, user1_id, election_id, self._send_email()
        )
        election = await db_session.get(Election, election_id)
        member = SimpleNamespace(
            positions=[SimpleNamespace(permissions=["elections.view"])], rank=None
        )
        manager = SimpleNamespace(
            positions=[SimpleNamespace(permissions=["elections.manage"])], rank=None
        )

        as_member = await _build_election_response(db_session, election, member)
        as_manager = await _build_election_response(db_session, election, manager)

        assert as_member.nominations_announcement is None
        assert as_manager.nominations_announcement is not None

    async def test_an_abandoned_announcement_reads_as_interrupted(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from app.services.ballot_send_jobs import (
            ANNOUNCEMENT_INTERRUPTED_ERROR,
            STALE_JOB_AFTER,
            latest_job,
        )

        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        async with capture_queued_sends(db_session):
            from app.api.v1.endpoints.elections import (
                open_nominations as open_nominations_endpoint,
            )

            await open_nominations_endpoint(
                election_id=uuid.UUID(election_id),
                db=db_session,
                current_user=SimpleNamespace(id=user1_id, organization_id=org_id),
            )
        await db_session.execute(
            text(
                "UPDATE ballot_send_jobs SET created_at = :when "
                "WHERE election_id = :eid"
            ),
            {
                "when": datetime.now(timezone.utc)
                - STALE_JOB_AFTER
                - timedelta(minutes=1),
                "eid": election_id,
            },
        )
        db_session.expire_all()

        job = await latest_job(db_session, election_id, org_id, kind="announcement")

        assert job is not None
        assert job.status == "failed"
        assert job.error == ANNOUNCEMENT_INTERRUPTED_ERROR


class TestManualBallots(TestNominationSetup):

    async def _open_election_with_candidates(
        self,
        db_session: AsyncSession,
        org_id: str,
        creator_id: str,
        *,
        end: datetime | None = None,
    ):
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            creator_id,
            status="open",
            start=now - timedelta(days=1),
            end=end or (now + timedelta(days=1)),
        )
        cand_ids = []
        for name, order in [("Casey Chief", 0), ("Dana Deputy", 1)]:
            cid = _uid()
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, 'Chief', 1, 0, :ord, "
                    "NOW(), NOW(), NOW())"
                ),
                {"id": cid, "eid": election_id, "name": name, "ord": order},
            )
            cand_ids.append(cid)
        await db_session.flush()
        return election_id, cand_ids

    async def test_record_manual_ballots_counts_and_verifies(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id, cand_ids = await self._open_election_with_candidates(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        # One electronic vote first, so integrity runs over a mixed box.
        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(user1_id),
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(cand_ids[0]),
            position="Chief",
            organization_id=uuid.UUID(org_id),
        )
        assert err is None, f"electronic vote failed: {err}"

        recorded, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[
                {"candidate_id": cand_ids[0], "count": 3},
                {"candidate_id": cand_ids[1], "count": 2},
            ],
            notes="Paper ballots from the March meeting",
            # The fixture org has only 2 eligible members, so 5 ballots trip
            # the plausibility guard (covered by TestHardening); this test is
            # about counting/signing/chaining, so override it.
            allow_over_count=True,
        )
        assert err is None
        assert recorded == 5

        votes = (
            (
                await db_session.execute(
                    select(Vote).where(Vote.election_id == election_id)
                )
            )
            .scalars()
            .all()
        )
        manual = [v for v in votes if v.is_manual]
        assert len(manual) == 5
        assert all(v.recorded_by == user1_id for v in manual)
        assert all(v.voter_hash is None and v.voter_id is None for v in manual)
        assert all(v.vote_dedup_hash is None for v in manual)

        # The full mixed ballot box passes signature + chain verification.
        integrity = await svc.verify_vote_integrity(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert integrity["integrity_status"] == "PASS", integrity

    async def test_manual_ballots_require_open_election(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)

        recorded, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": _uid(), "count": 1}],
        )
        assert recorded == 0
        assert "open" in err.lower()

    async def test_manual_ballots_reject_foreign_candidate(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id, _cand_ids = await self._open_election_with_candidates(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        recorded, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": _uid(), "count": 2}],
        )
        assert recorded == 0
        assert "candidate" in err.lower()

    async def test_manual_ballots_count_in_results(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        # end_date in the past: results are gated on now > end_date AND
        # status CLOSED. Manual-ballot recording only checks status OPEN,
        # so the paper tally can still be keyed in before closing.
        election_id, cand_ids = await self._open_election_with_candidates(
            db_session,
            org_id,
            user1_id,
            end=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        svc = ElectionService(db_session)

        # Attestation off for this test — it is about results counting;
        # the pending-until-attested behavior is covered by TestAttestations.
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :org"),
            {
                "s": '{"election_features": '
                '{"paper_ballot_attestations_required": 0}}',
                "org": org_id,
            },
        )
        await db_session.flush()

        _n, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cand_ids[1], "count": 4}],
            # 4 ballots > 2 eligible members trips the plausibility guard
            # (covered by TestHardening); this test is about results counting.
            allow_over_count=True,
        )
        assert err is None

        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None

        results = await svc.get_election_results(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        counts = {
            c.candidate_name: c.vote_count
            for pr in results.results_by_position
            for c in pr.candidates
        }
        assert counts.get("Dana Deputy") == 4


class TestFeatureToggles(TestNominationSetup):
    """Departments can turn each new feature off; auto-close never turns off."""

    async def _disable_features(self, db_session, org_id, **flags):
        import json

        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps({"election_features": flags}), "id": org_id},
        )
        await db_session.flush()

    async def test_open_nominations_blocked_when_disabled(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await self._disable_features(db_session, org_id, nominations_enabled=False)
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)

        election, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert election is None
        assert "disabled" in err

    async def test_manual_ballots_blocked_when_disabled(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await self._disable_features(db_session, org_id, paper_ballots_enabled=False)
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="open",
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)

        recorded, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": _uid(), "count": 1}],
        )
        assert recorded == 0
        assert "disabled" in err

    async def test_reminders_blocked_when_disabled(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await self._disable_features(db_session, org_id, reminders_enabled=False)
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="open",
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        svc = ElectionService(db_session)

        with pytest.raises(ValueError, match="disabled"):
            await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
            )

    async def test_lifecycle_respects_auto_open_flag_but_still_closes(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """With every toggle off, flagged drafts stay drafts — but overdue
        open elections STILL close (finalization/privacy is not optional)."""
        import json

        org_id, user1_id, _ = setup_org_and_users
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {
                "s": json.dumps(
                    {
                        "election_features": {
                            "nominations_enabled": False,
                            "paper_ballots_enabled": False,
                            "reminders_enabled": False,
                            "auto_open_enabled": False,
                        }
                    }
                ),
                "id": org_id,
            },
        )
        await db_session.flush()

        now = datetime.now(timezone.utc)
        flagged_draft_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="draft",
            start=now - timedelta(minutes=10),
            end=now + timedelta(days=1),
        )
        await db_session.execute(
            text("UPDATE elections SET auto_open = 1 WHERE id = :id"),
            {"id": flagged_draft_id},
        )
        # Give the draft an accepted candidate so the ONLY thing keeping it
        # a draft is the disabled auto_open toggle, not open-validation.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": _uid(), "eid": flagged_draft_id},
        )
        overdue_open_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            status="open",
            start=now - timedelta(days=2),
            end=now - timedelta(hours=1),
        )
        await db_session.flush()

        svc = ElectionService(db_session)
        await svc.process_election_lifecycle(uuid.UUID(org_id))

        draft = await self._get_election(db_session, flagged_draft_id)
        closed = await self._get_election(db_session, overdue_open_id)
        assert draft.status == ElectionStatus.DRAFT
        assert closed.status == ElectionStatus.CLOSED


class TestHardening(TestNominationSetup):
    """Hardening pass: over-count guard, batch void, reminder cooldown,
    superseded-token expiry, nominee notification, pending-nomination cap."""

    async def _open_election_with_candidate(
        self, db_session: AsyncSession, org_id: str, creator_id: str
    ):
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            creator_id,
            status="open",
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        cid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id},
        )
        await db_session.flush()
        return election_id, cid

    async def test_over_count_guard_and_override(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """A batch exceeding eligible-voters x max_votes is rejected; the
        audited override records it anyway."""
        org_id, user1_id, _ = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        # Two eligible members, max 1 vote each -> 3 paper ballots implausible
        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 3}],
        )
        assert recorded == 0
        assert batch is None
        assert "eligible" in err

        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 3}],
            allow_over_count=True,
        )
        assert err is None
        assert recorded == 3
        assert batch is not None

    async def test_pending_batch_does_not_occupy_plausibility_cap(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """W50-40: a pending (unattested) over-count batch does not count
        toward the cap, so an ordinary batch keyed in afterwards is accepted
        without the override; once the batch is confirmed it does count."""
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        # Default attestation setting (2): the override batch stays pending.
        recorded, over_batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 40}],
            allow_over_count=True,
        )
        assert err is None, err
        assert recorded == 40

        # Two eligible members, one vote each: a single ballot is plausible
        # on its own and must not be refused because of the pending claim.
        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 1}],
        )
        assert err is None, err
        assert recorded == 1
        assert batch is not None

        # Confirm the over-count batch directly: the test is about what the
        # cap reads, not the attestation flow (covered by TestAttestations).
        await db_session.execute(
            text(
                "UPDATE manual_ballot_batches SET status = 'confirmed', "
                "confirmed_at = NOW() WHERE id = :bid"
            ),
            {"bid": over_batch},
        )
        await db_session.flush()

        # Confirmed, those 40 ballots now fill the cap and the guard fires.
        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user2_id,
            entries=[{"candidate_id": cid, "count": 1}],
        )
        assert recorded == 0
        assert batch is None
        assert "eligible" in err

    async def test_attested_ballot_count_guard_and_override(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """An attested physical count above the eligible roster is rejected.

        The per-position guard passes here — 2 votes for 2 eligible members
        is plausible — but turnout and quorum trust ``ballots_cast``
        directly, so an unchecked 100 certifies a quorum out of an empty
        room.
        """
        org_id, user1_id, _ = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
            ballots_cast=100,
        )
        assert recorded == 0
        assert batch is None
        assert "eligible" in err

        # At the roster limit it is plausible, so it goes through untouched.
        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
            ballots_cast=2,
        )
        assert err is None, err
        assert recorded == 2

        # And the same audited override that clears the per-position guard
        # clears this one.
        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
            ballots_cast=100,
            allow_over_count=True,
        )
        assert err is None, err
        assert recorded == 2
        assert batch is not None

    async def test_void_manual_ballot_batch(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        recorded, batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
        )
        assert err is None, err

        voided, err = await svc.void_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch,
            deleted_by=user1_id,
            reason="Mis-keyed tally",
        )
        assert err is None
        assert voided == 2

        active = (
            (
                await db_session.execute(
                    select(Vote)
                    .where(Vote.election_id == election_id)
                    .where(Vote.deleted_at.is_(None))
                )
            )
            .scalars()
            .all()
        )
        assert active == []

        # Second void of the same batch finds nothing.
        voided, err = await svc.void_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch,
            deleted_by=user1_id,
            reason="again",
        )
        assert voided == 0
        assert err is not None

    async def test_reminder_cooldown(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from unittest.mock import AsyncMock, patch

        org_id, user1_id, _ = setup_org_and_users
        election_id, _cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, _f, _s, _d = await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )
            assert sent == 2

            with pytest.raises(ValueError, match="recently"):
                await svc.remind_non_voters(
                    election_id=uuid.UUID(election_id),
                    organization_id=uuid.UUID(org_id),
                    base_ballot_url="https://fd.example/ballot",
                )

    async def test_reminder_expires_superseded_tokens(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """After a confirmed-delivery reminder, the member's older unused
        tokens are expired; only the fresh token stays live."""
        from unittest.mock import AsyncMock, patch

        from app.models.election import VotingToken

        org_id, user1_id, _ = setup_org_and_users
        election_id, _cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            # Initial ballot send mints the first tokens.
            await svc.send_ballot_emails(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )
            reminded, _f, _s, _d = await svc.remind_non_voters(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                base_ballot_url="https://fd.example/ballot",
            )
        assert reminded == 2

        now = datetime.now(timezone.utc)
        tokens = (
            (
                await db_session.execute(
                    select(VotingToken).where(VotingToken.election_id == election_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(tokens) == 4  # 2 initial + 2 reminder
        live = [t for t in tokens if t.expires_at.replace(tzinfo=timezone.utc) > now]
        # Exactly one live token per member — the reminder's.
        assert len(live) == 2
        # The retired ones are marked as replaced, not merely expired, so the
        # ballot page can say a newer email holds the working link (W50-27).
        assert all(t.superseded_at is None for t in live)
        assert all(t.superseded_at is not None for t in tokens if t not in live)

    async def test_nominee_notification_sent(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from unittest.mock import AsyncMock, patch

        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        send_email = AsyncMock(return_value=(1, 0))
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            candidate, err = await svc.create_nomination(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                nominator_id=user1_id,
                position="Chief",
                nominee_user_id=user2_id,
            )
        assert err is None
        assert send_email.await_count == 1
        to_emails = send_email.await_args.kwargs["to_emails"]
        assert len(to_emails) == 1
        assert to_emails[0].startswith("nom2-")

    async def _nominate_user2(self, db_session, org_id, user1_id, user2_id):
        from unittest.mock import AsyncMock, patch

        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        send_email = AsyncMock(return_value=(1, 0))
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            candidate, err = await svc.create_nomination(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                nominator_id=user1_id,
                position="Chief",
                nominee_user_id=user2_id,
            )
        assert err is None, err
        return election_id, candidate, send_email

    async def _bell_notices(self, db_session, recipient_id):
        from app.models.notification import NotificationLog

        result = await db_session.execute(
            select(NotificationLog).where(
                NotificationLog.recipient_id == recipient_id,
                NotificationLog.category == "election_nomination",
            )
        )
        return list(result.scalars().all())

    async def test_nominee_gets_a_bell_notice_linking_to_the_nominations_tab(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, candidate, send_email = await self._nominate_user2(
            db_session, org_id, user1_id, user2_id
        )

        (notice,) = await self._bell_notices(db_session, user2_id)
        assert notice.channel.value == "in_app"
        assert notice.action_url == f"/elections/{election_id}?tab=nominations"
        assert "Chief" in notice.subject
        assert notice.notification_metadata["candidate_id"] == str(candidate.id)
        # The email carries the same destination as an absolute link.
        html_body = send_email.await_args.kwargs["html_body"]
        assert f"/elections/{election_id}?tab=nominations" in html_body

    async def test_bell_notice_ignores_an_election_email_opt_out(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """Muting election email must not hide a request only the nominee
        can answer."""
        import json

        org_id, user1_id, user2_id = setup_org_and_users
        await db_session.execute(
            text("UPDATE users SET notification_preferences = :p WHERE id = :id"),
            {"p": json.dumps({"email_notifications": False}), "id": user2_id},
        )
        await db_session.flush()

        _eid, _cand, send_email = await self._nominate_user2(
            db_session, org_id, user1_id, user2_id
        )

        assert send_email.await_count == 0
        assert len(await self._bell_notices(db_session, user2_id)) == 1

    async def test_self_nomination_sends_no_bell_notice(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _user2_id = setup_org_and_users
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        _candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
        )

        assert err is None, err
        assert await self._bell_notices(db_session, user1_id) == []

    async def test_pending_nomination_cap(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        from unittest.mock import AsyncMock, patch

        org_id, user1_id, user2_id = setup_org_and_users
        # Cap requires many nominees; insert extra members.
        extra_ids = []
        for i in range(ElectionService.MAX_PENDING_NOMINATIONS_PER_MEMBER):
            uid = _uid()
            extra_ids.append(uid)
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
                    "un": f"extra{i}-{uid[:8]}",
                    "fn": "Extra",
                    "ln": f"Member{i}",
                    "em": f"extra{i}-{uid[:8]}@test.com",
                    "pw": "hashed",
                },
            )
        await db_session.flush()

        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))

        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(return_value=(1, 0)),
        ):
            for uid in extra_ids:
                _c, err = await svc.create_nomination(
                    election_id=uuid.UUID(election_id),
                    organization_id=uuid.UUID(org_id),
                    nominator_id=user1_id,
                    position="Chief",
                    nominee_user_id=uid,
                )
                assert err is None, err

            blocked, err = await svc.create_nomination(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                nominator_id=user1_id,
                position="Chief",
                nominee_user_id=user2_id,
            )
        assert blocked is None
        assert "pending nominations" in err


class TestAttestations(TestNominationSetup):
    """Officer attestation of paper-ballot batches: with the default org
    setting (2), a recorded batch stays pending — excluded from results and
    stats — until two officers other than the recorder confirm it."""

    async def _open_election_with_candidate(
        self, db_session: AsyncSession, org_id: str, creator_id: str
    ):
        now = datetime.now(timezone.utc)
        election_id = await self._insert_election(
            db_session,
            org_id,
            creator_id,
            status="open",
            start=now - timedelta(days=1),
            end=now + timedelta(days=1),
        )
        cid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id},
        )
        await db_session.flush()
        return election_id, cid

    async def _add_member(
        self, db_session: AsyncSession, org_id: str, first: str, last: str
    ) -> str:
        uid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"att-{uid[:8]}",
                "fn": first,
                "ln": last,
                "em": f"att-{uid[:8]}@test.com",
            },
        )
        await db_session.flush()
        return uid

    async def test_batch_pending_until_required_attestations(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """Default setting (2): votes stay out of stats until two officers
        other than the recorder attest; then they count."""
        org_id, user1_id, user2_id = setup_org_and_users
        user3_id = await self._add_member(db_session, org_id, "Cora", "Cruz")
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        recorded, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
        )
        assert err is None, err
        assert recorded == 2

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.manual_votes == 0
        assert stats.total_votes_cast == 0

        result1, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert err is None, err
        assert result1 == {"attestations": 1, "required": 2, "status": "pending"}

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.manual_votes == 0

        result2, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user3_id,
        )
        assert err is None, err
        assert result2 == {
            "attestations": 2,
            "required": 2,
            "status": "confirmed",
        }

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.manual_votes == 2
        assert stats.total_votes_cast == 2

    async def test_recorder_cannot_attest_and_no_duplicates(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        _r, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 1}],
        )
        assert err is None, err

        blocked, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user1_id,
        )
        assert blocked is None
        assert "own batch" in err

        ok, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert err is None, err
        assert ok["attestations"] == 1

        dup, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert dup is None
        assert "already attested" in err

    async def test_setting_zero_disables_attestation(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :org"),
            {
                "s": '{"election_features": '
                '{"paper_ballot_attestations_required": 0}}',
                "org": org_id,
            },
        )
        await db_session.flush()
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        recorded, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
        )
        assert err is None, err
        assert recorded == 2

        batches = await svc.list_manual_ballot_batches(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert len(batches) == 1
        assert batches[0]["status"] == "confirmed"
        assert batches[0]["required_attestations"] == 0

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.manual_votes == 2

    async def test_pending_batch_excluded_at_close_and_flagged(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """A batch never attested is excluded from certified results, the
        close is flagged in the audit log, and late attestation is refused."""
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        _r, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
        )
        assert err is None, err

        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert closed.status == ElectionStatus.CLOSED

        flagged = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_logs "
                    "WHERE event_type = "
                    "'election_manual_ballots_unattested_at_close'"
                )
            )
        ).scalar()
        assert flagged >= 1

        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        assert results is not None
        chief = [p for p in results.results_by_position if p.position == "Chief"]
        assert chief
        assert chief[0].total_votes == 0

        late, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert late is None
        assert "open" in err.lower()

    async def test_void_pending_batch_marks_batch_voided(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        _r, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 1}],
        )
        assert err is None, err

        voided, err = await svc.void_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            deleted_by=user1_id,
            reason="Wrong column tallied",
        )
        assert err is None
        assert voided == 1

        batches = await svc.list_manual_ballot_batches(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert batches[0]["status"] == "voided"

        blocked, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert blocked is None
        assert "voided" in err

    async def test_list_batches_shows_attestation_trail(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        _r, batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 2}],
            notes="March meeting box",
        )
        assert err is None, err

        _ok, err = await svc.attest_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=batch_id,
            attested_by=user2_id,
        )
        assert err is None, err

        batches = await svc.list_manual_ballot_batches(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert len(batches) == 1
        entry = batches[0]
        assert entry["batch_id"] == batch_id
        assert entry["status"] == "pending"
        assert entry["required_attestations"] == 2
        assert entry["recorded_by_name"] == "Alice Anderson"
        assert entry["notes"] == "March meeting box"
        assert entry["total_ballots"] == 2
        assert entry["totals"] == [
            {
                "candidate_id": cid,
                "candidate_name": "Casey Chief",
                "position": "Chief",
                "count": 2,
            }
        ]
        assert len(entry["attestations"]) == 1
        assert entry["attestations"][0]["user_id"] == user2_id
        assert entry["attestations"][0]["name"] == "Bob Baker"
        # An ordinary batch carries no over-count mark and no void trail
        assert entry["over_count_override"] is False
        assert entry["voided_by"] is None
        assert entry["voided_at"] is None
        assert entry["void_reason"] is None

    async def test_list_batches_shows_void_trail_and_over_count_mark(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        """W50-66: a voided card names who voided it, when and why, and a
        batch recorded past the plausibility guard is marked as such so the
        attesting officers know what they are confirming."""
        org_id, user1_id, user2_id = setup_org_and_users
        election_id, cid = await self._open_election_with_candidate(
            db_session, org_id, user1_id
        )
        svc = ElectionService(db_session)

        # Two eligible members, one vote each -> 3 ballots needs the override
        _r, over_batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 3}],
            allow_over_count=True,
        )
        assert err is None, err

        _r, plain_batch_id, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cid, "count": 1}],
        )
        assert err is None, err

        before = datetime.now(timezone.utc).replace(microsecond=0)
        voided, err = await svc.void_manual_ballot_batch(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            batch_id=plain_batch_id,
            deleted_by=user2_id,
            reason="Wrong column tallied",
        )
        assert err is None, err
        assert voided == 1

        batches = {
            b["batch_id"]: b
            for b in await svc.list_manual_ballot_batches(
                uuid.UUID(election_id), uuid.UUID(org_id)
            )
        }

        over = batches[over_batch_id]
        assert over["status"] == "pending"
        assert over["over_count_override"] is True
        assert over["voided_by"] is None

        plain = batches[plain_batch_id]
        assert plain["status"] == "voided"
        assert plain["over_count_override"] is False
        assert plain["voided_by"] == user2_id
        assert plain["voided_by_name"] == "Bob Baker"
        assert plain["void_reason"] == "Wrong column tallied"
        voided_at = plain["voided_at"]
        assert voided_at is not None
        if voided_at.tzinfo is None:
            voided_at = voided_at.replace(tzinfo=timezone.utc)
        assert voided_at >= before


class TestNominationsOpenAnnouncement(TestNominationSetup):
    """At department size the announcement is still one message per member,
    so no message carries more recipients than a provider will accept."""

    async def _add_members(self, db_session: AsyncSession, org_id: str, count: int):
        for _ in range(count):
            uid = _uid()
            uname = f"bulk-{uid[:8]}"
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status) "
                    "VALUES (:id, :org, :un, 'Bulk', 'Member', :em, 'hashed', "
                    "'active')"
                ),
                {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
            )
        await db_session.flush()

    async def _member_emails(self, db_session: AsyncSession, org_id: str):
        result = await db_session.execute(
            text("SELECT email FROM users WHERE organization_id = :org"),
            {"org": org_id},
        )
        return {row[0] for row in result.all()}

    async def test_announcement_mails_every_member_once_with_no_bcc(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await self._add_members(db_session, org_id, 58)
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        _, err = await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        assert err is None, err

        async def accept_all(**kwargs):
            kwargs["results_out"].extend([True] * len(kwargs["to_emails"]))
            return len(kwargs["to_emails"]), 0

        send_email = AsyncMock(side_effect=accept_all)
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            outcome = await svc.announce_nominations_open(election_id, org_id, user1_id)

        everyone = await self._member_emails(db_session, org_id)
        assert send_email.await_count == 1
        kwargs = send_email.await_args.kwargs
        # send_email builds one message per To address.
        assert not kwargs.get("bcc_emails")
        assert len(kwargs["to_emails"]) == len(set(kwargs["to_emails"]))
        assert set(kwargs["to_emails"]) == everyone
        assert outcome == {"recipient_count": 60, "unreached_count": 0}

    async def test_refused_addresses_are_counted_and_audited(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        await self._add_members(db_session, org_id, 108)
        election_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)
        _, err = await svc.open_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        assert err is None, err

        async def refuse_49(**kwargs):
            outcomes = [index >= 49 for index in range(len(kwargs["to_emails"]))]
            kwargs["results_out"].extend(outcomes)
            return sum(outcomes), len(outcomes) - sum(outcomes)

        send_email = AsyncMock(side_effect=refuse_49)
        with patch(
            "app.services.email_service.EmailService.send_email", new=send_email
        ):
            outcome = await svc.announce_nominations_open(election_id, org_id, user1_id)

        assert outcome == {"recipient_count": 110, "unreached_count": 49}
        audited = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM audit_logs "
                "WHERE event_type = 'nominations_announced' "
                "AND JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.election_id')) = :eid"
            ),
            {"eid": election_id},
        )
        assert audited.scalar_one() == 1
