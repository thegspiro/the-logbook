"""
Public Portal Security Utilities

Security middleware and utilities for the public portal API including
API key authentication, rate limiting, and access logging.
"""

from fastapi import Request, HTTPException, status, Depends
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from typing import Optional, Tuple
from datetime import datetime, timedelta
from collections import defaultdict
import bcrypt
import hashlib
from loguru import logger

from app.core.database import get_db
from app.models.public_portal import (
    PublicPortalAPIKey,
    PublicPortalConfig,
    PublicPortalAccessLog
)

# API Key header scheme
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# In-memory rate limit tracking (for quick checks before DB)
# Structure: {api_key_id: {hour_timestamp: request_count}}
rate_limit_cache = defaultdict(lambda: defaultdict(int))

# In-memory IP tracking (for secondary limits)
# Structure: {ip_address: {minute_timestamp: request_count}}
ip_rate_limit_cache = defaultdict(lambda: defaultdict(int))


def hash_api_key(api_key: str) -> str:
    """
    Hash an API key using bcrypt.

    Args:
        api_key: The plaintext API key

    Returns:
        The bcrypt hash of the API key
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(api_key.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_api_key(api_key: str, key_hash: str) -> bool:
    """
    Verify an API key against its hash.

    Args:
        api_key: The plaintext API key to verify
        key_hash: The stored bcrypt hash

    Returns:
        True if the key matches, False otherwise
    """
    try:
        return bcrypt.checkpw(api_key.encode('utf-8'), key_hash.encode('utf-8'))
    except Exception as e:
        logger.error(f"Error verifying API key: {e}")
        return False


def generate_api_key() -> Tuple[str, str]:
    """
    Generate a new API key and its prefix.

    Returns:
        Tuple of (full_api_key, key_prefix)
    """
    # Generate a secure random key (32 bytes = 64 hex chars)
    import secrets
    api_key = f"logbook_{secrets.token_urlsafe(32)}"
    key_prefix = api_key[:8]
    return api_key, key_prefix


async def get_current_hour_timestamp() -> int:
    """Get the current hour as a Unix timestamp (for rate limiting)."""
    now = datetime.utcnow()
    hour_start = now.replace(minute=0, second=0, microsecond=0)
    return int(hour_start.timestamp())


async def get_current_minute_timestamp() -> int:
    """Get the current minute as a Unix timestamp (for IP rate limiting)."""
    now = datetime.utcnow()
    minute_start = now.replace(second=0, microsecond=0)
    return int(minute_start.timestamp())


async def check_rate_limit(
    api_key_id: str,
    rate_limit: int,
    db: AsyncSession
) -> Tuple[bool, int, int]:
    """
    Check if an API key has exceeded its rate limit.

    Args:
        api_key_id: The API key ID
        rate_limit: The rate limit (requests per hour)
        db: Database session

    Returns:
        Tuple of (is_allowed, current_count, limit)
    """
    hour_timestamp = await get_current_hour_timestamp()

    # Quick check in memory cache
    current_count = rate_limit_cache[api_key_id][hour_timestamp]

    # If close to limit, verify with database
    if current_count >= rate_limit * 0.9:  # 90% of limit
        # Count requests in the current hour from database
        one_hour_ago = datetime.utcnow() - timedelta(hours=1)
        result = await db.execute(
            select(func.count(PublicPortalAccessLog.id))
            .where(
                and_(
                    PublicPortalAccessLog.api_key_id == api_key_id,
                    PublicPortalAccessLog.timestamp >= one_hour_ago.isoformat()
                )
            )
        )
        db_count = result.scalar() or 0

        # Update cache with accurate count
        rate_limit_cache[api_key_id][hour_timestamp] = db_count
        current_count = db_count

    # Check if limit exceeded
    is_allowed = current_count < rate_limit

    if is_allowed:
        # Increment counter
        rate_limit_cache[api_key_id][hour_timestamp] += 1

    return is_allowed, current_count, rate_limit


async def check_ip_rate_limit(
    ip_address: str,
    limit: int = 100
) -> Tuple[bool, int, int]:
    """
    Check if an IP address has exceeded its rate limit.

    Args:
        ip_address: The IP address
        limit: The rate limit (requests per minute, default 100)

    Returns:
        Tuple of (is_allowed, current_count, limit)
    """
    minute_timestamp = await get_current_minute_timestamp()

    # Check memory cache
    current_count = ip_rate_limit_cache[ip_address][minute_timestamp]

    # Check if limit exceeded
    is_allowed = current_count < limit

    if is_allowed:
        # Increment counter
        ip_rate_limit_cache[ip_address][minute_timestamp] += 1

    return is_allowed, current_count, limit


async def log_access(
    request: Request,
    organization_id: str,
    config_id: str,
    api_key_id: Optional[str],
    status_code: int,
    response_time_ms: Optional[int],
    db: AsyncSession,
    flagged_suspicious: bool = False,
    flag_reason: Optional[str] = None
):
    """
    Log an access attempt to the public portal.

    Args:
        request: The FastAPI request object
        organization_id: Organization ID
        config_id: Config ID
        api_key_id: API key ID (None if invalid/missing)
        status_code: HTTP status code
        response_time_ms: Response time in milliseconds
        db: Database session
        flagged_suspicious: Whether to flag as suspicious
        flag_reason: Reason for flagging
    """
    # Extract request details
    ip_address = request.client.host if request.client else "unknown"
    endpoint = str(request.url.path)
    method = request.method
    user_agent = request.headers.get("user-agent")
    referer = request.headers.get("referer")

    # Create access log entry
    access_log = PublicPortalAccessLog(
        organization_id=organization_id,
        config_id=config_id,
        api_key_id=api_key_id,
        ip_address=ip_address,
        endpoint=endpoint,
        method=method,
        status_code=status_code,
        response_time_ms=response_time_ms,
        user_agent=user_agent,
        referer=referer,
        flagged_suspicious=flagged_suspicious,
        flag_reason=flag_reason
    )

    db.add(access_log)
    await db.commit()

    # Log to application logs if flagged
    if flagged_suspicious:
        logger.warning(
            f"Suspicious activity detected - IP: {ip_address}, "
            f"Endpoint: {endpoint}, Reason: {flag_reason}"
        )


async def detect_anomalies(
    ip_address: str,
    api_key_id: Optional[str],
    db: AsyncSession
) -> Tuple[bool, Optional[str]]:
    """
    Detect anomalous behavior patterns.

    Args:
        ip_address: The IP address
        api_key_id: The API key ID (if authenticated)
        db: Database session

    Returns:
        Tuple of (is_suspicious, reason)
    """
    # Check for rapid requests from same IP (last minute)
    one_minute_ago = datetime.utcnow() - timedelta(minutes=1)
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id))
        .where(
            and_(
                PublicPortalAccessLog.ip_address == ip_address,
                PublicPortalAccessLog.timestamp >= one_minute_ago.isoformat()
            )
        )
    )
    requests_last_minute = result.scalar() or 0

    if requests_last_minute > 60:  # More than 1 request per second
        return True, f"Rapid requests: {requests_last_minute} in last minute"

    # Check for failed authentication attempts (last 5 minutes)
    five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
    result = await db.execute(
        select(func.count(PublicPortalAccessLog.id))
        .where(
            and_(
                PublicPortalAccessLog.ip_address == ip_address,
                PublicPortalAccessLog.status_code == 401,
                PublicPortalAccessLog.timestamp >= five_minutes_ago.isoformat()
            )
        )
    )
    failed_auth_attempts = result.scalar() or 0

    if failed_auth_attempts > 5:
        return True, f"Multiple failed auth attempts: {failed_auth_attempts}"

    # Check for suspicious patterns: accessing many different endpoints rapidly
    result = await db.execute(
        select(func.count(func.distinct(PublicPortalAccessLog.endpoint)))
        .where(
            and_(
                PublicPortalAccessLog.ip_address == ip_address,
                PublicPortalAccessLog.timestamp >= one_minute_ago.isoformat()
            )
        )
    )
    unique_endpoints = result.scalar() or 0

    if unique_endpoints > 10:
        return True, f"Scanning behavior: {unique_endpoints} different endpoints"

    return False, None


async def authenticate_api_key(
    api_key: Optional[str] = Depends(api_key_header),
    db: AsyncSession = Depends(get_db)
) -> PublicPortalAPIKey:
    """
    Authenticate an API key for public portal access.

    This is a FastAPI dependency that validates the API key,
    checks rate limits, and logs access attempts.

    Args:
        api_key: The API key from the X-API-Key header
        db: Database session

    Returns:
        The validated PublicPortalAPIKey object

    Raises:
        HTTPException: If authentication fails
    """
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required. Include X-API-Key header."
        )

    # Extract key prefix for lookup
    key_prefix = api_key[:8] if len(api_key) >= 8 else api_key

    # Find API key by prefix (fast lookup)
    result = await db.execute(
        select(PublicPortalAPIKey)
        .where(PublicPortalAPIKey.key_prefix == key_prefix)
    )
    api_key_obj = result.scalar_one_or_none()

    if not api_key_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )

    # Verify the full key hash
    if not verify_api_key(api_key, api_key_obj.key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key"
        )

    # Check if key is active
    if not api_key_obj.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has been revoked"
        )

    # Check if key is expired
    if api_key_obj.is_expired:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key has expired"
        )

    # Check rate limit
    rate_limit = api_key_obj.effective_rate_limit
    is_allowed, current_count, limit = await check_rate_limit(
        str(api_key_obj.id),
        rate_limit,
        db
    )

    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. {current_count}/{limit} requests used this hour.",
            headers={
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(await get_current_hour_timestamp() + 3600)
            }
        )

    # Update last used timestamp
    api_key_obj.last_used_at = datetime.utcnow().isoformat()
    await db.commit()

    return api_key_obj


async def validate_ip_rate_limit(request: Request):
    """
    Validate IP-based rate limiting (secondary protection).

    This is a separate layer of protection independent of API keys.

    Args:
        request: The FastAPI request object

    Raises:
        HTTPException: If IP rate limit is exceeded
    """
    ip_address = request.client.host if request.client else "unknown"

    is_allowed, current_count, limit = await check_ip_rate_limit(ip_address)

    if not is_allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"IP rate limit exceeded. Max {limit} requests per minute.",
            headers={
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0"
            }
        )


def cleanup_rate_limit_cache():
    """
    Clean up old entries from the rate limit cache.

    Should be called periodically (e.g., every hour) to prevent
    memory bloat.
    """
    current_hour = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    current_hour_ts = int(current_hour.timestamp())
    current_minute = datetime.utcnow().replace(second=0, microsecond=0)
    current_minute_ts = int(current_minute.timestamp())

    # Clean up hourly cache (keep current and last hour)
    for api_key_id in list(rate_limit_cache.keys()):
        timestamps = list(rate_limit_cache[api_key_id].keys())
        for ts in timestamps:
            if ts < current_hour_ts - 3600:  # Older than 1 hour
                del rate_limit_cache[api_key_id][ts]

        # Remove empty entries
        if not rate_limit_cache[api_key_id]:
            del rate_limit_cache[api_key_id]

    # Clean up minute cache (keep current and last minute)
    for ip_address in list(ip_rate_limit_cache.keys()):
        timestamps = list(ip_rate_limit_cache[ip_address].keys())
        for ts in timestamps:
            if ts < current_minute_ts - 120:  # Older than 2 minutes
                del ip_rate_limit_cache[ip_address][ts]

        # Remove empty entries
        if not ip_rate_limit_cache[ip_address]:
            del ip_rate_limit_cache[ip_address]
