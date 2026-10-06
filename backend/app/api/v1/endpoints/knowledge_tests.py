"""
Online knowledge tests: question bank, delivery and auto-grading.

Officers (``training.manage``) write a test and its questions and publish it;
any member may then sit a published test. The server draws the paper, keeps
the answers to itself until the attempt is submitted, grades it, and records
the score on the member's linked ``knowledge_test`` requirement through
``TrainingProgramService.update_requirement_progress`` — the same path an
officer's typed-in score takes, so ``passing_score`` and ``max_attempts`` hold
the same way for both.
"""

import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.knowledge_test import (
    KnowledgeAttemptStatus,
    KnowledgeTest,
    KnowledgeTestAttempt,
    KnowledgeTestQuestion,
    KnowledgeTestStatus,
)
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import User
from app.schemas.knowledge_test import (
    AnswersUpdate,
    AttemptResponse,
    AttemptSummary,
    KnowledgeTestCreate,
    KnowledgeTestDetail,
    KnowledgeTestResponse,
    KnowledgeTestUpdate,
    OptionAdmin,
    QuestionAdmin,
    QuestionDelivered,
    QuestionReviewed,
    QuestionWrite,
)
from app.utils.model_updates import apply_updates

router = APIRouter()

DEFAULT_PASSING_SCORE = 70.0
# A submission that left the browser just before the clock ran out still
# arrives a moment after it; this much lateness is the network, not cheating.
ANSWER_GRACE_SECONDS = 30
LIST_MAX = 200

_SATISFIED = (
    RequirementProgressStatus.COMPLETED,
    RequirementProgressStatus.VERIFIED,
    RequirementProgressStatus.WAIVED,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _is_officer(user: User) -> bool:
    return user_has_permission(user, "training.manage")


async def _get_test(
    db: AsyncSession, test_id: UUID | str, user: User, *, for_update: bool = False
) -> KnowledgeTest:
    """The test, org-scoped. A member sees only a published one (404 otherwise)."""
    query = (
        select(KnowledgeTest)
        .where(KnowledgeTest.id == str(test_id))
        .where(KnowledgeTest.organization_id == str(user.organization_id))
    )
    if for_update:
        query = query.with_for_update()
    test = (await db.execute(query)).scalar_one_or_none()
    if test is None or (
        not _is_officer(user) and test.status != KnowledgeTestStatus.PUBLISHED.value
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge test not found"
        )
    return test


async def _requirement(
    db: AsyncSession, requirement_id: str | None, org_id: str
) -> TrainingRequirement | None:
    if not requirement_id:
        return None
    return (
        await db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.id == str(requirement_id))
            .where(TrainingRequirement.organization_id == str(org_id))
        )
    ).scalar_one_or_none()


async def _validate_requirement(
    db: AsyncSession, requirement_id: UUID | None, org_id: str
) -> str | None:
    """SEC (XC-1): the linked requirement must be this department's, and a
    knowledge test — a pass completes it, so linking any other kind would let
    a quiz satisfy, say, an hours requirement."""
    if requirement_id is None:
        return None
    requirement = await _requirement(db, str(requirement_id), org_id)
    if requirement is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Requirement not found"
        )
    if requirement.requirement_type != RequirementType.KNOWLEDGE_TEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a knowledge-test requirement can be linked to a test",
        )
    return str(requirement.id)


def _effective_passing(
    test: KnowledgeTest, requirement: TrainingRequirement | None
) -> float:
    """The test's own threshold, else the requirement's, else 70.

    The requirement's own threshold is what an officer-entered score is graded
    against, so a test without one grades the same way.
    """
    if test.passing_score is not None:
        return float(test.passing_score)
    if requirement is not None and requirement.passing_score is not None:
        return float(requirement.passing_score)
    return DEFAULT_PASSING_SCORE


