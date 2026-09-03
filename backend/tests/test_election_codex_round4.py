"""
Elections — regression tests for the round-4 Codex review on PR #2162
(three findings posted against commit dab1d1baf, the state before round 3's
ELEC-25 fix — round 3 did not touch this code, so these were still open).

Covers the two findings confirmed real and fixed against current code:

1. (ELEC-26, P1) `send_ballot_emails` computed `eligible_items` and decided
   to skip a recipient with zero eligible items *before* `eligible_positions`
   was ever computed. In a mixed election (both `ballot_items` and
   `positions` configured), a recipient eligible for a plain position but
   ineligible for every structured ballot item was skipped outright — no
   token, no email — even though `eligible_positions` would have been
   non-empty for them. Fixed by computing both eligibility sets before
   deciding whether the recipient's ballot would be empty.

2. (ELEC-27, P2) `submit_ballot_with_token`'s NULL-position duplicate-vote
   subquery matched `Candidate.position == position` (the *storage* value —
   the item's own "position" field, or the item id for a legacy item with no
   "position" field) instead of the broader `item_candidate_positions` set
   (`ballot_item_candidate_positions()`, introduced by ELEC-22) that also
   covers a legacy item's title-keyed candidates. A voter with an old
   NULL-position vote against a title-keyed legacy candidate, plus a fresh
   unused token, could have that old vote missed by the dedup check and cast
   a second, differently-keyed vote for the same contest — the same shape of
   bug ELEC-22 itself fixed, just in the duplicate-detection query instead of
   the eligibility-allow-list query. Fixed by using
   `item_candidate_positions` in the NULL-vote subquery too, matching the
   check already fixed in `cast_vote_with_token` (ELEC-22) and the candidate
   validation in `submit_ballot_with_token` itself, so there is one
   consistent definition of "which positions belong to this item" used
   everywhere.

The third round-4 finding (frontend `BallotVotingPage.tsx` never renders or
submits a plain-position contest, so a mixed-election recipient who is only
eligible for a position still can't vote on it through the product UI even
after ELEC-23/ELEC-26) is a frontend feature gap, not a mechanical backend
bug — flagged as ELEC-28 in
`docs/security-review/ELEC-06-elections-ballots.md` rather than guessed at
here.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote, VotingToken
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


# ===================================================================
# Finding 1 (ELEC-26) — a mixed election must not skip a recipient who
# qualifies for a plain position just because they fail every ballot item
# ===================================================================


class TestMixedElectionItemFailureDoesNotSkipPositionEligible:
    @pytest.fixture
    async def setup_mixed_election(self, db_session: AsyncSession):
        """One OPEN election configuring BOTH a ballot item restricted to
        operational members and a plain position "Secretary" restricted to
        administrative members. An administrative recipient fails the item
        but qualifies for the position."""
        org_id = _uid()
        admin_id = _uid()
        election_id = _uid()
        item_candidate_id = _uid()
        secretary_candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Round4 Mixed FD", "slug": f"r4m-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status, membership_type) "
                "VALUES (:id, :org, :un, 'Admin', 'Member', :em, 'hashed', "
                "'active', 'administrative')"
            ),
            {
                "id": admin_id,
                "org": org_id,
                "un": f"r4-admin-{admin_id[:8]}",
                "em": f"r4-admin-{admin_id[:8]}@test.com",
            },
        )

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "position": "board_seat", '
            '"eligible_voter_types": ["operational"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, ballot_items, start_date, end_date, "
                "status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round4 Mixed Election', 'general', "
                ":positions, :pos_elig, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["Secretary"]',
                "pos_elig": '{"Secretary": {"voter_types": ["administrative"]}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": admin_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Board Candidate', 'board_seat', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": item_candidate_id, "eid": election_id},
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Secretary Candidate', 'Secretary', 1, 0, "
                "1, NOW(), NOW(), NOW())"
            ),
            {"id": secretary_candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "admin_id": admin_id,
            "election_id": election_id,
            "item_candidate_id": item_candidate_id,
            "secretary_candidate_id": secretary_candidate_id,
            "salt": salt,
        }

    async def test_position_eligible_recipient_still_gets_a_ballot(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """Root cause: the recipient fails the ballot item's operational
        requirement, but qualifies for the administrative-restricted
        Secretary position. Pre-fix, the item-empty check short-circuited
        with `continue` before eligible_positions was ever computed, so this
        recipient was skipped entirely — no token, no email — despite being
        a legitimate voter for Secretary."""
        data = setup_mixed_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["admin_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )

        assert sent == 1, (
            "Recipient qualifies for the Secretary position and must "
            f"receive a ballot (failed={failed}, skipped={skipped}, "
            f"skipped_details={skipped_details})"
        )
        assert skipped == 0

        tokens = (
            (
                await db_session.execute(
                    select(VotingToken).where(
                        VotingToken.election_id == data["election_id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(tokens) == 1, "A token must have been issued"

    async def test_position_eligible_recipient_token_snapshots_position(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """Same scenario, checked at the ORM level: the issued token must
        carry an empty eligible_item_ids (fails the item) and a non-empty
        eligible_positions (qualifies for Secretary) — not be entirely
        absent."""
        data = setup_mixed_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, _failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["admin_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )
        assert sent == 1, f"skipped_details={skipped_details}"
        assert skipped == 0, f"skipped_details={skipped_details}"

        result = await db_session.execute(
            select(VotingToken).where(VotingToken.election_id == data["election_id"])
        )
        token_row = result.scalars().first()
        assert token_row is not None
        assert token_row.eligible_item_ids == []
        assert token_row.eligible_positions == ["Secretary"]


# ===================================================================
# Finding 2 (ELEC-27) — the NULL-position duplicate-vote subquery in
# submit_ballot_with_token must use item_candidate_positions, not just the
# item's storage `position`, so a title-keyed legacy candidate's pre-
# normalization vote is still recognized as a duplicate
# ===================================================================


class TestSubmitBallotLegacyNullPositionDedup:
    @pytest.fixture
    async def setup_title_keyed_election(self, db_session: AsyncSession):
        """One OPEN election with a single ballot item persisted with no
        "position" field (the pre-migration/legacy shape) and one accepted
        candidate stored under the item's *title*, not its id — the same
        fixture shape as round 3's ELEC-22 tests."""
        org_id, user_id, election_id, candidate_id = _uid(), _uid(), _uid(), _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
                "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "name": "Round4 Legacy FD", "slug": f"r4-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Voter', 'Legacy', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"r4-voter-{user_id[:8]}",
                "em": f"r4-voter-{user_id[:8]}@test.com",
            },
        )
        # Deliberately no "position" key — the legacy shape this convention
        # exists for.
        ballot_items = (
            '[{"id": "legacy_item", "type": "officer_election", '
            '"title": "Assistant Chief", "eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, ballot_items, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Round4 Legacy Item Election', "
                "'general', :items, :start, :end, 'open', 1, 0, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, "
                "0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": user_id,
            },
        )
        # Candidate is keyed to the item's TITLE — the legacy convention.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Legacy Candidate', 'Assistant Chief', "
                "1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()
        return {
            "org_id": org_id,
            "user_id": user_id,
            "election_id": election_id,
            "candidate_id": candidate_id,
            "salt": salt,
        }

    async def test_legacy_null_position_vote_blocks_second_submission(
        self, db_session: AsyncSession, setup_title_keyed_election
    ):
        """Root cause: a pre-normalization vote (position IS NULL) against
        the title-keyed legacy candidate must still be recognized as a vote
        on this item, even though the item's *storage* position ("position"
        field absent, so `position` resolves to the item id "legacy_item")
        differs from the candidate's actual position ("Assistant Chief").
        Pre-fix, the NULL-position subquery filtered on
        `Candidate.position == "legacy_item"`, which never matches the
        title-keyed candidate — so the old vote was invisible to the dedup
        check and a second, fresh-token vote for the same contest would be
        accepted, doubling this voter's say in the race."""
        data = setup_title_keyed_election
        svc = ElectionService(db_session)

        # Simulate a vote cast before position normalization: position is
        # NULL, and the candidate it targeted is keyed by title.
        legacy_vote = Vote(
            id=_uid(),
            election_id=data["election_id"],
            candidate_id=data["candidate_id"],
            voter_id=None,
            voter_hash="legacy-voter-hash",
            position=None,
            is_test=False,
        )
        db_session.add(legacy_vote)
        await db_session.flush()

        # A fresh, unused token for the SAME voter (same voter_hash) trying
        # to vote again on the same legacy item.
        token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        # Force the same voter_hash as the legacy vote so this reproduces
        # "same voter, old NULL-position vote + new unused token" rather
        # than a different voter's independent first vote.
        token.voter_hash = "legacy-voter-hash"
        await db_session.flush()

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "legacy_item",
                    "choice": data["candidate_id"],
                }
            ],
        )

        assert result is None
        assert error is not None
        assert "already voted" in error, (
            "The old NULL-position vote against the title-keyed legacy "
            f"candidate must be caught as a duplicate; got error={error!r}"
        )

        # No second vote should have been recorded for this candidate.
        vote_count = (
            await db_session.execute(
                text(
                    "SELECT COUNT(*) FROM votes WHERE candidate_id = :cid "
                    "AND deleted_at IS NULL"
                ),
                {"cid": data["candidate_id"]},
            )
        ).scalar_one()
        assert vote_count == 1, "Only the original legacy vote should exist"

    async def test_fresh_voter_can_still_vote_the_legacy_item(
        self, db_session: AsyncSession, setup_title_keyed_election
    ):
        """Sanity check: the fix must not over-match — a voter with no
        prior vote at all must still be able to cast one."""
        data = setup_title_keyed_election
        svc = ElectionService(db_session)

        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["user_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "legacy_item",
                    "choice": data["candidate_id"],
                }
            ],
        )

        assert error is None, f"Fresh voter wrongly rejected: {error}"
        assert result["votes_cast"] == 1
