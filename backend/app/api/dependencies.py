"""
API Dependencies

FastAPI dependencies for authentication, authorization, and database access.

Permission aggregation combines **position permissions** (from the
``user_positions`` junction table) with **rank default permissions**
(from the ``OPERATIONAL_RANKS`` config keyed by ``User.rank``).
"""

from fastapi import Cookie, Depends, Header, HTTPException, Query, Request, status
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.permissions import get_rank_default_permissions, permission_matches
from app.models.user import Organization, User
from app.services.auth_service import AuthService
from app.utils.db_retry import is_transient_db_error


class PaginationParams:
    """Reusable pagination dependency.

    Injects ``skip`` and ``limit`` query parameters with consistent
    defaults, validation, and OpenAPI descriptions.

    Usage in an endpoint::

        @router.get("/items")
        async def list_items(
            pagination: PaginationParams = Depends(),
            ...
        ):
            items = await service.list(skip=pagination.skip, limit=pagination.limit)

    The default limit is 100 with a max of 1000.  Endpoints can
    override these by passing custom ``Query()`` defaults.
    """

    def __init__(
        self,
        skip: int = Query(0, ge=0, description="Number of records to skip"),
        limit: int = Query(100, ge=1, le=1000, description="Maximum records to return"),
    ):
        self.skip = skip
        self.limit = limit


def _collect_user_permissions(user: User) -> set:
    """
    Aggregate all permissions for *user* by combining:
    1. Permissions from every assigned **position**.
    2. Default permissions from the user's operational **rank**.
    """
    perms: set = set()

    # Positions (the relationship is named `positions` but the
    # backward-compatible alias keeps `roles` working too)
    for position in user.positions:
        perms.update(position.permissions or [])

    # Operational rank defaults
    if user.rank:
        perms.update(get_rank_default_permissions(user.rank))

    return perms


# Paths a user with must_change_password=True may still reach, so they can
# read their state and complete the password change without being locked out.
_MUST_CHANGE_PW_ALLOWED_SUFFIXES = (
    "/auth/change-password",
    "/auth/logout",
    "/auth/me",
    "/auth/refresh",
    "/auth/session-settings",
)

# Paths an un-enrolled user may reach while their org requires MFA, so they can
# complete enrollment without being locked out.
_MFA_ENROLL_ALLOWED_SUFFIXES = (
    "/auth/mfa/setup",
    "/auth/mfa/verify-setup",
    "/auth/mfa/status",
    "/auth/me",
    "/auth/logout",
    "/auth/refresh",
    "/auth/session-settings",
)


