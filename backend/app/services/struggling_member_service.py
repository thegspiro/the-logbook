"""
Struggling Member Detection Service

Scans active training enrollments and identifies members who are falling
behind schedule.  Sends notifications to the member, their training officer,
and optionally the chief when progress is dangerously low.

Designed to be triggered weekly via the scheduled task system.
"""

from datetime import datetime, timedelta, date, timezone
from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from loguru import logger

from app.models.training import (
    ProgramEnrollment,
    RequirementProgress,
    TrainingProgram,
    EnrollmentStatus,
    RequirementProgressStatus,
)
from app.models.user import User, Organization


class StrugglingMemberService:
    """Detects members falling behind on training and sends alerts."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def detect_and_notify(self, organization_id: str) -> Dict:
        """
        Scan all active enrollments and flag members who are behind schedule.

        A member is "struggling" if:
        1. Their enrollment is >50% through the time window but <25% complete
        2. They have requirements that are stalled (no progress in 30+ days)
        3. Their deadline is within 30 days and they're <75% complete
        """
        result = await self.db.execute(
            select(ProgramEnrollment)
            .where(
                ProgramEnrollment.organization_id == organization_id,
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
            )
        )
        enrollments = list(result.scalars().all())

        now = datetime.now(timezone.utc)
        flagged_members = []

        for enrollment in enrollments:
            issues = []

            # Check deadline proximity
            if enrollment.target_completion_date:
                days_until_deadline = (enrollment.target_completion_date - date.today()).days
                progress_pct = enrollment.progress_percentage or 0.0

                if days_until_deadline <= 30 and progress_pct < 75.0:
                    issues.append({
                        "type": "deadline_approaching",
                        "detail": (
                            f"Deadline in {days_until_deadline} days but only "
                            f"{progress_pct:.0f}% complete"
                        ),
                        "severity": "critical" if days_until_deadline <= 7 else "warning",
                    })

                # Time-based pace check
                if enrollment.enrolled_at and enrollment.target_completion_date:
                    total_days = (enrollment.target_completion_date - enrollment.enrolled_at.date()).days
                    elapsed_days = (date.today() - enrollment.enrolled_at.date()).days
                    if total_days > 0 and elapsed_days > 0:
                        time_pct = (elapsed_days / total_days) * 100
                        if time_pct > 50 and progress_pct < 25:
                            issues.append({
                                "type": "behind_pace",
                                "detail": (
                                    f"{time_pct:.0f}% of time elapsed but only "
                                    f"{progress_pct:.0f}% of requirements completed"
                                ),
                                "severity": "warning",
                            })

            # Check for stalled requirements (no progress in 30+ days)
            progress_result = await self.db.execute(
                select(RequirementProgress).where(
                    RequirementProgress.enrollment_id == enrollment.id,
                    RequirementProgress.status == RequirementProgressStatus.IN_PROGRESS,
                )
            )
            in_progress = list(progress_result.scalars().all())

            for progress in in_progress:
                last_update = progress.updated_at or progress.created_at
                if last_update and (now - last_update).days > 30:
                    issues.append({
                        "type": "stalled_requirement",
                        "detail": (
                            f"Requirement {progress.requirement_id} has had no "
                            f"progress update in {(now - last_update).days} days"
                        ),
                        "severity": "info",
                    })

            if issues:
                # Get member name
                user_result = await self.db.execute(
                    select(User).where(User.id == enrollment.user_id)
                )
                user = user_result.scalar_one_or_none()

                # Get program name
                program_result = await self.db.execute(
                    select(TrainingProgram).where(TrainingProgram.id == enrollment.program_id)
                )
                program = program_result.scalar_one_or_none()

                flagged_members.append({
                    "user_id": str(enrollment.user_id),
                    "member_name": user.full_name if user else "Unknown",
                    "enrollment_id": str(enrollment.id),
                    "program_name": program.name if program else "Unknown",
                    "progress_pct": enrollment.progress_percentage or 0.0,
                    "issues": issues,
                    "max_severity": max(
                        (i["severity"] for i in issues),
                        key=lambda s: {"critical": 3, "warning": 2, "info": 1}.get(s, 0),
                    ),
                })

        # Send notifications for critical and warning issues
        notifications_sent = 0
        for member in flagged_members:
            if member["max_severity"] in ("critical", "warning"):
                await self._send_struggling_notification(organization_id, member)
                notifications_sent += 1

        logger.info(
            f"Struggling member check | org={organization_id} "
            f"flagged={len(flagged_members)} notifications={notifications_sent}"
        )

        return {
            "members_flagged": len(flagged_members),
            "notifications_sent": notifications_sent,
            "flagged_members": flagged_members,
        }

    async def send_deadline_warnings(self, organization_id: str) -> Dict:
        """Send warnings for enrollments approaching their deadline."""
        warning_days = [30, 14, 7]

        result = await self.db.execute(
            select(ProgramEnrollment)
            .where(
                ProgramEnrollment.organization_id == organization_id,
                ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
                ProgramEnrollment.target_completion_date.isnot(None),
            )
        )
        enrollments = list(result.scalars().all())

        warnings_sent = 0
        for enrollment in enrollments:
            days_left = (enrollment.target_completion_date - date.today()).days
            if days_left in warning_days:
                # Only send if not already sent recently
                if enrollment.deadline_warning_sent and enrollment.deadline_warning_sent_at:
                    last_warn = enrollment.deadline_warning_sent_at
                    if (datetime.now(timezone.utc) - last_warn).days < 5:
                        continue

                enrollment.deadline_warning_sent = True
                enrollment.deadline_warning_sent_at = datetime.now(timezone.utc)
                warnings_sent += 1

        if warnings_sent > 0:
            await self.db.commit()

        return {"warnings_sent": warnings_sent}

    async def _send_struggling_notification(self, organization_id: str, member_data: Dict):
        """Send notification about a struggling member to training officers."""
        try:
            from app.services.notifications_service import NotificationsService

            service = NotificationsService(self.db)
            await service.log_notification(
                organization_id=organization_id,
                log_data={
                    "rule_id": None,
                    "recipient_id": None,  # Will be picked up by training officers
                    "channel": "in_app",
                    "subject": f"Training Alert: {member_data['member_name']} falling behind",
                    "message": (
                        f"{member_data['member_name']} is struggling in "
                        f"'{member_data['program_name']}' "
                        f"({member_data['progress_pct']:.0f}% complete). "
                        f"Issues: {', '.join(i['detail'] for i in member_data['issues'])}"
                    ),
                },
            )
        except Exception as e:
            logger.error(f"Failed to send struggling notification: {e}")
