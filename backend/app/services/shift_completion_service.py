"""
Shift Completion Report Service

Business logic for shift officer reports on trainee experiences,
including automatic pipeline requirement progress updates.
"""

from typing import Optional, List, Tuple
from uuid import UUID
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.models.training import (
    ShiftCompletionReport,
    ProgramEnrollment,
    RequirementProgress,
    ProgramRequirement,
    TrainingRequirement,
    RequirementType,
    RequirementProgressStatus,
    EnrollmentStatus,
)
from app.services.training_program_service import TrainingProgramService


class ShiftCompletionService:
    """Service for managing shift completion reports"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_report(
        self,
        organization_id: UUID,
        officer_id: UUID,
        trainee_id: str,
        shift_date: date,
        hours_on_shift: float,
        calls_responded: int = 0,
        call_types: Optional[list] = None,
        shift_id: Optional[str] = None,
        performance_rating: Optional[int] = None,
        areas_of_strength: Optional[str] = None,
        areas_for_improvement: Optional[str] = None,
        officer_narrative: Optional[str] = None,
        skills_observed: Optional[list] = None,
        tasks_performed: Optional[list] = None,
        enrollment_id: Optional[str] = None,
    ) -> ShiftCompletionReport:
        """Create a shift completion report and update pipeline progress."""

        report = ShiftCompletionReport(
            organization_id=str(organization_id),
            officer_id=str(officer_id),
            trainee_id=trainee_id,
            shift_date=shift_date,
            hours_on_shift=hours_on_shift,
            calls_responded=calls_responded,
            call_types=call_types,
            shift_id=shift_id,
            performance_rating=performance_rating,
            areas_of_strength=areas_of_strength,
            areas_for_improvement=areas_for_improvement,
            officer_narrative=officer_narrative,
            skills_observed=[s.model_dump() if hasattr(s, 'model_dump') else s for s in skills_observed] if skills_observed else None,
            tasks_performed=[t.model_dump() if hasattr(t, 'model_dump') else t for t in tasks_performed] if tasks_performed else None,
            enrollment_id=enrollment_id,
        )

        self.db.add(report)
        await self.db.flush()

        # Auto-update pipeline requirement progress
        requirements_progressed = await self._update_requirement_progress(
            organization_id=organization_id,
            trainee_id=trainee_id,
            hours_on_shift=hours_on_shift,
            calls_responded=calls_responded,
            call_types=call_types,
            enrollment_id=enrollment_id,
            officer_id=officer_id,
        )

        if requirements_progressed:
            report.requirements_progressed = requirements_progressed

        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def _update_requirement_progress(
        self,
        organization_id: UUID,
        trainee_id: str,
        hours_on_shift: float,
        calls_responded: int,
        call_types: Optional[list],
        enrollment_id: Optional[str],
        officer_id: UUID,
    ) -> list:
        """
        Find active enrollment requirements for the trainee and
        increment progress for shift-based and call-based requirements.
        """
        requirements_progressed = []

        # Find active enrollments for this trainee
        enrollment_query = (
            select(ProgramEnrollment)
            .where(
                ProgramEnrollment.user_id == trainee_id,
                ProgramEnrollment.organization_id == str(organization_id),
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )

        # If specific enrollment provided, narrow down
        if enrollment_id:
            enrollment_query = enrollment_query.where(ProgramEnrollment.id == str(enrollment_id))

        result = await self.db.execute(enrollment_query)
        enrollments = result.scalars().all()

        program_service = TrainingProgramService(self.db)

        for enrollment in enrollments:
            # Get requirement progress records for this enrollment
            progress_result = await self.db.execute(
                select(RequirementProgress, TrainingRequirement)
                .join(
                    ProgramRequirement,
                    ProgramRequirement.requirement_id == RequirementProgress.requirement_id
                )
                .join(TrainingRequirement)
                .where(
                    RequirementProgress.enrollment_id == enrollment.id,
                    RequirementProgress.status.in_([
                        RequirementProgressStatus.NOT_STARTED,
                        RequirementProgressStatus.IN_PROGRESS,
                    ]),
                )
            )
            progress_entries = progress_result.all()

            for progress, requirement in progress_entries:
                value_to_add = 0.0
                call_type_detail = None

                if requirement.requirement_type == RequirementType.SHIFTS:
                    # Each shift report counts as 1 shift
                    value_to_add = 1.0
                elif requirement.requirement_type == RequirementType.CALLS and calls_responded > 0:
                    # Check if requirement specifies required call types
                    required_call_types = requirement.required_call_types or []
                    if required_call_types and call_types:
                        # Count only calls matching the required types
                        required_lower = [rct.lower() for rct in required_call_types]
                        matching_calls = [
                            ct for ct in call_types
                            if isinstance(ct, str) and ct.lower() in required_lower
                        ]
                        value_to_add = float(len(matching_calls))
                        if matching_calls:
                            call_type_detail = {
                                "matched_types": matching_calls,
                                "required_types": required_call_types,
                            }
                    else:
                        # No specific types required — count all calls
                        value_to_add = float(calls_responded)
                elif requirement.requirement_type == RequirementType.HOURS:
                    # Add shift hours toward hour-based requirements
                    value_to_add = hours_on_shift
                else:
                    continue

                if value_to_add > 0:
                    from app.schemas.training_program import RequirementProgressUpdate
                    new_value = (progress.progress_value or 0) + value_to_add

                    # Track call type breakdown in progress_notes
                    notes = dict(progress.progress_notes or {})
                    if call_type_detail:
                        call_type_history = notes.get("call_type_history", [])
                        call_type_history.append({
                            "date": str(date.today()),
                            "types": call_type_detail["matched_types"],
                            "count": len(call_type_detail["matched_types"]),
                        })
                        notes["call_type_history"] = call_type_history

                        # Build running totals per call type
                        type_totals = notes.get("call_type_totals", {})
                        for ct in call_type_detail["matched_types"]:
                            type_totals[ct.lower()] = type_totals.get(ct.lower(), 0) + 1
                        notes["call_type_totals"] = type_totals

                    update_data = RequirementProgressUpdate(
                        status="in_progress",
                        progress_value=new_value,
                        progress_notes=notes if notes else None,
                    )

                    updated_progress, error = await program_service.update_requirement_progress(
                        progress_id=progress.id,
                        organization_id=organization_id,
                        updates=update_data,
                        verified_by=officer_id,
                    )

                    if updated_progress and not error:
                        entry = {
                            "requirement_progress_id": str(progress.id),
                            "value_added": value_to_add,
                        }
                        if call_type_detail:
                            entry["call_types_matched"] = call_type_detail["matched_types"]
                        requirements_progressed.append(entry)

        return requirements_progressed

    async def get_report(self, report_id: str) -> Optional[ShiftCompletionReport]:
        """Get a single shift completion report."""
        result = await self.db.execute(
            select(ShiftCompletionReport).where(ShiftCompletionReport.id == report_id)
        )
        return result.scalar_one_or_none()

    async def get_reports_for_trainee(
        self,
        organization_id: UUID,
        trainee_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 50,
    ) -> List[ShiftCompletionReport]:
        """Get shift completion reports for a specific trainee."""
        query = (
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.trainee_id == trainee_id,
            )
            .order_by(ShiftCompletionReport.shift_date.desc())
            .limit(limit)
        )
        if start_date:
            query = query.where(ShiftCompletionReport.shift_date >= start_date)
        if end_date:
            query = query.where(ShiftCompletionReport.shift_date <= end_date)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_reports_by_officer(
        self,
        organization_id: UUID,
        officer_id: str,
        limit: int = 50,
    ) -> List[ShiftCompletionReport]:
        """Get shift completion reports filed by a specific officer."""
        result = await self.db.execute(
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.officer_id == officer_id,
            )
            .order_by(ShiftCompletionReport.shift_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_all_reports(
        self,
        organization_id: UUID,
        trainee_id: Optional[str] = None,
        officer_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[ShiftCompletionReport]:
        """Get all shift completion reports for the organization with optional filters."""
        query = (
            select(ShiftCompletionReport)
            .where(ShiftCompletionReport.organization_id == str(organization_id))
            .order_by(ShiftCompletionReport.shift_date.desc())
            .limit(limit)
            .offset(offset)
        )
        if trainee_id:
            query = query.where(ShiftCompletionReport.trainee_id == trainee_id)
        if officer_id:
            query = query.where(ShiftCompletionReport.officer_id == officer_id)
        if start_date:
            query = query.where(ShiftCompletionReport.shift_date >= start_date)
        if end_date:
            query = query.where(ShiftCompletionReport.shift_date <= end_date)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def acknowledge_report(
        self,
        report_id: str,
        trainee_id: str,
        trainee_comments: Optional[str] = None,
    ) -> Optional[ShiftCompletionReport]:
        """Trainee acknowledges a shift completion report."""
        report = await self.get_report(report_id)
        if not report or report.trainee_id != trainee_id:
            return None

        report.trainee_acknowledged = True
        report.trainee_acknowledged_at = datetime.utcnow()
        if trainee_comments:
            report.trainee_comments = trainee_comments

        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def get_trainee_stats(
        self,
        organization_id: UUID,
        trainee_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> dict:
        """Get aggregate stats for a trainee's shift completion reports."""
        query = (
            select(
                func.count(ShiftCompletionReport.id).label("total_reports"),
                func.sum(ShiftCompletionReport.hours_on_shift).label("total_hours"),
                func.sum(ShiftCompletionReport.calls_responded).label("total_calls"),
                func.avg(ShiftCompletionReport.performance_rating).label("avg_rating"),
            )
            .where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.trainee_id == trainee_id,
            )
        )
        if start_date:
            query = query.where(ShiftCompletionReport.shift_date >= start_date)
        if end_date:
            query = query.where(ShiftCompletionReport.shift_date <= end_date)

        result = await self.db.execute(query)
        row = result.one()

        return {
            "total_reports": row.total_reports or 0,
            "total_hours": float(row.total_hours or 0),
            "total_calls": int(row.total_calls or 0),
            "avg_rating": round(float(row.avg_rating or 0), 1) if row.avg_rating else None,
        }
