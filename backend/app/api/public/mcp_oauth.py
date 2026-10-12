"""
The MCP OAuth 2.1 authorization server's public endpoints.

* ``GET  /api/oauth/authorize`` — validates the request, stores it, and sends
  the browser to the SPA's consent screen. The member signs in there with
  their ordinary session; nothing here reads a cookie.
* ``POST /api/oauth/token`` — the authorization-code and refresh-token
  grants (RFC 6749 §4.1.3, §6; PKCE per RFC 7636).
* ``POST /api/oauth/revoke`` — token revocation (RFC 7009).
* Authorization-server metadata (RFC 8414) and protected-resource metadata
  (RFC 9728), each at the ``/.well-known/`` path the RFCs define *and* under
  ``/api/`` — the reverse-proxy configurations this project ships route
  ``/api/`` to the backend everywhere, and the ``/.well-known/`` locations
  only where an operator has added them.

Every endpoint answers 404 while the deployment has not turned the feature
on (``MCP_OAUTH_ENABLED`` plus a valid ``MCP_OAUTH_ISSUER_URL``), so an
installation that never opted in exposes nothing new. All decisions are in
``app.mcp.oauth``; this module is HTTP plumbing, rate limits and audit rows.

Not under ``/api/v1``: that router enforces the CSRF double-submit check,
which a machine client exchanging a code has no cookie for. These endpoints
authenticate the *client* (secret or PKCE), never a browser session, so
there is no ambient credential for a cross-site request to ride.
"""

import base64
import html
from typing import Any, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit, get_client_ip
from app.mcp import oauth
from app.mcp.constants import MCP_MOUNT_PATH
from app.models.mcp_oauth import McpOAuthClient

router = APIRouter(tags=["mcp-oauth"])

# Per client address. Generous because a hosted client (claude.ai) sends
# every department member's refreshes from a handful of addresses; every
# secret these endpoints check is 256 bits of CSPRNG output, so the limits
# bound load, not guessing.
_AUTHORIZE_LIMIT = 60
_TOKEN_LIMIT = 120
_REVOKE_LIMIT = 60
_WINDOW_SECONDS = 60

# RFC 6749 §5.1: token responses must not be cached.
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}