async def _active_questions(db: AsyncSession, test_id: str) -> list:
    return list(
        (
            await db.execute(
                select(KnowledgeTestQuestion)
                .where(KnowledgeTestQuestion.test_id == test_id)
                .where(KnowledgeTestQuestion.active.is_(True))
                .order_by(KnowledgeTestQuestion.sort_order, KnowledgeTestQuestion.id)
            )
        )
        .scalars()
        .all()
    )


def _assert_publishable(test: KnowledgeTest, active_count: int) -> None:
    if active_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A published test needs at least one active question",
        )
    if test.question_count and test.question_count > active_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"The test asks {test.question_count} questions but only "
                f"{active_count} are active"
            ),
        )


def _question_admin(q: KnowledgeTestQuestion) -> QuestionAdmin:
    correct = set(q.correct_option_ids or [])
    return QuestionAdmin(
        id=q.id,
        prompt=q.prompt,
        question_type=q.question_type,
        options=[
            OptionAdmin(id=o["id"], text=o["text"], correct=o["id"] in correct)
            for o in (q.options or [])
        ],
        explanation=q.explanation,
        points=q.points,
        sort_order=q.sort_order,
        active=q.active,
    )


def _summary(attempt: KnowledgeTestAttempt, name: str | None = None) -> AttemptSummary:
    return AttemptSummary(
        id=attempt.id,
        test_id=attempt.test_id,
        user_id=attempt.user_id,
        user_name=name,
        status=attempt.status,
        started_at=attempt.started_at,
        expires_at=attempt.expires_at,
        submitted_at=attempt.submitted_at,
        score=attempt.score,
        passed=attempt.passed,
        credited=bool(attempt.credited),
        credit_note=attempt.credit_note,
    )


async def _test_responses(
    db: AsyncSession, tests: list[KnowledgeTest], user: User, officer: bool
) -> list[KnowledgeTestResponse]:
    ids = [t.id for t in tests]
    if not ids:
        return []
    active_counts = dict(
        (
            await db.execute(
                select(KnowledgeTestQuestion.test_id, func.count())
                .where(KnowledgeTestQuestion.test_id.in_(ids))
                .where(KnowledgeTestQuestion.active.is_(True))
                .group_by(KnowledgeTestQuestion.test_id)
            )
        ).all()
    )
    attempt_counts: dict = {}
    if officer:
        attempt_counts = dict(
            (
                await db.execute(
                    select(KnowledgeTestAttempt.test_id, func.count())
                    .where(KnowledgeTestAttempt.test_id.in_(ids))
                    .group_by(KnowledgeTestAttempt.test_id)
                )
            ).all()
        )
    mine = (
        (
            await db.execute(
                select(KnowledgeTestAttempt)
                .where(KnowledgeTestAttempt.test_id.in_(ids))
                .where(KnowledgeTestAttempt.user_id == str(user.id))
                .order_by(KnowledgeTestAttempt.started_at.desc())
            )
        )
        .scalars()
        .all()
    )
    latest: dict[str, KnowledgeTestAttempt] = {}
    for attempt in mine:
        latest.setdefault(attempt.test_id, attempt)

    req_ids = {t.requirement_id for t in tests if t.requirement_id}
    requirements: dict[str, TrainingRequirement] = {}
    if req_ids:
        requirements = {
            r.id: r
            for r in (
                await db.execute(
                    select(TrainingRequirement)
                    .where(TrainingRequirement.id.in_(sorted(req_ids)))
                    .where(
                        TrainingRequirement.organization_id == str(user.organization_id)
                    )
                )
            )
            .scalars()
            .all()
        }

    out = []
    for t in tests:
        requirement = requirements.get(t.requirement_id) if t.requirement_id else None
        active = int(active_counts.get(t.id, 0))
        resp = KnowledgeTestResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            instructions=t.instructions,
            requirement_id=t.requirement_id,
            requirement_name=requirement.name if requirement else None,
            passing_score=t.passing_score,
            effective_passing_score=_effective_passing(t, requirement),
            time_limit_minutes=t.time_limit_minutes,
            question_count=t.question_count,
            shuffle_questions=bool(t.shuffle_questions),
            show_correct_answers=bool(t.show_correct_answers),
            status=t.status,
            # A member is told how many questions they will be asked, never
            # how big the bank behind them is.
            active_question_count=(
                active if officer else min(active, t.question_count or active)
            ),
            attempt_count=int(attempt_counts.get(t.id, 0)),
            my_latest_attempt=(
                _summary(latest[t.id], user.display_name) if t.id in latest else None
            ),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        out.append(resp)
    return out


