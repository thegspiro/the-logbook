"""Mandatory MFA for privileged members, and step-up re-verification.

Privileged members (administration, health records) must use MFA after a grace
period; a handful of sensitive actions additionally need the caller to have
re-verified on the current session within a short window.
"""

import ast
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api import dependencies
from app.api.dependencies import evaluate_mfa_requirement, require_stepup
from app.core.config import settings
from app.core.error_codes import ErrorCode
from app.services import mfa_policy
from app.services.auth_service import AuthService

pytestmark = pytest.mark.real_stepup

NOW = datetime.now(timezone.utc)


def _now() -> datetime:
    """The clock now, for stamps ``require_stepup`` measures against its own
    clock. ``NOW`` is taken once at import, so in a long suite run it can be
    older than the step-up window by the time these tests run."""
    return datetime.now(timezone.utc)


def _user(permissions=(), grace=None):
    position = SimpleNamespace(permissions=list(permissions))
    return SimpleNamespace(
        id="user-1",
        username="chief",
        positions=[position],
        rank=None,
        mfa_enabled=False,
        mfa_grace_started_at=grace,
    )


@pytest.mark.unit
class TestPrivilegedSet:
    @pytest.mark.parametrize(
        "granted",
        [
            {"*"},
            {"settings.*"},
            {"audit.export"},
            {"medical_screening.view"},
            {"users.update_positions"},
        ],
    )
    def test_these_make_a_member_privileged(self, granted):
        assert mfa_policy.is_privileged(granted)

    @pytest.mark.parametrize(
        "granted",
        [set(), {"training.manage"}, {"events.view"}, {"inventory.manage"}],
    )
    def test_ordinary_officer_grants_do_not(self, granted):
        assert not mfa_policy.is_privileged(granted)

    def test_the_seeded_positions_that_must_use_mfa(self):
        from app.core.permissions import DEFAULT_POSITIONS

        privileged = {
            slug
            for slug, position in DEFAULT_POSITIONS.items()
            if mfa_policy.is_privileged(position["permissions"])
        }
        assert privileged == {
            "fire_chief",
            "deputy_chief",
            "assistant_chief",
            "it_manager",
            "president",
            "secretary",
            "membership_coordinator",
        }

    @pytest.mark.parametrize("granted", [{"audit.view"}, {"members.manage"}])
    def test_widely_held_officer_grants_are_not_privileged(self, granted):
        assert not mfa_policy.is_privileged(granted)

    @pytest.mark.parametrize(
        "granted", [{"inventory.view_medical"}, {"inventory.manage_medical"}]
    )
    def test_medical_inventory_holds_no_patient_data_so_is_not_privileged(
        self, granted
    ):
        assert not mfa_policy.is_privileged(granted)


@pytest.mark.unit
class TestGrace:
    def test_a_clock_that_has_not_started_is_not_expired(self):
        with patch.object(settings, "MFA_GRACE_DAYS", 14):
            assert not mfa_policy.grace_expired(None, NOW)

    def test_a_zero_day_grace_closes_at_once(self):
        with patch.object(settings, "MFA_GRACE_DAYS", 0):
            assert mfa_policy.grace_expired(None, NOW)

    def test_expires_after_the_configured_days(self):
        with patch.object(settings, "MFA_GRACE_DAYS", 14):
            assert not mfa_policy.grace_expired(NOW - timedelta(days=13), NOW)
            assert mfa_policy.grace_expired(NOW - timedelta(days=15), NOW)

    def test_a_naive_timestamp_is_read_as_utc(self):
        naive = (NOW - timedelta(days=20)).replace(tzinfo=None)
        assert mfa_policy.grace_expired(naive, NOW)


