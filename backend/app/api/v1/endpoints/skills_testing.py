"""
Skills Testing API Endpoints

Endpoints for managing skill templates and skill test sessions.
Supports creating reusable evaluation templates, running test sessions,
and tracking pass/fail results for fire department skills assessments.
"""

import html
from datetime import date, datetime, time, timezone
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
    ResultDisclosure,
    SkillTemplate,
    SkillTest,
    SkillTestResult,
    SkillTestStatus,
    SkillTestViewer,
)
from app.models.user import User, UserStatus
from app.schemas.skills_testing import (
    SkillTemplateCreate,
    SkillTemplateListResponse,
    SkillTemplateResponse,
    SkillTemplateUpdate,
    SkillTestBulkValidateRequest,
    SkillTestBulkValidateResponse,
    SkillTestCancelRequest,
    SkillTestCandidateResponse,
    SkillTestCreate,
    SkillTestingSummaryResponse,
    SkillTestListResponse,
    SkillTestResponse,
    SkillTestReturnRequest,
    SkillTestUpdate,
    SkillTestViewerCreate,
    SkillTestViewerResponse,
    SkillTestVoidRequest,
)
from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)
from app.services.skills_testing_service import (
    RESULT_VIEW_PENDING,
    AttemptLimitReached,
    apply_test_pass_to_pipeline,
    assert_attempts_remaining,
    build_score_breakdown,
    build_template_snapshot,
    calculate_test_result,
    is_pending_validation,
    notify_candidate_result_available,
    notify_candidate_result_voided,
    redact_test_for_view,
    resolve_disclosure_policy,
    resolve_elapsed_seconds,
    resolve_result_view,
    resolve_test_template,
    revert_test_pass_from_pipeline,
    viewer_positions_for,
)

router = APIRouter()

# Candidate lookup is a search, never a listing — see search_candidates. The
# floor stops a one-character fragment from matching most of the roster; the cap
# bounds what any single search can return.
CANDIDATE_SEARCH_MIN_CHARS = 2
CANDIDATE_SEARCH_MAX_RESULTS = 15

# Statuses whose scorecard is final, and so has a score breakdown to explain.
# A voided test keeps its arithmetic: the record survives the withdrawal, and a
# reader asking why it was voided still needs to see what it said.
_SCORED_TEST_STATUSES = ("completed", "voided")


def _format_points(value: float) -> str:
    """Point totals without float noise: 12.0 -> "12", 12.5 -> "12.5"."""
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


# ============================================
# Skill Templates
# ============================================


def _user_has_officer_role(user: User) -> bool:
    """Check if the user has a role typically associated with officers/admins.

    Governs *read* visibility: an officer sees every test in the organization,
    everyone else sees only the ones they are party to or have been granted.

    The real permission is checked first, and that is not a refinement — it is
    the case that matters. The name and attribute checks below only recognise a
    legacy ``user.role`` string or a literal ``user.permissions`` list, and a
    department's training officer normally holds ``training.manage`` through a
    *position* instead, which neither of those sees. Such an officer therefore
    read as a non-officer here while ``_can_manage_tests`` (same authority, real
    resolver) read as one — so the validation queue was permanently empty for
    them: ``GET /summary`` counted the pending results, and the list endpoint
    that is supposed to show them filtered every one away as somebody else's
    test. The two checks have to agree on who an officer is.
    """
    if user_has_permission(user, "training.manage"):
        return True
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

    Officers may work any test. Everyone else may drive a test they are running
    as examiner — practice or official — because departments routinely have a
    senior member hold the clipboard. What a member cannot do is decide the
    result stands: an official test they run stays unvalidated until an officer
    signs it off, and once it is signed off this closes to them, so a member
    cannot reopen and rewrite a record an officer has accepted.

    A candidate gets no write access even to their own practice attempt: they
    are being evaluated in it, so letting them edit criteria would make the
    record self-scored.
    """
    # SoD: the candidate must never score or complete their OWN official test —
    # even an officer who holds training.manage. create_test already blocks
    # examiner==candidate; this closes the same self-credit hole on the scoring
    # path (update_test / complete_test are the only callers of this guard).
    # Practice attempts are exempt: they are uncredited and self-drilling is the
    # point, so this check must run before the officer short-circuit below.
    if not test.is_practice and test.candidate_id == str(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot score or complete your own evaluation",
        )
    if _can_manage_tests(user):
        return
    if test.examiner_id == str(user.id) and not getattr(test, "validated_at", None):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only a training officer can modify this test",
    )


async def _org_training_config(db: AsyncSession, organization_id) -> object | None:
    """The organization's training config, or None when it has never been saved."""
    from app.models.training import TrainingModuleConfig

    return (
        await db.execute(
            select(TrainingModuleConfig).where(
                TrainingModuleConfig.organization_id == str(organization_id)
            )
        )
    ).scalar_one_or_none()


async def _named_viewer_ids(db: AsyncSession, test_id: str) -> set[str]:
    """Users individually granted sight of this test's result."""
    rows = await db.execute(
        select(SkillTestViewer.user_id).where(SkillTestViewer.test_id == str(test_id))
    )
    return {str(r) for r in rows.scalars().all()}


async def _user_position_slugs(db: AsyncSession, user: User) -> set[str]:
    """Corporate position slugs the user holds.

    Queried rather than read off ``user.positions``: the relationship is lazily
    loaded, and touching it inside an async request raises rather than emitting
    the implicit IO.
    """
    from app.models.user import Position, user_positions

    rows = await db.execute(
        select(Position.slug)
        .join(user_positions, Position.id == user_positions.c.position_id)
        .where(user_positions.c.user_id == str(user.id))
    )
    return {str(s) for s in rows.scalars().all() if s}


