"""
Attendance Dashboard Service

Provides a secretary/leadership view of member attendance status,
meeting attendance percentages, waivers, and voting eligibility.
"""

from datetime import datetime, timedelta, date
from typing import Dict, List, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from app.models.user import User, UserStatus, Organization
from app.models.meeting import Meeting, MeetingAttendee
from app.services.membership_tier_service import MembershipTierService


class AttendanceDashboardService:
    """Generates attendance dashboard data for secretary/leadership."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_dashboard(
        self,
        organization_id: UUID,
        period_months: int = 12,
        meeting_type: Optional[str] = None,
    ) -> Dict:
        """
        Generate the secretary's attendance dashboard.

        Returns per-member:
        - attendance_pct, meetings_attended, meetings_waived, total_meetings
        - membership_tier, voting_eligible, voting_blocked_reason
        """
        org_id = str(organization_id)
        tier_service = MembershipTierService(self.db)

        # Load org for tier config
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == org_id)
        )
        org = org_result.scalar_one_or_none()
        tier_config = (org.settings or {}).get("membership_tiers", {}) if org else {}
        tiers = tier_config.get("tiers", [])

        # Load active members
        member_result = await self.db.execute(
            select(User)
            .where(User.organization_id == org_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(User.deleted_at.is_(None))
            .order_by(User.last_name, User.first_name)
        )
        members = list(member_result.scalars().all())

        cutoff = datetime.utcnow() - timedelta(days=period_months * 30)

        # Total meetings in period
        meeting_query = select(func.count(Meeting.id)).where(
            Meeting.organization_id == org_id,
            Meeting.meeting_date >= cutoff.date(),
        )
        if meeting_type:
            meeting_query = meeting_query.where(Meeting.meeting_type == meeting_type)
        total_result = await self.db.execute(meeting_query)
        total_meetings = total_result.scalar() or 0

        # Get all attendance records for the period
        meeting_ids_subq = select(Meeting.id).where(
            Meeting.organization_id == org_id,
            Meeting.meeting_date >= cutoff.date(),
        )
        if meeting_type:
            meeting_ids_subq = meeting_ids_subq.where(Meeting.meeting_type == meeting_type)

        att_result = await self.db.execute(
            select(MeetingAttendee).where(
                MeetingAttendee.meeting_id.in_(meeting_ids_subq)
            )
        )
        all_attendance = list(att_result.scalars().all())

        # Index by user_id
        attendance_by_user: Dict[str, List[MeetingAttendee]] = {}
        for att in all_attendance:
            uid = str(att.user_id)
            if uid not in attendance_by_user:
                attendance_by_user[uid] = []
            attendance_by_user[uid].append(att)

        rows = []
        for member in members:
            uid = str(member.id)
            records = attendance_by_user.get(uid, [])
            attended = sum(1 for r in records if r.present and not r.waiver_reason)
            waived = sum(1 for r in records if r.waiver_reason)
            absent = total_meetings - attended - waived

            eligible_meetings = total_meetings - waived
            pct = round((attended / eligible_meetings) * 100, 1) if eligible_meetings > 0 else 100.0

            # Tier and voting info
            member_tier_id = member.membership_type or "active"
            tier_def = next((t for t in tiers if t.get("id") == member_tier_id), None)
            benefits = tier_def.get("benefits", {}) if tier_def else {}

            voting_eligible = benefits.get("voting_eligible", True)
            voting_blocked_reason = None
            if not voting_eligible:
                voting_blocked_reason = f"Tier '{member_tier_id}' is not eligible to vote"
            elif benefits.get("voting_requires_meeting_attendance", False):
                min_pct = benefits.get("voting_min_attendance_pct", 0.0)
                if pct < min_pct:
                    voting_eligible = False
                    voting_blocked_reason = (
                        f"Attendance {pct}% below minimum {min_pct}% "
                        f"(requires {min_pct}% over {period_months} months)"
                    )

            rows.append({
                "user_id": uid,
                "name": member.full_name,
                "membership_tier": member_tier_id,
                "tier_name": tier_def.get("name", member_tier_id) if tier_def else member_tier_id,
                "hire_date": member.hire_date.isoformat() if member.hire_date else None,
                "attendance_pct": pct,
                "meetings_attended": attended,
                "meetings_waived": waived,
                "meetings_absent": max(0, absent),
                "total_meetings": total_meetings,
                "eligible_meetings": eligible_meetings,
                "voting_eligible": voting_eligible,
                "voting_blocked_reason": voting_blocked_reason,
            })

        # Summary
        avg_attendance = round(sum(r["attendance_pct"] for r in rows) / len(rows), 1) if rows else 0.0
        voting_eligible_count = sum(1 for r in rows if r["voting_eligible"])
        below_threshold_count = sum(1 for r in rows if r["voting_blocked_reason"] and "Attendance" in (r["voting_blocked_reason"] or ""))

        return {
            "generated_at": datetime.utcnow().isoformat(),
            "period_months": period_months,
            "meeting_type_filter": meeting_type,
            "total_meetings_in_period": total_meetings,
            "members": rows,
            "summary": {
                "total_members": len(rows),
                "avg_attendance_pct": avg_attendance,
                "voting_eligible_count": voting_eligible_count,
                "voting_blocked_by_attendance": below_threshold_count,
            },
        }

    async def grant_waiver(
        self,
        meeting_id: str,
        user_id: str,
        organization_id: str,
        granted_by: str,
        reason: str,
    ) -> Optional[Dict]:
        """
        Grant a meeting attendance waiver to a member.
        The member won't be able to vote in this meeting, but their
        attendance percentage won't be penalized.
        """
        # Find or create the attendance record
        result = await self.db.execute(
            select(MeetingAttendee).where(
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.user_id == user_id,
            )
        )
        attendee = result.scalar_one_or_none()

        if not attendee:
            # Create a record with waiver
            attendee = MeetingAttendee(
                meeting_id=meeting_id,
                user_id=user_id,
                present=False,
                excused=True,
                waiver_reason=reason,
                waiver_granted_by=granted_by,
                waiver_granted_at=datetime.utcnow(),
            )
            self.db.add(attendee)
        else:
            attendee.excused = True
            attendee.waiver_reason = reason
            attendee.waiver_granted_by = granted_by
            attendee.waiver_granted_at = datetime.utcnow()

        await self.db.commit()

        return {
            "attendee_id": str(attendee.id),
            "meeting_id": meeting_id,
            "user_id": user_id,
            "waiver_reason": reason,
            "waiver_granted_by": granted_by,
            "waiver_granted_at": attendee.waiver_granted_at.isoformat(),
        }

    async def list_waivers(
        self,
        meeting_id: str,
        organization_id: str,
    ) -> List[Dict]:
        """List all waivers for a meeting."""
        result = await self.db.execute(
            select(MeetingAttendee)
            .where(
                MeetingAttendee.meeting_id == meeting_id,
                MeetingAttendee.waiver_reason.isnot(None),
            )
        )
        waivers = list(result.scalars().all())

        # Get user names
        waiver_list = []
        for w in waivers:
            user_result = await self.db.execute(
                select(User).where(User.id == w.user_id)
            )
            user = user_result.scalar_one_or_none()

            grantor_result = await self.db.execute(
                select(User).where(User.id == w.waiver_granted_by)
            ) if w.waiver_granted_by else None
            grantor = grantor_result.scalar_one_or_none() if grantor_result else None

            waiver_list.append({
                "attendee_id": str(w.id),
                "user_id": str(w.user_id),
                "member_name": user.full_name if user else "Unknown",
                "waiver_reason": w.waiver_reason,
                "granted_by": str(w.waiver_granted_by) if w.waiver_granted_by else None,
                "granted_by_name": grantor.full_name if grantor else None,
                "granted_at": w.waiver_granted_at.isoformat() if w.waiver_granted_at else None,
            })

        return waiver_list
