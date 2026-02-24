"""
Public Portal Admin API Endpoints

Admin endpoints for configuring and managing the public portal.
Requires authentication and appropriate permissions.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.core.database import get_db
from app.core.public_portal_security import generate_api_key, hash_api_key
from app.models.public_portal import (
    PublicPortalAccessLog,
    PublicPortalAPIKey,
    PublicPortalConfig,
    PublicPortalDataWhitelist,
)
from app.models.user import User
from app.schemas.public_portal import (
    PublicPortalAccessLogResponse,
    PublicPortalAPIKeyCreate,
    PublicPortalAPIKeyCreatedResponse,
    PublicPortalAPIKeyResponse,
    PublicPortalAPIKeyUpdate,
    PublicPortalConfigCreate,
    PublicPortalConfigResponse,
    PublicPortalConfigUpdate,
    PublicPortalDataWhitelistBulkUpdate,
    PublicPortalDataWhitelistCreate,
    PublicPortalDataWhitelistResponse,
    PublicPortalDataWhitelistUpdate,
    PublicPortalUsageStats,
)

router = APIRouter(prefix="/public-portal", tags=["public-portal-admin"])


# ============================================================================
# Configuration Endpoints
# ============================================================================


@router.get("/config", response_model=PublicPortalConfigResponse)
async def get_portal_config(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get public portal configuration for the organization.

    Returns the current configuration or creates a default one if none exists.
    """
    # Get or create config
    result = await db.execute(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(current_user.organization_id)
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        # Create default config
        config = PublicPortalConfig(
            organization_id=str(current_user.organization_id),
            enabled=False,
            allowed_origins=[],
            default_rate_limit=1000,
            cache_ttl_seconds=300,
            settings={},
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)

    return config


@router.post("/config", response_model=PublicPortalConfigResponse)
async def create_portal_config(
    config_data: PublicPortalConfigCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create or update public portal configuration.

    This endpoint enables the public portal and sets its configuration.
    """
    # Check if config already exists
    result = await db.execute(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(current_user.organization_id)
        )
    )
    existing_config = result.scalar_one_or_none()

    if existing_config:
        # Update existing config
        existing_config.enabled = config_data.enabled
        existing_config.allowed_origins = config_data.allowed_origins
        existing_config.default_rate_limit = config_data.default_rate_limit
        existing_config.cache_ttl_seconds = config_data.cache_ttl_seconds
        existing_config.settings = config_data.settings
        existing_config.updated_at = datetime.now(timezone.utc).isoformat()

        await db.commit()
        await db.refresh(existing_config)
        return existing_config

    # Create new config
    config = PublicPortalConfig(
        organization_id=str(current_user.organization_id),
        enabled=config_data.enabled,
        allowed_origins=config_data.allowed_origins,
        default_rate_limit=config_data.default_rate_limit,
        cache_ttl_seconds=config_data.cache_ttl_seconds,
        settings=config_data.settings,
    )

    db.add(config)
    await db.commit()
    await db.refresh(config)

    logger.info(
        f"Public portal config created for organization {current_user.organization_id}"
    )
    return config


@router.patch("/config", response_model=PublicPortalConfigResponse)
async def update_portal_config(
    config_update: PublicPortalConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update public portal configuration.

    Only updates fields that are provided (partial update).
    """
    result = await db.execute(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(current_user.organization_id)
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Public portal not configured. Create it first.",
        )

    # Update only provided fields
    if config_update.enabled is not None:
        config.enabled = config_update.enabled
    if config_update.allowed_origins is not None:
        config.allowed_origins = config_update.allowed_origins
    if config_update.default_rate_limit is not None:
        config.default_rate_limit = config_update.default_rate_limit
    if config_update.cache_ttl_seconds is not None:
        config.cache_ttl_seconds = config_update.cache_ttl_seconds
    if config_update.settings is not None:
        config.settings = config_update.settings

    config.updated_at = datetime.now(timezone.utc).isoformat()

    await db.commit()
    await db.refresh(config)

    logger.info(
        f"Public portal config updated for organization {current_user.organization_id}"
    )
    return config


# ============================================================================
# API Key Management Endpoints
# ============================================================================


@router.get("/api-keys", response_model=List[PublicPortalAPIKeyResponse])
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    include_inactive: bool = Query(False, description="Include revoked keys"),
):
    """
    List all API keys for the organization.

    Does not return the actual API key values (only prefixes).
    """
    query = select(PublicPortalAPIKey).where(
        PublicPortalAPIKey.organization_id == str(current_user.organization_id)
    )

    if not include_inactive:
        query = query.where(PublicPortalAPIKey.is_active == True)  # noqa: E712

    query = query.order_by(desc(PublicPortalAPIKey.created_at))

    result = await db.execute(query)
    api_keys = result.scalars().all()

    return api_keys


@router.post("/api-keys", response_model=PublicPortalAPIKeyCreatedResponse)
async def create_api_key(
    key_data: PublicPortalAPIKeyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new API key for public portal access.

    The full API key is returned only once - save it securely!
    """
    # Get portal config
    result = await db.execute(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(current_user.organization_id)
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Public portal not configured. Configure it first.",
        )

    # Generate API key
    api_key, key_prefix = generate_api_key()
    key_hash = hash_api_key(api_key)

    # Create API key record
    api_key_obj = PublicPortalAPIKey(
        organization_id=str(current_user.organization_id),
        config_id=str(config.id),
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=key_data.name,
        rate_limit_override=key_data.rate_limit_override,
        expires_at=key_data.expires_at.isoformat() if key_data.expires_at else None,
        is_active=True,
        created_by=str(current_user.id),
    )

    db.add(api_key_obj)
    await db.commit()
    await db.refresh(api_key_obj)

    logger.info(
        f"API key created: {key_prefix} for organization {current_user.organization_id}"
    )

    # Return full key (only time it will be shown)
    return PublicPortalAPIKeyCreatedResponse(
        id=api_key_obj.id,
        api_key=api_key,
        key_prefix=key_prefix,
        name=api_key_obj.name,
        rate_limit_override=api_key_obj.rate_limit_override,
        expires_at=(
            datetime.fromisoformat(api_key_obj.expires_at)
            if api_key_obj.expires_at
            else None
        ),
        is_active=api_key_obj.is_active,
        created_at=datetime.fromisoformat(api_key_obj.created_at),
    )


@router.patch("/api-keys/{key_id}", response_model=PublicPortalAPIKeyResponse)
async def update_api_key(
    key_id: str,
    key_update: PublicPortalAPIKeyUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update an API key's settings.

    Can update name, rate limit, expiration, or revoke the key.
    """
    result = await db.execute(
        select(PublicPortalAPIKey).where(
            and_(
                PublicPortalAPIKey.id == key_id,
                PublicPortalAPIKey.organization_id == str(current_user.organization_id),
            )
        )
    )
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API key not found"
        )

    # Update fields
    if key_update.name is not None:
        api_key.name = key_update.name
    if key_update.rate_limit_override is not None:
        api_key.rate_limit_override = key_update.rate_limit_override
    if key_update.expires_at is not None:
        api_key.expires_at = key_update.expires_at.isoformat()
    if key_update.is_active is not None:
        api_key.is_active = key_update.is_active
        if not key_update.is_active:
            logger.info(f"API key revoked: {api_key.key_prefix}")

    await db.commit()
    await db.refresh(api_key)

    return api_key


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke (deactivate) an API key.

    The key is not deleted but marked as inactive.
    """
    result = await db.execute(
        select(PublicPortalAPIKey).where(
            and_(
                PublicPortalAPIKey.id == key_id,
                PublicPortalAPIKey.organization_id == str(current_user.organization_id),
            )
        )
    )
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API key not found"
        )

    api_key.is_active = False
    await db.commit()

    logger.info(f"API key revoked: {api_key.key_prefix}")

    return {"message": "API key revoked successfully", "key_prefix": api_key.key_prefix}


# ============================================================================
# Access Log Endpoints
# ============================================================================


@router.get("/access-logs", response_model=List[PublicPortalAccessLogResponse])
async def get_access_logs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    api_key_id: Optional[str] = Query(None),
    ip_address: Optional[str] = Query(None),
    endpoint: Optional[str] = Query(None),
    status_code: Optional[int] = Query(None),
    flagged_suspicious: Optional[bool] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    Get access logs for the public portal.

    Supports filtering by various criteria.
    """
    query = select(PublicPortalAccessLog).where(
        PublicPortalAccessLog.organization_id == str(current_user.organization_id)
    )

    # Apply filters
    if api_key_id:
        query = query.where(PublicPortalAccessLog.api_key_id == api_key_id)
    if ip_address:
        query = query.where(PublicPortalAccessLog.ip_address == ip_address)
    if endpoint:
        query = query.where(PublicPortalAccessLog.endpoint.contains(endpoint))
    if status_code:
        query = query.where(PublicPortalAccessLog.status_code == status_code)
    if flagged_suspicious is not None:
        query = query.where(
            PublicPortalAccessLog.flagged_suspicious == flagged_suspicious
        )
    if start_date:
        query = query.where(PublicPortalAccessLog.timestamp >= start_date.isoformat())
    if end_date:
        query = query.where(PublicPortalAccessLog.timestamp <= end_date.isoformat())

    # Order by most recent first
    query = query.order_by(desc(PublicPortalAccessLog.timestamp))

    # Pagination
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    logs = result.scalars().all()

    return logs


@router.get("/usage-stats", response_model=PublicPortalUsageStats)
async def get_usage_stats(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """
    Get usage statistics for the public portal.

    Returns aggregated statistics about API usage.
    """
    org_id = str(current_user.organization_id)
    now = datetime.now(timezone.utc)

    # Total requests
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id)).where(
            PublicPortalAccessLog.organization_id == org_id
        )
    )
    total_requests = result.scalar() or 0

    # Requests today
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id)).where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.timestamp >= today_start.isoformat(),
            )
        )
    )
    requests_today = result.scalar() or 0

    # Requests this week
    week_start = today_start - timedelta(days=today_start.weekday())
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id)).where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.timestamp >= week_start.isoformat(),
            )
        )
    )
    requests_this_week = result.scalar() or 0

    # Requests this month
    month_start = today_start.replace(day=1)
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id)).where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.timestamp >= month_start.isoformat(),
            )
        )
    )
    requests_this_month = result.scalar() or 0

    # Unique IPs
    result = await db.execute(
        select(func.count(func.distinct(PublicPortalAccessLog.ip_address))).where(
            PublicPortalAccessLog.organization_id == org_id
        )
    )
    unique_ips = result.scalar() or 0

    # Average response time
    result = await db.execute(
        select(func.avg(PublicPortalAccessLog.response_time_ms)).where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.response_time_ms.isnot(None),
            )
        )
    )
    avg_response_time = result.scalar() or 0.0

    # Top endpoints (last 7 days)
    seven_days_ago = now - timedelta(days=7)
    result = await db.execute(
        select(
            PublicPortalAccessLog.endpoint,
            func.count(PublicPortalAccessLog.id).label("count"),
        )
        .where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.timestamp >= seven_days_ago.isoformat(),
            )
        )
        .group_by(PublicPortalAccessLog.endpoint)
        .order_by(desc("count"))
        .limit(10)
    )
    top_endpoints = [{"endpoint": row[0], "count": row[1]} for row in result.all()]

    # Requests by status code
    result = await db.execute(
        select(
            PublicPortalAccessLog.status_code,
            func.count(PublicPortalAccessLog.id).label("count"),
        )
        .where(PublicPortalAccessLog.organization_id == org_id)
        .group_by(PublicPortalAccessLog.status_code)
    )
    requests_by_status = {row[0]: row[1] for row in result.all()}

    # Flagged requests
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id)).where(
            and_(
                PublicPortalAccessLog.organization_id == org_id,
                PublicPortalAccessLog.flagged_suspicious == True,  # noqa: E712
            )
        )
    )
    flagged_requests = result.scalar() or 0

    return PublicPortalUsageStats(
        total_requests=total_requests,
        requests_today=requests_today,
        requests_this_week=requests_this_week,
        requests_this_month=requests_this_month,
        unique_ips=unique_ips,
        average_response_time_ms=avg_response_time,
        top_endpoints=top_endpoints,
        requests_by_status=requests_by_status,
        flagged_requests=flagged_requests,
    )


