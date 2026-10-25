"""
Passkeys (WebAuthn) as a second factor.

A passkey takes the place of the authenticator-app code: the member still
proves who they are with a password or an SSO sign-in first, then confirms
on their phone or laptop with Face ID, a fingerprint or the device PIN. It
never replaces the password.

Three rules shape everything here:

* **The relying party is the site's own address.** A passkey belongs to one
  domain, and the browser refuses to use it anywhere else. That domain is
  ``FRONTEND_URL``'s host. Browsers only offer passkeys to a secure context
  on a real hostname, so an installation reached over plain HTTP or at an IP
  address gets no passkey option at all (``relying_party`` returns ``None``)
  and keeps the authenticator code.
* **Every challenge is single-use.** It is stored when issued and deleted by
  the response that answers it, so an assertion captured in transit cannot be
  presented twice. A stale challenge is never accepted.
* **User verification is required.** A tap alone is not enough: the device
  must have checked a biometric or PIN, which is what makes the passkey a
  factor of its own rather than mere possession of an unlocked phone.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Optional
from urllib.parse import urlsplit

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import (
    base64url_to_bytes,
    bytes_to_base64url,
    generate_challenge,
    options_to_json_dict,
)
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import settings
from app.models.passkey import UserPasskey, WebAuthnChallenge
from app.models.user import User
from app.utils.sql_results import rows_affected

#: Agreed with the department: a phone, a laptop and one spare.
MAX_PASSKEYS_PER_MEMBER = 3

#: How long the browser has to answer a challenge. Long enough to find the
#: phone and scan a QR code from a station computer.
CHALLENGE_TTL_SECONDS = 300

#: Open challenges kept per member. Each "Use passkey" press issues one, so
#: the cap stops a script from filling the table (Pitfall #9).
_MAX_OPEN_CHALLENGES = 5

PURPOSE_REGISTER = "register"
PURPOSE_LOGIN = "login"
PURPOSE_STEPUP = "stepup"

RP_NAME = "The Logbook"

_TIMEOUT_MS = CHALLENGE_TTL_SECONDS * 1000


class PasskeyError(ValueError):
    """A passkey request the member can correct; the message is safe to show."""


@dataclass(frozen=True)
class RelyingParty:
    rp_id: str
    origin: str


def relying_party(frontend_url: Optional[str] = None) -> Optional[RelyingParty]:
    """The relying party for this installation, or ``None`` if passkeys can't work.

    ``localhost`` is accepted over HTTP because browsers treat it as a secure
    context, which keeps development working; anything else needs HTTPS on a
    hostname, since WebAuthn rejects an IP address as a relying party id.
    """
    url = (settings.FRONTEND_URL if frontend_url is None else frontend_url).strip()
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return None
    if not host:
        return None
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass
    is_localhost = host == "localhost" or host.endswith(".localhost")
    scheme = parts.scheme.lower()
    if scheme != "https" and not (scheme == "http" and is_localhost):
        return None
    origin = f"{scheme}://{host}" + (f":{port}" if port else "")
    return RelyingParty(rp_id=host, origin=origin)


def passkeys_allowed(org_settings: Optional[Mapping[str, Any]]) -> bool:
    """Whether the organization lets members register new passkeys.

    Absent means allowed: the switch exists so a department can opt out, and
    an organization that never touched it gets the feature.
    """
    security = (org_settings or {}).get("security") or {}
    return security.get("passkeys_enabled", True) is not False


def _credential_hash(credential_id: str) -> str:
    return hashlib.sha256(credential_id.encode()).hexdigest()


async def usable_passkey_count(
    db: AsyncSession, user_id: str, rp: Optional[RelyingParty] = None
) -> int:
    """Passkeys the member can use on this site now (see ``has_passkey``)."""
    rp = rp or relying_party()
    if rp is None:
        return 0
    result = await db.execute(
        select(func.count())
        .select_from(UserPasskey)
        .where(UserPasskey.user_id == str(user_id), UserPasskey.rp_id == rp.rp_id)
    )
    return int(result.scalar() or 0)


async def has_passkey(
    db: AsyncSession, user_id: str, rp: Optional[RelyingParty] = None
) -> bool:
    """Whether the member has a passkey that works on this site right now.

    A passkey created for another domain cannot be used here, and passkeys
    cannot be used at all when the site has no relying party. Counting either
    as a second factor would demand a proof the member has no way to give,
    leaving them only their recovery codes.
    """
    rp = rp or relying_party()
    if rp is None:
        return False
    result = await db.execute(
        select(UserPasskey.id)
        .where(UserPasskey.user_id == str(user_id), UserPasskey.rp_id == rp.rp_id)
        .limit(1)
    )
    return result.first() is not None


async def has_second_factor(db: AsyncSession, user: User) -> bool:
    """Whether ``user`` has any second factor: the authenticator app or a passkey.

    ``User.mfa_enabled`` still means the authenticator app specifically, so
    every "must this member pass a second factor?" decision goes through here.
    """
    if user.mfa_enabled:
        return True
    return await has_passkey(db, str(user.id))


async def list_passkeys(db: AsyncSession, user_id: str) -> list[UserPasskey]:
    result = await db.execute(
        select(UserPasskey)
        .where(UserPasskey.user_id == str(user_id))
        .order_by(UserPasskey.created_at, UserPasskey.id)
    )
    return list(result.scalars().all())


async def get_passkey(
    db: AsyncSession, *, passkey_id: str, user_id: str, organization_id: str
) -> Optional[UserPasskey]:
    result = await db.execute(
        select(UserPasskey).where(
            UserPasskey.id == str(passkey_id),
            UserPasskey.user_id == str(user_id),
            UserPasskey.organization_id == str(organization_id),
        )
    )
    return result.scalar_one_or_none()


async def delete_all_passkeys(db: AsyncSession, user_id: str) -> int:
    await db.execute(
        delete(WebAuthnChallenge).where(WebAuthnChallenge.user_id == str(user_id))
    )
    result = await db.execute(
        delete(UserPasskey).where(UserPasskey.user_id == str(user_id))
    )
    return rows_affected(result)


async def _issue_challenge(db: AsyncSession, user_id: str, purpose: str) -> bytes:
    now = datetime.now(timezone.utc)
    await db.execute(
        delete(WebAuthnChallenge).where(
            WebAuthnChallenge.user_id == str(user_id),
            WebAuthnChallenge.expires_at <= now,
        )
    )
    open_ids = (
        (
            await db.execute(
                select(WebAuthnChallenge.id)
                .where(WebAuthnChallenge.user_id == str(user_id))
                .order_by(WebAuthnChallenge.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    stale = list(open_ids[_MAX_OPEN_CHALLENGES - 1 :])
    if stale:
        await db.execute(
            delete(WebAuthnChallenge).where(WebAuthnChallenge.id.in_(stale))
        )

    challenge = generate_challenge()
    db.add(
        WebAuthnChallenge(
            user_id=str(user_id),
            purpose=purpose,
            challenge=bytes_to_base64url(challenge),
            expires_at=now + timedelta(seconds=CHALLENGE_TTL_SECONDS),
        )
    )
    await db.flush()
    return challenge


def _challenge_from_response(credential: Mapping[str, Any]) -> Optional[str]:
    """Read the challenge the browser signed out of its clientDataJSON."""
    try:
        response = credential.get("response") or {}
        client_data = json.loads(base64url_to_bytes(response["clientDataJSON"]))
        challenge = client_data.get("challenge")
    except Exception:
        return None
    return challenge if isinstance(challenge, str) and challenge else None


async def _consume_challenge(
    db: AsyncSession, user_id: str, purpose: str, credential: Mapping[str, Any]
) -> Optional[bytes]:
    """Delete the challenge this response answers; return it if it was live.

    The DELETE is the single-use guarantee: two requests carrying the same
    response both run it, and only one of them can remove the row. The value
    returned is the stored one, compared exactly, because the column's
    collation matches text without regard to case and a challenge is
    case-sensitive base64url.
    """
    challenge = _challenge_from_response(credential)
    if challenge is None:
        return None
    rows = await db.execute(
        select(WebAuthnChallenge).where(
            WebAuthnChallenge.user_id == str(user_id),
            WebAuthnChallenge.purpose == purpose,
            WebAuthnChallenge.challenge == challenge,
            WebAuthnChallenge.expires_at > datetime.now(timezone.utc),
        )
    )
    issued = next(
        (
            row
            for row in rows.scalars().all()
            if hmac.compare_digest(row.challenge.encode(), challenge.encode())
        ),
        None,
    )
    if issued is None:
        return None
    result = await db.execute(
        delete(WebAuthnChallenge).where(WebAuthnChallenge.id == issued.id)
    )
    if rows_affected(result) != 1:
        return None
    try:
        return base64url_to_bytes(issued.challenge)
    except Exception:
        return None


def _descriptor(passkey: UserPasskey) -> PublicKeyCredentialDescriptor:
    transports: list[AuthenticatorTransport] = []
    for value in passkey.transports or []:
        try:
            transports.append(AuthenticatorTransport(value))
        except ValueError:
            continue
    return PublicKeyCredentialDescriptor(
        id=base64url_to_bytes(passkey.credential_id),
        transports=transports or None,
    )


async def registration_options(
    db: AsyncSession, user: User, rp: RelyingParty
) -> dict[str, Any]:
    """Options for ``navigator.credentials.create()``, with a fresh challenge."""
    existing = await list_passkeys(db, str(user.id))
    if len(existing) >= MAX_PASSKEYS_PER_MEMBER:
        raise PasskeyError(
            f"You already have {MAX_PASSKEYS_PER_MEMBER} passkeys. Remove one "
            "before adding another."
        )
    challenge = await _issue_challenge(db, str(user.id), PURPOSE_REGISTER)
    options = generate_registration_options(
        rp_id=rp.rp_id,
        rp_name=RP_NAME,
        user_id=str(user.id).encode(),
        user_name=user.username,
        user_display_name=user.full_name or user.username,
        challenge=challenge,
        timeout=_TIMEOUT_MS,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[_descriptor(p) for p in existing],
    )
    return options_to_json_dict(options)


async def verify_registration(
    db: AsyncSession,
    user: User,
    rp: RelyingParty,
    credential: Mapping[str, Any],
    name: str,
) -> UserPasskey:
    """Check the browser's registration response and store the new passkey.

    Raises ``PasskeyError`` when the response does not verify or the member is
    already at the limit. The cap is checked under a lock on the member's row
    (Pitfall #27), so two registrations finishing together cannot both slip
    in under it.
    """
    expected = await _consume_challenge(db, str(user.id), PURPOSE_REGISTER, credential)
    if expected is None:
        raise PasskeyError("That passkey request expired. Try again.")

    try:
        verified = verify_registration_response(
            credential=dict(credential),
            expected_challenge=expected,
            expected_rp_id=rp.rp_id,
            expected_origin=rp.origin,
            require_user_verification=True,
        )
    except (WebAuthnException, KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Passkey registration failed for user {}: {}", user.id, type(exc).__name__
        )
        raise PasskeyError("We couldn't verify that passkey. Try again.") from exc

    await db.execute(select(User.id).where(User.id == str(user.id)).with_for_update())
    current = await db.execute(
        select(UserPasskey.id)
        .where(UserPasskey.user_id == str(user.id))
        .with_for_update()
    )
    if len(current.all()) >= MAX_PASSKEYS_PER_MEMBER:
        raise PasskeyError(
            f"You already have {MAX_PASSKEYS_PER_MEMBER} passkeys. Remove one "
            "before adding another."
        )

    credential_id = bytes_to_base64url(verified.credential_id)
    digest = _credential_hash(credential_id)
    duplicate = await db.execute(
        select(UserPasskey.id).where(UserPasskey.credential_id_hash == digest)
    )
    if duplicate.first() is not None:
        raise PasskeyError("This passkey is already registered.")

    response = credential.get("response") or {}
    raw_transports = response.get("transports") if isinstance(response, dict) else None
    transports = [
        t for t in (raw_transports or []) if isinstance(t, str) and len(t) <= 20
    ][:8]

    passkey = UserPasskey(
        user_id=str(user.id),
        organization_id=str(user.organization_id),
        credential_id=credential_id,
        credential_id_hash=digest,
        public_key=bytes_to_base64url(verified.credential_public_key),
        rp_id=rp.rp_id,
        sign_count=verified.sign_count,
        transports=transports or None,
        aaguid=verified.aaguid,
        backed_up=bool(verified.credential_backed_up),
        name=name,
    )
    db.add(passkey)
    await db.flush()
    # created_at is a server default. MariaDB hands it back through
    # INSERT ... RETURNING; MySQL 8 has no RETURNING, so without this the
    # first read of it is a lazy load, which an async session cannot run.
    await db.refresh(passkey)
    return passkey


async def authentication_options(
    db: AsyncSession, user: User, rp: RelyingParty, purpose: str
) -> Optional[dict[str, Any]]:
    """Options for ``navigator.credentials.get()``, or ``None`` with no passkeys."""
    passkeys = [p for p in await list_passkeys(db, str(user.id)) if p.rp_id == rp.rp_id]
    if not passkeys:
        return None
    challenge = await _issue_challenge(db, str(user.id), purpose)
    options = generate_authentication_options(
        rp_id=rp.rp_id,
        challenge=challenge,
        timeout=_TIMEOUT_MS,
        allow_credentials=[_descriptor(p) for p in passkeys],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return options_to_json_dict(options)


async def verify_authentication(
    db: AsyncSession,
    user: User,
    rp: RelyingParty,
    credential: Mapping[str, Any],
    purpose: str,
) -> Optional[UserPasskey]:
    """Return the member's passkey that produced ``credential``, or ``None``.

    The challenge is consumed before anything else is checked, so a response
    that fails verification still cannot be retried.
    """
    expected = await _consume_challenge(db, str(user.id), purpose, credential)
    if expected is None:
        return None

    credential_id = credential.get("id")
    if not isinstance(credential_id, str) or not credential_id:
        return None
    result = await db.execute(
        select(UserPasskey).where(
            UserPasskey.credential_id_hash == _credential_hash(credential_id),
            UserPasskey.user_id == str(user.id),
            UserPasskey.rp_id == rp.rp_id,
        )
    )
    passkey = result.scalar_one_or_none()
    if passkey is None:
        return None

    try:
        verified = verify_authentication_response(
            credential=dict(credential),
            expected_challenge=expected,
            expected_rp_id=rp.rp_id,
            expected_origin=rp.origin,
            credential_public_key=base64url_to_bytes(passkey.public_key),
            credential_current_sign_count=int(passkey.sign_count or 0),
            require_user_verification=True,
        )
    except (WebAuthnException, KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Passkey verification failed for user {}: {}", user.id, type(exc).__name__
        )
        return None

    passkey.sign_count = verified.new_sign_count
    passkey.backed_up = bool(verified.credential_backed_up)
    passkey.last_used_at = datetime.now(timezone.utc)
    await db.flush()
    return passkey
