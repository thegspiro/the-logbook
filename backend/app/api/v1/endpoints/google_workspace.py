"""
Google Workspace account endpoints, per member.

Status and retry for the account The Logbook created (or tried to) when a
member was converted from an applicant. Both require ``members.manage``: the
retry can reset the password of an account nobody has yet received, and
emails the new one to the member. Every lookup is scoped to the caller's
organization in the service.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_all_permissions, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.security_middleware import check_rate_limit, get_client_ip
from app.models.google_workspace import GoogleAccountProvision
from app.models.user import User
from app.schemas.google_workspace import (
    AttentionItemResponse,
    AttentionResponse,
    GoogleAccountEnvelope,
    GoogleAccountResponse,
    LinkExistingResponse,
)
from app.services.google_workspace_provisioning_service import (
    GoogleWorkspaceProvisioningService,
    ProvisionRetryError,
    ProvisionRetryTooSoon,
)

router = APIRouter()


def _to_response(row: Optional[GoogleAccountProvision]) -> GoogleAccountEnvelope:
    if row is None:
        return GoogleAccountEnvelope(account=None)
    return GoogleAccountEnvelope(
        account=GoogleAccountResponse(
            user_id=row.user_id,
            primary_email=row.primary_email,
            status=row.status,
            credentials_sent=bool(row.credentials_sent),
            pending_groups=[str(g) for g in (row.pending_groups or [])],
            last_error=row.last_error,
            attempts=row.attempts or 0,
            last_attempt_at=row.last_attempt_at,
            created_at=row.created_at,
            suspension_wanted=bool(row.suspension_wanted),
            suspension_settled=bool(row.suspension_settled),
            suspended_by_logbook=bool(row.suspended_by_logbook),
            suspended_at=row.suspended_at,
            suspension_error=row.suspension_error,
        )
    )


@router.get("/members/{user_id}", response_model=GoogleAccountEnvelope)
async def get_member_google_account(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """The member's Google Workspace account record, or ``account: null``.

    **Requires permission: members.manage**
    """
    row = await GoogleWorkspaceProvisioningService(db).get_for_user(
        str(user_id), str(current_user.organization_id)
    )
    return _to_response(row)


@router.post("/members/{user_id}/retry", response_model=GoogleAccountEnvelope)
async def retry_member_google_account(
    user_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """Finish whatever is incomplete about the member's Google account.

    Brings an unsettled suspension into line first (suspend after a departure,
    unsuspend after a return). Otherwise creates a failed or pending account
    -- refused (409) for a member who has left -- and for a created one
    re-adds failed groups and, if the password never reached the member,
    resets it and emails a new one. A linked existing account with nothing to
    reconcile is refused (409). One run a minute per member (429).

    **Requires permission: members.manage**
    """
    await check_rate_limit(
        request,
        max_requests=10,
        window_seconds=60,
        lockout_seconds=300,
        scope="google_workspace_retry",
    )
    service = GoogleWorkspaceProvisioningService(db)
    organization_id = str(current_user.organization_id)
    try:
        row = await service.retry(str(user_id), organization_id)
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Google Workspace account record for this member",
        )
    except ProvisionRetryTooSoon as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": "60"},
        )
    except ProvisionRetryError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    await log_audit_event(
        db,
        "google_workspace.account_retry",
        "integrations",
        "warning",
        {"target_user_id": str(user_id), "status": row.status},
        user_id=str(current_user.id),
        organization_id=organization_id,
        ip_address=get_client_ip(request),
    )
    await db.commit()
    return _to_response(row)


@router.get("/attention", response_model=AttentionResponse)
async def list_attention(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Accounts in this department that need a person to act: a departure's
    suspension Google has not taken, a return's unsuspension, an account never
    created, or one left unfinished. Read only; nothing in Google is called.

    **Requires permission: integrations.manage**
    """
    items = await GoogleWorkspaceProvisioningService(db).attention_items(
        str(current_user.organization_id)
    )
    return AttentionResponse(
        items=[
            AttentionItemResponse(
                user_id=i.user_id,
                member_name=i.member_name,
                primary_email=i.primary_email,
                issue=i.issue,
                label=i.label,
                detail=i.detail,
                since=i.since,
                overdue=i.overdue,
            )
            for i in items
        ]
    )


@router.post("/link-existing", response_model=LinkExistingResponse)
async def link_existing_members(
    request: Request,
    apply: bool = Query(False, description="False previews the counts only"),
    expected: Optional[int] = Query(
        None,
        ge=0,
        description="The linked count the officer confirmed; an applied run "
        "that would link a different number writes nothing",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_all_permissions("integrations.manage", "admin.access")
    ),
):
    """Link current members to the Google accounts already at their addresses.

    A member whose Logbook email is exactly an account's primary address gets
    an "existing account" record, so leaving suspends it. Google is only read.
    Members who have already left are counted, not linked. Pass the previewed
    count as ``expected`` when applying, so a roster that changed in between
    is refused rather than linked unseen. Organization
    administrators only, like connecting the integration, since a linked
    account is one The Logbook will later suspend.

    **Requires permissions: integrations.manage and admin.access**
    """
    # Each run from the screen is two calls (preview, then apply), and an
    # officer may preview, decline and look again; this bounds directory
    # listings without locking an administrator out of a second look.
    await check_rate_limit(
        request,
        max_requests=20,
        window_seconds=60,
        lockout_seconds=300,
        scope="google_workspace_link_existing",
    )
    organization_id = str(current_user.organization_id)
    try:
        counts = await GoogleWorkspaceProvisioningService(db).link_existing_members(
            organization_id,
            apply=apply,
            actor_id=str(current_user.id),
            expected=expected,
        )
    except ProvisionRetryError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    if apply:
        await log_audit_event(
            db,
            "google_workspace.existing_members_linked",
            "integrations",
            "warning",
            dict(counts),
            user_id=str(current_user.id),
            organization_id=organization_id,
            ip_address=get_client_ip(request),
        )
        await db.commit()
    return LinkExistingResponse(applied=apply, **counts)
