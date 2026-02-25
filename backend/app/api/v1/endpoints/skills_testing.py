"""
Skills Testing API Endpoints

Endpoints for managing skill templates and skill test sessions.
Supports creating reusable evaluation templates, running test sessions,
and tracking pass/fail results for fire department skills assessments.
"""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.user import User
from app.schemas.skills_testing import (
    SkillTemplateCreate,
    SkillTemplateListResponse,
    SkillTemplateResponse,
    SkillTemplateUpdate,
    SkillTestCreate,
    SkillTestListResponse,
    SkillTestResponse,
    SkillTestingSummaryResponse,
    SkillTestUpdate,
)

router = APIRouter()


# ============================================
# Skill Templates
# ============================================


@router.get("/templates", response_model=List[SkillTemplateListResponse])
async def list_templates(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (draft/published/archived)"),
    category: Optional[str] = Query(None, description="Filter by category"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all skill templates for the organization.

    Supports filtering by status and category. Returns summary items
    with section and criteria counts.

    **Authentication required**
    """
    query = select(SkillTemplate).where(SkillTemplate.organization_id == current_user.organization_id)

    if status_filter:
        query = query.where(SkillTemplate.status == status_filter)

    if category:
        query = query.where(SkillTemplate.category == category)

    query = query.order_by(SkillTemplate.name)

    result = await db.execute(query)
    templates = result.scalars().all()

    # Build list responses with computed counts
    items = []
    for t in templates:
        sections = t.sections or []
        section_count = len(sections)
        criteria_count = sum(len(s.get("criteria", [])) for s in sections if isinstance(s, dict))

        items.append(
            SkillTemplateListResponse(
                id=t.id,
                name=t.name,
                description=t.description,
                category=t.category,
                status=t.status,
                version=t.version,
                section_count=section_count,
                criteria_count=criteria_count,
                tags=t.tags,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )

    return items


@router.post(
    "/templates",
    response_model=SkillTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    template_data: SkillTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a new skill template.

    Templates define the structure for skills evaluations including sections,
    criteria, scoring rules, and time limits.

    **Authentication required**
    **Requires permission: training.manage**
    """
    # Convert sections to JSON-serializable dicts
    sections_json = [s.model_dump() for s in template_data.sections]

    new_template = SkillTemplate(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        name=template_data.name,
        description=template_data.description,
        category=template_data.category,
        sections=sections_json,
        time_limit_seconds=template_data.time_limit_seconds,
        passing_percentage=template_data.passing_percentage,
        require_all_critical=template_data.require_all_critical,
        tags=template_data.tags,
    )

    db.add(new_template)
    await db.commit()
    await db.refresh(new_template)

    await log_audit_event(
        db=db,
        event_type="skill_template_created",
        event_category="training",
        severity="info",
        event_data={
            "template_id": str(new_template.id),
            "template_name": new_template.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return new_template


@router.get("/templates/{template_id}", response_model=SkillTemplateResponse)
async def get_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific skill template by ID.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    return template


@router.put("/templates/{template_id}", response_model=SkillTemplateResponse)
async def update_template(
    template_id: UUID,
    template_update: SkillTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Update a skill template.

    Only draft templates can be freely edited. Published templates will
    have their version incremented on update.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    if template.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update an archived template",
        )

    update_data = template_update.model_dump(exclude_unset=True)

    # Convert sections to JSON-serializable dicts if provided
    if "sections" in update_data and update_data["sections"] is not None:
        update_data["sections"] = [s.model_dump() for s in template_update.sections]

    # Increment version if template is published and structural fields change
    structural_fields = {"sections", "passing_percentage", "require_all_critical", "time_limit_seconds"}
    if template.status == "published" and structural_fields & set(update_data.keys()):
        template.version = (template.version or 1) + 1

    for field, value in update_data.items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)

    await log_audit_event(
        db=db,
        event_type="skill_template_updated",
        event_category="training",
        severity="info",
        event_data={
            "template_id": str(template_id),
            "fields_updated": list(update_data.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return template


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Soft-delete (archive) a skill template.

    Templates are not physically deleted; they are set to "archived" status
    so that existing test records that reference them remain valid.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    template.status = "archived"
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="skill_template_archived",
        event_category="training",
        severity="info",
        event_data={
            "template_id": str(template_id),
            "template_name": template.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.post("/templates/{template_id}/publish", response_model=SkillTemplateResponse)
async def publish_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Publish a skill template, making it available for use in test sessions.

    Only draft templates can be published. The template must have at least
    one section with at least one criterion.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    if template.status == "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Template is already published",
        )

    if template.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot publish an archived template",
        )

    # Validate template has sections with criteria
    sections = template.sections or []
    if not sections:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Template must have at least one section before publishing",
        )

    has_criteria = any(
        len(s.get("criteria", [])) > 0 for s in sections if isinstance(s, dict)
    )
    if not has_criteria:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Template must have at least one criterion before publishing",
        )

    template.status = "published"
    await db.commit()
    await db.refresh(template)

    await log_audit_event(
        db=db,
        event_type="skill_template_published",
        event_category="training",
        severity="info",
        event_data={
            "template_id": str(template_id),
            "template_name": template.name,
            "version": template.version,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return template


@router.post(
    "/templates/{template_id}/duplicate",
    response_model=SkillTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_template(
    template_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Duplicate an existing skill template.

    Creates a new draft template with the same sections, criteria, and
    configuration as the source template. The name is suffixed with " (Copy)".

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    source = result.scalar_one_or_none()

    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    new_template = SkillTemplate(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
        name=f"{source.name} (Copy)",
        description=source.description,
        category=source.category,
        version=1,
        status="draft",
        sections=source.sections,
        time_limit_seconds=source.time_limit_seconds,
        passing_percentage=source.passing_percentage,
        require_all_critical=source.require_all_critical,
        tags=source.tags,
    )

    db.add(new_template)
    await db.commit()
    await db.refresh(new_template)

    await log_audit_event(
        db=db,
        event_type="skill_template_duplicated",
        event_category="training",
        severity="info",
        event_data={
            "source_template_id": str(template_id),
            "new_template_id": str(new_template.id),
            "new_template_name": new_template.name,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return new_template


# ============================================
# Skill Tests
# ============================================


@router.get("/tests", response_model=List[SkillTestListResponse])
async def list_tests(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    candidate_id: Optional[UUID] = Query(None, description="Filter by candidate"),
    template_id: Optional[UUID] = Query(None, description="Filter by template"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List skill tests for the organization.

    Supports filtering by status, candidate, and template.
    Returns summary items with denormalized names.

    **Authentication required**
    """
    query = select(SkillTest).where(SkillTest.organization_id == current_user.organization_id)

    if status_filter:
        query = query.where(SkillTest.status == status_filter)

    if candidate_id:
        query = query.where(SkillTest.candidate_id == str(candidate_id))

    if template_id:
        query = query.where(SkillTest.template_id == str(template_id))

    query = query.order_by(SkillTest.created_at.desc())

    result = await db.execute(query)
    tests = result.scalars().all()

    # Collect unique user/template IDs for batch lookup
    user_ids = set()
    template_ids = set()
    for t in tests:
        user_ids.add(t.candidate_id)
        user_ids.add(t.examiner_id)
        template_ids.add(t.template_id)

    # Batch fetch users
    users_map = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(list(user_ids))))
        users_map = {u.id: u for u in users_result.scalars().all()}

    # Batch fetch templates
    templates_map = {}
    if template_ids:
        templates_result = await db.execute(select(SkillTemplate).where(SkillTemplate.id.in_(list(template_ids))))
        templates_map = {tmpl.id: tmpl for tmpl in templates_result.scalars().all()}

    items = []
    for t in tests:
        candidate = users_map.get(t.candidate_id)
        examiner = users_map.get(t.examiner_id)
        tmpl = templates_map.get(t.template_id)

        candidate_name = _format_user_name(candidate) if candidate else None
        examiner_name = _format_user_name(examiner) if examiner else None
        template_name = tmpl.name if tmpl else None

        items.append(
            SkillTestListResponse(
                id=t.id,
                template_id=t.template_id,
                template_name=template_name,
                candidate_id=t.candidate_id,
                candidate_name=candidate_name,
                examiner_id=t.examiner_id,
                examiner_name=examiner_name,
                status=t.status,
                result=t.result,
                overall_score=t.overall_score,
                started_at=t.started_at,
                completed_at=t.completed_at,
                created_at=t.created_at,
            )
        )

    return items


@router.post(
    "/tests",
    response_model=SkillTestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_test(
    test_data: SkillTestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new skill test session.

    The current user becomes the examiner. The template must be published
    and the candidate must exist in the same organization.

    **Authentication required**
    """
    # Verify template exists, is published, and belongs to org
    template_result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(test_data.template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = template_result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found")

    if template.status != "published":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Template must be published before it can be used for testing",
        )

    # Verify candidate exists in org
    candidate_result = await db.execute(
        select(User)
        .where(User.id == str(test_data.candidate_id))
        .where(User.organization_id == current_user.organization_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    new_test = SkillTest(
        organization_id=current_user.organization_id,
        template_id=str(test_data.template_id),
        candidate_id=str(test_data.candidate_id),
        examiner_id=current_user.id,
        status="draft",
        result="incomplete",
        notes=test_data.notes,
    )

    db.add(new_test)
    await db.commit()
    await db.refresh(new_test)

    await log_audit_event(
        db=db,
        event_type="skill_test_created",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(new_test.id),
            "template_id": str(test_data.template_id),
            "template_name": template.name,
            "candidate_id": str(test_data.candidate_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _build_test_response(new_test, template, candidate, current_user)


@router.get("/tests/{test_id}", response_model=SkillTestResponse)
async def get_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a specific skill test by ID.

    Returns the full test detail including section results and
    denormalized participant names.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found")

    # Fetch related entities for display names
    template = None
    template_result = await db.execute(select(SkillTemplate).where(SkillTemplate.id == test.template_id))
    template = template_result.scalar_one_or_none()

    candidate = None
    candidate_result = await db.execute(select(User).where(User.id == test.candidate_id))
    candidate = candidate_result.scalar_one_or_none()

    examiner = None
    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    return _build_test_response(test, template, candidate, examiner)


@router.put("/tests/{test_id}", response_model=SkillTestResponse)
async def update_test(
    test_id: UUID,
    test_update: SkillTestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update a skill test (save progress or results).

    Use this endpoint to save in-progress results as the examiner
    works through the evaluation. Only tests in draft or in_progress
    status can be updated.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found")

    if test.status in ("completed", "cancelled"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot update a {test.status} test",
        )

    update_data = test_update.model_dump(exclude_unset=True)

    # Convert section_results to JSON-serializable dicts if provided
    if "section_results" in update_data and update_data["section_results"] is not None:
        update_data["section_results"] = [sr.model_dump() for sr in test_update.section_results]

    # Auto-set started_at when transitioning to in_progress
    if update_data.get("status") == "in_progress" and test.started_at is None:
        test.started_at = datetime.now(timezone.utc)

    for field, value in update_data.items():
        setattr(test, field, value)

    await db.commit()
    await db.refresh(test)

    # Fetch related entities for response
    template_result = await db.execute(select(SkillTemplate).where(SkillTemplate.id == test.template_id))
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(select(User).where(User.id == test.candidate_id))
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    return _build_test_response(test, template, candidate, examiner)


@router.post("/tests/{test_id}/complete", response_model=SkillTestResponse)
async def complete_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Mark a skill test as complete and calculate the final result.

    Evaluates section results against the template's scoring rules:
    - Calculates overall score from section scores
    - Checks if passing percentage is met
    - Checks if all critical (required) criteria passed when require_all_critical is enabled
    - Sets result to pass or fail accordingly

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found")

    if test.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test is already completed",
        )

    if test.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot complete a cancelled test",
        )

    # Fetch template for scoring rules
    template_result = await db.execute(select(SkillTemplate).where(SkillTemplate.id == test.template_id))
    template = template_result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Associated template not found",
        )

    # Calculate results
    overall_score, test_result = _calculate_test_result(test, template)

    test.status = "completed"
    test.result = test_result
    test.overall_score = overall_score
    test.completed_at = datetime.now(timezone.utc)

    # Calculate elapsed time if started_at is set
    if test.started_at:
        elapsed = test.completed_at - test.started_at
        test.elapsed_seconds = int(elapsed.total_seconds())

    await db.commit()
    await db.refresh(test)

    # Fetch participant info for response
    candidate_result = await db.execute(select(User).where(User.id == test.candidate_id))
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="skill_test_completed",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name,
            "candidate_id": test.candidate_id,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "result": test_result,
            "overall_score": overall_score,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _build_test_response(test, template, candidate, examiner)


# ============================================
# Summary / Stats
# ============================================


@router.get("/summary", response_model=SkillTestingSummaryResponse)
async def get_testing_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get overall skills testing summary statistics for the organization.

    Returns counts of templates (total and published), tests (total and
    this month), pass rate, and average score.

    **Authentication required**
    """
    org_id = current_user.organization_id

    # Total templates
    total_templates_result = await db.execute(
        select(func.count(SkillTemplate.id)).where(
            SkillTemplate.organization_id == org_id,
            SkillTemplate.status != "archived",
        )
    )
    total_templates = total_templates_result.scalar() or 0

    # Published templates
    published_templates_result = await db.execute(
        select(func.count(SkillTemplate.id)).where(
            SkillTemplate.organization_id == org_id,
            SkillTemplate.status == "published",
        )
    )
    published_templates = published_templates_result.scalar() or 0

    # Total tests
    total_tests_result = await db.execute(
        select(func.count(SkillTest.id)).where(SkillTest.organization_id == org_id)
    )
    total_tests = total_tests_result.scalar() or 0

    # Tests this month
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    tests_this_month_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.created_at >= month_start,
        )
    )
    tests_this_month = tests_this_month_result.scalar() or 0

    # Pass rate (completed tests only)
    completed_tests_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
        )
    )
    completed_count = completed_tests_result.scalar() or 0

    pass_rate = None
    if completed_count > 0:
        passed_tests_result = await db.execute(
            select(func.count(SkillTest.id)).where(
                SkillTest.organization_id == org_id,
                SkillTest.status == "completed",
                SkillTest.result == "pass",
            )
        )
        passed_count = passed_tests_result.scalar() or 0
        pass_rate = round((passed_count / completed_count) * 100, 1)

    # Average score (completed tests with scores)
    avg_score_result = await db.execute(
        select(func.avg(SkillTest.overall_score)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
            SkillTest.overall_score.isnot(None),
        )
    )
    avg_score_raw = avg_score_result.scalar()
    average_score = round(float(avg_score_raw), 1) if avg_score_raw is not None else None

    return SkillTestingSummaryResponse(
        total_templates=total_templates,
        published_templates=published_templates,
        total_tests=total_tests,
        tests_this_month=tests_this_month,
        pass_rate=pass_rate,
        average_score=average_score,
    )


# ============================================
# Helper Functions
# ============================================


def _format_user_name(user: User) -> str:
    """Format a user's display name."""
    if user.last_name and user.first_name:
        return f"{user.first_name} {user.last_name}"
    return user.first_name or user.last_name or user.username or "Unknown"


def _build_test_response(
    test: SkillTest,
    template: Optional[SkillTemplate],
    candidate: Optional[User],
    examiner: Optional[User],
) -> SkillTestResponse:
    """Build a SkillTestResponse with denormalized names."""
    return SkillTestResponse(
        id=test.id,
        organization_id=test.organization_id,
        template_id=test.template_id,
        candidate_id=test.candidate_id,
        examiner_id=test.examiner_id,
        status=test.status,
        result=test.result,
        section_results=test.section_results,
        overall_score=test.overall_score,
        elapsed_seconds=test.elapsed_seconds,
        notes=test.notes,
        started_at=test.started_at,
        completed_at=test.completed_at,
        created_at=test.created_at,
        updated_at=test.updated_at,
        template_name=template.name if template else None,
        candidate_name=_format_user_name(candidate) if candidate else None,
        examiner_name=_format_user_name(examiner) if examiner else None,
    )


def _calculate_test_result(test: SkillTest, template: SkillTemplate) -> tuple[float | None, str]:
    """
    Calculate the overall score and pass/fail result for a completed test.

    Returns:
        Tuple of (overall_score, result_string)
    """
    section_results = test.section_results or []
    template_sections = template.sections or []

    if not section_results:
        return None, "fail"

    # Calculate overall score from section scores
    section_scores = []
    for sr in section_results:
        if isinstance(sr, dict) and sr.get("section_score") is not None:
            section_scores.append(sr["section_score"])

    overall_score = round(sum(section_scores) / len(section_scores), 1) if section_scores else None

    # Check passing percentage
    passes_percentage = True
    if template.passing_percentage is not None and overall_score is not None:
        passes_percentage = overall_score >= template.passing_percentage

    # Check critical criteria (required criteria must all pass)
    all_critical_passed = True
    if template.require_all_critical:
        for section_idx, section in enumerate(template_sections):
            if not isinstance(section, dict):
                continue
            criteria = section.get("criteria", [])
            # Find matching section result
            section_result = None
            for sr in section_results:
                if isinstance(sr, dict) and sr.get("section_name") == section.get("name"):
                    section_result = sr
                    break

            if not section_result:
                # If a section with required criteria has no result, it fails
                if any(c.get("required", False) for c in criteria if isinstance(c, dict)):
                    all_critical_passed = False
                continue

            criteria_results = section_result.get("criteria_results", [])
            for criterion in criteria:
                if not isinstance(criterion, dict) or not criterion.get("required", False):
                    continue
                # Find matching criterion result
                cr_result = None
                for cr in criteria_results:
                    if isinstance(cr, dict) and cr.get("criterion_label") == criterion.get("label"):
                        cr_result = cr
                        break
                if not cr_result or not cr_result.get("passed", False):
                    all_critical_passed = False

    # Determine final result
    if passes_percentage and all_critical_passed:
        test_result = "pass"
    else:
        test_result = "fail"

    return overall_score, test_result
