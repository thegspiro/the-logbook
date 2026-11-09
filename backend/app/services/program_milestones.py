"""Training program milestones: when one is reached, and who is told.

A milestone has up to two triggers, joined by AND:

* a percentage of the program complete (``completion_percentage_threshold``),
  read from the enrollment's rolled-up progress, and
* completion items — courses, skills tests and knowledge tests — combined by
  the milestone's ``item_match_mode`` ("all" or "any").

What "complete" means for an item:

* **Course** — a training record for that course with status completed, not
  voided and not marked failed. Records waiting on an officer are
  submissions, not records, so they do not exist here until approved.
* **Skills test** — an official (non-practice) test of that skill template,
  completed with a pass and validated by an officer. The same rule credits
  a pipeline requirement (``apply_test_pass_to_pipeline``).
* **Knowledge test** — a submitted attempt that passed. Knowledge tests are
  graded automatically, so there is no review step to wait for.

Unless the milestone ``counts_prior_completions``, an item counts only when
completed on or after the start of the member's current cycle.

Each (milestone, enrollment) pair is reached at most once:
``ProgramMilestoneAchievement`` is unique on the pair, and the row is
committed *before* anything is sent. A crash between the two loses the
notice rather than repeating it (at most once), which is the order that
holds up when the progress write, a test hook and the scheduled sweep all
evaluate the same member at the same moment — whichever insert lands first
is the only one that sends.

When a milestone is created, or its triggers edited, enrollments that already
meet it get a ``skipped`` row, so nobody is told about an accomplishment that
is not news. A cycle reset deletes an enrollment's rows so the new cycle earns
its milestones again.

Delivery follows pitfall #18. The member is emailed (training reminders
kind) and always gets the bell notice they had before email existed; other
recipients are emailed (training duties kind) and get the bell notice
instead when they have turned that email off, or it could not be sent.
Never SMS.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.knowledge_test import (
    KnowledgeAttemptStatus,
    KnowledgeTest,
    KnowledgeTestAttempt,
    KnowledgeTestStatus,
)
from app.models.notification import NotificationCategory, NotificationChannel
from app.models.skills_testing import (
    SkillTemplate,
    SkillTemplateStatus,
    SkillTest,
    SkillTestResult,
    SkillTestStatus,
)
from app.models.training import (
    EnrollmentStatus,
    MilestoneAchievementOutcome,
    MilestoneItemMatchMode,
    MilestoneItemType,
    ProgramEnrollment,
    ProgramMilestone,
    ProgramMilestoneAchievement,
    ProgramMilestoneItem,
    TrainingCourse,
    TrainingProgram,
    TrainingRecord,
    TrainingStatus,
)
from app.models.user import (
    ACTIVE_ACCOUNT_STATUSES,
    Organization,
    Position,
    User,
    user_positions,
)
from app.utils.org_timezone import local_date, resolve_scheduling_timezone

# Enrollments a milestone is baselined against when it is created or edited.
# On-hold members are included so that resuming does not announce something
# they had already done before the milestone existed.
BASELINE_STATUSES = (EnrollmentStatus.ACTIVE, EnrollmentStatus.ON_HOLD)

# The key a completion is looked up by: (user id, item type, target id).
CompletionKey = Tuple[str, str, str]


# --------------------------------------------------------------------------
# Small helpers


def _as_utc(value: datetime) -> datetime:
    """MySQL hands DATETIME back naive; every stored timestamp is UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a name would end it.
    return " ".join((text or "").split())