_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connection refused</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem;
margin: 3rem auto; padding: 0 1rem; line-height: 1.5;">
<h1 style="font-size: 1.25rem;">This connection request was refused</h1>
<p>{message}</p>
<p>Nothing was shared. Ask your department's IT administrator to check the
client's registration under Integrations &rarr; Claude (MCP).</p>
</body></html>"""


def _origin_or_404() -> str:
    base = oauth.origin()
    if base is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return base


async def _limit(request: Request, scope: str, limit: int) -> None:
    await check_rate_limit(
        request,
        max_requests=limit,
        window_seconds=_WINDOW_SECONDS,
        lockout_seconds=_WINDOW_SECONDS,
        scope=scope,
    )


def _error(exc: oauth.OAuthError) -> JSONResponse:
    headers = dict(_NO_STORE)
    if exc.status == 401:
        headers["WWW-Authenticate"] = 'Basic realm="mcp-oauth"'
    return JSONResponse(
        {"error": exc.error, "error_description": exc.description},
        status_code=exc.status,
        headers=headers,
    )


async def _audit(
    db: AsyncSession,
    event: str,
    severity: str,
    data: dict[str, Any],
    *,
    organization_id: Optional[str],
    user_id: Optional[str],
    request: Request,
) -> bool:
    entry = await log_audit_event(
        db,
        event,
        "integrations",
        severity,
        data,
        organization_id=organization_id,
        user_id=user_id,
        ip_address=get_client_ip(request),
    )
    if entry is None:
        logger.error("MCP OAuth audit entry {} was not written", event)
        return False
    return True


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def _metadata_response(body: dict[str, Any]) -> JSONResponse:
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})


@router.get(
    "/.well-known/oauth-authorization-server" + oauth.ISSUER_PATH,
    include_in_schema=False,
)
@router.get(oauth.ISSUER_PATH + "/.well-known/oauth-authorization-server")
@router.get(oauth.ISSUER_PATH + "/.well-known/openid-configuration")
@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
async def authorization_server_metadata() -> JSONResponse:
    """OAuth authorization-server metadata (RFC 8414) for MCP clients.

    Public: Unauthenticated. Served at the RFC 8414 path-inserted location,
    the path-appended forms MCP clients also try, and the bare root form
    older clients use. Answers 404 while the feature is off.
    """
    return _metadata_response(oauth.authorization_server_metadata(_origin_or_404()))


@router.get(
    "/.well-known/oauth-protected-resource" + MCP_MOUNT_PATH,
    include_in_schema=False,
)
@router.get(MCP_MOUNT_PATH + "/.well-known/oauth-protected-resource")
async def protected_resource_metadata() -> JSONResponse:
    """Protected-resource metadata (RFC 9728) for the MCP endpoint.

    Public: Unauthenticated. The MCP endpoint's 401 points clients at the
    ``/api/`` form. Answers 404 while the feature is off.
    """
    return _metadata_response(oauth.protected_resource_metadata(_origin_or_404()))


# ---------------------------------------------------------------------------
# Authorization endpoint
# ---------------------------------------------------------------------------


def _single(request: Request, name: str) -> Optional[str]:
    values = request.query_params.getlist(name)
    if len(values) > 1:
        # RFC 6749 §3.1: a parameter sent twice makes the request invalid.
        raise oauth.OAuthError("invalid_request", f"{name} was sent more than once")
    return values[0] if values else None


@router.get(oauth.AUTHORIZE_PATH, include_in_schema=False)
async def authorize(request: Request, db: AsyncSession = Depends(get_db)):
    """Start an authorization-code request and hand the browser to consent.

    Public: Unauthenticated (the member signs in on the consent screen).
    An unknown client or an unregistered redirect URI is shown to the
    browser, never redirected to; every later error goes back to the
    verified redirect URI with ``state`` and ``iss``.
    """
    base = _origin_or_404()
    await _limit(request, "mcp_oauth_authorize", _AUTHORIZE_LIMIT)
    redirect_uri: Optional[str] = None
    state: Optional[str] = None
    try:
        names = (
            "client_id",
            "redirect_uri",
            "response_type",
            "scope",
            "state",
            "code_challenge",
            "code_challenge_method",
            "resource",
        )
        params = {name: _single(request, name) for name in names}
        redirect_uri = params["redirect_uri"]
        state = params["state"]
        row = await oauth.McpOAuthService(db).start_authorization(base=base, **params)
        await db.commit()
        request_id = row.id
    except oauth.OAuthError as exc:
        await db.rollback()
        if exc.redirect and redirect_uri:
            return RedirectResponse(
                oauth.redirect_with(
                    redirect_uri,
                    {
                        "error": exc.error,
                        "error_description": exc.description,
                        "state": state,
                        "iss": oauth.issuer(base),
                    },
                ),
                status_code=302,
            )
        return HTMLResponse(
            _PAGE.format(message=html.escape(exc.description)),
            status_code=400,
            headers=_NO_STORE,
        )
    # Relative: the consent screen is the SPA on this same origin, which
    # holds the member's session cookie.
    return RedirectResponse(
        f"{oauth.CONSENT_PATH}?request={request_id}",
        status_code=302,
        headers=_NO_STORE,
    )


# ---------------------------------------------------------------------------
# Token and revocation endpoints
# ---------------------------------------------------------------------------


async def _form(request: Request) -> dict[str, Optional[str]]:
    content_type = request.headers.get("content-type", "")
    if not content_type.lower().startswith("application/x-www-form-urlencoded"):
        raise oauth.OAuthError(
            "invalid_request",
            "The request body must be application/x-www-form-urlencoded",
        )
    form = await request.form()
    values: dict[str, Optional[str]] = {}
    for key in set(form.keys()):
        items = form.getlist(key)
        if len(items) > 1:
            raise oauth.OAuthError("invalid_request", f"{key} was sent more than once")
        item = items[0]
        if not isinstance(item, str):
            raise oauth.OAuthError("invalid_request", f"{key} must be text")
        values[key] = item
    return values


def _client_credentials(
    request: Request, form: dict[str, Optional[str]]
) -> tuple[Optional[str], Optional[str]]:
    """``client_secret_basic`` or ``client_secret_post`` (or ``none``).

    Using both at once is refused (RFC 6749 §2.3.1).
    """
    header = request.headers.get("authorization")
    if header:
        scheme, _, value = header.partition(" ")
        if scheme.lower() != "basic":
            raise oauth.OAuthError(
                "invalid_client", "Unsupported client authentication", status=401
            )
        if form.get("client_secret"):
            raise oauth.OAuthError(
                "invalid_request", "Use one client authentication method"
            )
        try:
            decoded = base64.b64decode(value.strip(), validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise oauth.OAuthError(
                "invalid_client", "Malformed client credentials", status=401
            )
        client_id, sep, secret = decoded.partition(":")
        if not sep:
            raise oauth.OAuthError(
                "invalid_client", "Malformed client credentials", status=401
            )
        client_id, secret = unquote(client_id), unquote(secret)
        if form.get("client_id") and form.get("client_id") != client_id:
            raise oauth.OAuthError("invalid_request", "client_id does not match")
        return client_id, secret
    return form.get("client_id"), form.get("client_secret")


@router.post(oauth.TOKEN_PATH, include_in_schema=False)
async def token(request: Request, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Exchange an authorization code, or rotate a refresh token.

    Public: Unauthenticated at the session level; the client authenticates
    with its secret (confidential) or PKCE alone (public).
    """
    base = _origin_or_404()
    await _limit(request, "mcp_oauth_token", _TOKEN_LIMIT)
    try:
        form = await _form(request)
        client_id, client_secret = _client_credentials(request, form)
    except oauth.OAuthError as exc:
        return _error(exc)

    grant_type = form.get("grant_type")
    service = oauth.McpOAuthService(db)
    client: Optional[McpOAuthClient] = None
    try:
        client = await service.authenticate_client(client_id, client_secret)
        if grant_type == "authorization_code":
            tokens = await service.exchange_code(
                client,
                base=base,
                code=form.get("code"),
                redirect_uri=form.get("redirect_uri"),
                code_verifier=form.get("code_verifier"),
                resource=form.get("resource"),
            )
            event = "mcp.oauth_token_issued"
        elif grant_type == "refresh_token":
            tokens = await service.refresh(
                client,
                base=base,
                refresh_token=form.get("refresh_token"),
                scope=form.get("scope"),
            )
            event = "mcp.oauth_token_refreshed"
        else:
            raise oauth.OAuthError(
                "unsupported_grant_type",
                "Only authorization_code and refresh_token are supported",
            )
    except (
        oauth.CodeBurned,
        oauth.CodeReplayed,
        oauth.RefreshReplayed,
    ) as exc:
        # State changed even though the answer is an error: the code is
        # burned, or a replay revoked a grant. Commit it with its trail.
        replay = not isinstance(exc, oauth.CodeBurned)
        await _audit(
            db,
            ("mcp.oauth_token_replay" if replay else "mcp.oauth_token_exchange_failed"),
            "critical" if replay else "warning",
            {
                "client_id": client.client_id if client else None,
                "grant_type": grant_type,
                "reason": exc.description,
            },
            organization_id=client.organization_id if client else None,
            user_id=None,
            request=request,
        )
        await db.commit()
        return _error(exc)
    except oauth.OAuthError as exc:
        await db.rollback()
        return _error(exc)

    # A token that has no audit row is not issued (the same trade
    # ``require_audit_entry`` makes for service keys).
    written = await _audit(
        db,
        event,
        "info",
        {
            "client_id": client.client_id,
            "grant_id": tokens.grant.id,
            "scope": tokens.scope,
        },
        organization_id=tokens.grant.organization_id,
        user_id=tokens.grant.user_id,
        request=request,
    )
    if not written:
        await db.rollback()
        return _error(
            oauth.OAuthError(
                "temporarily_unavailable",
                "The audit log is unavailable; try again later",
                status=503,
            )
        )
    await db.commit()
    return JSONResponse(tokens.as_response(), headers=_NO_STORE)


@router.post(oauth.REVOKE_PATH, include_in_schema=False)
async def revoke(request: Request, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """Revoke an access or refresh token, ending its connection (RFC 7009).

    Public: Unauthenticated at the session level; the client authenticates
    as at the token endpoint. An unknown token answers 200, as the RFC
    requires, so the endpoint does not reveal which tokens exist.
    """
    _origin_or_404()
    await _limit(request, "mcp_oauth_revoke", _REVOKE_LIMIT)
    try:
        form = await _form(request)
        client_id, client_secret = _client_credentials(request, form)
    except oauth.OAuthError as exc:
        return _error(exc)
    service = oauth.McpOAuthService(db)
    try:
        client = await service.authenticate_client(client_id, client_secret)
    except oauth.OAuthError as exc:
        return _error(exc)
    grant = await service.revoke_token(client, form.get("token"))
    if grant is not None:
        await _audit(
            db,
            "mcp.oauth_grant_revoked",
            "warning",
            {
                "client_id": client.client_id,
                "grant_id": grant.id,
                "reason": "client",
            },
            organization_id=grant.organization_id,
            user_id=grant.user_id,
            request=request,
        )
    await db.commit()
    return JSONResponse({}, headers=_NO_STORE)
