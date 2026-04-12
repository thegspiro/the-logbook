"""
IP Security API Endpoints

Provides endpoints for:
- IP exception requests (user submits, IT admin approves/rejects/revokes)
- Blocked access attempt logs
- Country block rule management
- Audit trail for IP exceptions
"""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.ip_security import BlockedAccessAttempt, CountryBlockRule, IPException
from app.models.user import User
from app.schemas.ip_security import (
    BlockedAttemptsListResponse,
    CountryBlockRuleCreate,
    CountryBlockRuleResponse,
    IPExceptionApprove,
    IPExceptionAuditLogResponse,
    IPExceptionListResponse,
    IPExceptionReject,
    IPExceptionRequestCreate,
    IPExceptionResponse,
    IPExceptionRevoke,
)
from app.services.ip_security_service import ip_security_service

router = APIRouter()


# =============================================================================
# User: Request IP Exception
# =============================================================================


@router.post("/exceptions", response_model=IPExceptionResponse)
async def request_ip_exception(
    data: IPExceptionRequestCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit an IP exception request.

    Any authenticated user can request an IP exception for themselves.
    The request requires IT administrator approval before it takes effect.
    """
    async with handle_service_errors("Failed to request IP exception"):
        exception = await ip_security_service.request_ip_exception(
            db=db,
            user_id=str(current_user.id),
            organization_id=str(current_user.organization_id),
            ip_address=data.ip_address,
            reason=data.reason,
            requested_duration_days=data.requested_duration_days,
            use_case=data.use_case,
            description=data.description or None,
            requester_ip=request.client.host if request.client else None,
        )

        await log_audit_event(
            db=db,
            event_type="ip_exception_requested",
            event_category="security",
            severity="info",
            event_data={
                "ip_address": data.ip_address,
                "use_case": data.use_case,
                "duration_days": data.requested_duration_days,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return exception


# =============================================================================
# User: Get My Exceptions
# =============================================================================


@router.get("/exceptions/me", response_model=list[IPExceptionResponse])
async def get_my_exceptions(
    include_expired: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the current user's IP exceptions.

    By default returns only active/pending exceptions.
    Set include_expired=true to include expired/rejected/revoked.
    """
    async with handle_service_errors("Failed to get user exceptions"):
        exceptions = await ip_security_service.get_user_exceptions(
            db=db,
            user_id=str(current_user.id),
            include_expired=include_expired,
        )
        return exceptions


# =============================================================================
# IT Admin: Get Pending Requests
# =============================================================================


@router.get("/exceptions/pending", response_model=list[IPExceptionResponse])
async def get_pending_exceptions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Get all pending IP exception requests awaiting approval.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to get pending exceptions"):
        org_id = (
            str(current_user.organization_id) if current_user.organization_id else None
        )
        exceptions = await ip_security_service.get_pending_requests(
            db=db,
            organization_id=org_id,
            limit=limit,
            offset=offset,
        )
        return exceptions


# =============================================================================
# IT Admin: Get All Exceptions (with filters)
# =============================================================================


@router.get("/exceptions", response_model=IPExceptionListResponse)
async def get_all_exceptions(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Get all IP exceptions with optional status filter.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to get exceptions"):
        query = select(IPException).where(
            IPException.organization_id == str(current_user.organization_id)
        )
        count_query = select(func.count(IPException.id)).where(
            IPException.organization_id == str(current_user.organization_id)
        )

        if status:
            query = query.where(IPException.approval_status == status)
            count_query = count_query.where(IPException.approval_status == status)

        query = (
            query.order_by(IPException.created_at.desc()).limit(limit).offset(offset)
        )

        result = await db.execute(query)
        items = list(result.scalars().all())

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        return IPExceptionListResponse(items=items, total=total)


# =============================================================================
# IT Admin: Approve Exception
# =============================================================================


@router.post("/exceptions/{exception_id}/approve", response_model=IPExceptionResponse)
async def approve_exception(
    exception_id: str,
    data: IPExceptionApprove,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Approve a pending IP exception request.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to approve exception"):
        exception = await ip_security_service.approve_exception(
            db=db,
            exception_id=exception_id,
            admin_id=str(current_user.id),
            approved_duration_days=data.approved_duration_days,
            approval_notes=data.approval_notes or None,
            admin_ip=request.client.host if request.client else None,
        )

        await log_audit_event(
            db=db,
            event_type="ip_exception_approved",
            event_category="security",
            severity="warning",
            event_data={
                "exception_id": exception_id,
                "ip_address": exception.ip_address,
                "approved_duration_days": data.approved_duration_days,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return exception


# =============================================================================
# IT Admin: Reject Exception
# =============================================================================


@router.post("/exceptions/{exception_id}/reject", response_model=IPExceptionResponse)
async def reject_exception(
    exception_id: str,
    data: IPExceptionReject,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Reject a pending IP exception request.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to reject exception"):
        exception = await ip_security_service.reject_exception(
            db=db,
            exception_id=exception_id,
            admin_id=str(current_user.id),
            rejection_reason=data.rejection_reason,
            admin_ip=request.client.host if request.client else None,
        )

        await log_audit_event(
            db=db,
            event_type="ip_exception_rejected",
            event_category="security",
            severity="info",
            event_data={
                "exception_id": exception_id,
                "rejection_reason": data.rejection_reason,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return exception


# =============================================================================
# IT Admin: Revoke Exception
# =============================================================================


@router.post("/exceptions/{exception_id}/revoke", response_model=IPExceptionResponse)
async def revoke_exception(
    exception_id: str,
    data: IPExceptionRevoke,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Revoke an active (approved) IP exception.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to revoke exception"):
        exception = await ip_security_service.revoke_exception(
            db=db,
            exception_id=exception_id,
            admin_id=str(current_user.id),
            revoke_reason=data.revoke_reason,
            admin_ip=request.client.host if request.client else None,
        )

        await log_audit_event(
            db=db,
            event_type="ip_exception_revoked",
            event_category="security",
            severity="warning",
            event_data={
                "exception_id": exception_id,
                "revoke_reason": data.revoke_reason,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return exception


# =============================================================================
# IT Admin: Get Exception Audit Log
# =============================================================================


@router.get(
    "/exceptions/{exception_id}/audit-log",
    response_model=list[IPExceptionAuditLogResponse],
)
async def get_exception_audit_log(
    exception_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage", "audit.view")
    ),
):
    """
    Get audit trail for a specific IP exception.

    Requires security.manage, settings.manage, or audit.view permission.
    """
    async with handle_service_errors("Failed to get exception audit log"):
        logs = await ip_security_service.get_exception_audit_log(
            db=db,
            exception_id=exception_id,
        )
        return logs


# =============================================================================
# IT Admin: Blocked Access Attempts
# =============================================================================


@router.get("/blocked-attempts", response_model=BlockedAttemptsListResponse)
async def get_blocked_attempts(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    country_code: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage", "audit.view")
    ),
):
    """
    Get blocked access attempt logs.

    Requires security.manage, settings.manage, or audit.view permission.
    """
    async with handle_service_errors("Failed to get blocked attempts"):
        query = select(BlockedAccessAttempt)
        count_query = select(func.count(BlockedAccessAttempt.id))

        if country_code:
            query = query.where(
                BlockedAccessAttempt.country_code == country_code.upper()
            )
            count_query = count_query.where(
                BlockedAccessAttempt.country_code == country_code.upper()
            )

        query = (
            query.order_by(BlockedAccessAttempt.blocked_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await db.execute(query)
        items = list(result.scalars().all())

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        return BlockedAttemptsListResponse(items=items, total=total)


# =============================================================================
# IT Admin: Country Block Rules
# =============================================================================


@router.get("/blocked-countries", response_model=list[CountryBlockRuleResponse])
async def get_blocked_countries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Get all blocked country rules.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to get blocked countries"):
        countries = await ip_security_service.get_blocked_countries(db=db)
        return countries


@router.post("/blocked-countries", response_model=CountryBlockRuleResponse)
async def add_blocked_country(
    data: CountryBlockRuleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Add a country to the blocked list.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to add blocked country"):
        rule = await ip_security_service.add_blocked_country(
            db=db,
            country_code=data.country_code,
            reason=data.reason,
            admin_id=str(current_user.id),
            country_name=data.country_name or None,
            risk_level=data.risk_level,
        )

        await log_audit_event(
            db=db,
            event_type="country_blocked",
            event_category="security",
            severity="warning",
            event_data={
                "country_code": data.country_code,
                "reason": data.reason,
                "risk_level": data.risk_level,
            },
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return rule


@router.delete("/blocked-countries/{country_code}")
async def remove_blocked_country(
    country_code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("security.manage", "settings.manage")
    ),
):
    """
    Remove a country from the blocked list.

    Requires security.manage or settings.manage permission.
    """
    async with handle_service_errors("Failed to remove blocked country"):
        result = await db.execute(
            select(CountryBlockRule).where(
                CountryBlockRule.country_code == country_code.upper()
            )
        )
        rule = ensure_found(
            result.scalar_one_or_none(),
            "Country block rule",
        )

        rule.is_blocked = False
        rule.updated_by = str(current_user.id)
        await db.commit()

        # Update GeoIP service
        from app.core.geoip import get_geoip_service

        geoip = get_geoip_service()
        if geoip:
            geoip.remove_blocked_country(country_code.upper())

        await log_audit_event(
            db=db,
            event_type="country_unblocked",
            event_category="security",
            severity="warning",
            event_data={"country_code": country_code.upper()},
            user_id=str(current_user.id),
            ip_address=request.client.host if request.client else None,
        )

        return {"message": f"Country {country_code.upper()} unblocked"}
