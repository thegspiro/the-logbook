"""
Server-Side Error Reporting

Shared plumbing for persisting backend failures to the ``error_logs`` table
that backs the Error Monitoring page. Both the unhandled-exception handler and
the HTTP-exception handler in ``main.py`` funnel through here so that every
server-side failure an administrator could act on lands in one place.
"""

import re
import traceback
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qs, urlencode

from fastapi import Request
from loguru import logger

from app.core.config import settings

# Query parameters that may carry credentials or PHI-adjacent values. Their
# values are replaced before the URL is persisted, since error logs are
# exportable by administrators and must not become a credential store.
SENSITIVE_QUERY_KEYS = {
    "token",
    "password",
    "secret",
    "api_key",
    "apikey",
    "key",
    "code",
    "access_token",
    "refresh_token",
}

TOKEN_PATH_PATTERNS = (
    re.compile(r"(/finance/approvals/)[^/?#]+", re.IGNORECASE),
    re.compile(r"(/event-requests/status/)[^/?#]+", re.IGNORECASE),
    re.compile(r"(/application-status/)[^/?#]+", re.IGNORECASE),
    re.compile(r"(/calendar/)[^/?#]+(?=\.ics(?:[/\s?#]|$))", re.IGNORECASE),
)

# ``error_logs.error_type`` is String(50); a longer value fails the insert and
# would lose the error entirely rather than truncating it.
MAX_ERROR_TYPE_LENGTH = 50
MAX_ERROR_MESSAGE_LENGTH = 2000
MAX_USER_MESSAGE_LENGTH = 500
# Tracebacks are only kept outside production, and only in an abbreviated form:
# a full async traceback can run to tens of kilobytes, which bloats the row and
# the admin export for no diagnostic gain over the innermost frames.
MAX_TRACEBACK_LENGTH = 4000

# Failures of the error-log endpoints themselves must never be persisted:
# writing a log row about a failing log writer recurses until one of the two
# runs out of database connections.
EXCLUDED_PATH_PREFIXES = ("/api/v1/errors",)


def sanitize_query_params(query_string: str) -> str:
    """Redact sensitive query parameters before persisting to error logs."""
    if not query_string:
        return ""

    parsed = parse_qs(query_string, keep_blank_values=True)
    for key in list(parsed.keys()):
        if key.lower() in SENSITIVE_QUERY_KEYS:
            parsed[key] = ["[REDACTED]"]
    return urlencode(parsed, doseq=True)


def sanitize_path(path: str, path_params: Mapping[str, Any] | None = None) -> str:
    """Redact credential-like route parameters before persisting a path."""
    sanitized = path
    if isinstance(path_params, Mapping):
        for name, value in path_params.items():
            if name.lower() not in SENSITIVE_QUERY_KEYS or value is None:
                continue
            # Match a complete path segment (including tokens immediately before a
            # suffix such as ``.ics``), not an incidental occurrence elsewhere.
            sanitized = re.sub(
                rf"(?<=/){re.escape(str(value))}(?=/|\.|$)",
                "[REDACTED]",
                sanitized,
            )
    # Client reports do not include Starlette's path_params, so retain a
    # conservative route-aware fallback for the public bearer-token workflows.
    for pattern in TOKEN_PATH_PATTERNS:
        sanitized = pattern.sub(r"\1[REDACTED]", sanitized)
    return sanitized


def build_error_type(name: str, prefix: str = "BACKEND_") -> str:
    """Build an error_type that fits the String(50) column."""
    return f"{prefix}{name.upper()}"[:MAX_ERROR_TYPE_LENGTH]


def format_traceback(exc: BaseException) -> str | None:
    """
    Render an exception's traceback for storage, or None in production.

    Tracebacks name internal file paths and can quote query values, so they are
    withheld in production the same way ``safe_error_detail()`` withholds them
    from API responses. The tail is kept rather than the head: the innermost
    frames identify the failure, the outermost are ASGI plumbing.
    """
    if settings.ENVIRONMENT == "production":
        return None
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    if len(tb) <= MAX_TRACEBACK_LENGTH:
        return tb
    return "...[truncated]...\n" + tb[-MAX_TRACEBACK_LENGTH:]


def is_excluded_path(path: str) -> bool:
    """True when failures on this path must not be persisted (see above)."""
    return path.startswith(EXCLUDED_PATH_PREFIXES)


def extract_request_identity(request: Request) -> tuple[str | None, str | None]:
    """
    Resolve ``(user_id, organization_id)`` from the request's credentials.

    The ``access_token`` cookie is checked before the Authorization header
    because browsers authenticate exclusively by httpOnly cookie — the header
    is only used by API clients. A header-only lookup therefore resolves no
    identity for any browser request, and because an ``error_logs`` row
    requires an ``organization_id``, that dropped every browser-triggered
    server error before it reached the table.
    """
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        return None, None

    try:
        from app.core.security import decode_token

        payload = decode_token(token)
    except Exception:
        # An unreadable token is normal here (expired, malformed, forged); it
        # only means this error cannot be attributed to an organization.
        logger.debug("Could not extract identity from request token")
        return None, None

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    return (
        str(user_id) if user_id else None,
        str(org_id) if org_id else None,
    )


async def persist_error_log(
    request: Request,
    error_type: str,
    error_message: str,
    user_message: str,
    troubleshooting_steps: list[str],
    exc: BaseException | None = None,
    extra_context: dict[str, Any] | None = None,
) -> bool:
    """
    Write one error to the ``error_logs`` table. Best-effort by design.

    Returns True when a row was written. Never raises: an error in the error
    reporter must not replace the error the caller is already handling.
    """
    raw_path = str(request.url.path)
    if is_excluded_path(raw_path):
        return False

    user_id, org_id = extract_request_identity(request)
    if not org_id:
        # error_logs.organization_id is NOT NULL and every read of the table is
        # org-scoped, so an unattributable error has nowhere to go. The
        # structured log below remains the record of it.
        return False

    context: dict[str, Any] = {
        "method": request.method,
        "path": sanitize_path(raw_path, getattr(request, "path_params", None)),
        "query": sanitize_query_params(str(request.url.query)),
        "source": "backend",
    }
    if exc is not None:
        context["traceback"] = format_traceback(exc)
    if extra_context:
        context.update(extra_context)
    # Callers may supply additional request context, but may not bypass the
    # credential redaction applied to the canonical path above.
    if isinstance(context.get("path"), str):
        context["path"] = sanitize_path(
            context["path"], getattr(request, "path_params", None)
        )

    try:
        from app.core.database import database_manager
        from app.models.error_log import ErrorLog

        async for session in database_manager.get_session():
            session.add(
                ErrorLog(
                    organization_id=org_id,
                    error_type=error_type[:MAX_ERROR_TYPE_LENGTH],
                    error_message=error_message[:MAX_ERROR_MESSAGE_LENGTH],
                    user_message=user_message[:MAX_USER_MESSAGE_LENGTH],
                    troubleshooting_steps=troubleshooting_steps,
                    context=context,
                    user_id=user_id,
                )
            )
            await session.commit()
            break
        return True
    except Exception as log_exc:
        logger.error(f"Failed to persist error log: {log_exc}")
        return False
