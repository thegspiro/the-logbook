"""An onboarding session dies 24 hours after creation, however active it is.

ONB2-30-8: every validated call slid ``expires_at`` another 30 minutes with no
ceiling, and three routes slide it on the session id alone (no CSRF token), so
a holder of just the id could keep the pre-completion window open forever by
polling. The owner chose a 24-hour absolute lifetime from ``created_at``.

DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.onboarding import (
    SESSION_MAX_LIFETIME_HOURS,
    get_or_create_session,
    validate_session,
)

pytestmark = [pytest.mark.unit]


def _request(session_id="sid", csrf=None):
    req = MagicMock()
    headers = {"X-Session-ID": session_id}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req.headers = headers
    return req


def _db(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


def _result(value):
    res = MagicMock()
    res.scalar_one_or_none.return_value = value
    return res


def _session(age: timedelta, expires_in: timedelta, naive_created=False):
    now = datetime.now(timezone.utc)
    created = now - age
    if naive_created:
        # MySQL hands DATETIME back without tzinfo.
        created = created.replace(tzinfo=None)
    return SimpleNamespace(
        session_id="sid",
        created_at=created,
        expires_at=now + expires_in,
        data={"csrf_token": "tok"},
    )


def test_the_ceiling_is_the_owners_choice():
    assert SESSION_MAX_LIFETIME_HOURS == 24


async def test_a_young_session_still_slides_thirty_minutes():
    session = _session(timedelta(hours=1), timedelta(minutes=5))
    db = _db(_result(session))

    await validate_session(_request(csrf="tok"), db)

    remaining = session.expires_at - datetime.now(timezone.utc)
    assert timedelta(minutes=29) < remaining <= timedelta(minutes=30)
    db.commit.assert_awaited_once()


async def test_sliding_stops_at_the_ceiling():
    session = _session(timedelta(hours=23, minutes=50), timedelta(minutes=5))
    db = _db(_result(session))

    await validate_session(_request(), db, require_csrf=False)

    ceiling = session.created_at + timedelta(hours=24)
    assert session.expires_at == ceiling


@pytest.mark.parametrize("naive", [False, True])
async def test_a_session_past_the_ceiling_is_refused_even_if_recently_slid(naive):
    """Polls slid expires_at before the cap existed; the ceiling still wins."""
    session = _session(timedelta(hours=25), timedelta(minutes=20), naive_created=naive)
    before = session.expires_at
    db = _db(_result(session))

    with pytest.raises(HTTPException) as exc:
        await validate_session(_request(), db, require_csrf=False)

    assert exc.value.status_code == 401
    assert "24-hour limit" in exc.value.detail
    assert session.expires_at == before
    db.commit.assert_not_awaited()


async def test_bearer_only_polling_cannot_carry_a_session_past_24_hours():
    """The exploit path: the three no-CSRF routes, hit repeatedly."""
    session = _session(timedelta(hours=23, minutes=59), timedelta(minutes=30))
    for _ in range(5):
        await validate_session(_request(), _db(_result(session)), require_csrf=False)
    assert session.expires_at <= session.created_at + timedelta(hours=24)


async def test_resume_past_the_ceiling_mints_a_fresh_session():
    stale = _session(timedelta(hours=26), timedelta(minutes=10))
    before = stale.expires_at
    # 1: the lookup finds the stale row; 2: rehydration finds no org id.
    db = _db(_result(stale), _result(None))
    service = MagicMock()
    service.needs_onboarding = AsyncMock(return_value=True)

    with patch("app.api.v1.onboarding.OnboardingService", return_value=service):
        session = await get_or_create_session(_request(), db)

    assert session is not stale
    assert session.session_id != "sid"
    assert stale.expires_at == before
    db.add.assert_called_once()


async def test_resume_within_the_ceiling_keeps_the_session_and_clamps_it():
    current = _session(timedelta(hours=23, minutes=55), timedelta(minutes=10))
    db = _db(_result(current))
    service = MagicMock()
    service.needs_onboarding = AsyncMock(return_value=True)

    with patch("app.api.v1.onboarding.OnboardingService", return_value=service):
        session = await get_or_create_session(_request(), db)

    assert session is current
    assert current.expires_at == current.created_at + timedelta(hours=24)
    db.add.assert_not_called()
