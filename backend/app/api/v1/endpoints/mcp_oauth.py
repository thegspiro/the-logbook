"""
A member's side of the Claude (MCP) OAuth server: the consent screen and the
connections they hold.

Mounted under ``/mcp-oauth`` behind the Integrations module gate and the
v1 router's CSRF check. Every route is "authenticated, no permission": any
signed-in member may connect a client, because what the connection can do
is bounded by that member's own permissions on every call (see
``app.mcp.oauth``), and the department decides whether members may connect
at all with its ``oauth_enabled`` switch.

Every lookup is org-scoped and, for connections, member-scoped (CLAUDE.md
pitfall 14): a request or a grant from another department, or another
member's grant, answers 404 exactly as one that does not exist.
"""

from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import collect_user_permissions, get_current_user
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.mcp import oauth
from app.mcp.keys import McpAuthError, resolve_department_access
from app.models.mcp_oauth import McpOAuthClient, McpOAuthGrant
from app.models.user import User

router = APIRouter()


class ConsentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approve: bool
    # A subset of what the client asked for; ``mcp:read`` is always kept.
    # Omitted means "everything requested".
    scopes: Optional[list[str]] = Field(default=None, max_length=len(oauth.SCOPES))


def instant(value: Optional[datetime]) -> Optional[str]:
    """ISO-8601 with an explicit UTC offset (see ``mcp_keys._instant``)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def grant_to_dict(grant: McpOAuthGrant, client: McpOAuthClient) -> dict[str, Any]:
    return {
        "id": grant.id,
        "client_name": client.name,
        "client_id": client.client_id,
        "scopes": grant.scope.split(),
        "created_at": instant(grant.created_at),
        "last_used_at": instant(grant.last_used_at),
        "expires_at": instant(grant.expires_at),
    }


def _base() -> str:
    base = oauth.origin()
    if base is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connecting Claude with a member account is not enabled on "
            "this server",
        )
    return base


async def require_audit(db: AsyncSession, entry: Any, what: str) -> None:
    """Refuse to commit a change to a member's MCP access with no audit row.

    The same trade ``mcp_keys.require_audit_entry`` makes for service keys:
    a consent nobody can trace is exactly what the record exists to catch.
    """
    if entry is not None:
        return
    await db.rollback()
    logger.error("MCP OAuth {} without an audit entry; rolled back", what)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The audit log is unavailable, so nothing was changed. "
        "Try again later.",
    )


@router.get("/requests/{request_id}")
async def get_authorization_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """What a client is asking the signed-in member to allow.

    **Authentication required.** Shows the registered client, where the
    member will be sent back to, and each requested scope with how many
    tools it would actually reach for this member right now — a scope the
    department has switched off, or that needs a permission the member does
    not hold, reaches none and is labelled as such.
    """
    _base()
    service = oauth.McpOAuthService(db)
    try:
        row, client = await service.get_pending(request_id, current_user)
        config, modules = await resolve_department_access(
            db, str(current_user.organization_id)
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Authorization request not found")
    except (ValueError, McpAuthError) as exc:
        raise HTTPException(status_code=409, detail=safe_error_detail(exc))

    requested = row.scope.split()
    reach = oauth.scope_reach(
        config,
        modules,
        frozenset(collect_user_permissions(current_user)),
        requested,
    )
    return {
        "id": row.id,
        "client": {
            "name": client.name,
            "client_id": client.client_id,
            "redirect_uri": row.redirect_uri,
            "redirect_host": urlsplit(row.redirect_uri).netloc,
        },
        "department_allows": config.oauth_enabled,
        "scopes": [
            {
                "scope": scope,
                "description": oauth.SCOPES[scope],
                "required": scope == oauth.SCOPE_READ,
                "tool_count": reach.get(scope, 0),
            }
            for scope in requested
            if scope in oauth.SCOPES
        ],
        "expires_at": instant(row.expires_at),
    }


@router.post("/requests/{request_id}/decision")
async def decide_authorization_request(
    request_id: str,
    body: ConsentDecision,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve or decline a client's request as the signed-in member.

    **Authentication required.** Returns ``redirect_to`` — the client's own
    registered redirect URI carrying a one-time code (approval) or
    ``error=access_denied`` (decline) — for the browser to follow. The code
    is good for 60 seconds and binds the connection to this member.
    """
    base = _base()
    service = oauth.McpOAuthService(db)
    try:
        decision, _ = await service.decide(
            request_id,
            current_user,
            base=base,
            approve=body.approve,
            scopes=body.scopes,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Authorization request not found")
    except McpAuthError as exc:
        raise HTTPException(status_code=403, detail=safe_error_detail(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=safe_error_detail(exc))

    row = decision.authorization
    client = await service.get_client(row.organization_id, row.client_pk)
    entry = await log_audit_event(
        db,
        ("mcp.oauth_consent_granted" if body.approve else "mcp.oauth_consent_declined"),
        "integrations",
        "warning" if body.approve else "info",
        {
            "request_id": row.id,
            "client_id": client.client_id if client else None,
            "client_name": client.name if client else None,
            "scope": row.scope,
            "redirect_uri": row.redirect_uri,
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
    )
    await require_audit(db, entry, "consent")
    await db.commit()
    return {"redirect_to": decision.redirect_to, "approved": body.approve}


@router.get("/connections")
async def list_my_connections(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The signed-in member's own live Claude (MCP) connections.

    **Authentication required.**
    """
    rows = await oauth.McpOAuthService(db).list_grants(
        str(current_user.organization_id), user_id=str(current_user.id)
    )
    return {"connections": [grant_to_dict(g, c) for g, c in rows]}


@router.delete("/connections/{grant_id}")
async def revoke_my_connection(
    grant_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """End one of the signed-in member's own connections.

    **Authentication required.** Only the member's own grant in their own
    department; anything else answers 404. Both tokens stop working at once.
    """
    grant = await oauth.McpOAuthService(db).revoke_grant(
        str(current_user.organization_id),
        grant_id,
        revoked_by=str(current_user.id),
        reason="member",
        user_id=str(current_user.id),
    )
    if grant is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    entry = await log_audit_event(
        db,
        "mcp.oauth_grant_revoked",
        "integrations",
        "warning",
        {"grant_id": grant.id, "reason": "member"},
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        ip_address=get_client_ip(request),
    )
    await require_audit(db, entry, "revocation")
    await db.commit()
    return {"revoked": True, "id": grant.id}
