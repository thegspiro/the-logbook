"""
Training Enhancement Services

Business logic for recertification pathways, competency tracking,
instructor qualifications, training effectiveness, multi-agency training,
report exports, and xAPI ingestion.
"""

import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    CompetencyLevel,
    CompetencyMatrix,
    InstructorQualification,
    MemberCompetency,
    MultiAgencyTraining,
    RecertificationPathway,
    RenewalTask,
    RenewalTaskStatus,
    SkillCheckoff,
    TrainingEffectivenessEvaluation,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    XAPIStatement,
)
from app.models.user import User, UserStatus


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
            query = query.where(RecertificationPathway.active == True)  # noqa: E712
        result = await self.db.execute(query.order_by(RecertificationPathway.name))
        return result.scalars().all()

    async def get_pathway(self, pathway_id: str, organization_id: str):
        """Get a specific recertification pathway"""
        result = await self.db.execute(
            select(RecertificationPathway)
            .where(RecertificationPathway.id == pathway_id)
            .where(RecertificationPathway.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_pathway(
        self, organization_id: str, data: dict, created_by: str
    ) -> RecertificationPathway:
        """Create a new recertification pathway"""
        pathway = RecertificationPathway(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(pathway)
        await self.db.flush()
        return pathway

    async def update_pathway(
        self, pathway_id: str, organization_id: str, data: dict
    ) -> RecertificationPathway:
        """Update a recertification pathway"""
        pathway = await self.get_pathway(pathway_id, organization_id)
        if not pathway:
            raise ValueError("Pathway not found")
        for key, value in data.items():
            if value is not None:
                setattr(pathway, key, value)
        await self.db.flush()
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
        return result.scalars().all()

    async def generate_renewal_tasks(self, organization_id: str) -> int:
        """
        Scan for expiring certifications and auto-create renewal tasks.
        Called by the daily cert alert scheduler.
        Returns number of tasks created.
        """
        today = date.today()
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
            CompetencyMatrix.active == True,  # noqa: E712
        )
        if position:
            query = query.where(CompetencyMatrix.position == position)
        result = await self.db.execute(query.order_by(CompetencyMatrix.name))
        return result.scalars().all()

    async def get_matrix(self, matrix_id: str, organization_id: str):
        """Get a specific competency matrix"""
        result = await self.db.execute(
            select(CompetencyMatrix)
            .where(CompetencyMatrix.id == matrix_id)
            .where(CompetencyMatrix.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_matrix(
        self, organization_id: str, data: dict, created_by: str
    ) -> CompetencyMatrix:
        """Create a competency matrix"""
        matrix = CompetencyMatrix(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(matrix)
        await self.db.flush()
        return matrix

    async def update_matrix(
        self, matrix_id: str, organization_id: str, data: dict
    ) -> CompetencyMatrix:
        """Update a competency matrix"""
        matrix = await self.get_matrix(matrix_id, organization_id)
        if not matrix:
            raise ValueError("Matrix not found")
        for key, value in data.items():
            if value is not None:
                setattr(matrix, key, value)
        await self.db.flush()
        return matrix

    async def get_member_competencies(self, user_id: str, organization_id: str) -> list:
        """Get all competencies for a member"""
        result = await self.db.execute(
            select(MemberCompetency)
            .where(MemberCompetency.user_id == user_id)
            .where(MemberCompetency.organization_id == organization_id)
            .order_by(MemberCompetency.updated_at.desc())
        )
        return result.scalars().all()

    async def update_competency_from_checkoff(
        self, checkoff: SkillCheckoff, organization_id: str
    ) -> Optional[MemberCompetency]:
        """
        Update a member's competency level based on a skill checkoff result.
        Called after a skill evaluation is recorded.
        """
        # Find or create MemberCompetency
        result = await self.db.execute(
            select(MemberCompetency)
            .where(MemberCompetency.user_id == checkoff.user_id)
            .where(MemberCompetency.skill_evaluation_id == checkoff.skill_evaluation_id)
            .where(MemberCompetency.organization_id == organization_id)
        )
        competency = result.scalar_one_or_none()

        if not competency:
            competency = MemberCompetency(
                organization_id=organization_id,
                user_id=checkoff.user_id,
                skill_evaluation_id=checkoff.skill_evaluation_id,
            )
            self.db.add(competency)

        # Update based on checkoff
        competency.previous_level = competency.current_level
        competency.last_evaluated_at = datetime.now(timezone.utc)
        competency.last_evaluator_id = checkoff.evaluator_id
        competency.evaluation_count = (competency.evaluation_count or 0) + 1
        competency.last_score = checkoff.score

        # Determine new level based on score
        if checkoff.score is not None:
            if checkoff.score >= 95:
                competency.current_level = CompetencyLevel.EXPERT
            elif checkoff.score >= 85:
                competency.current_level = CompetencyLevel.PROFICIENT
            elif checkoff.score >= 75:
                competency.current_level = CompetencyLevel.COMPETENT
            elif checkoff.score >= 60:
                competency.current_level = CompetencyLevel.ADVANCED_BEGINNER
            else:
                competency.current_level = CompetencyLevel.NOVICE
        elif checkoff.status == "passed":
            # If no score but passed, advance one level (up to competent)
            levels = list(CompetencyLevel)
            current_idx = levels.index(competency.current_level)
            if current_idx < levels.index(CompetencyLevel.COMPETENT):
                competency.current_level = levels[current_idx + 1]

        # Update score history
        history = competency.score_history or []
        history.append(
            {
                "date": datetime.now(timezone.utc).isoformat(),
                "score": checkoff.score,
                "level": competency.current_level.value,
            }
        )
        # Keep last 10 entries
        competency.score_history = history[-10:]

        # Calculate next evaluation due
        if competency.decay_months:
            competency.next_evaluation_due = date.today() + timedelta(
                days=competency.decay_months * 30
            )

        await self.db.flush()
        return competency

    async def check_skill_decay(self, organization_id: str) -> int:
        """
        Check for skills that need re-evaluation due to decay.
        Returns number of members notified.
        """
        today = date.today()
        warning_window = today + timedelta(days=30)

        result = await self.db.execute(
            select(MemberCompetency)
            .where(MemberCompetency.organization_id == organization_id)
            .where(MemberCompetency.next_evaluation_due.isnot(None))
            .where(MemberCompetency.next_evaluation_due <= warning_window)
            .where(MemberCompetency.decay_warning_sent == False)  # noqa: E712
        )
        decaying = result.scalars().all()

        for comp in decaying:
            comp.decay_warning_sent = True
            # Actual notification would be sent via NotificationsService

        await self.db.flush()
        return len(decaying)


class InstructorQualificationService:
    """Service for managing instructor qualifications"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_qualifications(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        course_id: Optional[str] = None,
        active_only: bool = True,
    ) -> list:
        """Get instructor qualifications with optional filters"""
        query = select(InstructorQualification).where(
            InstructorQualification.organization_id == organization_id
        )
        if active_only:
            query = query.where(InstructorQualification.active == True)  # noqa: E712
        if user_id:
            query = query.where(InstructorQualification.user_id == user_id)
        if course_id:
            query = query.where(InstructorQualification.course_id == course_id)
        result = await self.db.execute(
            query.order_by(InstructorQualification.created_at.desc())
        )
        return result.scalars().all()

    async def create_qualification(
        self, organization_id: str, data: dict, created_by: str
    ) -> InstructorQualification:
        """Create an instructor qualification"""
        qual = InstructorQualification(
            organization_id=organization_id,
            created_by=created_by,
            **data,
        )
        self.db.add(qual)
        await self.db.flush()
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
        qual = result.scalar_one_or_none()
        if not qual:
            raise ValueError("Qualification not found")
        for key, value in data.items():
            if value is not None:
                setattr(qual, key, value)
        await self.db.flush()
        return qual

    async def validate_instructor_for_session(
        self, user_id: str, course_id: str, organization_id: str
    ) -> bool:
        """Check if a user is qualified to instruct a specific course"""
        result = await self.db.execute(
            select(InstructorQualification)
            .where(InstructorQualification.user_id == user_id)
            .where(InstructorQualification.organization_id == organization_id)
            .where(InstructorQualification.active == True)  # noqa: E712
            .where(InstructorQualification.course_id == course_id)
        )
        qual = result.scalar_one_or_none()
        if not qual:
            return False

        # Check expiration
        if qual.expiration_date and qual.expiration_date < date.today():
            return False

        return True

    async def get_qualified_instructors(
        self, course_id: str, organization_id: str
    ) -> list:
        """Get all qualified instructors for a course"""
        today = date.today()
        result = await self.db.execute(
            select(InstructorQualification)
            .where(InstructorQualification.organization_id == organization_id)
            .where(InstructorQualification.course_id == course_id)
            .where(InstructorQualification.active == True)  # noqa: E712
            .where(
                (InstructorQualification.expiration_date.is_(None))
                | (InstructorQualification.expiration_date >= today)
            )
        )
        return result.scalars().all()


class TrainingEffectivenessService:
    """Service for training effectiveness evaluation (Kirkpatrick Model)"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_evaluation(
        self, organization_id: str, data: dict
    ) -> TrainingEffectivenessEvaluation:
        """Create a training effectiveness evaluation"""
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
        return evaluation

    async def get_evaluations(
        self,
        organization_id: str,
        course_id: Optional[str] = None,
        session_id: Optional[str] = None,
        level: Optional[str] = None,
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
        result = await self.db.execute(
            query.order_by(TrainingEffectivenessEvaluation.created_at.desc())
        )
        return result.scalars().all()

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
        return result.scalars().all()

    async def create_exercise(
        self, organization_id: str, data: dict, created_by: str
    ) -> MultiAgencyTraining:
        """Create a multi-agency training record"""
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
        exercise = result.scalar_one_or_none()
        if not exercise:
            raise ValueError("Exercise not found")

        if "participating_organizations" in data:
            orgs = data["participating_organizations"]
            if orgs and hasattr(orgs[0], "model_dump"):
                data["participating_organizations"] = [o.model_dump() for o in orgs]

        for key, value in data.items():
            if value is not None:
                setattr(exercise, key, value)
        await self.db.flush()
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
    ) -> XAPIStatement:
        """Ingest a single xAPI statement"""
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

        # Try to map actor to internal user
        user_id = None
        if actor_email:
            user_result = await self.db.execute(
                select(User.id).where(User.email == actor_email)
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
        return statement

    async def ingest_batch(
        self,
        organization_id: str,
        statements: list,
        source_provider_id: Optional[str] = None,
    ) -> dict:
        """Ingest a batch of xAPI statements"""
        accepted = 0
        rejected = 0
        errors = []

        for i, raw in enumerate(statements):
            try:
                await self.ingest_statement(organization_id, raw, source_provider_id)
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
            .where(XAPIStatement.processed == False)  # noqa: E712
            .where(XAPIStatement.user_id.isnot(None))
            .where(XAPIStatement.completion == True)  # noqa: E712
            .limit(100)
        )
        statements = result.scalars().all()
        processed = 0

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
                    stmt.statement_timestamp.date()
                    if stmt.statement_timestamp
                    else date.today()
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
            seconds = 0
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
    """Service for generating training report exports (CSV/PDF)"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_compliance_csv(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> str:
        """Generate a compliance report as CSV string"""
        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = date(end_date.year, 1, 1)

        # Get all active, non-exempt members
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(User.compliance_exempt == False)  # noqa: E712
            .where(User.deleted_at.is_(None))
        )
        users = users_result.scalars().all()

        # Get requirements
        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.active == True)  # noqa: E712
        )
        requirements = req_result.scalars().all()

        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        header = ["Member Name", "Email", "Total Hours", "Completed Courses"]
        for req in requirements:
            header.append(f"{req.name} (Status)")
        writer.writerow(header)

        # Data rows
        for user in users:
            records_result = await self.db.execute(
                select(TrainingRecord)
                .where(TrainingRecord.user_id == str(user.id))
                .where(TrainingRecord.organization_id == organization_id)
                .where(TrainingRecord.status == TrainingStatus.COMPLETED)
                .where(TrainingRecord.completion_date >= start_date)
                .where(TrainingRecord.completion_date <= end_date)
            )
            records = records_result.scalars().all()

            total_hours = sum(r.hours_completed or 0 for r in records)
            row = [
                f"{user.first_name} {user.last_name}",
                user.email,
                f"{total_hours:.1f}",
                str(len(records)),
            ]

            # Check each requirement (simplified)
            for req in requirements:
                from app.services.training_service import TrainingService

                detail = TrainingService.evaluate_requirement_detail(
                    req, records, date.today()
                )
                row.append("Met" if detail["is_met"] else "Not Met")

            writer.writerow(row)

        return output.getvalue()

    async def generate_individual_csv(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> str:
        """Generate an individual training history CSV"""
        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = date(end_date.year - 1, 1, 1)

        records_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date >= start_date)
            .where(TrainingRecord.completion_date <= end_date)
            .order_by(TrainingRecord.completion_date.desc())
        )
        records = records_result.scalars().all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
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
            ]
        )

        for r in records:
            training_type = (
                r.training_type.value
                if hasattr(r.training_type, "value")
                else str(r.training_type)
            )
            writer.writerow(
                [
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
                ]
            )

        return output.getvalue()

    async def generate_compliance_forecast(
        self, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Generate predictive compliance forecast for all members"""
        today = date.today()
        forecasts = []

        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.compliance_exempt == False,  # noqa: E712
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()

        req_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == organization_id,
                TrainingRequirement.active == True,  # noqa: E712
            )
        )
        requirements = req_result.scalars().all()

        for user in users:
            records_result = await self.db.execute(
                select(TrainingRecord).where(
                    TrainingRecord.user_id == str(user.id),
                    TrainingRecord.organization_id == organization_id,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                )
            )
            records = records_result.scalars().all()

            # Current compliance
            met = 0
            at_risk = []
            expiring = []

            for req in requirements:
                from app.services.training_service import TrainingService

                detail = TrainingService.evaluate_requirement_detail(
                    req, records, today
                )
                if detail["is_met"]:
                    met += 1
                if (
                    detail.get("days_until_due") is not None
                    and 0 < detail["days_until_due"] <= 90
                ):
                    at_risk.append(
                        {"name": req.name, "days_until_due": detail["days_until_due"]}
                    )

            # Check expiring certs
            for r in records:
                if (
                    r.expiration_date
                    and today < r.expiration_date <= today + timedelta(days=90)
                ):
                    expiring.append(
                        {
                            "course_name": r.course_name,
                            "expiration_date": str(r.expiration_date),
                            "days_remaining": (r.expiration_date - today).days,
                        }
                    )

            total = len(requirements) if requirements else 1
            current_pct = (met / total * 100) if total > 0 else 100

            # Simple forecast: if certs are expiring, compliance drops
            expiring_30 = sum(1 for e in expiring if e["days_remaining"] <= 30)
            expiring_60 = sum(1 for e in expiring if e["days_remaining"] <= 60)
            expiring_90 = len(expiring)

            forecast_30 = (
                max(0, current_pct - (expiring_30 / total * 100))
                if total > 0
                else current_pct
            )
            forecast_60 = (
                max(0, current_pct - (expiring_60 / total * 100))
                if total > 0
                else current_pct
            )
            forecast_90 = (
                max(0, current_pct - (expiring_90 / total * 100))
                if total > 0
                else current_pct
            )

            forecasts.append(
                {
                    "user_id": str(user.id),
                    "user_name": f"{user.first_name} {user.last_name}",
                    "current_compliance_percentage": round(current_pct, 1),
                    "forecast_30_days": round(forecast_30, 1),
                    "forecast_60_days": round(forecast_60, 1),
                    "forecast_90_days": round(forecast_90, 1),
                    "at_risk_requirements": at_risk,
                    "expiring_certifications": expiring,
                }
            )

        return forecasts

    async def generate_compliance_pdf(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> io.BytesIO:
        """Generate a compliance report as a PDF document."""
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas

        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = date(end_date.year, 1, 1)

        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(User.compliance_exempt == False)  # noqa: E712
            .where(User.deleted_at.is_(None))
        )
        users = users_result.scalars().all()

        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.active == True)  # noqa: E712
        )
        requirements = req_result.scalars().all()

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        page_w, page_h = letter
        margin = 0.75 * inch

        # Title
        c.setFont("Helvetica-Bold", 16)
        c.drawString(margin, page_h - margin, "Training Compliance Report")
        c.setFont("Helvetica", 10)
        c.drawString(
            margin,
            page_h - margin - 18,
            f"Period: {start_date} to {end_date}  |  Generated: {date.today()}",
        )

        # Table header
        y = page_h - margin - 50
        col_x = [margin, margin + 160, margin + 280, margin + 370]
        headers = ["Member Name", "Email", "Total Hours", "Completed"]
        req_col_start = margin + 450
        c.setFont("Helvetica-Bold", 8)
        for i, h in enumerate(headers):
            c.drawString(col_x[i], y, h)
        for i, req in enumerate(requirements):
            x = req_col_start + i * 70
            if x + 60 > page_w - margin:
                break
            name = req.name[:10] + ("..." if len(req.name) > 10 else "")
            c.drawString(x, y, name)

        y -= 4
        c.setLineWidth(0.5)
        c.line(margin, y, page_w - margin, y)
        y -= 12

        c.setFont("Helvetica", 8)
        for user in users:
            if y < margin + 20:
                c.showPage()
                y = page_h - margin
                c.setFont("Helvetica", 8)

            records_result = await self.db.execute(
                select(TrainingRecord)
                .where(TrainingRecord.user_id == str(user.id))
                .where(TrainingRecord.organization_id == organization_id)
                .where(TrainingRecord.status == TrainingStatus.COMPLETED)
                .where(TrainingRecord.completion_date >= start_date)
                .where(TrainingRecord.completion_date <= end_date)
            )
            records = records_result.scalars().all()
            total_hours = sum(r.hours_completed or 0 for r in records)

            c.drawString(col_x[0], y, f"{user.first_name} {user.last_name}"[:25])
            c.drawString(col_x[1], y, (user.email or "")[:20])
            c.drawString(col_x[2], y, f"{total_hours:.1f}")
            c.drawString(col_x[3], y, str(len(records)))

            for i, req in enumerate(requirements):
                x = req_col_start + i * 70
                if x + 60 > page_w - margin:
                    break
                from app.services.training_service import TrainingService

                detail = TrainingService.evaluate_requirement_detail(
                    req, records, date.today()
                )
                status_text = "Met" if detail["is_met"] else "Not Met"
                if not detail["is_met"]:
                    c.setFillColorRGB(0.8, 0, 0)
                c.drawString(x, y, status_text)
                c.setFillColorRGB(0, 0, 0)

            y -= 14

        c.save()
        buf.seek(0)
        return buf

    async def generate_individual_pdf(
        self,
        user_id: str,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> io.BytesIO:
        """Generate an individual training history PDF."""
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas

        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = date(end_date.year - 1, 1, 1)

        # Get user info
        user_result = await self.db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        user_name = f"{user.first_name} {user.last_name}" if user else "Unknown"

        records_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date >= start_date)
            .where(TrainingRecord.completion_date <= end_date)
            .order_by(TrainingRecord.completion_date.desc())
        )
        records = records_result.scalars().all()

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=letter)
        page_w, page_h = letter
        margin = 0.75 * inch

        # Title
        c.setFont("Helvetica-Bold", 16)
        c.drawString(margin, page_h - margin, "Individual Training Report")
        c.setFont("Helvetica", 10)
        c.drawString(margin, page_h - margin - 18, f"Member: {user_name}")
        c.drawString(
            margin,
            page_h - margin - 32,
            f"Period: {start_date} to {end_date}  |  " f"Total Records: {len(records)}",
        )

        # Table header
        y = page_h - margin - 60
        col_x = [
            margin,
            margin + 150,
            margin + 230,
            margin + 300,
            margin + 360,
            margin + 420,
        ]
        headers = [
            "Course Name",
            "Type",
            "Completed",
            "Hours",
            "Cert #",
            "Expires",
        ]
        c.setFont("Helvetica-Bold", 8)
        for i, h in enumerate(headers):
            c.drawString(col_x[i], y, h)

        y -= 4
        c.setLineWidth(0.5)
        c.line(margin, y, page_w - margin, y)
        y -= 12

        c.setFont("Helvetica", 8)
        for r in records:
            if y < margin + 20:
                c.showPage()
                y = page_h - margin
                c.setFont("Helvetica", 8)

            training_type = (
                r.training_type.value
                if hasattr(r.training_type, "value")
                else str(r.training_type)
            )
            c.drawString(col_x[0], y, (r.course_name or "")[:25])
            c.drawString(col_x[1], y, training_type[:12])
            c.drawString(
                col_x[2],
                y,
                str(r.completion_date) if r.completion_date else "",
            )
            c.drawString(
                col_x[3],
                y,
                f"{r.hours_completed:.1f}" if r.hours_completed else "0",
            )
            c.drawString(col_x[4], y, (r.certification_number or "")[:15])
            c.drawString(
                col_x[5],
                y,
                str(r.expiration_date) if r.expiration_date else "",
            )
            y -= 14

        c.save()
        buf.seek(0)
        return buf