async def _result_view_for(
    db: AsyncSession,
    test: SkillTest,
    template: SkillTemplate | None,
    user: User,
) -> str:
    """Resolve how much of ``test`` this user may see: none / scores / full.

    Officers short-circuit before any of the lookups below — the common path
    should not pay for three queries to be told what it already knows.
    """
    if _user_has_officer_role(user):
        return ResultDisclosure.FULL.value

    uid = str(user.id)
    if str(test.examiner_id) == uid:
        return ResultDisclosure.FULL.value

    org_config = await _org_training_config(db, user.organization_id)
    named = await _named_viewer_ids(db, test.id)
    # Only worth the query when some position actually carries a grant.
    positions = (
        await _user_position_slugs(db, user)
        if viewer_positions_for(test, template)
        else set()
    )

    return resolve_result_view(
        test,
        template,
        org_config,
        is_officer=False,
        user_id=uid,
        named_viewer_ids=named,
        user_position_slugs=positions,
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
        score_pass_fail_criteria=template_data.score_pass_fail_criteria,
        requirement_id=requirement_id,
        tags=template_data.tags,
        visibility=template_data.visibility,
        result_disclosure=template_data.result_disclosure,
        result_release=template_data.result_release,
        result_viewer_positions=template_data.result_viewer_positions,
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
        "score_pass_fail_criteria",
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
        score_pass_fail_criteria=source.score_pass_fail_criteria,
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


@router.get("/candidates", response_model=list[SkillTestCandidateResponse])
async def search_candidates(
    q: str = Query(
        ...,
        min_length=CANDIDATE_SEARCH_MIN_CHARS,
        max_length=100,
        description="Name fragment to match; required",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("training.view", "training.manage")
    ),
):
    """
    Look up a member by name to test them.

    Examining is open to every member, so every member needs to name the person
    they are testing — and ``GET /users`` requires ``users.view``, which the
    baseline member position does not carry. Widening that permission was the
    wrong trade: it opens the full member admin payload, contact details
    included.

    Deliberately a *lookup*, not a listing. ``q`` is required, so there is no
    request that returns the roster: a caller can confirm a name they already
    know, which is what the picker needs, but cannot enumerate the department.
    The result cap holds even for a broad fragment, so a caller cannot widen a
    match into a bulk export by searching for a single common letter — and
    because the cap truncates silently, a short fragment is a worse way to
    harvest names than it looks.

    Matching is on the full display name rather than the two columns
    separately, so "john s" finds John Smith; a first-name-only or
    surname-only search still matches because the fragment can sit anywhere.

    **Authentication required**
    **Requires permission: training.view or training.manage**
    """
    fragment = q.strip()
    if len(fragment) < CANDIDATE_SEARCH_MIN_CHARS:
        # A query of only whitespace passes min_length but would match the whole
        # roster through the LIKE below.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Search for at least {CANDIDATE_SEARCH_MIN_CHARS} characters "
                "of the member's name"
            ),
        )

    # Escape the LIKE wildcards a member could otherwise type: a bare "%" would
    # match every row, turning the search-only rule back into a full listing.
    escaped = fragment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"

    full_name = func.concat(
        func.coalesce(User.first_name, ""), " ", func.coalesce(User.last_name, "")
    )

    rows = await db.execute(
        select(User)
        .where(
            User.organization_id == current_user.organization_id,
            User.status == UserStatus.ACTIVE,
            User.deleted_at.is_(None),
            full_name.like(pattern, escape="\\"),
        )
        .order_by(User.last_name, User.first_name)
        .limit(CANDIDATE_SEARCH_MAX_RESULTS)
    )

    return [
        SkillTestCandidateResponse(id=u.id, name=_format_user_name(u))
        for u in rows.scalars().all()
    ]


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
    pending_validation: bool = Query(
        False,
        description="Only official results still awaiting an officer's sign-off",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List skill tests for the organization.

    Supports filtering by status, candidate, and template.
    Practice tests are excluded by default; pass include_practice=true to see them.
    Pass pending_validation=true for the officer review queue — member-run
    official results nobody has signed off yet.
    Returns summary items with denormalized names.

    **Authentication required**
    """
    query = select(SkillTest).where(
        SkillTest.organization_id == current_user.organization_id
    )

    # Skills-test rows carry PHI-adjacent data (pass/fail, scores, examiner
    # notes). A non-officer sees only tests they are party to or have been
    # granted. Officers (training.manage / officer role) keep the full org view.
    #
    # Two passes: this narrows the query to rows the reader could plausibly see,
    # then the loop below drops any the disclosure policy withholds. The split
    # exists because "withheld" depends on template and organization settings
    # that are not join-able portably — position grants live in a JSON column,
    # and JSON_OVERLAPS is MySQL-only while MariaDB is a supported target.
    is_officer = _user_has_officer_role(current_user)
    if not is_officer:
        uid = str(current_user.id)
        grant_clauses = [
            SkillTest.candidate_id == uid,
            SkillTest.examiner_id == uid,
            SkillTest.id.in_(
                select(SkillTestViewer.test_id).where(SkillTestViewer.user_id == uid)
            ),
        ]

        position_slugs = await _user_position_slugs(db, current_user)
        if position_slugs:
            granting_templates = (
                await db.execute(
                    select(
                        SkillTemplate.id, SkillTemplate.result_viewer_positions
                    ).where(
                        SkillTemplate.organization_id == current_user.organization_id,
                        SkillTemplate.result_viewer_positions.isnot(None),
                    )
                )
            ).all()
            template_ids = [
                tid
                for tid, slugs in granting_templates
                if isinstance(slugs, list) and position_slugs & {str(s) for s in slugs}
            ]
            if template_ids:
                grant_clauses.append(SkillTest.template_id.in_(template_ids))

            # Per-test grants, which the template scan above cannot see.
            granting_tests = (
                await db.execute(
                    select(SkillTest.id, SkillTest.result_viewer_positions).where(
                        SkillTest.organization_id == current_user.organization_id,
                        SkillTest.result_viewer_positions.isnot(None),
                    )
                )
            ).all()
            test_ids = [
                tid
                for tid, slugs in granting_tests
                if isinstance(slugs, list) and position_slugs & {str(s) for s in slugs}
            ]
            if test_ids:
                grant_clauses.append(SkillTest.id.in_(test_ids))

        query = query.where(or_(*grant_clauses))

    if not include_practice:
        query = query.where(SkillTest.is_practice == False)  # noqa: E712

    if pending_validation:
        query = query.where(
            SkillTest.is_practice == False,  # noqa: E712
            SkillTest.status == SkillTestStatus.COMPLETED.value,
            SkillTest.validated_at.is_(None),
        )

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

    # Second pass — drop rows the disclosure policy withholds. Fetched once
    # outside the loop; every row shares the reader's organization and
    # positions, and the named-viewer set is looked up per test only when it
    # could change the outcome.
    viewer_context: dict[str, object] = {}
    if not is_officer:
        uid = str(current_user.id)
        viewer_context = {
            "uid": uid,
            "org_config": await _org_training_config(db, current_user.organization_id),
            "positions": await _user_position_slugs(db, current_user),
            "named": {
                str(tid)
                for tid in (
                    await db.execute(
                        select(SkillTestViewer.test_id).where(
                            SkillTestViewer.user_id == uid
                        )
                    )
                )
                .scalars()
                .all()
            },
        }

    items = []
    for t in tests:
        candidate = users_map.get(t.candidate_id)
        examiner = users_map.get(t.examiner_id)
        tmpl = templates_map.get(t.template_id)
        view = ResultDisclosure.FULL.value

        if not is_officer:
            reader_id = str(viewer_context["uid"])
            # resolve_result_view asks "is this reader named on this test", so
            # pass their own id only when the grant covers this row.
            named_for_row = (
                {reader_id} if str(t.id) in viewer_context["named"] else set()
            )
            view = resolve_result_view(
                t,
                tmpl,
                viewer_context["org_config"],
                is_officer=False,
                user_id=reader_id,
                named_viewer_ids=named_for_row,
                user_position_slugs=viewer_context["positions"],
            )
            if view == ResultDisclosure.NONE.value:
                continue

        candidate_name = _format_user_name(candidate) if candidate else None
        examiner_name = _format_user_name(examiner) if examiner else None
        template_name = tmpl.name if tmpl else None

        # A reader awaiting someone else's sign-off is told the test is under
        # review, not how it went — the same withholding the detail endpoint
        # applies, repeated here because a list row carries the score too.
        awaiting_review = view == RESULT_VIEW_PENDING

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
                result=(
                    SkillTestResult.INCOMPLETE.value if awaiting_review else t.result
                ),
                is_practice=t.is_practice or False,
                overall_score=None if awaiting_review else t.overall_score,
                started_at=t.started_at,
                completed_at=t.completed_at,
                created_at=t.created_at,
                voided_at=t.voided_at,
                validated_at=t.validated_at,
                pending_validation=is_pending_validation(t),
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

    Any member may examine, official or practice — departments routinely use
    senior members as evaluators. The officer's authority sits at validation
    instead: an official test run by a member is submitted for review and
    credits nothing until an officer signs it off. Practice attempts are never
    recorded, credited, or counted at all.

    **Authentication required**
    """
    is_officer = _can_manage_tests(current_user)

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
    # from the request body, so without this anyone could examine themselves
    # and record a pass — which then satisfies the linked program requirement
    # and counts toward certification. Still enforced now that members may
    # examine: opening the examiner seat widens who may evaluate someone else,
    # not whether anyone may evaluate themselves. Practice attempts are exempt —
    # they are not logged, not credited, and self-drilling is the point of them.
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

    # Refuse before the evaluation starts rather than after it is scored. An
    # examiner who runs a full skills test only to be told at submission that
    # it cannot count has wasted the candidate's attempt slot and their own
    # time. Practice attempts are exempt — they are never credited, so they
    # never consume one.
    if not test_data.is_practice:
        try:
            await assert_attempts_remaining(
                db=db,
                candidate_id=str(test_data.candidate_id),
                requirement_id=requirement_id,
                organization_id=current_user.organization_id,
            )
        except AttemptLimitReached as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

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
        result_disclosure=test_data.result_disclosure,
        result_release=test_data.result_release,
        result_viewer_positions=test_data.result_viewer_positions,
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

    return _build_test_response(
        new_test,
        template,
        candidate,
        current_user,
        org_config=await _org_training_config(db, current_user.organization_id),
    )


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

    # Fetch related entities for display names
    template = None
    template_result = await db.execute(
        select(SkillTemplate).where(SkillTemplate.id == test.template_id)
    )
    template = template_result.scalar_one_or_none()

    # What this reader may see, under the department's disclosure policy. The
    # full detail exposes examiner notes and per-criterion scores, so this is
    # PHI-adjacent. 404 rather than 403 throughout, so neither an unrelated
    # member nor a candidate whose results are withheld learns the record
    # exists — a 403 on a withheld result announces "you were evaluated and are
    # not allowed to know how it went."
    result_view = await _result_view_for(db, test, template, current_user)
    if result_view == ResultDisclosure.NONE.value:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

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

    validator = None
    if test.validated_by:
        validator_result = await db.execute(
            select(User).where(User.id == test.validated_by)
        )
        validator = validator_result.scalar_one_or_none()

    return _build_test_response(
        test,
        template,
        candidate,
        examiner,
        voider,
        view=result_view,
        validator=validator,
        org_config=await _org_training_config(db, current_user.organization_id),
    )


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

    # Optimistic concurrency. Refuse rather than silently overwrite when the
    # client's copy is stale — two examiners on one test, or an officer editing
    # the scorecard while a phone still holds unsaved criteria, previously lost
    # one side's work and returned success to the loser. Clients that send no
    # expected_version keep the old last-write-wins behavior.
    #
    # Popped before the completed-test field check below: this is the version the
    # client is writing against, not a column it is asking to change. Counting it
    # as one told every caller — the test screen sends it on every save — that it
    # "cannot update expected_version on a completed test", which named the wrong
    # problem entirely.
    expected_version = update_data.pop("expected_version", None)

    # Completed tests only allow notes updates (section_results for criterion notes, top-level notes)
    if test.status == "completed":
        allowed_fields = {"section_results", "notes"}
        disallowed = set(update_data.keys()) - allowed_fields
        if disallowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot update {', '.join(sorted(disallowed))} on a completed test",
            )

    if expected_version is not None and expected_version != test.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This test was changed elsewhere since you opened it. "
                "Reload to see the current results before saving again."
            ),
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

    test.version = (test.version or 1) + 1

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

    return _build_test_response(
        test,
        template,
        candidate,
        examiner,
        org_config=await _org_training_config(db, current_user.organization_id),
    )


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

    Officers may complete any test; anyone else may complete a test they are
    running as examiner, up until an officer has validated it.

    Completion by an officer validates the result in the same step — they are
    the authority the separate step exists to obtain. Completion by a member
    leaves the official result pending an officer's review: it is scored and
    stored, but credits no requirement and consumes no attempt until then.

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

    # An officer's completion is also the sign-off, so the result counts from
    # here. A member's completion is a submission awaiting review.
    auto_validate = not test.is_practice and _can_manage_tests(current_user)

    # Checked again at submission, not only at creation: several tests can be
    # started before any is completed, so the cap can fall between the two
    # points. Only when this completion also validates — that is the point the
    # attempt is spent and a pass reaches the pipeline. A member's submission is
    # checked later, when an officer validates it.
    if auto_validate:
        try:
            await assert_attempts_remaining(
                db=db,
                candidate_id=test.candidate_id,
                requirement_id=test.requirement_id,
                organization_id=current_user.organization_id,
            )
        except AttemptLimitReached as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Score against the structure this test was taken under, not whatever the
    # template says now.
    overall_score, test_result = calculate_test_result(
        test, resolve_test_template(test, template)
    )

    test.status = "completed"
    test.result = test_result
    test.version = (test.version or 1) + 1
    test.overall_score = overall_score
    test.completed_at = datetime.now(timezone.utc)

    if auto_validate:
        test.validated_at = test.completed_at
        test.validated_by = str(current_user.id)

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
    # requirement complete on the candidate's enrollment — but only once it has
    # been validated, which for a member-run test happens later via /validate.
    # Runs after the commit above because the progress updater commits
    # internally.
    if (
        test.result == SkillTestResult.PASS.value
        and not test.is_practice
        and test.validated_at
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
                "validated": bool(test.validated_at),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    org_config = await _org_training_config(db, current_user.organization_id)

    # An officer's completion is also the sign-off, so for them this is the
    # moment the result becomes the candidate's to read. A member's submission
    # notifies nobody yet — the helper sees it is pending validation and stays
    # quiet until an officer accepts it.
    await notify_candidate_result_available(
        db,
        test=test,
        template=template,
        org_config=org_config,
        organization_id=current_user.organization_id,
    )

    return _build_test_response(
        test, template, candidate, examiner, org_config=org_config
    )


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


@router.post("/tests/{test_id}/validate", response_model=SkillTestResponse)
async def validate_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Accept a member-run official result against the candidate's record.

    Examining is open to any member, so an official test submitted by a peer is
    scored and stored but credits nothing on its own. This is where an officer
    decides the result stands: from here it counts toward the candidate's
    record, credits its linked pipeline requirement if it passed, spends one of
    the requirement's attempts, and becomes visible to the candidate under the
    template's normal disclosure rules.

    The rejection path is ``/void``, which keeps the record and its reason
    rather than deleting an evaluation someone sat for.

    Idempotent: validating an already-validated result returns it unchanged.

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
            detail="Practice attempts are never recorded, so there is nothing to validate",
        )

    if test.status == SkillTestStatus.VOIDED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot validate a voided test",
        )

    if test.status != SkillTestStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a completed test has a result to validate",
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

    org_config = await _org_training_config(db, current_user.organization_id)

    if test.validated_at:
        return _build_test_response(
            test, template, candidate, examiner, org_config=org_config
        )

    # SEC (CS-8): validation is the step that makes a result count, so it is the
    # step self-dealing has to be blocked at. Without this an officer could have
    # a peer "examine" them and then sign off their own pass — the same
    # certification fraud the examiner-side check prevents, one hop removed.
    try:
        assert_different_person(
            current_user.id,
            str(test.candidate_id),
            action="validate",
            record="skills test",
        )
    except SeparationOfDutiesError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # The cap is spent here rather than at completion, so it is enforced here.
    try:
        await assert_attempts_remaining(
            db=db,
            candidate_id=test.candidate_id,
            requirement_id=test.requirement_id,
            organization_id=current_user.organization_id,
        )
    except AttemptLimitReached as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    test.validated_at = datetime.now(timezone.utc)
    test.validated_by = str(current_user.id)
    test.version = (test.version or 1) + 1

    await db.commit()
    await db.refresh(test)

    # Now that the result stands, feed a pass into the pipeline — the step
    # complete_test skips for a member-run test. After the commit, because the
    # progress updater commits internally.
    if test.result == SkillTestResult.PASS.value and test.requirement_id:
        await apply_test_pass_to_pipeline(
            db=db,
            candidate_id=test.candidate_id,
            requirement_id=test.requirement_id,
            organization_id=current_user.organization_id,
            verified_by=current_user.id,
        )

    await log_audit_event(
        db=db,
        event_type="skill_test_validated",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name if template else None,
            "candidate_id": test.candidate_id,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "examiner_id": test.examiner_id,
            "examiner_name": _format_user_name(examiner) if examiner else None,
            "result": test.result,
            "overall_score": test.overall_score,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Tell the candidate, but only if this is the step that actually put the
    # result in front of them. Under the on_release mode it is not — the helper
    # re-resolves visibility and stays silent until the separate release.
    await notify_candidate_result_available(
        db,
        test=test,
        template=template,
        org_config=org_config,
        organization_id=current_user.organization_id,
    )

    return _build_test_response(
        test, template, candidate, examiner, org_config=org_config
    )


@router.post("/tests/bulk-validate", response_model=SkillTestBulkValidateResponse)
async def bulk_validate_tests(
    payload: SkillTestBulkValidateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Accept several submissions in one action.

    After a drill night an officer has a queue of peer-run results to sign off,
    and every other approval surface in the product has a bulk path. This is
    that path — but validation is not a bulk *write*: each one credits a
    pipeline requirement, spends an attempt against its cap, and notifies a
    candidate.

    So this does not reimplement any of it. It calls ``validate_test`` per id,
    which means separation of duties, the attempt cap, the pipeline apply, the
    audit entry and the notification all behave exactly as they do for a single
    validation — there is no second implementation of the rules to drift.

    **Partial success is the normal outcome**, not an error. A colleague may
    have validated or voided one of the selection between the officer loading
    the queue and pressing the button, and an officer capped out on one
    candidate's attempts should still get the other nine signed off. Each
    refusal is reported with its reason rather than failing the batch — and
    because each validation commits as it goes, the ones that succeeded stand.

    **Authentication required**
    **Requires permission: training.manage**
    """
    validated: list[UUID] = []
    skipped: list[dict] = []

    for test_id in payload.test_ids:
        try:
            await validate_test(test_id=test_id, db=db, current_user=current_user)
            validated.append(test_id)
        except HTTPException as exc:
            skipped.append({"test_id": str(test_id), "reason": exc.detail})

    # One entry for the action itself, beside the per-test entries validate_test
    # already wrote. A reader asking "why did nine results change at 21:40?"
    # should find the answer as one deliberate act rather than infer it.
    await log_audit_event(
        db=db,
        event_type="skill_tests_bulk_validated",
        event_category="training",
        severity="info",
        event_data={
            "requested": len(payload.test_ids),
            "validated": len(validated),
            "skipped": skipped,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return SkillTestBulkValidateResponse(validated=validated, skipped=skipped)


@router.post("/tests/{test_id}/release", response_model=SkillTestResponse)
async def release_test_results(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Release a completed result to the candidate.

    Only meaningful under the ``on_release`` disclosure mode, where a finished
    result stays invisible to the person tested until an officer releases it —
    so a chief can review the scorecard, or deliver a failure in person, before
    the member reads it.

    Idempotent: releasing an already-released result returns it unchanged
    rather than erroring, since the outcome the caller wanted is already true.

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

    if test.status != SkillTestStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a completed test has a result to release",
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

    org_config = await _org_training_config(db, current_user.organization_id)

    if test.released_at:
        return _build_test_response(
            test, template, candidate, examiner, org_config=org_config
        )

    disclosure, _release = resolve_disclosure_policy(test, template, org_config)
    if disclosure == ResultDisclosure.NONE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This test's results are configured never to be shown to the "
                "candidate. Change its disclosure setting before releasing."
            ),
        )

    test.released_at = datetime.now(timezone.utc)
    test.released_by = str(current_user.id)
    test.version = (test.version or 1) + 1

    await db.commit()
    await db.refresh(test)

    await log_audit_event(
        db=db,
        event_type="skill_test_released",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name if template else None,
            "candidate_id": test.candidate_id,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "disclosure": disclosure,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    # Releasing is the moment the member can read a result that was deliberately
    # held back, so it is the moment worth telling them about. Silent if the
    # test is still awaiting validation — there is no decided result to read.
    await notify_candidate_result_available(
        db,
        test=test,
        template=template,
        org_config=org_config,
        organization_id=current_user.organization_id,
    )

    return _build_test_response(
        test, template, candidate, examiner, org_config=org_config
    )


@router.get("/tests/{test_id}/viewers", response_model=list[SkillTestViewerResponse])
async def list_test_viewers(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    List the people individually granted sight of this test's result.

    Officer-only: who has been shown a member's evaluation is itself sensitive,
    and the candidate cannot change the list, so there is nothing here for them
    to act on.

    **Authentication required**
    **Requires permission: training.manage**
    """
    test = (
        await db.execute(
            select(SkillTest)
            .where(SkillTest.id == str(test_id))
            .where(SkillTest.organization_id == current_user.organization_id)
        )
    ).scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    viewers = (
        (
            await db.execute(
                select(SkillTestViewer).where(SkillTestViewer.test_id == str(test_id))
            )
        )
        .scalars()
        .all()
    )

    user_ids = {v.user_id for v in viewers} | {
        v.granted_by for v in viewers if v.granted_by
    }
    users_map = {}
    if user_ids:
        users_map = {
            u.id: u
            for u in (await db.execute(select(User).where(User.id.in_(list(user_ids)))))
            .scalars()
            .all()
        }

    return [
        SkillTestViewerResponse(
            id=v.id,
            test_id=v.test_id,
            user_id=v.user_id,
            user_name=(
                _format_user_name(users_map[v.user_id])
                if v.user_id in users_map
                else None
            ),
            granted_by=v.granted_by,
            granted_by_name=(
                _format_user_name(users_map[v.granted_by])
                if v.granted_by and v.granted_by in users_map
                else None
            ),
            granted_at=_ensure_utc(v.granted_at),
        )
        for v in viewers
    ]


@router.post(
    "/tests/{test_id}/viewers",
    response_model=SkillTestViewerResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_test_viewer(
    test_id: UUID,
    viewer_data: SkillTestViewerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Grant one person sight of this test's result.

    For the relationships the candidate and position rules cannot express — a
    preceptor, an FTO, a mentor. The grantee sees the result at the same
    disclosure level the candidate does; sharing a result never shows the
    observer more of it than its subject.

    **Authentication required**
    **Requires permission: training.manage**
    """
    test = (
        await db.execute(
            select(SkillTest)
            .where(SkillTest.id == str(test_id))
            .where(SkillTest.organization_id == current_user.organization_id)
        )
    ).scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    # Pitfall #14c: a client-supplied user id must be proven in-org before it is
    # stored, or a grant can be written naming someone else's member.
    viewer = (
        await db.execute(
            select(User)
            .where(User.id == str(viewer_data.user_id))
            .where(User.organization_id == current_user.organization_id)
        )
    ).scalar_one_or_none()

    if not viewer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Member not found"
        )

    if str(viewer.id) == str(test.candidate_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The candidate can already see their own result as policy allows",
        )

    existing = (
        await db.execute(
            select(SkillTestViewer)
            .where(SkillTestViewer.test_id == str(test_id))
            .where(SkillTestViewer.user_id == str(viewer.id))
        )
    ).scalar_one_or_none()

    if existing:
        grant = existing
    else:
        grant = SkillTestViewer(
            test_id=str(test_id),
            user_id=str(viewer.id),
            granted_by=str(current_user.id),
        )
        db.add(grant)
        await db.commit()
        await db.refresh(grant)

        await log_audit_event(
            db=db,
            event_type="skill_test_viewer_granted",
            event_category="training",
            severity="info",
            event_data={
                "test_id": str(test_id),
                "viewer_id": str(viewer.id),
                "viewer_name": _format_user_name(viewer),
                "candidate_id": test.candidate_id,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )

    return SkillTestViewerResponse(
        id=grant.id,
        test_id=grant.test_id,
        user_id=grant.user_id,
        user_name=_format_user_name(viewer),
        granted_by=grant.granted_by,
        granted_by_name=_format_user_name(current_user),
        granted_at=_ensure_utc(grant.granted_at),
    )


@router.delete(
    "/tests/{test_id}/viewers/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_test_viewer(
    test_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Withdraw one person's access to this test's result.

    **Authentication required**
    **Requires permission: training.manage**
    """
    test = (
        await db.execute(
            select(SkillTest)
            .where(SkillTest.id == str(test_id))
            .where(SkillTest.organization_id == current_user.organization_id)
        )
    ).scalar_one_or_none()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill test not found"
        )

    grant = (
        await db.execute(
            select(SkillTestViewer)
            .where(SkillTestViewer.test_id == str(test_id))
            .where(SkillTestViewer.user_id == str(user_id))
        )
    ).scalar_one_or_none()

    if not grant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Viewer grant not found"
        )

    await db.delete(grant)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="skill_test_viewer_revoked",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(test_id),
            "viewer_id": str(user_id),
            "candidate_id": test.candidate_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


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
    test.version = (test.version or 1) + 1
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

    return _build_test_response(
        test,
        template,
        candidate,
        examiner,
        org_config=await _org_training_config(db, current_user.organization_id),
    )


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

    This is also the rejection path for a member-run result an officer declines
    to validate: the submission and the reason it was refused stay on the
    record, and because it never counted, nothing has to be released.

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
    # Only a validated pass ever reached the pipeline. Rejecting a member-run
    # submission has nothing to release, and calling the revert anyway would
    # clear a requirement the candidate satisfied by some other route.
    credited_requirement = (
        test.requirement_id
        if test.result == SkillTestResult.PASS.value and test.validated_at
        else None
    )

    test.status = SkillTestStatus.VOIDED.value
    test.version = (test.version or 1) + 1
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

    org_config = await _org_training_config(db, current_user.organization_id)

    # Only a candidate who could see the result needs to hear it was withdrawn.
    # For anyone else the notification would be the disclosure the policy exists
    # to prevent: "your evaluation has been voided" says one happened.
    await notify_candidate_result_voided(
        db,
        test=test,
        template=template,
        org_config=org_config,
        organization_id=current_user.organization_id,
    )

    return _build_test_response(
        test,
        template,
        candidate,
        examiner,
        current_user,
        org_config=org_config,
    )


@router.post("/tests/{test_id}/return", response_model=SkillTestResponse)
async def return_test_for_correction(
    test_id: UUID,
    return_data: SkillTestReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Send a submitted result back to its examiner instead of accepting it.

    The third exit from a pending submission, beside ``/validate`` and
    ``/void``. Voiding is the right instrument for a result that was *wrong* —
    the record survives with its reason, which is what a candidate who sat the
    evaluation is owed. It is the wrong one for a result that was simply not
    finished properly: "the captain mis-scored step 4, have him redo it" should
    not cost a permanent, candidate-visible withdrawal and a second test.

    A return spends no void. The test reopens to its examiner at
    ``in_progress`` with every mark intact, so they correct the step rather than
    re-running the evolution, and complete it again for review.

    **Only an unvalidated submission can be returned.** Once an officer has
    validated a result it has credited its requirement, spent an attempt and
    become visible to the candidate — undoing that is a void, which releases all
    three. Returning it would silently strip a result the candidate has already
    been shown.

    Practice attempts are never validated, so there is nothing to send back.

    The candidate is deliberately **not** notified. Nothing has been claimed
    about them yet — the submission never counted — and "your evaluation was
    returned to the examiner" discloses both that they were tested and that
    something was wrong with it, which is the officer's business with the
    examiner until a result actually stands.

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
            detail="Practice attempts are not reviewed, so there is nothing to return",
        )

    if test.status != SkillTestStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a completed test awaiting review can be returned",
        )

    if test.validated_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This result has already been validated. Void it instead — "
                "that releases the requirement it credited and the attempt it "
                "spent."
            ),
        )

    test.status = SkillTestStatus.IN_PROGRESS.value
    # The outcome goes with the status. Leaving a stale pass/fail on a reopened
    # test would report a verdict for a submission nobody has accepted, and
    # complete_test recomputes it from the marks anyway.
    test.result = SkillTestResult.INCOMPLETE.value
    test.completed_at = None
    test.version = (test.version or 1) + 1
    test.returned_at = datetime.now(timezone.utc)
    test.returned_by = str(current_user.id)
    test.return_reason = return_data.reason
    test.return_count = (test.return_count or 0) + 1

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

    await log_audit_event(
        db=db,
        event_type="skill_test_returned",
        event_category="training",
        severity="info",
        event_data={
            "test_id": str(test_id),
            "template_name": template.name if template else None,
            "candidate_id": test.candidate_id,
            "candidate_name": _format_user_name(candidate) if candidate else None,
            "examiner_id": test.examiner_id,
            "examiner_name": _format_user_name(examiner) if examiner else None,
            "reason": return_data.reason,
            # The count is the part a reader needs: one return is a slip, a
            # third is a training conversation.
            "return_count": test.return_count,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return _build_test_response(
        test,
        template,
        candidate,
        examiner,
        org_config=await _org_training_config(db, current_user.organization_id),
        returner=current_user,
    )


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

    # Same rule as the API response: the emailed scorecard must reflect the
    # structure the test was taken under, not the template's current state.
    scored_against = resolve_test_template(test, template)
    email_breakdown = (
        build_score_breakdown(test, scored_against)
        if scored_against and test.status in _SCORED_TEST_STATUSES
        else None
    )

    # A bare percentage in an email invites exactly the question this endpoint
    # cannot answer: which of the steps below it it was computed from. The point
    # total at least says how much of the sheet carried points.
    if test.overall_score is None:
        score_text = "N/A"
    elif email_breakdown and email_breakdown["method"] == "points":
        earned = _format_points(email_breakdown["earned"])
        available = _format_points(email_breakdown["available"])
        score_text = f"{round(test.overall_score)}% ({earned} of {available} points)"
    else:
        score_text = f"{round(test.overall_score)}%"

    # The email is another way for the candidate to read their result, so it
    # obeys the same disclosure policy the API does — otherwise "email results"
    # is a one-click bypass of a department's decision to withhold or redact
    # them. Resolved for the *recipient*, not the officer sending it.
    candidate_view = resolve_result_view(
        test,
        template,
        await _org_training_config(db, current_user.organization_id),
        is_officer=False,
        user_id=str(test.candidate_id),
        named_viewer_ids=set(),
        user_position_slugs=set(),
    )
    if candidate_view == ResultDisclosure.NONE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This test's results are not disclosed to the candidate, or have "
                "not been released yet, so they cannot be emailed."
            ),
        )

    # Build section summaries
    sections_html = ""
    template_sections = scored_against.sections or [] if scored_against else []
    section_results = redact_test_for_view(
        {"notes": test.notes, "section_results": test.section_results or []},
        candidate_view,
    )["section_results"]
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
# Export
# ============================================


