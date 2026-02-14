"""
Scheduled Tasks / Cron Configuration

Defines recurring tasks that should be triggered by an external scheduler
(e.g. cron, Celery Beat, APScheduler, or a simple crontab on the host).

Each task is exposed as an async function that can be called from a
management command or API endpoint. The recommended cron schedule is
documented in the SCHEDULE dict below.

Recommended crontab (add to host or container cron):
-----------------------------------------------------
# Daily at 6:00 AM — certification expiration alerts
0 6 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=cert_expiration_alerts

# Weekly on Mondays at 7:00 AM — struggling member detection
0 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=struggling_member_check

# Weekly on Mondays at 7:30 AM — enrollment deadline warnings
30 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=enrollment_deadline_warnings

# Monthly on the 1st at 8:00 AM — membership tier auto-advancement
0 8 1 * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=membership_tier_advance
-----------------------------------------------------
"""

from datetime import datetime
from typing import Dict, Any
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import Organization


# Schedule definitions (for documentation and frontend display)
SCHEDULE = {
    "cert_expiration_alerts": {
        "description": "Send tiered certification expiration alerts (90/60/30/7-day + expired escalation)",
        "frequency": "daily",
        "recommended_time": "06:00",
        "cron": "0 6 * * *",
    },
    "struggling_member_check": {
        "description": "Detect members falling behind on training programs and send notifications",
        "frequency": "weekly",
        "recommended_time": "Monday 07:00",
        "cron": "0 7 * * 1",
    },
    "enrollment_deadline_warnings": {
        "description": "Warn members approaching enrollment completion deadlines",
        "frequency": "weekly",
        "recommended_time": "Monday 07:30",
        "cron": "30 7 * * 1",
    },
    "membership_tier_advance": {
        "description": "Auto-advance members to higher membership tiers based on years of service",
        "frequency": "monthly",
        "recommended_time": "1st of month 08:00",
        "cron": "0 8 1 * *",
    },
}


async def run_cert_expiration_alerts(db: AsyncSession) -> Dict[str, Any]:
    """Run certification expiration alerts for all organizations."""
    from app.services.cert_alert_service import CertAlertService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_sent = 0
    results = []

    for org in organizations:
        try:
            service = CertAlertService(db)
            result = await service.process_alerts(org.id)
            sent = result.get("alerts_sent", 0)
            total_sent += sent
            results.append({"org_id": str(org.id), "alerts_sent": sent})
        except Exception as e:
            logger.error(f"Cert alert failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Cert expiration alerts complete: {total_sent} alerts sent across {len(organizations)} orgs")
    return {"task": "cert_expiration_alerts", "total_alerts_sent": total_sent, "organizations": results}


async def run_struggling_member_check(db: AsyncSession) -> Dict[str, Any]:
    """Detect members falling behind and send notifications."""
    from app.services.struggling_member_service import StrugglingMemberService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_flagged = 0
    results = []

    for org in organizations:
        try:
            service = StrugglingMemberService(db)
            result = await service.detect_and_notify(str(org.id))
            flagged = result.get("members_flagged", 0)
            total_flagged += flagged
            results.append({"org_id": str(org.id), "members_flagged": flagged})
        except Exception as e:
            logger.error(f"Struggling member check failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Struggling member check complete: {total_flagged} members flagged")
    return {"task": "struggling_member_check", "total_flagged": total_flagged, "organizations": results}


async def run_enrollment_deadline_warnings(db: AsyncSession) -> Dict[str, Any]:
    """Send deadline warnings for approaching enrollment deadlines."""
    from app.services.struggling_member_service import StrugglingMemberService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_warned = 0
    results = []

    for org in organizations:
        try:
            service = StrugglingMemberService(db)
            result = await service.send_deadline_warnings(str(org.id))
            warned = result.get("warnings_sent", 0)
            total_warned += warned
            results.append({"org_id": str(org.id), "warnings_sent": warned})
        except Exception as e:
            logger.error(f"Enrollment deadline warnings failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    return {"task": "enrollment_deadline_warnings", "total_warned": total_warned, "organizations": results}


async def run_membership_tier_advance(db: AsyncSession) -> Dict[str, Any]:
    """Auto-advance all eligible members to higher tiers."""
    from app.services.membership_tier_service import MembershipTierService

    orgs = await db.execute(select(Organization))
    organizations = list(orgs.scalars().all())

    total_advanced = 0
    results = []

    for org in organizations:
        try:
            service = MembershipTierService(db)
            result = await service.advance_all(
                organization_id=str(org.id),
                performed_by="system",
            )
            advanced = result.get("advanced", 0)
            total_advanced += advanced
            results.append({"org_id": str(org.id), "advanced": advanced})
        except Exception as e:
            logger.error(f"Tier advance failed for org {org.id}: {e}")
            results.append({"org_id": str(org.id), "error": str(e)})

    logger.info(f"Membership tier advance complete: {total_advanced} members advanced")
    return {"task": "membership_tier_advance", "total_advanced": total_advanced, "organizations": results}


# Task runner map
TASK_RUNNERS = {
    "cert_expiration_alerts": run_cert_expiration_alerts,
    "struggling_member_check": run_struggling_member_check,
    "enrollment_deadline_warnings": run_enrollment_deadline_warnings,
    "membership_tier_advance": run_membership_tier_advance,
}
