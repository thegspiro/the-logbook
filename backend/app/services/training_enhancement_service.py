"""
Training Enhancement Services

Business logic for recertification pathways, competency tracking,
instructor qualifications, training effectiveness, multi-agency training,
report exports, and xAPI ingestion.
"""

import asyncio
import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import (
    Any,
    AsyncIterator,
    Dict,
    List,
    Mapping,
    NamedTuple,
    Optional,
    Sequence,
    Tuple,
)

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import email_fingerprints
from app.models.training import (
    CompetencyMatrix,
    ExternalTrainingProvider,
    InstructorQualification,
    MemberCompetency,
    MultiAgencyTraining,
    RecertificationPathway,
    RenewalTask,
    RenewalTaskStatus,
    SkillEvaluation,
    TrainingCategory,
    TrainingCourse,
    TrainingEffectivenessEvaluation,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingStatus,
    TrainingType,
    XAPIStatement,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Position, User
from app.services.training_compliance import (
    CATCH_UP_STATUS,
    NOT_YET_HELD_STATUS,
    STANDING_NOT_APPLICABLE,
    ComplianceGrading,
    EvaluationCredits,
    HeldSession,
    MemberCompliance,
    _load_compliance_config,
    grade_members,
    load_credited_shift_dates,
    load_evaluation_credits,
    load_held_sessions,
    member_join_date,
)
from app.services.training_record_source import (
    RecordSource,
    load_source_lookup,
    record_sources,
)
from app.services.training_waiver_service import WaiverPeriod, fetch_org_waivers
from app.utils import streamed_query
from app.utils.csv_export import SafeCsvChunks, collect_csv
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import (
    assert_all_in_org,
    assert_current_members,
    assert_in_org,
)
from app.utils.org_timezone import (
    format_in_org_timezone,
    local_date,
    resolve_org_today,
    resolve_scheduling_timezone,
    today_in,
)
from app.utils.streamed_query import iter_row_batches


def _stringify_uuids(data: dict) -> dict:
    """Coerce ``uuid.UUID`` values to their canonical dashed-string form.

    Model ids here are dashed-string ``String(36)`` columns, but the request
    schemas in ``schemas/training_enhancements.py`` type id fields as ``UUID``.
    SQLAlchemy renders a ``uuid.UUID`` bound against a ``String`` column as
    32-char dashless hex, so an org-scope lookup never matches (a real member
    is rejected as "Invalid user_id") and an INSERT stores a key no join can
    follow. Normalising at the service boundary covers both.
    """
    return {
        key: str(value) if isinstance(value, uuid.UUID) else value
        for key, value in data.items()
    }


# Days ahead the compliance forecast projects each member's standing.
FORECAST_HORIZONS = (30, 60, 90)


def _member_batches(members: Sequence[User]) -> List[Sequence[User]]:
    """``members`` in slices of ``streamed_query.EXPORT_BATCH_SIZE``.

    The size is read from the module on each call, so a test can lower it. A
    slice never splits a member's grading: batches are of members, not
    records.
    """
    size = max(1, streamed_query.EXPORT_BATCH_SIZE)
    return [members[i : i + size] for i in range(0, len(members), size)]


class _ComplianceRow(NamedTuple):
    """One member's line in the compliance PDF, as plain values."""

    name: str
    email: str
    hours: float
    records: int
    cells: List[str]


class _MemberRecords(NamedTuple):
    """One member's section in the bulk records PDF, as plain values."""

    id: str
    name: str
    rows: List[Dict[str, str]]
    hours: float


def _requirement_cells(
    requirements: Sequence[TrainingRequirement],
    compliance: Optional[MemberCompliance],
) -> List[str]:
    """One export cell per requirement column, from a member's matrix grading.

    ``compliance`` is the member's entry from
    ``training_compliance.grade_members``, the grader behind the compliance
    matrix (``get_compliance_matrix``) and ``grade_org_members``, so a cell
    reads what the matrix shows for the member today (CLAUDE.md pitfall 29,
    owner decision 2026-11-21). "N/A" where the requirement does not grade
    this member — their compliance profile does not list it, or their
    membership type, role or a grandfathering cutoff exempts them — so a
    member is not printed as failing a standard that was never theirs. "Due
    <date>" while an existing member's catch-up period runs, and "No sessions
    yet" for a session-attendance requirement no session of which is held.
    ``None`` (no active requirement grades anyone) prints every column N/A.
    """
    by_id = (
        {str(req.id): ev for req, ev in compliance.evaluations} if compliance else {}
    )
    cells: List[str] = []
    for req in requirements:
        ev = by_id.get(str(req.id))
        if ev is None:
            cells.append("N/A")
        elif ev.status == CATCH_UP_STATUS:
            cells.append(f"Due {ev.catch_up_deadline}")
        elif ev.status == NOT_YET_HELD_STATUS:
            cells.append("No sessions yet")
        elif ev.status == TrainingStatus.COMPLETED.value:
            cells.append("Met")
        else:
            cells.append("Not Met")
    return cells


class _PeriodTotals(NamedTuple):
    """A member's completed hours and record count inside a report period."""

    hours: float
    records: int


async def _period_totals(
    db: AsyncSession,
    organization_id: str,
    user_ids: Sequence[str],
    start_date: date,
    end_date: date,
) -> Dict[str, _PeriodTotals]:
    """Completed hours and records per member between the two dates.

    The only figures in the compliance export the report period scopes; the
    requirement cells are the current standing (owner decision 2026-11-21).
    One grouped query for the members given, rather than one per member.
    """
    if not user_ids:
        return {}
    rows = await db.execute(
        select(
            TrainingRecord.user_id,
            func.coalesce(func.sum(TrainingRecord.hours_completed), 0),
            func.count(TrainingRecord.id),
        )
        .where(TrainingRecord.organization_id == organization_id)
        .where(TrainingRecord.status == TrainingStatus.COMPLETED)
        .where(TrainingRecord.completion_date >= start_date)
        .where(TrainingRecord.completion_date <= end_date)
        .where(TrainingRecord.user_id.in_([str(u) for u in user_ids]))
        .group_by(TrainingRecord.user_id)
    )
    return {
        str(user_id): _PeriodTotals(float(hours or 0), int(count))
        for user_id, hours, count in rows.all()
    }


class RecertificationService:
    """Service for managing recertification pathways and renewal tasks"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_pathways(
        self, organization_id: str, active_only: bool = True
    ) -> list:
        """Get all recertification pathways for an organization"""
        query = select(RecertificationPathway).where(
            RecertificationPathway.organization_id == organization_id
        )
        if active_only:
            query = query.where(RecertificationPathway.active.is_(True))
        result = await self.db.execute(query.order_by(RecertificationPathway.name))
        return list(result.scalars().all())

    async def get_pathway(
        self, pathway_id: str, organization_id: str
    ) -> Optional[RecertificationPathway]:
        """Get a specific recertification pathway"""
        result = await self.db.execute(
            select(RecertificationPathway)
            .where(RecertificationPathway.id == pathway_id)
            .where(RecertificationPathway.organization_id == organization_id)
        )
        pathway: Optional[RecertificationPathway] = result.scalar_one_or_none()
        return pathway

    async def _validate_references(self, organization_id: str, data: dict) -> None:
        """Ensure every client-supplied pathway FK belongs to the current tenant."""
        await assert_in_org(
            self.db,
            TrainingRequirement,
            data.get("source_requirement_id"),
            organization_id,
            allow_none=True,
            label="source requirement",
        )
        await assert_in_org(
            self.db,
            TrainingCourse,
            data.get("assessment_course_id"),
            organization_id,
            allow_none=True,
            label="assessment course",
        )
        await assert_all_in_org(
            self.db,
            TrainingCourse,
            data.get("required_courses"),
            organization_id,
            label="required course",
        )
        await assert_all_in_org(
            self.db,
            RecertificationPathway,
            data.get("prerequisite_pathway_ids"),
            organization_id,
            label="prerequisite pathway",
        )
        category_ids = [
            entry.get("category_id")
            for entry in (data.get("category_hour_requirements") or [])
            if isinstance(entry, dict)
        ]
        await assert_all_in_org(
            self.db,
            TrainingCategory,
            category_ids,
            organization_id,
            label="category",
        )

    async def create_pathway(
        self, organization_id: str, data: dict, created_by: str
    ) -> RecertificationPathway:
        """Create a new recertification pathway"""
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        pathway = RecertificationPathway(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(pathway)
        await self.db.flush()
        # `created_at` / `updated_at` are server-side defaults, so a flush leaves
        # them expired rather than fetching the values back. See update_pathway:
        # the endpoint serialises this object after committing, where the lazy
        # reload raises MissingGreenlet and the POST 500s on a row it did create.
        await self.db.refresh(pathway)
        return pathway

    async def update_pathway(
        self, pathway_id: str, organization_id: str, data: dict
    ) -> RecertificationPathway:
        """Update a recertification pathway"""
        pathway = await self.get_pathway(pathway_id, organization_id)
        if not pathway:
            raise ValueError("Pathway not found")
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        apply_updates(pathway, data)
        await self.db.flush()
        # `updated_at` is server-side (onupdate=func.now()), so the flush leaves
        # it expired rather than fetching the new value back. The endpoint
        # serialises this object after committing, which is outside the async
        # greenlet — the lazy reload raises MissingGreenlet and the PATCH 500s.
        # Reload here, while there is still a transaction to read in.
        await self.db.refresh(pathway)
        return pathway

    async def get_user_renewal_tasks(
        self, user_id: str, organization_id: str, status: Optional[str] = None
    ) -> list:
        """Get renewal tasks for a user"""
        query = (
            select(RenewalTask)
            .where(RenewalTask.user_id == user_id)
            .where(RenewalTask.organization_id == organization_id)
        )
        if status:
            query = query.where(RenewalTask.status == status)
        result = await self.db.execute(
            query.order_by(RenewalTask.certification_expiration_date)
        )
        return list(result.scalars().all())

    async def generate_renewal_tasks(self, organization_id: str) -> int:
        """
        Scan for expiring certifications and create PENDING renewal tasks.

        NOTE: despite the recertification design, this is currently only
        triggered manually via POST /recertification/tasks/generate — it is NOT
        wired into the scheduler, so renewal tasks are not auto-generated.
        Completing the feature (scheduled generation plus the missing
        COMPLETED/EXPIRED/LAPSED lifecycle transitions) is tracked separately;
        scheduling generation alone would surface PENDING tasks that never
        clear once a member renews.

        Returns the number of tasks created.
        """
        # The department's date: a renewal window opening "N days before
        # expiry" opens on the department's calendar, not a day early in UTC.
        today = await resolve_org_today(self.db, organization_id)
        tasks_created = 0

        # Get all active pathways
        pathways = await self.get_pathways(organization_id)

        for pathway in pathways:
            if not pathway.source_requirement_id:
                continue

            window_start = today + timedelta(days=pathway.renewal_window_days)

            # Find expiring records that match this pathway's requirement
            expiring_query = (
                select(TrainingRecord)
                .where(TrainingRecord.organization_id == organization_id)
                .where(TrainingRecord.status == TrainingStatus.COMPLETED)
                .where(TrainingRecord.expiration_date.isnot(None))
                .where(TrainingRecord.expiration_date <= window_start)
                .where(TrainingRecord.expiration_date >= today)
            )
            result = await self.db.execute(expiring_query)
            expiring_records = result.scalars().all()

            for record in expiring_records:
                # Check if a renewal task already exists
                existing = await self.db.execute(
                    select(RenewalTask)
                    .where(RenewalTask.user_id == record.user_id)
                    .where(RenewalTask.pathway_id == str(pathway.id))
                    .where(RenewalTask.training_record_id == str(record.id))
                    .where(
                        RenewalTask.status.in_(
                            [
                                RenewalTaskStatus.PENDING,
                                RenewalTaskStatus.IN_PROGRESS,
                            ]
                        )
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                grace_end = None
                if pathway.grace_period_days and record.expiration_date:
                    grace_end = record.expiration_date + timedelta(
                        days=pathway.grace_period_days
                    )

                task = RenewalTask(
                    organization_id=organization_id,
                    user_id=record.user_id,
                    pathway_id=str(pathway.id),
                    training_record_id=str(record.id),
                    certification_expiration_date=record.expiration_date,
                    renewal_window_opens=today,
                    grace_period_ends=grace_end,
                )
                self.db.add(task)
                tasks_created += 1

        await self.db.flush()
        return tasks_created


class CompetencyService:
    """Service for competency tracking and progression"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_matrices(
        self, organization_id: str, position: Optional[str] = None
    ) -> list:
        """Get competency matrices, optionally filtered by position"""
        query = select(CompetencyMatrix).where(
            CompetencyMatrix.organization_id == organization_id,
            CompetencyMatrix.active.is_(True),
        )
        if position:
            query = query.where(CompetencyMatrix.position == position)
        result = await self.db.execute(query.order_by(CompetencyMatrix.name))
        return list(result.scalars().all())

    async def get_matrix(
        self, matrix_id: str, organization_id: str
    ) -> Optional[CompetencyMatrix]:
        """Get a specific competency matrix"""
        result = await self.db.execute(
            select(CompetencyMatrix)
            .where(CompetencyMatrix.id == matrix_id)
            .where(CompetencyMatrix.organization_id == organization_id)
        )
        matrix: Optional[CompetencyMatrix] = result.scalar_one_or_none()
        return matrix

    async def _validate_references(self, organization_id: str, data: dict) -> None:
        """Ensure client-supplied matrix FKs belong to the current tenant (XC-1).

        ``skill_requirements`` is free-form JSON, but each entry's
        ``skill_evaluation_id`` names a skill the heat-map grades against, so a
        foreign one is a dangling cross-tenant reference. Only keys present in
        ``data`` are checked, so a partial update leaves stored values alone.
        """
        await assert_in_org(
            self.db,
            Position,
            data.get("role_id"),
            organization_id,
            allow_none=True,
            label="role",
        )
        skill_ids = [
            entry.get("skill_evaluation_id")
            for entry in (data.get("skill_requirements") or [])
            if isinstance(entry, dict)
        ]
        await assert_all_in_org(
            self.db,
            SkillEvaluation,
            skill_ids,
            organization_id,
            label="skill evaluation",
        )

    async def create_matrix(
        self, organization_id: str, data: dict, created_by: str
    ) -> CompetencyMatrix:
        """Create a competency matrix"""
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        matrix = CompetencyMatrix(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(matrix)
        await self.db.flush()
        # See create_pathway: server-side timestamps stay expired after a flush
        # and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(matrix)
        return matrix

    async def update_matrix(
        self, matrix_id: str, organization_id: str, data: dict
    ) -> CompetencyMatrix:
        """Update a competency matrix"""
        matrix = await self.get_matrix(matrix_id, organization_id)
        if not matrix:
            raise ValueError("Matrix not found")
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        apply_updates(matrix, data)
        await self.db.flush()
        # See update_pathway: server-side `updated_at` stays expired after a
        # flush and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(matrix)
        return matrix

    def _competencies_query(self, organization_id: str):
        """Stored MemberCompetency rows with their skill's name, newest first.

        The one read behind both the per-member endpoints and the department
        heat-map, so the level a heat-map cell shows is exactly the level the
        member's own view reports — the heat-map grades nothing itself
        (CLAUDE.md pitfall #29). The skill join carries the org predicate so a
        row can never be named from another department's catalog.
        """
        return (
            select(MemberCompetency, SkillEvaluation.name)
            .outerjoin(
                SkillEvaluation,
                (SkillEvaluation.id == MemberCompetency.skill_evaluation_id)
                & (SkillEvaluation.organization_id == organization_id),
            )
            .where(MemberCompetency.organization_id == organization_id)
            .order_by(MemberCompetency.updated_at.desc())
        )

    @staticmethod
    def _named(rows) -> list:
        competencies = []
        for competency, skill_name in rows:
            # ``skill_name`` is the response schema's enriched field; it is
            # not a mapped column, so setting it writes nothing.
            competency.skill_name = skill_name
            competencies.append(competency)
        return competencies

    async def get_member_competencies(self, user_id: str, organization_id: str) -> list:
        """Get all competencies for a member"""
        result = await self.db.execute(
            self._competencies_query(organization_id).where(
                MemberCompetency.user_id == user_id
            )
        )
        return self._named(result.all())

    async def get_department_competencies(self, organization_id: str) -> Dict[str, Any]:
        """Every active member's stored levels, for the readiness heat-map.

        Members are the department's active roster — including those with no
        evaluation yet, who show as a row of empty cells rather than vanishing
        — and skills are its active skill evaluations, which are the columns.
        """
        members_result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == organization_id,
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
            )
            .order_by(User.last_name, User.first_name)
        )
        members = [
            {
                "user_id": str(member.id),
                "name": member.full_name,
                "station": member.station,
                "rank": member.rank,
            }
            for member in members_result.scalars().all()
        ]
        active_ids = {m["user_id"] for m in members}

        skills_result = await self.db.execute(
            select(SkillEvaluation)
            .where(
                SkillEvaluation.organization_id == organization_id,
                SkillEvaluation.active.is_(True),
            )
            .order_by(SkillEvaluation.category, SkillEvaluation.name)
        )
        skills = [
            {"id": str(skill.id), "name": skill.name, "category": skill.category}
            for skill in skills_result.scalars().all()
        ]

        result = await self.db.execute(self._competencies_query(organization_id))
        competencies = [
            c for c in self._named(result.all()) if str(c.user_id) in active_ids
        ]
        return {"members": members, "skills": skills, "competencies": competencies}