def _csv_bool(value: object) -> str:
    return "Yes" if value else "No"


def _csv_dt(value: object) -> str:
    """An ISO-8601 UTC stamp, or blank.

    Deliberately not localized. Everything is stored as UTC, and an export is
    read months later by an auditor in an unknown timezone — a bare local
    string with no offset is the one format that cannot be checked.
    """
    if not value:
        return ""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


@router.get("/tests/export/csv")
async def export_tests_csv(
    detail: str = Query(
        "summary",
        description="'summary' for one row per test, 'criteria' for one row per step",
    ),
    status_filter: str | None = Query(None, alias="status"),
    candidate_id: UUID | None = Query(None),
    template_id: UUID | None = Query(None),
    include_practice: bool = Query(False),
    date_from: date | None = Query(
        None, description="Only tests completed on or after this date (UTC)"
    ),
    date_to: date | None = Query(
        None, description="Only tests completed on or before this date (UTC)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Export skill test records as CSV, for an audit packet or a training file.

    Officer-only, deliberately. The list endpoint runs a two-pass disclosure
    filter so a member sees only what the policy allows; an export that tried
    to honour the same rules would silently produce a different file for every
    reader, which is the opposite of what an audit hand-off needs. Officers
    already see every result in full, so restricting the route to
    ``training.manage`` makes the file's contents a single, explainable thing.

    ``detail=criteria`` emits one row per evaluated step — what a state or ISO
    reviewer actually asks for — flattened through
    :func:`iter_criterion_rows` so the outcomes match the scorecard exactly.

    Practice attempts are excluded unless asked for: they are never validated,
    credit nothing, and are purged on a retention sweep, so including them by
    default would pad an audit file with runs the department does not consider
    records.

    **Authentication required**
    **Requires permission: training.manage**
    """
    import io

    from starlette.responses import StreamingResponse

    from app.services.skills_testing_service import iter_criterion_rows
    from app.utils.csv_export import SafeCsvWriter

    if detail not in ("summary", "criteria"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detail must be 'summary' or 'criteria'",
        )

    query = select(SkillTest).where(
        SkillTest.organization_id == current_user.organization_id
    )
    if not include_practice:
        query = query.where(SkillTest.is_practice == False)  # noqa: E712
    if status_filter:
        query = query.where(SkillTest.status == status_filter)
    if candidate_id:
        query = query.where(SkillTest.candidate_id == str(candidate_id))
    if template_id:
        query = query.where(SkillTest.template_id == str(template_id))
    # Filtered on completion rather than creation: a test is a record from the
    # moment it is completed, and a draft opened in December for an evaluation
    # run in January belongs in January's packet.
    if date_from:
        query = query.where(
            SkillTest.completed_at >= datetime.combine(date_from, time.min)
        )
    if date_to:
        query = query.where(
            SkillTest.completed_at <= datetime.combine(date_to, time.max)
        )
    query = query.order_by(SkillTest.completed_at.desc(), SkillTest.created_at.desc())

    tests = (await db.execute(query)).scalars().all()

    user_ids: set[str] = set()
    template_ids: set[str] = set()
    for t in tests:
        user_ids.update(
            i for i in (t.candidate_id, t.examiner_id, t.validated_by, t.voided_by) if i
        )
        template_ids.add(t.template_id)

    users_map: dict[str, User] = {}
    if user_ids:
        users_map = {
            u.id: u
            for u in (await db.execute(select(User).where(User.id.in_(list(user_ids)))))
            .scalars()
            .all()
        }
    templates_map: dict[str, SkillTemplate] = {}
    if template_ids:
        templates_map = {
            tmpl.id: tmpl
            for tmpl in (
                await db.execute(
                    select(SkillTemplate).where(
                        SkillTemplate.id.in_(list(template_ids))
                    )
                )
            )
            .scalars()
            .all()
        }

    def name_of(user_id: str | None) -> str:
        user = users_map.get(user_id) if user_id else None
        return _format_user_name(user) if user else ""

    output = io.StringIO()
    # SafeCsvWriter neutralizes spreadsheet formula injection. Mandatory here
    # rather than defensive: examiner notes, criterion labels and void reasons
    # are all free text a member can influence, and this file is opened in
    # Excel by whoever assembles the audit packet.
    writer = SafeCsvWriter(output)

    if detail == "summary":
        writer.writerow(
            [
                "Test ID",
                "Template",
                "Category",
                "Candidate",
                "Examiner",
                "Status",
                "Result",
                "Score %",
                "Practice",
                "Started (UTC)",
                "Completed (UTC)",
                "Elapsed (s)",
                "Validated (UTC)",
                "Validated By",
                "Voided (UTC)",
                "Voided By",
                "Void Reason",
                "Notes",
            ]
        )
        for t in tests:
            tmpl = templates_map.get(t.template_id)
            writer.writerow(
                [
                    t.id,
                    tmpl.name if tmpl else "",
                    (tmpl.category or "") if tmpl else "",
                    name_of(t.candidate_id),
                    name_of(t.examiner_id),
                    t.status or "",
                    t.result or "",
                    "" if t.overall_score is None else t.overall_score,
                    _csv_bool(t.is_practice),
                    _csv_dt(t.started_at),
                    _csv_dt(t.completed_at),
                    "" if t.elapsed_seconds is None else t.elapsed_seconds,
                    _csv_dt(t.validated_at),
                    name_of(t.validated_by),
                    _csv_dt(t.voided_at),
                    name_of(t.voided_by),
                    t.void_reason or "",
                    t.notes or "",
                ]
            )
    else:
        writer.writerow(
            [
                "Test ID",
                "Template",
                "Candidate",
                "Examiner",
                "Completed (UTC)",
                "Test Result",
                "Section #",
                "Section",
                "Step #",
                "Step",
                "Type",
                "Critical",
                "Outcome",
                "Score",
                "Max Score",
                "Time (s)",
                "Checklist",
                "Step Notes",
            ]
        )
        for t in tests:
            tmpl = templates_map.get(t.template_id)
            # The frozen snapshot, not the live template: a test is judged
            # against the structure it was created with.
            effective = resolve_test_template(t, tmpl)
            if effective is None:
                continue
            candidate_name = name_of(t.candidate_id)
            examiner_name = name_of(t.examiner_id)
            completed = _csv_dt(t.completed_at)
            for row in iter_criterion_rows(t, effective):
                ticked = row["checklist"]
                writer.writerow(
                    [
                        t.id,
                        tmpl.name if tmpl else "",
                        candidate_name,
                        examiner_name,
                        completed,
                        t.result or "",
                        row["section_index"] + 1,
                        row["section_name"],
                        row["criterion_index"] + 1,
                        row["label"],
                        row["type"],
                        _csv_bool(row["critical"]),
                        row["outcome"],
                        "" if row["score"] is None else row["score"],
                        "" if row["max_score"] is None else row["max_score"],
                        "" if row["time_seconds"] is None else row["time_seconds"],
                        (
                            f"{sum(1 for c in ticked if c)}/{len(ticked)} ticked"
                            if ticked
                            else ""
                        ),
                        row["notes"] or "",
                    ]
                )

    # A bulk read of every member's evaluation results leaving the system is
    # exactly the access an audit trail exists to record.
    await log_audit_event(
        db=db,
        event_type="skill_tests_exported",
        event_category="training",
        severity="info",
        event_data={
            "detail": detail,
            "test_count": len(tests),
            "include_practice": include_practice,
            "candidate_id": str(candidate_id) if candidate_id else None,
            "template_id": str(template_id) if template_id else None,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=skill_tests_{detail}.csv"
        },
    )


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

    # Pass rate (validated non-practice tests only). A member-run result nobody
    # has signed off is a submission, not yet the department's finding — folding
    # it into the pass rate would let the headline number move on evaluations an
    # officer may still reject.
    completed_tests_result = await db.execute(
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
            SkillTest.validated_at.isnot(None),
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
                SkillTest.validated_at.isnot(None),
                SkillTest.result == "pass",
                SkillTest.is_practice == False,  # noqa: E712
            )
        )
        passed_count = passed_tests_result.scalar() or 0
        pass_rate = round((passed_count / completed_count) * 100, 1)

    # Average score (validated non-practice tests with scores)
    avg_score_result = await db.execute(
        select(func.avg(SkillTest.overall_score)).where(
            SkillTest.organization_id == org_id,
            SkillTest.status == "completed",
            SkillTest.validated_at.isnot(None),
            SkillTest.overall_score.isnot(None),
            SkillTest.is_practice == False,  # noqa: E712
        )
    )
    avg_score_raw = avg_score_result.scalar()
    average_score = (
        round(float(avg_score_raw), 1) if avg_score_raw is not None else None
    )

    # Review queue depth. Only meaningful to someone who can act on it, and it
    # is an org-wide count — a member would learn how many other people's
    # evaluations are outstanding, which is not theirs to see.
    pending_validation_count = 0
    if _can_manage_tests(current_user):
        pending_validation_result = await db.execute(
            select(func.count(SkillTest.id)).where(
                SkillTest.organization_id == org_id,
                SkillTest.status == "completed",
                SkillTest.validated_at.is_(None),
                SkillTest.is_practice == False,  # noqa: E712
            )
        )
        pending_validation_count = pending_validation_result.scalar() or 0

    return SkillTestingSummaryResponse(
        total_templates=total_templates,
        published_templates=published_templates,
        total_tests=total_tests,
        tests_this_month=tests_this_month,
        pass_rate=pass_rate,
        average_score=average_score,
        pending_validation=pending_validation_count,
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
    view: str = ResultDisclosure.FULL.value,
    validator: User | None = None,
    org_config: object | None = None,
    returner: User | None = None,
) -> SkillTestResponse:
    """Build a SkillTestResponse with denormalized names and template structure.

    ``view`` is the caller's resolved disclosure tier. Redaction happens here,
    at the single point every read path funnels through, rather than at each
    endpoint — a new endpoint that forgets to redact is a leak, and this way
    there is nothing to forget.

    ``org_config`` is the department's training config, needed only to resolve
    the effective disclosure policy. Passing None resolves against the test and
    template alone, which is correct wherever the department has set no default
    and harmless elsewhere — the field is advisory UI copy, never a gate.
    """
    # The structure the client renders the scorecard from must be the one this
    # test was taken under — the live template may have been edited since, and
    # criterion identity is positional.
    scored_against = resolve_test_template(test, template)
    effective_disclosure, effective_release = resolve_disclosure_policy(
        test, template, org_config
    )

    response = SkillTestResponse(
        id=test.id,
        organization_id=test.organization_id,
        template_id=test.template_id,
        candidate_id=test.candidate_id,
        examiner_id=test.examiner_id,
        requirement_id=test.requirement_id,
        status=test.status,
        result=test.result,
        is_practice=test.is_practice or False,
        version=test.version or 1,
        section_results=test.section_results,
        overall_score=test.overall_score,
        elapsed_seconds=test.elapsed_seconds,
        notes=test.notes,
        started_at=_ensure_utc(test.started_at),
        completed_at=_ensure_utc(test.completed_at),
        created_at=_ensure_utc(test.created_at),
        updated_at=_ensure_utc(test.updated_at),
        result_disclosure=test.result_disclosure,
        result_release=test.result_release,
        effective_result_disclosure=effective_disclosure,
        effective_result_release=effective_release,
        result_viewer_positions=test.result_viewer_positions,
        released_at=_ensure_utc(test.released_at),
        released_by=test.released_by,
        voided_at=_ensure_utc(test.voided_at),
        voided_by=test.voided_by,
        void_reason=test.void_reason,
        returned_at=_ensure_utc(test.returned_at),
        returned_by=test.returned_by,
        returned_by_name=_format_user_name(returner) if returner else None,
        return_reason=test.return_reason,
        return_count=test.return_count or 0,
        validated_at=_ensure_utc(test.validated_at),
        validated_by=test.validated_by,
        pending_validation=is_pending_validation(test),
        template_name=template.name if template else None,
        candidate_name=_format_user_name(candidate) if candidate else None,
        examiner_name=_format_user_name(examiner) if examiner else None,
        voided_by_name=_format_user_name(voider) if voider else None,
        validated_by_name=_format_user_name(validator) if validator else None,
        template_sections=scored_against.sections if scored_against else None,
        template_time_limit_seconds=(
            scored_against.time_limit_seconds if scored_against else None
        ),
        template_require_all_critical=(
            scored_against.require_all_critical if scored_against else None
        ),
        template_score_pass_fail_criteria=(
            bool(getattr(scored_against, "score_pass_fail_criteria", False))
            if scored_against
            else None
        ),
        # Only a finished test has arithmetic worth explaining. A breakdown of a
        # half-scored sheet would report every step the examiner has not reached
        # yet as points not earned.
        score_breakdown=(
            build_score_breakdown(test, scored_against)
            if scored_against and test.status in _SCORED_TEST_STATUSES
            else None
        ),
    )

    if view == ResultDisclosure.FULL.value:
        return response
    return SkillTestResponse(**redact_test_for_view(response.model_dump(), view))
