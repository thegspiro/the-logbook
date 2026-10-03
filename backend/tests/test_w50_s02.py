"""
Elections — W50 S02: per-item eligibility must apply on the authenticated
vote route no matter how the client names the ballot item.

``ElectionService.check_voter_eligibility`` matches a vote's ``position``
against each ballot item's ``position`` or ``title`` only. A ballot item
persisted without an explicit "position" field is, by the current
write-path convention, keyed by its **id**: ``submit_ballot_with_token``
creates Approve / Deny / write-in candidates with
``position = item.get("position") or item_id``, and the admin candidate
endpoint accepts any string when ``election.positions`` is empty. The token
routes resolve the item through ``ballot_item_candidate_positions`` (title
*or* id) and fall back to ``candidate.position`` when the field is omitted;
``cast_vote`` used to do neither, so an authenticated member could vote on
an item restricted to another member class, or gated on meeting attendance,
by sending ``position=<item.id>`` — or by sending no position at all, which
is exactly what ``ElectionBallot.tsx`` does for an election with no plain
``positions``. Both routes now resolve the item the same way, and the gate
matches a legacy item by its id as well as its title.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]

ITEM_ID = "chief_seat"
ITEM_TITLE = "Fire Chief"


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def restricted_item_election(db_session: AsyncSession):
    """One OPEN election whose only ballot item is a legacy item (no explicit
    "position") restricted to operational members and requiring meeting
    attendance. The voter is administrative and not checked in, so the item
    must refuse them. The candidate is keyed by the item's id."""
    org_id = _uid()
    voter_id = _uid()
    election_id = _uid()
    candidate_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "W50 S02 FD", "slug": f"w50s02-{org_id[:8]}"},
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
            "id": voter_id,
            "org": org_id,
            "un": f"w50-{voter_id[:8]}",
            "em": f"w50-{voter_id[:8]}@test.com",
        },
    )

    ballot_items = json.dumps(
        [
            {
                "id": ITEM_ID,
                "type": "officer_election",
                "title": ITEM_TITLE,
                "vote_type": "candidate_selection",
                "eligible_voter_types": ["operational"],
                "require_attendance": True,
            }
        ]
    )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, "
            "ballot_items, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, created_by, "
            "email_sent, results_visible_immediately, enable_runoffs, "
            "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
            "created_at, updated_at) "
            "VALUES (:id, :org, 'W50 S02 Election', 'general', '[]', :items, "
            ":start, :end, 'open', 1, 0, 1, 'simple_majority', 'most_votes', "
            ":salt, 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "items": ballot_items,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": voter_id,
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO candidates "
            "(id, election_id, name, position, accepted, is_write_in, "
            "display_order, nomination_date, created_at, updated_at) "
            "VALUES (:id, :eid, 'Chief Candidate', :pos, 1, 0, 0, "
            "NOW(), NOW(), NOW())"
        ),
        {"id": candidate_id, "eid": election_id, "pos": ITEM_ID},
    )
    await db_session.flush()

    return {
        "org_id": org_id,
        "voter_id": voter_id,
        "election_id": election_id,
        "candidate_id": candidate_id,
    }


async def _cast(db_session, data, position):
    svc = ElectionService(db_session)
    return await svc.cast_vote(
        user_id=uuid.UUID(data["voter_id"]),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(data["candidate_id"]),
        position=position,
        organization_id=uuid.UUID(data["org_id"]),
    )


async def _vote_count(db_session, election_id) -> int:
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM votes WHERE election_id = :eid"),
        {"eid": election_id},
    )
    return int(result.scalar_one())


def _assert_refused(vote, error):
    assert vote is None, "an ineligible member's vote was recorded"
    assert error is not None
    assert "voter types" in error or "checked in" in error, error


class TestLegacyItemEligibilityOnAuthenticatedRoute:
    async def test_control_item_title_is_refused(
        self, db_session: AsyncSession, restricted_item_election
    ):
        """Sanity check: naming the item by title reaches the item gate, and
        the administrative voter is refused. This passes today; it proves
        the two tests below fail on the bypass, not on the setup."""
        data = restricted_item_election
        vote, error = await _cast(db_session, data, ITEM_TITLE)
        _assert_refused(vote, error)
        assert await _vote_count(db_session, data["election_id"]) == 0

    async def test_item_id_as_position_is_refused(
        self, db_session: AsyncSession, restricted_item_election
    ):
        """The candidate is keyed by the item's id, so ``position=<item.id>``
        clears ``candidate.position == position`` while matching no item in
        ``check_voter_eligibility`` — the item's voter-type and attendance
        rules are never evaluated."""
        data = restricted_item_election
        vote, error = await _cast(db_session, data, ITEM_ID)
        _assert_refused(vote, error)
        assert await _vote_count(db_session, data["election_id"]) == 0

    async def test_omitted_position_is_refused(
        self, db_session: AsyncSession, restricted_item_election
    ):
        """Same root cause, and the shape the authenticated ballot UI sends
        for an election with no plain positions: with no position at all,
        neither the item gate nor the candidate/position check runs."""
        data = restricted_item_election
        vote, error = await _cast(db_session, data, None)
        _assert_refused(vote, error)
        assert await _vote_count(db_session, data["election_id"]) == 0