class InstructorQualificationService:
    """Service for managing instructor qualifications"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_references(self, organization_id: str, data: dict) -> None:
        """Ensure qualification foreign keys belong to the current tenant."""
        references = (
            ("user_id", User),
            ("course_id", TrainingCourse),
            ("skill_evaluation_id", SkillEvaluation),
            ("category_id", TrainingCategory),
        )
        for field, model in references:
            reference_id = data.get(field)
            if reference_id is None:
                continue
            result = await self.db.execute(
                select(model.id).where(
                    model.id == reference_id,
                    model.organization_id == organization_id,
                )
            )
            if result.scalar_one_or_none() is None:
                raise ValueError(f"Invalid {field}")

    async def get_qualifications(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        course_id: Optional[str] = None,
        active_only: bool = True,
    ) -> list:
        """Get instructor qualifications with optional filters.

        The model carries no ORM relationships, so `user_name` and
        `course_name` on the response schema resolve to None and the roster
        renders raw UUIDs where the instructor's name belongs. Join both in
        and set them on the way out.
        """
        query = (
            select(InstructorQualification, User, TrainingCourse)
            .outerjoin(
                User,
                and_(
                    User.id == InstructorQualification.user_id,
                    User.organization_id == organization_id,
                ),
            )
            .outerjoin(
                TrainingCourse,
                and_(
                    TrainingCourse.id == InstructorQualification.course_id,
                    TrainingCourse.organization_id == organization_id,
                ),
            )
            .where(InstructorQualification.organization_id == organization_id)
        )
        if active_only:
            query = query.where(InstructorQualification.active.is_(True))
        if user_id:
            query = query.where(InstructorQualification.user_id == user_id)
        if course_id:
            query = query.where(InstructorQualification.course_id == course_id)
        result = await self.db.execute(
            query.order_by(InstructorQualification.created_at.desc())
        )
        qualifications = []
        for qual, user, course in result.all():
            qual.user_name = user.full_name if user else None
            qual.course_name = course.name if course else None
            qualifications.append(qual)
        return qualifications

    async def create_qualification(
        self, organization_id: str, data: dict, created_by: str
    ) -> InstructorQualification:
        """Create an instructor qualification"""
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        # A new qualification is recorded for a current member only.
        await assert_current_members(
            self.db, [data.get("user_id")], organization_id, label="the member"
        )
        qual = InstructorQualification(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(qual)
        await self.db.flush()
        # See create_pathway: server-side timestamps stay expired after a flush
        # and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(qual)
        return qual

    async def update_qualification(
        self, qual_id: str, organization_id: str, data: dict
    ) -> InstructorQualification:
        """Update an instructor qualification"""
        result = await self.db.execute(
            select(InstructorQualification)
            .where(InstructorQualification.id == qual_id)
            .where(InstructorQualification.organization_id == organization_id)
        )
        qual: Optional[InstructorQualification] = result.scalar_one_or_none()
        if not qual:
            raise ValueError("Qualification not found")
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        apply_updates(qual, data)
        await self.db.flush()
        # See update_pathway: server-side `updated_at` stays expired after a
        # flush and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(qual)
        return qual

    async def validate_instructor_for_session(
        self, user_id: str, course_id: str, organization_id: str
    ) -> bool:
        """Check if a user is qualified to instruct a specific course"""
        result = await self.db.execute(
            select(InstructorQualification)
            .where(InstructorQualification.user_id == user_id)
            .where(InstructorQualification.organization_id == organization_id)
            .where(InstructorQualification.active.is_(True))
            .where(InstructorQualification.course_id == course_id)
        )
        qual = result.scalar_one_or_none()
        if not qual:
            return False

        # Check expiration on the department's calendar: a qualification is
        # good through its expiration date, which in UTC ends hours early.
        if qual.expiration_date and qual.expiration_date < await resolve_org_today(
            self.db, organization_id
        ):
            return False

        return True

    async def get_qualified_instructors(
        self, course_id: str, organization_id: str
    ) -> list:
        """Get all qualified instructors for a course"""
        today = await resolve_org_today(self.db, organization_id)
        result = await self.db.execute(
            select(InstructorQualification)
            .where(InstructorQualification.organization_id == organization_id)
            .where(InstructorQualification.course_id == course_id)
            .where(InstructorQualification.active.is_(True))
            .where(
                (InstructorQualification.expiration_date.is_(None))
                | (InstructorQualification.expiration_date >= today)
            )
        )
        return list(result.scalars().all())


class TrainingEffectivenessService:
    """Service for training effectiveness evaluation (Kirkpatrick Model)"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _validate_references(self, organization_id: str, data: dict) -> None:
        """Ensure every optional training reference belongs to the tenant."""
        references = (
            ("training_record_id", TrainingRecord, True),
            ("training_session_id", TrainingSession, False),
            ("course_id", TrainingCourse, False),
        )
        for field, model, self_owned in references:
            reference_id = data.get(field)
            if reference_id is None:
                continue
            conditions = [
                model.id == reference_id,
                model.organization_id == organization_id,
            ]
            if self_owned:
                conditions.append(TrainingRecord.user_id == data["user_id"])
            result = await self.db.execute(select(model.id).where(*conditions))
            if result.scalar_one_or_none() is None:
                raise ValueError(f"Invalid {field}")

    async def create_evaluation(
        self, organization_id: str, data: dict
    ) -> TrainingEffectivenessEvaluation:
        """Create a training effectiveness evaluation"""
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        # Calculate knowledge gain if pre/post scores provided
        pre = data.get("pre_assessment_score")
        post = data.get("post_assessment_score")
        if pre is not None and post is not None and pre > 0:
            data["knowledge_gain_percentage"] = ((post - pre) / pre) * 100

        evaluation = TrainingEffectivenessEvaluation(
            organization_id=organization_id,
            **data,
        )
        self.db.add(evaluation)
        await self.db.flush()
        # See create_pathway: server-side timestamps stay expired after a flush
        # and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(evaluation)
        return evaluation

    async def get_evaluations(
        self,
        organization_id: str,
        course_id: Optional[str] = None,
        session_id: Optional[str] = None,
        level: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> list:
        """Get effectiveness evaluations with filters"""
        query = select(TrainingEffectivenessEvaluation).where(
            TrainingEffectivenessEvaluation.organization_id == organization_id
        )
        if course_id:
            query = query.where(TrainingEffectivenessEvaluation.course_id == course_id)
        if session_id:
            query = query.where(
                TrainingEffectivenessEvaluation.training_session_id == session_id
            )
        if level:
            query = query.where(
                TrainingEffectivenessEvaluation.evaluation_level == level
            )
        if user_id:
            query = query.where(TrainingEffectivenessEvaluation.user_id == user_id)
        result = await self.db.execute(
            query.order_by(TrainingEffectivenessEvaluation.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_course_effectiveness_summary(
        self, course_id: str, organization_id: str
    ) -> dict:
        """Get aggregate effectiveness metrics for a course"""
        evals = await self.get_evaluations(
            organization_id=organization_id, course_id=course_id
        )

        if not evals:
            return {
                "course_id": course_id,
                "total_evaluations": 0,
                "avg_overall_rating": None,
                "avg_knowledge_gain": None,
                "avg_behavior_rating": None,
                "evaluations_by_level": {},
            }

        ratings = [e.overall_rating for e in evals if e.overall_rating is not None]
        gains = [
            e.knowledge_gain_percentage
            for e in evals
            if e.knowledge_gain_percentage is not None
        ]
        behavior = [e.behavior_rating for e in evals if e.behavior_rating is not None]

        by_level: Dict[str, int] = {}
        for e in evals:
            level = (
                e.evaluation_level.value
                if hasattr(e.evaluation_level, "value")
                else str(e.evaluation_level)
            )
            by_level[level] = by_level.get(level, 0) + 1

        return {
            "course_id": course_id,
            "total_evaluations": len(evals),
            "avg_overall_rating": (
                round(sum(ratings) / len(ratings), 2) if ratings else None
            ),
            "avg_knowledge_gain": (
                round(sum(gains) / len(gains), 2) if gains else None
            ),
            "avg_behavior_rating": (
                round(sum(behavior) / len(behavior), 2) if behavior else None
            ),
            "evaluations_by_level": by_level,
        }


class MultiAgencyService:
    """Service for multi-agency training management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_exercises(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> list:
        """Get multi-agency exercises"""
        query = select(MultiAgencyTraining).where(
            MultiAgencyTraining.organization_id == organization_id
        )
        if start_date:
            query = query.where(MultiAgencyTraining.exercise_date >= start_date)
        if end_date:
            query = query.where(MultiAgencyTraining.exercise_date <= end_date)
        result = await self.db.execute(
            query.order_by(MultiAgencyTraining.exercise_date.desc())
        )
        return list(result.scalars().all())

    async def _validate_references(self, organization_id: str, data: dict) -> None:
        """Ensure client-supplied exercise FKs belong to the current tenant."""
        await assert_in_org(
            self.db,
            TrainingSession,
            data.get("training_session_id"),
            organization_id,
            allow_none=True,
            label="training session",
        )
        await assert_in_org(
            self.db,
            TrainingRecord,
            data.get("training_record_id"),
            organization_id,
            allow_none=True,
            label="training record",
        )

    async def create_exercise(
        self, organization_id: str, data: dict, created_by: str
    ) -> MultiAgencyTraining:
        """Create a multi-agency training record"""
        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        # Convert participating_organizations to serializable format
        if "participating_organizations" in data:
            orgs = data["participating_organizations"]
            if orgs and hasattr(orgs[0], "model_dump"):
                data["participating_organizations"] = [o.model_dump() for o in orgs]
            elif orgs and hasattr(orgs[0], "dict"):
                data["participating_organizations"] = [o.dict() for o in orgs]

        exercise = MultiAgencyTraining(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(exercise)
        await self.db.flush()
        # See create_pathway: server-side timestamps stay expired after a flush
        # and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(exercise)
        return exercise

    async def update_exercise(
        self, exercise_id: str, organization_id: str, data: dict
    ) -> MultiAgencyTraining:
        """Update a multi-agency training record"""
        result = await self.db.execute(
            select(MultiAgencyTraining)
            .where(MultiAgencyTraining.id == exercise_id)
            .where(MultiAgencyTraining.organization_id == organization_id)
        )
        exercise: Optional[MultiAgencyTraining] = result.scalar_one_or_none()
        if not exercise:
            raise ValueError("Exercise not found")

        data = _stringify_uuids(data)
        await self._validate_references(organization_id, data)
        if "participating_organizations" in data:
            orgs = data["participating_organizations"]
            if orgs and hasattr(orgs[0], "model_dump"):
                data["participating_organizations"] = [o.model_dump() for o in orgs]

        apply_updates(exercise, data)
        await self.db.flush()
        # See update_pathway: server-side `updated_at` stays expired after a
        # flush and cannot be lazy-loaded during response serialisation.
        await self.db.refresh(exercise)
        return exercise


class XAPIService:
    """Service for xAPI statement ingestion and processing"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def ingest_statement(
        self,
        organization_id: str,
        raw_statement: dict,
        source_provider_id: Optional[str] = None,
        _provider_validated: bool = False,
    ) -> XAPIStatement:
        """Ingest a single xAPI statement.

        ``_provider_validated`` lets ``ingest_batch`` validate the shared
        ``source_provider_id`` once before its loop instead of re-running the
        same indexed query for every one of up to 1,000 statements.
        """
        if not _provider_validated:
            await assert_in_org(
                self.db,
                ExternalTrainingProvider,
                source_provider_id,
                organization_id,
                allow_none=True,
                label="source provider",
            )
        actor = raw_statement.get("actor", {})
        verb = raw_statement.get("verb", {})
        obj = raw_statement.get("object", {})
        result_data = raw_statement.get("result", {})
        context = raw_statement.get("context", {})
        score = result_data.get("score", {})

        # Extract actor email from mbox or account
        actor_email = None
        if "mbox" in actor:
            actor_email = actor["mbox"].replace("mailto:", "")
        elif "account" in actor:
            actor_email = actor["account"].get("name")

        # Parse duration (ISO 8601)
        duration_seconds = None
        if "duration" in result_data:
            duration_seconds = self._parse_iso_duration(result_data["duration"])

        # Parse timestamp
        timestamp = raw_statement.get(
            "timestamp", datetime.now(timezone.utc).isoformat()
        )
        try:
            stmt_time = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            stmt_time = datetime.now(timezone.utc)

        # Try to map actor to internal user. The org filter is a tenant
        # boundary: actor email comes from the (attacker-influenceable)
        # xAPI payload, and without it a statement could attach to — and
        # later create a training record for — a same-email user in a
        # different organization.
        user_id = None
        if actor_email:
            user_result = await self.db.execute(
                select(User.id).where(
                    User.email_hash.in_(email_fingerprints(actor_email)),
                    User.organization_id == organization_id,
                )
            )
            user = user_result.scalar_one_or_none()
            if user:
                user_id = str(user)

        statement = XAPIStatement(
            organization_id=organization_id,
            actor_email=actor_email,
            actor_name=actor.get("name"),
            user_id=user_id,
            verb_id=verb.get("id", ""),
            verb_display=verb.get("display", {}).get("en-US", verb.get("id", "")),
            object_id=obj.get("id", ""),
            object_name=(
                obj.get("definition", {}).get("name", {}).get("en-US")
                or obj.get("id", "")
            ),
            object_type=obj.get("objectType", "Activity"),
            score_scaled=score.get("scaled"),
            score_raw=score.get("raw"),
            score_min=score.get("min"),
            score_max=score.get("max"),
            success=result_data.get("success"),
            completion=result_data.get("completion"),
            duration_seconds=duration_seconds,
            context_registration=context.get("registration"),
            context_platform=context.get("platform"),
            context_extensions=context.get("extensions"),
            raw_statement=raw_statement,
            source_provider_id=source_provider_id,
            statement_timestamp=stmt_time,
        )
        self.db.add(statement)
        await self.db.flush()
        # See create_pathway: `created_at` is a server-side default and stays
        # expired after a flush, so it cannot be lazy-loaded during response
        # serialisation.
        await self.db.refresh(statement)
        return statement

    async def ingest_batch(
        self,
        organization_id: str,
        statements: list,
        source_provider_id: Optional[str] = None,
    ) -> dict:
        """Ingest a batch of xAPI statements"""
        await assert_in_org(
            self.db,
            ExternalTrainingProvider,
            source_provider_id,
            organization_id,
            allow_none=True,
            label="source provider",
        )

        accepted = 0
        rejected = 0
        errors = []

        for i, raw in enumerate(statements):
            try:
                await self.ingest_statement(
                    organization_id,
                    raw,
                    source_provider_id,
                    _provider_validated=True,
                )
                accepted += 1
            except Exception as e:
                rejected += 1
                errors.append(f"Statement {i}: {str(e)}")

        await self.db.flush()
        return {
            "total": len(statements),
            "accepted": accepted,
            "rejected": rejected,
            "errors": errors[:50],  # Cap error list
        }

    async def process_unprocessed(self, organization_id: str) -> int:
        """Process ingested xAPI statements into training records"""
        result = await self.db.execute(
            select(XAPIStatement)
            .where(XAPIStatement.organization_id == organization_id)
            .where(XAPIStatement.processed.is_(False))
            .where(XAPIStatement.user_id.isnot(None))
            .where(XAPIStatement.completion.is_(True))
            .limit(100)
        )
        statements = result.scalars().all()
        processed = 0
        # A statement's timestamp is UTC; the completion date is the day it
        # was on the department's calendar.
        tz = await resolve_scheduling_timezone(self.db, organization_id)

        for stmt in statements:
            # Create training record from completed xAPI statement
            record = TrainingRecord(
                organization_id=organization_id,
                user_id=stmt.user_id,
                course_name=stmt.object_name or "External Course",
                training_type="continuing_education",
                status="completed",
                hours_completed=(stmt.duration_seconds or 0) / 3600,
                completion_date=(
                    local_date(stmt.statement_timestamp, tz)
                    if stmt.statement_timestamp
                    else today_in(tz)
                ),
                score=stmt.score_raw,
                passed=stmt.success,
                notes=f"Imported from xAPI ({stmt.context_platform or 'unknown platform'})",
            )
            self.db.add(record)
            await self.db.flush()

            stmt.processed = True
            stmt.training_record_id = record.id
            processed += 1

        await self.db.flush()
        return processed

    @staticmethod
    def _parse_iso_duration(duration_str: str) -> Optional[int]:
        """Parse ISO 8601 duration to seconds"""
        if not duration_str or not duration_str.startswith("P"):
            return None
        try:
            # Simple parser for common formats: PT1H30M, PT45M, PT3600S
            seconds: float = 0
            time_part = duration_str.split("T")[-1] if "T" in duration_str else ""
            import re

            hours = re.search(r"(\d+(?:\.\d+)?)H", time_part)
            minutes = re.search(r"(\d+(?:\.\d+)?)M", time_part)
            secs = re.search(r"(\d+(?:\.\d+)?)S", time_part)
            if hours:
                seconds += float(hours.group(1)) * 3600
            if minutes:
                seconds += float(minutes.group(1)) * 60
            if secs:
                seconds += float(secs.group(1))
            return int(seconds) if seconds > 0 else None
        except Exception:
            return None


class ReportExportService:
    """Service for generating training report exports (CSV/PDF)

    A report with no end date runs through the department's today, not the
    server's: ``date.today()`` in a UTC container is already tomorrow for a US
    department every evening.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_compliance_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> str:
        """The same export as one string (see ``stream_compliance_csv``)."""
        return await collect_csv(
            await self.stream_compliance_csv(
                organization_id, start_date=start_date, end_date=end_date
            )
        )

    async def _compliance_population(
        self, organization_id: str
    ) -> Tuple[List[User], List[TrainingRequirement]]:
        """The members and requirements of the compliance CSV and PDF.

        Active, non-exempt members by last and first name, and active
        requirements by name: the matrix's population and order. Positions are
        loaded because a compliance profile can match on them.
        """
        users_result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(User.organization_id == organization_id)
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.compliance_exempt.is_(False))
            .where(User.deleted_at.is_(None))
            .order_by(User.last_name, User.first_name)
        )
        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.active.is_(True))
            .order_by(TrainingRequirement.name)
        )
        return list(users_result.scalars().all()), list(req_result.scalars().all())

    async def _grade_batch(
        self,
        organization_id: str,
        members: Sequence[User],
        requirements: Sequence[TrainingRequirement],
        today: date,
        grading: ComplianceGrading,
        waivers_by_user: Mapping[str, Sequence[WaiverPeriod]],
        held_sessions: Mapping[str, Sequence[HeldSession]],
    ) -> Dict[str, MemberCompliance]:
        """``grade_members`` for ``members``, keyed by member id."""
        graded = await grade_members(
            self.db,
            str(organization_id),
            members,
            requirements,
            today,
            grading,
            waivers_by_user=waivers_by_user,
            held_sessions=held_sessions,
        )
        return {str(c.member.id): c for c in graded}

    async def stream_compliance_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> AsyncIterator[str]:
        """The compliance report as CSV, one chunk per batch of members.

        Each requirement column is the member's standing as of the
        department's today, exactly as the Compliance Matrix shows it; the
        period (default 1 January through today) scopes only the hours and
        completed-record columns, whose headers carry it (owner decision
        2026-11-21).
        """
        today = await resolve_org_today(self.db, organization_id)
        if not end_date:
            end_date = today
        if not start_date:
            start_date = date(end_date.year, 1, 1)

        users, requirements = await self._compliance_population(organization_id)
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, str(organization_id))
        )
        waivers_by_user = await fetch_org_waivers(self.db, str(organization_id))
        held_sessions = await load_held_sessions(
            self.db, str(organization_id), requirements
        )
        period = f"{start_date.isoformat()} to {end_date.isoformat()}"

        # Streamed a batch of members at a time (AH-16). The batch size is read
        # from the module when the export runs, so a test can lower it. Each
        # batch's queries run between yields with no cursor open, so the
        # server-side-cursor caveat in streamed_query does not apply.
        async def chunks() -> AsyncIterator[str]:
            writer = SafeCsvChunks()

            header = [
                "Member Name",
                "Email",
                f"Total Hours ({period})",
                f"Completed Records ({period})",
            ]
            for req in requirements:
                header.append(f"{req.name} (Status)")
            writer.writerow(header)
            yield writer.drain()

            for batch in _member_batches(users):
                graded = await self._grade_batch(
                    organization_id,
                    batch,
                    requirements,
                    today,
                    grading,
                    waivers_by_user,
                    held_sessions,
                )
                totals = await _period_totals(
                    self.db,
                    organization_id,
                    [str(u.id) for u in batch],
                    start_date,
                    end_date,
                )
                for user in batch:
                    figures = totals.get(str(user.id), _PeriodTotals(0.0, 0))
                    row = [
                        f"{user.first_name} {user.last_name}",
                        user.email,
                        f"{figures.hours:.1f}",
                        str(figures.records),
                    ]
                    row.extend(
                        _requirement_cells(requirements, graded.get(str(user.id)))
                    )
                    writer.writerow(row)
                yield writer.drain()

        return chunks()

    async def generate_individual_csv(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_certifications: bool = True,
    ) -> str:
        """The same export as one string (see ``stream_individual_csv``)."""
        return await collect_csv(
            await self.stream_individual_csv(
                user_id,
                organization_id,
                start_date=start_date,
                end_date=end_date,
                include_certifications=include_certifications,
            )
        )

    async def stream_individual_csv(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_certifications: bool = True,
    ) -> AsyncIterator[str]:
        """Generate an individual training history CSV.

        A missing ``start_date`` means no lower bound (lifetime export).

        ``include_certifications=False`` drops the certification columns, for
        the member-facing export of a department that has switched
        ``show_certification_status`` off. It defaults to True so an officer
        pulling somebody's record gets the full sheet.
        """
        if not end_date:
            end_date = await resolve_org_today(self.db, organization_id)

        query = (
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date <= end_date)
            .order_by(TrainingRecord.completion_date.desc())
        )
        if start_date:
            query = query.where(TrainingRecord.completion_date >= start_date)

        records_result = await self.db.execute(query)
        records = records_result.scalars().all()
        sources = await record_sources(self.db, organization_id, records)

        cert_headers = ["Certification #", "Issuing Agency", "Expiration Date"]

        async def chunks() -> AsyncIterator[str]:
            writer = SafeCsvChunks()
            writer.writerow(
                [
                    "Course Name",
                    "Course Code",
                    "Training Type",
                    "Completion Date",
                    "Hours",
                    "Credit Hours",
                    *(cert_headers if include_certifications else []),
                    "Score",
                    "Instructor",
                    "Location",
                    # Last, so a sheet that reads the columns by position
                    # keeps working.
                    "Source",
                ]
            )

            for r in records:
                training_type = (
                    r.training_type.value
                    if hasattr(r.training_type, "value")
                    else str(r.training_type)
                )
                cert_cells = [
                    r.certification_number or "",
                    r.issuing_agency or "",
                    str(r.expiration_date) if r.expiration_date else "",
                ]
                writer.writerow(
                    [
                        r.course_name,
                        r.course_code or "",
                        training_type,
                        str(r.completion_date) if r.completion_date else "",
                        f"{r.hours_completed:.1f}" if r.hours_completed else "0",
                        f"{r.credit_hours:.1f}" if r.credit_hours else "",
                        *(cert_cells if include_certifications else []),
                        f"{r.score:.1f}" if r.score else "",
                        r.instructor or "",
                        r.location or "",
                        sources[str(r.id)].label,
                    ]
                )

            yield writer.drain()

        return chunks()

    async def generate_compliance_forecast(
        self, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Each member's compliance forecast (see ``_forecast_rows``)."""
        rows, _ = await self._forecast_rows(organization_id)
        return rows

    async def generate_compliance_forecast_report(
        self, organization_id: str
    ) -> Dict[str, Any]:
        """The members' forecasts and the department's four averages.

        Each average is the mean of the graded members' figures at that
        horizon, classified by the department's thresholds and threshold type
        (``ComplianceGrading.classify_average``), so the screen colours it as
        the backend decided rather than by bands of its own (CLAUDE.md
        pitfall 29, owner direction 2026-11-21).
        """
        rows, grading = await self._forecast_rows(organization_id)
        horizons = {
            "current": ("current_compliance_percentage", "current_standing"),
            "days_30": ("forecast_30_days", "forecast_30_standing"),
            "days_60": ("forecast_60_days", "forecast_60_standing"),
            "days_90": ("forecast_90_days", "forecast_90_standing"),
        }
        averages: Dict[str, Dict[str, Any]] = {}
        for key, (pct_field, standing_field) in horizons.items():
            standing, pct = grading.classify_average(
                (row[pct_field], row[standing_field]) for row in rows
            )
            averages[key] = {"pct": pct, "standing": standing}
        return {"members": rows, "averages": averages}

    async def _forecast_rows(
        self, organization_id: str
    ) -> Tuple[List[Dict[str, Any]], ComplianceGrading]:
        """Every graded member's forecast row, and the grading behind them."""
        today = await resolve_org_today(self.db, organization_id)
        forecasts = []

        users_result = await self.db.execute(
            select(User)
            .options(selectinload(User.positions))
            .where(
                User.organization_id == organization_id,
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.compliance_exempt.is_(False),
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()

        req_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == organization_id,
                TrainingRequirement.active.is_(True),
            )
        )
        all_requirements = req_result.scalars().all()
        # Which requirements grade each member, their thresholds and the
        # department's current-month cut-off, as the compliance matrix
        # resolves them (owner decision 2026-11-20, CLAUDE.md pitfall 29).
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, str(organization_id))
        )
        include_current = grading.include_current_month
        # Full history: a rolling requirement's due date, which the at-risk
        # list below reads, anchors on the latest shift or evaluation however
        # old.
        shifts_by_user = await load_credited_shift_dates(
            self.db,
            organization_id,
            [u.id for u in users],
            all_requirements,
            today,
            include_current,
            full_history=True,
        )
        evaluations_by_user = await load_evaluation_credits(
            self.db,
            organization_id,
            [u.id for u in users],
            all_requirements,
            today,
            include_current,
            full_history=True,
        )
        held_sessions = await load_held_sessions(
            self.db, str(organization_id), all_requirements
        )
        waivers_by_user = await fetch_org_waivers(self.db, str(organization_id))

        # Graded a batch of members at a time by the matrix's grader, with one
        # record query per batch rather than one per member. Each projection
        # is that same grading as of the future day, from the records already
        # logged (owner decision 2026-11-21): a certificate no requirement
        # reads, or one a renewal has superseded, costs nothing, and a rolling
        # window losing old hours or a catch-up period ending is charged.
        for batch in _member_batches(users):
            graded = await self._grade_batch(
                organization_id,
                batch,
                all_requirements,
                today,
                grading,
                waivers_by_user,
                held_sessions,
            )
            projected = {
                days: await self._grade_batch(
                    organization_id,
                    batch,
                    all_requirements,
                    today + timedelta(days=days),
                    grading,
                    waivers_by_user,
                    held_sessions,
                )
                for days in FORECAST_HORIZONS
            }
            records_by_user = await self._completed_records(
                organization_id, [str(u.id) for u in batch]
            )
            for user in batch:
                forecasts.append(
                    self._member_forecast(
                        user,
                        graded.get(str(user.id)),
                        {
                            days: by_member.get(str(user.id))
                            for days, by_member in projected.items()
                        },
                        records_by_user.get(str(user.id), []),
                        today,
                        include_current,
                        shifts_by_user.get(str(user.id), []),
                        evaluations_by_user.get(str(user.id), {}),
                        waivers_by_user.get(str(user.id), []),
                        held_sessions,
                    )
                )

        return forecasts, grading

    async def _completed_records(
        self, organization_id: str, user_ids: Sequence[str]
    ) -> Dict[str, List[TrainingRecord]]:
        """Every completed record of the given members, by member id."""
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(TrainingRecord).where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.user_id.in_(list(user_ids)),
            )
        )
        by_user: Dict[str, List[TrainingRecord]] = {}
        for record in result.scalars().all():
            by_user.setdefault(str(record.user_id), []).append(record)
        return by_user

    @staticmethod
    def _member_forecast(
        user: User,
        compliance: Optional[MemberCompliance],
        projected: Mapping[int, Optional[MemberCompliance]],
        records: Sequence[TrainingRecord],
        today: date,
        include_current: bool,
        shift_dates: Sequence[date],
        evaluation_credits: EvaluationCredits,
        waivers: Sequence[WaiverPeriod],
        held_sessions: Mapping[str, Sequence[HeldSession]],
    ) -> Dict[str, Any]:
        """One member's forecast row.

        The current figure and standing are the matrix's grading today, and
        each projection is the same grading on that day
        (``grade_members``, CLAUDE.md pitfall 29), both by the member's own
        thresholds. The at-risk list reads each graded requirement's due date,
        which only ``TrainingService.evaluate_requirement_detail`` computes; it
        decides no status here. ``expiring_certifications`` lists every
        completed record expiring within 90 days, as information; it no longer
        feeds the projections.
        """
        from app.services.training_service import TrainingService

        evaluations = compliance.evaluations if compliance else ()
        join_date = member_join_date(user)
        at_risk = []
        for req, _ in evaluations:
            detail = TrainingService.evaluate_requirement_detail(
                req,
                list(records),
                today,
                waivers=list(waivers),
                org_include_current_month=include_current,
                join_date=join_date,
                shift_dates=shift_dates,
                held_sessions=held_sessions,
                evaluation_credits=evaluation_credits,
            )
            due_in = detail.get("days_until_due")
            if due_in is not None and 0 < due_in <= 90:
                at_risk.append({"name": req.name, "days_until_due": due_in})

        expiring: List[Dict[str, Any]] = []
        for r in records:
            if r.expiration_date and today < r.expiration_date <= today + timedelta(
                days=90
            ):
                expiring.append(
                    {
                        "course_name": r.course_name,
                        "expiration_date": str(r.expiration_date),
                        "days_remaining": (r.expiration_date - today).days,
                    }
                )

        # A member nothing grades has no percentage at all — not 100%, which
        # counted them as passing in every department average (TR4-4).
        def figures(graded: Optional[MemberCompliance]) -> Tuple[str, Optional[float]]:
            if graded is None:
                return STANDING_NOT_APPLICABLE, None
            return graded.standing, graded.pct

        current_standing, current_pct = figures(compliance)
        horizons = {days: figures(projected.get(days)) for days in FORECAST_HORIZONS}
        return {
            "user_id": str(user.id),
            "user_name": f"{user.first_name} {user.last_name}",
            "current_compliance_percentage": current_pct,
            "current_standing": current_standing,
            "forecast_30_days": horizons[30][1],
            "forecast_30_standing": horizons[30][0],
            "forecast_60_days": horizons[60][1],
            "forecast_60_standing": horizons[60][0],
            "forecast_90_days": horizons[90][1],
            "forecast_90_standing": horizons[90][0],
            "at_risk_requirements": at_risk,
            "expiring_certifications": expiring,
        }

    async def _report_header(self, organization_id: str) -> Dict[str, Any]:
        """The department's name, logo and the generated-at stamp, in its own
        time zone, for a report's letterhead and footer. Plain values, so
        the layout can run off the event loop without touching the session."""
        from app.models.user import Organization
        from app.utils.election_pdf_style import department_identity

        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        return {
            "org_name": org.name if org else None,
            "logo": org.logo if org else None,
            "identity": department_identity(org) or None,
            "generated_at": format_in_org_timezone(
                datetime.now(timezone.utc), org, "%Y-%m-%d %H:%M %Z"
            ),
        }

    async def generate_compliance_pdf(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        generated_by: Optional[str] = None,
        report_number: Optional[str] = None,
    ) -> io.BytesIO:
        """Generate a compliance report as a PDF document.

        A member-by-requirement matrix. Requirements that do not fit across
        the page are printed in further column bands, each repeating the
        member columns, rather than being dropped off the right edge.
        """
        from reportlab.lib.units import inch

        from app.utils.pdf_report_kit import (
            ReportMeta,
        )
        from app.utils.pdf_report_kit import cell as pdf_cell
        from app.utils.pdf_report_kit import column_bands, data_table, kpi_strip
        from app.utils.pdf_report_kit import num as pdf_num
        from app.utils.pdf_report_kit import render_report

        # Graded as of the department's today, as the matrix is; the period
        # scopes only the hours and record counts (owner decision 2026-11-21).
        today = await resolve_org_today(self.db, organization_id)
        if not end_date:
            end_date = today
        if not start_date:
            start_date = date(end_date.year, 1, 1)

        users, requirements = await self._compliance_population(organization_id)
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, str(organization_id))
        )
        # The PDF is built in memory anyway, so the whole roster is graded in
        # one call.
        graded = await self._grade_batch(
            organization_id,
            users,
            requirements,
            today,
            grading,
            await fetch_org_waivers(self.db, str(organization_id)),
            await load_held_sessions(self.db, str(organization_id), requirements),
        )
        totals = await _period_totals(
            self.db, organization_id, [str(u.id) for u in users], start_date, end_date
        )

        member_rows: List[_ComplianceRow] = []
        for user in users:
            figures = totals.get(str(user.id), _PeriodTotals(0.0, 0))
            member_rows.append(
                _ComplianceRow(
                    name=f"{user.first_name} {user.last_name}",
                    email=user.email or "",
                    hours=figures.hours,
                    records=figures.records,
                    cells=_requirement_cells(requirements, graded.get(str(user.id))),
                )
            )
        requirement_names = [req.name for req in requirements]
        # A count of the cells printed below, not a second definition of
        # compliance (Pitfall #29): "Not Met" is _requirement_cells' verdict,
        # which follows the matrix and does not depend on the period.
        unmet = sum(row.cells.count("Not Met") for row in member_rows)

        header = await self._report_header(organization_id)
        meta = ReportMeta(
            "Training Compliance Report",
            header["org_name"],
            header["generated_at"],
            logo=header["logo"],
            generated_by=generated_by,
            identity=header["identity"],
            report_number=report_number,
            parameters=[
                ("Status graded as of", today.isoformat()),
                ("Hours and records", f"{start_date} to {end_date}"),
            ],
            subject="Training compliance",
            wide=True,
        )
        width = meta.width
        name_w, hours_w, count_w, req_w = (
            2.1 * inch,
            0.7 * inch,
            0.75 * inch,
            0.95 * inch,
        )
        bands = column_bands(
            len(requirement_names), width, name_w + hours_w + count_w, req_w
        )

        def body(styles: Dict[str, Any]) -> List[Any]:
            from reportlab.platypus import Paragraph, Spacer

            story: List[Any] = [
                kpi_strip(
                    [
                        ("Members", len(member_rows)),
                        ("Active requirements", len(requirement_names)),
                        (
                            "Training hours in period",
                            f"{sum(r.hours for r in member_rows):.1f}",
                        ),
                        ("Unmet requirement cells", unmet),
                    ],
                    width,
                ),
                Spacer(1, 12),
            ]
            if not member_rows:
                story.append(
                    Paragraph("No members are graded for compliance.", styles["body"])
                )
                return story
            for start, stop in bands:
                names = requirement_names[start:stop]
                caption = (
                    f"Requirements {start + 1}–{stop} of {len(requirement_names)}"
                    if len(bands) > 1
                    else None
                )
                # One band stretches the member column to the page; several
                # keep it the same width in each, so the bands line up.
                member_w = (
                    width - hours_w - count_w - req_w * len(names)
                    if len(bands) == 1
                    else name_w
                )
                rows = []
                emphasis = []
                for index, row in enumerate(member_rows):
                    cells = row.cells[start:stop]
                    if "Not Met" in cells:
                        emphasis.append(index)
                    rows.append(
                        [
                            [
                                pdf_cell(row.name, styles["cell_bold"]),
                                pdf_cell(
                                    row.email,
                                    styles["cell_muted"],
                                    fit_width=member_w - 12,
                                ),
                            ],
                            pdf_num(f"{row.hours:.1f}"),
                            pdf_num(row.records),
                            *[
                                pdf_cell(
                                    text,
                                    styles["cell_bold"] if text == "Not Met" else None,
                                )
                                for text in cells
                            ],
                        ]
                    )
                story.append(
                    data_table(
                        ["Member", "Hours", "Records", *names],
                        rows,
                        [member_w, hours_w, count_w, *([req_w] * len(names))],
                        numeric_cols=(1, 2),
                        emphasis_rows=emphasis,
                        caption=caption,
                    )
                )
                story.append(Spacer(1, 12))
            return story

        pdf = await asyncio.to_thread(render_report, meta, body)
        return io.BytesIO(pdf)

    @staticmethod
    def _individual_rows(
        records: Sequence[TrainingRecord], sources: Dict[str, RecordSource]
    ) -> List[Dict[str, str]]:
        """A member's records as plain strings, ready for layout."""
        rows = []
        for r in records:
            rows.append(
                {
                    "course": r.course_name or "",
                    "type": (
                        r.training_type.value
                        if hasattr(r.training_type, "value")
                        else str(r.training_type or "")
                    ),
                    "completed": str(r.completion_date) if r.completion_date else "",
                    "hours": f"{r.hours_completed:.1f}" if r.hours_completed else "0",
                    "cert": r.certification_number or "",
                    "expires": str(r.expiration_date) if r.expiration_date else "",
                    "source": sources[str(r.id)].label,
                }
            )
        return rows

    @staticmethod
    def _individual_table(
        rows: List[Dict[str, str]],
        width: float,
        include_certifications: bool,
        styles: Dict[str, Any],
    ) -> List[Any]:
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph

        from app.utils.pdf_report_kit import cell as pdf_cell
        from app.utils.pdf_report_kit import data_table
        from app.utils.pdf_report_kit import num as pdf_num

        if not rows:
            return [Paragraph("No completed training in this period.", styles["body"])]
        # Source sits under the course name rather than in a column of its
        # own: every column here is already at the width its longest value
        # needs (a certificate number must print on one line), and the course
        # column is the only one that wraps gracefully.
        headers = ["Course / Source", "Type", "Completed", "Hours"]
        widths = [1.25 * inch, 0.8 * inch, 0.55 * inch]
        if include_certifications:
            headers += ["Cert #", "Expires"]
            widths += [1.85 * inch, 0.8 * inch]
        table_rows = []
        for row in rows:
            cells = [
                [
                    pdf_cell(row["course"]),
                    pdf_cell(row["source"], styles["cell_muted"]),
                ],
                pdf_cell(row["type"]),
                pdf_cell(row["completed"]),
                pdf_num(row["hours"]),
            ]
            if include_certifications:
                cells += [pdf_cell(row["cert"]), pdf_cell(row["expires"])]
            table_rows.append(cells)
        return [
            data_table(
                headers,
                table_rows,
                [width - sum(widths), *widths],
                numeric_cols=(3,),
                zebra=True,
            )
        ]

    async def generate_individual_pdf(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        include_certifications: bool = True,
        generated_by: Optional[str] = None,
        report_number: Optional[str] = None,
    ) -> io.BytesIO:
        """Generate an individual training history PDF.

        A missing ``start_date`` means no lower bound (lifetime export).

        ``include_certifications=False`` drops the Cert # and Expires columns,
        for the member-facing export of a department that has switched
        ``show_certification_status`` off.
        """
        from reportlab.platypus import Spacer

        from app.utils.pdf_report_kit import ReportMeta, kpi_strip, render_report

        if not end_date:
            end_date = await resolve_org_today(self.db, organization_id)

        # Get user info — org-scope the lookup so a cross-org user_id can't
        # leak another org's member name into the exported PDF title (the
        # records below are already org-scoped).
        user_result = await self.db.execute(
            select(User).where(
                User.id == user_id,
                User.organization_id == organization_id,
            )
        )
        user = user_result.scalar_one_or_none()
        user_name = f"{user.first_name} {user.last_name}" if user else "Unknown"

        query = (
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date <= end_date)
            .order_by(TrainingRecord.completion_date.desc())
        )
        if start_date:
            query = query.where(TrainingRecord.completion_date >= start_date)

        records = (await self.db.execute(query)).scalars().all()
        rows = self._individual_rows(
            records, await record_sources(self.db, organization_id, records)
        )
        total_hours = sum(r.hours_completed or 0 for r in records)
        period_label = (
            f"{start_date} to {end_date}"
            if start_date
            else f"All time through {end_date}"
        )

        header = await self._report_header(organization_id)
        meta = ReportMeta(
            "Individual Training Report",
            header["org_name"],
            header["generated_at"],
            logo=header["logo"],
            generated_by=generated_by,
            identity=header["identity"],
            report_number=report_number,
            parameters=[("Member", user_name), ("Period", period_label)],
            subject=f"Training record: {user_name}",
        )
        width = meta.width

        def body(styles: Dict[str, Any]) -> List[Any]:
            return [
                kpi_strip(
                    [
                        ("Completed records", len(rows)),
                        ("Training hours", f"{total_hours:.1f}"),
                    ],
                    width,
                ),
                Spacer(1, 12),
                *self._individual_table(rows, width, include_certifications, styles),
            ]

        pdf = await asyncio.to_thread(render_report, meta, body)
        return io.BytesIO(pdf)

    async def generate_bulk_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> str:
        """The same export as one string (see ``stream_bulk_csv``)."""
        return await collect_csv(
            await self.stream_bulk_csv(
                organization_id, start_date=start_date, end_date=end_date
            )
        )

    async def stream_bulk_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> AsyncIterator[str]:
        """Generate a combined CSV of every member's completed training records.

        One row per completed record, prefixed with the member's name and
        email. A missing ``start_date`` means no lower bound (lifetime export).
        """
        if not end_date:
            end_date = await resolve_org_today(self.db, organization_id)

        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.deleted_at.is_(None))
            .order_by(User.last_name, User.first_name)
        )
        users = users_result.scalars().all()
        lookup = await load_source_lookup(self.db, organization_id)

        async def chunks() -> AsyncIterator[str]:
            writer = SafeCsvChunks()
            writer.writerow(
                [
                    "Member Name",
                    "Email",
                    "Course Name",
                    "Course Code",
                    "Training Type",
                    "Completion Date",
                    "Hours",
                    "Credit Hours",
                    "Certification #",
                    "Issuing Agency",
                    "Expiration Date",
                    "Score",
                    "Instructor",
                    "Location",
                    # Last, so a sheet that reads the columns by position
                    # keeps working.
                    "Source",
                ]
            )

            for user in users:
                query = (
                    select(TrainingRecord)
                    .where(TrainingRecord.user_id == str(user.id))
                    .where(TrainingRecord.organization_id == organization_id)
                    .where(TrainingRecord.status == TrainingStatus.COMPLETED)
                    .where(TrainingRecord.completion_date <= end_date)
                    .order_by(TrainingRecord.completion_date.desc())
                )
                if start_date:
                    query = query.where(TrainingRecord.completion_date >= start_date)

                records = (await self.db.execute(query)).scalars().all()
                member_name = f"{user.first_name} {user.last_name}"

                for r in records:
                    training_type = (
                        r.training_type.value
                        if hasattr(r.training_type, "value")
                        else str(r.training_type)
                    )
                    writer.writerow(
                        [
                            member_name,
                            user.email,
                            r.course_name,
                            r.course_code or "",
                            training_type,
                            str(r.completion_date) if r.completion_date else "",
                            f"{r.hours_completed:.1f}" if r.hours_completed else "0",
                            f"{r.credit_hours:.1f}" if r.credit_hours else "",
                            r.certification_number or "",
                            r.issuing_agency or "",
                            str(r.expiration_date) if r.expiration_date else "",
                            f"{r.score:.1f}" if r.score else "",
                            r.instructor or "",
                            r.location or "",
                            lookup.of(r).label,
                        ]
                    )
                yield writer.drain()

        return chunks()

    async def generate_bulk_pdf(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        generated_by: Optional[str] = None,
        report_number: Optional[str] = None,
    ) -> io.BytesIO:
        """Generate a combined PDF with one report section per member.

        Only members with at least one completed record in the window are
        included (to avoid blank pages). A missing ``start_date`` means no
        lower bound (lifetime export).

        Laid out as one document, not separate PDFs stitched together, so
        the page numbers run across the whole bundle and each member has an
        entry in the reader's sidebar.
        """
        from reportlab.platypus import CondPageBreak, PageBreak, Paragraph

        from app.utils.pdf_report_kit import (
            ReportMeta,
            bookmark,
            render_report,
            section_heading,
        )

        if not end_date:
            end_date = await resolve_org_today(self.db, organization_id)

        query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date <= end_date)
            .order_by(TrainingRecord.completion_date.desc())
        )
        if start_date:
            query = query.where(TrainingRecord.completion_date >= start_date)
        all_records = (await self.db.execute(query)).scalars().all()
        sources = await record_sources(self.db, organization_id, all_records)
        records_by_user: Dict[str, List[TrainingRecord]] = {}
        for record in all_records:
            records_by_user.setdefault(str(record.user_id), []).append(record)

        ordered_users = []
        if records_by_user:
            users_result = await self.db.execute(
                select(User)
                .where(User.id.in_(list(records_by_user)))
                .where(User.organization_id == organization_id)
                .order_by(User.last_name, User.first_name)
            )
            ordered_users = list(users_result.scalars().all())

        members = [
            _MemberRecords(
                id=str(user.id),
                name=f"{user.first_name} {user.last_name}",
                rows=self._individual_rows(records_by_user[str(user.id)], sources),
                hours=float(
                    sum(r.hours_completed or 0 for r in records_by_user[str(user.id)])
                ),
            )
            for user in ordered_users
        ]
        period_label = (
            f"{start_date} to {end_date}"
            if start_date
            else f"All time through {end_date}"
        )

        header = await self._report_header(organization_id)
        meta = ReportMeta(
            "Member Training Records",
            header["org_name"],
            header["generated_at"],
            logo=header["logo"],
            generated_by=generated_by,
            identity=header["identity"],
            report_number=report_number,
            parameters=[("Period", period_label), ("Members", len(members))],
            subject="Training records, all members",
        )
        width = meta.width

        def body(styles: Dict[str, Any]) -> List[Any]:
            if not members:
                return [
                    Paragraph(
                        "No training records found for this period.", styles["body"]
                    )
                ]
            story: List[Any] = []
            for index, member in enumerate(members):
                if index:
                    story.append(PageBreak())
                story += [
                    bookmark(member.name, f"member-{member.id}"),
                    CondPageBreak(120),
                    section_heading(
                        f"{member.name} · {len(member.rows)} records · "
                        f"{member.hours:.1f} hours",
                        styles,
                    ),
                    *self._individual_table(member.rows, width, True, styles),
                ]
            return story

        pdf = await asyncio.to_thread(render_report, meta, body)
        return io.BytesIO(pdf)

    async def generate_hours_summary_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> str:
        """The same export as one string (see ``stream_hours_summary_csv``)."""
        return await collect_csv(
            await self.stream_hours_summary_csv(
                organization_id, start_date=start_date, end_date=end_date
            )
        )

    async def stream_hours_summary_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> AsyncIterator[str]:
        """Generate a training-hours summary CSV broken down by member,
        category, and training type (for state/annual reporting).

        A missing ``start_date`` means no lower bound (lifetime).
        """
        if not end_date:
            end_date = await resolve_org_today(self.db, organization_id)

        cat_result = await self.db.execute(
            select(TrainingCategory).where(
                TrainingCategory.organization_id == organization_id
            )
        )
        category_names = {str(c.id): c.name for c in cat_result.scalars().all()}

        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.deleted_at.is_(None))
            .order_by(User.last_name, User.first_name)
        )
        users = users_result.scalars().all()

        async def chunks() -> AsyncIterator[str]:
            writer = SafeCsvChunks()
            writer.writerow(
                [
                    "Member Name",
                    "Email",
                    "Category",
                    "Training Type",
                    "Total Hours",
                    "Credit Hours",
                    "Records",
                ]
            )

            for user in users:
                query = (
                    select(TrainingRecord)
                    .where(TrainingRecord.user_id == str(user.id))
                    .where(TrainingRecord.organization_id == organization_id)
                    .where(TrainingRecord.status == TrainingStatus.COMPLETED)
                    .where(TrainingRecord.completion_date <= end_date)
                )
                if start_date:
                    query = query.where(TrainingRecord.completion_date >= start_date)
                records = (await self.db.execute(query)).scalars().all()

                buckets: Dict[tuple, Dict[str, float]] = {}
                for r in records:
                    training_type = (
                        r.training_type.value
                        if hasattr(r.training_type, "value")
                        else str(r.training_type)
                    )
                    category = (
                        category_names.get(str(r.category_id), "Uncategorized")
                        if r.category_id
                        else "Uncategorized"
                    )
                    bucket = buckets.setdefault(
                        (category, training_type),
                        {"hours": 0.0, "credit": 0.0, "count": 0.0},
                    )
                    bucket["hours"] += float(r.hours_completed or 0)
                    bucket["credit"] += float(r.credit_hours or 0)
                    bucket["count"] += 1

                member_name = f"{user.first_name} {user.last_name}"
                for (category, training_type), agg in sorted(buckets.items()):
                    writer.writerow(
                        [
                            member_name,
                            user.email,
                            category,
                            training_type,
                            f"{agg['hours']:.1f}",
                            f"{agg['credit']:.1f}",
                            str(int(agg["count"])),
                        ]
                    )
                yield writer.drain()

        return chunks()

    async def generate_certification_csv(
        self,
        organization_id: str,
        end_date: Optional[date] = None,
    ) -> str:
        """The same export as one string (see ``stream_certification_csv``)."""
        return await collect_csv(
            await self.stream_certification_csv(organization_id, end_date=end_date)
        )

    async def stream_certification_csv(
        self,
        organization_id: str,
        end_date: Optional[date] = None,
    ) -> AsyncIterator[str]:
        """Generate a CSV of members' certifications with expiration status
        (valid / expiring soon / expired) for renewal tracking."""
        as_of = end_date or await resolve_org_today(self.db, organization_id)

        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
            .where(User.deleted_at.is_(None))
        )
        user_map = {str(u.id): u for u in users_result.scalars().all()}

        query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(
                or_(
                    TrainingRecord.certification_number.isnot(None),
                    TrainingRecord.expiration_date.isnot(None),
                    TrainingRecord.training_type == TrainingType.CERTIFICATION,
                )
            )
            .order_by(TrainingRecord.expiration_date, TrainingRecord.id)
        )

        # Records are read through a server-side cursor a batch at a time
        # (AH-16); user_map and the source lookup are loaded here because the
        # connection cannot run another query while the cursor is open.
        lookup = await load_source_lookup(self.db, organization_id)

        async def chunks() -> AsyncIterator[str]:
            writer = SafeCsvChunks()
            writer.writerow(
                [
                    "Member Name",
                    "Email",
                    "Certification",
                    "Certification #",
                    "Issuing Agency",
                    "Completion Date",
                    "Expiration Date",
                    "Status",
                    "Days Until Expiry",
                    "Source",
                ]
            )

            yield writer.drain()

            async for batch in iter_row_batches(self.db, query, scalars=True):
                for r in batch:
                    user = user_map.get(str(r.user_id))
                    if not user:
                        # Skip records for inactive/other members.
                        continue
                    member_name = f"{user.first_name} {user.last_name}"
                    if r.expiration_date:
                        days = (r.expiration_date - as_of).days
                        if days < 0:
                            status = "Expired"
                        elif days <= 90:
                            status = "Expiring Soon"
                        else:
                            status = "Valid"
                        days_str = str(days)
                        exp_str = str(r.expiration_date)
                    else:
                        status = "No Expiration"
                        days_str = ""
                        exp_str = ""
                    writer.writerow(
                        [
                            member_name,
                            user.email,
                            r.course_name,
                            r.certification_number or "",
                            r.issuing_agency or "",
                            str(r.completion_date) if r.completion_date else "",
                            exp_str,
                            status,
                            days_str,
                            lookup.of(r).label,
                        ]
                    )
                yield writer.drain()

        return chunks()
