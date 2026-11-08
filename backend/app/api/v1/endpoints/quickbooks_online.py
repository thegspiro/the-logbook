"""
QuickBooks Online connection endpoints (Finance)

Mounted at ``/finance/quickbooks``. A Treasurer connects the department's
QuickBooks Online company here; paid purchase requests, issued checks and paid
expense reports then post to it as Purchases (see
``app/services/quickbooks_sync_service.py`` for what posts and how a payment is
kept from posting twice). ``GET /oauth/callback`` is where Intuit sends the
browser back, and it is the path ``QBO_REDIRECT_URI`` must name.
"""

from collections.abc import AsyncIterator
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.finance import (
    QuickBooksConnectionResponse,
    QuickBooksConnectStartResponse,
    QuickBooksDisconnectResponse,
    QuickBooksPostFromUpdate,
    QuickBooksPostingResponse,
    QuickBooksSyncResponse,
)
from app.services import quickbooks_online_client as qbo
from app.services import quickbooks_sync_service as sync
from app.services.integration_services.calendar_oauth_common import cookies_secure

router = APIRouter()

# httpOnly cookie carrying the attempt's nonce, double-submitted against the
# signed state. The path ends in a slash (CLAUDE.md pitfall 6) and covers only
# this router, so the cookie goes to the callback and nowhere else.
_NONCE_COOKIE = "qbo_oauth_nonce"
_COOKIE_PATH = "/api/v1/finance/quickbooks/"
_SETTINGS_PATH = "/finance/settings/quickbooks"


async def get_quickbooks_http() -> AsyncIterator[httpx.AsyncClient]:
    """The HTTP client the Intuit calls go through; tests replace it."""
    async with httpx.AsyncClient() as client:
        yield client


def _result_redirect(reason: Optional[str]) -> RedirectResponse:
    # The reason can carry Intuit's `error` query parameter, which anyone can
    # put in a link; encoding it keeps it inside one query value.
    query = (
        "quickbooks=connected"
        if reason is None
        else f"quickbooks_error={quote(str(reason)[:64], safe='')}"
    )
    response = RedirectResponse(
        url=f"{settings.FRONTEND_URL}{_SETTINGS_PATH}?{query}",
        status_code=status.HTTP_302_FOUND,
    )
    response.delete_cookie(_NONCE_COOKIE, path=_COOKIE_PATH)
    return response


