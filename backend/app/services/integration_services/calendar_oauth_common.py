"""
Calendar connect: what the Google and Microsoft sign-ins share

Both calendar cards connect the same way — an administrator signs in with
the provider, the callback stores the grant, creates (or keeps) the
department's "<Organization> Events" calendar and marks the integration
connected, after which the ``calendar_sync`` task publishes to it. The
provider modules (``google_calendar_oauth_service``,
``outlook_calendar_oauth_service``) supply the URLs, scopes and token
exchange; everything here is provider-neutral.

A connect attempt is bound three ways, and the callback checks all of them:

- the ``state`` parameter is a signed, ten-minute token naming the
  organization, the integration, the administrator and a random nonce, with
  a per-provider ``purpose`` so one provider's state cannot finish the
  other's attempt;
- the nonce is double-submitted through an httpOnly cookie, so a state token
  lifted from a log cannot be completed from another browser;
- the same nonce, the administrator's id and the PKCE verifier are stored
  encrypted on the integration as the one pending attempt. The callback
  removes it before doing anything else, so a state token works once, and a
  newer attempt replaces an older one.
"""

import base64
import hashlib
import json
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.models.integration import CalendarSyncMapping, Integration
from app.models.user import User
from app.services.calendar_sync_service import PAUSED_UNTIL_KEY, TOKEN_EXPIRES_KEY
from app.services.integration_health import record_integration_run
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTransient,
)

STATE_TTL_SECONDS = 600
PENDING_SECRET = "oauth_pending"
CONNECT_OPERATION = "calendar_connect"

# Secrets the connect flow writes; disconnect clears all of them. The
# department's own client_id / client_secret are configuration and stay.
TOKEN_SECRETS = ("refresh_token", "access_token", "token", PENDING_SECRET)

# Public config keys only the connect flow and the reconciler write.
CONNECTION_CONFIG_KEYS = (
    "calendar_id",
    "calendar_name",
    "account_email",
    "token_expires_at",
    "sync_paused_until",
)


class CalendarOAuthError(Exception):
    """A connect step failed; the message is a short code for the redirect."""


def cookies_secure() -> bool:
    if settings.COOKIE_SECURE is not None:
        return settings.COOKIE_SECURE
    origins = (
        settings.ALLOWED_ORIGINS
        if isinstance(settings.ALLOWED_ORIGINS, list)
        else [settings.ALLOWED_ORIGINS]
    )
    return not any(str(origin).startswith("http://") for origin in origins)


