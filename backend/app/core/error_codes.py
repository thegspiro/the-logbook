"""
Application Error Codes

Single source of truth for The Logbook's support-facing error codes.

Every JSON error response carries a stable ``code`` field (e.g.
``LB-AUTH-001``) alongside the human-readable ``detail``. Members can read
the code off a toast or error page and quote it to IT; IT looks it up in the
in-app reference (Error Monitoring page), the ``GET /api/v1/errors/codes``
endpoint, or ``docs/ERROR_CODES.md``.

Two families of codes exist:

* **Curated codes** (``LB-<CATEGORY>-0NN``) are attached explicitly at raise
  sites via :class:`CodedHTTPException` for conditions IT is asked about most
  often (sessions, permissions, CSRF, MFA, outages). Their sequence numbers
  stay below 100 so they can never collide with the fallback family.
* **Fallback codes** (``LB-API-<HTTP status>``) are derived automatically by
  the global exception handlers for any error that was not given a curated
  code, so *every* error response has a code without touching hundreds of
  raise sites.

Codes are a support contract: once published, a code's meaning must not
change. Add new codes rather than repurposing old ones, and update
``docs/ERROR_CODES.md`` (a test asserts the doc lists every curated code).
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from fastapi import HTTPException


class ErrorCode(str, Enum):
    """Curated, stable error codes attached at specific raise sites."""

    # --- Authentication & session -------------------------------------
    AUTH_NOT_SIGNED_IN = "LB-AUTH-001"
    AUTH_SESSION_INVALID = "LB-AUTH-002"
    AUTH_ACCOUNT_INACTIVE = "LB-AUTH-003"
    AUTH_PASSWORD_CHANGE_REQUIRED = "LB-AUTH-004"
    AUTH_MFA_ENROLLMENT_REQUIRED = "LB-AUTH-005"
    AUTH_INVALID_CREDENTIALS = "LB-AUTH-006"
    AUTH_MFA_CODE_INVALID = "LB-AUTH-007"
    AUTH_CSRF_MISSING = "LB-AUTH-008"
    AUTH_CSRF_INVALID = "LB-AUTH-009"
    AUTH_REGISTRATION_DISABLED = "LB-AUTH-010"
    AUTH_MFA_CHALLENGE_EXPIRED = "LB-AUTH-011"

    # --- Permissions ---------------------------------------------------
    PERM_INSUFFICIENT = "LB-PERM-001"

    # --- Validation ----------------------------------------------------
    VALIDATION_FAILED = "LB-VAL-001"

    # --- Organization / tenancy ---------------------------------------
    ORG_NOT_FOUND = "LB-ORG-001"

    # --- System --------------------------------------------------------
    SYS_INTERNAL_ERROR = "LB-SYS-001"
    SYS_DB_UNAVAILABLE = "LB-SYS-002"
    SYS_RATE_LIMITED = "LB-SYS-003"


@dataclass(frozen=True)
class ErrorCodeInfo:
    """Support-facing documentation for one error code."""

    title: str
    description: str
    resolution: tuple[str, ...]


ERROR_CODE_CATALOG: dict[ErrorCode, ErrorCodeInfo] = {
    ErrorCode.AUTH_NOT_SIGNED_IN: ErrorCodeInfo(
        title="Not signed in",
        description=(
            "The request carried no session cookie or bearer token. The "
            "member is not logged in, or their browser did not send the "
            "session cookie."
        ),
        resolution=(
            "Have the member sign in again.",
            "If it recurs immediately after login, check that the browser "
            "accepts cookies and that the site is accessed over the "
            "expected domain (cookies do not cross domains).",
        ),
    ),
    ErrorCode.AUTH_SESSION_INVALID: ErrorCodeInfo(
        title="Session expired or invalid",
        description=(
            "A session token was presented but could not be validated — "
            "it has expired, was revoked (e.g. by a password change or "
            "logout on another device), or is malformed."
        ),
        resolution=(
            "Have the member sign in again.",
            "If every user is affected at once, check whether SECRET_KEY "
            "was rotated — that invalidates all outstanding sessions.",
        ),
    ),
    ErrorCode.AUTH_ACCOUNT_INACTIVE: ErrorCodeInfo(
        title="Account inactive",
        description=("The credentials were correct, but the account is deactivated."),
        resolution=(
            "An administrator can reactivate the account from the Members "
            "page if the deactivation was unintended.",
        ),
    ),
    ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED: ErrorCodeInfo(
        title="Password change required",
        description=(
            "The account is flagged to change its password (usually after "
            "an admin reset). Until the member changes it, every other "
            "action is blocked."
        ),
        resolution=(
            "Have the member complete the password-change prompt shown " "after login.",
        ),
    ),
    ErrorCode.AUTH_MFA_ENROLLMENT_REQUIRED: ErrorCodeInfo(
        title="MFA enrollment required",
        description=(
            "The organization requires multi-factor authentication and "
            "this account has not enrolled yet. Only the MFA setup pages "
            "are reachable until enrollment completes."
        ),
        resolution=(
            "Have the member finish MFA setup under Profile → Security.",
            "An administrator can temporarily lift the org-wide MFA "
            "requirement in Organization Settings → Security if needed.",
        ),
    ),
    ErrorCode.AUTH_INVALID_CREDENTIALS: ErrorCodeInfo(
        title="Incorrect username or password",
        description="Login failed because the credentials did not match.",
        resolution=(
            "Verify the username/email spelling.",
            "Use the password reset flow, or have an administrator reset "
            "the password.",
            "Repeated failures are rate limited — wait a minute before "
            "retrying (see LB-SYS-003).",
        ),
    ),
    ErrorCode.AUTH_MFA_CODE_INVALID: ErrorCodeInfo(
        title="Invalid MFA verification code",
        description=("The 6-digit authenticator code (or backup code) was wrong."),
        resolution=(
            "Codes rotate every 30 seconds — have the member re-enter the "
            "current code.",
            "If codes never work, the phone's clock is likely skewed; "
            "enable automatic time on the device.",
            "An administrator can reset MFA for the account so it can be "
            "re-enrolled.",
        ),
    ),
    ErrorCode.AUTH_CSRF_MISSING: ErrorCodeInfo(
        title="Missing security (CSRF) token",
        description=(
            "A logged-in browser sent a state-changing request without its "
            "CSRF cookie. Usually a stale tab from before a new deployment, "
            "or a browser/extension stripping cookies."
        ),
        resolution=(
            "Reload the page and retry the action.",
            "If it persists, sign out and back in.",
            "Check for browser extensions or privacy settings that block "
            "or strip cookies.",
        ),
    ),
    ErrorCode.AUTH_CSRF_INVALID: ErrorCodeInfo(
        title="Invalid security (CSRF) token",
        description=(
            "The CSRF token sent by the browser did not match the one "
            "issued with the session — typically a stale tab whose session "
            "was replaced by a newer login."
        ),
        resolution=(
            "Reload the page and retry the action.",
            "Close duplicate tabs of the app and sign in again if it " "persists.",
        ),
    ),
    ErrorCode.AUTH_REGISTRATION_DISABLED: ErrorCodeInfo(
        title="Self-registration disabled",
        description=(
            "Someone attempted to self-register while registration is "
            "turned off (the default). Accounts are created by "
            "administrators."
        ),
        resolution=(
            "An administrator should create the account from the Members "
            "page, or enable REGISTRATION_ENABLED if self-registration is "
            "intended.",
        ),
    ),
    ErrorCode.AUTH_MFA_CHALLENGE_EXPIRED: ErrorCodeInfo(
        title="MFA challenge expired",
        description=(
            "Too much time passed between entering the password and "
            "entering the MFA code, so the login attempt was discarded."
        ),
        resolution=(
            "Have the member start the login again and enter the MFA code " "promptly.",
        ),
    ),
    ErrorCode.PERM_INSUFFICIENT: ErrorCodeInfo(
        title="Insufficient permissions",
        description=(
            "The member is signed in but their positions/rank do not grant "
            "the permission this action requires."
        ),
        resolution=(
            "Confirm the member should have access.",
            "An administrator can review the permissions attached to the "
            "member's positions under Admin → Roles & Positions.",
        ),
    ),
    ErrorCode.VALIDATION_FAILED: ErrorCodeInfo(
        title="Request validation failed",
        description=(
            "The submitted data was rejected — a required field is "
            "missing, a value is out of range, or a format is wrong. The "
            "message lists the offending field(s)."
        ),
        resolution=(
            "Correct the highlighted fields and resubmit.",
            "If a seemingly valid form is rejected, note the exact field "
            "and message for the development team — the form and the "
            "server may disagree about what is required.",
        ),
    ),
    ErrorCode.ORG_NOT_FOUND: ErrorCodeInfo(
        title="Organization not found",
        description=(
            "The member's account references an organization record that "
            "no longer exists. This indicates a data problem, not user "
            "error."
        ),
        resolution=(
            "Escalate to the system administrator — the account's "
            "organization link needs to be repaired in the database.",
        ),
    ),
    ErrorCode.SYS_INTERNAL_ERROR: ErrorCodeInfo(
        title="Internal server error",
        description=(
            "An unexpected failure occurred on the server. The full "
            "traceback is recorded in the error log."
        ),
        resolution=(
            "Retry once; if it recurs, check the Error Monitoring page "
            "for the matching server-side entry and traceback.",
            "Report the code, the time, and what the member was doing.",
        ),
    ),
    ErrorCode.SYS_DB_UNAVAILABLE: ErrorCodeInfo(
        title="Database temporarily unavailable",
        description=(
            "The server could not reach its database — typically during a "
            "restart, failover, or an outage. The request was not "
            "processed."
        ),
        resolution=(
            "Wait a moment and retry — restarts clear in under a minute.",
            "If it persists, check that the MySQL container/service is "
            "running and reachable from the backend.",
        ),
    ),
    ErrorCode.SYS_RATE_LIMITED: ErrorCodeInfo(
        title="Too many requests",
        description=(
            "The client exceeded a rate limit (e.g. repeated login "
            "attempts). Requests are temporarily rejected."
        ),
        resolution=(
            "Wait a minute and try again.",
            "Many members behind one shared IP (station wifi) can trip "
            "IP-based limits together; note the time and affected users "
            "if this happens routinely.",
        ),
    ),
}


# Documentation for the automatic LB-API-<status> fallback family. Keyed by
# HTTP status so the reference endpoint/doc can list the common ones; any
# other status still produces a code via fallback_error_code().
FALLBACK_STATUS_INFO: dict[int, ErrorCodeInfo] = {
    400: ErrorCodeInfo(
        title="Request rejected",
        description=(
            "The server rejected the request as invalid for this "
            "resource; the message explains why."
        ),
        resolution=("Follow the message; correct the input and retry.",),
    ),
    401: ErrorCodeInfo(
        title="Authentication required",
        description="The action requires being signed in.",
        resolution=("Have the member sign in and retry.",),
    ),
    403: ErrorCodeInfo(
        title="Access denied",
        description=(
            "The member is signed in but not allowed to perform this " "action."
        ),
        resolution=(
            "Review the member's positions and permissions if access is " "expected.",
        ),
    ),
    404: ErrorCodeInfo(
        title="Not found",
        description=(
            "The requested record does not exist or is not visible to "
            "this member's organization."
        ),
        resolution=(
            "Verify the record still exists (it may have been deleted).",
            "Check the member is signed in to the correct account.",
        ),
    ),
    409: ErrorCodeInfo(
        title="Conflict with current state",
        description=(
            "The action conflicts with the record's current state (e.g. "
            "already checked in, already exists)."
        ),
        resolution=("Refresh the page to load the current state.",),
    ),
    422: ErrorCodeInfo(
        title="Unprocessable request",
        description="The request body could not be validated.",
        resolution=("Correct the highlighted fields and resubmit.",),
    ),
    429: ErrorCodeInfo(
        title="Too many requests",
        description="A rate limit was exceeded.",
        resolution=("Wait a minute and retry.",),
    ),
    500: ErrorCodeInfo(
        title="Server error",
        description="The server failed while handling the request.",
        resolution=("Check the Error Monitoring page for the matching entry.",),
    ),
    502: ErrorCodeInfo(
        title="Bad gateway",
        description=(
            "The reverse proxy could not reach the backend — the backend "
            "is down or restarting."
        ),
        resolution=("Check that the backend container/service is running.",),
    ),
    503: ErrorCodeInfo(
        title="Service unavailable",
        description=(
            "The server (or a dependency such as the database) is "
            "temporarily unavailable."
        ),
        resolution=(
            "Wait a moment and retry; check service health if it " "persists.",
        ),
    ),
}

_FALLBACK_PREFIX = "LB-API-"

_GENERIC_FALLBACK_INFO = ErrorCodeInfo(
    title="Request failed",
    description=("The request failed with the HTTP status embedded in the code."),
    resolution=("Follow the message shown with the error.",),
)


def fallback_error_code(status_code: int) -> str:
    """Automatic code for an error that has no curated code."""
    return f"{_FALLBACK_PREFIX}{status_code}"


class CodedHTTPException(HTTPException):
    """HTTPException carrying a curated support code.

    The global exception handler reads ``error_code`` and includes it as
    the ``code`` field of the JSON error body.
    """

    def __init__(
        self,
        status_code: int,
        detail: Any = None,
        *,
        error_code: ErrorCode,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.error_code = error_code


def resolve_error_code(exc: Exception) -> str:
    """Code for an exception: its curated code, else the status fallback.

    Accepts any exception because Starlette's handler signature is broad;
    non-HTTP exceptions resolve to the 500 fallback.
    """
    code = getattr(exc, "error_code", None)
    if isinstance(code, ErrorCode):
        return code.value
    # Tolerate plain-string codes so ad-hoc raisers (e.g. code that cannot
    # import this module) can still tag exceptions.
    if isinstance(code, str) and code:
        return code
    status_code = getattr(exc, "status_code", 500)
    return fallback_error_code(int(status_code))


def _category(code: ErrorCode) -> str:
    # "LB-AUTH-001" -> "AUTH"
    return code.value.split("-")[1]


def catalog_entries() -> list[dict[str, Any]]:
    """The full reference as JSON-serializable dicts (curated + fallback).

    Consumed by ``GET /api/v1/errors/codes`` and by the doc-sync test.
    """
    entries: list[dict[str, Any]] = [
        {
            "code": code.value,
            "category": _category(code),
            "title": info.title,
            "description": info.description,
            "resolution": list(info.resolution),
        }
        for code, info in ERROR_CODE_CATALOG.items()
    ]
    entries.extend(
        {
            "code": fallback_error_code(http_status),
            "category": "API",
            "title": info.title,
            "description": info.description,
            "resolution": list(info.resolution),
        }
        for http_status, info in FALLBACK_STATUS_INFO.items()
    )
    return entries
