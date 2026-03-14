"""
Department Messages API Endpoints

Internal messaging for department announcements and targeted
communications. Visible on member dashboards.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import ensure_found
from app.models.user import User
from app.services.messaging_service import MessagingService

router = APIRouter()


# ============================================
# Pydantic Schemas
# ============================================


class MessageCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    priority: str = Field(default="normal")
    target_type: str = Field(default="all")
    target_roles: list[str] | None = None
    target_statuses: list[str] | None = None
    target_member_ids: list[str] | None = None
    is_pinned: bool = False
    requires_acknowledgment: bool = False
    expires_at: datetime | None = None


class MessageUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    priority: str | None = None
    target_type: str | None = None
    target_roles: list[str] | None = None
    target_statuses: list[str] | None = None
    target_member_ids: list[str] | None = None
    is_pinned: bool | None = None
    is_active: bool | None = None
    requires_acknowledgment: bool | None = None
    expires_at: datetime | None = None


class MessageResponse(BaseModel):
    id: str
    organization_id: str
    title: str
    body: str
    priority: str
    target_type: str
    target_roles: list[str] | None = None
    target_statuses: list[str] | None = None
    target_member_ids: list[str] | None = None
    is_pinned: bool
    is_active: bool
    requires_acknowledgment: bool
    posted_by: str | None = None
    expires_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    class Config:
        from_attributes = True


class InboxMessage(BaseModel):
    id: str
    title: str
    body: str
    priority: str
    target_type: str
    is_pinned: bool
    requires_acknowledgment: bool
    posted_by: str | None = None
    author_name: str | None = None
    created_at: str | None = None
    expires_at: str | None = None
    is_read: bool
    read_at: str | None = None
    is_acknowledged: bool
    acknowledged_at: str | None = None


class MessageStatsResponse(BaseModel):
    message_id: str
    total_reads: int
    total_acknowledged: int


class RoleOption(BaseModel):
    name: str
    slug: str


def _serialize_message(msg) -> dict:
    """Convert a DepartmentMessage ORM object to a response dict"""
    return {
        "id": msg.id,
        "organization_id": msg.organization_id,
        "title": msg.title,
        "body": msg.body,
        "priority": (
            msg.priority.value if hasattr(msg.priority, "value") else str(msg.priority)
        ),
        "target_type": (
            msg.target_type.value
            if hasattr(msg.target_type, "value")
            else str(msg.target_type)
        ),
        "target_roles": msg.target_roles,
        "target_statuses": msg.target_statuses,
        "target_member_ids": msg.target_member_ids,
        "is_pinned": msg.is_pinned,
        "is_active": msg.is_active,
        "requires_acknowledgment": msg.requires_acknowledgment,
        "posted_by": msg.posted_by,
        "expires_at": msg.expires_at.isoformat() if msg.expires_at else None,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "updated_at": msg.updated_at.isoformat() if msg.updated_at else None,
    }


# ============================================
# Admin CRUD Endpoints
# ============================================


@router.get("", response_model=dict)
async def list_messages(
    include_inactive: bool = Query(False),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """List all department messages (admin view)"""
    service = MessagingService(db)
    messages, total = await service.get_messages(
        organization_id=current_user.organization_id,
        include_inactive=include_inactive,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {
        "messages": [_serialize_message(m) for m in messages],
        "total": total,
    }


@router.post("", status_code=status.HTTP_201_CREATED, response_model=MessageResponse)
async def create_message(
    data: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Create a new department message/announcement"""
    service = MessagingService(db)
    message, error = await service.create_message(
        organization_id=current_user.organization_id,
        posted_by=current_user.id,
        title=data.title,
        body=data.body,
        priority=data.priority,
        target_type=data.target_type,
        target_roles=data.target_roles,
        target_statuses=data.target_statuses,
        target_member_ids=data.target_member_ids,
        is_pinned=data.is_pinned,
        requires_acknowledgment=data.requires_acknowledgment,
        expires_at=data.expires_at,
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    return _serialize_message(message)


@router.get("/roles", response_model=list[RoleOption])
async def get_available_roles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Get list of roles available for targeting"""
    service = MessagingService(db)
    return await service.get_available_roles(current_user.organization_id)


@router.get("/inbox", response_model=list[InboxMessage])
async def get_inbox(
    include_read: bool = Query(True),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get messages for the current user's inbox (filtered by targeting)"""
    service = MessagingService(db)
    return await service.get_inbox(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        include_read=include_read,
        skip=pagination.skip,
        limit=pagination.limit,
    )


@router.get("/inbox/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get count of unread messages for the current user"""
    service = MessagingService(db)
    count = await service.get_unread_count(
        organization_id=current_user.organization_id,
        user_id=current_user.id,
    )
    return {"unread_count": count}


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Get a specific message (admin view)"""
    service = MessagingService(db)
    message = ensure_found(
        await service.get_message_by_id(message_id, current_user.organization_id),
        "Message",
    )
    return _serialize_message(message)


@router.patch("/{message_id}", response_model=MessageResponse)
async def update_message(
    message_id: str,
    data: MessageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Update a department message"""
    service = MessagingService(db)
    updates = data.model_dump(exclude_unset=True)
    message, error = await service.update_message(
        message_id, current_user.organization_id, updates
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    return _serialize_message(message)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Delete a department message"""
    service = MessagingService(db)
    success, error = await service.delete_message(
        message_id, current_user.organization_id
    )
    if not success:
        raise HTTPException(status_code=400, detail=error)


@router.post("/{message_id}/read")
async def mark_as_read(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a message as read by the current user"""
    service = MessagingService(db)
    success, error = await service.mark_as_read(message_id, current_user.id)
    if not success:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "ok"}


@router.post("/{message_id}/acknowledge")
async def acknowledge_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acknowledge a message (for messages requiring acknowledgment)"""
    service = MessagingService(db)
    success, error = await service.acknowledge_message(message_id, current_user.id)
    if not success:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "ok"}


@router.get("/{message_id}/stats", response_model=MessageStatsResponse)
async def get_message_stats(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Get read/acknowledge statistics for a message"""
    service = MessagingService(db)
    stats = await service.get_message_stats(message_id, current_user.organization_id)
    if "error" in stats:
        raise HTTPException(status_code=404, detail=stats["error"])
    return stats