@pytest.mark.unit
class TestEvaluateRequirement:
    async def _evaluate(self, user, org_requires=False):
        db = MagicMock()
        db.flush = AsyncMock()
        with patch(
            "app.utils.security_notifications.notify_security_event", AsyncMock()
        ) as notify:
            result = await evaluate_mfa_requirement(db, user, org_requires)
        return result, db, notify

    async def test_the_org_switch_requires_it_of_everyone(self):
        result, db, _ = await self._evaluate(_user(), org_requires=True)
        assert result.required
        db.flush.assert_not_awaited()

    async def test_an_ordinary_member_is_not_required(self):
        result, _, notify = await self._evaluate(_user({"events.view"}))
        assert not result.required
        assert result.grace_ends_at is None
        notify.assert_not_awaited()

    async def test_a_newly_privileged_member_starts_a_grace_period_and_is_told(self):
        user = _user({"audit.export"})
        result, db, notify = await self._evaluate(user)

        assert not result.required
        assert user.mfa_grace_started_at is not None
        assert result.grace_ends_at == mfa_policy.grace_ends_at(
            user.mfa_grace_started_at
        )
        db.flush.assert_awaited_once()
        notify.assert_awaited_once()

    async def test_a_member_inside_the_period_is_not_told_again(self):
        user = _user({"*"}, grace=NOW - timedelta(days=3))
        result, _, notify = await self._evaluate(user)
        assert not result.required
        notify.assert_not_awaited()

    async def test_after_the_period_the_gate_closes(self):
        user = _user({"*"}, grace=NOW - timedelta(days=30))
        result, _, _ = await self._evaluate(user)
        assert result.required

    async def test_losing_privilege_clears_the_clock_so_a_return_gets_a_fresh_one(
        self,
    ):
        user = _user({"events.view"}, grace=NOW - timedelta(days=30))
        result, db, _ = await self._evaluate(user)
        assert not result.required
        assert user.mfa_grace_started_at is None
        db.flush.assert_awaited_once()


def _session(verified=None):
    return SimpleNamespace(id="s-1", user_id="user-1", stepup_verified_at=verified)


@pytest.mark.unit
class TestRequireStepup:
    async def _call(self, session, token="tok"):
        with patch.object(
            AuthService, "get_session_for_token", AsyncMock(return_value=session)
        ):
            return await require_stepup(
                authorization=None,
                access_token=token,
                current_user=_user(),
                db=MagicMock(),
            )

    async def test_never_verified_is_refused_with_the_stepup_code(self):
        with pytest.raises(HTTPException) as exc:
            await self._call(_session(None))
        assert exc.value.status_code == 403
        assert exc.value.error_code == ErrorCode.AUTH_STEPUP_REQUIRED
        assert exc.value.headers == {"X-Stepup-Required": "true"}

    async def test_a_recent_verification_passes(self):
        user = await self._call(_session(_now() - timedelta(minutes=2)))
        assert user.username == "chief"

    async def test_a_stale_verification_is_refused(self):
        stale = _now() - timedelta(minutes=settings.STEPUP_WINDOW_MINUTES + 1)
        with pytest.raises(HTTPException):
            await self._call(_session(stale))

    async def test_a_naive_stamp_is_read_as_utc(self):
        fresh = (_now() - timedelta(minutes=1)).replace(tzinfo=None)
        assert await self._call(_session(fresh))

    async def test_no_session_is_refused(self):
        with pytest.raises(HTTPException):
            await self._call(None)

    async def test_a_bearer_header_is_accepted_when_there_is_no_cookie(self):
        with patch.object(
            AuthService,
            "get_session_for_token",
            AsyncMock(return_value=_session(_now())),
        ) as lookup:
            await require_stepup(
                authorization="Bearer abc",
                access_token=None,
                current_user=_user(),
                db=MagicMock(),
            )
        lookup.assert_awaited_once_with("abc")

    def test_the_default_window_is_ten_minutes(self):
        assert type(settings).model_fields["STEPUP_WINDOW_MINUTES"].default == 10

    def test_the_default_grace_is_fourteen_days(self):
        assert type(settings).model_fields["MFA_GRACE_DAYS"].default == 14


