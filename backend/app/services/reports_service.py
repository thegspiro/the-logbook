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

from app.models.user import User, UserStatus, Role, user_roles
from app.models.event import Event, EventRSVP
from app.models.training import TrainingCourse, TrainingRecord, TrainingRequirement, TrainingStatus


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
            .where(User.organization_id == organization_id)
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
            .where(TrainingRecord.organization_id == organization_id)
        )

        if start_date:
            records_query = records_query.where(TrainingRecord.completed_date >= start_date)
        if end_date:
            records_query = records_query.where(TrainingRecord.completed_date <= end_date)

        records_result = await self.db.execute(records_query)
        records = records_result.scalars().all()

        # Get active users
        users_result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status == UserStatus.ACTIVE)
        )
        users = users_result.scalars().all()

        # Total courses
        courses_result = await self.db.execute(
            select(func.count(TrainingCourse.id))
            .where(TrainingCourse.organization_id == organization_id)
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

        return {
            "report_type": "training_summary",
            "generated_at": datetime.now().isoformat(),
            "period_start": str(start_date) if start_date else None,
            "period_end": str(end_date) if end_date else None,
            "total_courses": total_courses,
            "total_records": len(records),
            "completion_rate": round(completion_rate, 1),
            "entries": entries,
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
            .where(Event.organization_id == organization_id)
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
                    "id": "compliance_status",
                    "title": "Compliance Status",
                    "description": "Organization-wide compliance tracking against requirements and certifications.",
                    "category": "compliance",
                    "available": False,
                },
            ]
        }
