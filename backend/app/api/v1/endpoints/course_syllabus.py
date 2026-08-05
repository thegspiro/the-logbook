"""
Course Syllabus API Endpoints

Endpoints for describing a multi-class course — the ordered list of classes that
make up something like a recruit school, each timed relative to the course start
rather than pinned to a calendar date.

Reads are open to any authenticated member (a student should be able to see what
their course covers); writes require ``training.manage``.
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.training import CourseClass, TrainingCourse
from app.models.user import User
from app.schemas.course_cohort import (
    CourseClassAutofill,
    CourseClassCreate,
    CourseClassReorder,
    CourseClassResponse,
    CourseClassUpdate,
)
from app.services.course_syllabus_service import CourseSyllabusService

router = APIRouter()


def _to_response(
    course_class: CourseClass, class_course: Optional[TrainingCourse] = None
) -> CourseClassResponse:
    """Build the response, folding in the linked catalog course for display."""
    return CourseClassResponse(
        id=course_class.id,
        organization_id=course_class.organization_id,
        course_id=course_class.course_id,
        class_course_id=course_class.class_course_id,
        sequence=course_class.sequence,
        section_name=course_class.section_name,
        title=course_class.title,
        description=course_class.description,
        day_offset=course_class.day_offset,
        start_time=course_class.start_time,
        duration_minutes=course_class.duration_minutes,
        credit_hours=course_class.credit_hours,
        instructor_id=course_class.instructor_id,
        instructor=course_class.instructor,
        location_id=course_class.location_id,
        location=course_class.location,
        category_id=course_class.category_id,
        requirement_id=course_class.requirement_id,
        phase_id=course_class.phase_id,
        is_required=course_class.is_required,
        counts_toward_certification=course_class.counts_toward_certification,
        active=course_class.active,
        created_at=course_class.created_at,
        updated_at=course_class.updated_at,
        created_by=course_class.created_by,
        class_course_name=class_course.name if class_course else None,
        class_course_code=class_course.code if class_course else None,
        class_course_active=class_course.active if class_course else None,
    )


@router.get("/{course_id}/classes", response_model=List[CourseClassResponse])
async def list_course_classes(
    course_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List a course's syllabus, in order

    **Authentication required**
    """
    service = CourseSyllabusService(db)
    try:
        rows = await service.list_classes(course_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )
    return [_to_response(c, lc) for c, lc in rows]


@router.post(
    "/{course_id}/classes",
    response_model=CourseClassResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_course_class(
    course_id: UUID,
    data: CourseClassCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Add a class to a course's syllabus

    Title, credit hours, and instructor default from the linked catalog course,
    so only the differences need filling in.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseSyllabusService(db)
    try:
        course_class = await service.add_class(
            course_id=course_id,
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
        event_type="course_class_added",
        event_category="training",
        severity="info",
        event_data={
            "course_id": str(course_id),
            "class_id": str(course_class.id),
            "sequence": course_class.sequence,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return _to_response(course_class)


@router.patch("/{course_id}/classes/{class_id}", response_model=CourseClassResponse)
async def update_course_class(
    course_id: UUID,
    class_id: UUID,
    data: CourseClassUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update one class on a course's syllabus

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseSyllabusService(db)
    try:
        course_class = await service.update_class(
            class_id=class_id,
            data=data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )

    if str(course_class.course_id) != str(course_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Class not found"
        )
    return _to_response(course_class)


@router.delete(
    "/{course_id}/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_course_class(
    course_id: UUID,
    class_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Remove a class from a course's syllabus

    Cohorts already generated from this course keep their copy of the class —
    only the template is affected.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseSyllabusService(db)
    try:
        await service.delete_class(class_id, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=safe_error_detail(e)
        )

    await log_audit_event(
        db=db,
        event_type="course_class_removed",
        event_category="training",
        severity="info",
        event_data={"course_id": str(course_id), "class_id": str(class_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post("/{course_id}/classes/reorder", response_model=List[CourseClassResponse])
async def reorder_course_classes(
    course_id: UUID,
    data: CourseClassReorder,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Set the order of a course's classes

    The body must list every class in the course exactly once.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseSyllabusService(db)
    try:
        rows = await service.reorder_classes(
            course_id=course_id,
            class_ids=data.class_ids,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return [_to_response(c) for c in rows]


@router.post("/{course_id}/classes/autofill", response_model=List[CourseClassResponse])
async def autofill_course_class_offsets(
    course_id: UUID,
    data: CourseClassAutofill,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Recompute every class's day offset from a weekly meeting pattern

    "Fifteen classes, Tuesdays and Thursdays" becomes offsets 1, 3, 8, 10, …
    counted from the course start weekday. Offsets stay editable afterward.

    **Authentication required**
    **Requires permission: training.manage**
    """
    service = CourseSyllabusService(db)
    try:
        rows = await service.autofill_offsets(
            course_id=course_id,
            data=data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e)
        )
    return [_to_response(c) for c in rows]