async def _detail(
    db: AsyncSession, test: KnowledgeTest, user: User
) -> KnowledgeTestDetail:
    base = (await _test_responses(db, [test], user, officer=True))[0]
    questions = list(
        (
            await db.execute(
                select(KnowledgeTestQuestion)
                .where(KnowledgeTestQuestion.test_id == test.id)
                .order_by(KnowledgeTestQuestion.sort_order, KnowledgeTestQuestion.id)
            )
        )
        .scalars()
        .all()
    )
    return KnowledgeTestDetail(
        **base.model_dump(), questions=[_question_admin(q) for q in questions]
    )


# ---------------------------------------------------------------- grading


def grade_snapshot(
    snapshot: list[dict], answers: dict[str, list[str]]
) -> tuple[float, float, dict[str, bool]]:
    """Score answers against the delivered questions.

    A question scores its full points only when the chosen options are exactly
    the correct set — no partial credit for a multiple-choice question, so
    ticking every box can never earn anything.
    """
    earned = 0.0
    possible = 0.0
    per_question: dict[str, bool] = {}
    for q in snapshot:
        points = float(q.get("points") or 0)
        possible += points
        chosen = set(answers.get(q["id"]) or [])
        right = bool(chosen) and chosen == set(q.get("correct_option_ids") or [])
        per_question[q["id"]] = right
        if right:
            earned += points
    return earned, possible, per_question


def _build_snapshot(test: KnowledgeTest, questions: list) -> list[dict]:
    """Draw and freeze the paper for one attempt."""
    rng = random.Random(secrets.randbits(64))
    chosen = list(questions)
    if test.question_count and test.question_count < len(chosen):
        chosen = rng.sample(chosen, test.question_count)
        # A drawn subset keeps the bank's order unless shuffling is on.
        if not test.shuffle_questions:
            order = {q.id: i for i, q in enumerate(questions)}
            chosen.sort(key=lambda q: order[q.id])
    elif test.shuffle_questions:
        rng.shuffle(chosen)
    snapshot = []
    for q in chosen:
        options = [dict(o) for o in (q.options or [])]
        # True/false keeps its True-then-False order; shuffling it only
        # confuses.
        if test.shuffle_questions and q.question_type != "true_false":
            rng.shuffle(options)
        snapshot.append(
            {
                "id": q.id,
                "prompt": q.prompt,
                "question_type": q.question_type,
                "options": [{"id": o["id"], "text": o["text"]} for o in options],
                "correct_option_ids": list(q.correct_option_ids or []),
                "explanation": q.explanation,
                "points": float(q.points or 1),
            }
        )
    return snapshot


def _attempt_response(
    attempt: KnowledgeTestAttempt,
    test: KnowledgeTest,
    viewer: User,
    owner_name: str | None,
) -> AttemptResponse:
    snapshot = attempt.questions_snapshot or []
    submitted = attempt.status == KnowledgeAttemptStatus.SUBMITTED.value
    delivered = [
        QuestionDelivered(
            id=q["id"],
            prompt=q["prompt"],
            question_type=q["question_type"],
            options=q["options"],
            points=q["points"],
        )
        for q in snapshot
    ]
    review = None
    # SEC: answers and explanations leave the server only after submission,
    # and to the member only when the test was set to show them. An officer
    # reviewing a submitted attempt always sees them.
    if submitted and (attempt.show_correct_answers or _is_officer(viewer)):
        _, _, per_question = grade_snapshot(snapshot, attempt.answers or {})
        review = [
            QuestionReviewed(
                **d.model_dump(),
                correct=per_question.get(d.id, False),
                correct_option_ids=list(q.get("correct_option_ids") or []),
                explanation=q.get("explanation"),
            )
            for d, q in zip(delivered, snapshot)
        ]
    remaining = None
    expires = _utc(attempt.expires_at)
    if expires is not None and not submitted:
        remaining = max(0, int((expires - _now()).total_seconds()))
    summary = _summary(attempt, owner_name)
    return AttemptResponse(
        **summary.model_dump(),
        test_name=test.name,
        instructions=test.instructions,
        passing_score=attempt.passing_score,
        points_earned=attempt.points_earned,
        points_possible=attempt.points_possible,
        answers=attempt.answers or {},
        questions=[] if review is not None else delivered,
        review=review,
        seconds_remaining=remaining,
    )


