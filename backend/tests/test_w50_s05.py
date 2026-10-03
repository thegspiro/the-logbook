"""W50-S05: results for a ballot-item-only election must be tallied per item.

An election whose ballot is made of approval items (Approve/Deny per item)
carries no ``election.positions``; its Approve/Deny candidates are keyed by
the item's position (its id). ``get_election_results`` builds
``results_by_position`` only from ``election.positions``, so such an election
returns one flat ``overall_results`` mixing every item's Approve/Deny rows
with a single cross-item winner, and the report email prints "No results
available." — the department cannot tell which motion carried.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]

ITEM_A = "item-budget"
ITEM_B = "item-bylaw"
TITLES = {ITEM_A: "Approve 2027 budget", ITEM_B: "Adopt bylaw change"}


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def ballot_item_election(db_session: AsyncSession):
    """Org, 4 voters, an election with two approval items and votes on each.

    Item A: 3 Approve / 1 Deny (carries). Item B: 1 Approve / 3 Deny (fails).
    """
    org_id = _uid()
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "name": "S05 FD", "slug": f"s05-{org_id[:8]}"},
    )

    voter_ids = [_uid() for _ in range(4)]
    for n, uid in enumerate(voter_ids):
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'V', :ln, :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"s05v{n}{uid[:6]}",
                "ln": f"Voter{n}",
                "em": f"s05v{n}{uid[:6]}@test.com",
            },
        )

    ballot_items = (
        '[{"id": "%s", "type": "general_vote", "title": "Approve 2027 budget", '
        '"vote_type": "approval"}, '
        '{"id": "%s", "type": "general_vote", "title": "Adopt bylaw change", '
        '"vote_type": "approval"}]' % (ITEM_A, ITEM_B)
    )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, ballot_items, "
            "start_date, end_date, status, anonymous_voting, allow_write_ins, "
            "max_votes_per_position, voting_method, victory_condition, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'Annual Business Meeting', 'general', NULL, :items, "
            ":start, :end, 'closed', 1, 0, 1, 'simple_majority', 'most_votes', "
            ":salt, 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "items": ballot_items,
            "start": now - timedelta(days=2),
            "end": now - timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": voter_ids[0],
        },
    )

    # Approve/Deny candidates exactly as submit_ballot_with_token creates them:
    # keyed by the item's position, which for these items is the item id.
    candidates = {}
    for item in (ITEM_A, ITEM_B):
        for name, order in (("Approve", 0), ("Deny", 1)):
            cid = _uid()
            candidates[(item, name)] = cid
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, nomination_date, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, :pos, 1, 0, :ord, NOW(), NOW(), NOW())"
                ),
                {
                    "id": cid,
                    "eid": election_id,
                    "name": name,
                    "pos": item,
                    "ord": order,
                },
            )

    tallies = {
        (ITEM_A, "Approve"): 3,
        (ITEM_A, "Deny"): 1,
        (ITEM_B, "Approve"): 1,
        (ITEM_B, "Deny"): 3,
    }
    for item in (ITEM_A, ITEM_B):
        voters = iter(voter_ids)
        for name in ("Approve", "Deny"):
            for _ in range(tallies[(item, name)]):
                await db_session.execute(
                    text(
                        "INSERT INTO votes "
                        "(id, election_id, candidate_id, voter_hash, position, "
                        "voted_at, is_test, is_proxy_vote) "
                        "VALUES (:id, :eid, :cid, :vh, :pos, :at, 0, 0)"
                    ),
                    {
                        "id": _uid(),
                        "eid": election_id,
                        "cid": candidates[(item, name)],
                        "vh": f"h-{next(voters)}",
                        "pos": item,
                        "at": now - timedelta(hours=30),
                    },
                )
    await db_session.flush()

    return {"org_id": org_id, "election_id": election_id, "candidates": candidates}


async def _results(db_session, data):
    svc = ElectionService(db_session)
    results = await svc.get_election_results(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert results is not None
    return svc, results


async def test_ballot_items_are_tallied_per_item(
    db_session: AsyncSession, ballot_item_election
):
    data = ballot_item_election
    _, results = await _results(db_session, data)

    # A contest may be labelled by the item's id (its candidate position) or
    # by its title; either is one contest per item.
    by_item = {}
    for pr in results.results_by_position:
        for item_id, title in TITLES.items():
            if pr.position in (item_id, title):
                by_item[item_id] = pr
    assert set(by_item) == {ITEM_A, ITEM_B}, (
        "each ballot item must be reported as its own contest; got "
        f"{[pr.position for pr in results.results_by_position]}"
    )

    assert by_item[ITEM_A].total_votes == 4
    assert by_item[ITEM_B].total_votes == 4

    winners_a = {c.candidate_name for c in by_item[ITEM_A].candidates if c.is_winner}
    winners_b = {c.candidate_name for c in by_item[ITEM_B].candidates if c.is_winner}
    assert winners_a == {"Approve"}
    assert winners_b == {"Deny"}

    # Percentages are within the item, not across the whole ballot.
    approve_a = next(
        c for c in by_item[ITEM_A].candidates if c.candidate_name == "Approve"
    )
    assert approve_a.percentage == 75.0


async def test_ballot_item_results_email_lists_every_item(
    db_session: AsyncSession, ballot_item_election
):
    data = ballot_item_election
    svc, results = await _results(db_session, data)

    html_table, text_table = svc._build_results_tables(results)

    assert "No results available" not in text_table
    assert "No results available" not in html_table
    for item_id, title in TITLES.items():
        assert item_id in text_table or title in text_table
