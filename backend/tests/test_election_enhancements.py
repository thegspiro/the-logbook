"""
Integration tests for the elections enhancement batch:

  - clone_election copies setup (never state) with a fresh anonymity salt
  - voter-roll freeze at open (snapshot gates eligibility and turnout;
    NULL snapshot = legacy live evaluation; overrides still admit)
  - tie_policy (co_winners keeps legacy both-win; revote flags the tie,
    declares no winner, and audits at close)
  - write-in consolidation (alias-based merge counts votes under the
    target without touching signed vote rows)
  - printable-ballot and certified-results PDF builders
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate, ElectionStatus
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class EnhancementSetup:

    @pytest.fixture
    async def setup_org_and_users(self, db_session: AsyncSession):
        """Org with two active members; paper-ballot attestation off so the
        tally tests here can key ballots in without officer sign-off."""
        org_id = _uid()
        user1_id = _uid()
        user2_id = _uid()

        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, :name, :otype, :slug, :tz, :settings)"
            ),
            {
                "id": org_id,
                "name": "Enhancement Test FD",
                "otype": "fire_department",
                "slug": f"enh-{org_id[:8]}",
                "tz": "UTC",
                "settings": '{"election_features": '
                '{"paper_ballot_attestations_required": 0}}',
            },
        )
        for uid, uname, fn, ln in [
            (user1_id, f"enh1-{user1_id[:8]}", "Alice", "Anderson"),
            (user2_id, f"enh2-{user2_id[:8]}", "Bob", "Baker"),
        ]:
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
                    "un": uname,
                    "fn": fn,
                    "ln": ln,
                    "em": f"{uname}@test.com",
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
        tie_policy: str = "co_winners",
        allow_write_ins: bool = False,
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
                "is_runoff, runoff_round, tie_policy, "
                "created_at, updated_at) "
                "VALUES (:id, :org, :title, :etype, :positions, "
                ":start, :end, :status, 1, :write_ins, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, "
                "0, 0, 0, 'top_two', 3, 0, 0, :tie_policy, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "title": f"Enhancement Election {election_id[:8]}",
                "etype": "officer",
                "positions": positions,
                "start": start or (now - timedelta(days=1)),
                "end": end or (now + timedelta(days=1)),
                "status": status,
                "salt": secrets.token_hex(32),
                "creator": creator_id,
                "tie_policy": tie_policy,
                "write_ins": 1 if allow_write_ins else 0,
            },
        )
        await db_session.flush()
        return election_id

    async def _insert_candidate(
        self,
        db_session: AsyncSession,
        election_id: str,
        name: str,
        position: str = "Chief",
        *,
        is_write_in: bool = False,
    ) -> str:
        cid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, :name, :pos, 1, :wi, 0, NOW(), NOW(), "
                "NOW())"
            ),
            {
                "id": cid,
                "eid": election_id,
                "name": name,
                "pos": position,
                "wi": 1 if is_write_in else 0,
            },
        )
        await db_session.flush()
        return cid

    async def _record_ballots(self, svc, election_id, org_id, user_id, entries):
        recorded, _batch, err = await svc.record_manual_ballots(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            recorded_by=user_id,
            entries=entries,
            allow_over_count=True,
        )
        assert err is None, err
        return recorded


class TestCloneElection(EnhancementSetup):

    async def test_clone_copies_setup_not_state(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        source_id = await self._insert_election(
            db_session, org_id, user1_id, positions='["Chief", "Captain"]'
        )
        ballot_items = [
            {
                "id": "chief_vote",
                "type": "officer_election",
                "title": "Elect the Chief",
                "vote_type": "candidate_selection",
                "eligible_voter_types": ["operational"],
            }
        ]
        await db_session.execute(
            text("UPDATE elections SET ballot_items = :items WHERE id = :id"),
            {"items": json.dumps(ballot_items), "id": source_id},
        )
        await db_session.flush()
        await self._insert_candidate(db_session, source_id, "Casey Chief")
        svc = ElectionService(db_session)

        start = datetime.now(timezone.utc) + timedelta(days=30)
        clone, err = await svc.clone_election(
            election_id=uuid.UUID(source_id),
            organization_id=uuid.UUID(org_id),
            created_by=user1_id,
            title="Officer Election 2027",
            start_date=start,
            end_date=start + timedelta(days=1),
        )
        assert err is None, err
        assert clone.status == ElectionStatus.DRAFT
        assert clone.title == "Officer Election 2027"
        assert clone.positions == ["Chief", "Captain"]
        assert clone.ballot_items == ballot_items
        assert clone.ballot_items is not ballot_items
        assert clone.tie_policy == "co_winners"

        source_salt = (
            await db_session.execute(
                text("SELECT voter_anonymity_salt FROM elections WHERE id = :id"),
                {"id": source_id},
            )
        ).scalar()
        assert clone.voter_anonymity_salt
        assert clone.voter_anonymity_salt != source_salt

        clone_candidates = (
            (
                await db_session.execute(
                    select(Candidate).where(Candidate.election_id == clone.id)
                )
            )
            .scalars()
            .all()
        )
        assert clone_candidates == []

    async def test_clone_with_candidates(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        source_id = await self._insert_election(db_session, org_id, user1_id)
        await self._insert_candidate(db_session, source_id, "Casey Chief")
        svc = ElectionService(db_session)

        start = datetime.now(timezone.utc) + timedelta(days=30)
        clone, err = await svc.clone_election(
            election_id=uuid.UUID(source_id),
            organization_id=uuid.UUID(org_id),
            created_by=user1_id,
            title="With Candidates",
            start_date=start,
            end_date=start + timedelta(days=1),
            include_candidates=True,
        )
        assert err is None, err
        names = (
            (
                await db_session.execute(
                    select(Candidate.name).where(Candidate.election_id == clone.id)
                )
            )
            .scalars()
            .all()
        )
        assert names == ["Casey Chief"]

    async def test_clone_is_org_scoped(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        source_id = await self._insert_election(db_session, org_id, user1_id)
        svc = ElectionService(db_session)

        start = datetime.now(timezone.utc) + timedelta(days=30)
        clone, err = await svc.clone_election(
            election_id=uuid.UUID(source_id),
            organization_id=uuid.UUID(_uid()),
            created_by=user1_id,
            title="Cross-org",
            start_date=start,
            end_date=start + timedelta(days=1),
        )
        assert clone is None
        assert "not found" in err.lower()


class TestRollFreeze(EnhancementSetup):

    async def _add_member(self, db_session, org_id):
        uid = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Newton', 'Newman', :em, 'hashed', "
                "'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"new-{uid[:8]}",
                "em": f"new-{uid[:8]}@test.com",
            },
        )
        await db_session.flush()
        return uid

    async def test_open_freezes_roster(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, user2_id = setup_org_and_users
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        await self._insert_candidate(db_session, election_id, "Casey Chief")
        svc = ElectionService(db_session)

        opened, err = await svc.open_election(uuid.UUID(election_id), uuid.UUID(org_id))
        assert err is None, err
        assert opened.eligible_roster_snapshot is not None
        assert set(opened.eligible_roster_snapshot) == {user1_id, user2_id}

        # A member who joins mid-election is not on the frozen roll…
        newcomer = await self._add_member(db_session, org_id)
        eligibility = await svc.check_voter_eligibility(
            uuid.UUID(newcomer), uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert eligibility.is_eligible is False
        assert "frozen" in (eligibility.reason or "")

        # …but pre-open members are, and the denominator stays fixed.
        eligibility = await svc.check_voter_eligibility(
            uuid.UUID(user2_id), uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert eligibility.is_eligible is True

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.total_eligible_voters == 2

    async def test_override_admits_after_freeze(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session,
            org_id,
            user1_id,
            start=datetime.now(timezone.utc) - timedelta(minutes=5),
        )
        await self._insert_candidate(db_session, election_id, "Casey Chief")
        svc = ElectionService(db_session)
        _opened, err = await svc.open_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err

        newcomer = await self._add_member(db_session, org_id)
        await db_session.execute(
            text("UPDATE elections SET voter_overrides = :o WHERE id = :id"),
            {
                "o": f'[{{"user_id": "{newcomer}", "reason": "board approved"}}]',
                "id": election_id,
            },
        )
        await db_session.flush()
        # The raw UPDATE bypasses the ORM — expire the identity map so the
        # service re-reads voter_overrides from the database.
        db_session.expire_all()

        eligibility = await svc.check_voter_eligibility(
            uuid.UUID(newcomer), uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert eligibility.is_eligible is True

        stats = await svc.get_election_stats(uuid.UUID(election_id), uuid.UUID(org_id))
        assert stats.total_eligible_voters == 3

    async def test_legacy_null_snapshot_stays_live(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        # Raw-inserted OPEN election — no snapshot, legacy live behavior.
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open"
        )
        await self._insert_candidate(db_session, election_id, "Casey Chief")
        svc = ElectionService(db_session)

        newcomer = await self._add_member(db_session, org_id)
        eligibility = await svc.check_voter_eligibility(
            uuid.UUID(newcomer), uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert eligibility.is_eligible is True


class TestTiePolicy(EnhancementSetup):

    async def _tied_election(self, db_session, org_id, user1_id, policy):
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open", tie_policy=policy
        )
        cid_a = await self._insert_candidate(db_session, election_id, "Alpha")
        cid_b = await self._insert_candidate(db_session, election_id, "Bravo")
        svc = ElectionService(db_session)
        await self._record_ballots(
            svc,
            election_id,
            org_id,
            user1_id,
            [
                {"candidate_id": cid_a, "count": 1},
                {"candidate_id": cid_b, "count": 1},
            ],
        )
        return election_id, svc

    async def test_co_winners_keeps_legacy_behavior(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id, svc = await self._tied_election(
            db_session, org_id, user1_id, "co_winners"
        )
        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        chief = results.results_by_position[0]
        assert chief.is_tie is False
        assert all(c.is_winner for c in chief.candidates)

    async def test_revote_policy_flags_tie_and_audits(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id, svc = await self._tied_election(
            db_session, org_id, user1_id, "revote"
        )
        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        chief = results.results_by_position[0]
        assert chief.is_tie is True
        assert not any(c.is_winner for c in chief.candidates)
        assert all(c.is_tied for c in chief.candidates)
        assert results.tie_policy == "revote"

        closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        flagged = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM audit_logs "
                    "WHERE event_type = 'election_tie_detected'"
                )
            )
        ).scalar()
        assert flagged >= 1


class TestWriteInMerge(EnhancementSetup):

    async def test_merge_counts_votes_under_target(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open", allow_write_ins=True
        )
        target = await self._insert_candidate(
            db_session, election_id, "Bob Baker", is_write_in=True
        )
        variant = await self._insert_candidate(
            db_session, election_id, "bob baker", is_write_in=True
        )
        svc = ElectionService(db_session)
        await self._record_ballots(
            svc,
            election_id,
            org_id,
            user1_id,
            [
                {"candidate_id": target, "count": 2},
                {"candidate_id": variant, "count": 1},
            ],
        )

        merged, err = await svc.merge_write_in_candidates(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            source_candidate_ids=[variant],
            target_candidate_id=target,
            merged_by=user1_id,
        )
        assert err is None, err
        assert merged == 1

        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        chief = results.results_by_position[0]
        assert len(chief.candidates) == 1
        assert chief.candidates[0].candidate_name == "Bob Baker"
        assert chief.candidates[0].vote_count == 3

        # The signed vote rows were never touched.
        integrity = await svc.verify_vote_integrity(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert integrity["integrity_status"] == "PASS", integrity

    async def test_merge_validation(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open", allow_write_ins=True
        )
        nominee = await self._insert_candidate(db_session, election_id, "Real Nominee")
        write_in = await self._insert_candidate(
            db_session, election_id, "Writey McWrite", is_write_in=True
        )
        svc = ElectionService(db_session)

        # A real nominee can never be folded away as a merge source.
        merged, err = await svc.merge_write_in_candidates(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            source_candidate_ids=[nominee],
            target_candidate_id=write_in,
            merged_by=user1_id,
        )
        assert merged == 0
        assert "not a write-in" in err

        # Foreign candidate ids are rejected.
        merged, err = await svc.merge_write_in_candidates(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            source_candidate_ids=[_uid()],
            target_candidate_id=nominee,
            merged_by=user1_id,
        )
        assert merged == 0
        assert "do not belong" in err


class TestBallotPdfs(EnhancementSetup):

    async def test_printable_ballot_builds(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, allow_write_ins=True
        )
        await self._insert_candidate(db_session, election_id, "Casey Chief")
        svc = ElectionService(db_session)

        buf, err, filename = await svc.build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert filename.startswith("ballot_")
        assert buf.getvalue()[:4] == b"%PDF"

    async def test_printable_ballot_rejected_when_closed(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="closed"
        )
        svc = ElectionService(db_session)
        buf, err, _fn = await svc.build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert buf is None
        assert "closes" in err

    async def test_certified_results_build_after_close(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open"
        )
        cid = await self._insert_candidate(db_session, election_id, "Casey")
        svc = ElectionService(db_session)
        await self._record_ballots(
            svc, election_id, org_id, user1_id, [{"candidate_id": cid, "count": 2}]
        )
        _closed, err = await svc.close_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err

        buf, err, filename = await svc.build_certified_results_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert filename.startswith("certified_results_")
        assert buf.getvalue()[:4] == b"%PDF"

    async def test_certified_results_require_closed(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, user1_id, _ = setup_org_and_users
        election_id = await self._insert_election(
            db_session, org_id, user1_id, status="open"
        )
        svc = ElectionService(db_session)
        buf, err, _fn = await svc.build_certified_results_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert buf is None
        assert "closes" in err
