"""
Course Cohort API Endpoints

Endpoints for generating and running a cohort of a multi-class course — one
scheduled run of a recruit school, with its dated classes, its pipeline, and its
roster.

Permission note: these routes gate on ``training.manage`` rather than
``events.manage``. Generating events is incidental to running a course, and the
rest of the training module (courses, requirements, pipelines) already gates on
``training.manage`` — requiring the events permission would lock training
officers out of their own feature.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.course_cohort import (
    CohortAdHocClassCreate,
    CohortClassCancel,
    CohortClassReschedule,
    CohortMemberAdd,
    CohortOperationResult,
    CohortSchedulePreviewRequest,
    CohortSchedulePreviewResponse,
    CohortShiftRequest,
    CourseCohortClassResponse,
    CourseCohortCreate,
    CourseCohortDetailResponse,
    CourseCohortMemberResponse,
    CourseCohortResponse,
    CourseCohortUpdate,
)
from app.services.course_cohort_service import CourseCohortService

router = APIRouter()


def _cohort_response(
    cohort,
    course_name: Optional[str] = None,
    program_name: Optional[str] = None,
    class_count: int = 0,
    member_count: int = 0,
    end_date=None,
) -> CourseCohortResponse:
    """Map a cohort row plus its computed counts onto the list response."""
    return CourseCohortResponse(
        id=cohort.id,
        organization_id=cohort.organization_id,
        course_id=cohort.course_id,
        name=cohort.name,
        code=cohort.code,
        description=cohort.description,
        start_date=cohort.start_date,
        status=(
            cohort.status.value if hasattr(cohort.status, "value") else cohort.status
        ),
        program_id=cohort.program_id,
        meeting_days=cohort.meeting_days,
        default_start_time=cohort.default_start_time,
        default_duration_minutes=cohort.default_duration_minutes,
        date_roll_policy=(
            cohort.date_roll_policy.value
            if hasattr(cohort.date_roll_policy, "value")
            else cohort.date_roll_policy
        ),
        blackout_dates=cohort.blackout_dates,
        location_id=cohort.location_id,
        location=cohort.location,
        requires_rsvp=cohort.requires_rsvp,
        auto_create_records=cohort.auto_create_records,
        generated_at=cohort.generated_at,
        generated_by=cohort.generated_by,
        notes=cohort.notes,
        created_at=cohort.created_at,
        updated_at=cohort.updated_at,
        created_by=cohort.created_by,
        course_name=course_name,
        program_name=program_name,
        class_count=class_count,
        member_count=member_count,
        end_date=end_date,
    )


def _class_response(
    row, class_course_name=None, rsvp_count=None, checked_in_count=None
) -> CourseCohortClassResponse:
    """Map a materialized class row onto its response."""
    return CourseCohortClassResponse(
        id=row.id,
        organization_id=row.organization_id,
        cohort_id=row.cohort_id,
        course_class_id=row.course_class_id,
        sequence=row.sequence,
        title=row.title,
        description=row.description,
        scheduled_start=row.scheduled_start,
        scheduled_end=row.scheduled_end,
        event_id=row.event_id,
        training_session_id=row.training_session_id,
        status=row.status.value if hasattr(row.status, "value") else row.status,
        class_course_id=row.class_course_id,
        credit_hours=row.credit_hours,
        instructor_id=row.instructor_id,
        instructor=row.instructor,
        location_id=row.location_id,
        location=row.location,
        category_id=row.category_id,
        requirement_id=row.requirement_id,
        phase_id=row.phase_id,
        cancellation_reason=row.cancellation_reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
        class_course_name=class_course_name,
        rsvp_count=rsvp_count,
        checked_in_count=checked_in_count,
    )


def _member_response(
    row, full_name=None, email=None, progress_percentage=None
) -> CourseCohortMemberResponse:
    """Map a roster row onto its response."""
    return CourseCohortMemberResponse(
        id=row.id,
        organization_id=row.organization_id,
        cohort_id=row.cohort_id,
        user_id=row.user_id,
        enrollment_id=row.enrollment_id,
        status=row.status.value if hasattr(row.status, "value") else row.status,
        notes=row.notes,
        withdrawn_at=row.withdrawn_at,
        added_at=row.added_at,
        full_name=full_name,
        email=email,
        progress_percentage=progress_percentage,
    )


@router.post("/preview", response_model=CohortSchedulePreviewResponse)
async def preview_cohort_schedule(
    data: CohortSchedulePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Compute the dates a cohort would get, without creating anything

    Returns every class with its resolved start/end, plus warnings for dates
    that had to move (weekend, blackout) and any room double-booking — so the
    officer sees problems before fifteen events land on the calendar.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        preview = await service.preview_schedule(data, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )
    return CohortSchedulePreviewResponse(**preview)


@router.get("", response_model=List[CourseCohortResponse])
async def list_cohorts(
    course_id: Optional[UUID] = Query(None),
    cohort_status: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List course cohorts

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        rows = await service.list_cohorts(
            organization_id=current_user.organization_id,
            course_id=course_id,
            status=cohort_status,
            skip=skip,
            limit=limit,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return [
        _cohort_response(
            r["cohort"],
            course_name=r.get("course_name"),
            class_count=r.get("class_count", 0),
            member_count=r.get("member_count", 0),
            end_date=r.get("end_date"),
        )
        for r in rows
    ]


@router.get("/mine", response_model=List[CourseCohortResponse])
async def list_my_cohorts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List the cohorts the signed-in member is enrolled on

    **Authentication required**
    """
    service = CourseCohortService(db)
    rows = await service.list_member_cohorts(
        user_id=current_user.id, organization_id=current_user.organization_id
    )
    return [
        _cohort_response(
            r["cohort"],
            course_name=r.get("course_name"),
            class_count=r.get("class_count", 0),
            member_count=r.get("member_count", 0),
            end_date=r.get("end_date"),
        )
        for r in rows
    ]


