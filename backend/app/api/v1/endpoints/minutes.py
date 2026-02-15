"""
Meeting Minutes API Endpoints

Endpoints for meeting minutes management including CRUD, approval workflow,
motions, action items, and full-text search.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.user import User
from app.schemas.minute import (
    MinutesCreate,
    MinutesUpdate,
    MinutesResponse,
    MinutesListItem,
    MinutesSubmit,
    MinutesApprove,
    MinutesReject,
    MinutesSearchResult,
    MotionCreate,
    MotionUpdate,
    MotionResponse,
    ActionItemCreate,
    ActionItemUpdate,
    ActionItemResponse,
    SectionEntry,
    TemplateCreate,
    TemplateUpdate,
    TemplateResponse,
    TemplateListItem,
    TemplateSectionEntry,
)
from app.schemas.document import DocumentResponse
from app.services.minute_service import MinuteService
from app.services.template_service import TemplateService
from app.services.document_service import DocumentService
from app.api.dependencies import get_current_user, require_permission

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================
# Meeting Minutes CRUD
# ============================================

@router.get("", response_model=List[MinutesListItem])
async def list_minutes(
    meeting_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,  # max 100 enforced below
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    List meeting minutes with optional filtering

    **Authentication required**
    **Requires permission: meetings.view**
    """
    service = MinuteService(db)
    minutes_list = await service.list_minutes(
        organization_id=current_user.organization_id,
        meeting_type=meeting_type,
        status=status_filter,
        search=search,
        skip=skip,
        limit=min(limit, 100),
    )

    return [
        MinutesListItem(
            id=m.id,
            title=m.title,
            meeting_type=m.meeting_type if isinstance(m.meeting_type, str) else m.meeting_type.value,
            meeting_date=m.meeting_date,
            status=m.status if isinstance(m.status, str) else m.status.value,
            location=m.location,
            called_by=m.called_by,
            motions_count=len(m.motions) if m.motions else 0,
            action_items_count=len(m.action_items) if m.action_items else 0,
            open_action_items=sum(
                1 for a in (m.action_items or [])
                if (a.status if isinstance(a.status, str) else a.status.value) in ("pending", "in_progress", "overdue")
            ),
            created_at=m.created_at,
        )
        for m in minutes_list
    ]


@router.get("/stats")
async def get_minutes_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Get aggregate stats for the minutes dashboard

    **Authentication required**
    **Requires permission: meetings.view**
    """
    service = MinuteService(db)
    return await service.get_stats(current_user.organization_id)


@router.get("/search", response_model=List[MinutesSearchResult])
async def search_minutes(
    q: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Full-text search across meeting minutes

    **Authentication required**
    **Requires permission: meetings.view**
    """
    if len(q.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Search query must be at least 2 characters"
        )

    service = MinuteService(db)
    return await service.search_minutes(
        organization_id=current_user.organization_id,
        query=q.strip(),
        limit=min(limit, 50),
    )


@router.get("/{minutes_id}", response_model=MinutesResponse)
async def get_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Get a single meeting minutes record with motions and action items

    **Authentication required**
    **Requires permission: meetings.view**
    """
    service = MinuteService(db)
    minutes = await service.get_minutes(minutes_id, current_user.organization_id)

    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    return _build_response(minutes)


@router.post("", response_model=MinutesResponse, status_code=status.HTTP_201_CREATED)
async def create_minutes(
    data: MinutesCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Create new meeting minutes

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)
    minutes = await service.create_minutes(
        data=data,
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )

    logger.info(f"Minutes created | id={minutes.id} title={minutes.title!r} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_created",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes.id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    return _build_response(minutes)


@router.put("/{minutes_id}", response_model=MinutesResponse)
async def update_minutes(
    minutes_id: str,
    data: MinutesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Update meeting minutes (only draft or rejected)

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)

    try:
        minutes = await service.update_minutes(minutes_id, current_user.organization_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    logger.info(f"Minutes updated | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_updated",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id},
        user_id=str(current_user.id),
    )

    return _build_response(minutes)


@router.delete("/{minutes_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Delete meeting minutes (only drafts)

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)

    try:
        deleted = await service.delete_minutes(minutes_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    logger.info(f"Minutes deleted | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_deleted",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id},
        user_id=str(current_user.id),
    )


# ============================================
# Approval Workflow
# ============================================

@router.post("/{minutes_id}/submit", response_model=MinutesResponse)
async def submit_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Submit meeting minutes for approval

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)

    try:
        minutes = await service.submit_for_approval(
            minutes_id, current_user.organization_id, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    logger.info(f"Minutes submitted for approval | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_submitted",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    return _build_response(minutes)


@router.post("/{minutes_id}/approve", response_model=MinutesResponse)
async def approve_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Approve submitted meeting minutes

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)

    try:
        minutes = await service.approve_minutes(
            minutes_id, current_user.organization_id, current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    logger.info(f"Minutes approved | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_approved",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    return _build_response(minutes)


@router.post("/{minutes_id}/reject", response_model=MinutesResponse)
async def reject_minutes(
    minutes_id: str,
    data: MinutesReject,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Reject submitted meeting minutes with a reason

    **Authentication required**
    **Requires permission: meetings.manage**
    """
    service = MinuteService(db)

    try:
        minutes = await service.reject_minutes(
            minutes_id, current_user.organization_id, current_user.id, data.reason
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting minutes not found"
        )

    logger.info(f"Minutes rejected | id={minutes_id} by={current_user.id} reason={data.reason!r}")
    await log_audit_event(
        db=db,
        event_type="minutes_rejected",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "title": minutes.title, "reason": data.reason},
        user_id=str(current_user.id),
    )

    return _build_response(minutes)


