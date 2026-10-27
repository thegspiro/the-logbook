"""
Passkeys (WebAuthn) as a second factor.

A software authenticator below produces real registration and assertion
responses — a P-256 key, CBOR authenticator data, an ECDSA signature — so the
verification path under test is the real ``webauthn`` library, not a mock of
it. The unit half covers the relying-party rules; the integration half
drives the service and the endpoints against the database.
"""

import base64
import hashlib
import json
import os
import struct
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from sqlalchemy import select, update
from starlette.requests import Request

from app.core.config import settings
from app.core.security import create_mfa_pending_token
from app.models.passkey import UserPasskey, WebAuthnChallenge
from app.models.user import Organization, User
from app.schemas.auth import (
    MFAChallengeRequest,
    MFALogin,
    PasskeyRegisterRequest,
    StepUpRequest,
)
from app.services import mfa_service, passkey_service

SITE = "https://logbook.example.org"
RP_ID = "logbook.example.org"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class SoftAuthenticator:
    """A phone in miniature: one P-256 key, the flags a real one would set."""

    def __init__(self, rp_id: str = RP_ID, origin: str = SITE):
        self.rp_id = rp_id
        self.origin = origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(16)
        self.sign_count = 0

    def _flags(self, *, uv: bool, attested: bool) -> int:
        flags = 0x01  # user present
        if uv:
            flags |= 0x04
        if attested:
            flags |= 0x40
        return flags

    def _cose_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def _client_data(self, kind: str, challenge: str, origin: str | None) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": challenge,
                "origin": origin or self.origin,
                "crossOrigin": False,
            }
        ).encode()

    def create(self, options: dict, *, uv: bool = True, origin: str | None = None):
        client_data = self._client_data("webauthn.create", options["challenge"], origin)
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([self._flags(uv=uv, attested=True)])
            + struct.pack(">I", self.sign_count)
            + b"\x00" * 16
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + self._cose_key()
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cid = _b64(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client_data),
                "attestationObject": _b64(attestation),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
        }

    def get(self, options: dict, *, uv: bool = True, origin: str | None = None):
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([self._flags(uv=uv, attested=False)])
            + struct.pack(">I", self.sign_count)
        )
        signature = self.key.sign(
            auth_data + hashlib.sha256(client_data).digest(),
            ec.ECDSA(hashes.SHA256()),
        )
        cid = _b64(self.credential_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client_data),
                "authenticatorData": _b64(auth_data),
                "signature": _b64(signature),
            },
            "clientExtensionResults": {},
        }


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [(b"user-agent", b"pytest")],
            "client": ("203.0.113.7", 1234),
        }
    )


@pytest.fixture
def site():
    with patch.object(settings, "FRONTEND_URL", SITE):
        yield passkey_service.relying_party()


@pytest.fixture
def quiet():
    """Audit rows and emails are not what these tests are about."""
    from app.api.v1.endpoints import auth as auth_endpoints
    from app.api.v1.endpoints import users as users_endpoints

    with (
        patch.object(auth_endpoints, "log_audit_event", AsyncMock()),
        patch.object(auth_endpoints, "notify_security_event", AsyncMock()) as notify,
        patch.object(users_endpoints, "log_audit_event", AsyncMock()),
        patch.object(users_endpoints, "notify_security_event", AsyncMock()),
    ):
        yield notify


# ---------------------------------------------------------------------------
# Unit: which sites can use passkeys at all
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestRelyingParty:
    def test_an_https_domain_is_the_relying_party(self):
        rp = passkey_service.relying_party("https://Logbook.Example.org/app")
        assert rp == passkey_service.RelyingParty(
            rp_id="logbook.example.org", origin="https://logbook.example.org"
        )

    def test_a_port_is_part_of_the_origin_but_not_the_id(self):
        rp = passkey_service.relying_party("https://logbook.example.org:8443")
        assert rp is not None
        assert rp.rp_id == "logbook.example.org"
        assert rp.origin == "https://logbook.example.org:8443"

    @pytest.mark.parametrize(
        "url",
        [
            "http://logbook.example.org",
            "https://192.168.1.50",
            "http://192.168.1.50:3000",
            "https://[::1]",
            "",
            "not a url",
        ],
    )
    def test_no_passkeys_without_https_on_a_hostname(self, url):
        assert passkey_service.relying_party(url) is None

    def test_localhost_works_over_http_for_development(self):
        rp = passkey_service.relying_party("http://localhost:3000")
        assert rp is not None
        assert rp.rp_id == "localhost"
        assert rp.origin == "http://localhost:3000"


