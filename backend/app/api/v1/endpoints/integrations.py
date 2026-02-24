"""
Integrations API Endpoints

Endpoints for managing external integration configurations.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.models.integration import Integration
from app.models.user import User

router = APIRouter()

# Default integration catalog - seeded for new orgs
INTEGRATION_CATALOG = [
    {
        "integration_type": "google-calendar",
        "name": "Google Calendar",
        "description": "Sync department events with Google Calendar for easy access on any device.",
        "category": "Calendar",
        "status": "available",
    },
    {
        "integration_type": "outlook",
        "name": "Microsoft Outlook",
        "description": "Connect with Outlook for calendar and email integration.",
        "category": "Calendar",
        "status": "available",
    },
    {
        "integration_type": "slack",
        "name": "Slack",
        "description": "Send automated notifications to Slack channels for real-time updates.",
        "category": "Messaging",
        "status": "available",
    },
    {
        "integration_type": "discord",
        "name": "Discord",
        "description": "Post updates to Discord servers for volunteer department communication.",
        "category": "Messaging",
        "status": "coming_soon",
    },
    {
        "integration_type": "csv-import",
        "name": "CSV Import/Export",
        "description": "Import and export data in CSV format for reporting and migration.",
        "category": "Data",
        "status": "available",
    },
    {
        "integration_type": "ical",
        "name": "iCalendar (ICS)",
        "description": "Subscribe to department events via standard iCal feed.",
        "category": "Calendar",
        "status": "coming_soon",
    },
]


async def ensure_catalog(db: AsyncSession, organization_id: str) -> None:
    """Ensure all catalog integrations exist for this org."""
    result = await db.execute(
        select(Integration).where(Integration.organization_id == organization_id)
    )
    existing = {row.integration_type for row in result.scalars().all()}

    for item in INTEGRATION_CATALOG:
        if item["integration_type"] not in existing:
            db.add(
                Integration(
                    organization_id=organization_id,
                    **item,
                    config={},
                    enabled=False,
                )
            )
    await db.commit()


@router.get("")
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all integrations for the organization"""
    await ensure_catalog(db, current_user.organization_id)
    result = await db.execute(
        select(Integration)
        .where(Integration.organization_id == str(current_user.organization_id))
        .order_by(Integration.name)
    )
    integrations = result.scalars().all()
    return [
        {
            "id": i.id,
            "organization_id": i.organization_id,
            "integration_type": i.integration_type,
            "name": i.name,
            "description": i.description,
            "category": i.category,
            "status": i.status,
            "config": i.config or {},
            "enabled": i.enabled,
            "last_sync_at": i.last_sync_at.isoformat() if i.last_sync_at else None,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
        }
        for i in integrations
    ]


@router.get("/{integration_id}")
async def get_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    return {
        "id": integration.id,
        "organization_id": integration.organization_id,
        "integration_type": integration.integration_type,
        "name": integration.name,
        "description": integration.description,
        "category": integration.category,
        "status": integration.status,
        "config": integration.config or {},
        "enabled": integration.enabled,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "created_at": (
            integration.created_at.isoformat() if integration.created_at else None
        ),
        "updated_at": (
            integration.updated_at.isoformat() if integration.updated_at else None
        ),
    }


@router.post("/{integration_id}/connect")
async def connect_integration(
    integration_id: str,
    config: dict = {},
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Connect/enable an integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )
    if integration.status == "coming_soon":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This integration is not yet available",
        )

    integration.status = "connected"
    integration.enabled = True
    integration.config = {**(integration.config or {}), **config}
    await db.commit()
    await db.refresh(integration)
    return {
        "id": integration.id,
        "organization_id": integration.organization_id,
        "integration_type": integration.integration_type,
        "name": integration.name,
        "description": integration.description,
        "category": integration.category,
        "status": integration.status,
        "config": integration.config or {},
        "enabled": integration.enabled,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "created_at": (
            integration.created_at.isoformat() if integration.created_at else None
        ),
        "updated_at": (
            integration.updated_at.isoformat() if integration.updated_at else None
        ),
    }


@router.post("/{integration_id}/disconnect")
async def disconnect_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Disconnect an integration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    integration.status = "available"
    integration.enabled = False
    await db.commit()
    return {"status": "disconnected"}


@router.patch("/{integration_id}")
async def update_integration(
    integration_id: str,
    config: dict = {},
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.manage")),
):
    """Update integration configuration"""
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.organization_id == str(current_user.organization_id),
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
        )

    integration.config = {**(integration.config or {}), **config}
    await db.commit()
    await db.refresh(integration)
    return {
        "id": integration.id,
        "organization_id": integration.organization_id,
        "integration_type": integration.integration_type,
        "name": integration.name,
        "description": integration.description,
        "category": integration.category,
        "status": integration.status,
        "config": integration.config or {},
        "enabled": integration.enabled,
        "last_sync_at": (
            integration.last_sync_at.isoformat() if integration.last_sync_at else None
        ),
        "created_at": (
            integration.created_at.isoformat() if integration.created_at else None
        ),
        "updated_at": (
            integration.updated_at.isoformat() if integration.updated_at else None
        ),
    }