def calendar_name_for(organization_name: str | None) -> str:
    name = (organization_name or "").strip() or "Department"
    # Both providers accept a longer name; the cap keeps a long legal name
    # from producing an unreadable calendar list entry.
    return f"{name[:200]} Events"


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def start_attempt(
    integration: Integration, *, purpose: str, user_id: str, redirect_uri: str
) -> tuple[str, str, str]:
    """Store a new pending attempt; return (state, nonce, PKCE challenge)."""
    nonce = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    expires = int(time.time()) + STATE_TTL_SECONDS
    integration.set_secret(
        PENDING_SECRET,
        json.dumps(
            {
                "nonce": nonce,
                "user_id": user_id,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "exp": expires,
            }
        ),
    )
    state = str(
        jwt.encode(
            {
                "purpose": purpose,
                "org": str(integration.organization_id),
                "int": str(integration.id),
                "usr": user_id,
                "nonce": nonce,
                "exp": expires,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
    )
    return state, nonce, challenge


def decode_state(token: str, purpose: str) -> dict[str, Any]:
    """Verify the state's signature, purpose and expiry."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise CalendarOAuthError("invalid_state") from exc
    if not isinstance(payload, dict) or payload.get("purpose") != purpose:
        raise CalendarOAuthError("invalid_state")
    return payload


def consume_pending(
    integration: Integration, *, nonce: str, user_id: str
) -> dict[str, Any]:
    """Remove the pending attempt and return it if it matches; else raise.

    The pending record is removed whether or not it matches, so a guessed or
    replayed state cannot be retried against the same attempt.
    """
    raw = integration.get_secret(PENDING_SECRET)
    integration.clear_secret(PENDING_SECRET)
    try:
        pending = json.loads(raw) if raw else None
    except ValueError:
        pending = None
    if not isinstance(pending, dict):
        raise CalendarOAuthError("invalid_state")
    stored_nonce = str(pending.get("nonce") or "")
    if (
        not stored_nonce
        or not secrets.compare_digest(stored_nonce, nonce)
        or str(pending.get("user_id") or "") != user_id
    ):
        raise CalendarOAuthError("invalid_state")
    exp = pending.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise CalendarOAuthError("expired_state")
    return pending


def expires_at_from(expires_in: Any) -> datetime | None:
    if isinstance(expires_in, (int, str)) and str(expires_in).isdigit():
        return datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
    return None


def unverified_id_token_claims(id_token: Any) -> dict[str, Any] | None:
    """The claims of an ID token received directly from the token endpoint.

    The token came straight from the provider's token endpoint over TLS,
    which OpenID Connect Core 3.1.3.7 accepts in place of a signature check.
    Callers use it only as a label and still check audience and issuer.
    """
    if not isinstance(id_token, str) or not id_token:
        return None
    try:
        claims = jwt.decode(id_token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    return claims if isinstance(claims, dict) else None


async def load_integration(
    db: AsyncSession, organization_id: str, integration_type: str, *, lock: bool = False
) -> Integration | None:
    stmt = select(Integration).where(
        Integration.organization_id == organization_id,
        Integration.integration_type == integration_type,
    )
    if lock:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    integration: Integration | None = result.scalar_one_or_none()
    return integration


async def forget_published(db: AsyncSession, integration: Integration) -> None:
    # Mappings record what was published to one calendar; against a
    # different one every unchanged event would be skipped.
    await db.execute(
        delete(CalendarSyncMapping).where(
            CalendarSyncMapping.organization_id == str(integration.organization_id),
            CalendarSyncMapping.integration_id == str(integration.id),
        )
    )


async def may_still_manage(
    db: AsyncSession, organization_id: str, user_id: str
) -> bool:
    """Whether the administrator who started the attempt still may finish it.

    Ten minutes is long enough for a deactivation or a lost position to land
    in between; the grant is stored as that administrator's action.
    """
    result = await db.execute(
        select(User)
        .where(
            User.id == user_id,
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        )
        .options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()
    return bool(
        user is not None
        and user.is_active
        and user_has_permission(user, "integrations.manage")
    )


@dataclass
class CallbackAttempt:
    """A callback that passed every check and may exchange its code."""

    integration: Integration
    pending: dict[str, Any]
    organization_id: str
    user_id: str
    code: str


async def open_callback(
    db: AsyncSession,
    *,
    integration_type: str,
    purpose: str,
    state: str | None,
    nonce_cookie: str | None,
    code: str | None,
    error: str | None,
) -> CallbackAttempt:
    """Check a provider callback; raise ``CalendarOAuthError(reason)`` if refused.

    The pending attempt is consumed and committed before anything else
    happens, so the row lock is not held across the network and a replay
    finds nothing to use.
    """
    if not state:
        raise CalendarOAuthError(error or "access_denied")
    payload = decode_state(state, purpose)

    nonce = str(payload.get("nonce") or "")
    if not nonce_cookie or not nonce or not secrets.compare_digest(nonce, nonce_cookie):
        raise CalendarOAuthError("invalid_state")

    org_id = str(payload.get("org") or "")
    user_id = str(payload.get("usr") or "")
    integration = await load_integration(db, org_id, integration_type, lock=True)
    if integration is None or str(integration.id) != str(payload.get("int") or ""):
        raise CalendarOAuthError("integration_not_found")

    try:
        pending = consume_pending(integration, nonce=nonce, user_id=user_id)
    finally:
        await db.commit()

    if not settings.CALENDAR_SYNC_ENABLED:
        raise CalendarOAuthError("unavailable")
    if error or not code:
        raise CalendarOAuthError(error or "access_denied")
    if not await may_still_manage(db, org_id, user_id):
        raise CalendarOAuthError("not_authorized")
    return CallbackAttempt(
        integration=integration,
        pending=pending,
        organization_id=org_id,
        user_id=user_id,
        code=code,
    )


async def finish_connect(
    db: AsyncSession,
    integration: Integration,
    *,
    service: Any,
    tokens: dict[str, Any],
    calendar_name: str,
    user_id: str,
    started_monotonic: float,
    failure_message: str,
    revoke: Callable[[str | None], Awaitable[bool]] | None = None,
) -> tuple[bool, bool]:
    """Keep or create the department calendar and store the grant.

    ``service`` is the provider's calendar service built on the fresh
    tokens; it must offer ``calendar_exists`` and ``create_calendar``.
    Returns ``(connected, calendar_created)`` after committing. On failure
    nothing half-connected is left behind: the fresh grant is revoked where
    the provider allows it, no token is stored, and the card reads
    "Reconnect required" with ``failure_message`` in its health history.
    """
    config = dict(integration.config or {})
    previous_calendar = config.get("calendar_id")
    same_account = bool(
        tokens["account_email"]
        and tokens["account_email"] == config.get("account_email")
    )
    try:
        calendar_id = None
        if isinstance(previous_calendar, str) and previous_calendar and same_account:
            # A reconnect after a broken grant keeps the calendar members
            # already subscribe to, if it is still there.
            try:
                if await service.calendar_exists(previous_calendar):
                    calendar_id = previous_calendar
            except (CalendarAuthRevoked, CalendarRateLimited, CalendarTransient):
                raise
            except CalendarNotFound:
                pass
            except CalendarError:
                # Refused (403): this grant cannot reach it, so make a new one.
                pass
        if calendar_id is None:
            calendar_id = await service.create_calendar(calendar_name)
            config["calendar_name"] = calendar_name
    except Exception as exc:
        logger.warning(
            "{} connect could not create the calendar for integration {}: {}",
            integration.integration_type,
            integration.id,
            type(exc).__name__,
        )
        if revoke is not None:
            await revoke(tokens["refresh_token"])
        for key in TOKEN_SECRETS:
            integration.clear_secret(key)
        for key in CONNECTION_CONFIG_KEYS:
            config.pop(key, None)
        integration.config = config
        integration.status = "error"
        integration.enabled = False
        await forget_published(db, integration)
        await record_integration_run(
            db,
            integration,
            operation=CONNECT_OPERATION,
            trigger="manual",
            success=False,
            error=failure_message,
            user_id=user_id,
            started_monotonic=started_monotonic,
        )
        await db.commit()
        return False, False

    created = calendar_id != previous_calendar
    if created:
        await forget_published(db, integration)

    integration.set_secret("refresh_token", tokens["refresh_token"])
    integration.set_secret("access_token", tokens["access_token"])
    # The connectors read "token" before "access_token".
    integration.clear_secret("token")
    expires_at = tokens["expires_at"]
    if expires_at:
        config[TOKEN_EXPIRES_KEY] = expires_at.isoformat()
    else:
        config.pop(TOKEN_EXPIRES_KEY, None)
    if tokens["account_email"]:
        config["account_email"] = tokens["account_email"]
    else:
        config.pop("account_email", None)
    config["calendar_id"] = calendar_id
    config.setdefault("calendar_name", calendar_name)
    config.pop(PAUSED_UNTIL_KEY, None)
    config.pop("sync_direction", None)
    integration.config = config
    integration.status = "connected"
    integration.enabled = True
    await record_integration_run(
        db,
        integration,
        operation=CONNECT_OPERATION,
        trigger="manual",
        success=True,
        summary={"calendar_created": int(created)},
        user_id=user_id,
        started_monotonic=started_monotonic,
    )
    await db.commit()
    return True, created
