"""W50-34: a runoff inherits the parent's tie policy, says why it exists, and
carries the candidate-selection ballot items it re-runs.

``_check_and_create_runoff`` copied every rule but ``tie_policy``, so the
child of a ``runoff``-policy parent fell back to the column default,
``co_winners``: a re-tie in round one declared both candidates elected and
round two never happened. Its description blamed a missed threshold on what
was a 1-1 plurality tie, and it copied none of the parent's ballot items, so
an item-based runoff had no ballot to mail.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def tied_chief_election(db_session: AsyncSession):
    """Org, 2 voters, an OPEN most_votes election for Chief with
    ``tie_policy = runoff``, a candidate-selection item for the seat and an
    approval item (a budget) beside it. Chief: A, B."""
    org_id = _uid()
    users = [_uid() for _ in range(2)]
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Tie FD", "slug": f"tie-{org_id[:8]}"},
    )
    for i, uid in enumerate(users):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, :fn, 'Voter', :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"voter{i}-{uid[:8]}",
                "fn": f"V{i}",
                "em": f"voter{i}-{uid[:8]}@test.com",
            },
        )

    ballot_items = (
        '[{"id": "chief", "type": "officer_election", "title": "Election for '
        'Chief", "position": "Chief", "eligible_voter_types": ["all"], '
        '"vote_type": "candidate_selection"}, '
        '{"id": "budget", "type": "general_vote", "title": "Approve the 2027 '
        'budget", "eligible_voter_types": ["all"], "vote_type": "approval", '
        '"prospect_package_id": "pkg-1"}]'
    )
    await db_session.execute(
        text(
            "INSERT INTO elections (id, organization_id, title, election_type, "
            "positions, ballot_items, start_date, end_date, status, "
            "anonymous_voting, allow_write_ins, max_votes_per_position, "
            "voting_method, victory_condition, tie_policy, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, "
            "updated_at) VALUES (:id, :org, 'Chief 2026', 'officer', "
            ":positions, :items, :start, :end, 'open', 1, 0, 1, "
            "'simple_majority', 'most_votes', 'runoff', :salt, 'none', "
            ":creator, 0, 0, 1, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "positions": '["Chief"]',
            "items": ballot_items,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": users[0],
        },
    )

    candidates = {}
    for name, user in [("A", users[0]), ("B", users[1])]:
        cid = _uid()
        candidates[name] = cid
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, user_id, name, "
                "position, accepted, is_write_in, display_order, "
                "nomination_date, created_at, updated_at) VALUES (:id, :eid, "
                ":uid, :name, 'Chief', 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id, "uid": user, "name": name},
        )
    await db_session.flush()

    return {
        "org_id": org_id,
        "users": users,
        "election_id": election_id,
        "candidates": candidates,
    }


async def _close_after_a_one_one_tie(db_session, data):
    svc = ElectionService(db_session)
    for user, candidate in [(data["users"][0], "A"), (data["users"][1], "B")]:
        _, err = await svc.cast_vote(
            user_id=uuid.UUID(user),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidates"][candidate]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None, err

    closed, err = await svc.close_election(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert err is None
    assert closed is not None

    runoff = (
        await db_session.execute(
            select(Election)
            .where(Election.parent_election_id == data["election_id"])
            .where(Election.is_runoff.is_(True))
        )
    ).scalar_one_or_none()
    assert runoff is not None, "a 1-1 tie under tie_policy=runoff needs a runoff"
    return runoff


async def test_runoff_inherits_the_parent_tie_policy(
    db_session: AsyncSession, tied_chief_election
):
    runoff = await _close_after_a_one_one_tie(db_session, tied_chief_election)
    assert runoff.tie_policy == "runoff"
    assert runoff.enable_runoffs is True


async def test_runoff_description_names_the_tie(
    db_session: AsyncSession, tied_chief_election
):
    runoff = await _close_after_a_one_one_tie(db_session, tied_chief_election)
    assert runoff.description == (
        "Runoff election for Chief 2026. The previous round ended in a tie "
        "between A and B."
    )
    assert "required votes" not in runoff.description


async def test_runoff_carries_the_candidate_selection_items_only(
    db_session: AsyncSession, tied_chief_election
):
    runoff = await _close_after_a_one_one_tie(db_session, tied_chief_election)
    items = runoff.ballot_items or []
    assert [i["id"] for i in items] == ["chief"]
    assert items[0]["position"] == "Chief"
    assert "prospect_package_id" not in items[0]