@pytest.mark.unit
class TestOrganizationSwitch:
    def test_absent_means_allowed(self):
        assert passkey_service.passkeys_allowed({}) is True
        assert passkey_service.passkeys_allowed(None) is True
        assert passkey_service.passkeys_allowed({"security": {}}) is True

    def test_only_an_explicit_false_turns_it_off(self):
        assert (
            passkey_service.passkeys_allowed({"security": {"passkeys_enabled": False}})
            is False
        )
        assert (
            passkey_service.passkeys_allowed({"security": {"passkeys_enabled": True}})
            is True
        )


# ---------------------------------------------------------------------------
# Integration: service and endpoints against the database
# ---------------------------------------------------------------------------


async def _member(db, *, mfa_enabled: bool = False) -> User:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Passkey Test Department",
        slug=f"passkey-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    user_id = str(uuid.uuid4())
    user = User(
        id=user_id,
        organization_id=org.id,
        username=f"pk-{user_id[:8]}",
        email=f"pk-{user_id[:8]}@example.org",
        first_name="Pat",
        last_name="Key",
        password_hash="hashed",
        status="active",
        mfa_enabled=mfa_enabled,
    )
    db.add(user)
    await db.flush()
    return user


async def _enroll(db, user, rp, name="Phone") -> tuple[SoftAuthenticator, UserPasskey]:
    device = SoftAuthenticator(rp.rp_id, rp.origin)
    options = await passkey_service.registration_options(db, user, rp)
    passkey = await passkey_service.verify_registration(
        db, user, rp, device.create(options), name
    )
    return device, passkey


