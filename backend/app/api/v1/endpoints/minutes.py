"""
Meeting Minutes API Endpoints

Endpoints for meeting minutes management including CRUD, approval workflow,
motions, action items, and full-text search.
"""

import math
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select as sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_active_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.document import DocumentType
from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import User
from app.schemas.documents import PublishedDocumentResponse
from app.schemas.minute import (
    ActionItemAssignee,
    ActionItemCreate,
    ActionItemResponse,
    ActionItemUpdate,
    AdoptionProposal,
    ArchiveSearchResponse,
    MinutesAdopt,
    MinutesCreate,
    MinutesListItem,
    MinutesReject,
    MinutesReminderSettingsResponse,
    MinutesReopen,
    MinutesResponse,
    MinutesSearchResult,
    MinutesUpdate,
    MotionCreate,
    MotionResponse,
    MotionUpdate,
    PublishingStatusResponse,
    SectionEntry,
    SignatureSlotResponse,
    TemplateCreate,
    TemplateListItem,
    TemplateResponse,
    TemplateSectionEntry,
    TemplateUpdate,
)
from app.services.agenda_document_access import narrow_documents
from app.services.minute_service import MinuteService
from app.services.minutes_print_data import adopting_title
from app.services.minutes_publishing_service import MinutesPublishingService
from app.services.template_service import TemplateService
from app.utils.minutes_attendance import effective_listing
from app.utils.minutes_search import parse_query
from app.utils.minutes_settings import (
    load_attendance_listing,
    load_auto_file_election_results,
    load_minutes_publishing_settings,
    load_minutes_reminder_settings,
    load_signature_slots,
)
from app.utils.motion_votes import (
    members_present,
    recorded_motions,
    suggested_status,
)
from app.utils.rich_text import normalize_format

router = APIRouter()


# ============================================
# Meeting Minutes CRUD
# ============================================


@router.get("", response_model=list[MinutesListItem])
async def list_minutes(
    meeting_type: str | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    List meeting minutes with optional filtering

    **Authentication required**
    **Requires permission: minutes.view**
    """
    # Callers without minutes.manage see only approved, non-executive minutes;
    # managers (secretaries/officers) see drafts and executive-session minutes.
    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)
    minutes_list = await service.list_minutes(
        organization_id=current_user.organization_id,
        meeting_type=meeting_type,
        status=status_filter,
        search=search,
        skip=skip,
        limit=limit,
        restricted=not can_manage,
    )

    return [
        MinutesListItem(
            id=m.id,
            title=m.title,
            meeting_type=(
                m.meeting_type
                if isinstance(m.meeting_type, str)
                else m.meeting_type.value
            ),
            meeting_date=m.meeting_date,
            status=m.status if isinstance(m.status, str) else m.status.value,
            location=m.location,
            called_by=m.called_by,
            meeting_id=m.meeting_id,
            motions_count=len(recorded_motions(m.motions)),
            action_items_count=len(m.action_items) if m.action_items else 0,
            open_action_items=sum(
                1
                for a in (m.action_items or [])
                if (a.status if isinstance(a.status, str) else a.status.value)
                in ("pending", "in_progress", "overdue")
                and a.carried_forward_at is None
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
    **Requires permission: minutes.view**
    """
    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)
    return await service.get_stats(
        current_user.organization_id, restricted=not can_manage
    )


@router.get("/settings", response_model=MinutesReminderSettingsResponse)
async def get_minutes_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    The department's action item reminder settings, as the server applies them.

    Written through `PATCH /organization/settings` (`minutes` section), which
    needs `settings.manage`.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    resolved = await load_minutes_reminder_settings(
        db, str(current_user.organization_id)
    )
    publishing = await load_minutes_publishing_settings(
        db, str(current_user.organization_id)
    )
    return MinutesReminderSettingsResponse(
        attendance_listing=await load_attendance_listing(
            db, str(current_user.organization_id)
        ),
        auto_file_election_results=await load_auto_file_election_results(
            db, str(current_user.organization_id)
        ),
        public_posting=publishing.public_posting,
        executive_library_publishing=publishing.executive_library,
        executive_public_posting=publishing.executive_public,
        executive_effective_library=publishing.library_allowed(True),
        executive_effective_public=publishing.public_allowed(True),
        action_item_reminders=resolved.reminders_enabled,
        reminder_days_before_due=resolved.days_before_due,
        overdue_repeat_days=resolved.overdue_repeat_days,
        open_items_digest=resolved.digest_enabled,
        signature_slots=[
            SignatureSlotResponse(
                key=slot.key, title=slot.title, position_slug=slot.position_slug
            )
            for slot in await load_signature_slots(
                db, str(current_user.organization_id)
            )
        ],
    )


