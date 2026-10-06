"""
Sign-in, refused sign-in, lockout and sign-out reach the audit log (W02-3),
and administrators can see and lift a lockout (W02-4).

Before this, a review install that took dozens of password sign-ins, eleven
failures and a lockout held none of them in ``audit_logs``, and the security
dashboard's "failed logins in the last hour" counted rows nothing wrote. A
locked member's correct password read as a wrong one, and the administrator
they called saw nothing on the Members page.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.api.v1.endpoints import auth as auth_ep
from app.api.v1.endpoints import users as users_ep
from app.core.config import settings
from app.core.constants import (
    AUDIT_EVENT_ACCOUNT_LOCKED,
    AUDIT_EVENT_ACCOUNT_UNLOCKED,
    AUDIT_EVENT_LOGIN,
    AUDIT_EVENT_LOGIN_FAILED,
    AUDIT_EVENT_LOGOUT,
)
from app.core.security import hash_password
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.auth import UserLogin
from app.services.auth_service import (
    AUTH_FAILURE_ACCOUNT_LOCKED,
    AUTH_FAILURE_INVALID_PASSWORD,
    AUTH_FAILURE_UNKNOWN_USER,
    AuthFailure,
    AuthService,
)

_PASSWORD = "CorrectHorseBatteryStaple1!"


def _request():
    request = MagicMock()
    request.headers = {"user-agent": "pytest"}
    return request


def _events(audit: AsyncMock) -> list[str]:
    return [c.kwargs["event_type"] for c in audit.await_args_list]


@pytest.mark.unit
class TestLoginEndpointAudits:
    @pytest.fixture(autouse=True)
    def _quiet_side_channels(self):
        with (
            patch.object(
                auth_ep.security_monitor, "detect_brute_force", new=AsyncMock()
            ),
            patch.object(auth_ep, "record_auth_failure", new=AsyncMock()),
            patch.object(auth_ep, "clear_auth_failures", new=AsyncMock()),
            patch.object(auth_ep, "get_client_ip", return_value="203.0.113.7"),
        ):
            yield

    async def _refused(self, failure: AuthFailure):
        async def refuse(service, **_kwargs):
            service.last_auth_failure = failure
            return None, "Incorrect username or password"

        db = MagicMock()
        db.commit = AsyncMock()
        with (
            patch.object(AuthService, "authenticate_user", new=refuse),
            patch.object(auth_ep, "log_audit_event", new=AsyncMock()) as audit,
            pytest.raises(HTTPException) as exc,
        ):
            await auth_ep.login(
                credentials=UserLogin(username="someone", password="wrong-pass"),
                request=_request(),
                db=db,
            )
        assert exc.value.status_code == 401
        return audit, db

    async def test_a_wrong_password_is_audited_against_the_member(self):
        audit, db = await self._refused(
            AuthFailure(
                AUTH_FAILURE_INVALID_PASSWORD, user_id="u-1", organization_id="o-1"
            )
        )

        assert _events(audit) == [AUDIT_EVENT_LOGIN_FAILED]
        call = audit.await_args.kwargs
        assert call["user_id"] == "u-1"
        assert call["organization_id"] == "o-1"
        assert call["ip_address"] == "203.0.113.7"
        assert call["event_data"]["reason"] == AUTH_FAILURE_INVALID_PASSWORD
        # The handler raises next and get_db rolls back: committed or lost.
        db.commit.assert_awaited()

    async def test_an_unknown_identifier_is_audited_platform_level(self):
        audit, _ = await self._refused(AuthFailure(AUTH_FAILURE_UNKNOWN_USER))

        call = audit.await_args.kwargs
        assert call["user_id"] is None
        assert call["organization_id"] is None
        # The typed identifier is not kept: members type passwords into it.
        assert "someone" not in str(call["event_data"])

    async def test_the_attempt_that_locks_the_account_also_records_the_lock(self):
        audit, _ = await self._refused(
            AuthFailure(
                AUTH_FAILURE_INVALID_PASSWORD,
                user_id="u-1",
                organization_id="o-1",
                locked_now=True,
            )
        )

        assert _events(audit) == [AUDIT_EVENT_LOGIN_FAILED, AUDIT_EVENT_ACCOUNT_LOCKED]

    async def test_a_password_only_sign_in_is_audited(self):
        member = SimpleNamespace(
            id="u-1",
            organization_id="o-1",
            username="member",
            is_active=True,
            mfa_enabled=False,
        )
        with (
            patch.object(
                AuthService,
                "authenticate_user",
                new=AsyncMock(return_value=(member, None)),
            ),
            patch.object(
                AuthService,
                "create_user_tokens",
                new=AsyncMock(return_value=("access", "refresh")),
            ),
            patch.object(
                auth_ep, "_build_current_user_dict", new=AsyncMock(return_value={})
            ),
            patch.object(auth_ep, "log_audit_event", new=AsyncMock()) as audit,
        ):
            await auth_ep.login(
                credentials=UserLogin(username="member", password=_PASSWORD),
                request=_request(),
                db=MagicMock(),
            )

        assert _events(audit) == [AUDIT_EVENT_LOGIN]
        assert audit.await_args.kwargs["event_data"] == {"method": "password"}
        assert audit.await_args.kwargs["organization_id"] == "o-1"

    async def test_sign_out_is_audited(self):
        member = SimpleNamespace(id="u-1", organization_id="o-1", username="member")
        with (
            patch.object(AuthService, "logout_user", new=AsyncMock(return_value=True)),
            patch.object(auth_ep, "log_audit_event", new=AsyncMock()) as audit,
        ):
            await auth_ep.logout(
                request=_request(),
                current_user=member,
                access_token_cookie="token",
                db=MagicMock(),
            )

        assert _events(audit) == [AUDIT_EVENT_LOGOUT]
        assert audit.await_args.kwargs["user_id"] == "u-1"


async def _seed(db, *, locked_until=None, attempts=0):
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    username = f"audit-{user_id[:8]}"
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, 'Audit Dept', 'fire_department', "
            ":slug, 'UTC', 1)"
        ),
        {"id": org_id, "slug": f"audit-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, failed_login_attempts, "
            "locked_until) VALUES (:id, :org, :un, 'Audit', 'Member', :em, :pw, "
            "'active', :n, :lu)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": username,
            "em": f"{username}@test.com",
            "pw": hash_password(_PASSWORD),
            "n": attempts,
            "lu": locked_until,
        },
    )
    return org_id, user_id, username


@pytest.mark.integration
class TestAuthenticateUserSaysWhy:
    async def test_each_refusal_carries_its_reason(self, db_session):
        org_id, user_id, username = await _seed(
            db_session, attempts=settings.MAX_LOGIN_ATTEMPTS - 2
        )
        service = AuthService(db_session)

        await service.authenticate_user(username, "wrong-password-1!")
        first = service.last_auth_failure
        assert first == AuthFailure(
            AUTH_FAILURE_INVALID_PASSWORD, user_id=user_id, organization_id=org_id
        )

        await service.authenticate_user(username, "wrong-password-2!")
        assert service.last_auth_failure.locked_now is True

        await service.authenticate_user(username, _PASSWORD)
        assert service.last_auth_failure.reason == AUTH_FAILURE_ACCOUNT_LOCKED
        assert service.last_auth_failure.locked_now is False

        await service.authenticate_user(f"nobody-{uuid.uuid4()}", _PASSWORD)
        assert service.last_auth_failure == AuthFailure(AUTH_FAILURE_UNKNOWN_USER)

    async def test_a_success_clears_the_last_reason(self, db_session):
        _, _, username = await _seed(db_session)
        service = AuthService(db_session)

        await service.authenticate_user(username, "wrong-password-1!")
        user, _ = await service.authenticate_user(username, _PASSWORD)

        assert user is not None
        assert service.last_auth_failure is None


@pytest.mark.integration
class TestUnlock:
    @pytest.fixture(autouse=True)
    def _within_ceiling(self):
        with patch.object(
            users_ep, "_enforce_account_reset_ceiling", new=AsyncMock()
        ) as ceiling:
            self.ceiling = ceiling
            yield

    def _admin(self, org_id):
        return SimpleNamespace(
            id=str(uuid.uuid4()), organization_id=org_id, username="officer"
        )

    async def test_unlock_lifts_the_lock_and_restores_the_allowance(self, db_session):
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        org_id, user_id, _ = await _seed(
            db_session, locked_until=until, attempts=settings.MAX_LOGIN_ATTEMPTS
        )

        await users_ep.admin_unlock_account(
            user_id=uuid.UUID(user_id), db=db_session, current_user=self._admin(org_id)
        )

        member = (
            await db_session.execute(
                select(User)
                .where(User.id == user_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert member.locked_until is None
        assert member.failed_login_attempts == 0
        self.ceiling.assert_awaited_once()
        audited = (
            await db_session.execute(
                select(AuditLog.event_type).where(
                    AuditLog.event_type == AUDIT_EVENT_ACCOUNT_UNLOCKED,
                    AuditLog.event_data["target_user_id"].as_string() == user_id,
                )
            )
        ).all()
        assert len(audited) == 1

    async def test_an_account_that_is_not_locked_is_refused(self, db_session):
        expired = datetime.now(timezone.utc) - timedelta(minutes=1)
        org_id, user_id, _ = await _seed(db_session, locked_until=expired)

        with pytest.raises(HTTPException) as exc:
            await users_ep.admin_unlock_account(
                user_id=uuid.UUID(user_id),
                db=db_session,
                current_user=self._admin(org_id),
            )
        assert exc.value.status_code == 400

    async def test_another_organizations_member_is_not_found(self, db_session):
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        _, user_id, _ = await _seed(db_session, locked_until=until)

        with pytest.raises(HTTPException) as exc:
            await users_ep.admin_unlock_account(
                user_id=uuid.UUID(user_id),
                db=db_session,
                current_user=self._admin(str(uuid.uuid4())),
            )
        assert exc.value.status_code == 404


@pytest.mark.unit
class TestLockStateDisclosure:
    def _member(self, locked_until):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid.uuid4(),
            organization_id=uuid.uuid4(),
            username="member",
            first_name="Jordan",
            last_name="Avery",
            email="m@example.org",
            status="active",
            created_at=now,
            updated_at=now,
            locked_until=locked_until,
            roles=[],
            emergency_contacts=[],
        )

    def _payload(self, locked_until, *, is_admin):
        with (
            patch.object(users_ep, "resolve_profile_visibility", return_value={}),
            patch.object(users_ep, "_clear_hidden_contact_fields"),
        ):
            return users_ep._redact_contact_fields(
                self._member(locked_until), {}, is_admin
            )

    def test_a_members_manager_sees_a_lock_in_force(self):
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        assert self._payload(until, is_admin=True).locked_until == until

    def test_an_expired_lock_is_not_reported(self):
        until = datetime.now(timezone.utc) - timedelta(minutes=1)
        assert self._payload(until, is_admin=True).locked_until is None

    def test_other_callers_never_see_lock_state(self):
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        assert self._payload(until, is_admin=False).locked_until is None