async def _credit(db: AsyncSession, attempt: KnowledgeTestAttempt, org_id: str) -> None:
    """Record a graded attempt on the member's linked requirement(s).

    Runs after the attempt's grade has committed. ``update_requirement_progress``
    commits internally and enforces ``max_attempts``; a refusal is recorded on
    the attempt rather than raised, because the grade already stands.
    """
    from app.schemas.training_program import RequirementProgressUpdate
    from app.services.training_program_service import TrainingProgramService

    if not attempt.requirement_id:
        return
    rows = (
        (
            await db.execute(
                select(RequirementProgress)
                .join(
                    ProgramEnrollment,
                    RequirementProgress.enrollment_id == ProgramEnrollment.id,
                )
                .where(
                    ProgramEnrollment.user_id == str(attempt.user_id),
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    RequirementProgress.requirement_id == str(attempt.requirement_id),
                )
            )
        )
        .scalars()
        .all()
    )
    notes: list[str] = []
    credited = False
    if not rows:
        notes.append("Not enrolled in a program with this requirement")
    service = TrainingProgramService(db)
    for progress in rows:
        if progress.status in _SATISFIED:
            notes.append("Requirement already satisfied")
            continue
        _, error = await service.update_requirement_progress(
            progress_id=progress.id,
            organization_id=org_id,
            updates=RequirementProgressUpdate(test_score=attempt.score),
            test_attempt_source={"source": "online_test", "attempt_id": attempt.id},
        )
        if error:
            notes.append(error)
        else:
            credited = True
    attempt.credited = credited
    attempt.credit_note = "; ".join(dict.fromkeys(notes))[:500] or None
    await db.commit()


async def _finalize(
    db: AsyncSession, attempt: KnowledgeTestAttempt, org_id: str
) -> None:
    """Grade and close an attempt, then credit it."""
    earned, possible, _ = grade_snapshot(
        attempt.questions_snapshot or [], attempt.answers or {}
    )
    attempt.points_earned = earned
    attempt.points_possible = possible
    attempt.score = round(earned / possible * 100, 2) if possible else 0.0
    attempt.passed = attempt.score >= attempt.passing_score
    attempt.status = KnowledgeAttemptStatus.SUBMITTED.value
    attempt.submitted_at = _now()
    await db.commit()
    try:
        await _credit(db, attempt, org_id)
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Knowledge test credit failed for attempt {attempt.id}: {e}")
        await db.rollback()
        attempt.credit_note = "Could not record the score on the requirement"
        await db.commit()


def _expired(attempt: KnowledgeTestAttempt, grace: int = 0) -> bool:
    expires = _utc(attempt.expires_at)
    return expires is not None and _now() > expires + timedelta(seconds=grace)


async def _load_attempt(
    db: AsyncSession, attempt_id: UUID, user: User, *, owner_only: bool
) -> tuple[KnowledgeTestAttempt, KnowledgeTest]:
    attempt = (
        await db.execute(
            select(KnowledgeTestAttempt)
            .where(KnowledgeTestAttempt.id == str(attempt_id))
            .where(KnowledgeTestAttempt.organization_id == str(user.organization_id))
            .with_for_update()
        )
    ).scalar_one_or_none()
    allowed = attempt is not None and (
        str(attempt.user_id) == str(user.id) or (not owner_only and _is_officer(user))
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attempt not found"
        )
    test = (
        await db.execute(
            select(KnowledgeTest).where(KnowledgeTest.id == attempt.test_id)
        )
    ).scalar_one()
    return attempt, test


