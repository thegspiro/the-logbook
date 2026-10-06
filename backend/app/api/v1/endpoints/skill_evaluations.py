"""
Skill evaluation definitions.

A ``SkillEvaluation`` is the department's named list of skills that need a
sign-off. It is what turns a 1–5 skill score on a shift report into a
``SkillCheckoff``, competency history and pipeline progress
(``ShiftCompletionService._resolve_skill_evaluations``), and what the shift
report settings panel matches apparatus skills against. Until these routes
existed nothing could create one, so every score stopped at the report.

The match is by name, case-insensitively, so the name is a join key: two active
skills spelled alike would make the match arbitrary, and renaming a skill
silently unlinks every apparatus skill that used the old spelling.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.training import (
    InstructorQualification,
    MemberCompetency,
    SkillCheckoff,
    SkillEvaluation,
)
from app.models.user import Position, User
from app.schemas.training_program import (
    SkillEvaluationCreate,
    SkillEvaluationResponse,
    SkillEvaluationUpdate,
    SkillEvaluatorCheckResponse,
    SkillEvaluatorMember,
)
from app.utils.model_updates import apply_updates

router = APIRouter()

# A department defines tens of skills, not thousands; the cap only keeps a
# runaway import from turning the list into an unbounded response.
SKILL_LIST_MAX = 500


async def _get_skill(db: AsyncSession, skill_id: UUID, org_id: str) -> SkillEvaluation:
    result = await db.execute(
        select(SkillEvaluation)
        .where(SkillEvaluation.id == str(skill_id))
        .where(SkillEvaluation.organization_id == str(org_id))
    )
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Skill evaluation not found"
        )
    return skill


async def _assert_name_free(
    db: AsyncSession, org_id: str, name: str, exclude_id: str | None = None
) -> None:
    """Refuse a second *active* skill with the same name, ignoring case.

    The shift-report link resolves a name to one id through a dict keyed on the
    lowercased name, so with two matches the one that wins is whichever the
    query happened to return last.
    """
    query = (
        select(SkillEvaluation.id)
        .where(SkillEvaluation.organization_id == str(org_id))
        .where(SkillEvaluation.active.is_(True))
        .where(func.lower(SkillEvaluation.name) == name.strip().lower())
    )
    if exclude_id:
        query = query.where(SkillEvaluation.id != exclude_id)
    if (await db.execute(query.limit(1))).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'An active skill named "{name.strip()}" already exists',
        )


async def _validate_evaluators(
    db: AsyncSession, org_id: str, evaluators: dict | None
) -> dict | None:
    """Check every referenced position and member belongs to this department.

    SEC (XC-1): a stored id from another organization would be a dangling
    grant, and a position slug that does not exist here would read as a
    restriction nobody can satisfy.
    """
    if evaluators is None:
        return None
    if evaluators["type"] == "roles":
        slugs = evaluators["roles"]
        found = set(
            (
                await db.execute(
                    select(Position.slug)
                    .where(Position.organization_id == str(org_id))
                    .where(Position.slug.in_(slugs))
                )
            )
            .scalars()
            .all()
        )
        missing = sorted(set(slugs) - found)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown position(s): {', '.join(missing)}",
            )
        return {"type": "roles", "roles": slugs}

    user_ids = sorted({str(u) for u in evaluators["user_ids"]})
    found_users = set(
        (
            await db.execute(
                select(User.id)
                .where(User.organization_id == str(org_id))
                .where(User.id.in_(user_ids))
                .where(User.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
    if found_users != set(user_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more evaluators are not members of this department",
        )
    return {"type": "specific_users", "user_ids": user_ids}


async def _responses(
    db: AsyncSession, org_id: str, skills: list[SkillEvaluation]
) -> list[SkillEvaluationResponse]:
    """Build responses with sign-off counts and named evaluators resolved.

    Names are looked up in the caller's organization only, so a stored id that
    somehow points elsewhere resolves to nothing rather than to a name.
    """
    ids = [str(s.id) for s in skills]
    counts: dict[str, int] = {}
    if ids:
        rows = await db.execute(
            select(SkillCheckoff.skill_evaluation_id, func.count())
            .where(SkillCheckoff.skill_evaluation_id.in_(ids))
            .group_by(SkillCheckoff.skill_evaluation_id)
        )
        counts = {str(sid): int(n) for sid, n in rows.all()}

    member_ids = {
        str(uid)
        for s in skills
        if (s.allowed_evaluators or {}).get("type") == "specific_users"
        for uid in (s.allowed_evaluators.get("user_ids") or [])
    }
    names: dict[str, str] = {}
    if member_ids:
        users = (
            (
                await db.execute(
                    select(User)
                    .where(User.organization_id == str(org_id))
                    .where(User.id.in_(sorted(member_ids)))
                )
            )
            .scalars()
            .all()
        )
        names = {str(u.id): u.display_name for u in users}

    out = []
    for skill in skills:
        resp = SkillEvaluationResponse.model_validate(skill)
        resp.checkoff_count = counts.get(str(skill.id), 0)
        evaluators = skill.allowed_evaluators or {}
        if evaluators.get("type") == "specific_users":
            resp.evaluator_members = [
                SkillEvaluatorMember(id=uid, name=names[str(uid)])
                for uid in evaluators.get("user_ids") or []
                if str(uid) in names
            ]
        out.append(resp)
    return out


@router.get("", response_model=list[SkillEvaluationResponse])
async def list_skill_evaluations(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("training.manage", "training.configure")
    ),
):
    """
    List the department's skill evaluations, by name.

    **Requires permission: training.manage or training.configure**
    """
    query = select(SkillEvaluation).where(
        SkillEvaluation.organization_id == str(current_user.organization_id)
    )
    if not include_inactive:
        query = query.where(SkillEvaluation.active.is_(True))
    skills = list(
        (
            await db.execute(
                query.order_by(SkillEvaluation.name, SkillEvaluation.id).limit(
                    SKILL_LIST_MAX
                )
            )
        )
        .scalars()
        .all()
    )
    return await _responses(db, str(current_user.organization_id), skills)


@router.post(
    "", response_model=SkillEvaluationResponse, status_code=status.HTTP_201_CREATED
)
async def create_skill_evaluation(
    data: SkillEvaluationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Define a skill that needs a sign-off.

    **Requires permission: training.manage**
    """
    org_id = str(current_user.organization_id)
    await _assert_name_free(db, org_id, data.name)
    evaluators = await _validate_evaluators(
        db,
        org_id,
        (
            data.allowed_evaluators.model_dump(mode="json")
            if data.allowed_evaluators
            else None
        ),
    )
    skill = SkillEvaluation(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        category=data.category or None,
        evaluation_criteria=data.evaluation_criteria,
        passing_requirements=data.passing_requirements,
        allowed_evaluators=evaluators,
        active=True,
        created_by=str(current_user.id),
    )
    db.add(skill)
    await db.commit()
    await db.refresh(skill)

    await log_audit_event(
        db=db,
        event_type="skill_evaluation_created",
        event_category="training",
        severity="info",
        event_data={"skill_id": str(skill.id), "name": skill.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return (await _responses(db, org_id, [skill]))[0]


@router.get("/{skill_id}", response_model=SkillEvaluationResponse)
async def get_skill_evaluation(
    skill_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("training.manage", "training.configure")
    ),
):
    """
    Get one skill evaluation.

    **Requires permission: training.manage or training.configure**
    """
    skill = await _get_skill(db, skill_id, current_user.organization_id)
    return (await _responses(db, str(current_user.organization_id), [skill]))[0]


@router.patch("/{skill_id}", response_model=SkillEvaluationResponse)
async def update_skill_evaluation(
    skill_id: UUID,
    data: SkillEvaluationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Edit a skill evaluation, or deactivate / reactivate it.

    Omitted fields are left alone. ``allowed_evaluators: null`` returns the
    skill to the default (anyone holding ``training.manage``).

    **Requires permission: training.manage**
    """
    org_id = str(current_user.organization_id)
    skill = await _get_skill(db, skill_id, org_id)
    updates = data.model_dump(exclude_unset=True, mode="json")

    becomes_active = updates.get("active", skill.active)
    new_name = updates.get("name") or skill.name
    if becomes_active and ("name" in updates or updates.get("active") is True):
        await _assert_name_free(db, org_id, new_name, exclude_id=str(skill.id))

    if "allowed_evaluators" in updates:
        updates["allowed_evaluators"] = await _validate_evaluators(
            db, org_id, updates["allowed_evaluators"]
        )
    if "category" in updates:
        updates["category"] = updates["category"] or None

    try:
        changed = apply_updates(
            skill,
            updates,
            skip={"id", "organization_id", "created_by", "created_at"},
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    await db.commit()
    await db.refresh(skill)

    if changed:
        await log_audit_event(
            db=db,
            event_type="skill_evaluation_updated",
            event_category="training",
            severity="info",
            event_data={
                "skill_id": str(skill.id),
                "name": skill.name,
                "fields": sorted(changed),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return (await _responses(db, org_id, [skill]))[0]


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill_evaluation(
    skill_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a skill evaluation that has never been used.

    Sign-offs, competency history and instructor qualifications reference the
    skill with ``ON DELETE CASCADE``, so deleting a used skill would erase that
    history. A skill with any of it is refused with 409; deactivate it instead.

    **Requires permission: training.manage**
    """
    org_id = str(current_user.organization_id)
    skill = await _get_skill(db, skill_id, org_id)
    for model in (SkillCheckoff, MemberCompetency, InstructorQualification):
        used = (
            await db.execute(
                select(model.id)
                .where(model.skill_evaluation_id == str(skill.id))
                .limit(1)
            )
        ).scalar_one_or_none()
        if used is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This skill has sign-off history. Deactivate it instead so "
                    "the history is kept."
                ),
            )
    name = skill.name
    await db.delete(skill)
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="skill_evaluation_deleted",
        event_category="training",
        severity="warning",
        event_data={"skill_id": str(skill_id), "name": name},
        user_id=str(current_user.id),
        username=current_user.username,
    )


