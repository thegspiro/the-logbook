"""
Google Calendar connect endpoints

``POST /oauth/start`` begins the sign-in an administrator completes on
Google's consent screen; ``GET /oauth/callback`` is where Google sends the
browser back. A successful callback stores the grant, creates the
department's "<Organization> Events" calendar and marks the integration
connected, after which the ``calendar_sync`` task publishes to it.
Disconnecting goes through the generic ``POST /integrations/{id}/disconnect``.

See ``calendar_oauth_common`` for how one attempt is bound to the
organization, the integration and the administrator who started it.
"""

import time
from urllib.parse import quote

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.models.user import Organization, User
from app.services.integration_services import calendar_oauth_common as common
from app.services.integration_services import google_calendar_oauth_service as oauth
from app.services.integration_services.google_calendar_service import (
    GoogleCalendarService,
)

router = APIRouter()

# httpOnly cookie carrying the attempt's nonce, double-submitted against the
# signed state. The path ends in a slash (CLAUDE.md pitfall 6) and covers
# only this router, so the cookie goes to the callback and nowhere else.
_NONCE_COOKIE = "gcal_oauth_nonce"
_COOKIE_PATH = "/api/v1/integrations/google-calendar/"


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
    integration = await common.load_integration(
        db, org_id, oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE
    )
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
                "own client ID and secret in the integration settings."
            ),
        )
    await db.commit()

    resp = JSONResponse({"authorization_url": authorization_url})
    resp.set_cookie(
        key=_NONCE_COOKIE,
        value=nonce,
        max_age=oauth.STATE_TTL_SECONDS,
        httponly=True,
        secure=common.cookies_secure(),
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
    try:
        attempt = await common.open_callback(
            db,
            integration_type=oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE,
            purpose=oauth.STATE_PURPOSE,
            state=state,
            nonce_cookie=nonce_cookie,
            code=code,
            error=error,
        )
    except common.CalendarOAuthError as exc:
        return _result_redirect(str(exc))
    integration = attempt.integration

    started = time.monotonic()
    try:
        tokens = await oauth.exchange_code(
            integration,
            code=attempt.code,
            redirect_uri=str(attempt.pending.get("redirect_uri") or ""),
            code_verifier=str(attempt.pending.get("code_verifier") or ""),
        )
    except oauth.GoogleCalendarOAuthError as exc:
        return _result_redirect(str(exc))

    organization = (
        await db.execute(
            select(Organization).where(Organization.id == attempt.organization_id)
        )
    ).scalar_one_or_none()
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
    connected, calendar_created = await common.finish_connect(
        db,
        integration,
        service=service,
        tokens=tokens,
        calendar_name=common.calendar_name_for(
            organization.name if organization is not None else None
        ),
        user_id=attempt.user_id,
        started_monotonic=started,
        failure_message=(
            "Connected to Google, but the department calendar could not be "
            "created. Connect again; if it keeps failing, check that the "
            "Google Calendar API is enabled for the OAuth client."
        ),
        revoke=oauth.revoke_token,
    )
    if not connected:
        return _result_redirect("calendar_create_failed")

    await log_audit_event(
        db,
        "integration.connected",
        "integrations",
        "info",
        {
            "organization_id": attempt.organization_id,
            "integration_type": oauth.GOOGLE_CALENDAR_INTEGRATION_TYPE,
            "integration_id": str(integration.id),
            "calendar_created": calendar_created,
            "method": "oauth",
        },
        user_id=attempt.user_id,
        organization_id=attempt.organization_id,
        ip_address=get_client_ip(request),
    )
    return _result_redirect(None)
