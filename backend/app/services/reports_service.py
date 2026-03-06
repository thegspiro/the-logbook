"""
Reports Service

Business logic for report generation including member roster,
training summary, event attendance, and compliance reports.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, Optional, Tuple
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryStatus,
)
from app.models.event import Event, EventRSVP
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    RequirementProgress,
    RequirementProgressStatus,
    ShiftCompletionReport,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.operational_rank import OperationalRank
from app.models.user import User, UserStatus


class ReportsService:
    """Service for report generation"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_rank_display_map(self, organization_id: UUID) -> Dict[str, str]:
        """Build a rank_code → display_name mapping for the organization."""
        result = await self.db.execute(
            select(OperationalRank.rank_code, OperationalRank.display_name).where(
                OperationalRank.organization_id == str(organization_id),
                OperationalRank.is_active == True,  # noqa: E712
            )
        )
        return {row.rank_code: row.display_name for row in result}

    def _resolve_rank(
        self, rank_code: Optional[str], rank_map: Dict[str, str]
    ) -> Optional[str]:
        """Resolve a rank_code to its display_name, falling back to the code."""
        if not rank_code:
            return rank_code
        return rank_map.get(rank_code, rank_code)

    async def generate_report(
        self,
        organization_id: UUID,
        report_type: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a report based on type"""
        generators = {
            "member_roster": self._generate_member_roster,
            "training_summary": self._generate_training_summary,
            "event_attendance": self._generate_event_attendance,
            "training_progress": self._generate_training_progress,
            "annual_training": self._generate_annual_training,
            "department_overview": self._generate_department_overview,
            "admin_hours": self._generate_admin_hours,
            "certification_expiration": self._generate_certification_expiration,
            "apparatus_status": self._generate_apparatus_status,
            "inventory_status": self._generate_inventory_status,
            "compliance_status": self._generate_compliance_status,
            "call_volume": self._generate_call_volume,
        }

        generator = generators.get(report_type)
        if not generator:
            return {"error": f"Unknown report type: {report_type}"}

        return await generator(organization_id, start_date, end_date, filters)

    # ============================================
    # Member Roster Report
    # ============================================

    async def _generate_member_roster(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a member roster report"""
        query = (
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
            .order_by(User.last_name, User.first_name)
        )

        # Apply status filter
        status_filter = (filters or {}).get("status")
        if status_filter:
            try:
                query = query.where(User.status == UserStatus(status_filter))
            except ValueError:
                pass

        result = await self.db.execute(query)
        users = result.scalars().all()

        rank_map = await self._get_rank_display_map(organization_id)

        members = []
        active_count = 0
        inactive_count = 0

        for user in users:
            status_val = (
                user.status.value if hasattr(user.status, "value") else str(user.status)
            )
            is_active = status_val == UserStatus.ACTIVE.value
            if is_active:
                active_count += 1
            else:
                inactive_count += 1

            # Get roles
            role_names = [r.name for r in user.roles] if user.roles else []

            members.append(
                {
                    "id": str(user.id),
                    "first_name": user.first_name or "",
                    "last_name": user.last_name or "",
                    "email": user.email or "",
                    "membership_number": user.membership_number,
                    "rank": self._resolve_rank(user.rank, rank_map),
                    "status": status_val,
                    "station": user.station,
                    "joined_date": (
                        str(user.created_at.date()) if user.created_at else None
                    ),
                    "roles": role_names,
                }
            )

        return {
            "report_type": "member_roster",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_members": len(members),
            "active_members": active_count,
            "inactive_members": inactive_count,
            "members": members,
        }

    # ============================================
    # Training Summary Report
    # ============================================

    async def _generate_training_summary(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a training summary report"""
        # Get training records
        records_query = select(TrainingRecord).where(
            TrainingRecord.organization_id == str(organization_id)
        )

        if start_date:
            records_query = records_query.where(
                TrainingRecord.completion_date >= start_date
            )
        if end_date:
            records_query = records_query.where(
                TrainingRecord.completion_date <= end_date
            )

        records_result = await self.db.execute(records_query)
        records = records_result.scalars().all()

        # Get active (non-deleted) users
        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()

        # Total courses
        courses_result = await self.db.execute(
            select(func.count(TrainingCourse.id)).where(
                TrainingCourse.organization_id == str(organization_id)
            )
        )
        total_courses = courses_result.scalar() or 0

        # Aggregate per member
        member_stats = {}
        for user in users:
            member_stats[str(user.id)] = {
                "member_id": str(user.id),
                "member_name": f"{user.first_name or ''} {user.last_name or ''}".strip(),
                "total_courses": 0,
                "completed_courses": 0,
                "total_hours": 0,
                "compliance_percentage": 0,
            }

        completed_count = 0
        for record in records:
            uid = str(record.user_id)
            if uid in member_stats:
                member_stats[uid]["total_courses"] += 1
                status_val = (
                    record.status.value
                    if hasattr(record.status, "value")
                    else str(record.status)
                )
                if status_val == TrainingStatus.COMPLETED.value:
                    member_stats[uid]["completed_courses"] += 1
                    completed_count += 1
                if record.hours_completed:
                    member_stats[uid]["total_hours"] += float(record.hours_completed)

        entries = list(member_stats.values())
        completion_rate = (completed_count / len(records) * 100) if records else 0

        # ── Per-course breakdown (TC3) ──
        course_stats: Dict[str, Dict[str, Any]] = {}
        for record in records:
            cid = str(record.course_id) if record.course_id else "unknown"
            if cid not in course_stats:
                course_stats[cid] = {
                    "course_id": cid,
                    "course_name": record.course_name or cid,
                    "total": 0,
                    "completed": 0,
                    "total_hours": 0,
                }
            course_stats[cid]["total"] += 1
            status_val2 = (
                record.status.value
                if hasattr(record.status, "value")
                else str(record.status)
            )
            if status_val2 == TrainingStatus.COMPLETED.value:
                course_stats[cid]["completed"] += 1
            if record.hours_completed:
                course_stats[cid]["total_hours"] += float(record.hours_completed)
        course_breakdown = list(course_stats.values())

        # ── Per-requirement completion (TC3) ──
        # Use a single aggregated query instead of N+1 individual queries.
        # Count COMPLETED and VERIFIED progress per requirement, scoped to
        # active enrollments for non-deleted users in this organization.
        req_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == str(organization_id),
                TrainingRequirement.active == True,  # noqa: E712
            )
        )
        requirements = req_result.scalars().all()
        req_ids = [r.id for r in requirements]

        # Batch-fetch completed counts for all requirements at once
        completed_by_req: Dict[str, int] = {}
        if req_ids:
            agg_result = await self.db.execute(
                select(
                    RequirementProgress.requirement_id,
                    func.count(RequirementProgress.id),
                )
                .join(
                    ProgramEnrollment,
                    RequirementProgress.enrollment_id == ProgramEnrollment.id,
                )
                .join(User, User.id == ProgramEnrollment.user_id)
                .where(
                    RequirementProgress.requirement_id.in_(req_ids),
                    RequirementProgress.status.in_(
                        [
                            RequirementProgressStatus.COMPLETED,
                            RequirementProgressStatus.VERIFIED,
                        ]
                    ),
                    ProgramEnrollment.organization_id == str(organization_id),
                    ProgramEnrollment.status.in_(
                        [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]
                    ),
                    User.deleted_at.is_(None),
                )
                .group_by(RequirementProgress.requirement_id)
            )
            for row in agg_result.all():
                completed_by_req[str(row[0])] = row[1]

        # Count enrolled (non-deleted) users as the denominator per requirement
        enrolled_count = 0
        if req_ids:
            enrolled_result = await self.db.execute(
                select(func.count(func.distinct(ProgramEnrollment.user_id)))
                .join(User, User.id == ProgramEnrollment.user_id)
                .where(
                    ProgramEnrollment.organization_id == str(organization_id),
                    ProgramEnrollment.status.in_(
                        [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]
                    ),
                    User.deleted_at.is_(None),
                )
            )
            enrolled_count = enrolled_result.scalar() or 0

        # Fall back to active user count if no enrollments exist
        denominator = enrolled_count if enrolled_count > 0 else len(users)

        requirement_breakdown = []
        for req in requirements:
            completed_for_req = completed_by_req.get(str(req.id), 0)
            requirement_breakdown.append(
                {
                    "requirement_id": str(req.id),
                    "requirement_name": req.name,
                    "total_members": denominator,
                    "completed": completed_for_req,
                    "completion_pct": (
                        round(completed_for_req / denominator * 100, 1)
                        if denominator > 0
                        else 0
                    ),
                }
            )

        return {
            "report_type": "training_summary",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(start_date) if start_date else None,
            "period_end": str(end_date) if end_date else None,
            "total_courses": total_courses,
            "total_records": len(records),
            "completion_rate": round(completion_rate, 1),
            "entries": entries,
            "course_breakdown": course_breakdown,
            "requirement_breakdown": requirement_breakdown,
        }

    # ============================================
    # Event Attendance Report
    # ============================================

    async def _generate_event_attendance(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate an event attendance report"""
        events_query = select(Event).where(
            Event.organization_id == str(organization_id)
        )

        if start_date:
            events_query = events_query.where(
                Event.start_datetime
                >= datetime.combine(start_date, datetime.min.time())
            )
        if end_date:
            events_query = events_query.where(
                Event.start_datetime <= datetime.combine(end_date, datetime.max.time())
            )

        events_query = events_query.order_by(Event.start_datetime.desc())
        events_result = await self.db.execute(events_query)
        events = events_result.scalars().all()

        # Batch-fetch RSVP and attendance counts for all events in a single query
        event_ids = [e.id for e in events]
        rsvp_stats: Dict[str, Tuple[int, int]] = (
            {}
        )  # event_id -> (total_rsvps, attended)
        if event_ids:
            rsvp_agg = await self.db.execute(
                select(
                    EventRSVP.event_id,
                    func.count(EventRSVP.id),
                    func.sum(
                        case((EventRSVP.checked_in == True, 1), else_=0)
                    ),  # noqa: E712
                )
                .where(EventRSVP.event_id.in_(event_ids))
                .group_by(EventRSVP.event_id)
            )
            for row in rsvp_agg.all():
                rsvp_stats[str(row[0])] = (row[1], int(row[2] or 0))

        event_entries = []
        total_attendance_rate = 0

        for event in events:
            total_rsvps, attended = rsvp_stats.get(str(event.id), (0, 0))
            rate = (attended / total_rsvps * 100) if total_rsvps > 0 else 0

            event_entries.append(
                {
                    "event_id": str(event.id),
                    "event_title": event.title or "",
                    "event_date": (
                        str(event.start_datetime.date())
                        if event.start_datetime
                        else None
                    ),
                    "total_rsvps": total_rsvps,
                    "attended": attended,
                    "attendance_rate": round(rate, 1),
                }
            )
            total_attendance_rate += rate

        avg_rate = (total_attendance_rate / len(event_entries)) if event_entries else 0

        return {
            "report_type": "event_attendance",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(start_date) if start_date else None,
            "period_end": str(end_date) if end_date else None,
            "total_events": len(event_entries),
            "average_attendance_rate": round(avg_rate, 1),
            "events": event_entries,
        }

    # ============================================
    # Training Progress Report
    # ============================================

    async def _generate_training_progress(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a training pipeline progress report showing enrollment status and requirement completion."""
        # Get all enrollments with program details
        enrollments_query = (
            select(ProgramEnrollment)
            .options(
                selectinload(ProgramEnrollment.program),
                selectinload(ProgramEnrollment.requirement_progress),
            )
            .where(ProgramEnrollment.organization_id == str(organization_id))
        )

        status_filter = (filters or {}).get("status")
        if status_filter:
            try:
                enrollments_query = enrollments_query.where(
                    ProgramEnrollment.status == EnrollmentStatus(status_filter)
                )
            except ValueError:
                pass

        result = await self.db.execute(enrollments_query)
        enrollments = result.scalars().unique().all()

        # Get member map (exclude soft-deleted users)
        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()
        member_map = {
            str(u.id): f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
            for u in users
        }

        entries = []
        status_summary = {"active": 0, "completed": 0, "expired": 0, "withdrawn": 0}

        for enrollment in enrollments:
            status_val = (
                enrollment.status.value
                if hasattr(enrollment.status, "value")
                else str(enrollment.status)
            )
            status_summary[status_val] = status_summary.get(status_val, 0) + 1

            # Count requirement progress
            total_reqs = (
                len(enrollment.requirement_progress)
                if enrollment.requirement_progress
                else 0
            )
            completed_reqs = sum(
                1
                for rp in (enrollment.requirement_progress or [])
                if rp.status
                in (
                    RequirementProgressStatus.COMPLETED,
                    RequirementProgressStatus.VERIFIED,
                )
            )

            entries.append(
                {
                    "enrollment_id": str(enrollment.id),
                    "member_name": member_map.get(str(enrollment.user_id), "Unknown"),
                    "member_id": str(enrollment.user_id),
                    "program_name": (
                        enrollment.program.name if enrollment.program else "Unknown"
                    ),
                    "program_id": str(enrollment.program_id),
                    "status": status_val,
                    "progress_percentage": round(
                        enrollment.progress_percentage or 0, 1
                    ),
                    "requirements_completed": completed_reqs,
                    "requirements_total": total_reqs,
                    "enrolled_at": (
                        enrollment.enrolled_at.isoformat()
                        if enrollment.enrolled_at
                        else None
                    ),
                    "target_completion": (
                        str(enrollment.target_completion_date)
                        if enrollment.target_completion_date
                        else None
                    ),
                    "completed_at": (
                        enrollment.completed_at.isoformat()
                        if enrollment.completed_at
                        else None
                    ),
                }
            )

        # Sort by progress descending
        entries.sort(key=lambda e: e["progress_percentage"], reverse=True)

        avg_progress = (
            sum(e["progress_percentage"] for e in entries) / len(entries)
            if entries
            else 0
        )

        return {
            "report_type": "training_progress",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_enrollments": len(entries),
            "status_summary": status_summary,
            "average_progress": round(avg_progress, 1),
            "entries": entries,
        }

    # ============================================
    # Annual Training Report
    # ============================================

    async def _generate_annual_training(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate an annual training report with hours, completions, shift reports, and member breakdown."""
        # Default to current year if no dates provided
        year = (filters or {}).get("year", datetime.now(timezone.utc).year)
        if not start_date:
            start_date = date(int(year), 1, 1)
        if not end_date:
            end_date = date(int(year), 12, 31)

        # Get members
        users_result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.last_name, User.first_name)
        )
        users = users_result.scalars().all()
        member_map = {str(u.id): u for u in users}
        rank_map = await self._get_rank_display_map(organization_id)

        # Get training records in period
        records_result = await self.db.execute(
            select(TrainingRecord).where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.completion_date >= start_date,
                TrainingRecord.completion_date <= end_date,
            )
        )
        records = records_result.scalars().all()

        # Get shift completion reports in period
        shift_reports_result = await self.db.execute(
            select(ShiftCompletionReport).where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.shift_date >= start_date,
                ShiftCompletionReport.shift_date <= end_date,
            )
        )
        shift_reports = shift_reports_result.scalars().all()

        # Aggregate per member
        member_data = {}
        for uid, user in member_map.items():
            member_data[uid] = {
                "member_id": uid,
                "member_name": f"{user.first_name or ''} {user.last_name or ''}".strip()
                or user.username,
                "rank": self._resolve_rank(user.rank, rank_map),
                "training_hours": 0.0,
                "courses_completed": 0,
                "shift_hours": 0.0,
                "shifts_completed": 0,
                "calls_responded": 0,
                "avg_performance_rating": None,
            }

        # Process training records
        total_hours = 0.0
        total_completions = 0
        by_type = {}

        for record in records:
            uid = str(record.user_id)
            status_val = (
                record.status.value
                if hasattr(record.status, "value")
                else str(record.status)
            )
            hours = float(record.hours_completed or 0)
            training_type = (
                record.training_type.value
                if hasattr(record.training_type, "value")
                else str(record.training_type)
            )

            by_type[training_type] = by_type.get(training_type, 0) + 1

            if uid in member_data:
                member_data[uid]["training_hours"] += hours
                if status_val == TrainingStatus.COMPLETED.value:
                    member_data[uid]["courses_completed"] += 1
                    total_completions += 1
                total_hours += hours

        # Process shift reports
        total_shift_hours = 0.0
        total_calls = 0
        ratings = []

        for sr in shift_reports:
            uid = str(sr.trainee_id)
            if uid in member_data:
                member_data[uid]["shift_hours"] += float(sr.hours_on_shift or 0)
                member_data[uid]["shifts_completed"] += 1
                member_data[uid]["calls_responded"] += int(sr.calls_responded or 0)

            total_shift_hours += float(sr.hours_on_shift or 0)
            total_calls += int(sr.calls_responded or 0)
            if sr.performance_rating:
                ratings.append(sr.performance_rating)

        # Calculate per-member average ratings
        member_ratings = {}
        for sr in shift_reports:
            uid = str(sr.trainee_id)
            if sr.performance_rating:
                member_ratings.setdefault(uid, []).append(sr.performance_rating)

        for uid, r_list in member_ratings.items():
            if uid in member_data:
                member_data[uid]["avg_performance_rating"] = round(
                    sum(r_list) / len(r_list), 1
                )

        entries = sorted(
            member_data.values(),
            key=lambda m: m["training_hours"] + m["shift_hours"],
            reverse=True,
        )

        return {
            "report_type": "annual_training",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(start_date),
            "period_end": str(end_date),
            "year": int(year),
            "summary": {
                "total_members": len(users),
                "total_training_hours": round(total_hours, 1),
                "total_shift_hours": round(total_shift_hours, 1),
                "total_combined_hours": round(total_hours + total_shift_hours, 1),
                "total_completions": total_completions,
                "total_calls_responded": total_calls,
                "avg_hours_per_member": round(
                    (total_hours + total_shift_hours) / max(1, len(users)), 1
                ),
                "avg_performance_rating": (
                    round(sum(ratings) / len(ratings), 1) if ratings else None
                ),
                "training_by_type": by_type,
            },
            "entries": entries,
        }

    # ============================================
    # Certification Expiration Report
    # ============================================

    async def _generate_certification_expiration(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a certification expiration report showing overdue and upcoming expirations."""
        records_query = (
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == str(organization_id),
                TrainingRecord.status == TrainingStatus.COMPLETED,
            )
            .order_by(TrainingRecord.expiration_date.asc().nullslast())
        )
        records_result = await self.db.execute(records_query)
        records = records_result.scalars().all()

        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()
        rank_map = await self._get_rank_display_map(organization_id)
        member_map = {
            str(u.id): {
                "name": f"{u.first_name or ''} {u.last_name or ''}".strip()
                or u.username,
                "rank": self._resolve_rank(u.rank, rank_map),
            }
            for u in users
        }

        today = date.today()
        soon_threshold = int((filters or {}).get("expiring_soon_days", 90))

        entries = []
        expired_count = 0
        expiring_soon_count = 0
        valid_count = 0
        no_expiry_count = 0

        for record in records:
            uid = str(record.user_id)
            member_info = member_map.get(uid)
            if not member_info:
                continue

            exp_date = record.expiration_date
            if exp_date:
                days_until = (exp_date - today).days
                if days_until < 0:
                    status = "expired"
                    expired_count += 1
                elif days_until <= soon_threshold:
                    status = "expiring_soon"
                    expiring_soon_count += 1
                else:
                    status = "valid"
                    valid_count += 1
            else:
                days_until = None
                status = "no_expiry"
                no_expiry_count += 1

            entries.append(
                {
                    "member_id": uid,
                    "member_name": member_info["name"],
                    "rank": member_info["rank"],
                    "course_name": record.course_name or "",
                    "certification_number": getattr(
                        record, "certification_number", None
                    ),
                    "issuing_agency": getattr(record, "issuing_agency", None),
                    "completion_date": (
                        str(record.completion_date) if record.completion_date else None
                    ),
                    "expiration_date": str(exp_date) if exp_date else None,
                    "days_until_expiry": days_until,
                    "expiry_status": status,
                }
            )

        return {
            "report_type": "certification_expiration",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_certifications": len(entries),
            "expired_count": expired_count,
            "expiring_soon_count": expiring_soon_count,
            "valid_count": valid_count,
            "no_expiry_count": no_expiry_count,
            "entries": entries,
        }

    # ============================================
    # Apparatus / Fleet Status Report
    # ============================================

    async def _generate_apparatus_status(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a fleet status report with vehicle condition, maintenance, and mileage."""
        from app.models.apparatus import (
            Apparatus,
            ApparatusMaintenance,
        )

        apparatus_query = (
            select(Apparatus)
            .options(
                selectinload(Apparatus.apparatus_type),
                selectinload(Apparatus.status_record),
                selectinload(Apparatus.primary_station),
            )
            .where(
                Apparatus.organization_id == str(organization_id),
                Apparatus.is_archived == False,  # noqa: E712
            )
            .order_by(Apparatus.unit_number)
        )
        result = await self.db.execute(apparatus_query)
        apparatus_list = result.scalars().unique().all()

        apparatus_ids = [a.id for a in apparatus_list]
        wo_counts: Dict[str, int] = {}
        if apparatus_ids:
            wo_result = await self.db.execute(
                select(
                    ApparatusMaintenance.apparatus_id,
                    func.count(ApparatusMaintenance.id),
                )
                .where(
                    ApparatusMaintenance.apparatus_id.in_(apparatus_ids),
                    ApparatusMaintenance.status != "completed",
                )
                .group_by(ApparatusMaintenance.apparatus_id)
            )
            for row in wo_result.all():
                wo_counts[str(row[0])] = row[1]

        today = date.today()
        in_service = 0
        out_of_service = 0
        maint_due = 0
        report_entries = []

        for a in apparatus_list:
            status_name = a.status_record.name if a.status_record else "unknown"
            status_code = a.status_record.code if a.status_record else "unknown"
            type_name = a.apparatus_type.name if a.apparatus_type else "unknown"
            station_name = a.primary_station.name if a.primary_station else None
            open_wos = wo_counts.get(str(a.id), 0)

            inspection_exp = a.inspection_expiration
            days_until = (inspection_exp - today).days if inspection_exp else None

            if status_code in ("in_service", "available"):
                in_service += 1
            else:
                out_of_service += 1

            if days_until is not None and days_until <= 30:
                maint_due += 1

            report_entries.append(
                {
                    "apparatus_id": str(a.id),
                    "name": a.unit_number or a.name or "",
                    "apparatus_type": type_name,
                    "status": status_name,
                    "station": station_name,
                    "year": a.year,
                    "mileage": a.current_mileage,
                    "last_inspection_date": None,
                    "next_inspection_due": (
                        str(inspection_exp) if inspection_exp else None
                    ),
                    "days_until_inspection": days_until,
                    "open_work_orders": open_wos,
                }
            )

        return {
            "report_type": "apparatus_status",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_apparatus": len(report_entries),
            "in_service_count": in_service,
            "out_of_service_count": out_of_service,
            "maintenance_due_count": maint_due,
            "entries": report_entries,
        }

    # ============================================
    # Inventory Status Report
    # ============================================

    async def _generate_inventory_status(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate an inventory status report with stock levels and assignments."""
        from app.models.inventory import InventoryCategory, InventoryItem

        items_query = (
            select(InventoryItem)
            .options(selectinload(InventoryItem.category))
            .where(InventoryItem.organization_id == str(organization_id))
            .order_by(InventoryItem.name)
        )

        type_filter = (filters or {}).get("item_type")
        if type_filter:
            items_query = items_query.where(
                InventoryItem.category.has(InventoryCategory.item_type == type_filter)
            )

        result = await self.db.execute(items_query)
        items = result.scalars().unique().all()

        report_entries = []
        low_stock_count = 0
        assigned_count = 0
        total_value = 0.0

        for item in items:
            cat_name = item.category.name if item.category else None
            low_threshold = item.category.low_stock_threshold if item.category else None

            total_qty = item.quantity or 1
            issued_qty = item.quantity_issued or 0
            available_qty = total_qty - issued_qty

            is_low = low_threshold is not None and available_qty < low_threshold
            if is_low:
                low_stock_count += 1

            if item.assigned_to_user_id:
                assigned_count += 1

            if item.current_value:
                total_value += float(item.current_value)

            condition_val = (
                item.condition.value
                if hasattr(item.condition, "value")
                else str(item.condition)
            )
            item_type_val = ""
            if item.category and hasattr(item.category, "item_type"):
                item_type_val = (
                    item.category.item_type.value
                    if hasattr(item.category.item_type, "value")
                    else str(item.category.item_type)
                )

            report_entries.append(
                {
                    "item_id": str(item.id),
                    "name": item.name or "",
                    "item_type": item_type_val,
                    "category_name": cat_name,
                    "total_quantity": total_qty,
                    "assigned_quantity": issued_qty,
                    "available_quantity": available_qty,
                    "condition": condition_val,
                    "minimum_stock": low_threshold,
                    "is_low_stock": is_low,
                    "last_audit_date": (
                        str(item.last_inspection_date)
                        if item.last_inspection_date
                        else None
                    ),
                }
            )

        return {
            "report_type": "inventory_status",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_items": len(report_entries),
            "total_value": (round(total_value, 2) if total_value > 0 else None),
            "low_stock_count": low_stock_count,
            "assigned_count": assigned_count,
            "entries": report_entries,
        }

    # ============================================
    # Compliance Status Report
    # ============================================

    async def _generate_compliance_status(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate member-by-member compliance against training requirements."""
        req_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == str(organization_id),
                TrainingRequirement.active == True,  # noqa: E712
            )
        )
        requirements = req_result.scalars().all()
        req_map = {str(r.id): r for r in requirements}

        users_result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        users = users_result.scalars().all()
        rank_map = await self._get_rank_display_map(organization_id)

        enrollments_result = await self.db.execute(
            select(ProgramEnrollment)
            .options(selectinload(ProgramEnrollment.requirement_progress))
            .where(
                ProgramEnrollment.organization_id == str(organization_id),
                ProgramEnrollment.status.in_(
                    [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]
                ),
            )
        )
        enrollments = enrollments_result.scalars().unique().all()

        user_completed: Dict[str, set] = {}
        for enrollment in enrollments:
            uid = str(enrollment.user_id)
            if uid not in user_completed:
                user_completed[uid] = set()
            for rp in enrollment.requirement_progress or []:
                if rp.status in (
                    RequirementProgressStatus.COMPLETED,
                    RequirementProgressStatus.VERIFIED,
                ):
                    user_completed[uid].add(str(rp.requirement_id))

        total_reqs = len(requirements)
        report_entries = []
        fully_compliant = 0
        partially_compliant = 0
        non_compliant = 0

        for user in users:
            uid = str(user.id)
            completed_ids = user_completed.get(uid, set())
            completed_count = sum(1 for rid in req_map if rid in completed_ids)
            pct = (
                round(completed_count / total_reqs * 100, 1) if total_reqs > 0 else 100
            )

            overdue_items = [
                req_map[rid].name for rid in req_map if rid not in completed_ids
            ]

            if pct >= 100:
                fully_compliant += 1
            elif pct > 0:
                partially_compliant += 1
            else:
                non_compliant += 1

            report_entries.append(
                {
                    "member_id": uid,
                    "member_name": f"{user.first_name or ''} {user.last_name or ''}".strip()
                    or user.username,
                    "rank": self._resolve_rank(user.rank, rank_map),
                    "total_requirements": total_reqs,
                    "completed_requirements": completed_count,
                    "compliance_percentage": pct,
                    "overdue_items": overdue_items,
                    "upcoming_deadlines": [],
                }
            )

        report_entries.sort(key=lambda e: e["compliance_percentage"])

        overall_rate = (
            round(
                sum(e["compliance_percentage"] for e in report_entries)
                / len(report_entries),
                1,
            )
            if report_entries
            else 0
        )

        return {
            "report_type": "compliance_status",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_members": len(report_entries),
            "fully_compliant_count": fully_compliant,
            "partially_compliant_count": partially_compliant,
            "non_compliant_count": non_compliant,
            "overall_compliance_rate": overall_rate,
            "entries": report_entries,
        }

    # ============================================
    # Call Volume / Incident Report
    # ============================================

    async def _generate_call_volume(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate call volume report from shift completion reports."""
        period_start = start_date or date(date.today().year, 1, 1)
        period_end = end_date or date.today()

        reports_result = await self.db.execute(
            select(ShiftCompletionReport).where(
                ShiftCompletionReport.organization_id == str(organization_id),
                ShiftCompletionReport.shift_date >= period_start,
                ShiftCompletionReport.shift_date <= period_end,
            )
        )
        shift_reports = reports_result.scalars().all()

        daily_data: Dict[str, Dict[str, Any]] = {}
        total_calls = 0
        type_totals: Dict[str, int] = {}

        for sr in shift_reports:
            day = str(sr.shift_date)
            if day not in daily_data:
                daily_data[day] = {
                    "date": day,
                    "total_calls": 0,
                    "by_type": {},
                }

            calls = int(sr.calls_responded or 0)
            daily_data[day]["total_calls"] += calls
            total_calls += calls

            for ct in sr.call_types or []:
                daily_data[day]["by_type"][ct] = (
                    daily_data[day]["by_type"].get(ct, 0) + 1
                )
                type_totals[ct] = type_totals.get(ct, 0) + 1

        report_entries = sorted(daily_data.values(), key=lambda e: e["date"])

        num_days = max(1, (period_end - period_start).days + 1)
        avg_per_day = round(total_calls / num_days, 1)

        busiest = (
            max(report_entries, key=lambda e: e["total_calls"])
            if report_entries
            else None
        )

        return {
            "report_type": "call_volume",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(period_start),
            "period_end": str(period_end),
            "summary": {
                "total_calls": total_calls,
                "avg_calls_per_day": avg_per_day,
                "busiest_day": busiest["date"] if busiest else "",
                "busiest_day_count": (busiest["total_calls"] if busiest else 0),
                "by_type_totals": type_totals,
            },
            "entries": report_entries,
        }

    # ============================================
    # Available Reports
    # ============================================

    async def get_available_reports(self) -> Dict[str, Any]:
        """Get list of available reports"""
        return {
            "available_reports": [
                {
                    "id": "member_roster",
                    "title": "Member Roster",
                    "description": "Complete list of all organization members with their roles, status, and contact information.",
                    "category": "member",
                    "available": True,
                },
                {
                    "id": "training_summary",
                    "title": "Training Summary",
                    "description": "Overview of training completion rates, hours logged, and compliance status.",
                    "category": "training",
                    "available": True,
                },
                {
                    "id": "event_attendance",
                    "title": "Event Attendance",
                    "description": "Attendance rates and RSVP statistics for all events.",
                    "category": "event",
                    "available": True,
                },
                {
                    "id": "training_progress",
                    "title": "Training Progress",
                    "description": "Pipeline enrollment progress, requirement completion rates, and member advancement.",
                    "category": "training",
                    "available": True,
                },
                {
                    "id": "annual_training",
                    "title": "Annual Training Report",
                    "description": "Comprehensive annual breakdown of training hours, shift experience, calls responded, and performance ratings.",
                    "category": "training",
                    "available": True,
                },
                {
                    "id": "department_overview",
                    "title": "Department Overview",
                    "description": "Cross-module department health report: member counts, training rates, event attendance, and action item status.",
                    "category": "compliance",
                    "available": True,
                    "usesDateRange": True,
                },
                {
                    "id": "certification_expiration",
                    "title": "Certification Expiration",
                    "description": "Track expiring and overdue certifications across all members.",
                    "category": "compliance",
                    "available": True,
                },
                {
                    "id": "compliance_status",
                    "title": "Compliance Status",
                    "description": "Member-by-member compliance tracking against training requirements with gap analysis.",
                    "category": "compliance",
                    "available": True,
                },
                {
                    "id": "apparatus_status",
                    "title": "Fleet / Apparatus Status",
                    "description": "Vehicle status, maintenance due dates, mileage, and open work orders.",
                    "category": "operations",
                    "available": True,
                },
                {
                    "id": "inventory_status",
                    "title": "Inventory Status",
                    "description": "Stock levels, assigned equipment, low-stock alerts, and inventory valuation.",
                    "category": "operations",
                    "available": True,
                },
                {
                    "id": "call_volume",
                    "title": "Incident / Call Volume",
                    "description": "Call volume trends, incident type breakdown, and peak activity analysis.",
                    "category": "operations",
                    "available": True,
                    "usesDateRange": True,
                },
            ]
        }

    # ============================================
    # Department Overview Report (C3)
    # ============================================

    async def _generate_department_overview(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Cross-module department overview report.
        Aggregates key metrics from members, training, events, and action items.
        """
        from datetime import timedelta

        from app.models.meeting import ActionItemStatus, MeetingActionItem
        from app.models.minute import ActionItem as MinutesActionItem
        from app.models.minute import MinutesActionItemStatus

        org_id = str(organization_id)
        period_start = (
            start_date or (datetime.now(timezone.utc) - timedelta(days=365)).date()
        )
        period_end = end_date or datetime.now(timezone.utc).date()

        # ── Members ──
        total_result = await self.db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
            )
        )
        total_members = total_result.scalar() or 0

        active_result = await self.db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        active_members = active_result.scalar() or 0

        # ── Training ──
        training_total = await self.db.execute(
            select(func.count(TrainingRecord.id)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.completion_date >= period_start,
                TrainingRecord.completion_date <= period_end,
            )
        )
        training_completed = await self.db.execute(
            select(func.count(TrainingRecord.id)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= period_start,
                TrainingRecord.completion_date <= period_end,
            )
        )
        t_total = training_total.scalar() or 0
        t_completed = training_completed.scalar() or 0
        training_rate = round((t_completed / t_total * 100) if t_total > 0 else 0, 1)

        hours_result = await self.db.execute(
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= period_start,
                TrainingRecord.completion_date <= period_end,
            )
        )
        total_training_hours = float(hours_result.scalar() or 0)

        # ── Events ──
        events_result = await self.db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.start_datetime
                >= datetime.combine(period_start, datetime.min.time()),
                Event.start_datetime
                <= datetime.combine(period_end, datetime.max.time()),
                Event.is_cancelled == False,  # noqa: E712
            )
        )
        total_events = events_result.scalar() or 0

        checkins_result = await self.db.execute(
            select(func.count(EventRSVP.id)).where(
                EventRSVP.organization_id == org_id,
                EventRSVP.checked_in == True,  # noqa: E712
            )
        )
        total_checkins = checkins_result.scalar() or 0

        # ── Action Items ──
        open_meeting_items = await self.db.execute(
            select(func.count(MeetingActionItem.id)).where(
                MeetingActionItem.organization_id == org_id,
                MeetingActionItem.status.in_(
                    [ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]
                ),
            )
        )
        open_minutes_items = await self.db.execute(
            select(func.count(MinutesActionItem.id)).where(
                MinutesActionItem.status.in_(
                    [
                        MinutesActionItemStatus.PENDING.value,
                        MinutesActionItemStatus.IN_PROGRESS.value,
                    ]
                ),
            )
        )

        return {
            "report_type": "department_overview",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(period_start),
            "period_end": str(period_end),
            "members": {
                "total": total_members,
                "active": active_members,
                "inactive": total_members - active_members,
            },
            "training": {
                "total_records": t_total,
                "completed": t_completed,
                "completion_rate": training_rate,
                "total_hours": total_training_hours,
                "avg_hours_per_member": (
                    round(total_training_hours / active_members, 1)
                    if active_members > 0
                    else 0
                ),
            },
            "events": {
                "total_events": total_events,
                "total_checkins": total_checkins,
            },
            "action_items": {
                "open_from_meetings": open_meeting_items.scalar() or 0,
                "open_from_minutes": open_minutes_items.scalar() or 0,
            },
        }

    # ============================================
    # Admin Hours Report
    # ============================================

    async def _generate_admin_hours(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate admin hours report with per-member and per-category breakdown."""
        base_conditions = [
            AdminHoursEntry.organization_id == str(organization_id),
            AdminHoursEntry.status.in_(
                [
                    AdminHoursEntryStatus.APPROVED,
                    AdminHoursEntryStatus.PENDING,
                ]
            ),
            AdminHoursEntry.duration_minutes.isnot(None),
        ]
        if start_date:
            base_conditions.append(
                AdminHoursEntry.clock_in_at
                >= datetime.combine(
                    start_date, datetime.min.time(), tzinfo=timezone.utc
                )
            )
        if end_date:
            base_conditions.append(
                AdminHoursEntry.clock_in_at
                <= datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
            )

        # Individual entries with user and category info
        entries_query = (
            select(
                AdminHoursEntry,
                User.first_name,
                User.last_name,
                AdminHoursCategory.name.label("category_name"),
            )
            .join(User, AdminHoursEntry.user_id == User.id)
            .join(
                AdminHoursCategory, AdminHoursEntry.category_id == AdminHoursCategory.id
            )
            .where(*base_conditions)
            .order_by(AdminHoursEntry.clock_in_at.desc())
        )
        entries_result = await self.db.execute(entries_query)
        entries_rows = entries_result.all()

        entries = []
        unique_members = set()
        for entry, first_name, last_name, category_name in entries_rows:
            unique_members.add(entry.user_id)
            hours = round((entry.duration_minutes or 0) / 60, 2)
            entries.append(
                {
                    "member_name": f"{first_name} {last_name}",
                    "category_name": category_name,
                    "date": (
                        entry.clock_in_at.strftime("%Y-%m-%d")
                        if entry.clock_in_at
                        else None
                    ),
                    "hours": hours,
                    "entry_method": (
                        entry.entry_method.value if entry.entry_method else "manual"
                    ),
                    "status": entry.status.value if entry.status else "pending",
                }
            )

        # Summary totals
        total_query = await self.db.execute(
            select(
                func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0),
                func.count(AdminHoursEntry.id),
            ).where(*base_conditions)
        )
        total_row = total_query.one()
        total_minutes = int(total_row[0])
        total_entries = int(total_row[1])

        # By category
        category_query = await self.db.execute(
            select(
                AdminHoursCategory.name,
                func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0),
            )
            .join(
                AdminHoursCategory, AdminHoursEntry.category_id == AdminHoursCategory.id
            )
            .where(*base_conditions)
            .group_by(AdminHoursCategory.name)
        )
        hours_by_category = {
            name: round(int(mins) / 60, 2) for name, mins in category_query.all()
        }

        return {
            "report_type": "admin_hours",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "period_start": str(start_date) if start_date else None,
            "period_end": str(end_date) if end_date else None,
            "summary": {
                "total_hours": round(total_minutes / 60, 2),
                "total_entries": total_entries,
                "unique_members": len(unique_members),
                "hours_by_category": hours_by_category,
            },
            "entries": entries,
        }