def _absolute(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def item_target_id(item: ProgramMilestoneItem) -> Optional[str]:
    if item.item_type == MilestoneItemType.COURSE.value:
        return item.course_id
    if item.item_type == MilestoneItemType.SKILL_TEST.value:
        return item.skill_template_id
    if item.item_type == MilestoneItemType.KNOWLEDGE_TEST.value:
        return item.knowledge_test_id
    return None


def build_item(item_type: str, target_id: str, sort_order: int) -> ProgramMilestoneItem:
    """An unsaved item row with exactly the one target column its type uses."""
    item = ProgramMilestoneItem(item_type=item_type, sort_order=sort_order)
    if item_type == MilestoneItemType.COURSE.value:
        item.course_id = target_id
    elif item_type == MilestoneItemType.SKILL_TEST.value:
        item.skill_template_id = target_id
    elif item_type == MilestoneItemType.KNOWLEDGE_TEST.value:
        item.knowledge_test_id = target_id
    else:
        raise ValueError(f"Unknown milestone item type: {item_type}")
    return item


def match_mode(milestone: ProgramMilestone) -> str:
    """The stored mode, read defensively: anything but "any" means "all",
    the stricter reading and the column's default."""
    if milestone.item_match_mode == MilestoneItemMatchMode.ANY.value:
        return MilestoneItemMatchMode.ANY.value
    return MilestoneItemMatchMode.ALL.value


def has_trigger(milestone: ProgramMilestone, items: Sequence[Any]) -> bool:
    return milestone.completion_percentage_threshold is not None or bool(items)


# --------------------------------------------------------------------------
# Validation of client-supplied ids (pitfall #14c)


_ITEM_MODELS: Dict[str, Any] = {
    MilestoneItemType.COURSE.value: TrainingCourse,
    MilestoneItemType.SKILL_TEST.value: SkillTemplate,
    MilestoneItemType.KNOWLEDGE_TEST.value: KnowledgeTest,
}

_ITEM_LABELS: Dict[str, str] = {
    MilestoneItemType.COURSE.value: "course",
    MilestoneItemType.SKILL_TEST.value: "skills test",
    MilestoneItemType.KNOWLEDGE_TEST.value: "knowledge test",
}


async def validate_items(
    db: AsyncSession, organization_id: str, items: Iterable[Tuple[str, str]]
) -> List[Tuple[str, str]]:
    """Check every (type, id) names a course or test in this department.

    Raises ``ValueError`` (a 400) naming how many of a kind were not found,
    rather than storing a reference to something the department cannot see.
    """
    wanted: Dict[str, Set[str]] = {}
    ordered: List[Tuple[str, str]] = []
    for item_type, target_id in items:
        if item_type not in _ITEM_MODELS:
            raise ValueError(f"Unknown milestone item type: {item_type}")
        wanted.setdefault(item_type, set()).add(str(target_id))
        ordered.append((item_type, str(target_id)))
    for item_type, ids in wanted.items():
        model = _ITEM_MODELS[item_type]
        found = set(
            (
                await db.execute(
                    select(model.id).where(
                        model.id.in_(list(ids)),
                        model.organization_id == str(organization_id),
                    )
                )
            )
            .scalars()
            .all()
        )
        missing = ids - {str(f) for f in found}
        if missing:
            label = _ITEM_LABELS[item_type]
            plural = "s" if len(missing) > 1 else ""
            raise ValueError(f"{len(missing)} {label}{plural} not found")
    return ordered


async def validate_positions(
    db: AsyncSession, organization_id: str, position_ids: Iterable[Any]
) -> List[str]:
    ids = [str(p) for p in position_ids]
    if not ids:
        return []
    found = set(
        (
            await db.execute(
                select(Position.id).where(
                    Position.id.in_(ids),
                    Position.organization_id == str(organization_id),
                )
            )
        )
        .scalars()
        .all()
    )
    if set(ids) - {str(f) for f in found}:
        raise ValueError("A position chosen to notify was not found")
    return ids


async def validate_users(
    db: AsyncSession, organization_id: str, user_ids: Iterable[Any]
) -> List[str]:
    ids = [str(u) for u in user_ids]
    if not ids:
        return []
    found = set(
        (
            await db.execute(
                select(User.id).where(
                    User.id.in_(ids),
                    User.organization_id == str(organization_id),
                    User.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if set(ids) - {str(f) for f in found}:
        raise ValueError("A member chosen to notify was not found")
    return ids


# --------------------------------------------------------------------------
# Serialization for the API


async def _names(
    db: AsyncSession, model: Any, ids: Set[str], organization_id: str
) -> Dict[str, str]:
    if not ids:
        return {}
    rows = await db.execute(
        select(model.id, model.name).where(
            model.id.in_(list(ids)), model.organization_id == str(organization_id)
        )
    )
    return {str(i): n for i, n in rows.all()}


async def _user_names(
    db: AsyncSession, ids: Set[str], organization_id: str
) -> Dict[str, str]:
    if not ids:
        return {}
    rows = await db.execute(
        select(User).where(
            User.id.in_(list(ids)), User.organization_id == str(organization_id)
        )
    )
    return {str(u.id): u.display_name for u in rows.scalars().all()}


async def load_milestones(
    db: AsyncSession, program_id: str, milestone_ids: Optional[List[str]] = None
) -> List[ProgramMilestone]:
    """A program's milestones with their items, in a stable order."""
    query = (
        select(ProgramMilestone)
        .options(selectinload(ProgramMilestone.items))
        .where(ProgramMilestone.program_id == str(program_id))
        .order_by(
            ProgramMilestone.completion_percentage_threshold.is_(None),
            ProgramMilestone.completion_percentage_threshold,
            ProgramMilestone.created_at,
        )
    )
    if milestone_ids is not None:
        query = query.where(ProgramMilestone.id.in_(milestone_ids))
    return list((await db.execute(query)).scalars().all())


async def item_names(
    db: AsyncSession, organization_id: str, items: Iterable[ProgramMilestoneItem]
) -> Dict[Tuple[str, str], str]:
    by_type: Dict[str, Set[str]] = {}
    for item in items:
        target = item_target_id(item)
        if target:
            by_type.setdefault(item.item_type, set()).add(str(target))
    names: Dict[Tuple[str, str], str] = {}
    for item_type, ids in by_type.items():
        for target_id, name in (
            await _names(db, _ITEM_MODELS[item_type], ids, organization_id)
        ).items():
            names[(item_type, target_id)] = name
    return names


async def serialize_milestones(
    db: AsyncSession, organization_id: str, milestones: Sequence[ProgramMilestone]
) -> List[Dict[str, Any]]:
    """Milestones as ``ProgramMilestoneResponse`` dicts, names resolved.

    Items must already be loaded (``load_milestones``); a milestone row whose
    items were never loaded would otherwise lazy-load outside the greenlet.
    """
    all_items = [item for m in milestones for item in m.items]
    names = await item_names(db, organization_id, all_items)
    position_ids = {str(p) for m in milestones for p in (m.notify_position_ids or [])}
    user_ids = {str(u) for m in milestones for u in (m.notify_user_ids or [])}
    position_names = await _names(db, Position, position_ids, organization_id)
    user_names = await _user_names(db, user_ids, organization_id)

    out: List[Dict[str, Any]] = []
    for m in milestones:
        out.append(
            {
                "id": m.id,
                "program_id": m.program_id,
                "phase_id": m.phase_id,
                "name": m.name,
                "description": m.description,
                "completion_percentage_threshold": m.completion_percentage_threshold,
                "notification_message": m.notification_message,
                "created_at": m.created_at,
                "items": [
                    {
                        "id": item.id,
                        "item_type": item.item_type,
                        "item_id": item_target_id(item),
                        "name": names.get((item.item_type, str(item_target_id(item)))),
                    }
                    for item in m.items
                    if item_target_id(item)
                ],
                "item_match_mode": match_mode(m),
                "counts_prior_completions": bool(m.counts_prior_completions),
                "notify_member": m.notify_member is not False,
                "notify_positions": [
                    {"id": p, "name": position_names.get(str(p))}
                    for p in (m.notify_position_ids or [])
                ],
                "notify_users": [
                    {"id": u, "name": user_names.get(str(u))}
                    for u in (m.notify_user_ids or [])
                ],
                "officer_message": m.officer_message,
            }
        )
    return out


def member_milestone_view(payload: Dict[str, Any]) -> Dict[str, Any]:
    """A milestone as a member may see it: who else is told, and what they
    are told, is officer business."""
    return {
        **payload,
        "notify_positions": [],
        "notify_users": [],
        "officer_message": None,
    }


# --------------------------------------------------------------------------
# Completions


@dataclass
class _Completions:
    """Latest qualifying completion per (user, item type, target).

    Records are dated (``date``); tests carry a timestamp (``datetime``).
    Keeping the latest is enough: an item counts when any completion is
    recent enough, and the latest is the most recent one there is.
    """

    latest: Dict[CompletionKey, Any] = field(default_factory=dict)

    def note(self, key: CompletionKey, when: Any) -> None:
        if when is None:
            return
        current = self.latest.get(key)
        if current is None or _sort_key(when) > _sort_key(current):
            self.latest[key] = when

    def counts(
        self,
        key: CompletionKey,
        cycle_start: Optional[datetime],
        tz: ZoneInfo,
        include_prior: bool,
    ) -> bool:
        when = self.latest.get(key)
        if when is None:
            return False
        if include_prior or cycle_start is None:
            return True
        if isinstance(when, datetime):
            return _as_utc(when) >= _as_utc(cycle_start)
        # A record is dated on the department's calendar, so the cycle's
        # start is compared as the department's date of that moment: an
        # evening enrollment's UTC date is already tomorrow.
        return bool(when >= local_date(cycle_start, tz))


def _sort_key(value: Any) -> datetime:
    if isinstance(value, datetime):
        return _as_utc(value)
    return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)


async def load_completions(
    db: AsyncSession,
    organization_id: str,
    user_ids: Iterable[str],
    items: Iterable[ProgramMilestoneItem],
) -> _Completions:
    users = list({str(u) for u in user_ids})
    targets: Dict[str, Set[str]] = {}
    for item in items:
        target = item_target_id(item)
        if target:
            targets.setdefault(item.item_type, set()).add(str(target))
    completions = _Completions()
    if not users or not targets:
        return completions

    course_ids = targets.get(MilestoneItemType.COURSE.value)
    if course_ids:
        course_rows = await db.execute(
            select(
                TrainingRecord.user_id,
                TrainingRecord.course_id,
                TrainingRecord.completion_date,
                TrainingRecord.created_at,
            ).where(
                TrainingRecord.organization_id == str(organization_id),
                TrainingRecord.user_id.in_(users),
                TrainingRecord.course_id.in_(list(course_ids)),
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.voided_at.is_(None),
                # NULL is "not recorded", which a completed record usually is.
                func.coalesce(TrainingRecord.passed, True).is_(True),
            )
        )
        for user_id, course_id, completed_on, created_at in course_rows.all():
            when = completed_on or (
                _as_utc(created_at).date() if created_at is not None else None
            )
            completions.note(
                (str(user_id), MilestoneItemType.COURSE.value, str(course_id)), when
            )

    template_ids = targets.get(MilestoneItemType.SKILL_TEST.value)
    if template_ids:
        skill_rows = await db.execute(
            select(
                SkillTest.candidate_id,
                SkillTest.template_id,
                SkillTest.completed_at,
                SkillTest.validated_at,
            ).where(
                SkillTest.organization_id == str(organization_id),
                SkillTest.candidate_id.in_(users),
                SkillTest.template_id.in_(list(template_ids)),
                SkillTest.status == SkillTestStatus.COMPLETED.value,
                SkillTest.result == SkillTestResult.PASS.value,
                func.coalesce(SkillTest.is_practice, False).is_(False),
                SkillTest.validated_at.is_not(None),
            )
        )
        for user_id, template_id, completed_at, validated_at in skill_rows.all():
            completions.note(
                (str(user_id), MilestoneItemType.SKILL_TEST.value, str(template_id)),
                completed_at or validated_at,
            )

    test_ids = targets.get(MilestoneItemType.KNOWLEDGE_TEST.value)
    if test_ids:
        knowledge_rows = await db.execute(
            select(
                KnowledgeTestAttempt.user_id,
                KnowledgeTestAttempt.test_id,
                KnowledgeTestAttempt.submitted_at,
            ).where(
                KnowledgeTestAttempt.organization_id == str(organization_id),
                KnowledgeTestAttempt.user_id.in_(users),
                KnowledgeTestAttempt.test_id.in_(list(test_ids)),
                KnowledgeTestAttempt.status == KnowledgeAttemptStatus.SUBMITTED.value,
                KnowledgeTestAttempt.passed.is_(True),
            )
        )
        for user_id, test_id, submitted_at in knowledge_rows.all():
            completions.note(
                (str(user_id), MilestoneItemType.KNOWLEDGE_TEST.value, str(test_id)),
                submitted_at,
            )
    return completions


# --------------------------------------------------------------------------
# Evaluation


@dataclass
class MilestoneStanding:
    percentage_met: bool
    items_done: List[Tuple[ProgramMilestoneItem, bool]]
    met: bool


def standing(
    milestone: ProgramMilestone,
    enrollment: ProgramEnrollment,
    completions: _Completions,
    tz: ZoneInfo,
) -> MilestoneStanding:
    threshold = milestone.completion_percentage_threshold
    percentage_met = threshold is None or (enrollment.progress_percentage or 0.0) >= (
        threshold
    )
    cycle_start = enrollment.cycle_started_at or enrollment.enrolled_at
    items = [i for i in milestone.items if item_target_id(i)]
    items_done = [
        (
            item,
            completions.counts(
                (str(enrollment.user_id), item.item_type, str(item_target_id(item))),
                cycle_start,
                tz,
                bool(milestone.counts_prior_completions),
            ),
        )
        for item in items
    ]
    if not items:
        items_met = True
    elif match_mode(milestone) == MilestoneItemMatchMode.ANY.value:
        items_met = any(done for _, done in items_done)
    else:
        items_met = all(done for _, done in items_done)
    # A milestone with neither trigger cannot be saved; one left that way by a
    # deleted course must not read as reached by everybody.
    met = percentage_met and items_met and has_trigger(milestone, items)
    return MilestoneStanding(percentage_met, items_done, met)


async def _record(
    db: AsyncSession, milestone_id: str, enrollment_id: str, outcome: str
) -> bool:
    """Insert the achievement row; False when another writer got there first."""
    try:
        async with db.begin_nested():
            db.add(
                ProgramMilestoneAchievement(
                    milestone_id=milestone_id,
                    enrollment_id=enrollment_id,
                    outcome=outcome,
                )
            )
            await db.flush()
    except IntegrityError:
        return False
    return True


async def _achieved_pairs(
    db: AsyncSession, enrollment_ids: List[str]
) -> Set[Tuple[str, str]]:
    if not enrollment_ids:
        return set()
    rows = await db.execute(
        select(
            ProgramMilestoneAchievement.milestone_id,
            ProgramMilestoneAchievement.enrollment_id,
        ).where(ProgramMilestoneAchievement.enrollment_id.in_(enrollment_ids))
    )
    return {(str(m), str(e)) for m, e in rows.all()}


async def process_enrollments(
    db: AsyncSession,
    enrollment_ids: Iterable[Any],
    *,
    any_status: bool = False,
) -> int:
    """Record and announce every milestone these enrollments newly meet.

    Only ACTIVE enrollments are considered unless ``any_status``: the progress
    rollup passes it for an enrollment that was active before the write which
    completed it, so the 100% milestone is still announced. Commits. Returns
    the number of milestones newly reached.
    """
    ids = list({str(e) for e in enrollment_ids})
    if not ids:
        return 0
    query = (
        select(ProgramEnrollment).where(ProgramEnrollment.id.in_(ids))
        # The rollup writes progress with UPDATE statements, so an enrollment
        # already in the session would otherwise keep its old percentage.
        .execution_options(populate_existing=True)
    )
    if not any_status:
        query = query.where(ProgramEnrollment.status == EnrollmentStatus.ACTIVE)
    enrollments = list((await db.execute(query)).scalars().all())
    if not enrollments:
        return 0

    reached = 0
    by_program: Dict[str, List[ProgramEnrollment]] = {}
    for enrollment in enrollments:
        by_program.setdefault(str(enrollment.program_id), []).append(enrollment)
    achieved = await _achieved_pairs(db, [str(e.id) for e in enrollments])

    for program_id, program_enrollments in by_program.items():
        milestones = await load_milestones(db, program_id)
        pending = [
            (m, e)
            for e in program_enrollments
            for m in milestones
            if (str(m.id), str(e.id)) not in achieved
        ]
        if not pending:
            continue
        organization_id = str(program_enrollments[0].organization_id)
        tz = await resolve_scheduling_timezone(db, organization_id)
        completions = await load_completions(
            db,
            organization_id,
            [str(e.user_id) for _, e in pending],
            [item for m, _ in pending for item in m.items],
        )
        newly: List[Tuple[ProgramMilestone, ProgramEnrollment]] = []
        for milestone, enrollment in pending:
            if not standing(milestone, enrollment, completions, tz).met:
                continue
            if await _record(
                db,
                str(milestone.id),
                str(enrollment.id),
                MilestoneAchievementOutcome.NOTIFIED.value,
            ):
                newly.append((milestone, enrollment))
        if not newly:
            continue
        # Committed before sending: see the module docstring.
        await db.commit()
        reached += len(newly)
        program = await db.get(TrainingProgram, program_id)
        org = await db.get(Organization, organization_id)
        for milestone, enrollment in newly:
            try:
                await notify_milestone_reached(db, org, program, milestone, enrollment)
            except Exception as exc:
                logger.error(
                    "Milestone {} notice for enrollment {} failed: {}",
                    milestone.id,
                    enrollment.id,
                    exc,
                )
    return reached


async def process_user(db: AsyncSession, organization_id: Any, user_id: Any) -> int:
    """Evaluate a member's active enrollments — after one of their tests is
    validated or graded. Never raises: the result that prompted it is saved."""
    try:
        enrollment_ids = (
            (
                await db.execute(
                    select(ProgramEnrollment.id).where(
                        ProgramEnrollment.organization_id == str(organization_id),
                        ProgramEnrollment.user_id == str(user_id),
                        ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    )
                )
            )
            .scalars()
            .all()
        )
        return await process_enrollments(db, enrollment_ids)
    except Exception as exc:
        logger.error("Milestone check for user {} failed: {}", user_id, exc)
        await db.rollback()
        return 0


async def sweep_organization(db: AsyncSession, organization_id: Any) -> int:
    """Evaluate every active enrollment in a program that has a milestone.

    The backstop for completions that reach a member by a path with no hook of
    its own — a course record entered by an officer, approved from a
    submission, written by an event finalize or a provider import.
    """
    enrollment_ids = (
        (
            await db.execute(
                select(ProgramEnrollment.id)
                .where(
                    ProgramEnrollment.organization_id == str(organization_id),
                    ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                    ProgramEnrollment.program_id.in_(
                        select(ProgramMilestone.program_id).distinct()
                    ),
                )
                .order_by(ProgramEnrollment.id)
            )
        )
        .scalars()
        .all()
    )
    return await process_enrollments(db, enrollment_ids)


async def baseline_milestone(db: AsyncSession, milestone_id: str) -> int:
    """Mark every live enrollment that already meets the milestone as skipped.

    Called after a create, and after an edit that changed a trigger.
    Enrollments with a row already keep it. Commits. Returns how many were
    skipped.
    """
    found = await load_milestones_by_id(db, [milestone_id])
    if not found:
        return 0
    milestone = found[0]
    enrollments = list(
        (
            await db.execute(
                select(ProgramEnrollment)
                .where(
                    ProgramEnrollment.program_id == str(milestone.program_id),
                    ProgramEnrollment.status.in_(BASELINE_STATUSES),
                )
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    if not enrollments:
        return 0
    achieved = await _achieved_pairs(db, [str(e.id) for e in enrollments])
    candidates = [
        e for e in enrollments if (str(milestone.id), str(e.id)) not in achieved
    ]
    if not candidates:
        return 0
    organization_id = str(candidates[0].organization_id)
    tz = await resolve_scheduling_timezone(db, organization_id)
    completions = await load_completions(
        db, organization_id, [str(e.user_id) for e in candidates], milestone.items
    )
    skipped = 0
    for enrollment in candidates:
        if standing(milestone, enrollment, completions, tz).met and await _record(
            db,
            str(milestone.id),
            str(enrollment.id),
            MilestoneAchievementOutcome.SKIPPED.value,
        ):
            skipped += 1
    await db.commit()
    return skipped


async def load_milestones_by_id(
    db: AsyncSession, milestone_ids: List[str]
) -> List[ProgramMilestone]:
    if not milestone_ids:
        return []
    return list(
        (
            await db.execute(
                select(ProgramMilestone)
                .options(selectinload(ProgramMilestone.items))
                .where(ProgramMilestone.id.in_(milestone_ids))
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )


async def clear_for_new_cycle(db: AsyncSession, enrollment_id: Any) -> None:
    """Forget what an enrollment reached, for a cycle reset. Flushes only;
    the reset owns the commit."""
    await db.execute(
        delete(ProgramMilestoneAchievement).where(
            ProgramMilestoneAchievement.enrollment_id == str(enrollment_id)
        )
    )


async def member_standings(
    db: AsyncSession, enrollment: ProgramEnrollment
) -> List[Dict[str, Any]]:
    """Every milestone of the enrollment's program with the member's standing,
    as ``MemberMilestoneStatus`` dicts."""
    milestones = await load_milestones(db, str(enrollment.program_id))
    if not milestones:
        return []
    organization_id = str(enrollment.organization_id)
    tz = await resolve_scheduling_timezone(db, organization_id)
    all_items = [item for m in milestones for item in m.items]
    completions = await load_completions(
        db, organization_id, [str(enrollment.user_id)], all_items
    )
    names = await item_names(db, organization_id, all_items)
    rows = await db.execute(
        select(
            ProgramMilestoneAchievement.milestone_id,
            ProgramMilestoneAchievement.reached_at,
        ).where(ProgramMilestoneAchievement.enrollment_id == str(enrollment.id))
    )
    reached_at = {str(m): when for m, when in rows.all()}

    out: List[Dict[str, Any]] = []
    for milestone in milestones:
        current = standing(milestone, enrollment, completions, tz)
        out.append(
            {
                "id": milestone.id,
                "name": milestone.name,
                "description": milestone.description,
                "phase_id": milestone.phase_id,
                "completion_percentage_threshold": milestone.completion_percentage_threshold,
                "percentage_met": current.percentage_met,
                "item_match_mode": match_mode(milestone),
                "items": [
                    {
                        "item_type": item.item_type,
                        "item_id": item_target_id(item),
                        "name": names.get((item.item_type, str(item_target_id(item)))),
                        "completed": done,
                    }
                    for item, done in current.items_done
                ],
                "reached": str(milestone.id) in reached_at,
                "reached_at": reached_at.get(str(milestone.id)),
            }
        )
    return out


# --------------------------------------------------------------------------
# Options for the editor


async def milestone_options(db: AsyncSession, organization_id: str) -> Dict[str, Any]:
    org = str(organization_id)
    courses = (
        await db.execute(
            select(TrainingCourse.id, TrainingCourse.name, TrainingCourse.code)
            .where(
                TrainingCourse.organization_id == org,
                func.coalesce(TrainingCourse.active, True).is_(True),
            )
            .order_by(TrainingCourse.name)
        )
    ).all()
    templates = (
        await db.execute(
            select(SkillTemplate.id, SkillTemplate.name, SkillTemplate.category)
            .where(
                SkillTemplate.organization_id == org,
                func.coalesce(SkillTemplate.status, "draft")
                != SkillTemplateStatus.ARCHIVED.value,
            )
            .order_by(SkillTemplate.name)
        )
    ).all()
    tests = (
        await db.execute(
            select(KnowledgeTest.id, KnowledgeTest.name)
            .where(
                KnowledgeTest.organization_id == org,
                KnowledgeTest.status != KnowledgeTestStatus.ARCHIVED.value,
            )
            .order_by(KnowledgeTest.name)
        )
    ).all()
    positions = (
        await db.execute(
            select(Position.id, Position.name)
            .where(Position.organization_id == org)
            .order_by(Position.name)
        )
    ).all()
    members = (
        (
            await db.execute(
                select(User)
                .where(User.organization_id == org, User.is_active)
                .order_by(User.last_name, User.first_name)
            )
        )
        .scalars()
        .all()
    )
    return {
        "courses": [{"id": i, "name": n, "detail": c} for i, n, c in courses],
        "skill_tests": [{"id": i, "name": n, "detail": c} for i, n, c in templates],
        "knowledge_tests": [{"id": i, "name": n, "detail": None} for i, n in tests],
        "positions": [{"id": i, "name": n, "detail": None} for i, n in positions],
        "members": [
            {"id": u.id, "name": u.display_name, "detail": u.membership_number}
            for u in members
        ],
    }


# --------------------------------------------------------------------------
# Notification


async def officer_recipients(
    db: AsyncSession,
    organization_id: str,
    milestone: ProgramMilestone,
    exclude_user_id: Optional[str] = None,
) -> List[User]:
    """The current members holding a chosen position, plus the chosen members."""
    ids: Set[str] = {str(u) for u in (milestone.notify_user_ids or [])}
    position_ids = [str(p) for p in (milestone.notify_position_ids or [])]
    if position_ids:
        rows = await db.execute(
            select(user_positions.c.user_id)
            .join(Position, Position.id == user_positions.c.position_id)
            .where(
                Position.organization_id == str(organization_id),
                Position.id.in_(position_ids),
            )
        )
        ids.update(str(r[0]) for r in rows.all())
    if exclude_user_id:
        ids.discard(str(exclude_user_id))
    if not ids:
        return []
    return list(
        (
            await db.execute(
                select(User)
                .where(
                    User.id.in_(list(ids)),
                    User.organization_id == str(organization_id),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                    User.deleted_at.is_(None),
                )
                .order_by(User.last_name, User.first_name)
            )
        )
        .scalars()
        .all()
    )


async def _bell(
    db: AsyncSession,
    organization_id: str,
    recipient_id: str,
    subject: str,
    message: str,
    action_url: str,
) -> None:
    from app.services.notifications_service import NotificationsService

    _, error = await NotificationsService(db).log_notification(
        organization_id=organization_id,
        log_data={
            "recipient_id": recipient_id,
            "channel": NotificationChannel.IN_APP,
            "subject": subject[:500],
            "message": message,
            "category": NotificationCategory.TRAINING,
            "action_url": action_url,
            "delivered": True,
            "sent_at": datetime.now(timezone.utc),
        },
    )
    if error:
        logger.warning("Milestone bell notice to {} failed: {}", recipient_id, error)


async def _email(
    db: AsyncSession,
    org: Optional[Organization],
    to: str,
    subject: str,
    title: str,
    paragraphs: Sequence[str],
    action_path: str,
    action_label: str,
    template_type: str,
) -> bool:
    from app.services.email_service import EmailService, wrap_email_body
    from app.services.email_theme import ACCENT_GREEN, action

    url = _absolute(action_path)
    body = "".join(f"<p>{html.escape(p)}</p>" for p in paragraphs) + action(
        html.escape(url), action_label
    )
    html_body = wrap_email_body(
        org, title, body, header_color=ACCENT_GREEN, chip="Milestone"
    )
    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[to],
        subject=subject,
        html_body=html_body,
        text_body="\n\n".join(paragraphs) + f"\n\n{url}\n",
        db=db,
        template_type=template_type,
    )
    return sent > 0


async def notify_milestone_reached(
    db: AsyncSession,
    org: Optional[Organization],
    program: Optional[TrainingProgram],
    milestone: ProgramMilestone,
    enrollment: ProgramEnrollment,
) -> None:
    from app.services.email_policy import (
        EmailKind,
        department_required_kinds,
        member_receives_email,
    )

    organization_id = str(enrollment.organization_id)
    member = await db.get(User, str(enrollment.user_id))
    if member is None:
        return
    program_name = program.name if program else "your training program"
    required = department_required_kinds(org)

    if milestone.notify_member is not False:
        subject = _subject_safe(f"Milestone reached: {milestone.name}")
        message = (milestone.notification_message or "").strip() or (
            f"Congratulations! You've reached the {milestone.name} milestone "
            f"in {program_name}. Keep up the good work."
        )
        path = f"/training/my-progress/{enrollment.id}"
        if member.email and member_receives_email(
            getattr(member, "notification_preferences", None),
            EmailKind.TRAINING_REMINDERS,
            required,
        ):
            try:
                await _email(
                    db,
                    org,
                    member.email,
                    subject,
                    "Congratulations!",
                    [message],
                    path,
                    "View your progress",
                    "program_milestone_member",
                )
            except Exception as exc:
                logger.warning(
                    "Milestone email to member {} failed: {}", member.id, exc
                )
        # The bell notice every milestone has always rung for the member.
        await _bell(db, organization_id, str(member.id), subject, message, path)

    officers = await officer_recipients(
        db, organization_id, milestone, exclude_user_id=str(member.id)
    )
    if not officers:
        return
    lead = (
        f"{member.display_name} has reached the {milestone.name} milestone "
        f"in {program_name}."
    )
    paragraphs = [lead]
    officer_note = (milestone.officer_message or "").strip()
    if officer_note:
        paragraphs.append(officer_note)
    subject = _subject_safe(
        f"{member.display_name} reached {milestone.name} - {program_name}"
    )
    path = f"/training/programs/{enrollment.program_id}"
    for officer in officers:
        emailed = False
        if officer.email and member_receives_email(
            getattr(officer, "notification_preferences", None),
            EmailKind.TRAINING_DUTIES,
            required,
        ):
            try:
                emailed = await _email(
                    db,
                    org,
                    officer.email,
                    subject,
                    "Milestone reached",
                    paragraphs,
                    path,
                    "Open the pipeline",
                    "program_milestone_officer",
                )
            except Exception as exc:
                logger.warning(
                    "Milestone email to officer {} failed: {}", officer.id, exc
                )
        if not emailed:
            await _bell(
                db,
                organization_id,
                str(officer.id),
                subject,
                " ".join(paragraphs),
                path,
            )