@pytest.mark.integration
class TestPasskeyService:
    async def test_register_then_sign_in(self, db_session, site):
        user = await _member(db_session)
        device, passkey = await _enroll(db_session, user, site)

        assert passkey.rp_id == RP_ID
        assert passkey.transports == ["internal", "hybrid"]
        assert await passkey_service.has_second_factor(db_session, user) is True

        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        assert options["userVerification"] == "required"
        device.sign_count = 1
        used = await passkey_service.verify_authentication(
            db_session,
            user,
            site,
            device.get(options),
            passkey_service.PURPOSE_LOGIN,
        )
        assert used is not None
        assert used.id == passkey.id
        assert used.sign_count == 1
        assert used.last_used_at is not None

    async def test_a_response_cannot_be_replayed(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        answer = device.get(options)
        first = await passkey_service.verify_authentication(
            db_session, user, site, answer, passkey_service.PURPOSE_LOGIN
        )
        again = await passkey_service.verify_authentication(
            db_session, user, site, answer, passkey_service.PURPOSE_LOGIN
        )
        assert first is not None
        assert again is None

    async def test_a_login_challenge_does_not_answer_a_step_up(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        assert (
            await passkey_service.verify_authentication(
                db_session,
                user,
                site,
                device.get(options),
                passkey_service.PURPOSE_STEPUP,
            )
            is None
        )

    async def test_a_challenge_with_its_case_changed_is_refused(self, db_session, site):
        """The column collation ignores case; the challenge does not."""
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        flipped = dict(options, challenge=options["challenge"].swapcase())
        assert (
            await passkey_service.verify_authentication(
                db_session,
                user,
                site,
                device.get(flipped),
                passkey_service.PURPOSE_LOGIN,
            )
            is None
        )

    async def test_an_expired_challenge_is_refused(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        await db_session.execute(
            update(WebAuthnChallenge)
            .where(WebAuthnChallenge.user_id == user.id)
            .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        assert (
            await passkey_service.verify_authentication(
                db_session,
                user,
                site,
                device.get(options),
                passkey_service.PURPOSE_LOGIN,
            )
            is None
        )

    async def test_a_look_alike_site_is_refused(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        phished = device.get(options, origin="https://logbook-example.org")
        assert (
            await passkey_service.verify_authentication(
                db_session, user, site, phished, passkey_service.PURPOSE_LOGIN
            )
            is None
        )

    async def test_a_tap_without_biometric_or_pin_is_not_enough(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.authentication_options(
            db_session, user, site, passkey_service.PURPOSE_LOGIN
        )
        assert (
            await passkey_service.verify_authentication(
                db_session,
                user,
                site,
                device.get(options, uv=False),
                passkey_service.PURPOSE_LOGIN,
            )
            is None
        )

    async def test_registration_without_user_verification_is_refused(
        self, db_session, site
    ):
        user = await _member(db_session)
        device = SoftAuthenticator()
        options = await passkey_service.registration_options(db_session, user, site)
        with pytest.raises(passkey_service.PasskeyError):
            await passkey_service.verify_registration(
                db_session, user, site, device.create(options, uv=False), "Phone"
            )

    async def test_another_members_passkey_does_not_sign_this_one_in(
        self, db_session, site
    ):
        owner = await _member(db_session)
        other = await _member(db_session)
        owner_device, _ = await _enroll(db_session, owner, site)
        await _enroll(db_session, other, site)
        options = await passkey_service.authentication_options(
            db_session, other, site, passkey_service.PURPOSE_LOGIN
        )
        assert (
            await passkey_service.verify_authentication(
                db_session,
                other,
                site,
                owner_device.get(options),
                passkey_service.PURPOSE_LOGIN,
            )
            is None
        )

    async def test_three_is_the_limit(self, db_session, site):
        user = await _member(db_session)
        for name in ("Phone", "Laptop", "Spare"):
            await _enroll(db_session, user, site, name)
        with pytest.raises(passkey_service.PasskeyError):
            await passkey_service.registration_options(db_session, user, site)

    async def test_the_same_device_cannot_register_twice(self, db_session, site):
        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        options = await passkey_service.registration_options(db_session, user, site)
        assert [c["id"] for c in options["excludeCredentials"]] == [
            _b64(device.credential_id)
        ]
        with pytest.raises(passkey_service.PasskeyError):
            await passkey_service.verify_registration(
                db_session, user, site, device.create(options), "Phone again"
            )

    async def test_a_passkey_for_another_domain_is_not_a_second_factor(
        self, db_session, site
    ):
        user = await _member(db_session)
        await _enroll(db_session, user, site)
        moved = passkey_service.relying_party("https://new.example.org")
        assert await passkey_service.has_passkey(db_session, user.id, moved) is False
        assert (
            await passkey_service.authentication_options(
                db_session, user, moved, passkey_service.PURPOSE_LOGIN
            )
            is None
        )

    async def test_no_passkeys_count_on_a_site_that_cannot_use_them(
        self, db_session, site
    ):
        user = await _member(db_session)
        await _enroll(db_session, user, site)
        with patch.object(settings, "FRONTEND_URL", "http://192.168.1.50"):
            assert await passkey_service.has_second_factor(db_session, user) is False

    async def test_open_challenges_are_capped(self, db_session, site):
        user = await _member(db_session)
        await _enroll(db_session, user, site)
        for _ in range(12):
            await passkey_service.authentication_options(
                db_session, user, site, passkey_service.PURPOSE_LOGIN
            )
        rows = await db_session.execute(
            select(WebAuthnChallenge).where(WebAuthnChallenge.user_id == user.id)
        )
        assert len(rows.scalars().all()) == 5


@pytest.mark.integration
class TestPasskeySignIn:
    async def test_password_sign_in_asks_for_the_passkey(self, db_session, site):
        from app.api.v1.endpoints.auth import _finish_oauth_login, mfa_challenge

        user = await _member(db_session)
        await _enroll(db_session, user, site)

        with patch(
            "app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()
        ) as audit:
            response = await _finish_oauth_login(db_session, user, _request(), "google")
        assert "mfa_token=" in response.headers["location"]
        assert audit.await_args.kwargs["event_type"] == "oauth_mfa_challenge"

        offered = await mfa_challenge(
            MFAChallengeRequest(temp_token=create_mfa_pending_token(user.id)),
            _request(),
            db_session,
        )
        assert offered.totp is False
        assert offered.passkey_options is not None

    async def test_the_passkey_completes_the_sign_in(self, db_session, site):
        from app.api.v1.endpoints.auth import mfa_challenge, mfa_login

        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        token = create_mfa_pending_token(user.id)
        offered = await mfa_challenge(
            MFAChallengeRequest(temp_token=token), _request(), db_session
        )
        with patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()):
            response = await mfa_login(
                MFALogin(
                    temp_token=token,
                    passkey_credential=device.get(offered.passkey_options),
                ),
                _request(),
                db_session,
            )
        assert response.status_code == 200
        cookies = response.headers.getlist("set-cookie")
        assert any(c.startswith("access_token=") for c in cookies)

    async def test_a_bad_passkey_counts_toward_the_lockout(self, db_session, site):
        from app.api.v1.endpoints.auth import mfa_challenge, mfa_login

        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        token = create_mfa_pending_token(user.id)
        offered = await mfa_challenge(
            MFAChallengeRequest(temp_token=token), _request(), db_session
        )
        with patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await mfa_login(
                    MFALogin(
                        temp_token=token,
                        passkey_credential=device.get(
                            offered.passkey_options, uv=False
                        ),
                    ),
                    _request(),
                    db_session,
                )
        assert exc.value.status_code == 401
        await db_session.refresh(user)
        assert user.failed_login_attempts == 1

    async def test_no_challenge_for_a_member_without_a_second_factor(
        self, db_session, site
    ):
        from app.api.v1.endpoints.auth import mfa_challenge

        user = await _member(db_session)
        with pytest.raises(HTTPException) as exc:
            await mfa_challenge(
                MFAChallengeRequest(temp_token=create_mfa_pending_token(user.id)),
                _request(),
                db_session,
            )
        assert exc.value.status_code == 401


@pytest.mark.integration
class TestPasskeyEnrollmentEndpoints:
    async def _register(self, db, user, rp, name="Phone"):
        from app.api.v1.endpoints.auth import (
            passkey_register,
            passkey_register_options,
        )

        device = SoftAuthenticator(rp.rp_id, rp.origin)
        options = await passkey_register_options(_request(), user, None, db)
        result = await passkey_register(
            PasskeyRegisterRequest(name=name, credential=device.create(options)),
            _request(),
            MagicMock(),
            user,
            None,
            db,
        )
        return device, result

    async def test_the_first_passkey_comes_with_recovery_codes(
        self, db_session, site, quiet
    ):
        user = await _member(db_session)
        _, result = await self._register(db_session, user, site)

        assert len(result.recovery_codes) == mfa_service.RECOVERY_CODE_COUNT
        assert len(user.mfa_backup_codes) == mfa_service.RECOVERY_CODE_COUNT
        # The stored set is hashes only; the plaintext is in the response once.
        assert result.recovery_codes[0] not in user.mfa_backup_codes
        assert quiet.await_args.kwargs["subject"] == (
            "A passkey was added to your account"
        )

    async def test_a_second_passkey_keeps_the_existing_codes(
        self, db_session, site, quiet
    ):
        user = await _member(db_session)
        _, first = await self._register(db_session, user, site)
        stored = list(user.mfa_backup_codes)
        _, second = await self._register(db_session, user, site, "Laptop")
        assert second.recovery_codes == []
        assert user.mfa_backup_codes == stored

    async def test_an_authenticator_user_keeps_their_codes(
        self, db_session, site, quiet
    ):
        user = await _member(db_session, mfa_enabled=True)
        user.mfa_backup_codes = [mfa_service.hash_recovery_code("aaaaa-bbbbb")]
        _, result = await self._register(db_session, user, site)
        assert result.recovery_codes == []
        assert user.mfa_backup_codes == [mfa_service.hash_recovery_code("aaaaa-bbbbb")]

    async def test_a_recovery_code_signs_a_passkey_member_in(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import mfa_login

        user = await _member(db_session)
        _, result = await self._register(db_session, user, site)
        with patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()):
            response = await mfa_login(
                MFALogin(
                    temp_token=create_mfa_pending_token(user.id),
                    recovery_code=result.recovery_codes[0],
                ),
                _request(),
                db_session,
            )
        assert response.status_code == 200

    async def test_the_organization_can_turn_new_passkeys_off(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_register_options

        user = await _member(db_session)
        org = await db_session.get(Organization, user.organization_id)
        org.settings = {"security": {"passkeys_enabled": False}}
        await db_session.flush()
        with pytest.raises(HTTPException) as exc:
            await passkey_register_options(_request(), user, None, db_session)
        assert exc.value.status_code == 403

    async def test_no_registration_on_a_site_that_cannot_use_passkeys(
        self, db_session, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_register_options

        user = await _member(db_session)
        with patch.object(settings, "FRONTEND_URL", "http://10.0.0.5:3000"):
            with pytest.raises(HTTPException) as exc:
                await passkey_register_options(_request(), user, None, db_session)
        assert exc.value.status_code == 400

    async def test_removing_the_last_passkey_drops_the_recovery_codes(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import list_my_passkeys, passkey_delete

        user = await _member(db_session)
        await self._register(db_session, user, site)
        listed = await list_my_passkeys(user, db_session)
        assert listed.available is True
        assert listed.allowed is True
        assert listed.max_passkeys == 3
        passkey_id = listed.passkeys[0].id

        await passkey_delete(
            uuid.UUID(passkey_id), _request(), MagicMock(), user, None, db_session
        )
        assert await passkey_service.list_passkeys(db_session, user.id) == []
        assert user.mfa_backup_codes is None

    async def test_a_member_cannot_remove_someone_elses_passkey(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_delete

        owner = await _member(db_session)
        other = await _member(db_session)
        _, passkey = await _enroll(db_session, owner, site)
        with pytest.raises(HTTPException) as exc:
            await passkey_delete(
                uuid.UUID(passkey.id), _request(), MagicMock(), other, None, db_session
            )
        assert exc.value.status_code == 404

    async def test_passkey_recovery_codes_replace_the_old_set(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_regenerate_recovery_codes

        user = await _member(db_session)
        _, first = await self._register(db_session, user, site)
        result = await passkey_regenerate_recovery_codes(
            _request(), MagicMock(), user, None, db_session
        )
        assert set(result["recovery_codes"]).isdisjoint(first.recovery_codes)
        assert mfa_service.hash_recovery_code(first.recovery_codes[0]) not in (
            user.mfa_backup_codes
        )


@pytest.mark.integration
@pytest.mark.real_stepup
class TestEnrolledMembersMustStepUp:
    async def test_adding_a_second_passkey_needs_a_fresh_step_up(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_register_options

        user = await _member(db_session)
        await _enroll(db_session, user, site)
        with pytest.raises(HTTPException) as exc:
            await passkey_register_options(_request(), user, None, db_session)
        assert exc.value.status_code == 403

    async def test_the_first_passkey_needs_no_step_up(self, db_session, site, quiet):
        from app.api.v1.endpoints.auth import passkey_register_options

        user = await _member(db_session)
        options = await passkey_register_options(_request(), user, None, db_session)
        assert options["rp"]["id"] == RP_ID

    async def test_removing_a_passkey_needs_a_fresh_step_up(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.auth import passkey_delete

        user = await _member(db_session)
        _, passkey = await _enroll(db_session, user, site)
        with pytest.raises(HTTPException) as exc:
            await passkey_delete(
                uuid.UUID(passkey.id), _request(), MagicMock(), user, None, db_session
            )
        assert exc.value.status_code == 403
        assert await passkey_service.list_passkeys(db_session, user.id) != []


@pytest.mark.integration
class TestPasskeyStepUp:
    async def test_a_passkey_opens_the_step_up_window(self, db_session, site):
        from app.api.v1.endpoints.auth import step_up, step_up_passkey_options
        from app.services.auth_service import AuthService

        user = await _member(db_session)
        device, _ = await _enroll(db_session, user, site)
        session = MagicMock(user_id=user.id, stepup_verified_at=None)
        options = await step_up_passkey_options(user, db_session)
        with (
            patch.object(
                AuthService, "get_session_for_token", AsyncMock(return_value=session)
            ),
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()) as a,
        ):
            body = await step_up(
                StepUpRequest(passkey_credential=device.get(options)),
                _request(),
                user,
                "token",
                db_session,
            )
        assert body["verified"] is True
        assert session.stepup_verified_at is not None
        assert a.await_args.kwargs["event_data"] == {"method": "passkey"}

    async def test_a_password_does_not_stand_in_for_the_passkey(self, db_session, site):
        from app.api.v1.endpoints.auth import step_up
        from app.services.auth_service import AuthService

        user = await _member(db_session)
        await _enroll(db_session, user, site)
        session = MagicMock(user_id=user.id, stepup_verified_at=None)
        with (
            patch.object(
                AuthService, "get_session_for_token", AsyncMock(return_value=session)
            ),
            patch("app.api.v1.endpoints.auth.log_audit_event", new=AsyncMock()),
            patch(
                "app.api.v1.endpoints.auth.verify_password", return_value=(True, None)
            ),
        ):
            with pytest.raises(HTTPException):
                await step_up(
                    StepUpRequest(password="correct"),
                    _request(),
                    user,
                    "token",
                    db_session,
                )
        assert session.stepup_verified_at is None


@pytest.mark.integration
class TestAdministratorControls:
    async def _admin(self, db, member: User) -> User:
        admin_id = str(uuid.uuid4())
        admin = User(
            id=admin_id,
            organization_id=member.organization_id,
            username=f"admin-{admin_id[:8]}",
            email=f"admin-{admin_id[:8]}@example.org",
            first_name="Ada",
            last_name="Min",
            password_hash="hashed",
            status="active",
        )
        db.add(admin)
        await db.flush()
        return admin

    async def test_an_admin_removes_a_lost_phones_passkey(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.users import (
            admin_list_passkeys,
            admin_remove_passkey,
        )

        member = await _member(db_session)
        admin = await self._admin(db_session, member)
        _, phone = await _enroll(db_session, member, site, "Lost phone")
        _, laptop = await _enroll(db_session, member, site, "Laptop")
        member.mfa_backup_codes = [mfa_service.hash_recovery_code("aaaaa-bbbbb")]

        listed = await admin_list_passkeys(uuid.UUID(member.id), db_session, admin)
        assert sorted(p.name for p in listed) == ["Laptop", "Lost phone"]

        with patch(
            "app.api.v1.endpoints.users._enforce_account_reset_ceiling",
            new=AsyncMock(),
        ):
            await admin_remove_passkey(
                uuid.UUID(member.id),
                uuid.UUID(phone.id),
                MagicMock(),
                db_session,
                admin,
                admin,
            )
        remaining = await passkey_service.list_passkeys(db_session, member.id)
        assert [p.id for p in remaining] == [laptop.id]
        # The laptop still needs its backup.
        assert member.mfa_backup_codes is not None

    async def test_an_admin_cannot_reach_another_departments_member(
        self, db_session, site, quiet
    ):
        from app.api.v1.endpoints.users import admin_list_passkeys

        member = await _member(db_session)
        outsider = await _member(db_session)
        await _enroll(db_session, member, site)
        with pytest.raises(HTTPException) as exc:
            await admin_list_passkeys(uuid.UUID(member.id), db_session, outsider)
        assert exc.value.status_code == 404

    async def test_resetting_mfa_removes_every_passkey(self, db_session, site, quiet):
        from app.api.v1.endpoints.users import admin_reset_mfa

        member = await _member(db_session)
        admin = await self._admin(db_session, member)
        await _enroll(db_session, member, site)
        with patch(
            "app.api.v1.endpoints.users._enforce_account_reset_ceiling",
            new=AsyncMock(),
        ):
            await admin_reset_mfa(
                uuid.UUID(member.id), MagicMock(), db_session, admin, admin
            )
        assert await passkey_service.list_passkeys(db_session, member.id) == []
        assert await passkey_service.has_second_factor(db_session, member) is False


@pytest.mark.integration
class TestPasskeyCountsAsEnrolled:
    async def _resolve(self, db, user):
        from app.api import dependencies as deps

        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/v1/events",
                "headers": [],
                "client": ("203.0.113.7", 1234),
            }
        )
        with patch.object(
            deps.AuthService, "get_user_from_token", AsyncMock(return_value=user)
        ):
            return await deps.get_current_user(request, None, "token", db)

    async def _require_mfa(self, db, user):
        org = await db.get(Organization, user.organization_id)
        org.settings = {"security": {"mfa_required": True}}
        await db.flush()

    async def test_a_passkey_satisfies_a_required_mfa(self, db_session, site):
        user = await _member(db_session)
        await self._require_mfa(db_session, user)
        await _enroll(db_session, user, site)
        assert (await self._resolve(db_session, user)).id == user.id

    async def test_without_one_the_member_is_sent_to_enroll(self, db_session, site):
        user = await _member(db_session)
        await self._require_mfa(db_session, user)
        with pytest.raises(HTTPException) as exc:
            await self._resolve(db_session, user)
        assert exc.value.status_code == 403
        assert exc.value.headers == {"X-MFA-Enrollment-Required": "true"}


@pytest.mark.integration
class TestMemberListShowsPasskeysToAdmins:
    async def _list(self, db, caller, permissions):
        from app.api.v1.endpoints import users as users_endpoints

        with patch.object(
            users_endpoints, "_collect_user_permissions", return_value=permissions
        ):
            return await users_endpoints.list_users_with_roles(db, caller)

    async def test_admins_see_who_has_a_passkey(self, db_session, site):
        with_key = await _member(db_session)
        await _enroll(db_session, with_key, site)
        rows = await self._list(db_session, with_key, {"members.manage"})
        assert [r.has_passkey for r in rows] == [True]

    async def test_members_without_manage_rights_do_not(self, db_session, site):
        with_key = await _member(db_session)
        await _enroll(db_session, with_key, site)
        rows = await self._list(db_session, with_key, {"users.view"})
        assert [r.has_passkey for r in rows] == [None]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("path", "method", "bucket"),
    [
        ("/mfa/challenge", "POST", "rate_limit_passkey"),
        ("/step-up/passkey-options", "POST", "rate_limit_passkey"),
        ("/passkeys/register-options", "POST", "rate_limit_passkey"),
        ("/passkeys/{passkey_id}", "DELETE", "rate_limit_passkey"),
        ("/passkeys/recovery-codes", "POST", "rate_limit_passkey"),
        # The requests that check a credential share the sign-in budget.
        ("/mfa/login", "POST", "rate_limit_login"),
        ("/step-up", "POST", "rate_limit_login"),
        ("/passkeys/register", "POST", "rate_limit_login"),
    ],
)
def test_each_passkey_route_spends_the_right_rate_limit(path, method, bucket):
    """Issuing a challenge must not spend the 5-per-minute sign-in budget: a
    cancelled prompt fetches a fresh one, and a station's members share one
    address."""
    from app.api.v1.endpoints.auth import router

    route = next(
        r
        for r in router.routes
        if getattr(r, "path", None) == path and method in getattr(r, "methods", ())
    )
    limiters = {
        d.call.__qualname__.split(".")[0]
        for d in route.dependant.dependencies
        if d.call.__qualname__.startswith("rate_limit_")
    }
    assert limiters == {bucket}
