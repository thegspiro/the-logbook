"""
Google Calendar connect endpoints

``POST /oauth/start`` begins the sign-in an administrator completes on
Google's consent screen; ``GET /oauth/callback`` is where Google sends the
browser back. A successful callback stores the grant, creates the
department's "<Organization> Events" calendar and marks the integration
connected, after which the ``calendar_sync`` task publishes to it.
Disconnecting goes through the generic ``POST /integrations/{id}/disconnect``.

See ``google_calendar_oauth_service`` for how one attempt is bound to the
organization, the integration and the administrator who started it.
"""

import secrets
import time
from urllib.parse import quote

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.models.integration import CalendarSyncMapping, Integration
from app.models.user import Organization, User
from app.services.calendar_sync_service import PAUSED_UNTIL_KEY, TOKEN_EXPIRES_KEY
from app.services.integration_health import record_integration_run
from app.services.integration_services import google_calendar_oauth_service as oauth
from app.services.integration_services.calendar_common import (
    CalendarAuthRevoked,
    CalendarError,
    CalendarNotFound,
    CalendarRateLimited,
    CalendarTransient,
)
from app.services.integration_services.google_calendar_service import (
    GoogleCalendarService,
)

router = APIRouter()

# httpOnly cookie carrying the attempt's nonce, double-submitted against the
# signed state. The path ends in a slash (CLAUDE.md pitfall 6) and covers
# only this router, so the cookie goes to the callback and nowhere else.
_NONCE_COOKIE = "gcal_oauth_nonce"
_COOKIE_PATH = "/api/v1/integrations/google-calendar/"

CONNECT_OPERATION = "calendar_connect"


def _cookies_secure() -> bool:
    if settings.COOKIE_SECURE is not None:
        return settings.COOKIE_SECURE
    origins = (
        settings.ALLOWED_ORIGINS
        if isinstance(settings.ALLOWED_ORIGINS, list)
        else [settings.ALLOWED_ORIGINS]
    )
    return not any(str(origin).startswith("http://") for origin in origins)


def _redirect_uri(request: Request) -> str:
    """The callback URL Google returns to; must match the OAuth client."""
    if settings.GOOGLE_CALENDAR_REDIRECT_URI:
        return settings.GOOGLE_CALENDAR_REDIRECT_URI
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/v1/integrations/google-calendar/oauth/callback"


def _result_redirect(reason: str | None) -> RedirectResponse:
    """Send the browser back to the integrations page with the outcome."""
    # The reason can carry Google's `error` query parameter, which anyone
    # can put in a link; encoding it keeps it inside one query value.
    query = (
        "google_calendar=connected"
        if reason is None
        else f"google_calendar_error={quote(str(reason)[:64], safe='')}"
    )
    resp = RedirectResponse(
        url=f"{settings.FRONTEND_URL}/integrations?{query}",
        status_code=status.HTTP_302_FOUND,
    )
    resp.delete_cookie(_NONCE_COOKIE, path=_COOKIE_PATH)
    return resp


async def _load_integration(
    db: AsyncSession, organization_id: str, *, lock: bool = False
) -> Integration | None:
    stmt = select(Integration).where(
        Integration.organization_id == organization_id,
        Integration.integration_type == oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE,
    )
    if lock:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    integration: Integration | None = result.scalar_one_or_none()
    return integration


async def _forget_published(db: AsyncSession, integration: Integration) -> None:
    # Mappings record what was published to one calendar; against a
    # different one every unchanged event would be skipped.
    await db.execute(
        delete(CalendarSyncMapping).where(
            CalendarSyncMapping.organization_id == str(integration.organization_id),
            CalendarSyncMapping.integration_id == str(integration.id),
        )
    )


