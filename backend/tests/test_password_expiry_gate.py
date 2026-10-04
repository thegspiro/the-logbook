"""
The API refuses an expired password, a grace period after the member is told
(AUTH-15).

``HIPAA_MAXIMUM_PASSWORD_AGE_DAYS`` was enforced only by the browser's
redirect; a script or any non-SPA client got a full session on a password
years old. Turning a server gate on outright would have locked every member
past the age out on the day it deployed, so the gate closes
``HIPAA_PASSWORD_EXPIRY_GRACE_DAYS`` after the member was first told, by the
daily notice or by their first request after expiry.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api import dependencies as deps
from app.core.config import settings
from app.core.security import hash_password
from app.models.user import User
from app.services import scheduled_tasks
from app.services.auth_service import AuthService
from app.utils.password_expiry import (
    is_password_expired,
    is_past_grace,
    password_change_deadline,
)

NOW = datetime.now(timezone.utc)
MAX_AGE = settings.HIPAA_MAXIMUM_PASSWORD_AGE_DAYS
GRACE = settings.HIPAA_PASSWORD_EXPIRY_GRACE_DAYS


def _member(*, age_days, notified_days_ago=None):
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        username="member",
        must_change_password=False,
        mfa_enabled=True,
        is_active=True,
        password_changed_at=NOW - timedelta(days=age_days),
        password_expiry_notified_at=(
            None
            if notified_days_ago is None
            else NOW - timedelta(days=notified_days_ago)
        ),
    )


def _request(path):
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "client": ("203.0.113.9", 51234),
            "server": ("testserver", 80),
            "scheme": "http",
            "root_path": "",
            "app": None,
            "state": {},
        }
    )


async def _resolve(user, path="/api/v1/events"):
    db = MagicMock()
    db.flush = AsyncMock()
    with patch.object(
        deps.AuthService, "get_user_from_token", AsyncMock(return_value=user)
    ):
        return await deps.get_current_user(_request(path), None, "token", db)


@pytest.mark.unit
class TestExpiryArithmetic:
    def test_a_password_inside_the_age_limit_is_not_expired(self):
        assert not is_password_expired(_member(age_days=MAX_AGE - 1))

    def test_a_member_never_told_is_never_past_grace(self):
        member = _member(age_days=MAX_AGE * 5)
        assert is_password_expired(member)
        assert password_change_deadline(member) is None
        assert not is_past_grace(member)

    def test_the_deadline_runs_from_the_notice(self):
        member = _member(age_days=MAX_AGE + 30, notified_days_ago=2)
        assert password_change_deadline(member) == (
            member.password_expiry_notified_at + timedelta(days=GRACE)
        )

    def test_an_account_with_no_recorded_change_never_expires(self):
        member = _member(age_days=0)
        member.password_changed_at = None
        assert not is_password_expired(member)


@pytest.mark.unit
class TestGate:
    async def test_the_first_request_after_expiry_starts_the_grace(self):
        member = _member(age_days=MAX_AGE + 400)

        assert await _resolve(member) is member
        assert member.password_expiry_notified_at is not None

    async def test_inside_the_grace_period_requests_still_pass(self):
        member = _member(age_days=MAX_AGE + 400, notified_days_ago=GRACE - 1)
        assert await _resolve(member) is member

    async def test_after_the_grace_period_requests_are_refused(self):
        member = _member(age_days=MAX_AGE + 400, notified_days_ago=GRACE + 1)

        with pytest.raises(HTTPException) as exc:
            await _resolve(member)
        assert exc.value.status_code == 403
        assert exc.value.headers["X-Password-Change-Required"] == "true"

    async def test_the_password_change_stays_reachable(self):
        member = _member(age_days=MAX_AGE + 400, notified_days_ago=GRACE + 1)
        assert await _resolve(member, "/api/v1/auth/change-password") is member

    async def test_a_current_password_is_left_alone(self):
        member = _member(age_days=1)
        assert await _resolve(member) is member
        assert member.password_expiry_notified_at is None


async def _seed(db, *, age_days, notified=None, username=None):
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, 'Expiry Dept', 'fire_department', "
            ":slug, 'UTC', 1)"
        ),
        {"id": org_id, "slug": f"expiry-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, password_changed_at, "
            "password_expiry_notified_at) VALUES (:id, :org, :un, 'Expiry', "
            "'Member', :em, :pw, 'active', :changed, :notified)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": username or f"expiry-{user_id[:8]}",
            "em": f"expiry-{user_id[:8]}@test.com",
            "pw": hash_password("CorrectHorseBatteryStaple1!"),
            "changed": NOW - timedelta(days=age_days),
            "notified": notified,
        },
    )
    return user_id


async def _notified_at(db, user_id):
    return (
        await db.execute(
            select(User.password_expiry_notified_at)
            .where(User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.mark.integration
class TestDailyNotice:
    async def test_expired_members_are_told_once(self, db_session):
        expired = await _seed(db_session, age_days=MAX_AGE + 10)
        current = await _seed(db_session, age_days=5)
        earlier = NOW - timedelta(days=3)
        told = await _seed(db_session, age_days=MAX_AGE + 10, notified=earlier)

        with patch(
            "app.utils.security_notifications.notify_security_event",
            new=AsyncMock(),
        ) as notify:
            await scheduled_tasks.run_notify_expired_passwords(db_session)
            notified_ids = {str(c.args[1].id) for c in notify.await_args_list}

            assert expired in notified_ids
            assert current not in notified_ids
            assert told not in notified_ids
            assert await _notified_at(db_session, expired) is not None
            assert await _notified_at(db_session, current) is None

            notify.reset_mock()
            await scheduled_tasks.run_notify_expired_passwords(db_session)
            again = {str(c.args[1].id) for c in notify.await_args_list}
        assert expired not in again

    async def test_a_deactivated_departments_members_are_not_told(self, db_session):
        user_id = await _seed(db_session, age_days=MAX_AGE + 10)
        await db_session.execute(
            text(
                "UPDATE organizations SET active = 0 WHERE id = "
                "(SELECT organization_id FROM users WHERE id = :u)"
            ),
            {"u": user_id},
        )

        with patch(
            "app.utils.security_notifications.notify_security_event",
            new=AsyncMock(),
        ) as notify:
            await scheduled_tasks.run_notify_expired_passwords(db_session)

        assert user_id not in {str(c.args[1].id) for c in notify.await_args_list}

    async def test_one_failed_notice_does_not_stop_the_rest(self, db_session):
        first = await _seed(db_session, age_days=MAX_AGE + 10)
        second = await _seed(db_session, age_days=MAX_AGE + 10)
        # The job's rollback must undo only the failed notice, not the rows it
        # is working through; db_session turns this into a savepoint.
        await db_session.commit()
        calls = []

        async def flaky(_db, user, **_kwargs):
            calls.append(str(user.id))
            if len(calls) == 1:
                raise RuntimeError("mail relay down")

        with patch("app.utils.security_notifications.notify_security_event", new=flaky):
            await scheduled_tasks.run_notify_expired_passwords(db_session)

        assert {first, second} <= set(calls)
        told = [await _notified_at(db_session, u) for u in (first, second)]
        # The failed one is rolled back and will be told on the next run.
        assert sorted(t is None for t in told) == [False, True]


@pytest.mark.integration
class TestChangingThePasswordClearsTheNotice:
    async def test_change_password_resets_the_grace(self, db_session):
        user_id = await _seed(
            db_session, age_days=MAX_AGE + 10, notified=NOW - timedelta(days=30)
        )
        user = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()

        ok, error = await AuthService(db_session).change_password(
            user, "CorrectHorseBatteryStaple1!", "Tanker$Maple947-Hydrant"
        )

        assert ok, error
        assert user.password_expiry_notified_at is None
        assert not is_password_expired(user)
