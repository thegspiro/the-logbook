"""
Quorum Service

Manages meeting quorum configuration, calculation, and enforcement.
Quorum rules are set at the organization level and can be overridden per meeting.
"""

from typing import Dict, Optional, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from app.models.minute import MeetingMinutes
from app.models.user import User, Organization


class QuorumService:
    """Service for quorum calculation and enforcement."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_org_quorum_config(self, organization_id: UUID) -> Dict:
        """
        Get the organization's default quorum configuration.

        Stored in organization.settings.quorum_config:
        {
            "enabled": true,
            "type": "percentage",       # "count" or "percentage"
            "threshold": 50.0,          # number of members or percent
            "count_method": "checked_in" # "checked_in" (present at this meeting)
        }
        """
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = result.scalar_one_or_none()
        if not org:
            return {"enabled": False}
        return (org.settings or {}).get("quorum_config", {"enabled": False})

    async def get_active_member_count(self, organization_id: UUID) -> int:
        """Count active members in the organization (denominator for percentage quorum)."""
        result = await self.db.execute(
            select(func.count(User.id))
            .where(User.organization_id == organization_id)
            .where(User.is_active == True)
        )
        return result.scalar() or 0

    async def calculate_quorum(
        self,
        minutes_id: str,
        organization_id: UUID,
    ) -> Tuple[bool, int, int, Optional[str]]:
        """
        Calculate whether quorum is met for a meeting based on attendees.

        Returns: (quorum_met, present_count, required_count, quorum_description)
        """
        result = await self.db.execute(
            select(MeetingMinutes)
            .where(MeetingMinutes.id == minutes_id)
            .where(MeetingMinutes.organization_id == organization_id)
        )
        minutes = result.scalar_one_or_none()
        if not minutes:
            return False, 0, 0, "Meeting not found"

        # Determine quorum config: per-meeting override > org default
        if minutes.quorum_type and minutes.quorum_threshold is not None:
            q_type = minutes.quorum_type
            q_threshold = minutes.quorum_threshold
        else:
            config = await self.get_org_quorum_config(organization_id)
            if not config.get("enabled"):
                return True, 0, 0, "Quorum checking not enabled"
            q_type = config.get("type", "percentage")
            q_threshold = config.get("threshold", 50.0)

        # Count present attendees
        attendees = minutes.attendees or []
        present_count = sum(1 for a in attendees if a.get("present", False))

        # Calculate required count
        if q_type == "count":
            required = int(q_threshold)
            description = f"{required} members required"
        else:  # percentage
            total_active = await self.get_active_member_count(organization_id)
            required = max(1, int((q_threshold / 100.0) * total_active + 0.5))
            description = f"{q_threshold}% of {total_active} active members = {required} required"

        quorum_met = present_count >= required

        # Update the meeting record
        minutes.quorum_met = quorum_met
        minutes.quorum_count = present_count
        await self.db.commit()

        logger.info(
            f"Quorum calculated | meeting={minutes_id} present={present_count} "
            f"required={required} met={quorum_met}"
        )

        return quorum_met, present_count, required, description

    async def update_quorum_on_checkin(
        self,
        minutes_id: str,
        organization_id: UUID,
    ) -> Dict:
        """
        Recalculate quorum after an attendee check-in or removal.
        Returns the quorum status dict suitable for API response.
        """
        met, present, required, description = await self.calculate_quorum(
            minutes_id, organization_id
        )
        return {
            "quorum_met": met,
            "present_count": present,
            "required_count": required,
            "description": description,
        }