async def _may_still_manage(
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


@router.post("/oauth/start")
async def start_google_calendar_connect(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Begin connecting Google Calendar; returns the Google consent URL.

    **Requires permission: integrations.manage**

    Refused while CALENDAR_SYNC_ENABLED is off, and when neither the
    department nor the deployment has a Google OAuth client. The browser
    should navigate to the returned ``authorization_url``; the attempt
    expires after ten minutes and a newer one replaces it.
    """
    if not settings.CALENDAR_SYNC_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This integration is not yet available",
        )
    org_id = str(current_user.organization_id)
    integration = await _load_integration(db, org_id)
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google Calendar integration not found for this organization",
        )
    try:
        authorization_url, nonce = oauth.begin(
            integration,
            user_id=str(current_user.id),
            redirect_uri=_redirect_uri(request),
        )
    except oauth.GoogleCalendarOAuthError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No Google OAuth client is configured. Set GOOGLE_CLIENT_ID and "
                "GOOGLE_CLIENT_SECRET on the server, or save the department's "
                "own client ID and secret on the Google Calendar card."
            ),
        )
    await db.commit()

    resp = JSONResponse({"authorization_url": authorization_url})
    resp.set_cookie(
        key=_NONCE_COOKIE,
        value=nonce,
        max_age=oauth.STATE_TTL_SECONDS,
        httponly=True,
        secure=_cookies_secure(),
        # Lax, not Strict: the callback is a top-level navigation from
        # accounts.google.com, which a Strict cookie would not accompany.
        samesite="lax",
        path=_COOKIE_PATH,
    )
    return resp


@router.get("/oauth/callback")
async def google_calendar_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    nonce_cookie: str | None = Cookie(None, alias=_NONCE_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    """Finish connecting Google Calendar after the consent screen.

    Unauthenticated by design: Google redirects the browser here, and the
    session may have lapsed during consent. Identity comes from the signed
    ``state`` (organization, integration, administrator, nonce), the
    double-submitted nonce cookie, and the single-use pending attempt stored
    on the integration; the administrator must still hold the integrations
    management permission. Always redirects back to the integrations page.
    """
    if not state:
        return _result_redirect(error or "access_denied")
    try:
        payload = oauth.decode_state(state)
    except oauth.GoogleCalendarOAuthError as exc:
        return _result_redirect(str(exc))

    nonce = str(payload.get("nonce") or "")
    if not nonce_cookie or not nonce or not secrets.compare_digest(nonce, nonce_cookie):
        return _result_redirect("invalid_state")

    org_id = str(payload.get("org") or "")
    user_id = str(payload.get("usr") or "")
    integration = await _load_integration(db, org_id, lock=True)
    if integration is None or str(integration.id) != str(payload.get("int") or ""):
        return _result_redirect("integration_not_found")

    # Consume the attempt and commit before calling Google, so the row lock
    # is not held across the network and a replay finds nothing to use.
    try:
        pending = oauth.consume_pending(integration, nonce=nonce, user_id=user_id)
    except oauth.GoogleCalendarOAuthError as exc:
        await db.commit()
        return _result_redirect(str(exc))
    await db.commit()

    if not settings.CALENDAR_SYNC_ENABLED:
        return _result_redirect("unavailable")
    if error or not code:
        return _result_redirect(error or "access_denied")
    if not await _may_still_manage(db, org_id, user_id):
        return _result_redirect("not_authorized")

    started = time.monotonic()
    try:
        tokens = await oauth.exchange_code(
            integration,
            code=code,
            redirect_uri=str(pending.get("redirect_uri") or ""),
            code_verifier=str(pending.get("code_verifier") or ""),
        )
    except oauth.GoogleCalendarOAuthError as exc:
        return _result_redirect(str(exc))

    organization = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    calendar_name = oauth.calendar_name_for(
        organization.name if organization is not None else None
    )
    client_id, client_secret = oauth.get_client_credentials(integration)
    service = GoogleCalendarService(
        {
            "token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "client_id": client_id,
            "client_secret": client_secret,
            "token_expires_at": tokens["expires_at"],
        }
    )

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
            "Google Calendar connect could not create the calendar for "
            "integration {}: {}",
            integration.id,
            type(exc).__name__,
        )
        # Nothing half-connected is left behind: the fresh grant is revoked,
        # no token is stored, and the card reads "Reconnect required" with
        # the reason in its health history.
        await oauth.revoke_token(tokens["refresh_token"])
        for key in oauth.TOKEN_SECRETS:
            integration.clear_secret(key)
        for key in oauth.CONNECTION_CONFIG_KEYS:
            config.pop(key, None)
        integration.config = config
        integration.status = "error"
        integration.enabled = False
        await _forget_published(db, integration)
        await record_integration_run(
            db,
            integration,
            operation=CONNECT_OPERATION,
            trigger="manual",
            success=False,
            error=(
                "Connected to Google, but the department calendar could not be "
                "created. Connect again; if it keeps failing, check that the "
                "Google Calendar API is enabled for the OAuth client."
            ),
            user_id=user_id,
            started_monotonic=started,
        )
        await db.commit()
        return _result_redirect("calendar_create_failed")

    if calendar_id != previous_calendar:
        await _forget_published(db, integration)

    integration.set_secret("refresh_token", tokens["refresh_token"])
    integration.set_secret("access_token", tokens["access_token"])
    # The connectors read "token" before "access_token".
    integration.clear_secret("token")
    expires_at = tokens["expires_at"]
    config[TOKEN_EXPIRES_KEY] = expires_at.isoformat() if expires_at else None
    if config[TOKEN_EXPIRES_KEY] is None:
        config.pop(TOKEN_EXPIRES_KEY)
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
        summary={"calendar_created": int(calendar_id != previous_calendar)},
        user_id=user_id,
        started_monotonic=started,
    )
    await db.commit()

    await log_audit_event(
        db,
        "integration.connected",
        "integrations",
        "info",
        {
            "organization_id": org_id,
            "integration_type": oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE,
            "integration_id": str(integration.id),
            "calendar_created": calendar_id != previous_calendar,
            "method": "oauth",
        },
        user_id=user_id,
        organization_id=org_id,
        ip_address=get_client_ip(request),
    )
    return _result_redirect(None)
