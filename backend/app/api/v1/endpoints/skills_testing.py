"""
Skills Testing API Endpoints

Endpoints for managing skill templates and skill test sessions.
Supports creating reusable evaluation templates, running test sessions,
and tracking pass/fail results for fire department skills assessments.
"""

import html
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.skills_testing import (
    SkillTemplate,
    SkillTest,
    SkillTestResult,
    SkillTestStatus,
)
from app.models.user import User
from app.schemas.skills_testing import (
    SkillTemplateCreate,
    SkillTemplateListResponse,
    SkillTemplateResponse,
    SkillTemplateUpdate,
    SkillTestCancelRequest,
    SkillTestCreate,
    SkillTestingSummaryResponse,
    SkillTestListResponse,
    SkillTestResponse,
    SkillTestUpdate,
    SkillTestVoidRequest,
)
from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)
from app.services.skills_testing_service import (
    apply_test_pass_to_pipeline,
    build_template_snapshot,
    calculate_test_result,
    resolve_elapsed_seconds,
    resolve_test_template,
    revert_test_pass_from_pipeline,
)

router = APIRouter()


# ============================================
# Skill Templates
# ============================================


def _user_has_officer_role(user: User) -> bool:
    """Check if the user has a role typically associated with officers/admins."""
    if hasattr(user, "role") and user.role in (
        "admin",
        "owner",
        "officer",
        "training_officer",
    ):
        return True
    if hasattr(user, "permissions") and user.permissions:
        perms = user.permissions if isinstance(user.permissions, list) else []
        if any(p in perms for p in ("training.manage", "admin.*", "*")):
            return True
    return False


def _can_manage_tests(user: User) -> bool:
    """Whether the user may administer official tests.

    The write-side counterpart to :func:`_user_has_officer_role` (which governs
    read visibility). This checks the real granted permission rather than role
    names, because it stands in for the ``require_permission("training.manage")``
    dependency on routes that now admit practice examiners too.
    """
    return user_has_permission(user, "training.manage")


def _authorize_test_write(test: SkillTest, user: User) -> None:
    """Guard a mutation on ``test``.

    Officers may work any test. Everyone else may only drive a *practice* test
    they are running as examiner — the peer-drill case, where no officer is in
    the room. A candidate gets no write access even to their own practice
    attempt: they are being evaluated in it, so letting them edit criteria would
    make the record self-scored.
    """
    if _can_manage_tests(user):
        return
    if test.is_practice and test.examiner_id == str(user.id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only a training officer can modify this test",
    )