def evaluator_decision(skill: SkillEvaluation, user: User) -> tuple[bool, str]:
    """Whether ``user`` may sign ``skill`` off, and the reason to show.

    The default (nothing configured) resolves ``training.manage`` through the
    same matcher as ``require_permission``, so a wildcard or a rank grant
    counts. It used to read position permissions by hand, which missed both.
    """
    allowed = skill.allowed_evaluators
    if not allowed:
        ok = user_has_permission(user, "training.manage")
        return ok, (
            "Authorized via training.manage permission"
            if ok
            else "Default: requires training.manage permission"
        )
    if allowed.get("type") == "roles":
        required = set(allowed.get("roles") or [])
        held = {p.slug for p in (user.positions or [])}
        matching = sorted(held & required)
        if matching:
            return True, f"Authorized via position(s): {', '.join(matching)}"
        return False, f"Required position(s): {', '.join(sorted(required))}"
    if allowed.get("type") == "specific_users":
        ok = str(user.id) in {str(u) for u in allowed.get("user_ids") or []}
        return ok, (
            "Authorized as designated evaluator"
            if ok
            else "Not in designated evaluators list"
        )
    # An unrecognised shape fails closed.
    return False, "Evaluator rule not recognised"


@router.post("/{skill_id}/check-evaluator", response_model=SkillEvaluatorCheckResponse)
async def check_evaluator_permission(
    skill_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check whether the current user may sign off on a skill evaluation.

    The skill's ``allowed_evaluators`` decides it:
    - ``{"type": "roles", "roles": [...]}`` — holders of those positions
    - ``{"type": "specific_users", "user_ids": [...]}`` — named members
    - ``null`` — anyone holding ``training.manage`` (default)

    **Authentication required**
    """
    skill = await _get_skill(db, skill_id, current_user.organization_id)
    ok, reason = evaluator_decision(skill, current_user)
    return SkillEvaluatorCheckResponse(
        skill_id=skill.id, skill_name=skill.name, is_authorized=ok, reason=reason
    )
