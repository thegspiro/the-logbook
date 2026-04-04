"""
Shift Completion Report Service

Business logic for shift officer reports on trainee experiences,
including automatic pipeline requirement progress updates.
"""

from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramRequirement,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftCall,
    ShiftCompletionReport,
    TrainingRequirement,
)
from app.services.training_program_service import TrainingProgramService


class ShiftCompletionService:
    """Service for managing shift completion reports"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_trainee_call_data_from_shift(
        self,
        shift_id: str,
        trainee_id: str,
    ) -> tuple[int, list[str]]:
        """Query actual ShiftCall records to get a trainee's call count
        and types.

        Searches responding_members JSON arrays for the trainee's user
        ID and collects the incident_type from each matching call.
        """
        result = await self.db.execute(
            select(
                ShiftCall.responding_members,
                ShiftCall.incident_type,
            ).where(ShiftCall.shift_id == shift_id)
        )

        calls_responded = 0
        call_types: list[str] = []
        for members, incident_type in result.all():
            if not members:
                continue
            member_ids = [str(m) for m in members]
            if trainee_id in member_ids:
                calls_responded += 1
                if incident_type:
                    call_types.append(incident_type)

        return calls_responded, call_types

    async def _get_trainee_hours_from_shift(
        self,
        shift_id: str,
        trainee_id: str,
    ) -> Optional[float]:
        """Get a trainee's hours from their ShiftAttendance record."""
        result = await self.db.execute(
            select(ShiftAttendance.duration_minutes).where(
                ShiftAttendance.shift_id == shift_id,
                ShiftAttendance.user_id == trainee_id,
            )
        )
        duration = result.scalar_one_or_none()
        if duration and duration > 0:
            return round(duration / 60.0, 2)
        return None

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
        review_status: str = "approved",
        commit: bool = True,
    ) -> ShiftCompletionReport:
        """Create a shift completion report and update pipeline progress."""

        # Validate shift linkage when provided
        data_sources: dict = {}
        if shift_id:
            shift = (
                await self.db.execute(
                    select(Shift).where(
                        Shift.id == shift_id,
                        Shift.organization_id == str(
                            organization_id
                        ),
                    )
                )
            ).scalar_one_or_none()
            if not shift:
                raise ValueError(
                    "Shift not found in this organization"
                )

            att_check = (
                await self.db.execute(
                    select(ShiftAttendance.id).where(
                        ShiftAttendance.shift_id == shift_id,
                        ShiftAttendance.user_id == trainee_id,
                    )
                )
            ).scalar_one_or_none()
            if not att_check:
                assignment = (
                    await self.db.execute(
                        select(ShiftAssignment.id).where(
                            ShiftAssignment.shift_id == shift_id,
                            ShiftAssignment.user_id == trainee_id,
                        )
                    )
                ).scalar_one_or_none()
                if not assignment:
                    raise ValueError(
                        "Trainee has no attendance or "
                        "assignment record for this shift"
                    )
                attendance = ShiftAttendance(
                    shift_id=shift_id,
                    user_id=trainee_id,
                )
                self.db.add(attendance)
                await self.db.flush()

            existing = (
                await self.db.execute(
                    select(ShiftCompletionReport.id).where(
                        ShiftCompletionReport.shift_id
                        == shift_id,
                        ShiftCompletionReport.trainee_id
                        == trainee_id,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                raise ValueError(
                    "A report already exists for this "
                    "trainee on this shift"
                )

        # When linked to a shift, auto-populate from actual records
        if shift_id:
            actual_calls, actual_types = (
                await self._get_trainee_call_data_from_shift(
                    shift_id, trainee_id
                )
            )
            calls_responded = actual_calls
            data_sources["calls_responded"] = "shift_calls"
            if actual_types:
                call_types = actual_types
                data_sources["call_types"] = "shift_calls"

            actual_hours = await self._get_trainee_hours_from_shift(
                shift_id, trainee_id
            )
            if actual_hours:
                hours_on_shift = actual_hours
                data_sources["hours_on_shift"] = "shift_attendance"

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
            skills_observed=(
                [
                    s.model_dump() if hasattr(s, "model_dump") else s
                    for s in skills_observed
                ]
                if skills_observed
                else None
            ),
            tasks_performed=(
                [
                    t.model_dump() if hasattr(t, "model_dump") else t
                    for t in tasks_performed
                ]
                if tasks_performed
                else None
            ),
            enrollment_id=enrollment_id,
            review_status=review_status,
            data_sources=data_sources if data_sources else None,
        )

        self.db.add(report)
        await self.db.flush()

        # Auto-update pipeline requirement progress — skip for drafts
        # since the officer hasn't reviewed the data yet.  Progress
        # will be triggered when the draft is completed/approved.
        if review_status != "draft":
            requirements_progressed = (
                await self._update_requirement_progress(
                    organization_id=organization_id,
                    trainee_id=trainee_id,
                    hours_on_shift=hours_on_shift,
                    calls_responded=calls_responded,
                    call_types=call_types,
                    enrollment_id=enrollment_id,
                    officer_id=officer_id,
                )
            )

            if requirements_progressed:
                report.requirements_progressed = requirements_progressed

        if commit:
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
        enrollment_query = select(ProgramEnrollment).where(
            ProgramEnrollment.user_id == trainee_id,
            ProgramEnrollment.organization_id == str(organization_id),
            ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
        )

        # If specific enrollment provided, narrow down
        if enrollment_id:
            enrollment_query = enrollment_query.where(
                ProgramEnrollment.id == str(enrollment_id)
            )

        result = await self.db.execute(enrollment_query)
        enrollments = result.scalars().all()

        program_service = TrainingProgramService(self.db)

        for enrollment in enrollments:
            # Get requirement progress records for this enrollment
            progress_result = await self.db.execute(
                select(RequirementProgress, TrainingRequirement)
                .join(
                    ProgramRequirement,
                    ProgramRequirement.requirement_id
                    == RequirementProgress.requirement_id,
                )
                .join(TrainingRequirement)
                .where(
                    RequirementProgress.enrollment_id == enrollment.id,
                    RequirementProgress.status.in_(
                        [
                            RequirementProgressStatus.NOT_STARTED,
                            RequirementProgressStatus.IN_PROGRESS,
                        ]
                    ),
                )
            )
            progress_entries = progress_result.all()

            for progress, requirement in progress_entries:
                value_to_add = 0.0
                call_type_detail = None

                if requirement.requirement_type == RequirementType.SHIFTS:
                    # Each shift report counts as 1 shift
                    value_to_add = 1.0
                elif (
                    requirement.requirement_type == RequirementType.CALLS
                    and calls_responded > 0
                ):
                    # Check if requirement specifies required call types
                    required_call_types = requirement.required_call_types or []
                    if required_call_types and call_types:
                        # Count only calls matching the required types
                        required_lower = [
                            rct.lower()
                            for rct in required_call_types
                        ]
                        matching_calls = [
                            ct
                            for ct in call_types
                            if isinstance(ct, str)
                            and ct.lower() in required_lower
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
                    from app.schemas.training_program import (
                        RequirementProgressUpdate,
                    )

                    new_value = (progress.progress_value or 0) + value_to_add

                    # Track call type breakdown in progress_notes
                    notes = dict(progress.progress_notes or {})
                    if call_type_detail:
                        call_type_history = notes.get("call_type_history", [])
                        call_type_history.append(
                            {
                                "date": str(date.today()),
                                "types": call_type_detail["matched_types"],
                                "count": len(
                                    call_type_detail["matched_types"]
                                ),
                            }
                        )
                        notes["call_type_history"] = call_type_history

                        # Build running totals per call type
                        type_totals = notes.get("call_type_totals", {})
                        for ct in call_type_detail["matched_types"]:
                            ct_key = ct.lower()
                            type_totals[ct_key] = (
                                type_totals.get(ct_key, 0) + 1
                            )
                        notes["call_type_totals"] = type_totals

                    update_data = RequirementProgressUpdate(
                        status="in_progress",
                        progress_value=new_value,
                        progress_notes=notes if notes else None,
                    )

                    updated_progress, error = (
                        await program_service.update_requirement_progress(
                            progress_id=progress.id,
                            organization_id=organization_id,
                            updates=update_data,
                            verified_by=officer_id,
                        )
                    )

                    if updated_progress and not error:
                        entry = {
                            "requirement_progress_id": str(progress.id),
                            "value_added": value_to_add,
                        }
                        if call_type_detail:
                            entry["call_types_matched"] = call_type_detail[
                                "matched_types"
                            ]
                        requirements_progressed.append(entry)

        return requirements_progressed

    async def get_report(
        self, report_id: str
    ) -> Optional[ShiftCompletionReport]:
        """Get a single shift completion report."""
        result = await self.db.execute(
            select(ShiftCompletionReport).where(
                ShiftCompletionReport.id == report_id
            )
        )
        return result.scalar_one_or_none()

    async def update_report(
        self,
        report_id: str,
        organization_id: UUID,
        officer_id: str,
        updates: dict,
    ) -> Optional[ShiftCompletionReport]:
        """Update a draft shift completion report and optionally submit it.

        When review_status transitions away from 'draft', training
        pipeline progress is triggered with the final report data.
        """
        report = await self.get_report(report_id)
        if not report:
            return None
        if report.organization_id != str(organization_id):
            return None
        if report.officer_id != officer_id:
            raise ValueError(
                "Only the filing officer can update this report"
            )

        was_draft = report.review_status == "draft"

        for field, value in updates.items():
            if hasattr(report, field) and field not in (
                "id", "organization_id", "officer_id",
                "trainee_id", "created_at",
            ):
                setattr(report, field, value)

        # Trigger training progress when a draft is completed
        if was_draft and report.review_status in (
            "approved", "pending_review",
        ):
            await self._trigger_deferred_progress(report, officer_id)

        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def _trigger_deferred_progress(
        self,
        report: ShiftCompletionReport,
        officer_id: str,
    ) -> None:
        """Trigger training pipeline progress that was deferred when
        a report was created as a draft."""
        requirements_progressed = (
            await self._update_requirement_progress(
                organization_id=UUID(report.organization_id),
                trainee_id=report.trainee_id,
                hours_on_shift=report.hours_on_shift,
                calls_responded=report.calls_responded,
                call_types=report.call_types,
                enrollment_id=report.enrollment_id,
                officer_id=UUID(officer_id),
            )
        )
        if requirements_progressed:
            report.requirements_progressed = requirements_progressed

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
        """Get all shift completion reports for the organization."""
        query = (
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id
                == str(organization_id)
            )
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
        report.trainee_acknowledged_at = datetime.now(timezone.utc)
        if trainee_comments:
            report.trainee_comments = trainee_comments

        await self.db.commit()
        await self.db.refresh(report)
        return report

    async def get_reports_by_status(
        self,
        organization_id: UUID,
        review_status: str,
    ) -> List[ShiftCompletionReport]:
        """Get reports filtered by review status."""
        result = await self.db.execute(
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.review_status == review_status,
            )
            .order_by(ShiftCompletionReport.shift_date.desc())
        )
        return list(result.scalars().all())

    async def review_report(
        self,
        report_id: str,
        organization_id: UUID,
        reviewer_id: str,
        review_status: str,
        reviewer_notes: Optional[str] = None,
        redact_fields: Optional[List[str]] = None,
    ) -> Optional[ShiftCompletionReport]:
        """Review a shift completion report: approve, flag, or redact fields.

        When transitioning from draft to approved/pending_review,
        triggers training pipeline progress that was deferred at
        draft creation time.
        """
        report = await self.get_report(report_id)
        if not report or report.organization_id != str(organization_id):
            return None

        was_draft = report.review_status == "draft"

        # Redact specified fields before approving (clear sensitive content)
        REDACTABLE_FIELDS = {
            "performance_rating",
            "areas_of_strength",
            "areas_for_improvement",
            "officer_narrative",
            "skills_observed",
        }
        if redact_fields:
            for field in redact_fields:
                if field in REDACTABLE_FIELDS and hasattr(report, field):
                    setattr(report, field, None)

        report.review_status = review_status
        report.reviewed_by = reviewer_id
        report.reviewed_at = datetime.now(timezone.utc)
        if reviewer_notes:
            report.reviewer_notes = reviewer_notes

        # Trigger deferred training progress when draft is activated
        if was_draft and review_status in ("approved", "pending_review"):
            await self._trigger_deferred_progress(
                report, reviewer_id,
            )

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
        base_filter = [
            ShiftCompletionReport.organization_id == str(organization_id),
            ShiftCompletionReport.trainee_id == trainee_id,
            ShiftCompletionReport.review_status != "draft",
        ]
        if start_date:
            base_filter.append(
                ShiftCompletionReport.shift_date >= start_date
            )
        if end_date:
            base_filter.append(
                ShiftCompletionReport.shift_date <= end_date
            )

        result = await self.db.execute(
            select(
                func.count(ShiftCompletionReport.id).label(
                    "total_reports"
                ),
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).label("total_hours"),
                func.sum(
                    ShiftCompletionReport.calls_responded
                ).label("total_calls"),
                func.avg(
                    ShiftCompletionReport.performance_rating
                ).label("avg_rating"),
            ).where(*base_filter)
        )
        row = result.one()

        # Monthly breakdown for trend display
        monthly_result = await self.db.execute(
            select(
                func.date_format(
                    ShiftCompletionReport.shift_date, "%Y-%m"
                ).label("month"),
                func.count(ShiftCompletionReport.id).label(
                    "reports"
                ),
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).label("hours"),
                func.sum(
                    ShiftCompletionReport.calls_responded
                ).label("calls"),
            )
            .where(*base_filter)
            .group_by("month")
            .order_by("month")
            .limit(12)
        )
        monthly = [
            {
                "month": r.month,
                "reports": r.reports or 0,
                "hours": float(r.hours or 0),
                "calls": int(r.calls or 0),
            }
            for r in monthly_result.all()
        ]

        return {
            "total_reports": row.total_reports or 0,
            "total_hours": float(row.total_hours or 0),
            "total_calls": int(row.total_calls or 0),
            "avg_rating": (
                round(float(row.avg_rating or 0), 1)
                if row.avg_rating
                else None
            ),
            "monthly": monthly,
        }

    async def get_officer_analytics(
        self,
        organization_id: UUID,
    ) -> dict:
        """Get org-wide shift report analytics for training officers.

        Returns aggregate totals, per-trainee summary, report status
        counts, and monthly trend data.
        """
        org_filter = [
            ShiftCompletionReport.organization_id
            == str(organization_id),
        ]

        # Aggregate totals (exclude drafts from counts)
        active_filter = org_filter + [
            ShiftCompletionReport.review_status != "draft",
        ]
        totals_result = await self.db.execute(
            select(
                func.count(ShiftCompletionReport.id).label(
                    "total_reports"
                ),
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).label("total_hours"),
                func.sum(
                    ShiftCompletionReport.calls_responded
                ).label("total_calls"),
                func.avg(
                    ShiftCompletionReport.performance_rating
                ).label("avg_rating"),
            ).where(*active_filter)
        )
        totals = totals_result.one()

        # Status breakdown (including drafts)
        status_result = await self.db.execute(
            select(
                ShiftCompletionReport.review_status,
                func.count(ShiftCompletionReport.id).label("count"),
            )
            .where(*org_filter)
            .group_by(ShiftCompletionReport.review_status)
        )
        status_counts = {
            r.review_status: r.count
            for r in status_result.all()
        }

        # Per-trainee summary
        from app.models.user import User

        trainee_result = await self.db.execute(
            select(
                ShiftCompletionReport.trainee_id,
                User.first_name,
                User.last_name,
                func.count(ShiftCompletionReport.id).label(
                    "reports"
                ),
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).label("hours"),
                func.sum(
                    ShiftCompletionReport.calls_responded
                ).label("calls"),
                func.avg(
                    ShiftCompletionReport.performance_rating
                ).label("avg_rating"),
            )
            .join(
                User,
                User.id == ShiftCompletionReport.trainee_id,
            )
            .where(*active_filter)
            .group_by(
                ShiftCompletionReport.trainee_id,
                User.first_name,
                User.last_name,
            )
            .order_by(
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).desc()
            )
        )
        trainees = [
            {
                "trainee_id": r.trainee_id,
                "name": (
                    f"{r.first_name or ''}"
                    f" {r.last_name or ''}"
                ).strip() or "Unknown",
                "reports": r.reports or 0,
                "hours": float(r.hours or 0),
                "calls": int(r.calls or 0),
                "avg_rating": (
                    round(float(r.avg_rating), 1)
                    if r.avg_rating
                    else None
                ),
            }
            for r in trainee_result.all()
        ]

        # Monthly trend (last 6 months)
        monthly_result = await self.db.execute(
            select(
                func.date_format(
                    ShiftCompletionReport.shift_date, "%Y-%m"
                ).label("month"),
                func.count(ShiftCompletionReport.id).label(
                    "reports"
                ),
                func.sum(
                    ShiftCompletionReport.hours_on_shift
                ).label("hours"),
            )
            .where(*active_filter)
            .group_by("month")
            .order_by("month")
            .limit(6)
        )
        monthly = [
            {
                "month": r.month,
                "reports": r.reports or 0,
                "hours": float(r.hours or 0),
            }
            for r in monthly_result.all()
        ]

        return {
            "total_reports": totals.total_reports or 0,
            "total_hours": float(totals.total_hours or 0),
            "total_calls": int(totals.total_calls or 0),
            "avg_rating": (
                round(float(totals.avg_rating or 0), 1)
                if totals.avg_rating
                else None
            ),
            "status_counts": status_counts,
            "trainees": trainees,
            "monthly": monthly,
        }