async def _owner_name(db: AsyncSession, user_id: str, org_id: str) -> str | None:
    owner = (
        await db.execute(
            select(User).where(User.id == user_id, User.organization_id == org_id)
        )
    ).scalar_one_or_none()
    return owner.display_name if owner else None


# ---------------------------------------------------------------- attempts
# Declared before the /{test_id} routes so "attempts" is never read as an id.


@router.get("/attempts/{attempt_id}", response_model=AttemptResponse)
async def get_attempt(
    attempt_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get an attempt: the questions while it is open, the result once submitted.

    The member who sat it, or an officer. A timed attempt whose clock has run
    out is graded on the answers saved so far.

    **Authentication required**
    """
    attempt, test = await _load_attempt(db, attempt_id, current_user, owner_only=False)
    if attempt.status == KnowledgeAttemptStatus.IN_PROGRESS.value and _expired(attempt):
        await _finalize(db, attempt, str(current_user.organization_id))
    return _attempt_response(
        attempt,
        test,
        current_user,
        await _owner_name(db, attempt.user_id, str(current_user.organization_id)),
    )


@router.put("/attempts/{attempt_id}/answers", response_model=AttemptResponse)
async def save_answers(
    attempt_id: UUID,
    data: AnswersUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Save answers on an open attempt (replaces the saved set).

    Only the member sitting it. Refused once submitted or out of time.

    **Authentication required**
    """
    attempt, test = await _load_attempt(db, attempt_id, current_user, owner_only=True)
    if attempt.status != KnowledgeAttemptStatus.IN_PROGRESS.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This attempt is submitted"
        )
    if _expired(attempt, ANSWER_GRACE_SECONDS):
        await _finalize(db, attempt, str(current_user.organization_id))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Time is up. The answers saved before it ran out were graded.",
        )
    questions = {q["id"]: q for q in attempt.questions_snapshot or []}
    cleaned: dict[str, list[str]] = {}
    for qid, chosen in data.answers.items():
        q = questions.get(qid)
        if q is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An answer refers to a question not on this paper",
            )
        valid = {o["id"] for o in q["options"]}
        picks = list(dict.fromkeys(chosen))
        if any(p not in valid for p in picks):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An answer refers to an option not on this question",
            )
        if q["question_type"] != "multiple_choice" and len(picks) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Choose one option for this question",
            )
        if picks:
            cleaned[qid] = picks
    attempt.answers = cleaned
    await db.commit()
    await db.refresh(attempt)
    return _attempt_response(attempt, test, current_user, current_user.display_name)


