"""W50 S04 — the tally must honour a ballot item's own victory condition.

``BallotItem.victory_condition`` / ``victory_percentage`` are accepted on
create and update, validated (a supermajority item must carry a
percentage), offered in the BallotBuilder as "Override election default",
and printed on the ballot. ``_calculate_candidate_results`` then decides
winners from the *election* columns alone, so a bylaw amendment marked
"Supermajority (67%)" is declared carried on a plain plurality.

Both directions are pinned: an item stricter than its election must not
produce a winner the item's rule denies, and an item looser than its
election must still produce the winner the item's rule grants.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate, Vote
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]

ITEM_ID = "bylaw-2026"


async def _closed_ballot_election(
    db_session: AsyncSession,
    *,
    election_condition: str,
    election_percentage: int | None,
    item_condition: str,
    item_percentage: int | None,
) -> dict:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    election_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "name": "Supermajority FD", "slug": f"sm-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Sue', 'Secretary', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"sec-{user_id[:8]}",
            "em": f"sec-{user_id[:8]}@test.com",
        },
    )

    item = {
        "id": ITEM_ID,
        "type": "general_vote",
        "title": "Bylaw Amendment",
        "vote_type": "approval",
        "eligible_voter_types": ["all"],
        "victory_condition": item_condition,
    }
    if item_percentage is not None:
        item["victory_percentage"] = item_percentage

    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, ballot_items, "
            "start_date, end_date, status, anonymous_voting, allow_write_ins, "
            "max_votes_per_position, voting_method, victory_condition, "
            "victory_percentage, voter_anonymity_salt, quorum_type, created_by, "
            "email_sent, results_visible_immediately, enable_runoffs, "
            "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
            "created_at, updated_at) "
            "VALUES (:id, :org, 'Bylaw Vote', 'general', :items, :start, :end, "
            "'closed', 1, 0, 1, 'simple_majority', :victory, :pct, :salt, 'none', "
            ":creator, 0, 1, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "items": json.dumps([item]),
            "start": now - timedelta(days=3),
            "end": now - timedelta(days=1),
            "victory": election_condition,
            "pct": election_percentage,
            "salt": secrets.token_hex(32),
            "creator": user_id,
        },
    )

    # The token-ballot route stores approve/deny under synthetic candidates
    # positioned on the item id (submit_ballot_with_token); 3 of 5 approve.
    approve = Candidate(
        election_id=election_id, name="Approve", position=ITEM_ID, display_order=0
    )
    deny = Candidate(
        election_id=election_id, name="Deny", position=ITEM_ID, display_order=1
    )
    db_session.add_all([approve, deny])
    await db_session.flush()
    for candidate, count in ((approve, 3), (deny, 2)):
        for _ in range(count):
            db_session.add(
                Vote(
                    election_id=election_id,
                    candidate_id=candidate.id,
                    position=ITEM_ID,
                    voter_hash=secrets.token_hex(32),
                    vote_dedup_hash=secrets.token_hex(32),
                )
            )
    await db_session.flush()
    return {"org_id": org_id, "election_id": election_id}


def _winners(results) -> set[str]:
    names = {r.candidate_name for r in results.overall_results if r.is_winner}
    for position in results.results_by_position:
        names |= {r.candidate_name for r in position.candidates if r.is_winner}
    return names


async def test_supermajority_item_is_not_carried_by_a_plurality(
    db_session: AsyncSession,
):
    data = await _closed_ballot_election(
        db_session,
        election_condition="most_votes",
        election_percentage=None,
        item_condition="supermajority",
        item_percentage=67,
    )
    results = await ElectionService(db_session).get_election_results(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert results is not None
    # 60% approval is short of the item's 67% supermajority: no winner.
    assert _winners(results) == set()


async def test_most_votes_item_is_carried_under_a_supermajority_election(
    db_session: AsyncSession,
):
    data = await _closed_ballot_election(
        db_session,
        election_condition="supermajority",
        election_percentage=67,
        item_condition="most_votes",
        item_percentage=None,
    )
    results = await ElectionService(db_session).get_election_results(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert results is not None
    # The item opts out of the election's supermajority: 3 of 5 carries it.
    assert _winners(results) == {"Approve"}
