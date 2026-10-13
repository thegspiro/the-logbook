"""An explicit ``null`` for a NOT NULL election column is refused, not a 500.

``ElectionUpdate`` types every field ``Optional`` so that a PATCH can leave any
of them out, and the handler dumps it with ``exclude_unset`` so a field that
*was* sent -- including a ``null`` -- reaches the allowlisted ``setattr`` loop.
For 17 of the 30 fields the column behind it is NOT NULL, so a null has no
meaning as "clear this": it can only be refused. These tests send each one and
require a clean 4xx. A mocked session cannot show the failure this guards
against -- it never evaluates a constraint -- so they run against the real
schema.

An ``IntegrityError`` at commit, a ``TypeError`` from comparing a null date, or a
silent 200 all fail here, and each reads differently in the failure message.
"""

import secrets
import uuid as uuid_module
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.api.v1.endpoints.elections import update_candidate, update_election
from app.models.election import Candidate, Election
from app.schemas.election import CandidateUpdate, ElectionUpdate

pytestmark = [pytest.mark.integration]


def _not_null_fields(schema, model) -> list[str]:
    """Schema fields whose column is NOT NULL, read off the model.

    Derived, not typed: a NOT NULL column added later joins the parametrization
    by itself, so it is exercised the day it appears rather than the day
    someone remembers to list it.
    """
    columns = model.__table__.columns
    return sorted(
        name
        for name in schema.model_fields
        if name in columns and not columns[name].nullable
    )


NOT_NULL_FIELDS = _not_null_fields(ElectionUpdate, Election)
# Includes `accepted`, which `update_candidate` refuses itself rather than the
# schema: it stays in the list as the control that proves a handler-level 400 is
# recognised as a clean refusal.
NOT_NULL_CANDIDATE_FIELDS = _not_null_fields(CandidateUpdate, Candidate)


@pytest.fixture
async def draft_election(db_session):
    org_id = str(uuid_module.uuid4())
    user_id = str(uuid_module.uuid4())
    election_id = str(uuid_module.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Null Column FD", "slug": f"nc-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Nora', 'Null', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"nc-admin-{user_id[:8]}",
            "em": f"nc-admin-{user_id[:8]}@test.com",
        },
    )
    now = datetime.now(timezone.utc)
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, "
            "start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, "
            "quorum_type, quorum_value, "
            "created_by, email_sent, results_visible_immediately, "
            "enable_runoffs, runoff_type, max_runoff_rounds, "
            "is_runoff, runoff_round, auto_open, created_at, updated_at) "
            "VALUES (:id, :org, 'Null Column Election', 'general', "
            ":start, :end, 'draft', 1, 0, 1, 'simple_majority', "
            "'most_votes', :salt, 'none', NULL, "
            ":creator, 0, 0, 0, 'top_two', 3, 0, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now + timedelta(days=1),
            "end": now + timedelta(days=2),
            "salt": secrets.token_hex(32),
            "creator": user_id,
        },
    )
    await db_session.flush()
    return org_id, user_id, election_id


async def _outcome(db_session, draft_election, field: str) -> str:
    """What PATCHing ``{field: null}`` does, named rather than raised."""
    org_id, user_id, election_id = draft_election

    try:
        payload = ElectionUpdate(**{field: None})
    except ValidationError:
        return "422 at the schema"

    try:
        await update_election(
            election_id=UUID(election_id),
            election_update=payload,
            db=db_session,
            current_user=SimpleNamespace(id=user_id, organization_id=org_id),
        )
    except HTTPException as exc:
        return f"{exc.status_code} from the handler"
    except Exception as exc:
        return f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}"
    return "200 accepted"


@pytest.mark.parametrize("field", NOT_NULL_FIELDS)
async def test_a_null_for_a_not_null_column_is_refused_cleanly(
    db_session, draft_election, field
):
    outcome = await _outcome(db_session, draft_election, field)

    assert outcome.split(" ")[0] in {"400", "422"}, f"{field}=null -> {outcome}"


async def _candidate_outcome(db_session, draft_election, field: str) -> str:
    """What PATCHing a candidate with ``{field: null}`` does, named not raised."""
    org_id, user_id, election_id = draft_election
    candidate = Candidate(
        id=str(uuid_module.uuid4()), election_id=election_id, name="Casey Candidate"
    )
    db_session.add(candidate)
    await db_session.flush()

    try:
        payload = CandidateUpdate(**{field: None})
    except ValidationError:
        return "422 at the schema"

    try:
        await update_candidate(
            election_id=UUID(election_id),
            candidate_id=UUID(candidate.id),
            candidate_update=payload,
            db=db_session,
            current_user=SimpleNamespace(id=user_id, organization_id=org_id),
        )
    except HTTPException as exc:
        return f"{exc.status_code} from the handler"
    except Exception as exc:
        return f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}"
    return "200 accepted"


@pytest.mark.parametrize("field", NOT_NULL_CANDIDATE_FIELDS)
async def test_a_null_candidate_field_is_refused_cleanly(
    db_session, draft_election, field
):
    outcome = await _candidate_outcome(db_session, draft_election, field)

    assert outcome.split(" ")[0] in {"400", "422"}, f"{field}=null -> {outcome}"


async def test_a_null_for_a_nullable_election_column_still_clears_it(
    db_session, draft_election
):
    """The other half of the rule: refusing NOT NULL nulls must not turn a null
    into "refused" everywhere, or the edit forms could never clear a field."""
    org_id, user_id, election_id = draft_election
    await db_session.execute(
        text("UPDATE elections SET description = :d WHERE id = :id"),
        {"d": "Annual officer election", "id": election_id},
    )
    await db_session.flush()

    response = await update_election(
        election_id=UUID(election_id),
        election_update=ElectionUpdate(description=None),
        db=db_session,
        current_user=SimpleNamespace(id=user_id, organization_id=org_id),
    )

    assert response.description is None
    assert response.title == "Null Column Election"


async def test_a_null_for_a_nullable_candidate_column_still_clears_it(
    db_session, draft_election
):
    org_id, user_id, election_id = draft_election
    candidate = Candidate(
        id=str(uuid_module.uuid4()),
        election_id=election_id,
        name="Casey Candidate",
        statement="Ready to serve",
    )
    db_session.add(candidate)
    await db_session.flush()

    updated = await update_candidate(
        election_id=UUID(election_id),
        candidate_id=UUID(candidate.id),
        candidate_update=CandidateUpdate(statement=None),
        db=db_session,
        current_user=SimpleNamespace(id=user_id, organization_id=org_id),
    )

    assert updated.statement is None
    assert updated.name == "Casey Candidate"
