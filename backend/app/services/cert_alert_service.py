"""
Certification Expiration Alert Service

Implements tiered notification pipeline for expiring certifications:
- 90 days out: notify member
- 60 days out: notify member
- 30 days out: notify member + CC training officer
- 7 days out: notify member + CC training officer + compliance officer
- Expired (no renewal logged): escalation to training chief

Designed to be triggered by a periodic cron job / scheduled task.
"""

from datetime import datetime, timedelta, date
from typing import List, Dict, Optional, Tuple
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from loguru import logger

from app.models.training import TrainingRecord, TrainingStatus
from app.models.user import User, UserStatus, Organization
from app.core.constants import (
    DEFAULT_TRAINING_OFFICER_ROLES,
    DEFAULT_COMPLIANCE_OFFICER_ROLES,
    ROLE_CHIEF,
)
from app.services.email_service import EmailService


# Alert tiers: (days_before, field_name, cc_officers)
ALERT_TIERS = [
    (90, "alert_90_sent_at", False),
    (60, "alert_60_sent_at", False),
    (30, "alert_30_sent_at", True),    # CC training officer
    (7,  "alert_7_sent_at",  True),    # CC training + compliance
]


class CertAlertService:
    """Service for managing certification expiration alerts."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_alert_config(self, organization_id: UUID) -> Dict:
        """
        Get the organization's cert alert configuration.

        Stored in organization.settings.cert_alert_config:
        {
            "enabled": true,
            "training_officer_roles": ["training_officer", "assistant_training_officer"],
            "compliance_officer_roles": ["compliance_officer"],
            "cc_chief_on_escalation": true
        }
        """
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = result.scalar_one_or_none()
        if not org:
            return {"enabled": False}
        return (org.settings or {}).get("cert_alert_config", {"enabled": False})

    async def get_expiring_certifications(
        self,
        organization_id: UUID,
        within_days: int = 90,
    ) -> List[TrainingRecord]:
        """Find all training records with certifications expiring within N days."""
        cutoff = date.today() + timedelta(days=within_days)
        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.expiration_date.isnot(None))
            .where(TrainingRecord.expiration_date <= cutoff)
            .where(TrainingRecord.expiration_date >= date.today())
        )
        return list(result.scalars().all())

    async def get_expired_certifications(
        self,
        organization_id: UUID,
    ) -> List[TrainingRecord]:
        """Find all expired certifications that haven't been escalated yet."""
        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.expiration_date.isnot(None))
            .where(TrainingRecord.expiration_date < date.today())
            .where(TrainingRecord.escalation_sent_at.is_(None))
        )
        return list(result.scalars().all())

    async def _get_officer_emails(
        self, organization_id: UUID, role_slugs: List[str]
    ) -> List[str]:
        """Get email addresses for users with specific roles."""
        from sqlalchemy.orm import selectinload
        result = await self.db.execute(
            select(User)
            .where(User.organization_id == organization_id)
            .where(User.status == UserStatus.ACTIVE)
            .where(User.deleted_at.is_(None))
            .options(selectinload(User.roles))
        )
        users = result.scalars().all()
        return [
            u.email for u in users
            if any(r.slug in role_slugs for r in u.roles)
        ]

    async def process_alerts(
        self, organization_id: UUID
    ) -> Dict[str, int]:
        """
        Process all certification expiration alerts for an organization.

        Should be called periodically (e.g., daily cron job).

        Returns: {"alerts_sent": N, "escalations_sent": N, "errors": N}
        """
        config = await self.get_alert_config(organization_id)
        if not config.get("enabled"):
            return {"alerts_sent": 0, "escalations_sent": 0, "errors": 0}

        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        if not org:
            return {"alerts_sent": 0, "escalations_sent": 0, "errors": 0}

        email_service = EmailService(org)
        training_roles = config.get("training_officer_roles", DEFAULT_TRAINING_OFFICER_ROLES)
        compliance_roles = config.get("compliance_officer_roles", DEFAULT_COMPLIANCE_OFFICER_ROLES)

        alerts_sent = 0
        escalations_sent = 0
        errors = 0

        # Process tiered alerts for expiring certifications
        expiring = await self.get_expiring_certifications(organization_id)
        today = date.today()

        for record in expiring:
            days_until = (record.expiration_date - today).days

            for tier_days, field_name, cc_officers in ALERT_TIERS:
                if days_until > tier_days:
                    continue

                # Skip if already sent for this tier
                if getattr(record, field_name) is not None:
                    continue

                # Get the member
                member_result = await self.db.execute(
                    select(User).where(User.id == record.user_id)
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    continue

                # Build CC list
                cc_emails = []
                if cc_officers:
                    cc_emails.extend(await self._get_officer_emails(organization_id, training_roles))
                    if tier_days <= 7:
                        cc_emails.extend(await self._get_officer_emails(organization_id, compliance_roles))

                try:
                    subject = f"Certification Expiring in {days_until} Days: {record.course_name}"
                    html_body = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: {'#dc2626' if days_until <= 7 else '#f59e0b'}; color: white; padding: 20px; text-align: center;">
        <h2>Certification Expiration {'Warning' if days_until <= 30 else 'Notice'}</h2>
    </div>
    <div style="padding: 20px; background-color: #f9fafb;">
        <p>Hello {member.first_name},</p>
        <p>Your <strong>{record.course_name}</strong> certification expires on
        <strong>{record.expiration_date.strftime('%B %d, %Y')}</strong>
        ({days_until} day{'s' if days_until != 1 else ''} from today).</p>
        {f'<p><strong>Certification #:</strong> {record.certification_number}</p>' if record.certification_number else ''}
        {f'<p><strong>Issuing Agency:</strong> {record.issuing_agency}</p>' if record.issuing_agency else ''}
        <p>Please renew your certification before it expires. Contact your training officer if you need assistance.</p>
    </div>
</div>"""
                    text_body = (
                        f"Certification Expiration Notice\n\n"
                        f"Hello {member.first_name},\n\n"
                        f"Your {record.course_name} certification expires on "
                        f"{record.expiration_date.strftime('%B %d, %Y')} ({days_until} days).\n\n"
                        f"Please renew before it expires."
                    )

                    success, _ = await email_service.send_email(
                        to_emails=[member.email],
                        subject=subject,
                        html_body=html_body,
                        text_body=text_body,
                        cc_emails=cc_emails if cc_emails else None,
                    )

                    if success > 0:
                        setattr(record, field_name, datetime.utcnow())
                        alerts_sent += 1
                    else:
                        errors += 1

                except Exception as e:
                    logger.error(f"Failed to send cert alert: {e}")
                    errors += 1

                # Only send the most urgent applicable tier per run
                break

        # Process escalations for already-expired certifications
        expired = await self.get_expired_certifications(organization_id)
        for record in expired:
            member_result = await self.db.execute(
                select(User).where(User.id == record.user_id)
            )
            member = member_result.scalar_one_or_none()
            if not member:
                continue

            cc_emails = await self._get_officer_emails(organization_id, training_roles)
            cc_emails.extend(await self._get_officer_emails(organization_id, compliance_roles))
            if config.get("cc_chief_on_escalation"):
                cc_emails.extend(await self._get_officer_emails(organization_id, [ROLE_CHIEF]))

            try:
                days_expired = (today - record.expiration_date).days
                subject = f"EXPIRED Certification: {record.course_name} - {member.full_name}"
                html_body = f"""
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background-color: #7f1d1d; color: white; padding: 20px; text-align: center;">
        <h2>Certification EXPIRED</h2>
    </div>
    <div style="padding: 20px; background-color: #fef2f2;">
        <p><strong>{member.full_name}</strong>'s <strong>{record.course_name}</strong> certification
        expired on <strong>{record.expiration_date.strftime('%B %d, %Y')}</strong>
        ({days_expired} day{'s' if days_expired != 1 else ''} ago).</p>
        {f'<p><strong>Certification #:</strong> {record.certification_number}</p>' if record.certification_number else ''}
        <p>No renewal has been logged. This member may need to be taken out of service for activities requiring this certification.</p>
    </div>
</div>"""
                text_body = (
                    f"EXPIRED Certification: {record.course_name}\n\n"
                    f"{member.full_name}'s certification expired on "
                    f"{record.expiration_date.strftime('%B %d, %Y')} ({days_expired} days ago).\n\n"
                    f"No renewal has been logged."
                )

                success, _ = await email_service.send_email(
                    to_emails=[member.email],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    cc_emails=cc_emails if cc_emails else None,
                )

                if success > 0:
                    record.escalation_sent_at = datetime.utcnow()
                    escalations_sent += 1
                else:
                    errors += 1

            except Exception as e:
                logger.error(f"Failed to send cert escalation: {e}")
                errors += 1

        await self.db.commit()

        logger.info(
            f"Cert alerts processed | org={organization_id} "
            f"alerts={alerts_sent} escalations={escalations_sent} errors={errors}"
        )
        return {
            "alerts_sent": alerts_sent,
            "escalations_sent": escalations_sent,
            "errors": errors,
        }
