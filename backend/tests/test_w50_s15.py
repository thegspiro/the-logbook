"""
W50-S15 — write-in names are stored verbatim, within the column limit.

``submit_ballot_with_token`` creates the write-in ``Candidate`` with the raw
stripped name and then reassigns ``html.escape(...)`` of it. Escaping expands
``&`` to ``&amp;`` (5 chars) and ``'`` to ``&#x27;`` (6 chars), so a name the
schema accepts (``max_length=200``) can exceed the ``String(200)`` column and
the commit raises ``DataError`` — which is not caught, so the voter gets a 500
and the whole ballot rolls back. A short name survives, but is persisted
HTML-escaped and re-escaped by every renderer (React, the results email).

The fix is to store the stripped name verbatim; renderers escape at output.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def write_in_election(db_session: AsyncSession):
    org_id, user_id, election_id = _uid(), _uid(), _uid()
    salt = secrets.token_hex(32)
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York')"
        ),
        {"id": org_id, "name": "Write-In FD", "slug": f"wi-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Wen', 'Writein', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"wi-{user_id[:8]}",
            "em": f"wi-{user_id[:8]}@test.com",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, ballot_items, "
            "start_date, end_date, status, anonymous_voting, allow_write_ins, "
            "max_votes_per_position, voting_method, victory_condition, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, 'Officer Election', 'general', :items, :start, "
            ":end, 'open', 1, 1, 1, 'simple_majority', 'most_votes', :salt, "
            "'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "items": (
                '[{"id": "item_a", "type": "position", "title": "Captain", '
                '"position": "Captain", "eligible_voter_types": ["all"]}]'
            ),
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": salt,
            "creator": user_id,
        },
    )
    await db_session.flush()

    svc = ElectionService(db_session)
    _, raw_token = await svc._generate_voting_token(
        user_id=uuid.UUID(user_id),
        election_id=uuid.UUID(election_id),
        organization_id=uuid.UUID(org_id),
        election_end_date=now + timedelta(days=1),
        anonymity_salt=salt,
    )
    await db_session.flush()
    return {"election_id": election_id, "token": raw_token}


async def _stored_write_in_name(db_session: AsyncSession, election_id: str) -> str:
    row = (
        await db_session.execute(
            select(Candidate).where(
                Candidate.election_id == election_id,
                Candidate.is_write_in.is_(True),
            )
        )
    ).scalar_one()
    return row.name


async def test_schema_max_length_write_in_name_is_accepted(
    db_session: AsyncSession, write_in_election
):
    """A 200-char name the schema allows must not blow the 200-char column."""
    # 199 chars; 39 ampersands escape to 5 chars each -> 355 > 200.
    name = ("O&" * 39 + " ").strip() + "Brien " * 20
    # rstrip so the stored (stripped) name compares byte-for-byte.
    name = name[:199].rstrip()
    assert len(name) <= 200

    result, err = await ElectionService(db_session).submit_ballot_with_token(
        token=write_in_election["token"],
        votes=[
            {
                "ballot_item_id": "item_a",
                "choice": "write_in",
                "write_in_name": name,
            }
        ],
    )

    assert err is None, err
    assert result["votes_cast"] == 1
    stored = await _stored_write_in_name(db_session, write_in_election["election_id"])
    assert stored == name


async def test_write_in_name_is_stored_verbatim_not_html_escaped(
    db_session: AsyncSession, write_in_election
):
    """Renderers escape at output; a stored ``&amp;`` renders as ``&amp;``."""
    name = "Pat O'Brien & Sons"

    result, err = await ElectionService(db_session).submit_ballot_with_token(
        token=write_in_election["token"],
        votes=[
            {
                "ballot_item_id": "item_a",
                "choice": "write_in",
                "write_in_name": name,
            }
        ],
    )

    assert err is None, err
    assert result["votes_cast"] == 1
    stored = await _stored_write_in_name(db_session, write_in_election["election_id"])
    assert stored == name