def _request():
    return SimpleNamespace(
        headers={"authorization": "Bearer tok"},
        client=SimpleNamespace(host="203.0.113.9"),
        state=SimpleNamespace(),
    )


@pytest.mark.unit
class TestStepUpEndpoint:
    async def _post(self, user, data, session=None, has_passkey=False):
        from app.api.v1.endpoints import auth as auth_endpoints
        from app.schemas.auth import StepUpRequest
        from app.services import passkey_service

        session = session or _session()
        db = MagicMock()
        db.commit = AsyncMock()
        with (
            patch.object(
                AuthService, "get_session_for_token", AsyncMock(return_value=session)
            ),
            patch.object(auth_endpoints, "log_audit_event", AsyncMock()) as audit,
            patch.object(
                passkey_service, "has_passkey", AsyncMock(return_value=has_passkey)
            ),
            patch.object(
                passkey_service,
                "relying_party",
                return_value=passkey_service.RelyingParty(
                    rp_id="logbook.example.org",
                    origin="https://logbook.example.org",
                ),
            ),
        ):
            try:
                body = await auth_endpoints.step_up(
                    StepUpRequest(**data), _request(), user, None, db
                )
            except Exception as exc:  # noqa: BLE001 - returned for assertions
                return exc, session, audit
        return body, session, audit

    async def test_a_valid_code_stamps_only_this_session(self):
        from app.api.v1.endpoints import auth as auth_endpoints

        user = _user()
        user.mfa_enabled = True
        with patch.object(
            auth_endpoints, "_verify_and_consume_totp", AsyncMock(return_value=True)
        ):
            body, session, audit = await self._post(user, {"code": "123456"})

        assert body["verified"] is True
        assert session.stepup_verified_at is not None
        assert audit.await_args.kwargs["event_type"] == "stepup_verified"

    async def test_a_wrong_code_does_not_stamp_and_is_audited(self):
        from app.api.v1.endpoints import auth as auth_endpoints

        user = _user()
        user.mfa_enabled = True
        with patch.object(
            auth_endpoints, "_verify_and_consume_totp", AsyncMock(return_value=False)
        ):
            result, session, audit = await self._post(user, {"code": "000000"})

        assert isinstance(result, HTTPException)
        assert session.stepup_verified_at is None
        assert audit.await_args.kwargs["event_type"] == "stepup_failed"

    async def test_a_member_without_mfa_proves_the_password(self):
        from app.api.v1.endpoints import auth as auth_endpoints

        user = _user()
        user.password_hash = "hash"
        with patch.object(auth_endpoints, "verify_password", return_value=(True, None)):
            body, session, _ = await self._post(user, {"password": "correct"})

        assert body["verified"] is True
        assert session.stepup_verified_at is not None

    async def test_a_wrong_password_is_refused(self):
        from app.api.v1.endpoints import auth as auth_endpoints

        user = _user()
        user.password_hash = "hash"
        with patch.object(
            auth_endpoints, "verify_password", return_value=(False, None)
        ):
            result, session, _ = await self._post(user, {"password": "nope"})

        assert isinstance(result, HTTPException)
        assert session.stepup_verified_at is None

    async def test_a_code_alone_does_not_satisfy_a_password_account(self):
        user = _user()
        user.password_hash = "hash"
        result, session, _ = await self._post(user, {"code": "123456"})
        assert isinstance(result, HTTPException)
        assert session.stepup_verified_at is None

    async def test_an_sso_only_account_without_mfa_is_told_to_enroll(self):
        user = _user()
        user.password_hash = None
        result, session, _ = await self._post(user, {"password": "x"})
        assert isinstance(result, HTTPException)
        assert result.status_code == 400
        assert "two-factor" in result.detail
        assert session.stepup_verified_at is None

    async def test_someone_elses_session_is_refused(self):
        user = _user()
        user.password_hash = "hash"
        other = _session()
        other.user_id = "someone-else"
        result, _, _ = await self._post(user, {"password": "x"}, session=other)
        assert isinstance(result, HTTPException)
        assert result.status_code == 400


ENDPOINTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "app",
    "api",
    "v1",
    "endpoints",
)

#: Every handler that must re-verify the caller first, grouped as the policy
#: describes them. Adding a handler here without the dependency, or the
#: dependency without listing it, fails the wiring test below.
STEPUP_HANDLERS = {
    # Exports
    ("security_monitoring.py", "export_audit_logs"),
    ("error_logs.py", "export_errors"),
    # Security and policy changes
    ("auth.py", "set_mfa_policy"),
    ("organizations.py", "update_auth_settings"),
    ("organizations.py", "update_file_storage_settings"),
    ("security_monitoring.py", "rehash_audit_chain"),
    ("roles.py", "create_role"),
    ("roles.py", "update_role"),
    ("roles.py", "delete_role"),
    ("roles.py", "clone_role"),
    ("users.py", "assign_user_roles"),
    ("users.py", "add_role_to_user"),
    ("users.py", "remove_role_from_user"),
    ("ip_security.py", "approve_exception"),
    ("ip_security.py", "revoke_exception"),
    ("ip_security.py", "add_blocked_country"),
    ("ip_security.py", "remove_blocked_country"),
    ("integrations.py", "connect_integration"),
    ("integrations.py", "disconnect_integration"),
    ("integrations.py", "update_integration"),
    # Account takeover paths
    ("users.py", "admin_reset_password"),
    ("users.py", "admin_reset_mfa"),
    ("users.py", "admin_remove_passkey"),
    # Destructive member actions
    ("users.py", "delete_user"),
    ("users.py", "anonymize_member"),
    # Signatures (owner decision 2026-11-02): an evaluation's approver or
    # member re-verifies before their typed name is recorded as a signature.
    ("evaluations.py", "sign_evaluation"),
}


def _handlers_with_stepup():
    found = set()
    for name in sorted(os.listdir(ENDPOINTS_DIR)):
        if not name.endswith(".py"):
            continue
        with open(os.path.join(ENDPOINTS_DIR, name)) as handle:
            tree = ast.parse(handle.read())
        for node in ast.walk(tree):
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            defaults = node.args.defaults + [
                d for d in node.args.kw_defaults if d is not None
            ]
            for default in defaults:
                if "require_stepup" in {
                    n.id for n in ast.walk(default) if isinstance(n, ast.Name)
                }:
                    found.add((name, node.name))
    return found


@pytest.mark.unit
def test_step_up_is_on_exactly_the_documented_handlers():
    assert _handlers_with_stepup() == STEPUP_HANDLERS


@pytest.mark.unit
def test_step_up_always_follows_the_permission_check():
    """Dependencies resolve in signature order, so the permission parameter
    must come first: a caller lacking it is told so, not asked to re-verify."""
    for name, func in STEPUP_HANDLERS:
        with open(os.path.join(ENDPOINTS_DIR, name)) as handle:
            tree = ast.parse(handle.read())
        node = next(
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == func
        )
        assert node.args.defaults, (name, func)
        last = node.args.defaults[-1]
        names = {n.id for n in ast.walk(last) if isinstance(n, ast.Name)}
        assert "require_stepup" in names, (name, func)


@pytest.mark.unit
def test_dependencies_module_exposes_the_gate():
    assert dependencies.require_stepup is require_stepup


