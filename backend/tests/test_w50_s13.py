"""
Elections — W50 review, S13: a bulk ballot whose ``ballot_item_id`` values
match nothing on the election must be REJECTED, not silently accepted.

``submit_ballot_with_token`` skips every vote whose ``ballot_item_id`` is not
in ``election.ballot_items`` (``continue``), then marks the token used and
returns ``success=True``. A client holding a stale ballot (a token issued
before the ballot items were rewritten during a rollback to draft, or any
client that mis-addresses its items) therefore burns its one-and-only token
on a ballot that recorded nothing, and the voter is told it succeeded.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote, VotingToken
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'W50 S13 FD', 'fire_department', :slug, 'UTC', NULL)"
        ),
        {"id": org_id, "slug": f"w50s13-{org_id[:8]}"},
    )
    return org_id


async def _make_user(db_session: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'W50', 'Voter', :em, 'hashed', "
            "'active', 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"w50s13-{user_id[:8]}",
            "em": f"w50s13-{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def open_election(db_session: AsyncSession):
    org_id = await _make_org(db_session)
    voter_id = await _make_user(db_session, org_id)
    election_id = _uid()
    candidate_id = _uid()
    salt = secrets.token_hex(32)
    now = datetime.now(timezone.utc)

    ballot_items = json.dumps(
        [
            {
                "id": "chief-2026",
                "type": "position",
                "title": "Chief",
                "position": "chief-2026",
                "eligible_voter_types": ["all"],
            }
        ]
    )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, "
            "ballot_items, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, "
            "created_by, email_sent, results_visible_immediately, "
            "enable_runoffs, runoff_type, max_runoff_rounds, is_runoff, "
            "runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'W50 S13 Election', 'general', :positions, "
            ":items, :start, :end, 'open', 1, 0, 1, 'simple_majority', "
            "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
            "0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "positions": json.dumps([]),
            "items": ballot_items,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": salt,
            "creator": voter_id,
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO candidates "
            "(id, election_id, name, position, accepted, is_write_in, "
            "display_order, nomination_date, created_at, updated_at) "
            "VALUES (:id, :eid, 'Chief Candidate', 'chief-2026', 1, 0, 0, "
            "NOW(), NOW(), NOW())"
        ),
        {"id": candidate_id, "eid": election_id},
    )
    await db_session.flush()

    return {
        "org_id": org_id,
        "voter_id": voter_id,
        "election_id": election_id,
        "candidate_id": candidate_id,
        "salt": salt,
    }


async def _issue_token(svc: ElectionService, db_session, data, item_ids):
    _token, raw = await svc._generate_voting_token(
        user_id=uuid.UUID(data["voter_id"]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        eligible_item_ids=item_ids,
        eligible_positions=None,
    )
    await db_session.flush()
    return raw


class TestUnknownBallotItemIsNotSilentlyDropped:
    async def test_unknown_item_id_rejects_ballot_and_keeps_token_unused(
        self, db_session: AsyncSession, open_election
    ):
        """A ballot addressed entirely to an item id the election no longer
        has (the client's ballot is stale) must come back as an error with
        the token still usable — not as success with zero votes."""
        data = open_election
        svc = ElectionService(db_session)
        # The token was issued when the item was still called "chief-old";
        # the ballot items were rewritten before the client submitted.
        raw = await _issue_token(svc, db_session, data, ["chief-old"])

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "chief-old", "choice": data["candidate_id"]}],
        )

        assert error is not None, (
            "A vote addressed to a ballot item the election does not have "
            f"was accepted as success: {result!r}"
        )
        assert result is None

        votes = (
            await db_session.execute(
                select(func.count(Vote.id)).where(
                    Vote.election_id == data["election_id"]
                )
            )
        ).scalar()
        assert votes == 0

        token_row = (
            await db_session.execute(
                select(VotingToken).where(
                    VotingToken.election_id == data["election_id"]
                )
            )
        ).scalar_one()
        assert token_row.used is False, (
            "The token was consumed by a ballot that recorded nothing; the "
            "voter can never vote again"
        )

    async def test_mixed_ballot_with_one_unknown_item_is_rejected_whole(
        self, db_session: AsyncSession, open_election
    ):
        """The ballot is atomic: one unknown item id means the whole
        submission is refused, so the voter can fix and resubmit rather than
        having part of their ballot counted and the rest silently lost."""
        data = open_election
        svc = ElectionService(db_session)
        raw = await _issue_token(svc, db_session, data, ["chief-2026", "gone"])

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {"ballot_item_id": "chief-2026", "choice": data["candidate_id"]},
                {"ballot_item_id": "gone", "choice": "approve"},
            ],
        )

        assert error is not None, (
            "A ballot naming an item the election does not have was "
            f"partially accepted: {result!r}"
        )
        assert result is None
        votes = (
            await db_session.execute(
                select(func.count(Vote.id)).where(
                    Vote.election_id == data["election_id"]
                )
            )
        ).scalar()
        assert votes == 0
