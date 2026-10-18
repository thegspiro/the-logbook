"""
A self-service password change reaches the audit log, refused or not, and
tells the member it happened; a token reset names the member it reset.

HIPAA §164.312(b) audit controls cover credential changes. ``POST
/auth/change-password`` wrote no audit row at all, so a takeover that began
by changing a member's password left nothing in ``audit_logs`` and sent the
member nothing. The token reset did audit, but platform-level, so the row
could not be found from the member it concerned.

The refusal rows are the subtle half: the handler raises after auditing, and
``get_db`` rolls back on an exception, so each test rolls the session back
before reading — as the request would — and the row must still be there.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select, text

import app.services.auth_service as auth_module
from app.api.v1.endpoints import auth as auth_ep
from app.core.constants import (
    AUDIT_EVENT_PASSWORD_CHANGE_FAILED,
    AUDIT_EVENT_PASSWORD_CHANGED,
)
from app.core.security import hash_password
from app.models.audit import AuditLog
from app.models.notification import NotificationLog
from app.models.user import User
from app.schemas.auth import PasswordChange, PasswordReset
from app.services.auth_service import (
    PASSWORD_CHANGE_FAILURE_BREACHED,
    PASSWORD_CHANGE_FAILURE_INVALID_CURRENT,
    PASSWORD_CHANGE_FAILURE_MINIMUM_AGE,
    PASSWORD_CHANGE_FAILURE_REUSED,
    PASSWORD_CHANGE_FAILURE_SAME_AS_CURRENT,
    PASSWORD_CHANGE_FAILURE_WEAK,
)
from app.utils.security_notifications import _send_security_email

pytestmark = pytest.mark.integration

_CURRENT = "CorrectHorseBatteryStaple1!"
_NEW = "Tanker$Maple947-Hydrant"
_IP = "203.0.113.9"


@pytest.fixture(autouse=True)
def _fixed_client_ip():
    with patch.object(auth_ep, "get_client_ip", return_value=_IP):
        yield


def _request():
    request = MagicMock()
    request.headers = {"user-agent": "pytest-agent"}
    return request


async def _seed(db, *, changed_at=None, reset_token=None):
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    username = f"pwaudit-{user_id[:8]}"
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, 'Audit Dept', 'fire_department', "
            ":slug, 'UTC', 1)"
        ),
        {"id": org_id, "slug": f"pwaudit-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, must_change_password, "
            "password_changed_at, password_reset_token, "
            "password_reset_expires_at) VALUES (:id, :org, :un, 'Audit', "
            "'Member', :em, :pw, 'active', 0, :changed, :token, :expires)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": username,
            "em": f"{username}@test.com",
            "pw": hash_password(_CURRENT),
            "changed": changed_at,
            "token": (
                hashlib.sha256(reset_token.encode()).hexdigest()
                if reset_token
                else None
            ),
            "expires": (
                datetime.now(timezone.utc) + timedelta(minutes=30)
                if reset_token
                else None
            ),
        },
    )
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    return org_id, user


async def _rows(db, event_type, **filters):
    query = select(AuditLog).where(AuditLog.event_type == event_type)
    for column, value in filters.items():
        query = query.where(getattr(AuditLog, column) == value)
    return (await db.execute(query)).scalars().all()


async def _refused(db, user, new_password):
    with pytest.raises(HTTPException) as exc:
        await auth_ep.change_password(
            password_data=PasswordChange(
                current_password=(
                    "not-the-password" if new_password is None else _CURRENT
                ),
                new_password=new_password or _NEW,
            ),
            request=_request(),
            background_tasks=BackgroundTasks(),
            current_user=user,
            db=db,
        )
    assert exc.value.status_code == 400
    # What get_db does as the HTTPException propagates.
    await db.rollback()
    rows = await _rows(db, AUDIT_EVENT_PASSWORD_CHANGE_FAILED, user_id=str(user.id))
    assert len(rows) == 1
    return rows[0]


class TestChangePasswordSuccess:
    async def test_a_change_is_audited_against_the_member(self, db_session):
        org_id, user = await _seed(db_session)
        tasks = BackgroundTasks()

        result = await auth_ep.change_password(
            password_data=PasswordChange(current_password=_CURRENT, new_password=_NEW),
            request=_request(),
            background_tasks=tasks,
            current_user=user,
            db=db_session,
        )

        assert result == {"message": "Password changed successfully"}
        rows = await _rows(db_session, AUDIT_EVENT_PASSWORD_CHANGED, user_id=user.id)
        assert len(rows) == 1
        row = rows[0]
        assert row.organization_id == org_id
        assert row.username == user.username
        assert row.severity.value == "info"
        assert row.ip_address == _IP
        assert row.user_agent == "pytest-agent"
        assert _CURRENT not in str(row.event_data)
        assert _NEW not in str(row.event_data)

    async def test_the_member_is_sent_a_security_notice(self, db_session):
        _, user = await _seed(db_session)
        tasks = BackgroundTasks()

        await auth_ep.change_password(
            password_data=PasswordChange(current_password=_CURRENT, new_password=_NEW),
            request=_request(),
            background_tasks=tasks,
            current_user=user,
            db=db_session,
        )

        notices = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.recipient_id == user.id,
                        NotificationLog.category == "security",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [n.subject for n in notices] == ["Your password was changed"]
        # The email goes after the response, on its own session, and swallows
        # its own failures — it cannot turn a saved change into an error.
        assert [t.func for t in tasks.tasks] == [_send_security_email]
        assert tasks.tasks[0].args[1] == user.email


class TestChangePasswordRefusals:
    async def test_a_wrong_current_password(self, db_session):
        org_id, user = await _seed(db_session)

        row = await _refused(db_session, user, None)

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_INVALID_CURRENT}
        assert row.organization_id == org_id
        assert row.username == user.username
        assert row.severity.value == "warning"
        assert row.ip_address == _IP
        assert row.user_agent == "pytest-agent"
        assert "not-the-password" not in str(row.event_data)

    async def test_the_minimum_age(self, db_session, monkeypatch):
        monkeypatch.setattr(auth_module.settings, "HIPAA_MINIMUM_PASSWORD_AGE_DAYS", 1)
        _, user = await _seed(db_session, changed_at=datetime.now(timezone.utc))
        await auth_module._save_password_to_history(
            db_session, str(user.id), hash_password("An0ther$Older-Passphrase")
        )

        row = await _refused(db_session, user, _NEW)

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_MINIMUM_AGE}

    async def test_a_weak_password(self, db_session):
        _, user = await _seed(db_session)

        row = await _refused(db_session, user, "aaaaaaaaaaaa")

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_WEAK}

    async def test_a_breached_password(self, db_session):
        _, user = await _seed(db_session)

        async def breached(_password):
            return False, "That password has appeared in a data breach."

        with patch.object(auth_module, "check_password_not_breached", new=breached):
            row = await _refused(db_session, user, _NEW)

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_BREACHED}

    async def test_a_reused_password(self, db_session):
        _, user = await _seed(db_session)
        await auth_module._save_password_to_history(
            db_session, str(user.id), hash_password(_NEW)
        )

        row = await _refused(db_session, user, _NEW)

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_REUSED}

    async def test_the_current_password_again(self, db_session):
        _, user = await _seed(db_session)

        row = await _refused(db_session, user, _CURRENT)

        assert row.event_data == {"reason": PASSWORD_CHANGE_FAILURE_SAME_AS_CURRENT}

    async def test_a_refusal_sends_no_notice(self, db_session):
        _, user = await _seed(db_session)

        await _refused(db_session, user, None)

        notices = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.recipient_id == user.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert notices == []


class TestTokenResetAttribution:
    async def test_a_completed_reset_names_the_member(self, db_session):
        token = secrets.token_urlsafe(32)
        org_id, user = await _seed(db_session, reset_token=token)

        await auth_ep.reset_password(
            reset_data=PasswordReset(token=token, new_password=_NEW),
            request=_request(),
            db=db_session,
        )

        rows = await _rows(
            db_session, "auth.password_reset_completed", user_id=str(user.id)
        )
        assert len(rows) == 1
        assert rows[0].organization_id == org_id
        assert rows[0].username == user.username

    async def test_a_refused_reset_is_kept_and_names_nobody(self, db_session):
        bogus = f"bogus-{uuid.uuid4()}"

        with pytest.raises(HTTPException):
            await auth_ep.reset_password(
                reset_data=PasswordReset(token=bogus, new_password=_NEW),
                request=_request(),
                db=db_session,
            )
        await db_session.rollback()

        rows = await _rows(db_session, "auth.password_reset_failed", ip_address=_IP)
        assert len(rows) == 1
        assert rows[0].user_id is None
        assert rows[0].organization_id is None