async def get_current_user(
    request: Request,
    authorization: str | None = Header(None),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get the current authenticated user from the request.

    Token resolution order:
    1. HttpOnly ``access_token`` cookie (preferred — immune to XSS).
    2. ``Authorization: Bearer <token>`` header (API / non-browser clients).
    """
    # Resolved at most once per request. FastAPI's dependency cache dedupes
    # `Depends(get_current_user)` against itself, but not against the plain
    # call inside `get_optional_current_user` — and `require_module` hangs off
    # the optional one so that public token routes inside gated routers still
    # answer. Without this, every authenticated request to a gated router ran
    # the session lookup, the user/role query, the activity-timestamp flush
    # and sometimes the MFA organization query twice before the handler began.
    #
    # Keyed on nothing because it needs no key: the credentials are fixed for
    # the life of a request, so the second resolution can only reach the same
    # user. Cached on `request.state` rather than in a module-level dict for
    # the reason CLAUDE.md pitfall 9 gives — a process-lifetime cache of user
    # objects is an unbounded one.
    cached_user = getattr(request.state, "authenticated_user", None)
    if cached_user is not None:
        return cached_user

    # Two curated codes for the same 401: "no credentials at all" and
    # "credentials present but rejected" send IT down different paths
    # (cookie/browser problems vs expired or revoked sessions).
    credentials_exception = CodedHTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        error_code=ErrorCode.AUTH_SESSION_INVALID,
        headers={"WWW-Authenticate": "Bearer"},
    )

    token: str | None = None

    # Prefer httpOnly cookie
    if access_token:
        token = access_token
    elif authorization:
        # Extract token from "Bearer <token>" format
        try:
            scheme, _, bearer_token = authorization.partition(" ")
            if scheme.lower() != "bearer" or not bearer_token:
                raise credentials_exception
            token = bearer_token
        except ValueError:
            raise credentials_exception

    if not token:
        logger.debug("Auth rejected: no access_token cookie or Authorization header")
        raise CodedHTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            error_code=ErrorCode.AUTH_NOT_SIGNED_IN,
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate token and get user
    auth_service = AuthService(db)
    try:
        user = await auth_service.get_user_from_token(token)
    except Exception as e:
        if is_transient_db_error(e):
            # Database is temporarily unreachable (e.g. MySQL restart).
            # Return 503 so the frontend can distinguish this from a real
            # auth failure and avoid logging the user out.
            logger.warning(f"Auth check failed due to transient DB error: {e}")
            raise CodedHTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service temporarily unavailable",
                error_code=ErrorCode.SYS_DB_UNAVAILABLE,
                headers={"Retry-After": "5"},
            )
        raise

    if not user:
        raise credentials_exception

    # Enforce a required password change server-side: a user flagged
    # must_change_password may only reach the password-change/session paths
    # until they change it (the frontend honors the same flag, but the API
    # must not rely on that).
    if getattr(user, "must_change_password", False):
        path = request.url.path.rstrip("/")
        if not any(path.endswith(s) for s in _MUST_CHANGE_PW_ALLOWED_SUFFIXES):
            raise CodedHTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Password change required before continuing.",
                error_code=ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED,
                headers={"X-Password-Change-Required": "true"},
            )

    # Enforce an org-wide MFA requirement: an un-enrolled user in an org that
    # requires MFA may only reach the enrollment/session paths until they set
    # it up. The org lookup is skipped entirely for already-enrolled users.
    if not getattr(user, "mfa_enabled", False):
        org_row = await db.execute(
            select(Organization.settings).where(Organization.id == user.organization_id)
        )
        org_settings = org_row.scalar_one_or_none() or {}
        if (org_settings.get("security") or {}).get("mfa_required"):
            path = request.url.path.rstrip("/")
            if not any(path.endswith(s) for s in _MFA_ENROLL_ALLOWED_SUFFIXES):
                raise CodedHTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="MFA enrollment required before continuing.",
                    error_code=ErrorCode.AUTH_MFA_ENROLLMENT_REQUIRED,
                    headers={"X-MFA-Enrollment-Required": "true"},
                )

    # Cached only here, past every rejection above, so a refusal is never
    # short-circuited into an approval on the second resolution.
    request.state.authenticated_user = user
    return user


async def get_optional_current_user(
    request: Request,
    authorization: str | None = Header(None),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Resolve an authenticated user when credentials are present.

    Public routes use this dependency when a record's policy determines whether
    authentication is mandatory. Invalid supplied credentials still fail rather
    than being silently downgraded to an anonymous request.
    """
    if not access_token and not authorization:
        return None
    return await get_current_user(request, authorization, access_token, db)


def _has_permission(required: str, user_permissions: set) -> bool:
    """
    Check if a single required permission is satisfied by the user's permissions.

    Thin wrapper over :func:`permission_matches` so the HTTP layer, the role
    service, and admin-access checks share one matching implementation.
    """
    return permission_matches(required, user_permissions)


def user_has_permission(user: User, permission: str) -> bool:
    """Return True if ``user``'s roles grant ``permission`` (wildcards honored).

    A programmatic counterpart to :func:`require_permission` for handlers that
    must combine an org-level permission check with a per-record condition
    (e.g. "has scheduling.manage OR is this shift's officer").
    """
    return _has_permission(permission, _collect_user_permissions(user))


def can_view_kiosk_display_codes(user: User) -> bool:
    """Whether *user* may read kiosk display codes.

    A location's ``display_code`` is a bearer credential: the unauthenticated
    public kiosk endpoints (``/api/public/v1/display/{code}``) trust it alone,
    so serving it to every authenticated user lets anyone enumerate the exact
    kiosk URLs the manager-gated QR directory protects. Only users who manage
    locations/facilities — or hold ``locations.edit``, which can already
    rotate a code and must see the replacement — may read them. Shared here so
    the locations and facilities-rooms endpoints redact by the same rule.
    """
    return (
        user_has_permission(user, "locations.manage")
        or user_has_permission(user, "facilities.manage")
        or user_has_permission(user, "locations.edit")
    )


def can_view_officer_training_data(user: User) -> bool:
    """True if *user* may see officer-only training data.

    Checklist steps flagged ``member_visible: false`` (background checks,
    reference calls, …) and their sign-off state are reserved for training
    officers and anyone cleared to view all members' training. Shared here so
    every training endpoint gates on the same rule.
    """
    return user_has_permission(user, "training.view_all") or user_has_permission(
        user, "training.manage"
    )


class PermissionChecker:
    """
    Dependency class for checking user permissions using OR logic.

    Grants access if the user has **any one** of the listed permissions.
    For AND logic (require ALL), use ``AllPermissionChecker`` instead.
    """

    def __init__(self, required_permissions: list[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has any of the required permissions (OR logic)"""
        user_permissions = _collect_user_permissions(current_user)

        for perm in self.required_permissions:
            if _has_permission(perm, user_permissions):
                return current_user

        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
            error_code=ErrorCode.PERM_INSUFFICIENT,
        )


class AllPermissionChecker:
    """
    Dependency class for checking user permissions using AND logic.

    Grants access only if the user has **all** of the listed permissions.
    """

    def __init__(self, required_permissions: list[str]):
        self.required_permissions = required_permissions

    async def __call__(
        self,
        current_user: User = Depends(get_current_user),
    ) -> User:
        """Check if user has all of the required permissions (AND logic)"""
        user_permissions = _collect_user_permissions(current_user)

        missing = [
            p
            for p in self.required_permissions
            if not _has_permission(p, user_permissions)
        ]
        if missing:
            raise CodedHTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
                error_code=ErrorCode.PERM_INSUFFICIENT,
            )

        return current_user


def require_permission(*permissions: str):
    """
    Create a permission checker dependency (OR logic — any one permission suffices).
    """
    return PermissionChecker(list(permissions))


def require_all_permissions(*permissions: str):
    """
    Create a permission checker dependency (AND logic — all permissions required).
    """
    return AllPermissionChecker(list(permissions))


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get current active user (not deleted, not suspended)"""
    if not current_user.is_active:
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
            error_code=ErrorCode.AUTH_ACCOUNT_INACTIVE,
        )
    return current_user


async def get_user_organization(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> Organization:
    """Get the organization for the current user"""
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = result.scalar_one_or_none()

    if not organization:
        raise CodedHTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
            error_code=ErrorCode.ORG_NOT_FOUND,
        )

    return organization


# Convenience function for checking secretary position
def require_secretary():
    """Require user to have secretary permissions"""
    return require_permission(
        "settings.manage",
        "settings.manage_contact_visibility",
        "organization.update_settings",
    )


async def get_request_enabled_modules(
    request: Request,
    authorization: str | None = Header(None),
    access_token: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> frozenset[str] | None:
    """The caller's organization's enabled modules, resolved once per request.

    ``None`` when the request carries no *usable* session. That is not the
    same as "no modules": module enablement is a property of an
    organization, and a caller with no organization to name has nothing to
    compare against, so :func:`require_module` stands aside.

    Calls :func:`get_optional_current_user` directly rather than via
    ``Depends`` so an invalid/expired ``access_token`` cookie can be caught
    here instead of raising before this function's body ever runs.
    :func:`require_module` gates whole routers, including ones that carry
    token-authorized public routes (the ballot a member votes from an
    emailed link) reachable with no Logbook session at all. Those callers
    are meant to sail through on "no session" -- but a voter who also
    happens to be logged into the main app, with a since-revoked or expired
    session cookie still sitting in their browser, supplies *a* credential,
    and :func:`get_optional_current_user` deliberately fails rather than
    downgrading an invalid one to anonymous (right for routes that read who
    is asking). For the module flag specifically, an unusable session
    carries no more organization information than no session at all, so it
    is treated the same way here. This does not weaken authentication
    anywhere: an endpoint that actually needs a signed-in user still
    declares its own ``Depends(get_current_user)``, a separate resolution
    unaffected by this one, and still rejects an invalid token normally.

    Memoized on ``request.state`` because a single request can ask more than
    once — a router-level ``require_module`` plus an endpoint that consults the
    set itself, for instance — and each resolution is a database read.
    """
    try:
        current_user = await get_optional_current_user(
            request, authorization, access_token, db
        )
    except HTTPException:
        return None
    if current_user is None:
        return None

    cached = getattr(request.state, "enabled_modules", None)
    if cached is not None:
        return cached

    from app.services.organization_service import OrganizationService

    modules = frozenset(
        (
            await OrganizationService(db).get_enabled_modules(
                current_user.organization_id
            )
        ).enabled_modules
    )
    request.state.enabled_modules = modules
    return modules


def require_module(module: str, label: str | None = None):
    """Require that *module* is switched on for the caller's organization.

    Module enablement and permissions answer different questions and neither
    substitutes for the other. A permission asks whether this member may see
    this data; the module flag asks whether the department runs this part of
    the app at all. A treasurer holds ``finance.manage`` whether or not the
    department keeps its books here, so the permission alone cannot decide.

    Mounted at ``include_router`` rather than per-endpoint, so a route added
    to an already-gated module inherits the gate instead of relying on
    whoever adds it to remember.

    **A request with no session passes through.** Several gated routers carry
    token-authenticated public routes — the ballot a member votes from an
    emailed link, the Salesforce OAuth callback — and those callers have no
    organization for this to be a question about; the token, not a session,
    is what authorizes them. Depending on the *mandatory* current-user
    dependency here would have quietly turned those into 401s, which is why
    this takes the optional one. Every authenticated caller is still gated,
    and that is the surface the module switch is about.

    403 rather than 404: hiding the module's existence buys nothing (the
    settings screen lists every module to any admin) and would turn a
    configuration choice into a debugging exercise. The dedicated error code
    is what lets the client tell "your department switched this off" apart
    from "you lack the permission", which are opposite problems with opposite
    fixes.
    """

    async def check_module_enabled(
        enabled: frozenset[str] | None = Depends(get_request_enabled_modules),
    ) -> None:
        if enabled is None or module in enabled:
            return
        name = label or module.replace("_", " ").title()
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"The {name} module is not enabled for this organization. "
                "An administrator can turn it on under Settings > Modules."
            ),
            error_code=ErrorCode.ORG_MODULE_DISABLED,
        )

    # Named on the function rather than left in a closure cell, so tooling can
    # read the map off a built app. Mirrors ``required_permissions`` on the
    # permission checkers; cell ordering is not part of the language contract.
    check_module_enabled.required_module = module
    return check_module_enabled