@router.get("/connection", response_model=QuickBooksConnectionResponse)
async def get_quickbooks_connection(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    """Whether QuickBooks Online is configured and connected, and how many
    payments are queued, posted or refused.

    **Requires permission: finance.view**
    """
    return await sync.connection_status(db, str(current_user.organization_id))


@router.post("/oauth/start", response_model=QuickBooksConnectStartResponse)
async def start_quickbooks_connect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Begin connecting QuickBooks Online; returns Intuit's consent URL.

    **Requires permission: finance.manage**

    Refused (400) while QBO_CLIENT_ID, QBO_CLIENT_SECRET or QBO_REDIRECT_URI
    is blank. The browser should navigate to the returned URL; the attempt
    expires after ten minutes and a newer one replaces it.
    """
    try:
        url, nonce = await sync.begin_connect(
            db, str(current_user.organization_id), str(current_user.id)
        )
    except qbo.QuickBooksNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "QuickBooks Online is not configured on this server. Set "
                "QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI."
            ),
        )
    response = JSONResponse({"authorizationUrl": url})
    response.set_cookie(
        key=_NONCE_COOKIE,
        value=nonce,
        max_age=sync.STATE_TTL_SECONDS,
        httponly=True,
        secure=cookies_secure(),
        # Lax, not Strict: the callback is a top-level navigation from
        # appcenter.intuit.com, which a Strict cookie would not accompany.
        samesite="lax",
        path=_COOKIE_PATH,
    )
    return response


@router.get("/oauth/callback")
async def quickbooks_oauth_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    # Intuit names the connected company "realmId".
    realm_id: Optional[str] = Query(None, alias="realmId"),
    error: Optional[str] = None,
    nonce_cookie: Optional[str] = Cookie(None, alias=_NONCE_COOKIE),
    db: AsyncSession = Depends(get_db),
    http: httpx.AsyncClient = Depends(get_quickbooks_http),
):
    """Finish connecting QuickBooks Online after Intuit's consent page.

    Unauthenticated by design: Intuit redirects the browser here, and the
    session may have lapsed during consent. Identity comes from the signed
    ``state``, the double-submitted nonce cookie and the single-use pending
    attempt stored on the connection; the Treasurer who started it must still
    hold ``finance.manage``. Always redirects back to the QuickBooks page.
    """
    try:
        org_id, user_id = await sync.complete_connect(
            db,
            http,
            state=state,
            nonce_cookie=nonce_cookie,
            code=code,
            realm_id=realm_id,
            error=error,
        )
    except sync.QuickBooksConnectError as exc:
        return _result_redirect(str(exc))
    await log_audit_event(
        db,
        "finance.quickbooks_connected",
        "finance",
        "info",
        {"organization_id": org_id, "environment": settings.QBO_ENVIRONMENT},
        user_id=user_id,
        organization_id=org_id,
        ip_address=get_client_ip(request),
    )
    return _result_redirect(None)


@router.post("/disconnect", response_model=QuickBooksDisconnectResponse)
async def disconnect_quickbooks(
    request: Request,
    db: AsyncSession = Depends(get_db),
    http: httpx.AsyncClient = Depends(get_quickbooks_http),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Disconnect QuickBooks Online and revoke the grant at Intuit.

    **Requires permission: finance.manage**

    Payments queued but never sent go back to the CSV export. ``revoked`` is
    false when Intuit did not confirm; the tokens are discarded here anyway.
    """
    org_id = str(current_user.organization_id)
    revoked = await sync.disconnect(db, http, org_id)
    await log_audit_event(
        db,
        "finance.quickbooks_disconnected",
        "finance",
        "info",
        {"organization_id": org_id, "revoked": revoked},
        user_id=str(current_user.id),
        username=current_user.username,
        organization_id=org_id,
        ip_address=get_client_ip(request),
    )
    return {"revoked": revoked}


@router.put("/connection", response_model=QuickBooksConnectionResponse)
async def update_quickbooks_connection(
    payload: QuickBooksPostFromUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Set the first day payments post live (``postFrom``).

    **Requires permission: finance.manage**

    Payments made earlier stay on the CSV export. It starts as the moment of
    connecting, so a department's history is never posted into books that
    already hold it.
    """
    org_id = str(current_user.organization_id)
    try:
        await sync.set_post_from(db, org_id, payload.post_from)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await log_audit_event(
        db,
        "finance.quickbooks_post_from_set",
        "finance",
        "info",
        {"organization_id": org_id, "post_from": payload.post_from.isoformat()},
        user_id=str(current_user.id),
        username=current_user.username,
        organization_id=org_id,
    )
    return await sync.connection_status(db, org_id)


@router.post("/sync", response_model=QuickBooksSyncResponse)
async def run_quickbooks_sync(
    db: AsyncSession = Depends(get_db),
    http: httpx.AsyncClient = Depends(get_quickbooks_http),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Post due payments now, rather than at the next scheduled run.

    **Requires permission: finance.manage**

    Returns how many were queued, posted, refused or left to retry;
    ``skipped`` says why nothing ran (``not_configured``, ``not_connected``,
    ``busy`` while a scheduled run is sending, ``environment_changed``).
    """
    try:
        return await sync.run_for_organization(
            db, str(current_user.organization_id), http=http
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/postings", response_model=list[QuickBooksPostingResponse])
async def list_quickbooks_postings(
    status_filter: Optional[str] = Query(None, alias="status"),
    payment_type: Optional[str] = Query(None, alias="paymentType"),
    payment_id: Optional[str] = Query(None, alias="paymentId"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    """Payments sent, or being sent, to QuickBooks Online, newest first.

    **Requires permission: finance.view**

    Filter by ``status``, or by ``paymentType`` and ``paymentId`` for one
    payment's posting (its detail page reads it this way).
    """
    return await sync.list_postings(
        db,
        str(current_user.organization_id),
        status=status_filter,
        payment_type=payment_type,
        payment_id=payment_id,
    )


@router.post("/postings/{posting_id}/retry", status_code=204)
async def retry_quickbooks_posting(
    posting_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """Send again a posting QuickBooks refused, once the cause is fixed.

    **Requires permission: finance.manage**

    It goes out with the next run under a new request id; 400 unless the
    posting is ``failed``.
    """
    org_id = str(current_user.organization_id)
    try:
        await sync.retry_posting(db, org_id, posting_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Posting not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await log_audit_event(
        db,
        "finance.quickbooks_posting_retried",
        "finance",
        "info",
        {"organization_id": org_id, "posting_id": posting_id},
        user_id=str(current_user.id),
        username=current_user.username,
        organization_id=org_id,
    )