@router.post(
    "", response_model=CourseCohortDetailResponse, status_code=status.HTTP_201_CREATED
)
async def create_cohort(
    data: CourseCohortCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Generate a cohort from a course's syllabus

    Creates one Event + TrainingSession per class, optionally builds the matching
    pipeline, enrols the roster, and RSVPs them to every class. The whole thing
    is one transaction, so a failure cannot leave a half-scheduled cohort.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort, warnings = await service.create_cohort(
            data=data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )

    await log_audit_event(
        db=db,
        event_type="course_cohort_created",
        event_category="training",
        severity="info",
        event_data={
            "cohort_id": str(cohort.id),
            "course_id": str(cohort.course_id),
            "name": cohort.name,
            "warnings": warnings,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _build_detail(service, cohort.id, current_user.organization_id)


async def _build_detail(
    service: CourseCohortService, cohort_id, organization_id
) -> CourseCohortDetailResponse:
    """Assemble the full cohort view (metadata + class timeline + roster)."""
    detail = await service.get_cohort_detail(UUID(str(cohort_id)), organization_id)
    base = _cohort_response(
        detail["cohort"],
        course_name=detail.get("course_name"),
        program_name=detail.get("program_name"),
        class_count=detail.get("class_count", 0),
        member_count=detail.get("member_count", 0),
        end_date=detail.get("end_date"),
    )
    return CourseCohortDetailResponse(
        **base.model_dump(),
        classes=[
            _class_response(
                c["row"],
                class_course_name=c.get("class_course_name"),
                rsvp_count=c.get("rsvp_count"),
                checked_in_count=c.get("checked_in_count"),
            )
            for c in detail["classes"]
        ],
        members=[
            _member_response(
                m["row"],
                full_name=m.get("full_name"),
                email=m.get("email"),
                progress_percentage=m.get("progress_percentage"),
            )
            for m in detail["members"]
        ],
    )


@router.get("/{cohort_id}", response_model=CourseCohortDetailResponse)
async def get_cohort(
    cohort_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get one cohort with its class timeline and roster

    Officers see any cohort in their organization; other members see only
    cohorts they are on the roster for.

    **Authentication required**
    """
    service = CourseCohortService(db)
    is_officer = user_has_permission(
        current_user, "training.manage"
    ) or user_has_permission(current_user, "training.view_all")
    if not is_officer and not await service.is_roster_member(
        cohort_id, current_user.id, current_user.organization_id
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cohort not found"
        )

    try:
        return await _build_detail(service, cohort_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )


@router.patch("/{cohort_id}", response_model=CourseCohortResponse)
async def update_cohort(
    cohort_id: UUID,
    data: CourseCohortUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update cohort details

    Rescheduling goes through the class endpoints, not here.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort = await service.update_cohort(
            cohort_id, data, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return _cohort_response(cohort)


@router.post("/{cohort_id}/regenerate", response_model=CohortOperationResult)
async def regenerate_cohort_events(
    cohort_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create events for cohort classes that have none

    Safe to run repeatedly — a class that already has an event is skipped, so
    this repairs a partial generation without ever duplicating a class.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        created, warnings = await service.regenerate_missing(
            cohort_id=cohort_id,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )
    return CohortOperationResult(success_count=created, warnings=warnings)


@router.post("/{cohort_id}/shift", response_model=CohortOperationResult)
async def shift_cohort_classes(
    cohort_id: UUID,
    data: CohortShiftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Shift upcoming classes by N days

    Classes that already happened keep their dates — their attendance records
    are anchored to them.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        moved = await service.shift_remaining(
            cohort_id=cohort_id,
            data=data,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="course_cohort_shifted",
        event_category="training",
        severity="info",
        event_data={
            "cohort_id": str(cohort_id),
            "days": data.days,
            "classes_moved": moved,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return CohortOperationResult(success_count=moved)


@router.post("/{cohort_id}/cancel", response_model=CourseCohortResponse)
async def cancel_cohort(
    cohort_id: UUID,
    data: CohortClassCancel,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Cancel a cohort and all of its remaining classes

    Events are cancelled, never deleted, so members who RSVP'd see the
    cancellation rather than the classes silently disappearing.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort = await service.cancel_cohort(
            cohort_id=cohort_id,
            reason=data.reason,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="course_cohort_cancelled",
        event_category="training",
        severity="warning",
        event_data={"cohort_id": str(cohort_id), "reason": data.reason},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _cohort_response(cohort)


@router.post(
    "/{cohort_id}/classes",
    response_model=CourseCohortClassResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_cohort_class(
    cohort_id: UUID,
    data: CohortAdHocClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Add a class that was never on the syllabus (make-up sessions, add-ons)

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort_class = await service.add_ad_hoc_class(
            cohort_id=cohort_id,
            data=data,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )
    return _class_response(cohort_class)


@router.patch(
    "/{cohort_id}/classes/{cohort_class_id}",
    response_model=CourseCohortClassResponse,
)
async def reschedule_cohort_class(
    cohort_id: UUID,
    cohort_class_id: UUID,
    data: CohortClassReschedule,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Move one class — the linked event moves with it, RSVPs are preserved

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort_class = await service.reschedule_class(
            cohort_class_id=cohort_class_id,
            data=data,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    if str(cohort_class.cohort_id) != str(cohort_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Class not found"
        )
    return _class_response(cohort_class)


@router.post(
    "/{cohort_id}/classes/{cohort_class_id}/cancel",
    response_model=CourseCohortClassResponse,
)
async def cancel_cohort_class(
    cohort_id: UUID,
    cohort_class_id: UUID,
    data: CohortClassCancel,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Cancel one class — the event is cancelled, not deleted

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        cohort_class = await service.cancel_class(
            cohort_class_id=cohort_class_id,
            reason=data.reason,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )

    if str(cohort_class.cohort_id) != str(cohort_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Class not found"
        )

    await log_audit_event(
        db=db,
        event_type="course_cohort_class_cancelled",
        event_category="training",
        severity="info",
        event_data={
            "cohort_id": str(cohort_id),
            "class_id": str(cohort_class_id),
            "reason": data.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _class_response(cohort_class)


@router.post("/{cohort_id}/members", response_model=CohortOperationResult)
async def add_cohort_members(
    cohort_id: UUID,
    data: CohortMemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Add members to a cohort's roster

    Members are enrolled in the linked pipeline and RSVP'd to every remaining
    class. A member who cannot be enrolled is still added to the roster and
    reported in ``warnings``.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        added, warnings = await service.add_members(
            cohort_id=cohort_id,
            data=data,
            organization_id=current_user.organization_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return CohortOperationResult(success_count=added, warnings=warnings)


@router.delete("/{cohort_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_cohort_member(
    cohort_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Withdraw a member from a cohort's roster

    Soft: the pipeline enrollment and any credit already earned are kept.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseCohortService(db)
    try:
        await service.remove_member(
            cohort_id=cohort_id,
            user_id=user_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )
