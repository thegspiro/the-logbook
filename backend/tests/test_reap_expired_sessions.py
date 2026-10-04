"""Session rows are deleted 30 days after their refresh token stops working.

A session that simply lapsed was never deleted, so every sign-in on every
device kept an IP address and browser string forever (AUTH-17). A refresh
token is dead by ``expires_at + REFRESH_TOKEN_EXPIRE_DAYS``; the reaper keeps
rows for 30 days past that.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.user import Organization, Session, User
from app.services import scheduled_tasks
from app.services.scheduled_tasks import (
    SESSION_RETENTION_DAYS_AFTER_REFRESH_EXPIRY,
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
    run_reap_expired_sessions,
)

pytestmark = pytest.mark.integration

_KEEP_DAYS = settings.REFRESH_TOKEN_EXPIRE_DAYS + (
    SESSION_RETENTION_DAYS_AFTER_REFRESH_EXPIRY
)


async def _session(db, user, expired_days_ago):
    row = Session(
        user_id=user.id,
        token=f"t-{uuid.uuid4().hex}",
        refresh_token=f"r-{uuid.uuid4().hex}",
        ip_address="203.0.113.7",
        user_agent="Firefox",
        expires_at=datetime.now(timezone.utc) - timedelta(days=expired_days_ago),
    )
    db.add(row)
    await db.flush()
    return row.id


async def _user(db):
    org = Organization(name="Reaper FD", slug=f"reap-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    user = User(
        organization_id=org.id,
        username=f"m-{uuid.uuid4().hex[:8]}",
        email=f"m-{uuid.uuid4().hex[:8]}@example.org",
    )
    db.add(user)
    await db.flush()
    return user


async def test_deletes_only_rows_past_the_retention_window(db_session):
    user = await _user(db_session)
    old = await _session(db_session, user, _KEEP_DAYS + 1)
    recent = await _session(db_session, user, _KEEP_DAYS - 1)
    live = await _session(db_session, user, -1)

    result = await run_reap_expired_sessions(db_session)

    left = set(
        (
            await db_session.execute(
                select(Session.id).where(Session.id.in_([old, recent, live]))
            )
        )
        .scalars()
        .all()
    )
    assert left == {recent, live}
    assert result["deleted"] >= 1


async def test_works_through_more_rows_than_one_batch(db_session, monkeypatch):
    monkeypatch.setattr(scheduled_tasks, "_SESSION_REAP_BATCH", 2)
    user = await _user(db_session)
    ids = [await _session(db_session, user, _KEEP_DAYS + 5) for _ in range(5)]

    await run_reap_expired_sessions(db_session)

    left = (
        (await db_session.execute(select(Session.id).where(Session.id.in_(ids))))
        .scalars()
        .all()
    )
    assert left == []


def test_the_scheduler_runs_it_daily():
    assert TASK_RUNNERS["reap_expired_sessions"] is run_reap_expired_sessions
    assert TASK_INTERVALS_SECONDS["reap_expired_sessions"] == 86400
