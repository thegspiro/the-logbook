"""
Core Utilities

Shared helper functions used across the application.
"""

import re
import secrets
import string
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional, TypeVar

from fastapi import HTTPException, status
from loguru import logger

# Patterns that suggest internal implementation details leaking
_UNSAFE_PATTERNS = [
    re.compile(r"Traceback \(most recent call last\)", re.IGNORECASE),
    re.compile(r"File \"[^\"]+\",\s*line \d+"),  # Python tracebacks
    re.compile(r"/[a-z_/]+\.py", re.IGNORECASE),  # File paths
    re.compile(r"sqlalchemy\.", re.IGNORECASE),
    re.compile(r"psycopg|mysql|pymysql|aiomysql", re.IGNORECASE),
    re.compile(r"\bSELECT\b.*\bFROM\b", re.IGNORECASE),
    re.compile(r"\bINSERT\b.*\bINTO\b", re.IGNORECASE),
    re.compile(r"\bUPDATE\b.*\bSET\b", re.IGNORECASE),
    re.compile(r"\bDELETE\b.*\bFROM\b", re.IGNORECASE),
    re.compile(r"0x[0-9a-f]{8,}", re.IGNORECASE),  # Memory addresses
]

_GENERIC_ERROR = "An unexpected error occurred. Please try again."


def safe_error_detail(
    exc: Exception,
    fallback: str = _GENERIC_ERROR,
) -> str:
    """Return a user-safe error detail string.

    For ValueError / PermissionError (service-layer validation), the original
    message is returned unless it contains patterns that suggest internal
    implementation details (SQL, file paths, tracebacks, etc.).

    For all other exception types the *fallback* message is returned so that
    raw Python internals are never exposed to the client.

    The full exception is always logged at ERROR level for debugging.
    """
    msg = str(exc)

    # Always log the real error for ops debugging
    logger.error("Exception in request handler: %s: %s", type(exc).__name__, msg)

    # Trusted validation exceptions — pass through if safe
    if isinstance(exc, (ValueError, PermissionError)):
        for pattern in _UNSAFE_PATTERNS:
            if pattern.search(msg):
                return fallback
        # Cap length to prevent verbose messages
        if len(msg) > 300:
            return fallback
        return msg

    # Everything else: generic message
    return fallback


def sanitize_error_message(
    msg: str,
    fallback: str = _GENERIC_ERROR,
) -> str:
    """Return a user-safe version of an error message string.

    Used for service-layer error strings (not exceptions) that may
    contain raw database/ORM details when an unexpected failure occurs.
    """
    if not msg:
        return fallback
    for pattern in _UNSAFE_PATTERNS:
        if pattern.search(msg):
            logger.warning("Suppressed unsafe error message: %s", msg)
            return fallback
    if len(msg) > 300:
        return fallback
    return msg


T = TypeVar("T")


def ensure_found(
    resource: Optional[T],
    resource_name: str = "Resource",
) -> T:
    """Raise 404 if the resource is None, otherwise return it.

    Replaces the repeated pattern:
        if not resource:
            raise HTTPException(status_code=404, detail="X not found")

    Usage:
        location = ensure_found(
            await service.get_location(id, org_id),
            "Location",
        )
    """
    if resource is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{resource_name} not found",
        )
    return resource


@asynccontextmanager
async def handle_service_errors(
    fallback: str = _GENERIC_ERROR,
) -> Any:
    """Async context manager that catches service-layer exceptions
    and converts them to appropriate HTTPExceptions.

    Replaces the repeated pattern:
        try:
            result = await service.do_something(...)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=safe_error_detail(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=safe_error_detail(e))

    Usage:
        async with handle_service_errors("Failed to create location"):
            location = await service.create_location(...)
    """
    try:
        yield
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e, fallback),
        )
    except PermissionError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=safe_error_detail(e, fallback),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e, fallback),
        )


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


def generate_display_code(length: int = 8) -> str:
    """Generate a short, URL-safe, non-guessable display code for public kiosk URLs.

    Uses lowercase alphanumeric characters excluding ambiguous chars (0, o, l, 1)
    for readability when displayed on screen or typed manually.
    """
    alphabet = string.ascii_lowercase + string.digits
    # Remove ambiguous characters
    alphabet = (
        alphabet.replace("0", "").replace("o", "").replace("l", "").replace("1", "")
    )
    return "".join(secrets.choice(alphabet) for _ in range(length))
