"""
Notifications API Endpoints

Endpoints for notification management including rules,
logs, and preferences.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.config import settings
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.notifications import (
    NotificationLogResponse,
    NotificationLogsListResponse,
    NotificationRuleCreate,
    NotificationRuleResponse,
    NotificationRulesListResponse,
    NotificationRuleUpdate,
    NotificationsSummary,
    PushConfigResponse,
    PushSubscriptionCreate,
    PushSubscriptionResponse,
    PushUnsubscribeRequest,
)
from app.services.notifications_service import NotificationsService
from app.services.push_service import PushService

router = APIRouter()


# ============================================
# Rule Endpoints
# ============================================


@router.get("/rules", response_model=NotificationRulesListResponse)
async def list_rules(
    category: str | None = None,
    enabled: bool | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """List all notification rules for the organization"""
    service = NotificationsService(db)
    rules = await service.get_rules(
        current_user.organization_id,
        category=category,
        enabled=enabled,
        search=search,
    )
    return {
        "rules": rules,
        "total": len(rules),
    }


@router.post(
    "/rules",
    response_model=NotificationRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_rule(
    rule: NotificationRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Create a new notification rule"""
    service = NotificationsService(db)
    rule_data = rule.model_dump(exclude_none=True)
    result, error = await service.create_rule(
        current_user.organization_id, rule_data, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to create notification rule. {error}"
        )
    return result


