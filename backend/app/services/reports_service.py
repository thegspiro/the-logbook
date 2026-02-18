"""
Reports Service

Business logic for report generation including member roster,
training summary, event attendance, and compliance reports.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, case
from uuid import UUID

from sqlalchemy.orm import selectinload

from app.models.user import User, UserStatus, Role, user_roles
from app.models.event import Event, EventRSVP
from app.models.training import (
    TrainingCourse, TrainingRecord, TrainingRequirement, TrainingStatus,
    ProgramEnrollment, RequirementProgress, TrainingProgram, ProgramRequirement,
    ShiftCompletionReport, EnrollmentStatus, RequirementProgressStatus,
)


class ReportsService:
    """Service for report generation"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_report(
        self, organization_id: UUID, report_type: str,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
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
        }

        generator = generators.get(report_type)
        if not generator:
            return {"error": f"Unknown report type: {report_type}"}

        return await generator(organization_id, start_date, end_date, filters)

    # ============================================
    # Member Roster Report
    # ============================================

    async def _generate_member_roster(
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a member roster report"""
        query = (
            select(User)
            .where(User.organization_id == str(organization_id))
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

        members = []
        active_count = 0
        inactive_count = 0

        for user in users:
            status_val = user.status.value if hasattr(user.status, 'value') else str(user.status)
            is_active = status_val == "active"
            if is_active:
                active_count += 1
            else:
                inactive_count += 1

            # Get roles
            role_names = [r.name for r in user.roles] if user.roles else []

            members.append({
                "id": str(user.id),
                "first_name": user.first_name or "",
                "last_name": user.last_name or "",
                "email": user.email or "",
                "badge_number": user.badge_number,
                "rank": user.rank,
                "status": status_val,
                "station": user.station,
                "joined_date": str(user.created_at.date()) if user.created_at else None,
                "roles": role_names,
            })

        return {
            "report_type": "member_roster",
            "generated_at": datetime.now().isoformat(),
            "total_members": len(members),
            "active_members": active_count,
            "inactive_members": inactive_count,
            "members": members,
        }

    # ============================================
    # Training Summary Report
    # ============================================

    async def _generate_training_summary(
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate a training summary report"""
        # Get training records
        records_query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(organization_id))
        )

        if start_date:
            records_query = records_query.where(TrainingRecord.completion_date >= start_date)
        if end_date:
            records_query = records_query.where(TrainingRecord.completion_date <= end_date)

        records_result = await self.db.execute(records_query)
        records = records_result.scalars().all()

        # Get active users
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.status == UserStatus.ACTIVE)
        )
        users = users_result.scalars().all()

        # Total courses
        courses_result = await self.db.execute(
            select(func.count(TrainingCourse.id))
            .where(TrainingCourse.organization_id == str(organization_id))
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
                status_val = record.status.value if hasattr(record.status, 'value') else str(record.status)
                if status_val == "completed":
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
                    "total": 0, "completed": 0, "total_hours": 0,
                }
            course_stats[cid]["total"] += 1
            status_val2 = record.status.value if hasattr(record.status, 'value') else str(record.status)
            if status_val2 == "completed":
                course_stats[cid]["completed"] += 1
            if record.hours_completed:
                course_stats[cid]["total_hours"] += float(record.hours_completed)
        course_breakdown = list(course_stats.values())

        # ── Per-requirement completion (TC3) ──
        req_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == str(organization_id),
                TrainingRequirement.is_active == True,  # noqa: E712
            )
        )
        requirements = req_result.scalars().all()
        requirement_breakdown = []
        for req in requirements:
            prog_result = await self.db.execute(
                select(func.count(RequirementProgress.id)).where(
                    RequirementProgress.requirement_id == req.id,
                    RequirementProgress.status == RequirementProgressStatus.COMPLETED,
                )
            )
            completed_for_req = prog_result.scalar() or 0
            requirement_breakdown.append({
                "requirement_id": str(req.id),
                "requirement_name": req.name,
                "total_members": len(users),
                "completed": completed_for_req,
                "completion_pct": round(completed_for_req / len(users) * 100, 1) if users else 0,
            })

        return {
            "report_type": "training_summary",
            "generated_at": datetime.now().isoformat(),
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
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate an event attendance report"""
        events_query = (
            select(Event)
            .where(Event.organization_id == str(organization_id))
        )

        if start_date:
            events_query = events_query.where(Event.start_date >= datetime.combine(start_date, datetime.min.time()))
        if end_date:
            events_query = events_query.where(Event.start_date <= datetime.combine(end_date, datetime.max.time()))

        events_query = events_query.order_by(Event.start_date.desc())
        events_result = await self.db.execute(events_query)
        events = events_result.scalars().all()

        event_entries = []
        total_attendance_rate = 0

        for event in events:
            # Count RSVPs
            rsvp_result = await self.db.execute(
                select(func.count(EventRSVP.id))
                .where(EventRSVP.event_id == event.id)
            )
            total_rsvps = rsvp_result.scalar() or 0

            # Count attended
            attended_result = await self.db.execute(
                select(func.count(EventRSVP.id))
                .where(EventRSVP.event_id == event.id)
                .where(EventRSVP.checked_in == True)
            )
            attended = attended_result.scalar() or 0

            rate = (attended / total_rsvps * 100) if total_rsvps > 0 else 0

            event_entries.append({
                "event_id": str(event.id),
                "event_title": event.title or "",
                "event_date": str(event.start_date.date()) if event.start_date else None,
                "total_rsvps": total_rsvps,
                "attended": attended,
                "attendance_rate": round(rate, 1),
            })
            total_attendance_rate += rate

        avg_rate = (total_attendance_rate / len(event_entries)) if event_entries else 0

        return {
            "report_type": "event_attendance",
            "generated_at": datetime.now().isoformat(),
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
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
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

        # Get member map
        users_result = await self.db.execute(
            select(User).where(User.organization_id == str(organization_id))
        )
        users = users_result.scalars().all()
        member_map = {str(u.id): f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username for u in users}

        entries = []
        status_summary = {"active": 0, "completed": 0, "expired": 0, "withdrawn": 0}

        for enrollment in enrollments:
            status_val = enrollment.status.value if hasattr(enrollment.status, 'value') else str(enrollment.status)
            status_summary[status_val] = status_summary.get(status_val, 0) + 1

            # Count requirement progress
            total_reqs = len(enrollment.requirement_progress) if enrollment.requirement_progress else 0
            completed_reqs = sum(
                1 for rp in (enrollment.requirement_progress or [])
                if rp.status in (RequirementProgressStatus.COMPLETED, RequirementProgressStatus.VERIFIED)
            )

            entries.append({
                "enrollment_id": str(enrollment.id),
                "member_name": member_map.get(str(enrollment.user_id), "Unknown"),
                "member_id": str(enrollment.user_id),
                "program_name": enrollment.program.name if enrollment.program else "Unknown",
                "program_id": str(enrollment.program_id),
                "status": status_val,
                "progress_percentage": round(enrollment.progress_percentage or 0, 1),
                "requirements_completed": completed_reqs,
                "requirements_total": total_reqs,
                "enrolled_at": enrollment.enrolled_at.isoformat() if enrollment.enrolled_at else None,
                "target_completion": str(enrollment.target_completion_date) if enrollment.target_completion_date else None,
                "completed_at": enrollment.completed_at.isoformat() if enrollment.completed_at else None,
            })

        # Sort by progress descending
        entries.sort(key=lambda e: e["progress_percentage"], reverse=True)

        avg_progress = (
            sum(e["progress_percentage"] for e in entries) / len(entries)
            if entries else 0
        )

        return {
            "report_type": "training_progress",
            "generated_at": datetime.now().isoformat(),
            "total_enrollments": len(entries),
            "status_summary": status_summary,
            "average_progress": round(avg_progress, 1),
            "entries": entries,
        }

    # ============================================
    # Annual Training Report
    # ============================================

    async def _generate_annual_training(
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Generate an annual training report with hours, completions, shift reports, and member breakdown."""
        # Default to current year if no dates provided
        year = (filters or {}).get("year", datetime.now().year)
        if not start_date:
            start_date = date(int(year), 1, 1)
        if not end_date:
            end_date = date(int(year), 12, 31)

        # Get members
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id, User.status == UserStatus.ACTIVE)
            .order_by(User.last_name, User.first_name)
        )
        users = users_result.scalars().all()
        member_map = {str(u.id): u for u in users}

        # Get training records in period
        records_result = await self.db.execute(
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.completion_date >= start_date,
                TrainingRecord.completion_date <= end_date,
            )
        )
        records = records_result.scalars().all()

        # Get shift completion reports in period
        shift_reports_result = await self.db.execute(
            select(ShiftCompletionReport)
            .where(
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
                "member_name": f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username,
                "rank": user.rank,
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
            status_val = record.status.value if hasattr(record.status, 'value') else str(record.status)
            hours = float(record.hours_completed or 0)
            training_type = record.training_type.value if hasattr(record.training_type, 'value') else str(record.training_type)

            by_type[training_type] = by_type.get(training_type, 0) + 1

            if uid in member_data:
                member_data[uid]["training_hours"] += hours
                if status_val == "completed":
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
                member_data[uid]["avg_performance_rating"] = round(sum(r_list) / len(r_list), 1)

        entries = sorted(member_data.values(), key=lambda m: m["training_hours"] + m["shift_hours"], reverse=True)

        return {
            "report_type": "annual_training",
            "generated_at": datetime.now().isoformat(),
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
                "avg_hours_per_member": round((total_hours + total_shift_hours) / max(1, len(users)), 1),
                "avg_performance_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
                "training_by_type": by_type,
            },
            "entries": entries,
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
                    "id": "compliance_status",
                    "title": "Compliance Status",
                    "description": "Organization-wide compliance tracking against requirements and certifications.",
                    "category": "compliance",
                    "available": False,
                },
            ]
        }

    # ============================================
    # Department Overview Report (C3)
    # ============================================

    async def _generate_department_overview(
        self, organization_id: UUID,
        start_date: Optional[date] = None, end_date: Optional[date] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Cross-module department overview report.
        Aggregates key metrics from members, training, events, and action items.
        """
        from datetime import timedelta
        from app.models.meeting import MeetingActionItem, ActionItemStatus
        from app.models.minute import ActionItem as MinutesActionItem, MinutesActionItemStatus

        org_id = str(organization_id)
        period_start = start_date or (datetime.utcnow() - timedelta(days=365)).date()
        period_end = end_date or datetime.utcnow().date()

        # ── Members ──
        total_result = await self.db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id, User.deleted_at.is_(None),
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
                Event.start_datetime >= datetime.combine(period_start, datetime.min.time()),
                Event.start_datetime <= datetime.combine(period_end, datetime.max.time()),
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
                MeetingActionItem.status.in_([ActionItemStatus.OPEN.value, ActionItemStatus.IN_PROGRESS.value]),
            )
        )
        open_minutes_items = await self.db.execute(
            select(func.count(MinutesActionItem.id)).where(
                MinutesActionItem.status.in_([
                    MinutesActionItemStatus.PENDING.value,
                    MinutesActionItemStatus.IN_PROGRESS.value,
                ]),
            )
        )

        return {
            "report_type": "department_overview",
            "generated_at": datetime.now().isoformat(),
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
                "avg_hours_per_member": round(total_training_hours / active_members, 1) if active_members > 0 else 0,
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
