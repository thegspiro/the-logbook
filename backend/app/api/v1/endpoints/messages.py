"""
Department Messages API Endpoints

Internal messaging for department announcements and targeted
communications. Visible on member dashboards.
"""

from datetime import datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found
from app.models.notification import MessagePriority, MessageTargetType
from app.models.user import User
from app.services.message_delivery_service import deliver_department_message
from app.services.messaging_service import MessagingService

router = APIRouter()


# ============================================
# Pydantic Schemas
# ============================================


class MessageCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1, max_length=20000)
    # Typed as enums so an invalid priority/target_type is rejected with a 422
    # at the schema layer rather than surfacing as a raw ValueError from the
    # service.
    priority: MessagePriority = MessagePriority.NORMAL
    target_type: MessageTargetType = MessageTargetType.ALL
    target_roles: list[str] | None = None
    target_statuses: list[str] | None = None
    target_member_ids: list[str] | None = None
    is_pinned: bool = False
    is_persistent: bool = False
    requires_acknowledgment: bool = False
    expires_at: datetime | None = None


class MessageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = Field(default=None, min_length=1, max_length=20000)
    priority: MessagePriority | None = None
    target_type: MessageTargetType | None = None
    target_roles: list[str] | None = None
    target_statuses: list[str] | None = None
    target_member_ids: list[str] | None = None
    is_pinned: bool | None = None
    is_active: bool | None = None
    is_persistent: bool | None = None
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
    is_persistent: bool
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
    is_persistent: bool
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
    total_targeted: int
    total_reads: int
    total_acknowledged: int


class AckReportRecipient(BaseModel):
    user_id: str
    name: str
    status: str | None = None
    is_read: bool
    read_at: str | None = None
    is_acknowledged: bool
    acknowledged_at: str | None = None


class AckReportResponse(BaseModel):
    message_id: str
    requires_acknowledgment: bool
    total_targeted: int
    total_read: int
    total_acknowledged: int
    recipients: list[AckReportRecipient]


class RoleOption(BaseModel):
    id: str
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
        "is_persistent": msg.is_persistent,
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
    search: str | None = Query(None),
    priority: MessagePriority | None = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """List all department messages (admin view)"""
    service = MessagingService(db)
    messages, total = await service.get_messages(
        organization_id=current_user.organization_id,
        include_inactive=include_inactive,
        search=search,
        priority=priority.value if priority else None,
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
    background_tasks: BackgroundTasks,
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
        is_persistent=data.is_persistent,
        requires_acknowledgment=data.requires_acknowledgment,
        expires_at=data.expires_at,
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    await log_audit_event(
        db=db,
        event_type="message_created",
        event_category="messages",
        severity="info",
        event_data={
            "message_title": data.title,
            "target_type": data.target_type.value,
            "priority": data.priority.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    # Fan the message out to the channels members actually watch (bell inbox,
    # plus email/SMS escalation for urgent/ack-required). Deferred so the POST
    # returns immediately; failures there never affect the created message.
    background_tasks.add_task(
        deliver_department_message, message.id, current_user.organization_id
    )
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
    await log_audit_event(
        db=db,
        event_type="message_updated",
        event_category="messages",
        severity="info",
        event_data={
            "message_id": message_id,
            "fields": sorted(updates.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
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
    await log_audit_event(
        db=db,
        event_type="message_deleted",
        event_category="messages",
        severity="warning",
        event_data={"message_id": message_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post("/{message_id}/read")
async def mark_as_read(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a message as read by the current user"""
    service = MessagingService(db)
    success, error = await service.mark_as_read(
        message_id, current_user.id, current_user.organization_id
    )
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
    success, error = await service.acknowledge_message(
        message_id, current_user.id, current_user.organization_id
    )
    if not success:
        raise HTTPException(status_code=400, detail=error)
    # Acknowledgments are treated as compliance evidence, so record who
    # acknowledged what and when in the audit trail.
    await log_audit_event(
        db=db,
        event_type="message_acknowledged",
        event_category="messages",
        severity="info",
        event_data={"message_id": message_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
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


@router.get("/{message_id}/acknowledgments", response_model=AckReportResponse)
async def get_acknowledgment_report(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("notifications.manage")),
):
    """Per-recipient read/acknowledgment breakdown for a message.

    Lets leadership see exactly who has and has not acknowledged an
    acknowledgment-required notice (e.g. an SOP change).
    """
    service = MessagingService(db)
    report = await service.get_acknowledgment_report(
        message_id, current_user.organization_id
    )
    if report is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return report
