"""
Struggling Member Detection Service

Scans active training enrollments and identifies members who are falling
behind schedule.  Sends notifications to the member, their training officer,
and optionally the chief when progress is dangerously low.

Designed to be triggered weekly via the scheduled task system.
"""

from datetime import date, datetime, timezone
from typing import Dict, List

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import DEFAULT_TRAINING_OFFICER_ROLES
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    RequirementProgress,
    RequirementProgressStatus,
    TrainingProgram,
)
from app.models.user import User

# Don't re-alert the same struggling member more often than this.
_STRUGGLING_ALERT_COOLDOWN_DAYS = 14


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
            select(ProgramEnrollment).where(
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
                days_until_deadline = (
                    enrollment.target_completion_date - date.today()
                ).days
                progress_pct = enrollment.progress_percentage or 0.0

                if days_until_deadline <= 30 and progress_pct < 75.0:
                    issues.append(
                        {
                            "type": "deadline_approaching",
                            "detail": (
                                f"Deadline in {days_until_deadline} days but only "
                                f"{progress_pct:.0f}% complete"
                            ),
                            "severity": (
                                "critical" if days_until_deadline <= 7 else "warning"
                            ),
                        }
                    )

                # Time-based pace check, measured from the current cycle start so
                # a member fresh off a recert reset isn't flagged behind on day one.
                cycle_start = enrollment.cycle_started_at or enrollment.enrolled_at
                if cycle_start and enrollment.target_completion_date:
                    total_days = (
                        enrollment.target_completion_date - cycle_start.date()
                    ).days
                    elapsed_days = (date.today() - cycle_start.date()).days
                    if total_days > 0 and elapsed_days > 0:
                        time_pct = (elapsed_days / total_days) * 100
                        if time_pct > 50 and progress_pct < 25:
                            issues.append(
                                {
                                    "type": "behind_pace",
                                    "detail": (
                                        f"{time_pct:.0f}% of time elapsed but only "
                                        f"{progress_pct:.0f}% of requirements completed"
                                    ),
                                    "severity": "warning",
                                }
                            )

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
                # MySQL DATETIMEs can come back naive; normalise before
                # comparing with the aware `now` (same guard as the
                # deadline-warning path below).
                if last_update and last_update.tzinfo is None:
                    last_update = last_update.replace(tzinfo=timezone.utc)
                if last_update and (now - last_update).days > 30:
                    issues.append(
                        {
                            "type": "stalled_requirement",
                            "detail": (
                                f"Requirement {progress.requirement_id} has had no "
                                f"progress update in {(now - last_update).days} days"
                            ),
                            "severity": "info",
                        }
                    )

            if issues:
                # Get member name
                user_result = await self.db.execute(
                    select(User).where(User.id == enrollment.user_id)
                )
                user = user_result.scalar_one_or_none()

                # Get program name
                program_result = await self.db.execute(
                    select(TrainingProgram).where(
                        TrainingProgram.id == enrollment.program_id
                    )
                )
                program = program_result.scalar_one_or_none()

                flagged_members.append(
                    {
                        "enrollment": enrollment,
                        "user_id": str(enrollment.user_id),
                        "member_name": user.full_name if user else "Unknown",
                        "enrollment_id": str(enrollment.id),
                        "program_id": str(enrollment.program_id),
                        "program_name": program.name if program else "Unknown",
                        "progress_pct": enrollment.progress_percentage or 0.0,
                        "issues": issues,
                        "max_severity": max(
                            (i["severity"] for i in issues),
                            key=lambda s: {"critical": 3, "warning": 2, "info": 1}.get(
                                s, 0
                            ),
                        ),
                    }
                )

        # Send notifications for critical and warning issues, throttled so a
        # persistently-behind member isn't re-alerted on every weekly run.
        officers = await self._get_training_officers(organization_id)
        notifications_sent = 0
        for member in flagged_members:
            if member["max_severity"] not in ("critical", "warning"):
                continue
            enrollment = member["enrollment"]
            last = enrollment.struggling_alert_sent_at
            if last is not None:
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                if (now - last).days < _STRUGGLING_ALERT_COOLDOWN_DAYS:
                    continue
            await self._send_struggling_notification(organization_id, member, officers)
            enrollment.struggling_alert_sent_at = now
            notifications_sent += 1

        if notifications_sent:
            await self.db.commit()

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
            select(ProgramEnrollment).where(
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
                if (
                    enrollment.deadline_warning_sent
                    and enrollment.deadline_warning_sent_at
                ):
                    last_warn = enrollment.deadline_warning_sent_at
                    if last_warn.tzinfo is None:
                        last_warn = last_warn.replace(tzinfo=timezone.utc)
                    if (datetime.now(timezone.utc) - last_warn).days < 5:
                        continue

                await self._send_deadline_notification(
                    organization_id, enrollment, days_left
                )
                enrollment.deadline_warning_sent = True
                enrollment.deadline_warning_sent_at = datetime.now(timezone.utc)
                warnings_sent += 1

        if warnings_sent > 0:
            await self.db.commit()

        return {"warnings_sent": warnings_sent}

    async def _get_training_officers(self, organization_id: str) -> List[User]:
        """Active users who hold a training-officer role — the people who should
        act on a struggling-member alert."""
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .options(selectinload(User.roles))
        )
        officers = []
        for user in result.scalars().all():
            roles = getattr(user, "roles", None) or []
            if any(
                getattr(r, "slug", None) in DEFAULT_TRAINING_OFFICER_ROLES
                for r in roles
            ):
                officers.append(user)
        return officers

    async def _log(self, organization_id: str, recipient_id: str, log_data: Dict):
        from app.services.notifications_service import NotificationsService

        service = NotificationsService(self.db)
        await service.log_notification(
            organization_id=organization_id,
            log_data={
                "recipient_id": recipient_id,
                "channel": "in_app",
                "category": "training",
                "delivered": True,
                "sent_at": datetime.now(timezone.utc),
                **log_data,
            },
        )

    async def _send_deadline_notification(
        self, organization_id: str, enrollment: ProgramEnrollment, days_left: int
    ):
        """Tell the member their training deadline is approaching."""
        try:
            program_result = await self.db.execute(
                select(TrainingProgram).where(
                    TrainingProgram.id == enrollment.program_id
                )
            )
            program = program_result.scalar_one_or_none()
            program_name = program.name if program else "your training program"
            progress = enrollment.progress_percentage or 0.0
            await self._log(
                organization_id,
                str(enrollment.user_id),
                {
                    "subject": f"Training deadline approaching: {program_name}",
                    "message": (
                        f"Your deadline for {program_name} is in {days_left} days and "
                        f"you're {progress:.0f}% complete. Log any outstanding training "
                        f"so you finish on time."
                    ),
                    "action_url": f"/training/my-progress/{enrollment.id}",
                },
            )
        except Exception as e:
            logger.error(f"Failed to send deadline warning: {e}")

    async def _send_struggling_notification(
        self, organization_id: str, member_data: Dict, officers: List[User]
    ):
        """Alert the member (and their training officers) that they're behind."""
        try:
            issues = ", ".join(i["detail"] for i in member_data["issues"])
            # The member — a direct, actionable nudge.
            await self._log(
                organization_id,
                member_data["user_id"],
                {
                    "subject": f"You're falling behind in {member_data['program_name']}",
                    "message": (
                        f"You're {member_data['progress_pct']:.0f}% through "
                        f"{member_data['program_name']}. {issues}. Reach out to a "
                        f"training officer if you need help catching up."
                    ),
                    "action_url": (
                        f"/training/my-progress/{member_data['enrollment_id']}"
                    ),
                },
            )
            # The training officers — so someone can intervene.
            for officer in officers:
                if str(officer.id) == member_data["user_id"]:
                    continue
                await self._log(
                    organization_id,
                    str(officer.id),
                    {
                        "subject": (
                            f"Training Alert: {member_data['member_name']} "
                            f"falling behind"
                        ),
                        "message": (
                            f"{member_data['member_name']} is at "
                            f"{member_data['progress_pct']:.0f}% in "
                            f"'{member_data['program_name']}'. {issues}."
                        ),
                        "action_url": (
                            f"/training/programs/{member_data['program_id']}/enrollments"
                        ),
                    },
                )
        except Exception as e:
            logger.error(f"Failed to send struggling notification: {e}")