@router.get("/templates", response_model=list[SkillTemplateListResponse])
async def list_templates(
    status_filter: str | None = Query(
        None, alias="status", description="Filter by status (draft/published/archived)"
    ),
    category: str | None = Query(None, description="Filter by category"),
    visibility: str | None = Query(
        None,
        description="Filter by visibility (all_members/officers_only/assigned_only)",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all skill templates for the organization.

    Supports filtering by status, category, and visibility. Returns summary
    items with section and criteria counts. Visibility filtering is applied
    based on the user's role: officers see all templates, regular members
    only see templates with visibility='all_members'.

    **Authentication required**
    """
    query = select(SkillTemplate).where(
        SkillTemplate.organization_id == current_user.organization_id
    )

    if status_filter:
        query = query.where(SkillTemplate.status == status_filter)

    if category:
        query = query.where(SkillTemplate.category == category)

    if visibility:
        query = query.where(SkillTemplate.visibility == visibility)

    query = query.order_by(SkillTemplate.name)

    result = await db.execute(query)
    templates = result.scalars().all()

    # Apply visibility filtering for non-officer users
    is_officer = _user_has_officer_role(current_user)
    if not is_officer:
        templates = [
            t for t in templates if (t.visibility or "all_members") == "all_members"
        ]

    # Build list responses with computed counts
    items = []
    for t in templates:
        sections = t.sections or []
        section_count = len(sections)
        criteria_count = sum(
            len(s.get("criteria", [])) for s in sections if isinstance(s, dict)
        )

        items.append(
            SkillTemplateListResponse(
                id=t.id,
                name=t.name,
                description=t.description,
                category=t.category,
                status=t.status,
                visibility=t.visibility or "all_members",
                version=t.version,
                section_count=section_count,
                criteria_count=criteria_count,
                requirement_id=t.requirement_id,
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

    requirement_id = await _validate_requirement_link(
        db, template_data.requirement_id, current_user.organization_id
    )

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
        requirement_id=requirement_id,
        tags=template_data.tags,
        visibility=template_data.visibility,
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

    # Mirror the list route's visibility model: a non-officer may fetch a
    # template by id only if it's visible to all members (not officers_only /
    # assigned_only). 404 so restricted templates aren't confirmed to exist.
    if not _user_has_officer_role(current_user):
        if (template.visibility or "all_members") != "all_members":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Skill template not found",
            )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

    if template.status == "archived":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update an archived template",
        )

    update_data = template_update.model_dump(exclude_unset=True)

    # Convert sections to JSON-serializable dicts if provided
    if "sections" in update_data and update_data["sections"] is not None:
        update_data["sections"] = [s.model_dump() for s in template_update.sections]

    # Validate/normalize the requirement link (UUID -> str for the FK column)
    if "requirement_id" in update_data:
        update_data["requirement_id"] = await _validate_requirement_link(
            db, update_data["requirement_id"], current_user.organization_id
        )

    # Increment version if template is published and structural fields change
    structural_fields = {
        "sections",
        "passing_percentage",
        "require_all_critical",
        "time_limit_seconds",
    }
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

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
        visibility=source.visibility,
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


@router.get("/tests", response_model=list[SkillTestListResponse])
async def list_tests(
    status_filter: str | None = Query(
        None, alias="status", description="Filter by status"
    ),
    candidate_id: UUID | None = Query(None, description="Filter by candidate"),
    template_id: UUID | None = Query(None, description="Filter by template"),
    include_practice: bool = Query(
        False, description="Include practice attempts in results"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List skill tests for the organization.

    Supports filtering by status, candidate, and template.
    Practice tests are excluded by default; pass include_practice=true to see them.
    Returns summary items with denormalized names.

    **Authentication required**
    """
    query = select(SkillTest).where(
        SkillTest.organization_id == current_user.organization_id
    )

    # Skills-test rows carry PHI-adjacent data (pass/fail, scores, examiner
    # notes). A non-officer may only see tests they are party to — the same
    # officer-vs-member split the template list applies. Officers
    # (training.manage / officer role) keep the full org view.
    if not _user_has_officer_role(current_user):
        uid = str(current_user.id)
        query = query.where(
            or_(SkillTest.candidate_id == uid, SkillTest.examiner_id == uid)
        )

    if not include_practice:
        query = query.where(SkillTest.is_practice == False)  # noqa: E712

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
        templates_result = await db.execute(
            select(SkillTemplate).where(SkillTemplate.id.in_(list(template_ids)))
        )
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
                is_practice=t.is_practice or False,
                overall_score=t.overall_score,
                started_at=t.started_at,
                completed_at=t.completed_at,
                created_at=t.created_at,
                voided_at=t.voided_at,
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

    Official tests require ``training.manage``. Practice attempts need only
    authentication, so two members can drill together without an officer
    present — they are never recorded, credited, or counted.

    **Authentication required**
    **Requires permission: training.manage (official tests only)**
    """
    is_officer = _can_manage_tests(current_user)

    if not test_data.is_practice and not is_officer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a training officer can start an official skills test",
        )

    # Verify template exists, is published, and belongs to org
    template_result = await db.execute(
        select(SkillTemplate)
        .where(SkillTemplate.id == str(test_data.template_id))
        .where(SkillTemplate.organization_id == current_user.organization_id)
    )
    template = template_result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

    # Mirror get_template's visibility rule. The test response carries the full
    # template body (template_sections), so without this a member could practice
    # against an officers_only/assigned_only template and read the very content
    # that route hides from them. 404 to match, so restricted templates aren't
    # confirmed to exist.
    if not is_officer and (template.visibility or "all_members") != "all_members":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill template not found"
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found"
        )

    # SEC (CS-8): the examiner is always the caller and the candidate comes
    # from the request body, so without this an instructor could examine
    # themselves and record a pass — which then satisfies the linked program
    # requirement and counts toward certification. Practice attempts are
    # exempt: they are not logged, not credited, and self-drilling is the
    # point of them.
    if not test_data.is_practice:
        try:
            assert_different_person(
                current_user.id,
                str(test_data.candidate_id),
                action="examine",
                record="skills test",
            )
        except SeparationOfDutiesError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Hybrid link: an explicit per-test requirement overrides the template's
    # default; otherwise the test inherits the template's requirement.
    if test_data.requirement_id is not None:
        requirement_id = await _validate_requirement_link(
            db, test_data.requirement_id, current_user.organization_id
        )
    else:
        requirement_id = template.requirement_id

    new_test = SkillTest(
        organization_id=current_user.organization_id,
        template_id=str(test_data.template_id),
        candidate_id=str(test_data.candidate_id),
        examiner_id=current_user.id,
        requirement_id=requirement_id,
        status="draft",
        result="incomplete",
        notes=test_data.notes,
        is_practice=test_data.is_practice,
        # Freeze the structure and scoring rules now. A later edit to this
        # published template must not re-label or re-score this test.
        template_snapshot=build_template_snapshot(template),
    )

    db.add(new_test)
    await db.commit()
    await db.refresh(new_test)

    # Practice attempts are not logged
    if not test_data.is_practice:
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    # A non-officer may only read a test they are party to (candidate or
    # examiner). The full detail exposes examiner notes + per-criterion scores,
    # so this is PHI-adjacent. 404 (not 403) so the record's existence isn't
    # confirmed to an unrelated member.
    if not _user_has_officer_role(current_user):
        uid = str(current_user.id)
        if test.candidate_id != uid and test.examiner_id != uid:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
            )

    # Fetch related entities for display names
    template = None
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate = None
    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner = None
    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    voider = None
    if test.voided_by:
        voider_result = await db.execute(select(User).where(User.id == test.voided_by))
        voider = voider_result.scalar_one_or_none()

    return _build_test_response(test, template, candidate, examiner, voider)


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

    Officers may update any test; a non-officer may only drive a practice
    test they are running as examiner.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    _authorize_test_write(test, current_user)

    if test.status == "cancelled":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update a cancelled test",
        )

    # A voided result is the frozen record of a withdrawn test. Reopening it for
    # edits would let the underlying scorecard drift away from what was voided.
    if test.status == SkillTestStatus.VOIDED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update a voided test",
        )

    update_data = test_update.model_dump(exclude_unset=True)

    # Completed tests only allow notes updates (section_results for criterion notes, top-level notes)
    if test.status == "completed":
        allowed_fields = {"section_results", "notes"}
        disallowed = set(update_data.keys()) - allowed_fields
        if disallowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update {', '.join(sorted(disallowed))} on a completed test",
            )

    # Convert section_results to JSON-serializable dicts if provided
    if "section_results" in update_data and update_data["section_results"] is not None:
        update_data["section_results"] = [
            sr.model_dump() for sr in test_update.section_results
        ]

    # Validate/normalize the requirement override (UUID -> str for the FK column)
    if "requirement_id" in update_data:
        update_data["requirement_id"] = await _validate_requirement_link(
            db, update_data["requirement_id"], current_user.organization_id
        )

    # Auto-set started_at when transitioning to in_progress
    if update_data.get("status") == "in_progress" and test.started_at is None:
        test.started_at = datetime.now(timezone.utc)

    for field, value in update_data.items():
        setattr(test, field, value)

    await db.commit()
    await db.refresh(test)

    # Fetch related entities for response
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    return _build_test_response(test, template, candidate, examiner)


def _ensure_utc(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware (UTC).

    MySQL returns naive datetimes even for timezone-aware columns.
    This helper attaches UTC tzinfo so Pydantic serializes the offset
    and JavaScript can correctly convert to the user's local timezone.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


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

    Officers may complete any test; a non-officer may only complete a practice
    test they are running as examiner.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    _authorize_test_write(test, current_user)

    if test.status == SkillTestStatus.VOIDED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot complete a voided test",
        )

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
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    if not template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Associated template not found",
        )

    # Score against the structure this test was taken under, not whatever the
    # template says now.
    overall_score, test_result = calculate_test_result(
        test, resolve_test_template(test, template)
    )

    test.status = "completed"
    test.result = test_result
    test.overall_score = overall_score
    test.completed_at = datetime.now(timezone.utc)

    # The examiner's stopwatch reading wins over wall clock; see
    # resolve_elapsed_seconds for why.
    test.elapsed_seconds = resolve_elapsed_seconds(
        test.elapsed_seconds,
        _ensure_utc(test.started_at),
        _ensure_utc(test.completed_at),
    )

    await db.commit()
    await db.refresh(test)

    # A passing, non-practice test linked to a pipeline requirement marks that
    # requirement complete on the candidate's enrollment. Runs after the commit
    # above because the progress updater commits internally.
    if (
        test.result == SkillTestResult.PASS.value
        and not test.is_practice
        and test.requirement_id
    ):
        await apply_test_pass_to_pipeline(
            db=db,
            candidate_id=test.candidate_id,
            requirement_id=test.requirement_id,
            organization_id=current_user.organization_id,
            verified_by=current_user.id,
        )

    # Fetch participant info for response
    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    # Practice attempts are not logged
    if not test.is_practice:
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


@router.delete("/tests/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a *practice* skill test record.

    Permanently removes the test and all associated results. This action
    cannot be undone.

    Official results cannot be deleted through this route — a member's
    certification may rest on them, so a withdrawn result is voided
    (``POST /tests/{test_id}/void``), which keeps the record and its reason.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    if not test.is_practice:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Official test results cannot be deleted. Void the test instead "
                "to withdraw it while preserving the record."
            ),
        )

    # Capture info for audit log before deleting
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    await db.delete(test)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="skill_test_deleted",
        event_category="training",
        severity="warning",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name if template else None,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "test_status": test.status,
            "test_result": test.result,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.delete("/tests/{test_id}/discard", status_code=status.HTTP_204_NO_CONTENT)
async def discard_practice_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Discard a practice test — permanently deletes it with no audit trail.

    Only practice tests can be discarded, by anyone party to them — the
    candidate whose attempt it was, the examiner who ran it, or a training
    officer. The candidate is included because practice notes are theirs to
    review and clear once they're done with them; without it a member whose
    peer acted as examiner could never delete their own drill record.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    if not test.is_practice:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only practice tests can be discarded",
        )

    uid = str(current_user.id)
    if (
        test.candidate_id != uid
        and test.examiner_id != uid
        and not _can_manage_tests(current_user)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot discard this practice test",
        )

    await db.delete(test)
    await db.commit()


@router.post("/tests/{test_id}/cancel", response_model=SkillTestResponse)
async def cancel_test(
    test_id: UUID,
    cancel_data: SkillTestCancelRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancel a test that was started but never finished.

    For evaluations abandoned mid-session — the candidate withdrew, equipment
    failed, weather stopped the drill. The test keeps whatever partial results
    were recorded but is closed out, so it stops sitting in the active list.

    Distinct from voiding: a cancelled test was never scored, so there is no
    result to withdraw and nothing to release from the training pipeline. A
    *completed* test cannot be cancelled — use void for that.

    Officers may cancel any test; a non-officer may only cancel a practice test
    they are running as examiner.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    _authorize_test_write(test, current_user)

    if test.status == SkillTestStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This test has already been scored. Void it instead to withdraw "
                "the result."
            ),
        )

    if test.status == SkillTestStatus.VOIDED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel a voided test",
        )

    if test.status == SkillTestStatus.CANCELLED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test is already cancelled",
        )

    test.status = SkillTestStatus.CANCELLED.value
    if cancel_data.reason:
        test.notes = (
            f"{test.notes}\n\nCancelled: {cancel_data.reason}"
            if test.notes
            else f"Cancelled: {cancel_data.reason}"
        )

    await db.commit()
    await db.refresh(test)

    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    # Practice attempts are not logged, matching create/complete.
    if not test.is_practice:
        await log_audit_event(
            db=db,
            event_type="skill_test_cancelled",
            event_category="training",
            severity="info",
            event_data={
                "test_id": str(test_id),
                "template_name": template.name if template else None,
                "candidate_id": test.candidate_id,
                "candidate_name": _format_user_name(candidate) if candidate else None,
                "reason": cancel_data.reason,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return _build_test_response(test, template, candidate, examiner)


@router.post("/tests/{test_id}/void", response_model=SkillTestResponse)
async def void_test(
    test_id: UUID,
    void_data: SkillTestVoidRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Void an official test result, withdrawing it without deleting it.

    Official results are never removed — a member's certification may rest on
    one, and an erased evaluation leaves no trail of what happened. Voiding
    instead keeps the row and its scorecard, stamps who voided it and why, and:

    - drops the test out of totals, pass rate, and average-score math
    - releases any training-pipeline requirement the pass had credited

    Practice attempts are not voidable — they were never recorded in the first
    place, so they are simply discarded.

    **Authentication required**
    **Requires permission: training.manage**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    if test.is_practice:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Practice attempts are not recorded, so they cannot be voided",
        )

    if test.status == SkillTestStatus.VOIDED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test is already voided",
        )

    # Snapshot before the status is overwritten — the audit entry records what
    # was withdrawn, which is the whole point of voiding over deleting.
    prior_status = test.status
    prior_result = test.result
    credited_requirement = (
        test.requirement_id if test.result == SkillTestResult.PASS.value else None
    )

    test.status = SkillTestStatus.VOIDED.value
    test.voided_at = datetime.now(timezone.utc)
    test.voided_by = str(current_user.id)
    test.void_reason = void_data.reason

    await db.commit()
    await db.refresh(test)

    # Release the pipeline requirement this pass had credited. After the commit
    # because the progress updater commits internally, mirroring the apply path
    # in complete_test.
    if credited_requirement:
        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id=test.candidate_id,
            requirement_id=credited_requirement,
            organization_id=current_user.organization_id,
        )

    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    await log_audit_event(
        db=db,
        event_type="skill_test_voided",
        event_category="training",
        severity="warning",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name if template else None,
            "candidate_id": test.candidate_id,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "prior_status": prior_status,
            "prior_result": prior_result,
            "overall_score": test.overall_score,
            "reason": void_data.reason,
            "requirement_released": credited_requirement,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _build_test_response(test, template, candidate, examiner, current_user)


@router.post("/tests/{test_id}/email-results")
async def email_test_results(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Email a summary of the test results to the candidate.

    Builds an HTML email with the test scorecard and sends it to the
    candidate's email address. Works for both official and practice tests.

    Officers may email any test's results; a non-officer may only send those of
    a practice test they ran as examiner.

    **Authentication required**
    """
    result = await db.execute(
        select(SkillTest)
        .where(SkillTest.id == str(test_id))
        .where(SkillTest.organization_id == current_user.organization_id)
    )
    test = result.scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    _authorize_test_write(test, current_user)

    # Load template, candidate, examiner
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    candidate_result = await db.execute(
        select(User).where(User.id == test.candidate_id)
    )
    candidate = candidate_result.scalar_one_or_none()

    examiner_result = await db.execute(select(User).where(User.id == test.examiner_id))
    examiner = examiner_result.scalar_one_or_none()

    if not candidate or not candidate.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate has no email address on file",
        )

    # Load organization for email service
    from app.models.user import Organization

    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    org = org_result.scalar_one_or_none()

    # Build email body
    candidate_name = _format_user_name(candidate)
    examiner_name = _format_user_name(examiner) if examiner else "Unknown"
    template_name = template.name if template else "Unknown Template"
    test_type = "Practice" if test.is_practice else "Official"
    result_text = (test.result or "incomplete").upper()
    score_text = (
        f"{round(test.overall_score)}%" if test.overall_score is not None else "N/A"
    )

    # Build section summaries
    sections_html = ""
    # Same rule as the API response: the emailed scorecard must reflect the
    # structure the test was taken under, not the template's current state.
    scored_against = resolve_test_template(test, template)
    template_sections = scored_against.sections or [] if scored_against else []
    section_results = test.section_results or []
    for si, section_def in enumerate(template_sections):
        if not isinstance(section_def, dict):
            continue
        section_name = section_def.get("name", f"Section {si + 1}")
        section_id = f"section-{si}"

        sr = None
        for s in section_results:
            if isinstance(s, dict) and (
                s.get("section_id") == section_id
                or s.get("section_name") == section_name
            ):
                sr = s
                break

        criteria_html = ""
        for ci, criterion in enumerate(section_def.get("criteria", [])):
            if not isinstance(criterion, dict):
                continue
            c_type = criterion.get("type", "")
            if c_type == "statement":
                continue

            label = criterion.get("label", "")
            criterion_id = f"criterion-{si}-{ci}"

            cr = None
            if sr:
                for c in sr.get("criteria_results", []):
                    if isinstance(c, dict) and (
                        c.get("criterion_id") == criterion_id
                        or c.get("criterion_label") == label
                    ):
                        cr = c
                        break

            if cr:
                passed = cr.get("passed")
                if c_type == "score":
                    score = cr.get("score", 0)
                    max_score = criterion.get("max_score", 0)
                    badge = f"{score}/{max_score} pts"
                elif passed is True:
                    badge = "PASS"
                elif passed is False:
                    badge = "FAIL"
                else:
                    badge = "—"
            else:
                badge = "—"

            criteria_html += (
                f'<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">'
                f"{html.escape(str(label))}</td>"
                f'<td style="padding:4px 8px;border-bottom:1px solid #eee;'
                f'text-align:center;font-weight:bold;">{badge}</td></tr>'
            )

        if criteria_html:
            sections_html += (
                f'<h3 style="margin:16px 0 8px;">{html.escape(str(section_name))}</h3>'
                f'<table style="width:100%;border-collapse:collapse;">'
                f"{criteria_html}</table>"
            )

    from app.services.email_service import EmailService, build_email_logo_html

    _logo = build_email_logo_html(org)
    html_body = f"""
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      {_logo}
      <h2 style="color:#333;">Skills Test Results — {test_type}</h2>
      <table style="width:100%;margin-bottom:16px;">
        <tr><td style="padding:4px 0;color:#666;">Template:</td>
            <td style="padding:4px 0;font-weight:bold;">{html.escape(str(template_name))}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Candidate:</td>
            <td style="padding:4px 0;font-weight:bold;">{html.escape(str(candidate_name))}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Examiner:</td>
            <td style="padding:4px 0;font-weight:bold;">{html.escape(str(examiner_name))}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Result:</td>
            <td style="padding:4px 0;font-weight:bold;">{result_text}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Score:</td>
            <td style="padding:4px 0;font-weight:bold;">{score_text}</td></tr>
      </table>
      {sections_html}
      <hr style="margin:24px 0;border:none;border-top:1px solid #ddd;" />
      <p style="color:#999;font-size:12px;">
        {"This was a practice attempt and is not part of official records."
         if test.is_practice else
         "This is an official evaluation record."}
      </p>
    </div>
    """

    email_service = EmailService(organization=org)
    subject = f"Skills Test Results: {template_name} ({test_type})"

    try:
        success, failure = await email_service.send_email(
            to_emails=[candidate.email],
            subject=subject,
            html_body=html_body,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send email: {str(e)}",
        ) from e

    if failure > 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deliver email to candidate",
        )

    return {"message": f"Results emailed to {candidate.email}"}


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

    # Total tests (excluding practice and voided). The pass-rate and average-
    # score queries below filter on status == "completed", which already drops
    # voided rows; these two counts span every status, so they exclude it
    # explicitly — a withdrawn result should not inflate the department's
    # testing volume.
    voided = SkillTestStatus.VOIDED.value
    total_tests_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.is_practice == False,  # noqa: E712
            SkillTest.status != voided,
        )
    )
    total_tests = total_tests_result.scalar() or 0

    # Tests this month (excluding practice and voided)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    tests_this_month_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.created_at >= month_start,
            SkillTest.is_practice == False,  # noqa: E712
            SkillTest.status != voided,
        )
    )
    tests_this_month = tests_this_month_result.scalar() or 0

    # Pass rate (completed non-practice tests only)
    completed_tests_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
            SkillTest.is_practice == False,  # noqa: E712
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
                SkillTest.is_practice == False,  # noqa: E712
            )
        )
        passed_count = passed_tests_result.scalar() or 0
        pass_rate = round((passed_count / completed_count) * 100, 1)

    # Average score (completed non-practice tests with scores)
    avg_score_result = await db.execute(
        select(func.avg(SkillTest.overall_score)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
            SkillTest.overall_score.isnot(None),
            SkillTest.is_practice == False,  # noqa: E712
        )
    )
    avg_score_raw = avg_score_result.scalar()
    average_score = (
        round(float(avg_score_raw), 1) if avg_score_raw is not None else None
    )

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


