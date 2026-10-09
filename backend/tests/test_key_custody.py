"""Confirming the encryption key is stored apart from the server (decision 25)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.security import reset_encryption_ciphers
from app.models.audit import AuditLog
from app.models.onboarding import EncryptionKeyCustody
from app.schemas.system_notices import KeyCustodyConfirm
from app.services import key_custody_service, system_notices

KEY_A = "a" * 64
KEY_B = "b" * 64


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_A)
    monkeypatch.setattr(settings, "ENCRYPTION_KEYS_LEGACY", "")
    reset_encryption_ciphers()
    monkeypatch.setattr(
        system_notices.upload_encryption, "plaintext_remains", lambda: False
    )
    monkeypatch.setattr(system_notices.settings, "CLAMAV_ENABLED", True)
    yield
    reset_encryption_ciphers()


def _request():
    return SimpleNamespace(headers={}, client=SimpleNamespace(host="203.0.113.9"))


@pytest.mark.integration
class TestTheRecord:
    async def test_a_confirmation_is_recorded_once_and_audited(self, db_session):
        fingerprint = key_custody_service.current_fingerprint()
        assert not await key_custody_service.is_confirmed(db_session)

        first = await key_custody_service.confirm(
            db_session,
            key_fingerprint=fingerprint,
            user_id=None,
            username="chief",
            via="settings",
        )
        again = await key_custody_service.confirm(
            db_session,
            key_fingerprint=fingerprint,
            user_id=None,
            username="deputy",
            via="settings",
        )

        assert again.id == first.id
        assert await key_custody_service.is_confirmed(db_session)
        rows = (
            await db_session.execute(
                select(EncryptionKeyCustody).where(
                    EncryptionKeyCustody.key_fingerprint == fingerprint
                )
            )
        ).scalars()
        assert len(list(rows)) == 1
        audits = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "encryption_key.custody_confirmed"
                )
            )
        ).scalars()
        assert [a.username for a in audits] == ["chief"]

    async def test_a_key_other_than_the_one_shown_is_refused(self, db_session):
        with pytest.raises(ValueError, match="changed"):
            await key_custody_service.confirm(
                db_session,
                key_fingerprint="0" * 16,
                user_id=None,
                username="chief",
                via="settings",
            )
        assert not await key_custody_service.is_confirmed(db_session)

    async def test_a_rotated_key_needs_confirming_again(self, db_session, monkeypatch):
        await key_custody_service.confirm(
            db_session,
            key_fingerprint=key_custody_service.current_fingerprint(),
            user_id=None,
            username="chief",
            via="settings",
        )
        monkeypatch.setattr(settings, "ENCRYPTION_KEY", KEY_B)
        reset_encryption_ciphers()
        assert not await key_custody_service.is_confirmed(db_session)


@pytest.mark.integration
class TestTheNotice:
    async def test_shown_until_confirmed_then_gone(
        self, db_session, setup_org_and_admin
    ):
        from app.api.v1.endpoints import system_notices as endpoint

        _, admin_id = setup_org_and_admin

        notices = await endpoint.list_system_notices(db=db_session, current_user=None)
        assert [n.key for n in notices] == [system_notices.KEY_CUSTODY_UNCONFIRMED]
        assert notices[0].action == "confirm_key_custody"

        user = SimpleNamespace(id=admin_id, username="chief")
        status = await endpoint.get_key_custody(db=db_session, current_user=user)
        assert not status.confirmed
        result = await endpoint.confirm_key_custody(
            KeyCustodyConfirm(key_fingerprint=status.key_fingerprint),
            _request(),
            db=db_session,
            current_user=user,
        )

        assert result.confirmed
        assert result.confirmed_via == "settings"
        record = await key_custody_service.confirmation_for_current_key(db_session)
        assert record is not None
        assert record.confirmed_by == admin_id
        assert (
            await endpoint.list_system_notices(db=db_session, current_user=None) == []
        )

    async def test_a_stale_fingerprint_is_a_conflict(self, db_session):
        from app.api.v1.endpoints import system_notices as endpoint

        with pytest.raises(HTTPException) as exc:
            await endpoint.confirm_key_custody(
                KeyCustodyConfirm(key_fingerprint="0" * 16),
                _request(),
                db=db_session,
                current_user=SimpleNamespace(id=None, username="chief"),
            )
        assert exc.value.status_code == 409


@pytest.mark.unit
class TestTheEndpoints:
    def test_every_route_needs_settings_manage(self):
        from fastapi.routing import APIRoute

        from app.api.v1.endpoints import system_notices as endpoint

        routes = [r for r in endpoint.router.routes if isinstance(r, APIRoute)]
        assert len(routes) == 3
        for route in routes:
            checker = route.dependant.dependencies[-1].call
            assert checker.required_permissions == ["settings.manage"]

    def test_the_fingerprint_must_look_like_one(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            KeyCustodyConfirm(key_fingerprint="not-a-fingerprint")


@pytest.mark.unit
class TestTheOnboardingStep:
    def _db(self, owner):
        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = owner
        db.execute = AsyncMock(return_value=result)
        db.commit = AsyncMock()
        return db

    def _service(self, *, needs_onboarding=True):
        svc = MagicMock()
        svc.needs_onboarding = AsyncMock(return_value=needs_onboarding)
        svc.get_onboarding_status = AsyncMock(
            return_value=SimpleNamespace(admin_username="chief")
        )
        svc._mark_step_completed = AsyncMock()
        return svc

    async def _call(self, svc, db, confirm):
        from app.api.v1.onboarding import save_session_key_custody

        session = SimpleNamespace(data={"department": {"organization_id": "org-1"}})
        with (
            patch(
                "app.api.v1.onboarding.validate_session",
                new=AsyncMock(return_value=session),
            ),
            patch("app.api.v1.onboarding.OnboardingService", return_value=svc),
            patch.object(key_custody_service, "confirm", confirm),
        ):
            return await save_session_key_custody(
                _request(), KeyCustodyConfirm(key_fingerprint="0" * 16), db
            )

    async def test_records_the_system_owner_and_marks_the_step(self):
        svc = self._service()
        confirm = AsyncMock()
        response = await self._call(
            svc, self._db(SimpleNamespace(id="owner-1")), confirm
        )

        assert response.step == "key_custody"
        kwargs = confirm.await_args.kwargs
        assert kwargs["user_id"] == "owner-1"
        assert kwargs["via"] == "onboarding"
        assert svc._mark_step_completed.await_args.args[1] == "key_custody"

    async def test_refused_once_setup_is_complete(self):
        svc = self._service(needs_onboarding=False)
        confirm = AsyncMock()
        with pytest.raises(HTTPException) as exc:
            await self._call(svc, self._db(None), confirm)
        assert exc.value.status_code == 400
        confirm.assert_not_awaited()

    async def test_a_changed_key_does_not_mark_the_step(self):
        svc = self._service()
        confirm = AsyncMock(side_effect=ValueError("The key has changed"))
        with pytest.raises(HTTPException) as exc:
            await self._call(svc, self._db(SimpleNamespace(id="owner-1")), confirm)
        assert exc.value.status_code == 409
        svc._mark_step_completed.assert_not_awaited()


@pytest.mark.integration
async def test_setup_cannot_finish_without_the_key_step(db_session):
    from app.models.onboarding import OnboardingStatus
    from app.services.onboarding import OnboardingService

    service = OnboardingService(db_session)
    status = await service.get_onboarding_status()
    if status is None:
        status = OnboardingStatus()
        db_session.add(status)
    status.is_completed = False
    status.steps_completed = {
        "organization": {"completed": True},
        "admin_user": {"completed": True},
    }
    await db_session.flush()

    with pytest.raises(ValueError, match="key_custody"):
        await service.complete_onboarding()
