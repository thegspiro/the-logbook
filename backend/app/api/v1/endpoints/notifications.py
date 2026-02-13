"""
Notifications API Endpoints

Endpoints for notification management including rules,
logs, and preferences.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.models.user import User
from app.schemas.notifications import (
    NotificationRuleCreate,
    NotificationRuleUpdate,
    NotificationRuleResponse,
    NotificationRulesListResponse,
    NotificationLogResponse,
    NotificationLogsListResponse,
    NotificationsSummary,
)
from app.services.notifications_service import NotificationsService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Rule Endpoints
# ============================================

@router.get("/rules", response_model=NotificationRulesListResponse)
async def list_rules(
    category: Optional[str] = None,
    enabled: Optional[bool] = None,
    search: Optional[str] = None,
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


@router.post("/rules", response_model=NotificationRuleResponse, status_code=status.HTTP_201_CREATED)
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
        raise HTTPException(status_code=400, detail=f"Unable to create notification rule. {error}")
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
        raise HTTPException(status_code=400, detail=f"Unable to update notification rule. {error}")
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
        raise HTTPException(status_code=400, detail=f"Unable to delete notification rule. {error}")


@router.post("/rules/{rule_id}/toggle", response_model=NotificationRuleResponse)
async def toggle_rule(
    rule_id: UUID,
    enabled: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Toggle a notification rule on/off"""
    service = NotificationsService(db)
    result, error = await service.toggle_rule(rule_id, current_user.organization_id, enabled)
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to toggle notification rule. {error}")
    return result


# ============================================
# Notification Log Endpoints
# ============================================

@router.get("/logs", response_model=NotificationLogsListResponse)
async def list_logs(
    channel: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """List notification logs"""
    service = NotificationsService(db)
    logs, total = await service.get_logs(
        current_user.organization_id,
        channel=channel,
        skip=skip,
        limit=limit,
    )
    return {
        "logs": logs,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/logs/{log_id}/read", response_model=NotificationLogResponse)
async def mark_notification_read(
    log_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.view")),
):
    """Mark a notification as read"""
    service = NotificationsService(db)
    result, error = await service.mark_as_read(log_id, current_user.organization_id)
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to mark notification as read. {error}")
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