# ============================================
# Motion Endpoints
# ============================================

@router.post("/{minutes_id}/motions", response_model=MotionResponse, status_code=status.HTTP_201_CREATED)
async def add_motion(
    minutes_id: str,
    data: MotionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Add a motion to meeting minutes"""
    service = MinuteService(db)

    try:
        motion = await service.add_motion(minutes_id, current_user.organization_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not motion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting minutes not found")

    return _build_motion_response(motion)


@router.put("/{minutes_id}/motions/{motion_id}", response_model=MotionResponse)
async def update_motion(
    minutes_id: str,
    motion_id: str,
    data: MotionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Update a motion"""
    service = MinuteService(db)

    try:
        motion = await service.update_motion(motion_id, minutes_id, current_user.organization_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not motion:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motion not found")

    return _build_motion_response(motion)


@router.delete("/{minutes_id}/motions/{motion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_motion(
    minutes_id: str,
    motion_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Delete a motion"""
    service = MinuteService(db)

    try:
        deleted = await service.delete_motion(motion_id, minutes_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Motion not found")


# ============================================
# Action Item Endpoints
# ============================================

@router.post("/{minutes_id}/action-items", response_model=ActionItemResponse, status_code=status.HTTP_201_CREATED)
async def add_action_item(
    minutes_id: str,
    data: ActionItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Add an action item to meeting minutes"""
    service = MinuteService(db)

    try:
        item = await service.add_action_item(minutes_id, current_user.organization_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting minutes not found")

    return _build_action_item_response(item)


@router.put("/{minutes_id}/action-items/{item_id}", response_model=ActionItemResponse)
async def update_action_item(
    minutes_id: str,
    item_id: str,
    data: ActionItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Update an action item (status can be updated even on approved minutes)"""
    service = MinuteService(db)

    try:
        item = await service.update_action_item(item_id, minutes_id, current_user.organization_id, data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action item not found")

    return _build_action_item_response(item)


@router.delete("/{minutes_id}/action-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_action_item(
    minutes_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Delete an action item"""
    service = MinuteService(db)

    try:
        deleted = await service.delete_action_item(item_id, minutes_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action item not found")


# ============================================
# Publish Minutes
# ============================================

@router.post("/{minutes_id}/publish", response_model=DocumentResponse)
async def publish_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Publish approved minutes as a formatted document in the Meeting Minutes folder."""
    minute_service = MinuteService(db)
    minutes = await minute_service.get_minutes(minutes_id, current_user.organization_id)
    if not minutes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Minutes not found")

    doc_service = DocumentService(db)
    try:
        doc = await doc_service.publish_minutes(minutes, current_user.organization_id, current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    await log_audit_event(
        db=db,
        event_type="minutes_published",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "document_id": doc.id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    dt = doc.document_type
    tags_list = doc.tags.split(",") if doc.tags else None
    return DocumentResponse(
        id=doc.id,
        organization_id=doc.organization_id,
        folder_id=doc.folder_id,
        title=doc.name,
        description=doc.description,
        document_type=dt if isinstance(dt, str) else dt.value,
        content_html=doc.content_html,
        mime_type=doc.file_type,
        source_type=doc.source_type,
        source_id=doc.source_id,
        tags=tags_list,
        created_by=doc.uploaded_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# ============================================
# Templates
# ============================================

@router.get("/templates", response_model=List[TemplateListItem])
async def list_templates(
    meeting_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """List available minutes templates"""
    service = TemplateService(db)
    templates = await service.list_templates(current_user.organization_id, meeting_type)
    if not templates:
        templates = await service.initialize_defaults(current_user.organization_id, current_user.id)

    return [
        TemplateListItem(
            id=t.id,
            name=t.name,
            meeting_type=t.meeting_type if isinstance(t.meeting_type, str) else t.meeting_type.value,
            is_default=t.is_default,
            section_count=len(t.sections) if t.sections else 0,
            created_at=t.created_at,
        )
        for t in templates
    ]


@router.get("/templates/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """Get a template by ID"""
    service = TemplateService(db)
    tpl = await service.get_template(template_id, current_user.organization_id)
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return _build_template_response(tpl)


@router.post("/templates", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    data: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Create a new minutes template"""
    service = TemplateService(db)
    tpl = await service.create_template(data, current_user.organization_id, current_user.id)
    await log_audit_event(
        db=db, event_type="template_created", event_category="meetings", severity="info",
        event_data={"template_id": tpl.id, "name": tpl.name},
        user_id=str(current_user.id),
    )
    return _build_template_response(tpl)


@router.put("/templates/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: str,
    data: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Update a minutes template"""
    service = TemplateService(db)
    tpl = await service.update_template(template_id, current_user.organization_id, data)
    if not tpl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await log_audit_event(
        db=db, event_type="template_updated", event_category="meetings", severity="info",
        event_data={"template_id": tpl.id, "name": tpl.name},
        user_id=str(current_user.id),
    )
    return _build_template_response(tpl)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Delete a minutes template"""
    service = TemplateService(db)
    deleted = await service.delete_template(template_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await log_audit_event(
        db=db, event_type="template_deleted", event_category="meetings", severity="warning",
        event_data={"template_id": template_id},
        user_id=str(current_user.id),
    )


# ============================================
# Response Builders
# ============================================

def _build_template_response(tpl) -> TemplateResponse:
    """Build a TemplateResponse from a MinutesTemplate model"""
    sections = [
        TemplateSectionEntry(
            order=s.get("order", 0), key=s.get("key", ""), title=s.get("title", ""),
            default_content=s.get("default_content", ""), required=s.get("required", False),
        )
        for s in (tpl.sections or [])
    ]
    return TemplateResponse(
        id=tpl.id, organization_id=tpl.organization_id, name=tpl.name,
        description=tpl.description,
        meeting_type=tpl.meeting_type if isinstance(tpl.meeting_type, str) else tpl.meeting_type.value,
        is_default=tpl.is_default, sections=sections,
        header_config=tpl.header_config, footer_config=tpl.footer_config,
        created_by=tpl.created_by, created_at=tpl.created_at, updated_at=tpl.updated_at,
    )


def _build_response(minutes) -> MinutesResponse:
    """Build a MinutesResponse from a MeetingMinutes model"""
    # Build sections from the model's get_sections() helper (dynamic or legacy)
    raw_sections = minutes.get_sections() if hasattr(minutes, 'get_sections') else (minutes.sections or [])
    sections = [
        SectionEntry(
            order=s.get("order", 0),
            key=s.get("key", ""),
            title=s.get("title", ""),
            content=s.get("content", ""),
        )
        for s in raw_sections
    ]

    return MinutesResponse(
        id=minutes.id,
        organization_id=minutes.organization_id,
        title=minutes.title,
        meeting_type=minutes.meeting_type if isinstance(minutes.meeting_type, str) else minutes.meeting_type.value,
        meeting_date=minutes.meeting_date,
        location=minutes.location,
        called_by=minutes.called_by,
        called_to_order_at=minutes.called_to_order_at,
        adjourned_at=minutes.adjourned_at,
        attendees=minutes.attendees,
        quorum_met=minutes.quorum_met,
        quorum_count=minutes.quorum_count,
        event_id=minutes.event_id,
        template_id=minutes.template_id,
        sections=sections,
        header_config=minutes.get_effective_header() if hasattr(minutes, 'get_effective_header') else minutes.header_config,
        footer_config=minutes.get_effective_footer() if hasattr(minutes, 'get_effective_footer') else minutes.footer_config,
        published_document_id=minutes.published_document_id,
        status=minutes.status if isinstance(minutes.status, str) else minutes.status.value,
        submitted_at=minutes.submitted_at,
        submitted_by=minutes.submitted_by,
        approved_at=minutes.approved_at,
        approved_by=minutes.approved_by,
        rejected_at=minutes.rejected_at,
        rejected_by=minutes.rejected_by,
        rejection_reason=minutes.rejection_reason,
        created_by=minutes.created_by,
        created_at=minutes.created_at,
        updated_at=minutes.updated_at,
        motions=[_build_motion_response(m) for m in (minutes.motions or [])],
        action_items=[_build_action_item_response(a) for a in (minutes.action_items or [])],
    )


def _build_motion_response(motion) -> MotionResponse:
    """Build a MotionResponse from a Motion model"""
    return MotionResponse(
        id=motion.id,
        minutes_id=motion.minutes_id,
        order=motion.order,
        motion_text=motion.motion_text,
        moved_by=motion.moved_by,
        seconded_by=motion.seconded_by,
        discussion_notes=motion.discussion_notes,
        status=motion.status if isinstance(motion.status, str) else motion.status.value,
        votes_for=motion.votes_for,
        votes_against=motion.votes_against,
        votes_abstain=motion.votes_abstain,
        created_at=motion.created_at,
        updated_at=motion.updated_at,
    )


def _build_action_item_response(item) -> ActionItemResponse:
    """Build an ActionItemResponse from an ActionItem model"""
    return ActionItemResponse(
        id=item.id,
        minutes_id=item.minutes_id,
        description=item.description,
        assignee_id=item.assignee_id,
        assignee_name=item.assignee_name,
        due_date=item.due_date,
        priority=item.priority if isinstance(item.priority, str) else item.priority.value,
        status=item.status if isinstance(item.status, str) else item.status.value,
        completed_at=item.completed_at,
        completion_notes=item.completion_notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


# ============================================
# Quorum Endpoints
# ============================================

@router.get("/{minutes_id}/quorum")
async def get_quorum_status(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Calculate and return current quorum status for a meeting.

    Quorum rules come from the organization's `settings.quorum_config`
    but can be overridden per-meeting via `quorum_type` and
    `quorum_threshold` on the meeting record.

    Requires `minutes.manage` permission.
    """
    from app.services.quorum_service import QuorumService
    service = QuorumService(db)
    result = await service.update_quorum_on_checkin(
        minutes_id, current_user.organization_id
    )
    return result


@router.patch("/{minutes_id}/quorum-config")
async def set_meeting_quorum_config(
    minutes_id: str,
    quorum_type: str,
    quorum_threshold: float,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Override the quorum configuration for a specific meeting.

    - **quorum_type**: `"count"` (absolute headcount) or `"percentage"` (of active members)
    - **quorum_threshold**: the required value (e.g. 10 for count, 50.0 for percentage)

    This is meeting-specific and does not change the org-level default.

    Requires `minutes.manage` permission.
    """
    from sqlalchemy import select as sa_select
    from app.models.minute import MeetingMinutes

    if quorum_type not in ("count", "percentage"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quorum_type must be 'count' or 'percentage'",
        )
    if quorum_threshold <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quorum_threshold must be positive",
        )

    result = await db.execute(
        sa_select(MeetingMinutes)
        .where(MeetingMinutes.id == minutes_id)
        .where(MeetingMinutes.organization_id == current_user.organization_id)
    )
    minutes = result.scalar_one_or_none()
    if not minutes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    minutes.quorum_type = quorum_type
    minutes.quorum_threshold = quorum_threshold
    await db.commit()

    # Recalculate immediately
    from app.services.quorum_service import QuorumService
    service = QuorumService(db)
    quorum_result = await service.update_quorum_on_checkin(
        minutes_id, current_user.organization_id
    )

    return {
        "success": True,
        "quorum_type": quorum_type,
        "quorum_threshold": quorum_threshold,
        **quorum_result,
    }
