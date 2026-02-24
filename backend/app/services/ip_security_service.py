"""
IP Security Service

Manages IP exceptions with IT administrator approval workflow.

Zero-Trust Model:
- Users request IP exceptions for themselves
- IT administrators review and approve/reject requests
- All exceptions have mandatory time limits
- All actions are logged for audit
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geoip import get_geoip_service
from app.models.ip_security import (
    BlockedAccessAttempt,
    CountryBlockRule,
    IPException,
    IPExceptionApprovalStatus,
    IPExceptionAuditLog,
    IPExceptionType,
)

# Maximum allowed exception duration (in days)
MAX_EXCEPTION_DURATION_DAYS = 90


class IPSecurityService:
    """
    Service for managing IP-based security controls with approval workflow.

    All IP exceptions require:
    1. User-specific association
    2. IT administrator approval
    3. Defined time period (no permanent exceptions)
    """

    # ============================================
    # User: Request IP Exception
    # ============================================

    async def request_ip_exception(
        self,
        db: AsyncSession,
        user_id: str,
        organization_id: str,
        ip_address: str,
        reason: str,
        requested_duration_days: int,
        use_case: str,
        description: Optional[str] = None,
        requester_ip: Optional[str] = None,
    ) -> IPException:
        """
        Submit a request for an IP exception (user action).

        The request will be pending until approved by an IT administrator.

        Args:
            user_id: ID of the user this exception is for
            organization_id: Organization ID
            ip_address: IP address to allow
            reason: Justification for the exception (required)
            requested_duration_days: How many days access is needed
            use_case: Type of use case (travel, remote_work, vpn, etc.)
            description: Additional details
            requester_ip: IP address of the requester (for audit)

        Returns:
            Created IPException with PENDING status

        Raises:
            ValueError: If validation fails
        """
        # Validate duration
        if requested_duration_days <= 0:
            raise ValueError("Duration must be at least 1 day")
        if requested_duration_days > MAX_EXCEPTION_DURATION_DAYS:
            raise ValueError(
                f"Duration cannot exceed {MAX_EXCEPTION_DURATION_DAYS} days"
            )

        # Check for existing active/pending exception for same IP and user
        existing = await db.execute(
            select(IPException)
            .where(IPException.user_id == str(user_id))
            .where(IPException.ip_address == ip_address)
            .where(
                IPException.approval_status.in_(
                    [
                        IPExceptionApprovalStatus.PENDING,
                        IPExceptionApprovalStatus.APPROVED,
                    ]
                )
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(
                "An active or pending exception already exists for this IP"
            )

        # Look up country info
        geoip = get_geoip_service()
        country_code = None
        country_name = None
        if geoip:
            geo_info = geoip.lookup_ip(ip_address)
            country_code = geo_info.get("country_code")
            country_name = geo_info.get("country_name")

        # Calculate tentative valid_until (will be confirmed on approval)
        tentative_valid_until = datetime.now(timezone.utc) + timedelta(
            days=requested_duration_days
        )

        # Create the exception request
        exception = IPException(
            ip_address=ip_address,
            exception_type=IPExceptionType.ALLOWLIST,
            reason=reason,
            description=description,
            user_id=user_id,
            organization_id=organization_id,
            requested_duration_days=requested_duration_days,
            valid_until=tentative_valid_until,  # Will be updated on approval
            approval_status=IPExceptionApprovalStatus.PENDING,
            requested_by=user_id,
            country_code=country_code,
            country_name=country_name,
            use_case=use_case,
        )

        db.add(exception)
        await db.commit()
        await db.refresh(exception)

        # Log the request
        await self._log_audit_action(
            db=db,
            exception_id=exception.id,
            action="requested",
            performed_by=user_id,
            ip_address=requester_ip,
            details={
                "ip_address": ip_address,
                "requested_duration_days": requested_duration_days,
                "use_case": use_case,
                "country_code": country_code,
            },
        )

        logger.info(
            f"IP exception requested: {ip_address} for user {user_id}, "
            f"duration: {requested_duration_days} days, use_case: {use_case}"
        )

        return exception

    # ============================================
    # IT Admin: Approve Exception
    # ============================================

    async def approve_exception(
        self,
        db: AsyncSession,
        exception_id: str,
        admin_id: str,
        approved_duration_days: Optional[int] = None,
        approval_notes: Optional[str] = None,
        admin_ip: Optional[str] = None,
    ) -> IPException:
        """
        Approve an IP exception request (IT administrator action).

        Args:
            exception_id: ID of the exception to approve
            admin_id: ID of the IT administrator approving
            approved_duration_days: Actual approved duration (defaults to requested)
            approval_notes: Optional notes from the administrator
            admin_ip: IP address of the admin (for audit)

        Returns:
            Updated IPException with APPROVED status

        Raises:
            ValueError: If exception not found or not pending
        """
        # Get the exception
        result = await db.execute(
            select(IPException).where(IPException.id == exception_id)
        )
        exception = result.scalar_one_or_none()

        if not exception:
            raise ValueError("Exception not found")

        if exception.approval_status != IPExceptionApprovalStatus.PENDING:
            raise ValueError(
                f"Exception is not pending (status: {exception.approval_status})"
            )

        # Determine approved duration
        duration = approved_duration_days or exception.requested_duration_days
        if duration > MAX_EXCEPTION_DURATION_DAYS:
            duration = MAX_EXCEPTION_DURATION_DAYS

        # Set validity period
        now = datetime.now(timezone.utc)
        valid_until = now + timedelta(days=duration)

        # Update exception
        exception.approval_status = IPExceptionApprovalStatus.APPROVED
        exception.approved_by = admin_id
        exception.approved_at = now
        exception.approval_notes = approval_notes
        exception.approved_duration_days = duration
        exception.valid_from = now
        exception.valid_until = valid_until

        await db.commit()
        await db.refresh(exception)

        # Log the approval
        await self._log_audit_action(
            db=db,
            exception_id=exception.id,
            action="approved",
            performed_by=admin_id,
            ip_address=admin_ip,
            details={
                "approved_duration_days": duration,
                "valid_from": now.isoformat(),
                "valid_until": valid_until.isoformat(),
                "approval_notes": approval_notes,
            },
        )

        logger.info(
            f"IP exception approved: {exception.ip_address} for user {exception.user_id}, "
            f"approved by {admin_id}, duration: {duration} days"
        )

        return exception

    # ============================================
    # IT Admin: Reject Exception
    # ============================================

    async def reject_exception(
        self,
        db: AsyncSession,
        exception_id: str,
        admin_id: str,
        rejection_reason: str,
        admin_ip: Optional[str] = None,
    ) -> IPException:
        """
        Reject an IP exception request (IT administrator action).

        Args:
            exception_id: ID of the exception to reject
            admin_id: ID of the IT administrator rejecting
            rejection_reason: Required reason for rejection
            admin_ip: IP address of the admin (for audit)

        Returns:
            Updated IPException with REJECTED status

        Raises:
            ValueError: If exception not found or not pending
        """
        if not rejection_reason:
            raise ValueError("Rejection reason is required")

        # Get the exception
        result = await db.execute(
            select(IPException).where(IPException.id == exception_id)
        )
        exception = result.scalar_one_or_none()

        if not exception:
            raise ValueError("Exception not found")

        if exception.approval_status != IPExceptionApprovalStatus.PENDING:
            raise ValueError(
                f"Exception is not pending (status: {exception.approval_status})"
            )

        # Update exception
        exception.approval_status = IPExceptionApprovalStatus.REJECTED
        exception.rejected_by = admin_id
        exception.rejected_at = datetime.now(timezone.utc)
        exception.rejection_reason = rejection_reason

        await db.commit()
        await db.refresh(exception)

        # Log the rejection
        await self._log_audit_action(
            db=db,
            exception_id=exception.id,
            action="rejected",
            performed_by=admin_id,
            ip_address=admin_ip,
            details={
                "rejection_reason": rejection_reason,
            },
        )

        logger.info(
            f"IP exception rejected: {exception.ip_address} for user {exception.user_id}, "
            f"rejected by {admin_id}, reason: {rejection_reason}"
        )

        return exception

    # ============================================
    # IT Admin: Revoke Exception
    # ============================================

    async def revoke_exception(
        self,
        db: AsyncSession,
        exception_id: str,
        admin_id: str,
        revoke_reason: str,
        admin_ip: Optional[str] = None,
    ) -> IPException:
        """
        Revoke an approved IP exception (IT administrator action).

        Use this to end an exception before its scheduled expiration.

        Args:
            exception_id: ID of the exception to revoke
            admin_id: ID of the IT administrator revoking
            revoke_reason: Required reason for revocation
            admin_ip: IP address of the admin (for audit)

        Returns:
            Updated IPException with REVOKED status
        """
        if not revoke_reason:
            raise ValueError("Revoke reason is required")

        # Get the exception
        result = await db.execute(
            select(IPException).where(IPException.id == exception_id)
        )
        exception = result.scalar_one_or_none()

        if not exception:
            raise ValueError("Exception not found")

        if exception.approval_status != IPExceptionApprovalStatus.APPROVED:
            raise ValueError(
                f"Can only revoke approved exceptions (status: {exception.approval_status})"
            )

        # Update exception
        exception.approval_status = IPExceptionApprovalStatus.REVOKED
        exception.revoked_by = admin_id
        exception.revoked_at = datetime.now(timezone.utc)
        exception.revoke_reason = revoke_reason

        await db.commit()
        await db.refresh(exception)

        # Log the revocation
        await self._log_audit_action(
            db=db,
            exception_id=exception.id,
            action="revoked",
            performed_by=admin_id,
            ip_address=admin_ip,
            details={
                "revoke_reason": revoke_reason,
                "days_remaining": exception.days_remaining(),
            },
        )

        logger.info(
            f"IP exception revoked: {exception.ip_address} for user {exception.user_id}, "
            f"revoked by {admin_id}, reason: {revoke_reason}"
        )

        return exception

    # ============================================
    # Query: Get Pending Requests (for IT Admin)
    # ============================================

    async def get_pending_requests(
        self,
        db: AsyncSession,
        organization_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[IPException]:
        """
        Get all pending IP exception requests for IT admin review.
        """
        query = (
            select(IPException)
            .where(IPException.approval_status == IPExceptionApprovalStatus.PENDING)
            .order_by(IPException.requested_at.asc())  # Oldest first
        )

        if organization_id:
            query = query.where(IPException.organization_id == str(organization_id))

        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        return list(result.scalars().all())

    # ============================================
    # Query: Get User's Exceptions
    # ============================================

    async def get_user_exceptions(
        self,
        db: AsyncSession,
        user_id: str,
        include_expired: bool = False,
        limit: int = 50,
    ) -> List[IPException]:
        """
        Get all IP exceptions for a specific user.
        """
        query = select(IPException).where(IPException.user_id == str(user_id))

        if not include_expired:
            query = query.where(
                IPException.approval_status.in_(
                    [
                        IPExceptionApprovalStatus.PENDING,
                        IPExceptionApprovalStatus.APPROVED,
                    ]
                )
            )

        query = query.order_by(IPException.created_at.desc()).limit(limit)

        result = await db.execute(query)
        return list(result.scalars().all())

    # ============================================
    # Query: Get Active Allowed IPs for User
    # ============================================

    async def get_active_allowed_ips_for_user(
        self,
        db: AsyncSession,
        user_id: str,
    ) -> Set[str]:
        """
        Get all currently active (approved and not expired) allowed IPs for a user.
        """
        now = datetime.now(timezone.utc)

        result = await db.execute(
            select(IPException.ip_address)
            .where(IPException.user_id == str(user_id))
            .where(IPException.exception_type == IPExceptionType.ALLOWLIST)
            .where(IPException.approval_status == IPExceptionApprovalStatus.APPROVED)
            .where(IPException.valid_from <= now)
            .where(IPException.valid_until > now)
        )

        return set(result.scalars().all())

    # ============================================
    # Query: Get All Active Allowed IPs
    # ============================================

    async def get_all_active_allowed_ips(
        self,
        db: AsyncSession,
        organization_id: Optional[str] = None,
    ) -> Set[str]:
        """
        Get all currently active allowed IPs across all users.

        Used by IP blocking middleware to check allowlist.
        """
        now = datetime.now(timezone.utc)

        query = (
            select(IPException.ip_address)
            .where(IPException.exception_type == IPExceptionType.ALLOWLIST)
            .where(IPException.approval_status == IPExceptionApprovalStatus.APPROVED)
            .where(IPException.valid_from <= now)
            .where(IPException.valid_until > now)
        )

        if organization_id:
            query = query.where(IPException.organization_id == str(organization_id))

        result = await db.execute(query)
        return set(result.scalars().all())

    # ============================================
    # Maintenance: Expire Old Exceptions
    # ============================================

    async def expire_old_exceptions(self, db: AsyncSession) -> int:
        """
        Mark expired exceptions as EXPIRED.

        Should be run periodically (e.g., daily cron job).

        Returns:
            Number of exceptions expired
        """
        now = datetime.now(timezone.utc)

        # Find approved exceptions past their valid_until
        result = await db.execute(
            select(IPException)
            .where(IPException.approval_status == IPExceptionApprovalStatus.APPROVED)
            .where(IPException.valid_until < now)
        )
        exceptions = result.scalars().all()

        count = 0
        for exception in exceptions:
            exception.approval_status = IPExceptionApprovalStatus.EXPIRED
            count += 1

            # Log expiration
            await self._log_audit_action(
                db=db,
                exception_id=exception.id,
                action="expired",
                performed_by="system",
                details={"valid_until": exception.valid_until.isoformat()},
            )

        await db.commit()

        if count > 0:
            logger.info(f"Expired {count} IP exceptions")

        return count

    # ============================================
    # Audit Logging
    # ============================================

    async def _log_audit_action(
        self,
        db: AsyncSession,
        exception_id: str,
        action: str,
        performed_by: str,
        ip_address: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> IPExceptionAuditLog:
        """Log an action on an IP exception."""
        audit_log = IPExceptionAuditLog(
            exception_id=exception_id,
            action=action,
            performed_by=performed_by,
            ip_address=ip_address,
            details=json.dumps(details) if details else None,
        )

        db.add(audit_log)
        await db.commit()
        await db.refresh(audit_log)

        return audit_log

    async def get_exception_audit_log(
        self,
        db: AsyncSession,
        exception_id: str,
    ) -> List[IPExceptionAuditLog]:
        """Get audit log for a specific exception."""
        result = await db.execute(
            select(IPExceptionAuditLog)
            .where(IPExceptionAuditLog.exception_id == exception_id)
            .order_by(IPExceptionAuditLog.performed_at.asc())
        )
        return list(result.scalars().all())

    # ============================================
    # Blocked Access Logging
    # ============================================

    async def log_blocked_attempt(
        self,
        db: AsyncSession,
        ip_address: str,
        block_reason: str,
        user_id: Optional[str] = None,
        request_path: Optional[str] = None,
        request_method: Optional[str] = None,
        user_agent: Optional[str] = None,
        block_details: Optional[str] = None,
    ) -> BlockedAccessAttempt:
        """Log a blocked access attempt."""
        geoip = get_geoip_service()
        country_code = None
        country_name = None
        if geoip:
            geo_info = geoip.lookup_ip(ip_address)
            country_code = geo_info.get("country_code")
            country_name = geo_info.get("country_name")

        attempt = BlockedAccessAttempt(
            ip_address=ip_address,
            country_code=country_code,
            country_name=country_name,
            user_id=user_id,
            block_reason=block_reason,
            block_details=block_details,
            request_path=request_path,
            request_method=request_method,
            user_agent=user_agent,
        )

        db.add(attempt)
        await db.commit()
        await db.refresh(attempt)

        return attempt

    # ============================================
    # Country Block Rules
    # ============================================

    async def get_blocked_countries(self, db: AsyncSession) -> List[CountryBlockRule]:
        """Get all blocked country rules."""
        result = await db.execute(
            select(CountryBlockRule)
            .where(CountryBlockRule.is_blocked == True)  # noqa: E712
            .order_by(CountryBlockRule.country_code)
        )
        return list(result.scalars().all())

    async def add_blocked_country(
        self,
        db: AsyncSession,
        country_code: str,
        reason: str,
        admin_id: str,
        country_name: Optional[str] = None,
        risk_level: str = "high",
    ) -> CountryBlockRule:
        """Add a country to the blocked list."""
        rule = CountryBlockRule(
            country_code=country_code.upper(),
            country_name=country_name,
            is_blocked=True,
            reason=reason,
            risk_level=risk_level,
            created_by=admin_id,
        )

        db.add(rule)
        await db.commit()
        await db.refresh(rule)

        # Update GeoIP service
        geoip = get_geoip_service()
        if geoip:
            geoip.add_blocked_country(country_code)

        logger.info(f"Added blocked country: {country_code} by admin {admin_id}")

        return rule


# Global service instance
ip_security_service = IPSecurityService()
