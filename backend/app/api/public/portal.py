"""
Public Portal API Endpoints

Public read-only API endpoints for external website consumption.
All endpoints require API key authentication and are subject to rate limiting.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from typing import List, Optional
from datetime import datetime, timezone
import time

from app.core.database import get_db
from app.core.public_portal_security import (
    authenticate_api_key,
    validate_ip_rate_limit,
    log_access,
    detect_anomalies
)
from app.models.user import Organization, User
from app.models.event import Event, EventType
from app.models.apparatus import Apparatus
from app.models.public_portal import (
    PublicPortalAPIKey,
    PublicPortalConfig,
    PublicPortalDataWhitelist
)
from app.schemas.public_portal import (
    PublicOrganizationInfo,
    PublicOrganizationStats,
    PublicEvent,
    PublicPersonnelRoster,
    PublicPortalErrorResponse
)

router = APIRouter(prefix="/public/v1", tags=["public-portal"])


# ============================================================================
# Helper Functions
# ============================================================================

async def check_portal_enabled(config: PublicPortalConfig):
    """Check if the public portal is enabled"""
    if not config.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public portal is currently disabled"
        )


async def check_field_whitelisted(
    organization_id: str,
    category: str,
    field: str,
    db: AsyncSession
) -> bool:
    """
    Check if a specific field is whitelisted for public access.

    Args:
        organization_id: Organization ID
        category: Data category
        field: Field name
        db: Database session

    Returns:
        True if field is whitelisted and enabled, False otherwise
    """
    result = await db.execute(
        select(PublicPortalDataWhitelist)
        .where(
            and_(
                PublicPortalDataWhitelist.organization_id == organization_id,
                PublicPortalDataWhitelist.data_category == category,
                PublicPortalDataWhitelist.field_name == field,
                PublicPortalDataWhitelist.is_enabled == True  # noqa: E712
            )
        )
    )
    entry = result.scalar_one_or_none()
    return entry is not None


async def filter_data_by_whitelist(
    organization_id: str,
    category: str,
    data: dict,
    db: AsyncSession
) -> dict:
    """
    Filter data dictionary to only include whitelisted fields.

    Args:
        organization_id: Organization ID
        category: Data category
        data: Dictionary of data
        db: Database session

    Returns:
        Filtered dictionary with only whitelisted fields
    """
    # Get all enabled fields for this category
    result = await db.execute(
        select(PublicPortalDataWhitelist.field_name)
        .where(
            and_(
                PublicPortalDataWhitelist.organization_id == organization_id,
                PublicPortalDataWhitelist.data_category == category,
                PublicPortalDataWhitelist.is_enabled == True  # noqa: E712
            )
        )
    )
    whitelisted_fields = {row[0] for row in result.all()}

    # Filter data to only include whitelisted fields
    filtered_data = {
        key: value
        for key, value in data.items()
        if key in whitelisted_fields
    }

    return filtered_data


# ============================================================================
# Middleware for Logging and Security
# ============================================================================

async def log_public_api_request(
    request: Request,
    api_key: PublicPortalAPIKey,
    status_code: int,
    start_time: float,
    db: AsyncSession
):
    """
    Log a public API request and detect anomalies.

    Args:
        request: The FastAPI request object
        api_key: The authenticated API key
        status_code: HTTP status code
        start_time: Request start time (for calculating response time)
        db: Database session
    """
    response_time_ms = int((time.time() - start_time) * 1000)
    ip_address = request.client.host if request.client else "unknown"

    # Detect anomalies
    is_suspicious, flag_reason = await detect_anomalies(
        ip_address,
        str(api_key.id),
        db
    )

    # Log the access
    await log_access(
        request=request,
        organization_id=str(api_key.organization_id),
        config_id=str(api_key.config_id),
        api_key_id=str(api_key.id),
        status_code=status_code,
        response_time_ms=response_time_ms,
        db=db,
        flagged_suspicious=is_suspicious,
        flag_reason=flag_reason
    )


# ============================================================================
# Public API Endpoints
# ============================================================================

@router.get("/organization/info", response_model=PublicOrganizationInfo)
async def get_organization_info(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db)
):
    """
    Get public organization information.

    Returns basic organization details like name, type, logo, and contact info.
    Only returns fields that are whitelisted for public access.

    Rate limit: 100 requests/hour per API key
    """
    start_time = time.time()

    try:
        # Validate IP rate limit
        await validate_ip_rate_limit(request)

        # Get config and check if enabled
        result = await db.execute(
            select(PublicPortalConfig)
            .where(PublicPortalConfig.organization_id == str(api_key.organization_id))
        )
        config = result.scalar_one_or_none()

        if not config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )

        await check_portal_enabled(config)

        # Get organization
        result = await db.execute(
            select(Organization)
            .where(Organization.id == str(api_key.organization_id))
        )
        org = result.scalar_one_or_none()

        if not org:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )

        # Build full data dictionary
        org_data = {
            "name": org.name,
            "organization_type": org.organization_type.value if org.organization_type else org.type,
            "logo": org.logo,
            "description": org.description,
            "phone": org.phone,
            "email": org.email,
            "website": org.website,
            "mailing_address": {
                "line1": org.mailing_address_line1,
                "line2": org.mailing_address_line2,
                "city": org.mailing_city,
                "state": org.mailing_state,
                "zip_code": org.mailing_zip,
                "country": org.mailing_country
            } if org.mailing_address_line1 else None,
            "physical_address": {
                "line1": org.physical_address_line1,
                "line2": org.physical_address_line2,
                "city": org.physical_city,
                "state": org.physical_state,
                "zip_code": org.physical_zip,
                "country": org.physical_country
            } if org.physical_address_line1 and not org.physical_address_same else None
        }

        # Filter by whitelist
        filtered_data = await filter_data_by_whitelist(
            str(api_key.organization_id),
            "organization",
            org_data,
            db
        )

        # Log successful access
        await log_public_api_request(request, api_key, 200, start_time, db)

        return PublicOrganizationInfo(**filtered_data)

    except HTTPException as e:
        # Log failed access
        await log_public_api_request(request, api_key, e.status_code, start_time, db)
        raise
    except Exception as e:
        # Log error
        await log_public_api_request(request, api_key, 500, start_time, db)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/organization/stats", response_model=PublicOrganizationStats)
async def get_organization_stats(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db)
):
    """
    Get public organization statistics.

    Returns aggregate statistics like volunteer hours, total calls, etc.
    Only returns fields that are whitelisted for public access.

    Rate limit: 100 requests/hour per API key
    """
    start_time = time.time()

    try:
        # Validate IP rate limit
        await validate_ip_rate_limit(request)

        # Get config and check if enabled
        result = await db.execute(
            select(PublicPortalConfig)
            .where(PublicPortalConfig.organization_id == str(api_key.organization_id))
        )
        config = result.scalar_one_or_none()

        if not config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )

        await check_portal_enabled(config)

        # Get organization
        result = await db.execute(
            select(Organization)
            .where(Organization.id == str(api_key.organization_id))
        )
        org = result.scalar_one_or_none()

        if not org:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )

        # Calculate actual statistics from database
        org_id_str = str(api_key.organization_id)

        # Count active members
        members_result = await db.execute(
            select(func.count(User.id))
            .where(User.organization_id == org_id_str)
            .where(User.is_active == True)  # noqa: E712
        )
        total_members = members_result.scalar() or 0

        # Count apparatus
        apparatus_result = await db.execute(
            select(func.count(Apparatus.id))
            .where(Apparatus.organization_id == org_id_str)
        )
        total_apparatus = apparatus_result.scalar() or 0

        stats_data = {
            "total_volunteer_hours": None,
            "total_calls_ytd": None,
            "total_members": total_members,
            "stations": None,
            "apparatus": total_apparatus,
            "founded_year": org.founded_year if hasattr(org, 'founded_year') else None
        }

        # Filter by whitelist
        filtered_data = await filter_data_by_whitelist(
            str(api_key.organization_id),
            "stats",
            stats_data,
            db
        )

        # Log successful access
        await log_public_api_request(request, api_key, 200, start_time, db)

        return PublicOrganizationStats(**filtered_data)

    except HTTPException as e:
        # Log failed access
        await log_public_api_request(request, api_key, e.status_code, start_time, db)
        raise
    except Exception as e:
        # Log error
        await log_public_api_request(request, api_key, 500, start_time, db)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/events/public", response_model=List[PublicEvent])
async def get_public_events(
    request: Request,
    api_key: PublicPortalAPIKey = Depends(authenticate_api_key),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(10, ge=1, le=100, description="Number of events to return"),
    offset: int = Query(0, ge=0, description="Pagination offset")
):
    """
    Get public events (community events, open houses, etc.).

    Returns only events marked as public.
    Only returns fields that are whitelisted for public access.

    Rate limit: 200 requests/hour per API key
    """
    start_time = time.time()

    try:
        # Validate IP rate limit
        await validate_ip_rate_limit(request)

        # Get config and check if enabled
        result = await db.execute(
            select(PublicPortalConfig)
            .where(PublicPortalConfig.organization_id == str(api_key.organization_id))
        )
        config = result.scalar_one_or_none()

        if not config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )

        await check_portal_enabled(config)

        # Query public-facing events (community events, public education)
        org_id_str = str(api_key.organization_id)
        events_query = (
            select(Event)
            .where(Event.organization_id == org_id_str)
            .where(Event.is_cancelled == False)  # noqa: E712
            .where(Event.event_type == EventType.PUBLIC_EDUCATION)
            .where(Event.start_datetime >= datetime.now(timezone.utc))
            .order_by(Event.start_datetime.asc())
            .offset(offset)
            .limit(limit)
        )
        events_result = await db.execute(events_query)
        event_rows = events_result.scalars().all()

        events = []
        for evt in event_rows:
            event_data = {
                "title": evt.title,
                "description": evt.description,
                "start_datetime": evt.start_datetime.isoformat() if evt.start_datetime else None,
                "end_datetime": evt.end_datetime.isoformat() if evt.end_datetime else None,
                "location": evt.location,
                "event_type": evt.event_type.value if evt.event_type else None,
            }
            # Filter by whitelist
            filtered_event = await filter_data_by_whitelist(
                org_id_str, "events", event_data, db
            )
            if filtered_event:
                events.append(filtered_event)

        # Log successful access
        await log_public_api_request(request, api_key, 200, start_time, db)

        return events

    except HTTPException as e:
        # Log failed access
        await log_public_api_request(request, api_key, e.status_code, start_time, db)
        raise
    except Exception as e:
        # Log error
        await log_public_api_request(request, api_key, 500, start_time, db)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


@router.get("/application-status/{token}")
async def get_application_status(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint for prospects to check their application status.

    No authentication required — uses a unique token emailed to the prospect.
    Returns limited public-safe fields only.

    Rate limit: 30 requests/min per IP
    """
    from app.services.membership_pipeline_service import MembershipPipelineService

    await validate_ip_rate_limit(request)

    if not token or len(token) < 10 or len(token) > 64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token format"
        )

    service = MembershipPipelineService(db)
    result = await service.get_prospect_by_token(token)

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found"
        )

    return result


@router.get("/health")
async def health_check():
    """
    Health check endpoint (no authentication required).

    Used to verify the public API is running.
    """
    return {
        "status": "healthy",
        "service": "public-portal-api",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ============================================================================
# Error Handlers
# ============================================================================
# Note: Exception handlers cannot be registered on APIRouter objects.
# The main FastAPI app handles all exceptions automatically.
# Custom error responses are handled within each endpoint as needed.

