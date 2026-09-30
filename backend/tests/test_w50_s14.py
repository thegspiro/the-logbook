"""
W50 / S14 — the election report must not go out while voting is open.

``POST /elections/{id}/send-report`` reaches
``ElectionService.generate_and_send_election_report`` which pulls the tally
with ``_internal_bypass_visibility=True`` and never looks at the election's
status. The UI hides "Send Report" until the election is closed; the API does
not, so an officer holding ``elections.manage`` can email per-candidate live
tallies mid-vote.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def open_election(db_session: AsyncSession):
    """Org, three members, an OPEN election with two candidates for Chief."""
    org_id = _uid()
    users = [(_uid(), f"voter{i}") for i in range(3)]
    election_id = _uid()
    cand_a, cand_b = _uid(), _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "name": "S14 FD", "slug": f"s14-{org_id[:8]}"},
    )
    for uid, uname in users:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :un, 'Member', :em, 'x', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
        )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, start_date, "
            "end_date, status, anonymous_voting, allow_write_ins, "
            "max_votes_per_position, voting_method, victory_condition, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'Officer Election', 'officer', '[\"Chief\"]', "
            ":start, :end, 'open', 1, 0, 1, 'simple_majority', 'most_votes', "
            ":salt, 'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": users[0][0],
        },
    )
    for cid, (uid, uname), order in [(cand_a, users[0], 0), (cand_b, users[1], 1)]:
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, user_id, name, position, "
                "accepted, is_write_in, display_order, nomination_date, "
                "created_at, updated_at) "
                "VALUES (:id, :eid, :uid, :name, 'Chief', 1, 0, :ord, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id, "uid": uid, "name": uname, "ord": order},
        )
    await db_session.flush()

    svc = ElectionService(db_session)
    for uid, _ in users[:2]:
        _, err = await svc.cast_vote(
            user_id=uuid.UUID(uid),
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(cand_a),
            position="Chief",
            organization_id=uuid.UUID(org_id),
        )
        assert err is None, err

    return {"org_id": org_id, "election_id": election_id, "candidate_a": cand_a}


async def test_report_refused_while_voting_is_open(
    db_session: AsyncSession, open_election
):
    data = open_election
    svc = ElectionService(db_session)

    send = AsyncMock(return_value=(1, 0))
    with patch("app.services.email_service.EmailService.send_election_report", send):
        success, message = await svc.generate_and_send_election_report(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            requested=True,
        )

    # The live tally must never leave the system before the election closes.
    assert (
        send.await_count == 0
    ), "report emailed while OPEN; results_text was:\n" + str(
        send.await_args.kwargs.get("results_text")
    )
    assert success is False
    assert "open" in message.lower() or "clos" in message.lower()
