"""
Salesforce Sync API Endpoints

Authenticated endpoints for triggering manual syncs, checking sync
status, and managing field mappings between Logbook and Salesforce.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.models.event import Event
from app.models.integration import Integration
from app.models.training import TrainingRecord
from app.models.user import User
from app.services.integration_services.salesforce_oauth_service import (
    SalesforceOAuthError,
    build_authorization_url,
    decode_state,
    encode_state,
    exchange_code_for_tokens,
    get_client_credentials,
)
from app.services.integration_services.salesforce_sync_service import (
    event_to_dict,
    get_salesforce_sync_service,
    training_record_to_dict,
    user_to_member_dict,
)

router = APIRouter()

# httpOnly cookie carrying the OAuth CSRF nonce, double-submitted against the
# signed `state` token on callback. Scoped (trailing slash) to the Salesforce
# integration path so it is returned on the callback but nowhere else.
_SF_STATE_COOKIE = "sf_oauth_nonce"
_SF_STATE_PATH = "/api/v1/integrations/salesforce/"


# ============================================================
# Helpers
# ============================================================


async def _get_sf_integration(db: AsyncSession, organization_id: str) -> Integration:
    """Load the connected Salesforce integration or raise 404."""
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "salesforce",
            Integration.enabled.is_(True),
            Integration.status == "connected",
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )
    return integration


# ============================================================
# Endpoints
# ============================================================


@router.get("/status")
async def salesforce_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Get the current Salesforce sync status for this organization."""
    integration = await _get_sf_integration(db, str(current_user.organization_id))
    config = integration.config or {}
    return {
        "connected": True,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "sync_direction": config.get("sync_direction", "push"),
        "sync_types": config.get("sync_types", []),
        "environment": config.get("environment", "production"),
        "field_mappings": config.get("field_mappings", {}),
    }


@router.post("/push/members")
async def push_members_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all active members to Salesforce as Contacts."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(User).where(
            User.organization_id == org_id,
            User.deleted_at.is_(None),
        )
    )
    members = result.scalars().all()
    member_dicts = [user_to_member_dict(m) for m in members]
    counts = await sync_service.sync_all_members_to_salesforce(member_dicts)

    # Update last_sync_at
    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.members_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            **counts,
        },
    )

    return {
        "success": True,
        "message": (
            f"Synced {counts['created']} new, "
            f"{counts['updated']} updated, "
            f"{counts.get('adopted', 0)} adopted, "
            f"{counts['failed']} failed"
        ),
        **counts,
    }


@router.post("/push/training")
async def push_training_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all training records to Salesforce as Tasks."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(TrainingRecord).where(
            TrainingRecord.organization_id == org_id,
        )
    )
    records = result.scalars().all()
    record_dicts = [training_record_to_dict(r) for r in records]
    counts = await sync_service.sync_all_training_to_salesforce(record_dicts)

    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.training_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            **counts,
        },
    )

    return {
        "success": True,
        "message": (
            f"Synced {counts['created']} new, "
            f"{counts['updated']} updated, "
            f"{counts['failed']} failed"
        ),
        **counts,
    }


@router.post("/push/events")
async def push_events_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all non-cancelled events to Salesforce."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(Event).where(
            Event.organization_id == org_id,
            Event.is_cancelled.is_(False),
        )
    )
    events = result.scalars().all()

    created = 0
    updated = 0
    failed = 0
    for event in events:
        try:
            sf_id = await sync_service.push_event(event_to_dict(event))
            if sf_id:
                created += 1
            else:
                failed += 1
        except Exception:
            logger.warning("Failed to push event %s", event.id, exc_info=True)
            failed += 1

    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.events_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            "created": created,
            "updated": updated,
            "failed": failed,
        },
    )

    return {
        "success": True,
        "message": f"Synced {created + updated} events, {failed} failed",
        "created": created,
        "updated": updated,
        "failed": failed,
    }


@router.post("/pull/contacts")
async def pull_contacts_from_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Pull Contacts from Salesforce and apply them to Logbook members.

    Contacts are matched to existing members (by Logbook external ID, then
    email) and their demographic fields updated. Members are never created or
    deleted. If the org's sync direction is push-only, contacts are returned
    for review but not written.
    """
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    integration = await _get_sf_integration(db, org_id)
    contacts = await sync_service.pull_contacts(since=integration.last_sync_at)

    counts = {"updated": 0, "unchanged": 0, "unmatched": 0, "failed": 0}
    inbound_enabled = sync_service.inbound_enabled
    if inbound_enabled and contacts:
        counts = await sync_service.sync_inbound_contacts(contacts)

    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.contacts_pulled",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            "contacts_pulled": len(contacts),
            "inbound_enabled": inbound_enabled,
            **counts,
        },
    )

    return {
        "success": True,
        "contacts": contacts,
        "count": len(contacts),
        "inbound_enabled": inbound_enabled,
        "persisted": counts["updated"],
        **counts,
    }


# ============================================================
# Readiness & dry-run preview
# ============================================================


@router.get("/readiness")
async def salesforce_readiness(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Report whether the connected Salesforce org has the fields sync needs.

    Distinguishes the Logbook external-ID custom fields (required for
    duplicate-free sync) from other mapped custom fields (which are dropped
    gracefully when absent). Useful when a department is still building out
    their Salesforce org.
    """
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )
    return await sync_service.check_readiness()


