"""A member whose only password is in an undeliverable email is refused.

``POST /users`` with no password generates a temporary one and hands it to the
welcome email — the only place it is ever written down, since the API never
returns it. On a department with email off, that email is skipped, and the
admin was told "Member added successfully!" for an account nobody could sign
in to. The create is now refused before anything is written, and the Add
Member screen reads ``GET /users/welcome-email-available`` to require a
password up front.

A create that asks for no welcome email is left alone: bulk import with its
welcome-email toggle off relies on it, and resets passwords afterwards.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1.endpoints import users as users_ep
from app.core.config import settings
from app.models.user import Organization
from app.schemas.user import AdminUserCreate
from app.services.email_service import EmailService, welcome_email_can_send


class _PastTheCheck(Exception):
    """Raised by the first step after the check, to show it was passed."""


def _email_off(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_ENABLED", False)
    monkeypatch.setattr(settings, "CLOUDFLARE_EMAIL_ENABLED", False, raising=False)


def _payload(**overrides) -> AdminUserCreate:
    base = {
        "username": "jamie",
        "email": "jamie@testville.example",
        "first_name": "Jamie",
        "last_name": "Member",
    }
    base.update(overrides)
    return AdminUserCreate(**base)


def _db_with_no_duplicates() -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    return db


async def _create(user_data: AdminUserCreate, db: MagicMock):
    return await users_ep.create_member(
        user_data=user_data,
        background_tasks=BackgroundTasks(),
        request=MagicMock(),
        db=db,
        current_user=SimpleNamespace(id="admin-1", organization_id="org-a"),
    )


@pytest.mark.unit
class TestCanSend:
    def test_off_when_nothing_turns_email_on(self, monkeypatch):
        _email_off(monkeypatch)
        org = Organization(settings={"email_service": {"enabled": False}})

        assert EmailService(org).can_send is False

    def test_on_when_the_organization_turned_it_on(self, monkeypatch):
        _email_off(monkeypatch)
        org = Organization(settings={"email_service": {"enabled": True}})

        assert EmailService(org).can_send is True

    def test_on_when_the_deployment_turned_it_on(self, monkeypatch):
        _email_off(monkeypatch)
        monkeypatch.setattr(settings, "EMAIL_ENABLED", True)

        assert EmailService(None).can_send is True

    def test_a_null_email_section_reads_as_off(self, monkeypatch):
        # PATCH /organizations/settings can store an explicit null section.
        _email_off(monkeypatch)
        org = Organization(settings={"email_service": None})

        assert EmailService(org).can_send is False


@pytest.mark.unit
class TestCreateMemberRefusal:
    async def test_no_password_and_no_email_is_refused_before_any_write(self):
        db = _db_with_no_duplicates()
        with patch.object(
            users_ep, "welcome_email_can_send", new=AsyncMock(return_value=False)
        ):
            with pytest.raises(HTTPException) as refused:
                await _create(_payload(send_welcome_email=True), db)

        assert refused.value.status_code == 400
        assert refused.value.detail == users_ep.WELCOME_EMAIL_UNAVAILABLE_DETAIL
        db.add.assert_not_called()

    async def test_no_password_is_allowed_when_email_can_send(self):
        db = _db_with_no_duplicates()
        with patch.object(
            users_ep, "welcome_email_can_send", new=AsyncMock(return_value=True)
        ), patch.object(
            users_ep, "_canonical_rank_or_400", new=AsyncMock(side_effect=_PastTheCheck)
        ):
            with pytest.raises(_PastTheCheck):
                await _create(_payload(send_welcome_email=True), db)

    async def test_a_given_password_is_allowed_without_email(self):
        db = _db_with_no_duplicates()
        email_check = AsyncMock(return_value=False)
        with patch.object(users_ep, "welcome_email_can_send", new=email_check), patch(
            "app.core.breached_password.check_password_not_breached",
            new=AsyncMock(return_value=(True, None)),
        ), patch.object(
            users_ep, "_canonical_rank_or_400", new=AsyncMock(side_effect=_PastTheCheck)
        ):
            with pytest.raises(_PastTheCheck):
                await _create(
                    _payload(password="Hydrant$Blue947", send_welcome_email=False), db
                )

        email_check.assert_not_awaited()

    async def test_no_welcome_email_requested_is_allowed_without_email(self):
        # Bulk import with its welcome-email toggle off.
        db = _db_with_no_duplicates()
        email_check = AsyncMock(return_value=False)
        with patch.object(
            users_ep, "welcome_email_can_send", new=email_check
        ), patch.object(
            users_ep, "_canonical_rank_or_400", new=AsyncMock(side_effect=_PastTheCheck)
        ):
            with pytest.raises(_PastTheCheck):
                await _create(_payload(send_welcome_email=False), db)

        email_check.assert_not_awaited()


@pytest.mark.integration
class TestWelcomeEmailAvailability:
    """The helper against a real organization row, as both callers use it."""

    async def _org(self, db_session, email_section) -> Organization:
        org = Organization(
            id=str(uuid.uuid4()),
            name="Welcome Email FD",
            slug=f"wel-{uuid.uuid4().hex[:8]}",
            settings={"email_service": email_section},
        )
        db_session.add(org)
        await db_session.flush()
        return org

    async def test_unavailable_when_the_organization_has_email_off(
        self, db_session, monkeypatch
    ):
        _email_off(monkeypatch)
        org = await self._org(db_session, {"enabled": False})

        assert await welcome_email_can_send(db_session, org.id) is False

    async def test_available_when_the_organization_has_email_on(
        self, db_session, monkeypatch
    ):
        _email_off(monkeypatch)
        org = await self._org(db_session, {"enabled": True})

        assert await welcome_email_can_send(db_session, org.id) is True

    async def test_the_endpoint_reports_the_helpers_answer(
        self, db_session, monkeypatch
    ):
        _email_off(monkeypatch)
        org = await self._org(db_session, {"enabled": False})

        body = await users_ep.check_welcome_email_available(
            db=db_session, current_user=SimpleNamespace(organization_id=org.id)
        )

        assert body == {"available": False}