# ============================================================================
# Data Whitelist Endpoints
# ============================================================================


@router.get("/whitelist", response_model=List[PublicPortalDataWhitelistResponse])
async def get_data_whitelist(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    category: Optional[str] = Query(None, description="Filter by category"),
):
    """
    Get the data whitelist configuration.

    Shows which data fields are enabled for public access.
    """
    query = select(PublicPortalDataWhitelist).where(
        PublicPortalDataWhitelist.organization_id == str(current_user.organization_id)
    )

    if category:
        query = query.where(PublicPortalDataWhitelist.data_category == category)

    result = await db.execute(query)
    whitelist_entries = result.scalars().all()

    return whitelist_entries


@router.post("/whitelist", response_model=PublicPortalDataWhitelistResponse)
async def create_whitelist_entry(
    entry_data: PublicPortalDataWhitelistCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Add a new field to the data whitelist.

    Controls what data can be exposed through the public API.
    """
    # Get config
    result = await db.execute(
        select(PublicPortalConfig).where(
            PublicPortalConfig.organization_id == str(current_user.organization_id)
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Public portal not configured"
        )

    # Check if entry already exists
    result = await db.execute(
        select(PublicPortalDataWhitelist).where(
            and_(
                PublicPortalDataWhitelist.organization_id
                == str(current_user.organization_id),
                PublicPortalDataWhitelist.data_category == entry_data.data_category,
                PublicPortalDataWhitelist.field_name == entry_data.field_name,
            )
        )
    )
    existing_entry = result.scalar_one_or_none()

    if existing_entry:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Whitelist entry already exists",
        )

    # Create whitelist entry
    whitelist_entry = PublicPortalDataWhitelist(
        organization_id=str(current_user.organization_id),
        config_id=str(config.id),
        data_category=entry_data.data_category,
        field_name=entry_data.field_name,
        is_enabled=entry_data.is_enabled,
    )

    db.add(whitelist_entry)
    await db.commit()
    await db.refresh(whitelist_entry)

    return whitelist_entry


@router.patch(
    "/whitelist/{whitelist_id}", response_model=PublicPortalDataWhitelistResponse
)
async def update_whitelist_entry(
    whitelist_id: str,
    entry_update: PublicPortalDataWhitelistUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a whitelist entry (enable/disable a field).
    """
    result = await db.execute(
        select(PublicPortalDataWhitelist).where(
            and_(
                PublicPortalDataWhitelist.id == whitelist_id,
                PublicPortalDataWhitelist.organization_id
                == str(current_user.organization_id),
            )
        )
    )
    whitelist_entry = result.scalar_one_or_none()

    if not whitelist_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Whitelist entry not found"
        )

    whitelist_entry.is_enabled = entry_update.is_enabled
    whitelist_entry.updated_at = datetime.now(timezone.utc).isoformat()

    await db.commit()
    await db.refresh(whitelist_entry)

    return whitelist_entry


@router.post("/whitelist/bulk-update")
async def bulk_update_whitelist(
    bulk_update: PublicPortalDataWhitelistBulkUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk update whitelist entries.

    Allows enabling/disabling multiple fields at once.
    """
    updated_count = 0

    for update_item in bulk_update.updates:
        category = update_item.get("category")
        field = update_item.get("field")
        enabled = update_item.get("enabled")

        if not all([category, field, enabled is not None]):
            continue

        # Find and update entry
        result = await db.execute(
            select(PublicPortalDataWhitelist).where(
                and_(
                    PublicPortalDataWhitelist.organization_id
                    == str(current_user.organization_id),
                    PublicPortalDataWhitelist.data_category == category,
                    PublicPortalDataWhitelist.field_name == field,
                )
            )
        )
        entry = result.scalar_one_or_none()

        if entry:
            entry.is_enabled = enabled
            entry.updated_at = datetime.now(timezone.utc).isoformat()
            updated_count += 1

    await db.commit()

    return {
        "message": f"Updated {updated_count} whitelist entries",
        "updated_count": updated_count,
    }