@pytest.mark.unit
class TestStepUpOverHttp:
    """The dependency as FastAPI runs it, on a route shaped like the real ones."""

    def _client(self, user):
        from fastapi import Depends, FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user, require_permission
        from app.core.database import get_db

        app = FastAPI()

        @app.post("/sensitive")
        async def sensitive(
            current_user=Depends(require_permission("settings.manage")),
            _stepup=Depends(require_stepup),
        ):
            return {"ok": True}

        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: MagicMock()
        return AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            cookies={"access_token": "t"},
        )

    async def test_refused_with_the_code_until_the_session_has_stepped_up(self):
        user = _user({"settings.manage"})
        async with self._client(user) as client:
            with patch.object(
                AuthService,
                "get_session_for_token",
                AsyncMock(return_value=_session(None)),
            ):
                refused = await client.post("/sensitive")
            with patch.object(
                AuthService,
                "get_session_for_token",
                AsyncMock(return_value=_session(_now())),
            ):
                allowed = await client.post("/sensitive")

        assert refused.status_code == 403
        assert refused.json()["detail"] == "Please confirm your identity to continue."
        assert refused.headers["x-stepup-required"] == "true"
        assert allowed.status_code == 200

    async def test_a_caller_without_the_permission_is_not_asked_to_step_up(self):
        user = _user({"events.view"})
        async with self._client(user) as client:
            with patch.object(
                AuthService,
                "get_session_for_token",
                AsyncMock(return_value=_session(None)),
            ):
                response = await client.post("/sensitive")

        assert response.status_code == 403
        assert response.json()["detail"] == "Insufficient permissions"
        assert "x-stepup-required" not in response.headers


@pytest.mark.unit
class TestGenericSettingsStepUp:
    """USR-13: the generic ``PATCH /organizations/settings`` reaches the same
    write as the dedicated, ``require_stepup``-gated ``/settings/auth`` and
    ``/settings/file-storage`` routes whenever its body carries an ``auth`` or
    ``file_storage`` section, so it must demand the same fresh re-verification
    -- but only then, since most saves through this route (modules, forms,
    membership ID format, ...) are low-stakes and should not all ask for one.
    """

    async def _call(self, settings_update, verified_at):
        from app.api.v1.endpoints import organizations as endpoint
        from app.schemas.organization import OrganizationSettings

        org_service = MagicMock()
        org_service.update_organization_settings = AsyncMock(
            return_value=OrganizationSettings()
        )
        user = _user({"settings.manage"})
        user.organization_id = "org-1"
        with (
            patch.object(endpoint, "OrganizationService", return_value=org_service),
            patch.object(endpoint, "log_audit_event", AsyncMock()),
            patch.object(
                AuthService,
                "get_session_for_token",
                AsyncMock(return_value=_session(verified_at)),
            ),
        ):
            await endpoint.update_organization_settings(
                settings_update=settings_update,
                request=SimpleNamespace(headers={}),
                db=AsyncMock(),
                current_user=user,
                access_token="t",
            )
        return org_service.update_organization_settings

    async def test_changing_auth_without_a_fresh_step_up_is_refused(self):
        from app.schemas.organization import AuthSettings, OrganizationSettingsUpdate

        with pytest.raises(HTTPException) as exc:
            await self._call(
                OrganizationSettingsUpdate(auth=AuthSettings(provider="google")),
                verified_at=None,
            )
        assert exc.value.status_code == 403

    async def test_changing_file_storage_without_a_fresh_step_up_is_refused(self):
        from app.schemas.organization import (
            FileStorageSettings,
            OrganizationSettingsUpdate,
        )

        with pytest.raises(HTTPException) as exc:
            await self._call(
                OrganizationSettingsUpdate(
                    file_storage=FileStorageSettings(platform="s3")
                ),
                verified_at=None,
            )
        assert exc.value.status_code == 403

    async def test_changing_auth_with_a_fresh_step_up_is_allowed(self):
        from app.schemas.organization import AuthSettings, OrganizationSettingsUpdate

        update = await self._call(
            OrganizationSettingsUpdate(auth=AuthSettings(provider="google")),
            verified_at=_now(),
        )
        update.assert_awaited_once()

    async def test_a_save_that_touches_neither_section_is_never_asked_to_step_up(
        self,
    ):
        from app.schemas.organization import FormsSettings, OrganizationSettingsUpdate

        update = await self._call(
            OrganizationSettingsUpdate(forms=FormsSettings(embed_allowed_origins=[])),
            verified_at=None,
        )
        update.assert_awaited_once()