async def _validate_requirement_link(
    db: AsyncSession, requirement_id, organization_id
) -> str | None:
    """Ensure an optional requirement link points to a real requirement in the
    org. Returns the id as a string, or None when unset."""
    if requirement_id is None:
        return None
    from app.models.training import TrainingRequirement

    result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.id == str(requirement_id),
            TrainingRequirement.organization_id == str(organization_id),
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Linked training requirement not found",
        )
    return str(requirement_id)


def _build_test_response(
    test: SkillTest,
    template: SkillTemplate | None,
    candidate: User | None,
    examiner: User | None,
    voider: User | None = None,
) -> SkillTestResponse:
    """Build a SkillTestResponse with denormalized names and template structure."""
    # The structure the client renders the scorecard from must be the one this
    # test was taken under — the live template may have been edited since, and
    # criterion identity is positional.
    scored_against = resolve_test_template(test, template)

    return SkillTestResponse(
        id=test.id,
        organization_id=test.organization_id,
        template_id=test.template_id,
        candidate_id=test.candidate_id,
        examiner_id=test.examiner_id,
        requirement_id=test.requirement_id,
        status=test.status,
        result=test.result,
        is_practice=test.is_practice or False,
        section_results=test.section_results,
        overall_score=test.overall_score,
        elapsed_seconds=test.elapsed_seconds,
        notes=test.notes,
        started_at=_ensure_utc(test.started_at),
        completed_at=_ensure_utc(test.completed_at),
        created_at=_ensure_utc(test.created_at),
        updated_at=_ensure_utc(test.updated_at),
        voided_at=_ensure_utc(test.voided_at),
        voided_by=test.voided_by,
        void_reason=test.void_reason,
        template_name=template.name if template else None,
        candidate_name=_format_user_name(candidate) if candidate else None,
        examiner_name=_format_user_name(examiner) if examiner else None,
        voided_by_name=_format_user_name(voider) if voider else None,
        template_sections=scored_against.sections if scored_against else None,
        template_time_limit_seconds=(
            scored_against.time_limit_seconds if scored_against else None
        ),
    )