@router.get("/search", response_model=list[MinutesSearchResult])
async def search_minutes(
    q: str,
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Full-text search across meeting minutes

    **Authentication required**
    **Requires permission: minutes.view**
    """
    if len(q.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Search query must be at least 2 characters",
        )

    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)
    return await service.search_minutes(
        organization_id=current_user.organization_id,
        query=q.strip(),
        limit=limit,
        restricted=not can_manage,
    )


@router.get("/archive-search", response_model=ArchiveSearchResponse)
async def search_archive(
    q: str = Query(..., max_length=200),
    meeting_type: str | None = None,
    limit: int = Query(25, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Search the words of the minutes archive, grouped by minutes

    Reads titles, every section, motions and action items. Callers without
    ``minutes.manage`` search only circulated or adopted, non-executive minutes.

    **Authentication required**
    **Requires permission: minutes.view**
    """
    if not parse_query(q):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter at least one word of two or more characters",
        )

    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)
    return await service.search_archive(
        organization_id=current_user.organization_id,
        query=q,
        meeting_type=meeting_type or None,
        limit=limit,
        restricted=not can_manage,
    )


# Declared above the catch-all `/{minutes_id}` on purpose: FastAPI
# matches in declaration order, so below it `/templates` resolved as an id
# and the endpoint was unreachable.
@router.get("/templates", response_model=list[TemplateListItem])
async def list_templates(
    meeting_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """List available minutes templates"""
    service = TemplateService(db)
    templates = await service.list_templates(current_user.organization_id, meeting_type)
    if not templates:
        templates = await service.initialize_defaults(
            current_user.organization_id, current_user.id
        )

    return [
        TemplateListItem(
            id=t.id,
            name=t.name,
            meeting_type=(
                t.meeting_type
                if isinstance(t.meeting_type, str)
                else t.meeting_type.value
            ),
            is_default=t.is_default,
            section_count=len(t.sections) if t.sections else 0,
            created_at=t.created_at,
        )
        for t in templates
    ]


# Above `/{minutes_id}` for the same reason as `/templates`.
@router.get("/action-item-assignees", response_model=list[ActionItemAssignee])
async def list_action_item_assignees(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    The members an action item may be assigned to: every active member

    Names and ids only — the picker on the minutes page needs nothing more,
    and its users may not hold the member-list permissions.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    return await MinuteService(db).list_assignable_members(current_user.organization_id)


@router.get("/{minutes_id}", response_model=MinutesResponse)
async def get_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """
    Get a single meeting minutes record with motions and action items

    **Authentication required**
    **Requires permission: minutes.view**
    """
    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)
    minutes = ensure_found(
        await service.get_minutes(
            minutes_id, current_user.organization_id, restricted=not can_manage
        ),
        "Meeting minutes",
    )

    return await _respond(db, current_user, minutes)


@router.post("", response_model=MinutesResponse, status_code=status.HTTP_201_CREATED)
async def create_minutes(
    data: MinutesCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Create new meeting minutes

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)
    # Wrapped like the sibling write endpoints so a service-layer ValueError —
    # an invalid template_id (MM-1) or a foreign event/assignee id (MM-4) —
    # returns a clean 400 rather than a 500.
    async with handle_service_errors("Failed to create minutes"):
        minutes = await service.create_minutes(
            data=data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )

    logger.info(
        f"Minutes created | id={minutes.id} title={minutes.title!r} by={current_user.id}"
    )
    await log_audit_event(
        db=db,
        event_type="minutes_created",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes.id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


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
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to update minutes"):
        minutes = await service.update_minutes(
            minutes_id, current_user.organization_id, data
        )

    minutes = ensure_found(minutes, "Meeting minutes")

    logger.info(f"Minutes updated | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_updated",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id},
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


@router.delete("/{minutes_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Delete meeting minutes (only drafts)

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to delete minutes"):
        deleted = await service.delete_minutes(minutes_id, current_user.organization_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meeting minutes not found"
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
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to submit minutes for approval"):
        minutes = await service.submit_for_approval(
            minutes_id, current_user.organization_id, current_user.id
        )

    minutes = ensure_found(minutes, "Meeting minutes")

    logger.info(
        f"Minutes submitted for approval | id={minutes_id} by={current_user.id}"
    )
    await log_audit_event(
        db=db,
        event_type="minutes_submitted",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "title": minutes.title},
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


@router.get(
    "/{minutes_id}/adoption-proposal", response_model=Optional[AdoptionProposal]
)
async def get_adoption_proposal(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    What a later meeting's motion decided about these minutes

    When the body accepted these minutes as submitted or as revised, the
    adoption form opens already filled in from that motion. Nothing is adopted
    until an officer other than the one who circulated them confirms it.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)
    minutes = await service.get_minutes(
        minutes_id, current_user.organization_id, load_children=False
    )
    ensure_found(minutes, "Meeting minutes")
    return await service.adoption_proposal(minutes_id, current_user.organization_id)


@router.post("/{minutes_id}/approve", response_model=MinutesResponse)
async def approve_minutes(
    minutes_id: str,
    data: Optional[MinutesAdopt] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Adopt submitted meeting minutes (the 'approved' status)

    The optional body records what the body did: the day of the vote, the
    minutes of the meeting that adopted these, and whether they were adopted as
    presented or as amended. Left out, the vote is dated now.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to approve minutes"):
        minutes = await service.approve_minutes(
            minutes_id, current_user.organization_id, current_user.id, data
        )

    minutes = ensure_found(minutes, "Meeting minutes")

    logger.info(f"Minutes approved | id={minutes_id} by={current_user.id}")
    await log_audit_event(
        db=db,
        event_type="minutes_approved",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "title": minutes.title,
            "adopted_as_amended": minutes.adopted_as_amended,
            "adopting_minutes_id": minutes.adopting_minutes_id,
        },
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


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
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to reject minutes"):
        minutes = await service.reject_minutes(
            minutes_id, current_user.organization_id, current_user.id, data.reason
        )

    minutes = ensure_found(minutes, "Meeting minutes")

    logger.info(
        f"Minutes rejected | id={minutes_id} by={current_user.id} reason={data.reason!r}"
    )
    await log_audit_event(
        db=db,
        event_type="minutes_rejected",
        event_category="meetings",
        severity="warning",
        event_data={
            "minutes_id": minutes_id,
            "title": minutes.title,
            "reason": data.reason,
        },
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


@router.post("/{minutes_id}/reopen", response_model=MinutesResponse)
async def reopen_minutes(
    minutes_id: str,
    data: MinutesReopen,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Reopen approved minutes as a draft so a correction can be made

    Approved minutes are locked against every edit, including the quorum
    settings; this is the correction path. The minutes return to draft and
    must be submitted and approved again. The prior approval and the reason
    are kept in the audit trail.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)

    async with handle_service_errors("Failed to reopen minutes"):
        outcome = await service.reopen_minutes(
            minutes_id,
            current_user.organization_id,
            reopened_by=current_user.id,
            reason=data.reason,
        )

    minutes, prior = ensure_found(outcome, "Meeting minutes")

    logger.info(
        f"Minutes reopened | id={minutes_id} by={current_user.id} "
        f"reason={data.reason!r}"
    )
    await log_audit_event(
        db=db,
        event_type="minutes_reopened",
        event_category="meetings",
        severity="warning",
        event_data={
            "minutes_id": minutes_id,
            "title": minutes.title,
            "reason": data.reason,
            **prior,
        },
        user_id=str(current_user.id),
    )

    return await _respond(db, current_user, minutes)


# ============================================
# Motion Endpoints
# ============================================


@router.post(
    "/{minutes_id}/motions",
    response_model=MotionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_motion(
    minutes_id: str,
    data: MotionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Add a motion to meeting minutes"""
    service = MinuteService(db)

    async with handle_service_errors("Failed to add motion"):
        motion = await service.add_motion(
            minutes_id, current_user.organization_id, data
        )

    motion = ensure_found(motion, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="motion_added",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "motion_id": str(motion.id)},
        user_id=str(current_user.id),
    )

    return await _motion_response(service, db, minutes_id, motion, current_user)


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

    async with handle_service_errors("Failed to update motion"):
        motion = await service.update_motion(
            motion_id, minutes_id, current_user.organization_id, data
        )

    motion = ensure_found(motion, "Motion")

    # Motions carry the recorded vote tally and outcome — a governance
    # record, not incidental data — so an edit is worth a trace of who
    # changed it and to what, same as every other minutes-lifecycle write
    # in this file.
    await log_audit_event(
        db=db,
        event_type="motion_updated",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "motion_id": motion_id,
            "changed_fields": sorted(data.model_dump(exclude_unset=True).keys()),
        },
        user_id=str(current_user.id),
    )

    return await _motion_response(service, db, minutes_id, motion, current_user)


@router.delete(
    "/{minutes_id}/motions/{motion_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_motion(
    minutes_id: str,
    motion_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Delete a motion"""
    service = MinuteService(db)

    async with handle_service_errors("Failed to delete motion"):
        deleted = await service.delete_motion(
            motion_id, minutes_id, current_user.organization_id
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Motion not found"
        )

    await log_audit_event(
        db=db,
        event_type="motion_deleted",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "motion_id": motion_id},
        user_id=str(current_user.id),
    )


# ============================================
# Action Item Endpoints
# ============================================


@router.post(
    "/{minutes_id}/action-items",
    response_model=ActionItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_action_item(
    minutes_id: str,
    data: ActionItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Add an action item to meeting minutes"""
    service = MinuteService(db)

    async with handle_service_errors("Failed to add action item"):
        item = await service.add_action_item(
            minutes_id, current_user.organization_id, data
        )

    item = ensure_found(item, "Meeting minutes")

    await log_audit_event(
        db=db,
        event_type="action_item_added",
        event_category="meetings",
        severity="info",
        event_data={"minutes_id": minutes_id, "action_item_id": str(item.id)},
        user_id=str(current_user.id),
    )

    return _build_action_item_response(item)


@router.put("/{minutes_id}/action-items/{item_id}", response_model=ActionItemResponse)
async def update_action_item(
    minutes_id: str,
    item_id: str,
    data: ActionItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update an action item (status can be updated even on approved minutes)

    A holder of minutes.manage may change any field. Any other member may
    change only the status and completion notes of an item assigned to them
    by member (W52-7); someone else's item answers 404.

    **Authentication required** — the minutes.manage check is made in code,
    because the item's assignee may act without it.
    """
    can_manage = _has_permission(
        "minutes.manage", _collect_user_permissions(current_user)
    )
    service = MinuteService(db)

    async with handle_service_errors("Failed to update action item"):
        item = await service.update_action_item(
            item_id,
            minutes_id,
            current_user.organization_id,
            data,
            as_assignee=None if can_manage else str(current_user.id),
        )

    item = ensure_found(item, "Action item")

    await log_audit_event(
        db=db,
        event_type="action_item_updated",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "action_item_id": item_id,
            # Codex (PR #1906 review): on approved minutes the service
            # silently drops every field but status/completion_notes — log
            # what was actually applied, not the raw client payload, or a
            # dropped `description` reads as a change that never happened.
            "changed_fields": sorted(getattr(item, "applied_fields", set())),
        },
        user_id=str(current_user.id),
    )

    return _build_action_item_response(item)


@router.delete(
    "/{minutes_id}/action-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_action_item(
    minutes_id: str,
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Delete an action item"""
    service = MinuteService(db)

    async with handle_service_errors("Failed to delete action item"):
        deleted = await service.delete_action_item(
            item_id, minutes_id, current_user.organization_id
        )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Action item not found"
        )

    await log_audit_event(
        db=db,
        event_type="action_item_deleted",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id, "action_item_id": item_id},
        user_id=str(current_user.id),
    )


# ============================================
# Publish Minutes
# ============================================


@router.post("/{minutes_id}/publish", response_model=PublishedDocumentResponse)
async def publish_minutes(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Publish approved minutes as a formatted document in the Meeting Minutes folder."""
    minute_service = MinuteService(db)
    minutes = ensure_found(
        await minute_service.get_minutes(minutes_id, current_user.organization_id),
        "Minutes",
    )

    async with handle_service_errors("Failed to publish minutes"):
        outcome = await MinutesPublishingService(db).publish(
            minutes, current_user.organization_id, current_user
        )
    doc = outcome.document

    await log_audit_event(
        db=db,
        event_type="minutes_published",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "document_id": doc.id,
            "title": minutes.title,
            "public_posted": outcome.public_copy is not None,
        },
        user_id=str(current_user.id),
    )

    dt = doc.document_type
    tags_list = doc.tags.split(",") if doc.tags else None
    return PublishedDocumentResponse(
        id=doc.id,
        organization_id=doc.organization_id,
        folder_id=doc.folder_id,
        title=doc.name,
        description=doc.description,
        # The column is nullable; a row without one reads as the column's default.
        document_type=dt if isinstance(dt, str) else DocumentType.UPLOADED.value,
        content_html=doc.content_html,
        mime_type=doc.file_type,
        source_type=doc.source_type,
        source_id=doc.source_id,
        under_correction_since=doc.under_correction_since,
        tags=tags_list,
        created_by=doc.uploaded_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        public_allowed=outcome.public_allowed,
        public_posted=outcome.public_copy is not None,
    )


@router.get("/{minutes_id}/publishing", response_model=PublishingStatusResponse)
async def get_publishing_status(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Where these minutes stand: the library copy, the public copy, and whether the
    department's settings allow each

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    minutes = ensure_found(
        await MinuteService(db).get_minutes(
            minutes_id, current_user.organization_id, load_children=False
        ),
        "Minutes",
    )
    return await MinutesPublishingService(db).status(
        minutes, current_user.organization_id
    )


@router.delete("/{minutes_id}/public-posting", status_code=204)
async def withdraw_public_posting(
    minutes_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Take the public copy of these minutes down. The library copy is untouched,
    and publishing again posts a fresh public copy.

    **Authentication required**
    **Requires permission: minutes.manage**
    """
    ensure_found(
        await MinuteService(db).get_minutes(
            minutes_id, current_user.organization_id, load_children=False
        ),
        "Minutes",
    )
    async with handle_service_errors("Failed to withdraw the public copy"):
        copy = await MinutesPublishingService(db).withdraw(
            minutes_id, current_user.organization_id, current_user
        )
    ensure_found(copy, "Public copy")
    await log_audit_event(
        db=db,
        event_type="minutes_public_withdrawn",
        event_category="meetings",
        severity="warning",
        event_data={"minutes_id": minutes_id},
        user_id=str(current_user.id),
    )


# ============================================
# Templates
# ============================================


@router.get("/templates/{template_id}", response_model=TemplateResponse)
async def get_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.view")),
):
    """Get a template by ID"""
    service = TemplateService(db)
    tpl = ensure_found(
        await service.get_template(template_id, current_user.organization_id),
        "Template",
    )
    return _build_template_response(tpl)


@router.post(
    "/templates", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED
)
async def create_template(
    data: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """Create a new minutes template"""
    service = TemplateService(db)
    tpl = await service.create_template(
        data, current_user.organization_id, current_user.id
    )
    await log_audit_event(
        db=db,
        event_type="template_created",
        event_category="meetings",
        severity="info",
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
    # The service raises ValueError when the payload clears a NOT NULL column
    # (apply_updates); without this wrapper that escaped as a 500.
    async with handle_service_errors("Failed to update template"):
        updated = await service.update_template(
            template_id, current_user.organization_id, data
        )
    tpl = ensure_found(updated, "Template")
    await log_audit_event(
        db=db,
        event_type="template_updated",
        event_category="meetings",
        severity="info",
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )
    await log_audit_event(
        db=db,
        event_type="template_deleted",
        event_category="meetings",
        severity="warning",
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
            order=s.get("order", 0),
            key=s.get("key", ""),
            title=s.get("title", ""),
            default_content=s.get("default_content", ""),
            format=normalize_format(s.get("format")),
            required=s.get("required", False),
            needs_motion=bool(s.get("needs_motion", False)),
            motion_text=s.get("motion_text") or "",
        )
        for s in (tpl.sections or [])
    ]
    return TemplateResponse(
        id=tpl.id,
        organization_id=tpl.organization_id,
        name=tpl.name,
        description=tpl.description,
        meeting_type=(
            tpl.meeting_type
            if isinstance(tpl.meeting_type, str)
            else tpl.meeting_type.value
        ),
        is_default=tpl.is_default,
        sections=sections,
        header_config=tpl.header_config,
        footer_config=tpl.footer_config,
        created_by=tpl.created_by,
        created_at=tpl.created_at,
        updated_at=tpl.updated_at,
    )


def _build_response(minutes) -> MinutesResponse:
    """Build a MinutesResponse from a MeetingMinutes model"""
    # Build sections from the model's get_sections() helper (dynamic or legacy)
    raw_sections = (
        minutes.get_sections()
        if hasattr(minutes, "get_sections")
        else (minutes.sections or [])
    )
    sections = [
        SectionEntry(
            order=s.get("order", 0),
            key=s.get("key", ""),
            title=s.get("title", ""),
            content=s.get("content", ""),
            format=normalize_format(s.get("format")),
            required=bool(s.get("required", False)),
            needs_motion=bool(s.get("needs_motion", False)),
            motion_text=s.get("motion_text") or "",
            presenter=s.get("presenter") or "",
            not_taken_up=bool(s.get("not_taken_up", False)),
            agenda_key=s.get("agenda_key"),
            documents=s.get("documents") or [],
        )
        for s in raw_sections
    ]

    return MinutesResponse(
        id=minutes.id,
        organization_id=minutes.organization_id,
        title=minutes.title,
        meeting_type=(
            minutes.meeting_type
            if isinstance(minutes.meeting_type, str)
            else minutes.meeting_type.value
        ),
        meeting_date=minutes.meeting_date,
        location=minutes.location,
        called_by=minutes.called_by,
        called_to_order_at=minutes.called_to_order_at,
        adjourned_at=minutes.adjourned_at,
        attendees=minutes.attendees,
        attendance_listing=minutes.attendance_listing,
        quorum_met=minutes.quorum_met,
        quorum_count=minutes.quorum_count,
        event_id=minutes.event_id,
        meeting_id=minutes.meeting_id,
        template_id=minutes.template_id,
        sections=sections,
        header_config=(
            minutes.get_effective_header()
            if hasattr(minutes, "get_effective_header")
            else minutes.header_config
        ),
        footer_config=(
            minutes.get_effective_footer()
            if hasattr(minutes, "get_effective_footer")
            else minutes.footer_config
        ),
        published_document_id=minutes.published_document_id,
        status=(
            minutes.status if isinstance(minutes.status, str) else minutes.status.value
        ),
        submitted_at=minutes.submitted_at,
        submitted_by=minutes.submitted_by,
        approved_at=minutes.approved_at,
        approved_by=minutes.approved_by,
        rejected_at=minutes.rejected_at,
        rejected_by=minutes.rejected_by,
        rejection_reason=minutes.rejection_reason,
        adopted_on=minutes.adopted_on,
        adopted_as_amended=minutes.adopted_as_amended,
        adoption_moved_by=minutes.adoption_moved_by,
        adoption_seconded_by=minutes.adoption_seconded_by,
        adopting_minutes_id=minutes.adopting_minutes_id,
        adopting_minutes_title=_adopting_title(minutes),
        created_by=minutes.created_by,
        created_at=minutes.created_at,
        updated_at=minutes.updated_at,
        edit_version=minutes.edit_version or 0,
        motions=[
            _build_motion_response(m, members_present(minutes.attendees))
            for m in (minutes.motions or [])
        ],
        action_items=[
            _build_action_item_response(a) for a in (minutes.action_items or [])
        ],
    )


async def _name_previous_minutes(
    db: AsyncSession, organization_id, motions: list[MotionResponse]
) -> None:
    """Say which minutes a previous-minutes motion accepts, and where they stand.

    The ids were set by the server, but are still resolved inside the caller's
    department so a stale or foreign id can never surface another department's
    title.
    """
    ids = {m.previous_minutes_id for m in motions if m.previous_minutes_id}
    if not ids:
        return
    found = await db.execute(
        sa_select(MeetingMinutes.id, MeetingMinutes.title, MeetingMinutes.status).where(
            MeetingMinutes.id.in_(ids),
            MeetingMinutes.organization_id == str(organization_id),
        )
    )
    known = {row.id: row for row in found}
    for motion in motions:
        row = known.get(motion.previous_minutes_id or "")
        if row is None:
            motion.previous_minutes_id = None
            continue
        motion.previous_minutes_title = row.title
        motion.previous_minutes_status = (
            row.status if isinstance(row.status, str) else row.status.value
        )


async def _respond(db: AsyncSession, user: User, minutes) -> MinutesResponse:
    """The response, with linked documents narrowed to what *user* could open.

    A section's linked-document names were copied from the library by someone
    who could open them; this viewer may not be able to.
    """
    response = _build_response(minutes)
    await _name_previous_minutes(db, user.organization_id, response.motions)
    response.attendance_listing_effective = effective_listing(
        minutes.attendance_listing,
        await load_attendance_listing(db, str(user.organization_id)),
    )
    await narrow_documents(db, user.organization_id, user, response.sections)
    return response


def _loaded(obj, relationship: str, attribute: str):
    """``obj.relationship.attribute`` when that relationship was loaded.

    The adopting meeting and a motion's ballot are loaded where a screen shows
    them; elsewhere they are left unloaded rather than fetched one row at a
    time, and read as missing.
    """
    if relationship in sa_inspect(obj).unloaded:
        return None
    related = getattr(obj, relationship)
    return getattr(related, attribute) if related is not None else None


_adopting_title = adopting_title


async def _motion_response(
    service, db, minutes_id: str, motion, user
) -> MotionResponse:
    response = _build_motion_response(
        motion, await _present_count(service, minutes_id, user)
    )
    await _name_previous_minutes(db, user.organization_id, [response])
    return response


async def _present_count(service, minutes_id: str, user) -> int:
    """Members the minutes record as in the room, for a motion's suggested result."""
    minutes = await service.get_minutes(minutes_id, user.organization_id)
    return members_present(minutes.attendees) if minutes else 0


def _build_motion_response(motion, present: int = 0) -> MotionResponse:
    """Build a MotionResponse from a Motion model

    ``present`` is how many members the minutes record as in the room, which
    the majority-of-those-present threshold counts against.
    """
    return MotionResponse(
        id=motion.id,
        minutes_id=motion.minutes_id,
        order=motion.order,
        motion_text=motion.motion_text,
        moved_by=motion.moved_by,
        seconded_by=motion.seconded_by,
        section_key=motion.section_key,
        discussion_notes=motion.discussion_notes,
        status=motion.status if isinstance(motion.status, str) else motion.status.value,
        acceptance=motion.acceptance,
        previous_minutes_id=motion.previous_minutes_id,
        votes_for=motion.votes_for,
        votes_against=motion.votes_against,
        votes_abstain=motion.votes_abstain,
        votes_recused=motion.votes_recused,
        threshold=motion.threshold,
        roll_call=motion.roll_call,
        suggested_status=suggested_status(
            motion.threshold, motion.votes_for, motion.votes_against, present
        ),
        election_id=motion.election_id,
        ballot_item_id=motion.ballot_item_id,
        election_title=_loaded(motion, "election", "title"),
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
        priority=(
            item.priority if isinstance(item.priority, str) else item.priority.value
        ),
        status=item.status if isinstance(item.status, str) else item.status.value,
        completed_at=item.completed_at,
        completion_notes=item.completion_notes,
        carried_from_id=item.carried_from_id,
        carried_forward_at=item.carried_forward_at,
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
    if quorum_type not in ("count", "percentage"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quorum_type must be 'count' or 'percentage'",
        )
    # MM-15: `inf`/`-inf`/`nan` all pass an ordinary `<= 0` comparison (NaN
    # compares False against everything), so isfinite() must be checked
    # explicitly before any other bound. Without it, `inf`/`nan` reach
    # pymysql's float encoder on commit (`ProgrammingError: inf can not be
    # used with MySQL`) as an unhandled 500, and `calculate_quorum`'s
    # `int(q_threshold)` for the "count" branch raises OverflowError on inf
    # even if a write did succeed.
    if not math.isfinite(quorum_threshold) or quorum_threshold <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="quorum_threshold must be a positive, finite number",
        )
    # A percentage above 100 can never be met, permanently blocking quorum
    # for this meeting with no error to say why; a "count" is capped well
    # under MySQL FLOAT's representable range so an oversized-but-finite
    # value can't overflow the column either.
    max_threshold = 100.0 if quorum_type == "percentage" else 100_000.0
    if quorum_threshold > max_threshold:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"quorum_threshold must not exceed {max_threshold:g}"
            f" for {quorum_type} quorum",
        )

    result = await db.execute(
        sa_select(MeetingMinutes)
        .where(MeetingMinutes.id == str(minutes_id))
        .where(MeetingMinutes.organization_id == current_user.organization_id)
    )
    minutes = result.scalar_one_or_none()
    if not minutes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found"
        )
    # MM-17 (owner decision): quorum settings are part of the ratified record
    # — changing them recalculates quorum_met for votes already treated as
    # final — so they lock with the rest of approved minutes. A genuine
    # correction reopens the minutes first (POST /{id}/reopen).
    if minutes.status == MinutesStatus.APPROVED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Approved minutes are locked. Reopen them to correct the "
                "quorum settings."
            ),
        )

    old_type, old_threshold = minutes.quorum_type, minutes.quorum_threshold
    minutes.quorum_type = quorum_type
    minutes.quorum_threshold = quorum_threshold
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="minutes_quorum_config_changed",
        event_category="meetings",
        severity="info",
        event_data={
            "minutes_id": minutes_id,
            "old_quorum_type": old_type,
            "old_quorum_threshold": old_threshold,
            "new_quorum_type": quorum_type,
            "new_quorum_threshold": quorum_threshold,
        },
        user_id=str(current_user.id),
    )

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


# ============================================
# Cross-module Bridges
# ============================================


@router.post("/from-meeting/{meeting_id}", status_code=201)
async def create_minutes_from_meeting(
    meeting_id: UUID,
    template_id: Optional[str] = Query(
        None, description="The outline to start from; default: the department's"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("minutes.manage")),
):
    """
    Create meeting minutes pre-populated from a Meeting record.
    Copies title, date, attendees, type, and location, then initializes
    default template sections based on the meeting type.

    **Requires permission: minutes.manage**
    """
    service = MinuteService(db)
    async with handle_service_errors("Failed to create minutes from the meeting"):
        created = await service.create_from_meeting(
            meeting_id=meeting_id,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
            template_id=template_id,
        )
    minutes = ensure_found(created, "Meeting")

    await log_audit_event(
        db=db,
        organization_id=str(current_user.organization_id),
        event_type="minutes_created_from_meeting",
        event_category="minutes",
        severity="info",
        event_data={
            "minutes_id": minutes.id,
            "meeting_id": str(meeting_id),
            "title": minutes.title,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "id": minutes.id,
        "title": minutes.title,
        "meeting_date": (
            minutes.meeting_date.isoformat() if minutes.meeting_date else None
        ),
        "meeting_id": minutes.meeting_id,
        "status": (
            minutes.status.value
            if hasattr(minutes.status, "value")
            else str(minutes.status)
        ),
        "message": "Minutes created from meeting record with attendees and sections pre-populated",
    }
