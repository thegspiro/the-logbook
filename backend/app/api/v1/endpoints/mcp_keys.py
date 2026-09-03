"""
Service-key management for the Claude MCP integration.

Mounted under ``/integrations/claude-mcp``. Reading the status and the key
list needs ``integrations.manage`` or ``integrations.mcp_keys``; issuing and
revoking needs ``integrations.mcp_keys``, which only the IT administrator
position carries by default (see ``core/permissions.py``). The Integrations
screen itself is behind ``settings.manage``, so a delegated key manager
holds that too — the panel text and the wiki say so.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.mcp.constants import MCP_INTEGRATION_TYPE, MCP_MOUNT_PATH
from app.mcp.keys import MAX_EXPIRY_DAYS, McpKeyService, parse_config
from app.models.integration import Integration
from app.models.mcp_service_key import McpServiceKey
from app.models.user import User

router = APIRouter()


class McpKeyCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=100)
    # ``None`` is a lifetime key; the UI offers both.
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=MAX_EXPIRY_DAYS)


def _instant(value: Optional[datetime]) -> Optional[str]:
    """ISO-8601 with an explicit UTC offset.

    Every stored value is UTC, but some MySQL driver configurations hand
    back naive datetimes for ``DateTime(timezone=True)``; without the offset
    the browser would read them as local time.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _key_to_dict(key: McpServiceKey) -> dict[str, Any]:
    return {
        "id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "expires_at": _instant(key.expires_at),
        "last_used_at": _instant(key.last_used_at),
        "revoked_at": _instant(key.revoked_at),
        "created_at": _instant(key.created_at),
        "created_by": key.created_by,
        "is_active": key.is_active,
    }


def _ip(request: Optional[Request]) -> Optional[str]:
    return get_client_ip(request) if request is not None else None


async def _integration_row(
    db: AsyncSession, organization_id: str
) -> Optional[Integration]:
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == MCP_INTEGRATION_TYPE,
        )
    )
    return result.scalar_one_or_none()


async def require_audit_entry(db: AsyncSession, entry: Any, action: str) -> None:
    """Refuse to commit a key change that left no audit entry.

    ``log_audit_event`` swallows its own failure and returns ``None`` so an
    audit outage does not break ordinary requests; a key change is the one
    place that trade goes the other way, since a key rotated without a
    record is exactly what the record exists to catch. The integrations
    endpoint uses it too, for the keys a disconnect revokes.
    """
    if entry is not None:
        return
    await db.rollback()
    logger.error("MCP key {} without an audit entry; change rolled back", action)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The audit log is unavailable, so the key was not changed. "
        "Try again later.",
    )


@router.get("/status")
async def get_mcp_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("integrations.manage", "integrations.mcp_keys")
    ),
):
    """Whether the add-on is on, what it exposes, and the active key if any."""
    org_id = str(current_user.organization_id)
    row = await _integration_row(db, org_id)
    enabled = bool(row and row.enabled and row.status == "connected")
    config = parse_config(row.config if row else None)
    active = await McpKeyService(db).active_keys(org_id)
    return {
        "enabled": enabled,
        "endpoint_path": MCP_MOUNT_PATH,
        "access_mode": config.access_mode,
        "expose_finance": config.expose_finance,
        "expose_medical_screening": config.expose_medical_screening,
        "expose_full_schedule": config.expose_full_schedule,
        "active_key": _key_to_dict(active[0]) if active else None,
    }


@router.get("/keys")
async def list_mcp_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("integrations.manage", "integrations.mcp_keys")
    ),
):
    keys = await McpKeyService(db).list_keys(str(current_user.organization_id))
    return {"keys": [_key_to_dict(k) for k in keys]}


@router.post("/keys", status_code=status.HTTP_201_CREATED)
async def create_mcp_key(
    body: McpKeyCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.mcp_keys")),
):
    """Issue the organization's service key. Any previous key is revoked.

    The plaintext is in this response and nowhere else: it is not stored and
    cannot be shown again.
    """
    org_id = str(current_user.organization_id)
    row = await _integration_row(db, org_id)
    if row is None or not row.enabled or row.status != "connected":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Connect the Claude (MCP) integration before issuing a key",
        )
    try:
        minted = await McpKeyService(db).mint(
            org_id,
            name=body.name,
            expires_in_days=body.expires_in_days,
            created_by=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(exc)
        )

    entry = await log_audit_event(
        db,
        "mcp.key_created",
        "integrations",
        "warning",
        {
            "key_id": minted.key.id,
            "key_prefix": minted.key.key_prefix,
            "name": minted.key.name,
            "expires_at": _key_to_dict(minted.key)["expires_at"],
            "revoked_key_ids": [k.id for k in minted.revoked],
        },
        user_id=str(current_user.id),
        organization_id=org_id,
        ip_address=_ip(request),
    )
    await require_audit_entry(db, entry, "issued")
    await db.commit()
    return {
        "key": _key_to_dict(minted.key),
        "plaintext": minted.plaintext,
        "revoked": [_key_to_dict(k) for k in minted.revoked],
        "endpoint_path": MCP_MOUNT_PATH,
    }


@router.delete("/keys/{key_id}")
async def revoke_mcp_key(
    key_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.mcp_keys")),
):
    org_id = str(current_user.organization_id)
    key = await McpKeyService(db).revoke(
        org_id, key_id, revoked_by=str(current_user.id)
    )
    if key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Key not found"
        )
    entry = await log_audit_event(
        db,
        "mcp.key_revoked",
        "integrations",
        "warning",
        {"key_id": key.id, "key_prefix": key.key_prefix, "name": key.name},
        user_id=str(current_user.id),
        organization_id=org_id,
        ip_address=_ip(request),
    )
    await require_audit_entry(db, entry, "revoked")
    await db.commit()
    return {"key": _key_to_dict(key)}
