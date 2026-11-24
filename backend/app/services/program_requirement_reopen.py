"""Tell the training officers a correction reopened a completed requirement.

Owner decision 2026-11-23 ("Lowered hours reopen a completed program
requirement"). When a correction — a shift report fixed, a training session
re-finalized, a record voided — takes a member below a program requirement
they had completed, ``TrainingProgramService`` moves the requirement back to
in progress. Nothing else is changed: certificates already issued, the
enrollment's completion and phase advancement stand. An officer decides what
follows, so the officers are told.

Email first (pitfall #18): each training officer who takes training-duty
email gets the ``program_requirement_reopened`` email, unless the department
switched it off, and every training officer gets a bell notice beside it. No
SMS. Sent once per reopening: the caller only calls this on the change from
completed to in progress, and a repeat of the same correction changes nothing.
"""

from __future__ import annotations

from typing import Any, List

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.constants import DEFAULT_TRAINING_OFFICER_ROLES
from app.core.utils import generate_uuid
from app.models.email_template import EmailTemplateType
from app.models.notification import (
    NotificationCategory,
    NotificationChannel,
    NotificationLog,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    recipients_for,
)
from app.services.email_service import EmailService, _redact_email
from app.services.email_template_service import EmailTemplateService

TEMPLATE = EmailTemplateType.PROGRAM_REQUIREMENT_REOPENED


async def _training_officers(db: AsyncSession, organization_id: str) -> List[User]:
    """Current members holding a training-officer role (pitfall #32)."""
    users = (
        (
            await db.execute(
                select(User)
                .where(
                    User.organization_id == organization_id,
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                )
                .options(selectinload(User.roles))
            )
        )
        .scalars()
        .all()
    )
    return [
        user
        for user in users
        if any(
            getattr(role, "slug", None) in DEFAULT_TRAINING_OFFICER_ROLES
            for role in (user.roles or [])
        )
    ]


def _progress_now(progress: Any) -> str:
    value = float(progress.progress_value or 0)
    shown = f"{value:g}" if value != int(value) else str(int(value))
    return f"{shown} ({round(float(progress.progress_percentage or 0))}%)"


async def notify_requirement_reopened(
    db: AsyncSession, progress: Any, enrollment: Any, program: Any, requirement: Any
) -> int:
    """Bell and email the training officers; returns the emails sent.

    Best-effort: the reopening is already committed, and a failed notice must
    not undo it or fail the correction that caused it. Commits the bells.
    """
    organization_id = str(program.organization_id)
    sent = 0
    try:
        organization = (
            await db.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        member = (
            await db.execute(
                select(User).where(
                    User.id == str(enrollment.user_id),
                    User.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        officers = await _training_officers(db, organization_id)
        if organization is None or member is None or not officers:
            return 0

        member_name = member.display_name or member.username or "A member"
        requirement_name = getattr(requirement, "name", None) or "A requirement"
        action_url = f"/training/programs/{program.id}?tab=enrollments"
        for officer in officers:
            db.add(
                NotificationLog(
                    id=generate_uuid(),
                    organization_id=organization_id,
                    recipient_id=str(officer.id),
                    channel=NotificationChannel.IN_APP,
                    category=NotificationCategory.TRAINING,
                    subject=f"Requirement reopened: {member_name} - {program.name}",
                    message=(
                        f"A correction took {member_name} below "
                        f"{requirement_name}, which is back in progress. "
                        "Certificates, the program's completion and phase "
                        "advancement were not changed."
                    ),
                    action_url=action_url,
                    notification_metadata={
                        "enrollment_id": str(enrollment.id),
                        "progress_id": str(progress.id),
                    },
                    delivered=True,
                )
            )
        await db.commit()

        template_svc = EmailTemplateService(db)
        if await template_svc.is_switched_off(organization_id, TEMPLATE):
            return 0
        to_officers = [
            officer
            for officer in recipients_for(
                officers,
                EmailKind.TRAINING_DUTIES,
                department_required_kinds(organization),
            )
            if officer.email
        ]
        email_service = EmailService(organization=organization)
        for officer in to_officers:
            try:
                subject, html_body, text_body = (
                    await template_svc.render_stored_or_default(
                        organization,
                        TEMPLATE,
                        {
                            "recipient_name": officer.preferred_name
                            or officer.first_name
                            or "",
                            "member_name": member_name,
                            "program_name": program.name or "",
                            "requirement_name": requirement_name,
                            "progress_now": _progress_now(progress),
                            "progress_url": f"{settings.FRONTEND_URL}{action_url}",
                        },
                    )
                )
                count, _ = await email_service.send_email(
                    to_emails=[officer.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    db=db,
                    template_type=TEMPLATE.value,
                )
                sent += count
            except Exception as e:
                # One bad address must not stop the others; the bell is queued.
                logger.error(
                    "Requirement reopened email to {} for progress {} failed: {}",
                    _redact_email(officer.email),
                    progress.id,
                    e,
                )
    except Exception as e:
        logger.error(
            "Requirement reopened notice for progress {} failed: {}", progress.id, e
        )
    return sent