@router.get("/rules/{rule_id}", response_model=NotificationRuleResponse)
async def get_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """Get a notification rule by ID"""
    service = NotificationsService(db)
    rule = await service.get_rule_by_id(rule_id, current_user.organization_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Notification rule not found")
    return rule


@router.patch("/rules/{rule_id}", response_model=NotificationRuleResponse)
async def update_rule(
    rule_id: UUID,
    rule: NotificationRuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Update a notification rule"""
    service = NotificationsService(db)
    update_data = rule.model_dump(exclude_none=True)
    result, error = await service.update_rule(
        rule_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to update notification rule. {error}"
        )
    return result


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Delete a notification rule"""
    service = NotificationsService(db)
    success, error = await service.delete_rule(rule_id, current_user.organization_id)
    if not success:
        raise HTTPException(
            status_code=400, detail=f"Unable to delete notification rule. {error}"
        )


@router.post("/rules/{rule_id}/toggle", response_model=NotificationRuleResponse)
async def toggle_rule(
    rule_id: UUID,
    enabled: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Toggle a notification rule on/off"""
    service = NotificationsService(db)
    result, error = await service.toggle_rule(
        rule_id, current_user.organization_id, enabled
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to toggle notification rule. {error}"
        )
    return result


# ============================================
# Notification Log Endpoints
# ============================================


@router.get("/logs", response_model=NotificationLogsListResponse)
async def list_logs(
    channel: str | None = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """List notification logs"""
    service = NotificationsService(db)
    logs, total = await service.get_logs(
        current_user.organization_id,
        channel=channel,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {
        "logs": logs,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.post("/logs/read-all")
async def mark_all_logs_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Mark all notification logs as read for the organization."""
    service = NotificationsService(db)
    count = await service.mark_all_logs_read(current_user.organization_id)
    return {"marked_read": count}


@router.post("/logs/{log_id}/read", response_model=NotificationLogResponse)
async def mark_notification_read(
    log_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Mark any organization notification log as read (admin log view).

    Requires ``notifications.manage`` — this is an org-wide write over any
    recipient's log, so it matches the ``/logs/read-all`` gate rather than the
    read-only ``notifications.view``. Members mark their own notifications via
    the ``/my/{log_id}/read`` route (recipient-scoped).
    """
    service = NotificationsService(db)
    result, error = await service.mark_as_read(log_id, current_user.organization_id)
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to mark notification as read. {error}"
        )
    return result


# ============================================
# User-Facing Notification Inbox
# ============================================


@router.get("/my", response_model=NotificationLogsListResponse)
async def get_my_notifications(
    include_expired: bool = Query(
        False, description="Include expired notifications (for history view)"
    ),
    include_read: bool = Query(True, description="Include read notifications"),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current user's in-app notifications.

    By default, hides expired notifications (e.g., event reminders 24 hours
    after the event). Set include_expired=true for the full history.
    """
    service = NotificationsService(db)
    logs, total = await service.get_user_notifications(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        include_expired=include_expired,
        include_read=include_read,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {
        "logs": logs,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.get("/my/unread-count")
async def get_my_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get count of unread, non-expired in-app notifications for the current user."""
    service = NotificationsService(db)
    count = await service.get_user_unread_count(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
    )
    return {"unread_count": count}


@router.post("/my/read-all")
async def mark_all_my_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark all of the current user's unread in-app notifications as read."""
    service = NotificationsService(db)
    count = await service.mark_all_user_notifications_read(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
    )
    return {"marked_read": count}


@router.post("/my/{log_id}/read", response_model=NotificationLogResponse)
async def mark_my_notification_read(
    log_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark one of the current user's notifications as read."""
    service = NotificationsService(db)
    result, error = await service.mark_as_read(
        log_id, current_user.organization_id, current_user.id
    )
    if error:
        raise HTTPException(
            status_code=400, detail=f"Unable to mark notification as read. {error}"
        )
    return result


@router.post("/my/{log_id}/pin", response_model=NotificationLogResponse)
async def toggle_my_notification_pin(
    log_id: UUID,
    pinned: bool = Query(..., description="Pin (true) or unpin (false)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pin or unpin one of the current user's notifications."""
    service = NotificationsService(db)
    result, error = await service.toggle_pin(
        log_id, current_user.organization_id, current_user.id, pinned
    )
    if error:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to update notification pin state. {error}",
        )
    return result


# ============================================
# Summary Endpoint
# ============================================


@router.get("/summary", response_model=NotificationsSummary)
async def get_notifications_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """Get notifications module summary statistics"""
    service = NotificationsService(db)
    return await service.get_summary(current_user.organization_id)


# ============================================
# Web Push Subscriptions
# ============================================


@router.get("/push/config", response_model=PushConfigResponse)
async def get_push_config(
    current_user: User = Depends(get_current_user),
) -> PushConfigResponse:
    """Whether this deployment can send push, and the VAPID public key.

    Any authenticated member may read this: the public key is public by
    definition, and the client needs it before it can subscribe.
    """
    if not PushService.is_configured():
        return PushConfigResponse(enabled=False, public_key=None)
    return PushConfigResponse(
        enabled=True, public_key=settings.VAPID_PUBLIC_KEY
    )


@router.post(
    "/push/subscribe",
    response_model=PushSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def subscribe_to_push(
    payload: PushSubscriptionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PushSubscriptionResponse:
    """Register the caller's browser for push.

    Scoped to the caller — a member registers their own device and cannot
    subscribe on someone else's behalf, so there is no id in the payload.
    """
    if not PushService.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured on this server.",
        )
    service = PushService(db)
    try:
        sub = await service.subscribe(
            organization_id=current_user.organization_id,
            user_id=current_user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=request.headers.get("user-agent", "")[:500] or None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))

    await log_audit_event(
        db,
        user_id=current_user.id,
        organization_id=current_user.organization_id,
        action="push_subscription.create",
        resource_type="push_subscription",
        resource_id=str(sub.id),
    )
    return PushSubscriptionResponse(id=str(sub.id), endpoint=sub.endpoint)


@router.post("/push/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_from_push(
    payload: PushUnsubscribeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Drop a device endpoint. Org-scoped, so a known endpoint belonging to
    another tenant cannot be deleted by submitting it here."""
    service = PushService(db)
    try:
        await service.unsubscribe(
            organization_id=current_user.organization_id,
            endpoint=payload.endpoint,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