@router.post("/preview/members")
async def preview_member_sync(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Preview a member push without writing to Salesforce.

    Returns how many members would be created versus matched against existing
    Salesforce Contacts (updated or adopted), so an admin can see the impact
    on an org that already contains data before running the real sync.
    """
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(User).where(
            User.organization_id == org_id,
            User.deleted_at.is_(None),
        )
    )
    members = result.scalars().all()
    member_dicts = [user_to_member_dict(m) for m in members]
    preview = await sync_service.preview_member_sync(member_dicts)
    return {"success": True, **preview}


# ============================================================
# OAuth "Connect Salesforce" flow (authorization-code)
# ============================================================


def _cookies_secure() -> bool:
    """Whether to set the Secure flag on the OAuth state cookie."""
    if settings.COOKIE_SECURE is not None:
        return settings.COOKIE_SECURE
    origins = (
        settings.ALLOWED_ORIGINS
        if isinstance(settings.ALLOWED_ORIGINS, list)
        else [settings.ALLOWED_ORIGINS]
    )
    return not any(str(origin).startswith("http://") for origin in origins)


def _oauth_redirect_uri(request: Request) -> str:
    """The callback URL Salesforce redirects back to after consent.

    Prefers the explicitly configured value (which must match the Connected
    App's Callback URL); otherwise derives it from the request base URL.
    """
    if settings.SALESFORCE_OAUTH_REDIRECT_URI:
        return settings.SALESFORCE_OAUTH_REDIRECT_URI
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/v1/integrations/salesforce/oauth/callback"


def _connect_result_redirect(reason: str | None) -> RedirectResponse:
    """Redirect the browser back to the integrations page after connect.

    ``reason`` is None on success, or a short error code otherwise. The state
    cookie is cleared either way.
    """
    query = "salesforce=connected" if reason is None else f"salesforce_error={reason}"
    resp = RedirectResponse(
        url=f"{settings.FRONTEND_URL}/integrations?{query}",
        status_code=status.HTTP_302_FOUND,
    )
    resp.delete_cookie(_SF_STATE_COOKIE, path=_SF_STATE_PATH)
    return resp


async def _get_salesforce_integration_any_status(
    db: AsyncSession, organization_id: str
) -> Integration | None:
    """Load the org's Salesforce integration regardless of connect status."""
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "salesforce",
        )
    )
    return result.scalar_one_or_none()


@router.get("/oauth/authorize")
async def salesforce_oauth_authorize(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Begin the Salesforce connect flow: redirect to the consent screen.

    The admin's browser should navigate to this endpoint directly (it returns
    a 302 to Salesforce). Requires a configured Connected App client_id,
    either on the integration or deployment-wide.
    """
    org_id = str(current_user.organization_id)
    integration = await _get_salesforce_integration_any_status(db, org_id)
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration not found for this organization",
        )

    client_id, _ = get_client_credentials(integration)
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No Salesforce Connected App is configured. Add a client_id "
                "and client_secret to the integration, or configure a "
                "deployment-wide Connected App."
            ),
        )

    redirect_uri = _oauth_redirect_uri(request)
    nonce = secrets.token_urlsafe(32)
    state = encode_state(
        organization_id=org_id,
        integration_id=str(integration.id),
        redirect_uri=redirect_uri,
        nonce=nonce,
    )
    try:
        authorize_url = build_authorization_url(
            integration, state=state, redirect_uri=redirect_uri
        )
    except SalesforceOAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        )

    redirect = RedirectResponse(url=authorize_url, status_code=status.HTTP_302_FOUND)
    redirect.set_cookie(
        key=_SF_STATE_COOKIE,
        value=nonce,
        max_age=600,
        httponly=True,
        secure=_cookies_secure(),
        samesite="lax",
        path=_SF_STATE_PATH,
    )
    return redirect


@router.get("/oauth/callback")
async def salesforce_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    sf_nonce: str | None = Cookie(None, alias=_SF_STATE_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    """Handle Salesforce's redirect back: verify state, store the tokens.

    Unauthenticated by design — identity comes from the signed ``state`` token
    issued by the authorize endpoint plus the double-submitted nonce cookie.
    On success the refresh token is stored encrypted and the integration is
    marked connected.
    """
    if error or not code or not state:
        return _connect_result_redirect(error or "access_denied")

    try:
        payload = decode_state(state)
    except SalesforceOAuthError as exc:
        return _connect_result_redirect(str(exc))

    # CSRF double-submit: the nonce in the signed state must match the cookie.
    expected_nonce = payload.get("nonce", "")
    if (
        not sf_nonce
        or not expected_nonce
        or not secrets.compare_digest(expected_nonce, sf_nonce)
    ):
        return _connect_result_redirect("invalid_state")

    org_id = str(payload.get("org", ""))
    integration_id = str(payload.get("int", ""))
    redirect_uri = str(payload.get("redirect_uri", ""))

    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == org_id,
            Integration.integration_type == "salesforce",
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        return _connect_result_redirect("integration_not_found")

    try:
        tokens = await exchange_code_for_tokens(
            integration, code=code, redirect_uri=redirect_uri
        )
    except SalesforceOAuthError as exc:
        return _connect_result_redirect(str(exc))
    except Exception:
        logger.warning("Salesforce token exchange raised", exc_info=True)
        return _connect_result_redirect("server_error")

    integration.set_secret("refresh_token", tokens["refresh_token"])
    access_token = tokens.get("access_token")
    if access_token:
        integration.set_secret("access_token", access_token)

    new_config = dict(integration.config or {})
    instance_url = tokens.get("instance_url")
    if instance_url:
        new_config["instance_url"] = instance_url
    integration.config = new_config
    integration.status = "connected"
    integration.enabled = True
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.oauth.connected",
        "integrations",
        "info",
        {
            "organization_id": org_id,
            "integration_id": integration_id,
            "instance_url": instance_url or new_config.get("instance_url", ""),
        },
    )

    return _connect_result_redirect(None)
