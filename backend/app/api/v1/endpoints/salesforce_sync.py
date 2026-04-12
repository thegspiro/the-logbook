"""
Salesforce Sync API Endpoints

Authenticated endpoints for triggering manual syncs, checking sync
status, and managing field mappings between Logbook and Salesforce.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.models.event import Event
from app.models.integration import Integration
from app.models.training import TrainingRecord
from app.models.user import User
from app.services.integration_services.salesforce_sync_service import (
    get_salesforce_sync_service,
)

router = APIRouter()


# ============================================================
# Helpers
# ============================================================


async def _get_sf_integration(db: AsyncSession, organization_id: str) -> Integration:
    """Load the connected Salesforce integration or raise 404."""
    result = await db.execute(
        select(Integration).where(
            Integration.organization_id == organization_id,
            Integration.integration_type == "salesforce",
            Integration.enabled.is_(True),
            Integration.status == "connected",
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )
    return integration


def _user_to_dict(user: User) -> dict[str, Any]:
    """Convert a User model to a plain dict for the sync service."""
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "phone": user.phone,
        "mobile": user.mobile,
        "rank": user.rank,
        "station": user.station,
        "address_street": user.address_street,
        "address_city": user.address_city,
        "address_state": user.address_state,
        "address_zip": user.address_zip,
        "address_country": user.address_country,
        "date_of_birth": user.date_of_birth,
        "membership_number": user.membership_number,
        "membership_type": user.membership_type,
        "status": user.status.value if user.status else "active",
        "hire_date": user.hire_date,
    }


def _training_record_to_dict(rec: TrainingRecord) -> dict[str, Any]:
    """Convert a TrainingRecord to a plain dict for the sync service."""
    return {
        "id": rec.id,
        "user_id": rec.user_id,
        "course_name": rec.course_name,
        "completion_date": rec.completion_date,
        "hours_completed": rec.hours_completed,
        "status": rec.status.value if rec.status else "completed",
        "certification_number": rec.certification_number,
        "expiration_date": rec.expiration_date,
        "training_type": (rec.training_type.value if rec.training_type else ""),
        "instructor": rec.instructor,
    }


def _event_to_dict(event: Event) -> dict[str, Any]:
    """Convert an Event model to a plain dict for the sync service."""
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description,
        "event_type": (event.event_type.value if event.event_type else "other"),
        "location": event.location,
        "start_datetime": event.start_datetime,
        "end_datetime": event.end_datetime,
        "is_mandatory": event.is_mandatory,
    }


# ============================================================
# Endpoints
# ============================================================


@router.get("/status")
async def salesforce_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Get the current Salesforce sync status for this organization."""
    integration = await _get_sf_integration(db, str(current_user.organization_id))
    config = integration.config or {}
    return {
        "connected": True,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "sync_direction": config.get("sync_direction", "push"),
        "sync_types": config.get("sync_types", []),
        "environment": config.get("environment", "production"),
        "field_mappings": config.get("field_mappings", {}),
    }


@router.post("/push/members")
async def push_members_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all active members to Salesforce as Contacts."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(User).where(
            User.organization_id == org_id,
            User.deleted_at.is_(None),
        )
    )
    members = result.scalars().all()
    member_dicts = [_user_to_dict(m) for m in members]
    counts = await sync_service.sync_all_members_to_salesforce(member_dicts)

    # Update last_sync_at
    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.members_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            **counts,
        },
    )

    return {
        "success": True,
        "message": (
            f"Synced {counts['created']} new, "
            f"{counts['updated']} updated, "
            f"{counts['failed']} failed"
        ),
        **counts,
    }


@router.post("/push/training")
async def push_training_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all training records to Salesforce as Tasks."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(TrainingRecord).where(
            TrainingRecord.organization_id == org_id,
        )
    )
    records = result.scalars().all()
    record_dicts = [_training_record_to_dict(r) for r in records]
    counts = await sync_service.sync_all_training_to_salesforce(record_dicts)

    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.training_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            **counts,
        },
    )

    return {
        "success": True,
        "message": (
            f"Synced {counts['created']} new, "
            f"{counts['updated']} updated, "
            f"{counts['failed']} failed"
        ),
        **counts,
    }


@router.post("/push/events")
async def push_events_to_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Push all non-cancelled events to Salesforce."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    result = await db.execute(
        select(Event).where(
            Event.organization_id == org_id,
            Event.is_cancelled.is_(False),
        )
    )
    events = result.scalars().all()

    created = 0
    updated = 0
    failed = 0
    for event in events:
        try:
            sf_id = await sync_service.push_event(_event_to_dict(event))
            if sf_id:
                created += 1
            else:
                failed += 1
        except Exception:
            logger.warning("Failed to push event %s", event.id, exc_info=True)
            failed += 1

    integration = await _get_sf_integration(db, org_id)
    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.events_pushed",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            "created": created,
            "updated": updated,
            "failed": failed,
        },
    )

    return {
        "success": True,
        "message": f"Synced {created + updated} events, {failed} failed",
        "created": created,
        "updated": updated,
        "failed": failed,
    }


@router.post("/pull/contacts")
async def pull_contacts_from_salesforce(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Pull Contacts from Salesforce (incremental since last sync)."""
    org_id = str(current_user.organization_id)
    sync_service = await get_salesforce_sync_service(db, org_id)
    if not sync_service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Salesforce integration is not connected",
        )

    integration = await _get_sf_integration(db, org_id)
    contacts = await sync_service.pull_contacts(since=integration.last_sync_at)

    integration.last_sync_at = datetime.now(timezone.utc)
    await db.commit()

    await log_audit_event(
        db,
        "salesforce.sync.contacts_pulled",
        "integrations",
        "info",
        {
            "user_id": current_user.id,
            "organization_id": org_id,
            "contacts_pulled": len(contacts),
        },
    )

    return {
        "success": True,
        "contacts": contacts,
        "count": len(contacts),
    }
