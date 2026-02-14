"""
Membership Tier Service

Handles tier auto-advancement based on years of service and provides
meeting attendance calculation for voting eligibility.
"""

from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any

from loguru import logger
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit_event
from app.models.user import User, UserStatus, Organization
from app.models.meeting import Meeting, MeetingAttendee


class MembershipTierService:
    """Manages membership tier progression and meeting attendance queries."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Meeting attendance
    # ------------------------------------------------------------------

    async def get_meeting_attendance_pct(
        self,
        user_id: str,
        organization_id: str,
        period_months: int = 12,
    ) -> float:
        """
        Calculate a member's meeting attendance percentage over a look-back
        period.  Attendance = (meetings marked present / eligible meetings) * 100.
        Waived meetings are excluded from both numerator and denominator so they
        don't penalise the member's percentage.
        Returns 100.0 if no eligible meetings occurred.
        """
        cutoff = datetime.utcnow() - timedelta(days=period_months * 30)

        org_meetings_subq = select(Meeting.id).where(
            Meeting.organization_id == organization_id,
            Meeting.meeting_date >= cutoff.date(),
        )

        # Total meetings in the organization during the period
        total_result = await self.db.execute(
            select(func.count(Meeting.id)).where(
                Meeting.organization_id == organization_id,
                Meeting.meeting_date >= cutoff.date(),
            )
        )
        total_meetings = total_result.scalar() or 0
        if total_meetings == 0:
            return 100.0  # No meetings held — don't penalise

        # Count waived meetings for this user (excluded from denominator)
        waived_result = await self.db.execute(
            select(func.count(MeetingAttendee.id)).where(
                MeetingAttendee.user_id == user_id,
                MeetingAttendee.waiver_reason.isnot(None),
                MeetingAttendee.meeting_id.in_(org_meetings_subq),
            )
        )
        waived_count = waived_result.scalar() or 0

        eligible_meetings = total_meetings - waived_count
        if eligible_meetings <= 0:
            return 100.0  # All meetings waived — don't penalise

        # Meetings where this user was marked present (non-waived only)
        attended_result = await self.db.execute(
            select(func.count(MeetingAttendee.id)).where(
                MeetingAttendee.user_id == user_id,
                MeetingAttendee.present.is_(True),
                MeetingAttendee.waiver_reason.is_(None),
                MeetingAttendee.meeting_id.in_(org_meetings_subq),
            )
        )
        attended = attended_result.scalar() or 0

        return round((attended / eligible_meetings) * 100, 1)

    # ------------------------------------------------------------------
    # Tier resolution helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_tiers(organization: Organization) -> List[Dict[str, Any]]:
        """Load and sort the tier list from org settings."""
        settings = organization.settings or {}
        tier_config = settings.get("membership_tiers", {})
        tiers = tier_config.get("tiers", [])
        return sorted(tiers, key=lambda t: t.get("sort_order", 0))

    @staticmethod
    def years_of_service(hire_date: Optional[date]) -> int:
        """Calculate years of service from hire_date to today."""
        if not hire_date:
            return 0
        today = date.today()
        return today.year - hire_date.year - (
            (today.month, today.day) < (hire_date.month, hire_date.day)
        )

    def resolve_tier(self, tiers: List[Dict[str, Any]], yos: int) -> Optional[Dict[str, Any]]:
        """Return the highest tier the member qualifies for by years of service."""
        best = None
        for tier in tiers:
            if yos >= tier.get("years_required", 0):
                if best is None or tier.get("sort_order", 0) > best.get("sort_order", 0):
                    best = tier
        return best

    def get_tier_by_id(self, tiers: List[Dict[str, Any]], tier_id: str) -> Optional[Dict[str, Any]]:
        """Look up a tier definition by its id."""
        for tier in tiers:
            if tier.get("id") == tier_id:
                return tier
        return None

    # ------------------------------------------------------------------
    # Batch auto-advance
    # ------------------------------------------------------------------

    async def advance_all(
        self,
        organization_id: str,
        performed_by: str,
    ) -> Dict[str, Any]:
        """
        Scan every active/probationary member and promote them to the
        highest tier they qualify for.  Returns a summary of changes.
        """
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        organization = org_result.scalar_one_or_none()
        if not organization:
            return {"advanced": 0, "members": []}

        tier_config = (organization.settings or {}).get("membership_tiers", {})
        if not tier_config.get("auto_advance", True):
            return {"advanced": 0, "members": [], "message": "Auto-advance is disabled"}

        tiers = self._load_tiers(organization)
        if not tiers:
            return {"advanced": 0, "members": [], "message": "No membership tiers configured"}

        # Load all active / probationary members
        result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status.in_([UserStatus.ACTIVE, UserStatus.PROBATIONARY]),
                User.deleted_at.is_(None),
            )
        )
        members = result.scalars().all()

        advanced = []
        now = datetime.utcnow()

        for member in members:
            yos = self.years_of_service(member.hire_date)
            target_tier = self.resolve_tier(tiers, yos)
            if not target_tier:
                continue

            current_type = member.membership_type or "active"
            if current_type == target_tier["id"]:
                continue

            # Only advance (don't demote)
            current_tier_def = self.get_tier_by_id(tiers, current_type)
            current_order = current_tier_def.get("sort_order", 0) if current_tier_def else 0
            if target_tier.get("sort_order", 0) <= current_order:
                continue

            previous_type = current_type
            member.membership_type = target_tier["id"]
            member.membership_type_changed_at = now

            advanced.append({
                "user_id": str(member.id),
                "name": member.full_name,
                "previous_tier": previous_type,
                "new_tier": target_tier["id"],
                "years_of_service": yos,
            })

        if advanced:
            await self.db.commit()

            # Audit each advancement
            for entry in advanced:
                await log_audit_event(
                    db=self.db,
                    event_type="membership_tier_auto_advanced",
                    event_category="user_management",
                    severity="info",
                    event_data=entry,
                    user_id=performed_by,
                )

        logger.info(f"Membership tier advance: {len(advanced)} members advanced in org {organization_id}")

        return {
            "organization_id": organization_id,
            "advanced": len(advanced),
            "members": advanced,
        }
