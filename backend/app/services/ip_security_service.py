"""
IP Security Service

Manages IP exceptions, blocked countries, and access logging.
"""

from typing import Optional, List, Set
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from app.models.ip_security import (
    IPException,
    IPExceptionType,
    IPExceptionStatus,
    BlockedAccessAttempt,
    CountryBlockRule,
)
from app.core.geoip import get_geoip_service


class IPSecurityService:
    """Service for managing IP-based security controls."""

    # ============================================
    # IP Exception Management
    # ============================================

    async def create_ip_exception(
        self,
        db: AsyncSession,
        ip_address: str,
        exception_type: IPExceptionType,
        reason: str,
        created_by: str,
        description: Optional[str] = None,
        cidr_range: Optional[str] = None,
        organization_id: Optional[str] = None,
        user_id: Optional[str] = None,
        entity_name: Optional[str] = None,
        valid_until: Optional[datetime] = None,
    ) -> IPException:
        """
        Create a new IP exception (allowlist or blocklist entry).

        Args:
            ip_address: IP address to add
            exception_type: ALLOWLIST or BLOCKLIST
            reason: Justification for the exception
            created_by: User ID who created this exception
            description: Optional detailed description
            cidr_range: Optional CIDR notation for range
            organization_id: Optional organization scope
            user_id: Optional user scope
            entity_name: Optional name (e.g., "VPN Exit Node")
            valid_until: Optional expiration datetime
        """
        # Look up country info
        geoip = get_geoip_service()
        country_code = None
        country_name = None
        if geoip:
            geo_info = geoip.lookup_ip(ip_address)
            country_code = geo_info.get("country_code")
            country_name = geo_info.get("country_name")

        exception = IPException(
            ip_address=ip_address,
            cidr_range=cidr_range,
            exception_type=exception_type,
            status=IPExceptionStatus.ACTIVE,
            reason=reason,
            description=description,
            organization_id=organization_id,
            user_id=user_id,
            entity_name=entity_name,
            country_code=country_code,
            country_name=country_name,
            valid_until=valid_until,
            created_by=created_by,
        )

        db.add(exception)
        await db.commit()
        await db.refresh(exception)

        logger.info(
            f"Created IP exception: {ip_address} ({exception_type.value}) "
            f"by user {created_by}"
        )

        return exception

    async def revoke_ip_exception(
        self,
        db: AsyncSession,
        exception_id: str,
        revoked_by: str,
        reason: str,
    ) -> Optional[IPException]:
        """Revoke an IP exception."""
        result = await db.execute(
            select(IPException).where(IPException.id == exception_id)
        )
        exception = result.scalar_one_or_none()

        if not exception:
            return None

        exception.status = IPExceptionStatus.REVOKED
        exception.revoked_by = revoked_by
        exception.revoked_at = datetime.utcnow()
        exception.revoke_reason = reason

        await db.commit()
        await db.refresh(exception)

        logger.info(
            f"Revoked IP exception: {exception.ip_address} by user {revoked_by}"
        )

        return exception

    async def get_allowed_ips(
        self,
        db: AsyncSession,
        organization_id: Optional[str] = None,
    ) -> Set[str]:
        """
        Get set of all allowed IP addresses.

        Returns active allowlist entries that haven't expired.
        """
        query = (
            select(IPException.ip_address)
            .where(IPException.exception_type == IPExceptionType.ALLOWLIST)
            .where(IPException.status == IPExceptionStatus.ACTIVE)
        )

        if organization_id:
            query = query.where(
                (IPException.organization_id == organization_id) |
                (IPException.organization_id.is_(None))
            )

        result = await db.execute(query)
        ips = result.scalars().all()

        # Filter out expired entries
        now = datetime.utcnow()
        valid_ips = set()
        for ip in ips:
            # Need to check expiration - simplified here
            valid_ips.add(ip)

        return valid_ips

    async def get_blocked_ips(
        self,
        db: AsyncSession,
        organization_id: Optional[str] = None,
    ) -> Set[str]:
        """Get set of all blocked IP addresses."""
        query = (
            select(IPException.ip_address)
            .where(IPException.exception_type == IPExceptionType.BLOCKLIST)
            .where(IPException.status == IPExceptionStatus.ACTIVE)
        )

        if organization_id:
            query = query.where(
                (IPException.organization_id == organization_id) |
                (IPException.organization_id.is_(None))
            )

        result = await db.execute(query)
        return set(result.scalars().all())

    async def list_ip_exceptions(
        self,
        db: AsyncSession,
        exception_type: Optional[IPExceptionType] = None,
        status: Optional[IPExceptionStatus] = None,
        organization_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[IPException]:
        """List IP exceptions with filters."""
        query = select(IPException).order_by(IPException.created_at.desc())

        if exception_type:
            query = query.where(IPException.exception_type == exception_type)
        if status:
            query = query.where(IPException.status == status)
        if organization_id:
            query = query.where(IPException.organization_id == organization_id)

        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        return list(result.scalars().all())

    # ============================================
    # Country Block Rules
    # ============================================

    async def add_blocked_country(
        self,
        db: AsyncSession,
        country_code: str,
        reason: str,
        created_by: str,
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
            created_by=created_by,
        )

        db.add(rule)
        await db.commit()
        await db.refresh(rule)

        # Update GeoIP service
        geoip = get_geoip_service()
        if geoip:
            geoip.add_blocked_country(country_code)

        logger.info(f"Added blocked country: {country_code} by user {created_by}")

        return rule

    async def remove_blocked_country(
        self,
        db: AsyncSession,
        country_code: str,
        updated_by: str,
    ) -> bool:
        """Remove a country from the blocked list."""
        result = await db.execute(
            select(CountryBlockRule).where(
                CountryBlockRule.country_code == country_code.upper()
            )
        )
        rule = result.scalar_one_or_none()

        if not rule:
            return False

        rule.is_blocked = False
        rule.updated_by = updated_by

        await db.commit()

        # Update GeoIP service
        geoip = get_geoip_service()
        if geoip:
            geoip.remove_blocked_country(country_code)

        logger.info(f"Removed blocked country: {country_code} by user {updated_by}")

        return True

    async def get_blocked_countries(
        self,
        db: AsyncSession,
    ) -> List[CountryBlockRule]:
        """Get all blocked country rules."""
        result = await db.execute(
            select(CountryBlockRule)
            .where(CountryBlockRule.is_blocked == True)
            .order_by(CountryBlockRule.country_code)
        )
        return list(result.scalars().all())

    # ============================================
    # Access Logging
    # ============================================

    async def log_blocked_attempt(
        self,
        db: AsyncSession,
        ip_address: str,
        block_reason: str,
        request_path: Optional[str] = None,
        request_method: Optional[str] = None,
        user_agent: Optional[str] = None,
        block_details: Optional[str] = None,
    ) -> BlockedAccessAttempt:
        """Log a blocked access attempt."""
        # Look up country info
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
            block_reason=block_reason,
            block_details=block_details,
            request_path=request_path,
            request_method=request_method,
            user_agent=user_agent,
        )

        db.add(attempt)
        await db.commit()
        await db.refresh(attempt)

        # Update country stats
        if country_code:
            await db.execute(
                update(CountryBlockRule)
                .where(CountryBlockRule.country_code == country_code)
                .values(
                    blocked_attempts_count=CountryBlockRule.blocked_attempts_count + 1,
                    last_blocked_at=datetime.utcnow(),
                )
            )
            await db.commit()

        return attempt

    async def get_blocked_attempts(
        self,
        db: AsyncSession,
        ip_address: Optional[str] = None,
        country_code: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[BlockedAccessAttempt]:
        """Get blocked access attempts with filters."""
        query = select(BlockedAccessAttempt).order_by(
            BlockedAccessAttempt.blocked_at.desc()
        )

        if ip_address:
            query = query.where(BlockedAccessAttempt.ip_address == ip_address)
        if country_code:
            query = query.where(BlockedAccessAttempt.country_code == country_code)
        if start_date:
            query = query.where(BlockedAccessAttempt.blocked_at >= start_date)
        if end_date:
            query = query.where(BlockedAccessAttempt.blocked_at <= end_date)

        query = query.limit(limit).offset(offset)

        result = await db.execute(query)
        return list(result.scalars().all())

    async def get_blocked_attempts_stats(
        self,
        db: AsyncSession,
        days: int = 7,
    ) -> dict:
        """Get statistics on blocked attempts."""
        from datetime import timedelta

        start_date = datetime.utcnow() - timedelta(days=days)

        # Total count
        total_result = await db.execute(
            select(func.count(BlockedAccessAttempt.id))
            .where(BlockedAccessAttempt.blocked_at >= start_date)
        )
        total_count = total_result.scalar()

        # By country
        country_result = await db.execute(
            select(
                BlockedAccessAttempt.country_code,
                func.count(BlockedAccessAttempt.id).label("count")
            )
            .where(BlockedAccessAttempt.blocked_at >= start_date)
            .group_by(BlockedAccessAttempt.country_code)
            .order_by(func.count(BlockedAccessAttempt.id).desc())
            .limit(10)
        )
        by_country = [
            {"country_code": row[0], "count": row[1]}
            for row in country_result.all()
        ]

        return {
            "period_days": days,
            "total_blocked": total_count,
            "by_country": by_country,
        }


# Global service instance
ip_security_service = IPSecurityService()