@router.post("/attempts/{attempt_id}/submit", response_model=AttemptResponse)
async def submit_attempt(
    attempt_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit an attempt for grading. Idempotent: a submitted attempt is returned.

    The score is computed here from the saved answers; nothing the client sends
    is taken as a score.

    **Authentication required**
    """
    attempt, test = await _load_attempt(db, attempt_id, current_user, owner_only=True)
    if attempt.status == KnowledgeAttemptStatus.IN_PROGRESS.value:
        await _finalize(db, attempt, str(current_user.organization_id))
        await log_audit_event(
            db=db,
            event_type="knowledge_test_submitted",
            event_category="training",
            severity="info",
            event_data={
                "attempt_id": attempt.id,
                "test_id": test.id,
                "score": attempt.score,
                "passed": attempt.passed,
                "credited": attempt.credited,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return _attempt_response(attempt, test, current_user, current_user.display_name)


# ---------------------------------------------------------------- tests


@router.get("", response_model=list[KnowledgeTestResponse])
async def list_knowledge_tests(
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List knowledge tests. Officers see every status; members see published
    tests only, each with their own latest attempt.

    **Authentication required**
    """
    officer = _is_officer(current_user)
    query = select(KnowledgeTest).where(
        KnowledgeTest.organization_id == str(current_user.organization_id)
    )
    if not officer:
        query = query.where(KnowledgeTest.status == KnowledgeTestStatus.PUBLISHED.value)
    elif status_filter:
        query = query.where(KnowledgeTest.status == status_filter)
    tests = list(
        (
            await db.execute(
                query.order_by(KnowledgeTest.name, KnowledgeTest.id).limit(LIST_MAX)
            )
        )
        .scalars()
        .all()
    )
    return await _test_responses(db, tests, current_user, officer)


@router.post(
    "", response_model=KnowledgeTestDetail, status_code=status.HTTP_201_CREATED
)
async def create_knowledge_test(
    data: KnowledgeTestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Create a knowledge test (as a draft).

    **Requires permission: training.manage**
    """
    org_id = str(current_user.organization_id)
    test = KnowledgeTest(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        instructions=data.instructions,
        requirement_id=await _validate_requirement(db, data.requirement_id, org_id),
        passing_score=data.passing_score,
        time_limit_minutes=data.time_limit_minutes,
        question_count=data.question_count,
        shuffle_questions=data.shuffle_questions,
        show_correct_answers=data.show_correct_answers,
        status=KnowledgeTestStatus.DRAFT.value,
        created_by=str(current_user.id),
    )
    db.add(test)
    await db.commit()
    await db.refresh(test)
    await log_audit_event(
        db=db,
        event_type="knowledge_test_created",
        event_category="training",
        severity="info",
        event_data={"test_id": test.id, "name": test.name},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return await _detail(db, test, current_user)


@router.get("/{test_id}", response_model=KnowledgeTestDetail | KnowledgeTestResponse)
async def get_knowledge_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a knowledge test. Officers receive the question bank with its answers;
    a member receives the published test's details and no questions.

    **Authentication required**
    """
    test = await _get_test(db, test_id, current_user)
    if _is_officer(current_user):
        return await _detail(db, test, current_user)
    return (await _test_responses(db, [test], current_user, officer=False))[0]


@router.patch("/{test_id}", response_model=KnowledgeTestDetail)
async def update_knowledge_test(
    test_id: UUID,
    data: KnowledgeTestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Edit a test's settings, or publish / archive it via ``status``.

    Editing a published test does not change attempts already started: each
    attempt grades against the questions and threshold it was given.

    **Requires permission: training.manage**
    """
    org_id = str(current_user.organization_id)
    test = await _get_test(db, test_id, current_user, for_update=True)
    updates = data.model_dump(exclude_unset=True)
    if "requirement_id" in updates:
        updates["requirement_id"] = await _validate_requirement(
            db, updates["requirement_id"], org_id
        )
    try:
        changed = apply_updates(
            test, updates, skip={"id", "organization_id", "created_by"}
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if test.status == KnowledgeTestStatus.PUBLISHED.value:
        _assert_publishable(test, len(await _active_questions(db, test.id)))
    await db.commit()
    await db.refresh(test)
    if changed:
        await log_audit_event(
            db=db,
            event_type="knowledge_test_updated",
            event_category="training",
            severity="info",
            event_data={"test_id": test.id, "fields": sorted(changed)},
            user_id=str(current_user.id),
            username=current_user.username,
        )
    return await _detail(db, test, current_user)


@router.delete("/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_test(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a test nobody has sat. A test with attempts is refused with 409 —
    the attempts are members' results — and should be archived instead.

    **Requires permission: training.manage**
    """
    test = await _get_test(db, test_id, current_user, for_update=True)
    sat = (
        await db.execute(
            select(KnowledgeTestAttempt.id)
            .where(KnowledgeTestAttempt.test_id == test.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if sat is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Members have sat this test. Archive it instead to keep their results.",
        )
    name = test.name
    await db.delete(test)
    await db.commit()
    await log_audit_event(
        db=db,
        event_type="knowledge_test_deleted",
        event_category="training",
        severity="warning",
        event_data={"test_id": str(test_id), "name": name},
        user_id=str(current_user.id),
        username=current_user.username,
    )


# ---------------------------------------------------------------- questions


def _question_fields(data: QuestionWrite) -> dict:
    options = [
        {"id": o.id or uuid.uuid4().hex[:12], "text": o.text.strip()}
        for o in data.options
    ]
    correct = [opt["id"] for opt, o in zip(options, data.options) if o.correct]
    return {
        "prompt": data.prompt.strip(),
        "question_type": data.question_type,
        "options": options,
        "correct_option_ids": correct,
        "explanation": (data.explanation or "").strip() or None,
        "points": data.points,
        "active": data.active,
    }


async def _get_question(
    db: AsyncSession, test: KnowledgeTest, question_id: UUID
) -> KnowledgeTestQuestion:
    question = (
        await db.execute(
            select(KnowledgeTestQuestion)
            .where(KnowledgeTestQuestion.id == str(question_id))
            .where(KnowledgeTestQuestion.test_id == test.id)
            .where(KnowledgeTestQuestion.organization_id == test.organization_id)
        )
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found"
        )
    return question


@router.post(
    "/{test_id}/questions",
    response_model=KnowledgeTestDetail,
    status_code=status.HTTP_201_CREATED,
)
async def add_question(
    test_id: UUID,
    data: QuestionWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Add a question to a test's bank.

    **Requires permission: training.manage**
    """
    test = await _get_test(db, test_id, current_user, for_update=True)
    existing = (
        await db.execute(
            select(func.count(), func.max(KnowledgeTestQuestion.sort_order)).where(
                KnowledgeTestQuestion.test_id == test.id
            )
        )
    ).one()
    from app.schemas.knowledge_test import MAX_QUESTIONS_PER_TEST

    if (existing[0] or 0) >= MAX_QUESTIONS_PER_TEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A test holds at most {MAX_QUESTIONS_PER_TEST} questions",
        )
    fields = _question_fields(data)
    question = KnowledgeTestQuestion(
        organization_id=test.organization_id,
        test_id=test.id,
        sort_order=(
            data.sort_order if data.sort_order is not None else (existing[1] or 0) + 1
        ),
        **fields,
    )
    db.add(question)
    await db.commit()
    return await _detail(db, test, current_user)


@router.put("/{test_id}/questions/{question_id}", response_model=KnowledgeTestDetail)
async def replace_question(
    test_id: UUID,
    question_id: UUID,
    data: QuestionWrite,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Replace a question. Attempts already started keep the version they were
    given.

    **Requires permission: training.manage**
    """
    test = await _get_test(db, test_id, current_user, for_update=True)
    question = await _get_question(db, test, question_id)
    for key, value in _question_fields(data).items():
        setattr(question, key, value)
    if data.sort_order is not None:
        question.sort_order = data.sort_order
    await db.flush()
    if test.status == KnowledgeTestStatus.PUBLISHED.value:
        _assert_publishable(test, len(await _active_questions(db, test.id)))
    await db.commit()
    return await _detail(db, test, current_user)


@router.delete("/{test_id}/questions/{question_id}", response_model=KnowledgeTestDetail)
async def delete_question(
    test_id: UUID,
    question_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """
    Delete a question. Attempts that were given it keep their copy.

    **Requires permission: training.manage**
    """
    test = await _get_test(db, test_id, current_user, for_update=True)
    question = await _get_question(db, test, question_id)
    await db.delete(question)
    await db.flush()
    if test.status == KnowledgeTestStatus.PUBLISHED.value:
        _assert_publishable(test, len(await _active_questions(db, test.id)))
    await db.commit()
    return await _detail(db, test, current_user)


# ---------------------------------------------------------------- sitting


async def _assert_attempts_remaining(
    db: AsyncSession, user_id: str, requirement: TrainingRequirement | None
) -> None:
    """Refuse to start an attempt the requirement's cap would not credit.

    Attempts are counted where an officer-entered score counts them — on the
    member's requirement progress — so the online test and the officer's typed
    score draw on one allowance. A satisfied requirement is not rationed.
    """
    if requirement is None or not requirement.max_attempts:
        return
    from app.services.skills_testing_service import lock_attempt_capacity

    await lock_attempt_capacity(db, requirement.id)
    rows = (
        (
            await db.execute(
                select(RequirementProgress)
                .join(
                    ProgramEnrollment,
                    RequirementProgress.enrollment_id == ProgramEnrollment.id,
                )
                .where(
                    ProgramEnrollment.user_id == user_id,
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    RequirementProgress.requirement_id == requirement.id,
                )
                .with_for_update(of=RequirementProgress)
            )
        )
        .scalars()
        .all()
    )
    if not rows or any(r.status in _SATISFIED for r in rows):
        return
    spent = max(len((r.progress_notes or {}).get("test_attempts", [])) for r in rows)
    if spent >= requirement.max_attempts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum attempts ({requirement.max_attempts}) reached for this test",
        )


@router.post(
    "/{test_id}/attempts",
    response_model=AttemptResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_attempt(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Start (or resume) sitting a published test.

    A member has at most one open attempt per test; starting again returns it.
    The paper is drawn and frozen now, and the correct answers are not sent.

    **Authentication required**
    """
    org_id = str(current_user.organization_id)
    test = await _get_test(db, test_id, current_user, for_update=True)
    if test.status != KnowledgeTestStatus.PUBLISHED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a published test can be sat",
        )
    open_attempt = (
        await db.execute(
            select(KnowledgeTestAttempt)
            .where(KnowledgeTestAttempt.test_id == test.id)
            .where(KnowledgeTestAttempt.user_id == str(current_user.id))
            .where(
                KnowledgeTestAttempt.status == KnowledgeAttemptStatus.IN_PROGRESS.value
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if open_attempt is not None:
        if not _expired(open_attempt):
            return _attempt_response(
                open_attempt, test, current_user, current_user.display_name
            )
        # Its clock ran out unattended: grade what was saved, then start anew.
        await _finalize(db, open_attempt, org_id)
        test = await _get_test(db, test_id, current_user, for_update=True)

    requirement = await _requirement(db, test.requirement_id, org_id)
    await _assert_attempts_remaining(db, str(current_user.id), requirement)

    questions = await _active_questions(db, test.id)
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This test has no questions yet",
        )
    started = _now()
    attempt = KnowledgeTestAttempt(
        organization_id=org_id,
        test_id=test.id,
        user_id=str(current_user.id),
        status=KnowledgeAttemptStatus.IN_PROGRESS.value,
        started_at=started,
        expires_at=(
            started + timedelta(minutes=test.time_limit_minutes)
            if test.time_limit_minutes
            else None
        ),
        questions_snapshot=_build_snapshot(test, questions),
        answers={},
        passing_score=_effective_passing(test, requirement),
        requirement_id=test.requirement_id,
        show_correct_answers=bool(test.show_correct_answers),
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return _attempt_response(attempt, test, current_user, current_user.display_name)


@router.get("/{test_id}/attempts", response_model=list[AttemptSummary])
async def list_attempts(
    test_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Attempts at a test, newest first. Officers see everyone's; a member sees
    their own.

    **Authentication required**
    """
    test = await _get_test(db, test_id, current_user)
    query = (
        select(KnowledgeTestAttempt, User)
        .join(User, User.id == KnowledgeTestAttempt.user_id)
        .where(KnowledgeTestAttempt.test_id == test.id)
        .where(
            KnowledgeTestAttempt.organization_id == str(current_user.organization_id)
        )
    )
    if not _is_officer(current_user):
        query = query.where(KnowledgeTestAttempt.user_id == str(current_user.id))
    rows = (
        await db.execute(
            query.order_by(KnowledgeTestAttempt.started_at.desc()).limit(LIST_MAX)
        )
    ).all()
    return [_summary(attempt, user.display_name) for attempt, user in rows]
