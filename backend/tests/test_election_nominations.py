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

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate, Election, ElectionStatus, Vote
from app.services.election_service import ElectionService

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

        recorded, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[
                {"candidate_id": cand_ids[0], "count": 3},
                {"candidate_id": cand_ids[1], "count": 2},
            ],
            notes="Paper ballots from the March meeting",
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

        recorded, err = await svc.record_manual_ballots(
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

        recorded, err = await svc.record_manual_ballots(
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

        _n, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user1_id,
            entries=[{"candidate_id": cand_ids[1], "count": 4}],
        )
        assert err is None

        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None

        results = await svc.get_election_results(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        counts = {c.candidate_name: c.vote_count for c in results.overall_results}
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

        recorded, err = await svc.record_manual_ballots(
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
