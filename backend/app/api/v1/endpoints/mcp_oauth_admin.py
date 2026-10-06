"""
Administration of the Claude (MCP) OAuth server: registered clients and the
department's live member connections.

Mounted under ``/integrations/claude-mcp/oauth`` behind the Integrations
module gate. Reading needs ``integrations.manage`` or
``integrations.mcp_keys``; registering and revoking clients, and ending a
member's connection, need ``integrations.mcp_keys`` — the same permission
that issues the department's service key, because a registered client is
the other way in.

There is no dynamic client registration endpoint, deliberately: a client
exists only because one of these administrators registered it, which is
what binds it — and every connection made through it — to one department.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.api.v1.endpoints.mcp_keys import _integration_row, require_audit_entry
from app.api.v1.endpoints.mcp_oauth import grant_to_dict, instant
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.mcp import oauth
from app.mcp.keys import parse_config
from app.mcp.tools._common import display_name
from app.models.mcp_oauth import McpOAuthClient
from app.models.user import User

router = APIRouter()


class ClientCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=100)
    redirect_uris: list[str] = Field(..., min_length=1, max_length=50)
    # A confidential client gets a secret (shown once); a public client
    # authenticates with PKCE alone, which is what a desktop client that
    # cannot keep a secret should be.
    confidential: bool = False


def _client_to_dict(client: McpOAuthClient) -> dict[str, Any]:
    return {
        "id": client.id,
        "client_id": client.client_id,
        "name": client.name,
        "redirect_uris": oauth.stored_redirect_uris(client),
        "confidential": client.client_secret_hash is not None,
        "created_at": instant(client.created_at),
        "created_by": client.created_by,
        "revoked_at": instant(client.revoked_at),
        "is_active": client.revoked_at is None,
    }


def _ip(request: Optional[Request]) -> Optional[str]:
    return get_client_ip(request) if request is not None else None


@router.get("/status")
async def get_oauth_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("integrations.manage", "integrations.mcp_keys")
    ),
):
    """Whether members can connect, and the addresses a client is given.

    **Requires permission: integrations.manage or integrations.mcp_keys**

    ``server_enabled`` is the deployment's switch (``MCP_OAUTH_ENABLED`` with
    a valid ``MCP_OAUTH_ISSUER_URL``); ``department_enabled`` is this
    department's. Both must be on for a member to connect.
    """
    base = oauth.origin()
    row = await _integration_row(db, str(current_user.organization_id))
    config = parse_config(row.config if row else None)
    return {
        "server_enabled": base is not None,
        "department_enabled": config.oauth_enabled,
        "issuer": oauth.issuer(base) if base else None,
        "resource": oauth.resource_url(base) if base else None,
        "authorization_endpoint": (f"{base}{oauth.AUTHORIZE_PATH}" if base else None),
        "token_endpoint": f"{base}{oauth.TOKEN_PATH}" if base else None,
        "scopes": [
            {"scope": scope, "description": text}
            for scope, text in oauth.SCOPES.items()
        ],
    }


@router.get("/clients")
async def list_oauth_clients(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("integrations.manage", "integrations.mcp_keys")
    ),
):
    """The department's registered MCP clients, revoked ones included.

    **Requires permission: integrations.manage or integrations.mcp_keys**
    """
    clients = await oauth.McpOAuthService(db).list_clients(
        str(current_user.organization_id)
    )
    return {"clients": [_client_to_dict(c) for c in clients]}


@router.post("/clients", status_code=status.HTTP_201_CREATED)
async def register_oauth_client(
    body: ClientCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.mcp_keys")),
):
    """Register an MCP client for the department.

    **Requires permission: integrations.mcp_keys**

    Redirect URIs are matched exactly: ``https://``, or ``http://`` on
    localhost for a desktop client with a fixed callback port. A
    confidential client's secret is in this response and nowhere else.
    """
    org_id = str(current_user.organization_id)
    try:
        registered = await oauth.McpOAuthService(db).register_client(
            org_id,
            name=body.name,
            redirect_uris=body.redirect_uris,
            confidential=body.confidential,
            created_by=str(current_user.id),
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=safe_error_detail(exc))
    client = registered.client
    entry = await log_audit_event(
        db,
        "mcp.oauth_client_registered",
        "integrations",
        "warning",
        {
            "client_pk": client.id,
            "client_id": client.client_id,
            "name": client.name,
            "redirect_uris": oauth.stored_redirect_uris(client),
            "confidential": registered.client_secret is not None,
        },
        user_id=str(current_user.id),
        organization_id=org_id,
        ip_address=_ip(request),
    )
    await require_audit_entry(db, entry, "registered", subject="client")
    await db.commit()
    return {
        "client": _client_to_dict(client),
        "client_secret": registered.client_secret,
    }


@router.delete("/clients/{client_pk}")
async def revoke_oauth_client(
    client_pk: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.mcp_keys")),
):
    """Revoke a client and end every member connection made through it.

    **Requires permission: integrations.mcp_keys**
    """
    org_id = str(current_user.organization_id)
    client, ended = await oauth.McpOAuthService(db).revoke_client(
        org_id, client_pk, revoked_by=str(current_user.id)
    )
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    entry = await log_audit_event(
        db,
        "mcp.oauth_client_revoked",
        "integrations",
        "warning",
        {
            "client_pk": client.id,
            "client_id": client.client_id,
            "name": client.name,
            "connections_ended": ended,
        },
        user_id=str(current_user.id),
        organization_id=org_id,
        ip_address=_ip(request),
    )
    await require_audit_entry(db, entry, "revoked", subject="client")
    await db.commit()
    return {"client": _client_to_dict(client), "connections_ended": ended}


@router.get("/grants")
async def list_oauth_grants(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("integrations.manage", "integrations.mcp_keys")
    ),
):
    """Every live member connection in the department, with the member's name.

    **Requires permission: integrations.manage or integrations.mcp_keys**
    """
    org_id = str(current_user.organization_id)
    rows = await oauth.McpOAuthService(db).list_grants(org_id)
    user_ids = {g.user_id for g, _ in rows}
    names: dict[str, Optional[str]] = {}
    if user_ids:
        result = await db.execute(
            select(User).where(User.organization_id == org_id, User.id.in_(user_ids))
        )
        names = {u.id: display_name(u) for u in result.scalars().all()}
    return {
        "grants": [
            {**grant_to_dict(g, c), "member_name": names.get(g.user_id)}
            for g, c in rows
        ]
    }


@router.delete("/grants/{grant_id}")
async def revoke_oauth_grant(
    grant_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.mcp_keys")),
):
    """End one member's connection.

    **Requires permission: integrations.mcp_keys**
    """
    org_id = str(current_user.organization_id)
    grant = await oauth.McpOAuthService(db).revoke_grant(
        org_id, grant_id, revoked_by=str(current_user.id), reason="administrator"
    )
    if grant is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    entry = await log_audit_event(
        db,
        "mcp.oauth_grant_revoked",
        "integrations",
        "warning",
        {"grant_id": grant.id, "member_id": grant.user_id, "reason": "administrator"},
        user_id=str(current_user.id),
        organization_id=org_id,
        ip_address=_ip(request),
    )
    await require_audit_entry(db, entry, "revoked", subject="connection")
    await db.commit()
    return {"revoked": True, "id": grant.id}
